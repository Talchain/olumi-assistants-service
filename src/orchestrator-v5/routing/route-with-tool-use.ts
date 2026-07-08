/**
 * V5 Phase 1 — Tool-Use Routing Call (replaces the narrow JSON classifier).
 *
 * Given a ContextPack and the user message, call Sonnet with the olumi_action
 * tool definition and `tool_choice: "auto"`. Two outcomes:
 *
 *  - Tool call present  → parse into ToolCallResponse; return
 *    { type: 'tool_call', proposal, orientationText }. `orientationText` is
 *    any leading text block that accompanied the tool_use (pre-action
 *    orientation for the user — context, not outcomes — per spec §4.1).
 *
 *  - No tool call (text only) → infer intent_class === 'converse' (or
 *    'coach' if the caller provided a hint; currently always 'converse' in
 *    this module — 'coach' is a tool-call-only classification in Phase 1a).
 *    Return { type: 'text_only', text, inferredIntent: 'converse' }.
 *
 * REPAIR_ONCE (spec §7): one schema-repair attempt on parse failure with
 * structured error feedback, then abort with schema_repair_failed. No
 * raw errors leak — every failure path produces a typed RoutingError.
 *
 * Budget: ORCHESTRATOR_TIMEOUT_MS (per-call) — matches existing V5 narrate
 * path. The brief's LLM_BUDGET_INTERPRET_MS does not exist in this repo
 * (observation 2 of D1); we substitute the nearest extant budget.
 *
 * This module does NOT:
 *   - execute handlers (dispatch is D6's TurnExecutor)
 *   - validate proposals against the graph (D4 validator)
 *   - persist anything
 *   - carry coaching logic beyond classification
 *   - author the full orchestrator prompt (Claude drafts that separately)
 */

import { getAdapterWithResolution, type ModelResolution } from '../../adapters/llm/router.js';
import {
  UpstreamHTTPError,
  UpstreamTimeoutError,
} from '../../adapters/llm/errors.js';
import { ORCHESTRATOR_TIMEOUT_MS } from '../../config/timeouts.js';

/**
 * Cap on the routing call's output budget. The routing tool-use call
 * emits at most a single `olumi_action` tool_use plus a short leading
 * orientation paragraph. The adapter default of 4096 was previously
 * responsible for long wall-time turns (observed 36s) that ended in
 * `stop_reason: max_tokens`; capping reduces worst-case wall time AND
 * moves max_tokens detection earlier so the bounded-fallback path fires
 * faster.
 *
 * Raised 2048 -> 3072 for Claude Sonnet 5 (2026-07-08). Two Sonnet-5
 * effects both consume this budget: (1) the tokenizer produces ~30% more
 * tokens for the same text, so 2048 held ~30% less content than on
 * Sonnet 4.6; (2) adaptive thinking is ON BY DEFAULT when the `thinking`
 * param is omitted (the routing call omits it), and thinking tokens share
 * `max_tokens` with the output. 3072 keeps the fast common path bounded
 * while giving the typical coaching answer + light adaptive thinking room
 * to complete. Tune against the flip's `v5.routing.max_tokens_retry` rate.
 * Higher-value root-cause lever if the retry rate stays elevated: disable
 * adaptive thinking on the routing call for Sonnet 5 (a fast classify +
 * short answer does not need extended reasoning) — see the PR follow-up.
 */
export const V5_ROUTING_MAX_OUTPUT_TOKENS = 3072;

/**
 * Escalated output budget for the single max_tokens retry
 * (prompt-workstream fix, 2026-07-08). Live evidence: ~4-5% of routing
 * calls ended with `stop_reason: 'max_tokens'` at the old 2048 cap (a
 * failed call burned exactly 2048 completion tokens) and each one shipped
 * the bounded-fallback apology. On max_tokens we retry ONCE at this budget
 * — same messages, same tools — before falling through to the unchanged
 * error path. Raised 4096 -> 8192 for Sonnet 5: the turns that truncate
 * are the long coaching/explanation answers, and with the +30% tokenizer
 * plus adaptive thinking sharing the budget they need real headroom to
 * finish rather than re-truncating on the retry.
 */
export const V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY = 8192;
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  SystemCacheBlock,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { recordModelResolution } from '../debug/turn-debug-store.js';
import { config } from '../../config/index.js';
import { TelemetryEvents, emit } from '../../utils/telemetry.js';

import type { ContextPack } from '../context/context-pack-assembler.js';

import {
  OLUMI_ACTION_TOOL,
  OLUMI_ACTION_TOOL_NAME,
  ToolCallParseError,
  parseToolCallResponse,
  type ToolCallResponse,
} from './tool-schema.js';
import {
  LOADED_PROMPT,
  ensureRoutingPromptSnapshot,
  getCachedRoutingPromptIdentity,
} from './prompt-loader.js';
import { log } from '../../utils/telemetry.js';

// -----------------------------------------------------------------------
// Result + error types
// -----------------------------------------------------------------------

export interface RoutingToolCallResult {
  readonly type: 'tool_call';
  readonly proposal: ToolCallResponse;
  readonly orientationText: string;
  readonly rawResult: ChatWithToolsResult;
  /**
   * Total Anthropic chatWithTools invocations made by this routing call.
   * 1 on a successful first attempt; 2 when REPAIR_ONCE was used.
   */
  readonly llmCallCount: number;
}

export interface RoutingTextOnlyResult {
  readonly type: 'text_only';
  readonly text: string;
  readonly inferredIntent: 'converse';
  readonly rawResult: ChatWithToolsResult;
  /** Total chatWithTools invocations (always 1 on text-only success). */
  readonly llmCallCount: number;
}

export type RoutingResult = RoutingToolCallResult | RoutingTextOnlyResult;

export type RoutingErrorCause =
  | 'timeout'
  | 'api_error'
  | 'schema_repair_failed'
  | 'empty_response'
  | 'unexpected_stop_reason'
  | 'aborted';

export class RoutingError extends Error {
  readonly cause: RoutingErrorCause;
  readonly provider_message?: string | undefined;
  /**
   * HTTP status code from upstream error (if available). Used to distinguish
   * between 400-level (client error, our fault) and 500-level (server error,
   * API unavailable) errors for proper error classification.
   */
  readonly status?: number | undefined;
  /**
   * Total Anthropic chatWithTools invocations attempted before this error
   * fired. 0 if the failure happened before the first call (e.g. defensive
   * pre-check). 1 on a single-call failure. 2 when REPAIR_ONCE was used and
   * the repair attempt also failed. Lets TurnExecutor report accurate
   * llm_calls_used telemetry on failure paths (post-review fix).
   */
  readonly llmCallCount: number;
  constructor(
    cause: RoutingErrorCause,
    message: string,
    opts?: { provider_message?: string; status?: number; llmCallCount?: number },
  ) {
    super(message);
    this.name = 'RoutingError';
    this.cause = cause;
    this.provider_message = opts?.provider_message;
    this.status = opts?.status;
    this.llmCallCount = opts?.llmCallCount ?? 0;
  }
}

// -----------------------------------------------------------------------
// System prompt — routing instructions only
// -----------------------------------------------------------------------

/**
 * Routing system prompt — loaded as a single hardcoded constant and handed
 * verbatim to `adapter.chatWithTools` as `system:`. There is no PMS or
 * templating indirection on this path (V5 routing does not go through the
 * prompt-store infrastructure that the unified pipeline uses).
 *
 * **Prompt installation point (V5 Task 3.1).** When a new routing prompt
 * text is approved, replace this constant in full. No mechanism changes
 * required: the adapter accepts arbitrary system-prompt length up to the
 * model's input window (Claude 4.x ~200K tokens). The single-user-message
 * assembly in `buildUserMessage` reserves the rest of the budget for
 * ContextPack + user turn; a ~5K-token routing prompt still leaves ~195K
 * tokens of runway, well above the observed ~7-10K token ContextPack.
 *
 * **Single-turn constraint.** Conversation history text is NOT yet in the
 * ContextPack (Task 1.1 deferred — requires a Supabase migration + schema
 * change). Any prompt installed here must be designed for single-turn
 * self-containment: never assume prior user messages, never say "as we
 * discussed", never treat the current turn as continuing a multi-turn
 * coaching arc. Each response must work as a freestanding answer.
 *
 * V5 alpha hardening Phase 2.1: the system prompt is now the content of
 * the active prompt file (currently `Prompts/v40.txt`), loaded at module
 * init via `./prompt-loader.ts`. The previous 662-char hardcoded constant
 * was the routing-only scaffolding from earlier slices; the file-loaded
 * prompt is the full orchestrator persona + reasoning prompt.
 * Observability primitives (version, hash, systemChars) are exported
 * alongside for lifecycle logs.
 */
export const ROUTING_SYSTEM_PROMPT: string = LOADED_PROMPT.text;
export const ROUTING_PROMPT_VERSION: string = LOADED_PROMPT.version;
export const ROUTING_PROMPT_HASH: string = LOADED_PROMPT.hash;
export const ROUTING_PROMPT_SOURCE_HASH: string = LOADED_PROMPT.sourceHash;
export const ROUTING_PROMPT_SENT_HASH: string = LOADED_PROMPT.sentHash;
export const ROUTING_PROMPT_SYSTEM_CHARS: number = LOADED_PROMPT.systemChars;

// -----------------------------------------------------------------------
// Prompt-cache call shape
// -----------------------------------------------------------------------

export type V5PromptCacheMode =
  | 'enabled'
  | 'disabled_config'
  | 'disabled_api_unsupported';

/**
 * Build the system field(s) for a routing chatWithTools call. When
 * Anthropic prompt caching is enabled (`config.promptCache.anthropicEnabled`,
 * default true) the prompt is sent as a single ephemeral cache block; the
 * adapter forwards `system_cache_blocks` to the SDK with `cache_control`
 * intact (see [src/adapters/llm/anthropic.ts:2643-2651]). When caching is
 * disabled we fall back to the plain string `system` parameter — same bytes,
 * no cache instruction. This helper is exported so tests can drive the
 * shape directly without mutating global config.
 */
export function buildSystemForRouting(
  prompt: string,
  opts?: { cachingEnabled?: boolean },
): {
  fields: { system: string; system_cache_blocks?: SystemCacheBlock[] };
  cacheMode: 'enabled' | 'disabled_config';
} {
  const cachingEnabled =
    opts?.cachingEnabled ?? config.promptCache.anthropicEnabled;
  if (cachingEnabled) {
    // The adapter prefers `system_cache_blocks` over `system` when both are
    // present (anthropic.ts:2645). `system` is retained as a fallback for
    // non-Anthropic adapters that ignore `system_cache_blocks` per types.ts.
    const blocks: SystemCacheBlock[] = [
      { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
    ];
    return {
      fields: { system: prompt, system_cache_blocks: blocks },
      cacheMode: 'enabled',
    };
  }
  return { fields: { system: prompt }, cacheMode: 'disabled_config' };
}

/**
 * Narrow detector for the only error class that should trigger the
 * disabled_api_unsupported fallback: Anthropic 400 BadRequest whose body
 * mentions cache_control. Timeouts, 429s, 5xx, AbortError and 400s for
 * unrelated reasons must propagate unchanged.
 */
function isCacheControlSchemaRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // UpstreamHTTPError carries .status; the SDK's BadRequestError shape also
  // exposes status. Either way we require status === 400 + a cache_control
  // mention in the rendered message.
  const anyErr = err as { status?: unknown; message?: unknown };
  const status =
    typeof anyErr.status === 'number'
      ? anyErr.status
      : Number(anyErr.status ?? NaN);
  if (status !== 400) return false;
  const message =
    typeof anyErr.message === 'string' ? anyErr.message : String(anyErr.message ?? '');
  return /cache_control/i.test(message);
}

interface V5PromptCacheEmitArgs {
  requestId: string;
  sessionId: string | null;
  llmCall: 1 | 2;
  cacheMode: V5PromptCacheMode;
  usage: ChatWithToolsResult['usage'] | undefined;
  stablePrefixBytes: number;
}

function emitV5PromptCache(args: V5PromptCacheEmitArgs): void {
  const servedIdentity = getCachedRoutingPromptIdentity();
  const cacheRead = args.usage?.cache_read_input_tokens;
  const cacheCreate = args.usage?.cache_creation_input_tokens;
  const totalInput = args.usage?.input_tokens;
  // cache_hit is true when read>0, false when read===0, null when usage
  // didn't expose cache fields at all.
  let cacheHit: boolean | null;
  if (typeof cacheRead === 'number') {
    cacheHit = cacheRead > 0;
  } else {
    cacheHit = null;
  }
  emit(TelemetryEvents.V5PromptCache, {
    // Brief-named identifiers (scenario_id, turn_id) emitted alongside the
    // codebase's existing routing-log aliases (request_id ≡ turn_id,
    // v5_journey_id ≡ scenario_id) so downstream consumers can join on
    // either convention.
    request_id: args.requestId,
    turn_id: args.requestId,
    v5_journey_id: args.sessionId,
    scenario_id: args.sessionId,
    llm_call: args.llmCall,
    cache_mode: args.cacheMode,
    cache_creation_input_tokens:
      typeof cacheCreate === 'number' ? cacheCreate : null,
    cache_read_input_tokens: typeof cacheRead === 'number' ? cacheRead : null,
    total_input_tokens: typeof totalInput === 'number' ? totalInput : null,
    cache_hit: cacheHit,
    stable_prefix_bytes: args.stablePrefixBytes,
    // ROADMAP 1.32 — identity stamp: prefer the SERVED PMS snapshot
    // identity over the static repo-default constants (which misreport as
    // v40/21,439 when PMS serves e.g. version 112/21,860). Field names are
    // unchanged so dashboards keep joining on the same keys. The snapshot
    // is built before any adapter call on this path, so the constant
    // fallback only fires in pre-boot/test contexts.
    prompt_version: servedIdentity?.version ?? ROUTING_PROMPT_VERSION,
    prompt_hash: servedIdentity?.sent_hash ?? ROUTING_PROMPT_HASH,
    source_hash: servedIdentity?.raw_hash ?? ROUTING_PROMPT_SOURCE_HASH,
    sent_hash: servedIdentity?.sent_hash ?? ROUTING_PROMPT_SENT_HASH,
  });
}

// One-time module-init log so every deploy records the installed prompt.
// Keep payload minimal — no user text, no secrets. Fires once per process.
log.info(
  {
    event: 'v5.routing_prompt_loaded',
    prompt_version: ROUTING_PROMPT_VERSION,
    prompt_hash: ROUTING_PROMPT_HASH,
    system_chars: ROUTING_PROMPT_SYSTEM_CHARS,
  },
  'V5 routing prompt loaded',
);

// -----------------------------------------------------------------------
// Anthropic message protocol helpers
// -----------------------------------------------------------------------

type AnthropicMessage = ChatWithToolsArgs['messages'][number];

function buildRepairMessages(
  originalMessages: AnthropicMessage[],
  assistantContent: ToolResponseBlock[],
  validationDetail: string,
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [...originalMessages];

  messages.push({ role: 'assistant', content: assistantContent });

  const toolUseBlocks = assistantContent.filter(
    (b): b is Extract<ToolResponseBlock, { type: 'tool_use' }> => b.type === 'tool_use',
  );

  const userContent: ToolResponseBlock[] = toolUseBlocks.map((tu) => ({
    type: 'tool_result' as const,
    tool_use_id: tu.id,
    content: `Validation failed: ${validationDetail}`,
    is_error: true,
  }));

  userContent.push({
    type: 'text' as const,
    text: 'Emit one corrected olumi_action call that strictly matches the tool\'s input_schema.',
  });

  messages.push({ role: 'user', content: userContent });

  return messages;
}

export function assertAnthropicMessageProtocol(messages: AnthropicMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

    const toolUseIds = msg.content
      .filter((b): b is Extract<ToolResponseBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => b.id);

    if (toolUseIds.length === 0) continue;

    const next = messages[i + 1];
    if (!next || next.role !== 'user') {
      throw new Error(
        `Anthropic protocol: assistant tool_use at index ${i} not followed by user message`,
      );
    }

    const nextContent = Array.isArray(next.content) ? next.content : [];
    const resultIds = new Set(
      nextContent
        .filter((b): b is Extract<ToolResponseBlock, { type: 'tool_result' }> => b.type === 'tool_result')
        .map((b) => b.tool_use_id),
    );

    for (const tuId of toolUseIds) {
      if (!resultIds.has(tuId)) {
        throw new Error(
          `Anthropic protocol: tool_use ${tuId} has no matching tool_result in message ${i + 1}`,
        );
      }
    }

    const allResultIds = nextContent
      .filter((b): b is Extract<ToolResponseBlock, { type: 'tool_result' }> => b.type === 'tool_result')
      .map((b) => b.tool_use_id);
    if (new Set(allResultIds).size !== allResultIds.length) {
      throw new Error(
        `Anthropic protocol: duplicate tool_result IDs in message ${i + 1}`,
      );
    }

    const toolUseIdSet = new Set(toolUseIds);
    for (const rid of allResultIds) {
      if (!toolUseIdSet.has(rid)) {
        throw new Error(
          `Anthropic protocol: tool_result ${rid} in message ${i + 1} has no matching tool_use in message ${i}`,
        );
      }
    }
  }
}

// -----------------------------------------------------------------------
// Invocation
// -----------------------------------------------------------------------

export interface RouteWithToolUseOptions {
  /**
   * Override the per-call timeout. Defaults to ORCHESTRATOR_TIMEOUT_MS. The
   * abort signal remains the outer turn budget — whichever fires first wins.
   */
  readonly timeoutMs?: number;
  /** Request id threaded through telemetry and adapter logs. */
  readonly requestId: string;
  /**
   * Session id (V5 alias for scenario_id). When present alongside an
   * uninjected adapter, the routing call records a model_resolutions entry
   * on the turn-debug store. Omitted only by tests that inject their own
   * adapter.
   */
  readonly sessionId?: string;
  /** External abort signal (turn budget). */
  readonly signal?: AbortSignal;
  /** Injected adapter — tests pass a mock; production resolves via router. */
  readonly adapter?: {
    chatWithTools: (
      args: ChatWithToolsArgs,
      opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
    ) => Promise<ChatWithToolsResult>;
  };
  /**
   * V5 Task 3.1 review: test-only override for the system prompt passed to
   * the adapter. Production always uses `ROUTING_SYSTEM_PROMPT`; the
   * prompt-size test uses this seam to prove that a 19K-char prompt
   * survives the loading path unchanged. Intentionally undocumented in
   * routing docs — use sparingly and only in tests.
   */
  readonly systemPromptOverride?: string;
}

export async function routeWithToolUse(
  contextPack: ContextPack,
  message: string,
  options: RouteWithToolUseOptions,
): Promise<RoutingResult> {
  // Production path: resolve via the router with the 'orchestrator' task ID so
  // store_model_config, CEE_MODEL_ORCHESTRATOR, and TASK_MODEL_DEFAULTS['orchestrator']
  // are respected in that order. Group 3 Task C fix — previously this site used
  // getAdapter('direct_answer_narrate'), which is NOT a valid CeeTask and
  // therefore fell through to LLM_PROVIDER/LLM_MODEL (gpt-4o-mini on staging).
  const { adapter, resolution } = options.adapter
    ? { adapter: options.adapter, resolution: null as ModelResolution | null }
    : resolveRoutingAdapter();
  const timeoutMs = options.timeoutMs ?? ORCHESTRATOR_TIMEOUT_MS;

  // Record the resolution once per call (not per LLM invocation) so each turn
  // gets exactly one model_resolutions entry for ORIENT regardless of
  // REPAIR_ONCE. Skip when we have no session_id (test-injected adapters) —
  // recordModelResolution requires turn_id + session_id.
  if (resolution && options.sessionId) {
    recordModelResolution(options.requestId, options.sessionId, resolution);
  }

  const userMessage = buildUserMessage(contextPack, message);

  // PMS-backed routing prompt snapshot. Built once at startup; this call is
  // a cheap cached read on every routing turn after boot. The snapshot's
  // `text` is the normalised content sent to Anthropic; `sent_hash` is the
  // cache-key hash; `version` carries through PMS overrides if present.
  // Falls back to the registered default (Prompts/v40.txt) when Supabase is
  // empty or unreachable. The model/temperature/tools selection below is
  // controlled here, not by PMS modelConfig.
  const snapshot = await ensureRoutingPromptSnapshot();
  const promptText = options.systemPromptOverride ?? snapshot.text;
  const promptVersion = snapshot.version;
  const promptSentHash = snapshot.sent_hash;
  const initialSystem = buildSystemForRouting(promptText);
  let cacheMode: V5PromptCacheMode = initialSystem.cacheMode;

  let firstCallArgs: ChatWithToolsArgs = {
    ...initialSystem.fields,
    messages: [{ role: 'user', content: userMessage }],
    tools: [OLUMI_ACTION_TOOL],
    tool_choice: { type: 'auto' },
    temperature: 0,
    maxTokens: V5_ROUTING_MAX_OUTPUT_TOKENS,
  };

  assertAnthropicMessageProtocol(firstCallArgs.messages);

  // V5 alpha hardening Phase 2.1: per-call observability. Debug level so
  // production info streams stay clean; captured by the Phase 3 replay
  // harness via stdout. v5_journey_id aliases scenario_id (sessionId here).
  // context_pack_chars is a synthetic char-count proxy for quick sanity —
  // JSON-stringify cost is a few ms on typical packs.
  const contextPackChars = JSON.stringify(contextPack).length;
  const systemPromptChars = promptText.length;
  // stable_prefix_bytes must be UTF-8 byte length, not UTF-16 code-unit
  // count — Anthropic's prompt cache is byte-keyed, so any future
  // non-ASCII edit to v40 would otherwise misreport the cached size.
  const stablePrefixBytes = Buffer.byteLength(promptText, 'utf8');
  // V5 alpha hardening follow-up: emit the full primary-event obs
  // schema with nulls for fields unknown at routing-call time
  // (handler_proposed / validator_outcome / response_type are populated
  // by later lifecycle events). Schema consistency across every
  // primary event means one log query joins cleanly on any of the
  // obs fields.
  log.debug(
    {
      event: 'v5.routing.calling_anthropic',
      request_id: options.requestId,
      v5_journey_id: options.sessionId ?? null,
      llm_call: 1,
      prompt_version: promptVersion,
      prompt_hash: promptSentHash,
      system_chars: systemPromptChars,
      context_pack_chars: contextPackChars,
      handler_proposed: null,
      validator_outcome: null,
      response_type: null,
      message_length: message.length,
    },
    'V5 routing call (initial)',
  );

  let firstResult: ChatWithToolsResult;
  try {
    firstResult = await adapter.chatWithTools(firstCallArgs, {
      requestId: options.requestId,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    // Narrow fallback: only retry-without-cache for the precise schema
    // rejection shape (HTTP 400 with /cache_control/i). All other error
    // classes — timeouts, 429s, 5xx, AbortError, generic 400s — propagate
    // unchanged through translateAdapterError exactly as before.
    if (cacheMode === 'enabled' && isCacheControlSchemaRejection(err)) {
      log.warn(
        {
          event: 'v5.prompt_cache.fallback',
          request_id: options.requestId,
          turn_id: options.requestId,
          v5_journey_id: options.sessionId ?? null,
          scenario_id: options.sessionId ?? null,
          reason: 'cache_control_schema_rejection',
        },
        'V5 routing prompt-cache rejected by API, retrying without cache_control',
      );
      const fallbackSystem = buildSystemForRouting(promptText, {
        cachingEnabled: false,
      });
      cacheMode = 'disabled_api_unsupported';
      firstCallArgs = {
        ...firstCallArgs,
        ...fallbackSystem.fields,
        system_cache_blocks: undefined,
      };
      try {
        firstResult = await adapter.chatWithTools(firstCallArgs, {
          requestId: options.requestId,
          timeoutMs,
          signal: options.signal,
        });
      } catch (retryErr) {
        emitV5PromptCache({
          requestId: options.requestId,
          sessionId: options.sessionId ?? null,
          llmCall: 1,
          cacheMode,
          usage: undefined,
          stablePrefixBytes,
        });
        throw translateAdapterError(retryErr, 1);
      }
    } else {
      emitV5PromptCache({
        requestId: options.requestId,
        sessionId: options.sessionId ?? null,
        llmCall: 1,
        cacheMode,
        usage: undefined,
        stablePrefixBytes,
      });
      throw translateAdapterError(err, 1);
    }
  }

  emitV5PromptCache({
    requestId: options.requestId,
    sessionId: options.sessionId ?? null,
    llmCall: 1,
    cacheMode,
    usage: firstResult.usage,
    stablePrefixBytes,
  });

  // max_tokens retry (prompt-workstream fix, 2026-07-08). Live evidence:
  // ~4-5% of routing calls ended `stop_reason: 'max_tokens'` at the 2048
  // cap (burning exactly 2048 completion tokens) and each one shipped the
  // bounded-fallback apology. Retry ONCE with a doubled output budget —
  // same messages, same tools — before falling through to the unchanged
  // `unexpected_stop_reason` error path. The event below uses the plain
  // pino event-string pattern (like `v5.routing_prompt_loaded` /
  // `v5.prompt_cache.fallback`) — deliberately NOT a new member of the
  // frozen TelemetryEvents registry. No second V5PromptCache emit for the
  // retry call: that event's `llm_call: 1 | 2` identifies initial-vs-repair;
  // the retry's latency + token counts travel on this pino event instead.
  let llmCallsUsed = 1;
  if (firstResult.stop_reason === 'max_tokens') {
    log.info(
      {
        event: 'v5.routing.max_tokens_retry',
        request_id: options.requestId,
        v5_journey_id: options.sessionId ?? null,
        first_attempt_latency_ms: firstResult.latencyMs,
        first_attempt_input_tokens: firstResult.usage?.input_tokens ?? null,
        first_attempt_output_tokens: firstResult.usage?.output_tokens ?? null,
        first_attempt_max_tokens: V5_ROUTING_MAX_OUTPUT_TOKENS,
        retry_max_tokens: V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY,
      },
      'V5 routing hit max_tokens — retrying once with a larger output budget',
    );
    let retryResult: ChatWithToolsResult;
    try {
      retryResult = await adapter.chatWithTools(
        { ...firstCallArgs, maxTokens: V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY },
        {
          requestId: options.requestId,
          timeoutMs,
          signal: options.signal,
        },
      );
    } catch (err) {
      throw translateAdapterError(err, 2);
    }
    // If the retry ALSO ends max_tokens, tryInterpret below classifies it
    // as non_repairable `unexpected_stop_reason` — the pre-existing
    // bounded-fallback path, unchanged.
    firstResult = retryResult;
    llmCallsUsed = 2;
  }

  const parsedOrError = tryInterpret(firstResult, llmCallsUsed);
  if (parsedOrError.kind === 'ok') return parsedOrError.result;
  if (parsedOrError.kind === 'non_repairable') throw parsedOrError.error;

  // REPAIR_ONCE — parse failed. Build protocol-compliant retry messages
  // with tool_result blocks matching every tool_use in the assistant response.
  const repairMessages = buildRepairMessages(
    firstCallArgs.messages,
    firstResult.content,
    parsedOrError.detail,
  );
  assertAnthropicMessageProtocol(repairMessages);

  const repairArgs: ChatWithToolsArgs = {
    ...firstCallArgs,
    messages: repairMessages,
  };

  log.debug(
    {
      event: 'v5.routing.calling_anthropic',
      request_id: options.requestId,
      v5_journey_id: options.sessionId ?? null,
      llm_call: 2,
      prompt_version: promptVersion,
      prompt_hash: promptSentHash,
      system_chars: systemPromptChars,
      context_pack_chars: contextPackChars,
      handler_proposed: null,
      validator_outcome: null,
      response_type: null,
      repair: true,
    },
    'V5 routing call (repair)',
  );

  let repairResult: ChatWithToolsResult;
  try {
    repairResult = await adapter.chatWithTools(repairArgs, {
      requestId: options.requestId,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    emitV5PromptCache({
      requestId: options.requestId,
      sessionId: options.sessionId ?? null,
      llmCall: 2,
      cacheMode,
      usage: undefined,
      stablePrefixBytes,
    });
    throw translateAdapterError(err, llmCallsUsed + 1);
  }

  emitV5PromptCache({
    requestId: options.requestId,
    sessionId: options.sessionId ?? null,
    llmCall: 2,
    cacheMode,
    usage: repairResult.usage,
    stablePrefixBytes,
  });

  const secondAttempt = tryInterpret(repairResult, llmCallsUsed + 1);
  if (secondAttempt.kind === 'ok') return secondAttempt.result;
  throw new RoutingError(
    'schema_repair_failed',
    `Routing tool-call repair attempt failed: ${secondAttempt.kind === 'non_repairable' ? secondAttempt.error.message : secondAttempt.detail}`,
    { llmCallCount: llmCallsUsed + 1 },
  );
}

// -----------------------------------------------------------------------
// Interpreting a ChatWithToolsResult
// -----------------------------------------------------------------------

type Interpretation =
  | { kind: 'ok'; result: RoutingResult }
  | { kind: 'parse_failed'; detail: string }
  | { kind: 'non_repairable'; error: RoutingError };

function tryInterpret(result: ChatWithToolsResult, llmCallCount: number): Interpretation {
  if (result.stop_reason === 'max_tokens') {
    return {
      kind: 'non_repairable',
      error: new RoutingError(
        'unexpected_stop_reason',
        'Sonnet hit max_tokens before completing routing decision',
        { llmCallCount },
      ),
    };
  }

  const toolUse = result.content.find((b) => b.type === 'tool_use');
  const textBlocks = result.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text');
  const joinedText = textBlocks.map((b) => b.text).join('\n').trim();

  if (toolUse && toolUse.type === 'tool_use') {
    if (toolUse.name !== OLUMI_ACTION_TOOL_NAME) {
      return {
        kind: 'non_repairable',
        error: new RoutingError(
          'api_error',
          `Sonnet called unknown tool: "${toolUse.name}" (expected "${OLUMI_ACTION_TOOL_NAME}")`,
          { llmCallCount },
        ),
      };
    }
    try {
      const proposal = parseToolCallResponse(toolUse.input);
      return {
        kind: 'ok',
        result: {
          type: 'tool_call',
          proposal,
          orientationText: joinedText,
          rawResult: result,
          llmCallCount,
        },
      };
    } catch (err) {
      const detail = err instanceof ToolCallParseError ? err.message : String(err);
      return { kind: 'parse_failed', detail };
    }
  }

  if (joinedText.length === 0) {
    return {
      kind: 'non_repairable',
      error: new RoutingError(
        'empty_response',
        'Sonnet returned neither tool call nor text',
        { llmCallCount },
      ),
    };
  }

  return {
    kind: 'ok',
    result: {
      type: 'text_only',
      text: joinedText,
      inferredIntent: 'converse',
      rawResult: result,
      llmCallCount,
    },
  };
}

// -----------------------------------------------------------------------
// User message construction — ContextPack serialised for Sonnet
// -----------------------------------------------------------------------

function buildUserMessage(contextPack: ContextPack, message: string): string {
  // Design principle: raw model values stay in structured state for
  // handlers, telemetry, freshness hashing, and edit_graph dispatch;
  // LLM-facing context uses decision-language projections only. Strip
  // both the raw `analysis` projection (raw probabilities, signed
  // sensitivities) and the raw `graph` projection (raw edge `strength`,
  // `exists` floats, internal node numeric fields) and surface their
  // display-safe counterparts under the same keys so prompt instructions
  // referencing graph edges and analysis fields continue to resolve.
  //
  // `analysis_state` (the redacted canonical analysis summary) is ALSO
  // stripped: it is structured pipeline state for chips / diagnostics /
  // (M5) prose-derivation, carrying opaque graph-hash digests that have no
  // business in the prompt and must never reach prose (behaviour-10 leak
  // contract). The LLM continues to see freshness via `display_analysis`.
  const {
    analysis: _rawAnalysis,
    display_analysis,
    graph: _rawGraph,
    display_graph,
    analysis_state: _analysisState,
    ...rest
  } = contextPack;
  void _rawAnalysis;
  void _rawGraph;
  void _analysisState;
  const llmFacing = { ...rest, analysis: display_analysis, graph: display_graph };
  const parts: string[] = ['## ContextPack', JSON.stringify(llmFacing, null, 2)];
  // Coaching Context Pack v1 (CEE_COACHING_CONTEXT_PROMPT_ENABLED): a narrow,
  // additive receive-vs-author instruction, appended ONLY when the deterministic
  // `coaching_context` pack was injected (flag on). Flag-off → the field is
  // absent → this block is skipped → the serialised prompt is byte-identical to
  // today. The instruction is soft guidance; the hard guarantee is the
  // deterministic post-check in the turn-executor coaching branches.
  if (contextPack.coaching_context) {
    parts.push('', COACHING_CONTEXT_INSTRUCTION);
  }
  parts.push('', '## User turn', message);
  return parts.join('\n');
}

/**
 * Narrow receive-vs-author instruction for Coaching Context Pack v1. British
 * English. Expresses: use the supplied deterministic state as the source of
 * truth; if the analysis is not current/usable, caveat + suggest re-running
 * rather than giving confident advice; never invent freshness / confidence /
 * evidence / values / units / mutation / science; never quote internal fields.
 */
const COACHING_CONTEXT_INSTRUCTION = [
  '## Coaching state (deterministic — authoritative)',
  'The `coaching_context` block above is the system’s verified state of the analysis. Treat it as the source of truth and express it in plain language; do not restate its field names or contradict it.',
  '- If `freshness` is not "fresh", or `rerun_required` is true, or `usable_for_chips` is false, or `blocked` is true: do not present the results as current, and do not recommend one option over another. Say the analysis may be out of date and suggest re-running it before giving confident advice.',
  '- Never invent freshness, confidence, evidence, provenance, scientific or bias claims, numeric values or units, and never claim a change was applied. State only what the supplied context or analysis already contains.',
  '- Never quote hashes, identifiers, or internal field names.',
].join('\n');

// -----------------------------------------------------------------------
// Adapter error → RoutingError
// -----------------------------------------------------------------------

function translateAdapterError(err: unknown, llmCallCount: number): RoutingError {
  if (err instanceof UpstreamTimeoutError) {
    return new RoutingError('timeout', `Routing call timed out: ${err.message}`, { llmCallCount });
  }
  if (isAbortLikeError(err)) {
    return new RoutingError('aborted', 'Routing call aborted by caller signal', { llmCallCount });
  }
  if (err instanceof UpstreamHTTPError) {
    return new RoutingError('api_error', `Provider HTTP error during routing: ${err.message}`, {
      provider_message: err.message,
      status: err.status,
      llmCallCount,
    });
  }
  if (err instanceof Error) {
    return new RoutingError('api_error', `Unexpected error during routing: ${err.message}`, {
      llmCallCount,
    });
  }
  return new RoutingError('api_error', `Unexpected non-Error value during routing: ${String(err)}`, {
    llmCallCount,
  });
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

// -----------------------------------------------------------------------
// Default adapter resolution
// -----------------------------------------------------------------------

interface MinimalToolUseAdapter {
  chatWithTools: (
    args: ChatWithToolsArgs,
    opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
  ) => Promise<ChatWithToolsResult>;
}

/**
 * Resolve the adapter for V5 ORIENT (tool-use routing). Group 3 Task C:
 * uses `getAdapterWithResolution('orchestrator', ...)` so the precedence chain
 * (per_call → store_model_config → env_var CEE_MODEL_ORCHESTRATOR →
 * task_default gpt-4o → providers_json → llm_model_fallback) is honoured and
 * observable. The returned `resolution` is forwarded to turn-debug by the
 * caller. Prior to this fix the site called `getAdapter('direct_answer_narrate')`
 * — a non-CeeTask string that caused the router to short-circuit to
 * llm_model_fallback (observed as gpt-4o-mini on 20 April 2026 staging).
 */
function resolveRoutingAdapter(): {
  adapter: MinimalToolUseAdapter;
  resolution: ModelResolution;
} {
  const { adapter, resolution } = getAdapterWithResolution('orchestrator');
  if (!adapter.chatWithTools) {
    throw new RoutingError(
      'api_error',
      `Resolved adapter does not implement chatWithTools (task: orchestrator, resolved_model: ${resolution.resolved_model})`,
    );
  }
  return { adapter: adapter as unknown as MinimalToolUseAdapter, resolution };
}
