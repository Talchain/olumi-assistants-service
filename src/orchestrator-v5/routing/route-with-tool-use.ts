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

/**
 * ROADMAP 1.55(c) — retry-cap / timeout coherence.
 *
 * Measured Sonnet 5 output rate on staging (2026-07-08 evidence): ~114
 * output tokens/second. Under the shared per-call budget
 * (ORCHESTRATOR_TIMEOUT_MS, 30s default) only ~3,400 output tokens are
 * servable, so the 8192-token retry cap above was UNREACHABLE — a deep
 * truncation surfaced as LLM_TIMEOUT on the retry rather than a rescue or
 * the designed bounded-fallback.
 *
 * Fix: the max_tokens retry gets its OWN per-call timeout sized to its cap
 * (generation time for the full cap at the assumed rate, plus a
 * time-to-first-token / input-processing allowance). This was chosen over
 * lowering the retry cap to what 30s can serve (~3,400 ≈ the 3072 first
 * cap, which would gut #384's rescue intent) because the V5 turn budget
 * (TURN_BUDGET_MS, 180s default — budgets.ts) comfortably fits a truncated
 * first attempt (~30s) + a full retry window (~80s) with handler headroom.
 *
 * The arithmetic is pinned by route-with-tool-use-retry-budget.test.ts —
 * any model-speed, cap, or budget change re-fires those assertions.
 */
export const V5_ROUTING_ASSUMED_OUTPUT_TOKENS_PER_SEC = 114;

/** Allowance for time-to-first-token + input processing on the retry call. */
export const V5_ROUTING_RETRY_TTFT_ALLOWANCE_MS = 8_000;

/**
 * Per-call timeout for the single max_tokens retry: the time to generate the
 * full escalated cap at the assumed output rate, plus the TTFT allowance.
 * 8192 tok / 114 tok/s ≈ 71.9s + 8s ≈ 80s.
 */
export const V5_ROUTING_RETRY_TIMEOUT_MS =
  Math.ceil(
    (V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY / V5_ROUTING_ASSUMED_OUTPUT_TOKENS_PER_SEC) * 1000,
  ) + V5_ROUTING_RETRY_TTFT_ALLOWANCE_MS;
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ReplayThinkingBlock,
  SystemCacheBlock,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { recordModelResolution } from '../debug/turn-debug-store.js';
import { config } from '../../config/index.js';
import { TelemetryEvents, emit } from '../../utils/telemetry.js';

import type { ContextPack } from '../context/context-pack-assembler.js';

import {
  buildOlumiActionTool,
  buildForcedPillTool,
  OLUMI_ACTION_TOOL_NAME,
  ToolCallParseError,
  parseToolCallResponse,
  type ForcedPillHandlerId,
  type ParseTelemetryContext,
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

/**
 * POC-BOARD 5b — a render-safe summary of an `olumi_action` the model emitted
 * BEYOND the first in a single routing response (a compound / parallel tool
 * call, e.g. "set X to 70% AND set Y to 80%"). The downstream execute path can
 * apply only ONE action per turn (`proposal`), so these are the extra actions
 * it did NOT apply. Carried on the result so the turn can DISCLOSE the
 * un-applied ops honestly instead of `.find()`-dropping them silently.
 *
 * Best-effort: `handler_id`/`label` are populated when the extra tool_use block
 * parses as a valid execute proposal; an extra block that fails to parse still
 * counts (both fields null) so the disclosure never under-reports the drop.
 */
export interface DroppedRoutingAction {
  /** Handler id of the un-applied action, or null if it did not parse. */
  readonly handler_id: string | null;
  /** Entity label of the un-applied action, or null if absent / unparsed. */
  readonly label: string | null;
}

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
  /**
   * POC-BOARD 5b — additional `olumi_action` tool_use blocks the model emitted
   * in the SAME response beyond the applied `proposal`. Empty on the
   * overwhelming majority of turns (single action). Non-empty only when the
   * model returned a compound/parallel tool call; the turn executor reads this
   * to disclose the un-applied actions rather than dropping them silently.
   */
  readonly droppedActions: readonly DroppedRoutingAction[];
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
  replayThinkingBlocks?: readonly ReplayThinkingBlock[],
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [...originalMessages];

  // ROADMAP 1.55(b) — Anthropic's extended-thinking + tool-use protocol:
  // the assistant echo that carries the tool_use must START with the
  // complete, unmodified thinking block(s) from the original response, or
  // the repair call is rejected with 400 invalid_request_error. The blocks
  // are prepended VERBATIM (opaque signature intact) into the API-BOUND
  // message only — they never enter RoutingResult content, orientationText,
  // or any client-facing surface (guarded by
  // route-with-tool-use-thinking-replay.test.ts).
  const assistantEcho: Array<ToolResponseBlock | ReplayThinkingBlock> =
    replayThinkingBlocks && replayThinkingBlocks.length > 0
      ? [...replayThinkingBlocks, ...assistantContent]
      : assistantContent;

  messages.push({ role: 'assistant', content: assistantEcho });

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
  /**
   * F2 CHANGE A — FORCED explanation intent for a typed analytical pill
   * (`explain_results` / `what_would_flip`). Set by TurnExecutor when route-v2
   * detected a `source==='chip_click'` turn whose typed `chip.action_type` is
   * an explanation intent (`chipClickForcedIntent`). When present this call:
   *   1. DISABLES thinking on this routing turn (reuses the existing
   *      `{ thinking: { type: 'disabled' } }` mechanism — ~9s median vs ~26s —
   *      NOT a new flag; per-call, unconditional for the pill path), and
   *   2. FORCES the model to emit the `olumi_action` tool (`tool_choice: tool`),
   *      appends a forced-intent directive to the user turn, and
   *   3. PINS the resulting proposal's `handler_id` to this value at interpret
   *      time so the coach AUTHORS the answer (with full conversation sight)
   *      but CANNOT re-route the typed pill to a different handler.
   * The coach still sees the verbatim conversation window (it rides on the
   * ContextPack serialised by `buildUserMessage`), so the pill answer references
   * what the user just said; the deterministic explanation fallback stays in
   * place downstream when the authored `answer_text` is invalid.
   */
  readonly forcedExplanationHandlerId?: ForcedPillHandlerId;
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

  // F2 CHANGE A — forced explanation intent for a typed analytical pill. The
  // directive is APPENDED after the pure `buildUserMessage` output (kept pure so
  // the budget re-measurement and the byte-golden tests are unaffected) and only
  // when a forced handler is set, so every non-pill routing turn is byte-
  // identical to today.
  const forcedHandlerId = options.forcedExplanationHandlerId;
  const base = buildUserMessage(contextPack, message);
  const userMessage = forcedHandlerId
    ? `${base}\n\n${buildForcedIntentDirective(forcedHandlerId)}`
    : base;

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
    // Codex F3 — a FORCED analytical pill advertises the DEDICATED, constrained
    // tool (`buildForcedPillTool`): a single execute intent + the single pinned
    // handler enum, so the model is guided to author the answer inside an
    // execute envelope and cannot be advertised the coach/converse surfaces that
    // slipped past the pin. Same tool NAME, so the `tool_choice` force and the
    // downstream `toolUse.name` check are unchanged. Every non-pill turn keeps
    // the full `buildOlumiActionTool()` advert (`answer_shape` included —
    // ROADMAP 1.132, F2, F1 flag deletion). The hard bypass guarantee is the
    // assert-execute-after-parse (`enforceForcedExecute`) below.
    tools: [forcedHandlerId ? buildForcedPillTool(forcedHandlerId) : buildOlumiActionTool()],
    // F2 CHANGE A — a forced explanation pill FORCES the `olumi_action` tool so
    // the coach ALWAYS emits a structured proposal (with a graph-resolved entity
    // + authored `answer_text`) rather than free text; the handler_id is then
    // pinned at interpret time. Anthropic requires thinking OFF whenever
    // tool_choice forces a specific tool — satisfied below (the pill path always
    // disables thinking). Every non-pill turn keeps `{ type: 'auto' }`.
    tool_choice: forcedHandlerId
      ? { type: 'tool' as const, name: OLUMI_ACTION_TOOL_NAME }
      : { type: 'auto' as const },
    temperature: 0,
    maxTokens: V5_ROUTING_MAX_OUTPUT_TOKENS,
    // CEE_COACH_THINKING_DISABLED (POC-BOARD item 9) — latency lever. Flag OFF
    // OMITS `thinking` entirely (byte-identical to today: Sonnet 5 runs adaptive
    // thinking on this call, ~26s median). Flag ON sends {type:'disabled'} to
    // suppress adaptive thinking on the coach/routing turn ONLY (~9s median in
    // the N=5 staging spike). This spread propagates to the max_tokens-retry and
    // REPAIR_ONCE calls, which reuse firstCallArgs. Enablement is Paul-gated
    // behind the coaching-quality verdict — see the flag's config/index.ts note.
    //
    // F2 CHANGE A — a forced explanation pill ALSO disables thinking on this
    // path unconditionally (reuses the SAME mechanism, not a new flag): the pill
    // needs the ~9s latency and forced tool_choice is incompatible with adaptive
    // thinking. OR-ed with the global lever so either route disables it.
    ...(config.features.coachThinkingDisabled || forcedHandlerId
      ? { thinking: { type: 'disabled' as const } }
      : {}),
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
          // ROADMAP 1.55(c): the escalated 8192 cap needs ~72s of generation
          // at the assumed output rate — an escalated per-call timeout to
          // match, or the cap is unreachable and deep truncations become
          // LLM_TIMEOUT. Never shrink a larger caller-supplied budget.
          timeoutMs: Math.max(timeoutMs, V5_ROUTING_RETRY_TIMEOUT_MS),
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

  const parseTelemetry: ParseTelemetryContext = {
    requestId: options.requestId,
    sessionId: options.sessionId ?? null,
    llmCall: 1,
    // Thread the forced-pill signal to the coercion site so class (e) (the
    // missing/invalid-type intent_class default) fires on forced turns only.
    // repairTelemetry below spreads this, so it carries to the repair pass too.
    ...(forcedHandlerId ? { forcedHandlerId } : {}),
  };
  // Codex F3 — assert-execute-after-parse: a forced-pill result that is not an
  // execute tool_call is downgraded to `parse_failed` here so the REPAIR_ONCE
  // path below (and, failing that, the terminal schema_repair_failed) closes the
  // coach/converse bypass hole. No-op on non-pill turns.
  const parsedOrError = enforceForcedExecute(
    tryInterpret(firstResult, llmCallsUsed, parseTelemetry),
    forcedHandlerId,
    parseTelemetry,
  );
  if (parsedOrError.kind === 'ok')
    return applyForcedExplanationHandler(parsedOrError.result, forcedHandlerId);
  if (parsedOrError.kind === 'non_repairable') throw parsedOrError.error;

  // REPAIR_ONCE — parse failed. Build protocol-compliant retry messages
  // with tool_result blocks matching every tool_use in the assistant response.
  const repairMessages = buildRepairMessages(
    firstCallArgs.messages,
    firstResult.content,
    parsedOrError.detail,
    firstResult.replay_thinking_blocks,
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

  const repairTelemetry: ParseTelemetryContext = { ...parseTelemetry, llmCall: 2 };
  const secondAttempt = enforceForcedExecute(
    tryInterpret(repairResult, llmCallsUsed + 1, repairTelemetry),
    forcedHandlerId,
    repairTelemetry,
  );
  if (secondAttempt.kind === 'ok')
    return applyForcedExplanationHandler(secondAttempt.result, forcedHandlerId);
  throw new RoutingError(
    'schema_repair_failed',
    `Routing tool-call repair attempt failed: ${secondAttempt.kind === 'non_repairable' ? secondAttempt.error.message : secondAttempt.detail}`,
    { llmCallCount: llmCallsUsed + 1 },
  );
}

// -----------------------------------------------------------------------
// Interpreting a ChatWithToolsResult
// -----------------------------------------------------------------------

/**
 * A sanitised routing validation issue for attributability logging (Codex F3,
 * R-004): the Zod issue `code` + dotted `path` ONLY — never the message text
 * (which can echo model-authored fragments) and never any value.
 */
interface SanitisedRoutingIssue {
  readonly code: string;
  readonly path: string;
  /**
   * For `unrecognized_keys` issues only: the offending top-level key NAMES.
   * A key name is a structural schema identifier — R-004-safe (never a value)
   * — so any FUTURE un-coerced stray-top-level-key class SELF-NAMES in the
   * `forced_pill_parse_failed` log instead of leaving only `code @ ""`. Absent
   * for every other issue code.
   */
  readonly keys?: readonly string[];
}

type Interpretation =
  | { kind: 'ok'; result: RoutingResult }
  | { kind: 'parse_failed'; detail: string; issues?: readonly SanitisedRoutingIssue[] }
  | { kind: 'non_repairable'; error: RoutingError };

/**
 * POC-BOARD 5b — render-safe summary of an EXTRA `olumi_action` tool_use block
 * (one the model emitted beyond the applied first action). Best-effort: a block
 * that parses as an execute proposal yields its handler_id + entity label; a
 * block with the wrong tool name or malformed input still returns an entry
 * (both fields null) so the count of dropped actions is never under-reported.
 */
function summariseDroppedAction(
  block: Extract<ToolResponseBlock, { type: 'tool_use' }>,
): DroppedRoutingAction {
  if (block.name === OLUMI_ACTION_TOOL_NAME) {
    try {
      const parsed = parseToolCallResponse(block.input);
      if (parsed.intent_class === 'execute') {
        return {
          handler_id: parsed.action.handler_id,
          label: parsed.action.entity.label ?? null,
        };
      }
    } catch {
      // Best-effort — an unparseable extra block still COUNTS as a dropped
      // action (both fields null); it must never be silently omitted.
    }
  }
  return { handler_id: null, label: null };
}

function tryInterpret(
  result: ChatWithToolsResult,
  llmCallCount: number,
  telemetry?: ParseTelemetryContext,
): Interpretation {
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

  // POC-BOARD 5b — capture ALL tool_use blocks, not just the first. The
  // downstream execute path applies exactly one action per turn (`proposal`),
  // so `toolUse` (block[0]) stays the applied action — but any extra blocks the
  // model emitted in the SAME response (a compound/parallel tool call, e.g.
  // "set X to 70% AND set Y to 80%") are surfaced on `droppedActions` for
  // honest disclosure. Previously `result.content.find(...)` picked block[0]
  // and the rest were dropped SILENTLY (the CONFIRMED-LIVE honesty defect).
  const toolUseBlocks = result.content.filter(
    (b): b is Extract<ToolResponseBlock, { type: 'tool_use' }> => b.type === 'tool_use',
  );
  const toolUse = toolUseBlocks[0];
  const textBlocks = result.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text');
  const joinedText = textBlocks.map((b) => b.text).join('\n').trim();

  if (toolUse) {
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
      const proposal = parseToolCallResponse(toolUse.input, telemetry);
      return {
        kind: 'ok',
        result: {
          type: 'tool_call',
          proposal,
          orientationText: joinedText,
          rawResult: result,
          llmCallCount,
          droppedActions: toolUseBlocks.slice(1).map(summariseDroppedAction),
        },
      };
    } catch (err) {
      const detail = err instanceof ToolCallParseError ? err.message : String(err);
      // Codex F3 — carry the sanitised {code, path} of every Zod issue (no
      // message, no value — R-004) so a residual forced-pill repair is
      // attributable from logs. Populated only for ToolCallParseError (the
      // schema-violation path); a non-Zod throw has no issues.
      const issues: SanitisedRoutingIssue[] | undefined =
        err instanceof ToolCallParseError
          ? err.issues.map((issue) => {
              const base: SanitisedRoutingIssue = {
                code: String(issue.code),
                path: issue.path.join('.'),
              };
              // Companion (repair-tax fourth-class PR): carry the offending key
              // NAMES for a root/nested `unrecognized_keys` issue (structural,
              // R-004-safe) so a future un-coerced stray-key class self-names.
              if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
                return { ...base, keys: issue.keys };
              }
              return base;
            })
          : undefined;
      return { kind: 'parse_failed', detail, ...(issues ? { issues } : {}) };
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

/**
 * Codex F3 — assert-execute-after-parse for a FORCED analytical pill.
 *
 * THE HOLE the review proved at the bytes: a schema-valid coach/converse tool
 * call PARSES fine, then `applyForcedExplanationHandler` returns it UNCHANGED (it
 * only pins an *execute* proposal), so a forced pill could silently emit a
 * coaching/conversational turn — the declared "guarantee" bypassed. This guard
 * FAILS LOUD: any forced-pill interpretation that is not an execute tool_call is
 * downgraded to `parse_failed`, so the caller's EXISTING machinery takes over —
 * REPAIR_ONCE on the first attempt, then a terminal `schema_repair_failed` if the
 * repair also strays. A non-execute intent is therefore never served.
 *
 * No-op for every non-pill turn (`forcedHandlerId` undefined); once the result IS
 * an execute tool_call it is a byte-identical passthrough (the downstream pin +
 * side-band are unchanged, so parity with the current forced path holds). Emits
 * `V5RoutingForcedPillOutcome` once per attempt (first-pass-valid rate is
 * measurable) and logs the sanitised issue {code,path} of a strayed/failed result
 * for attributability. No user text on either surface (R-004).
 */
function enforceForcedExecute(
  interp: Interpretation,
  forcedHandlerId: ForcedPillHandlerId | undefined,
  telemetry: ParseTelemetryContext,
): Interpretation {
  if (forcedHandlerId === undefined) return interp;

  // A schema failure (or hard interpreter error) is left for the caller's
  // existing repair / bounded-fallback paths; log the sanitised issues so any
  // residual forced-pill repair is attributable.
  if (interp.kind === 'parse_failed') {
    log.warn(
      {
        event: 'v5.routing.forced_pill_parse_failed',
        request_id: telemetry.requestId,
        v5_journey_id: telemetry.sessionId,
        forced_handler_id: forcedHandlerId,
        llm_call: telemetry.llmCall,
        issues: interp.issues ?? [],
      },
      'V5 forced-pill routing call failed schema — repair / bounded fallback will handle',
    );
    return interp;
  }
  if (interp.kind !== 'ok') return interp;

  const result = interp.result;
  const isForcedExecute =
    result.type === 'tool_call' && result.proposal.intent_class === 'execute';
  const returnedIntent =
    result.type === 'tool_call' ? result.proposal.intent_class : 'text_only';

  emit(TelemetryEvents.V5RoutingForcedPillOutcome, {
    request_id: telemetry.requestId,
    turn_id: telemetry.requestId,
    v5_journey_id: telemetry.sessionId,
    scenario_id: telemetry.sessionId,
    llm_call: telemetry.llmCall,
    forced_handler_id: forcedHandlerId,
    returned_intent: returnedIntent,
    first_pass_execute: isForcedExecute,
  });

  if (isForcedExecute) return interp;

  // The bypass: a schema-valid non-execute slipped past the parser. Fail loud by
  // downgrading to `parse_failed` so REPAIR_ONCE (attempt 1) or the terminal
  // schema_repair_failed (attempt 2) fires — never a silently-served coach turn.
  // The detail is a generic re-emit instruction, no user text.
  log.warn(
    {
      event: 'v5.routing.forced_pill_bypass_blocked',
      request_id: telemetry.requestId,
      v5_journey_id: telemetry.sessionId,
      forced_handler_id: forcedHandlerId,
      llm_call: telemetry.llmCall,
      returned_intent: returnedIntent,
    },
    'V5 forced-pill routing returned a non-execute intent — blocking the bypass',
  );
  return {
    kind: 'parse_failed',
    detail:
      'Forced analytical pill must route as intent_class "execute" with handler ' +
      `"${forcedHandlerId}", but the model returned "${returnedIntent}". Re-emit an ` +
      'execute olumi_action proposal with your answer in action.explanation.answer_text.',
  };
}

// -----------------------------------------------------------------------
// User message construction — ContextPack serialised for Sonnet
// -----------------------------------------------------------------------

// Exported for Context-v2 S0 budget measurement (turn-executor): the routing
// call site measures the EXACT embedded prompt bytes by re-running this pure
// builder, rather than approximating over a compact pack serialisation.
export function buildUserMessage(contextPack: ContextPack, message: string): string {
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
    conversation_summary,
    ...rest
  } = contextPack;
  void _rawAnalysis;
  void _rawGraph;
  void _analysisState;
  // Context v2 S4-INJECT (01 §2, 04 §3.1): the rolling-summary section is
  // re-appended AFTER the ground-truth `analysis`/`graph` substitutions so
  // the serialised prompt reads it BELOW structured state — Layer-A
  // projections above the summary, precedence by placement AND by the
  // instruction block below. Key absent (conversation fits the verbatim
  // window, or no stored summary) → spread contributes nothing →
  // byte-identity with pre-S4 output (pinned by
  // tests/unit/v5.route-with-tool-use.conversation-summary.test.ts against
  // a pre-change sha256 golden).
  const llmFacing = {
    ...rest,
    analysis: display_analysis,
    graph: display_graph,
    ...(conversation_summary !== undefined ? { conversation_summary } : {}),
  };
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
  // Context v2 S4-INJECT [R2]: the facts-beat-summary precedence instruction
  // — CODE-OWNED (not PMS-served), a sibling of COACHING_CONTEXT_INSTRUCTION
  // appended the same way, gated by the same condition that put the section
  // on the pack (the turn-executor loader's beyond-window activation).
  // Absent section → no instruction → byte-identity.
  if (conversation_summary !== undefined) {
    parts.push('', SUMMARY_PRECEDENCE_INSTRUCTION);
  }
  parts.push('', '## User turn', message);
  return parts.join('\n');
}

// -----------------------------------------------------------------------
// F2 CHANGE A — forced explanation intent (typed analytical pill)
// -----------------------------------------------------------------------

/**
 * Human-readable label for a forced explanation handler, used only inside the
 * forced-intent directive prose (never a wire value).
 */
const FORCED_INTENT_QUESTION: Record<'explain_results' | 'what_would_flip', string> = {
  explain_results: 'explain the current analysis results',
  what_would_flip: 'explain what would change (flip) the current analysis result',
};

/**
 * Directive appended to the user turn when a typed analytical pill forces the
 * intent. It tells the coach WHICH question the user clicked (so its authored
 * `answer_text` addresses that specific question, grounded in the conversation
 * window + analysis already in the ContextPack above) and to route via the
 * matching handler. The hard guarantee is the interpret-time handler_id pin in
 * {@link applyForcedExplanationHandler}; this directive keeps the AUTHORED prose
 * on-topic. British English, no internal field names leaked to the model.
 */
export function buildForcedIntentDirective(
  handlerId: 'explain_results' | 'what_would_flip',
): string {
  return [
    '## Requested action (explicit)',
    `The user clicked a button to ${FORCED_INTENT_QUESTION[handlerId]}. Answer THAT specific question directly, using the conversation above and the analysis context. Call the olumi_action tool with handler_id "${handlerId}" and put your complete, plain-language answer in the explanation.answer_text field.`,
  ].join('\n');
}

/**
 * F2 CHANGE A — PIN the routed proposal to the typed pill intent. When a pill
 * forced the intent, the coach authored the prose (with conversation sight) but
 * must NOT be free to re-route the typed pill to a different handler. We take
 * the model's real, graph-resolved execute proposal and override ONLY its
 * `handler_id` to the forced value, preserving the model's `entity` (so
 * downstream validation still checks a real target) and its authored
 * `explanation`. If the model omitted `explanation` (bare tool_use), we lift the
 * orientation text into `answer_text` so the side-band validator can judge it;
 * an empty result falls through unchanged and the deterministic explanation
 * fallback serves the user (honesty guarantee intact).
 *
 * No-op for every non-pill turn (`forcedHandlerId` undefined) and for any result
 * that is not an execute tool_call — byte-identical to today on those paths.
 */
export function applyForcedExplanationHandler(
  result: RoutingResult,
  forcedHandlerId: 'explain_results' | 'what_would_flip' | undefined,
): RoutingResult {
  if (forcedHandlerId === undefined) return result;
  if (result.type !== 'tool_call') return result;
  if (result.proposal.intent_class !== 'execute') return result;
  const action = result.proposal.action;
  if (action.handler_id === forcedHandlerId && action.explanation !== undefined) {
    return result;
  }
  const authored = action.explanation?.answer_text ?? result.orientationText;
  const explanation =
    authored.trim().length > 0
      ? { ...(action.explanation ?? {}), answer_text: authored }
      : action.explanation;
  return {
    ...result,
    proposal: {
      ...result.proposal,
      action: {
        ...action,
        handler_id: forcedHandlerId,
        ...(explanation !== undefined ? { explanation } : {}),
      },
    },
  };
}

/**
 * Narrow receive-vs-author instruction for Coaching Context Pack v1. British
 * English. Expresses: use the supplied deterministic state as the source of
 * truth; if the analysis is not current/usable, caveat + suggest re-running
 * rather than giving confident advice; never invent freshness / confidence /
 * evidence / values / units / mutation / science; never quote internal fields.
 */
export const COACHING_CONTEXT_INSTRUCTION = [
  '## Coaching state (deterministic — authoritative)',
  'The `coaching_context` block above is the system’s verified state of the analysis. Treat it as the source of truth and express it in plain language; do not restate its field names or contradict it.',
  // Pre-analysis honesty (review r2): when `freshness` is "none" NO analysis has
  // ever run, so telling the user the results "may be out of date" or to
  // "re-run" is a FALSE claim (there is nothing to re-run). Say plainly that no
  // analysis has been run yet. The "don't recommend one option over another
  // before analysis" stance is retained here deliberately (a phase-② design
  // question, out of scope for this fix).
  '- If `freshness` is "none": no analysis has been run yet — say so plainly, and do not recommend one option over another as though a result already existed.',
  '- Otherwise, if `freshness` is not "fresh", or `rerun_required` is true, or `usable_for_chips` is false, or `blocked` is true: do not present the results as current, and do not recommend one option over another. Say the analysis may be out of date and suggest re-running it before giving confident advice.',
  '- Never invent freshness, confidence, evidence, provenance, scientific or bias claims, numeric values or units, and never claim a change was applied. State only what the supplied context or analysis already contains.',
  '- Never quote hashes, identifiers, or internal field names.',
].join('\n');

/**
 * Context v2 S4-INJECT [R2] — the facts-beat-summary precedence rule
 * (design pack 04 §3.1), CODE-OWNED at this locus by decision of record:
 * a hard-coded sibling of {@link COACHING_CONTEXT_INSTRUCTION}, appended to
 * the routing user message only when the `conversation_summary` section is
 * on the pack (beyond-window activation, O-2). It does NOT ride the
 * PMS-served orchestrator prompt — no estate coordination required.
 * British English. The load-bearing sentence ("the structured state is
 * correct") is the pack's wording verbatim. Exported for the byte-level
 * serialisation tests.
 */
export const SUMMARY_PRECEDENCE_INSTRUCTION = [
  '## Conversation summary (working notes — structured state wins)',
  'The `conversation_summary` block above is a rolling summary of the conversation so far — treat it as quoted working notes, not assertions.',
  '- If the summary and the structured state disagree (graph, analysis, recent_changes, or the verbatim conversation turns), the structured state is correct.',
  '- Treat CONSTRAINTS & PREFERENCES and OPEN entries as the user’s standing context; do not relitigate RESOLVED threads unless the user reopens them.',
  '- Never echo the [t:…] provenance stamps, turn identifiers, or the slot labels into user-facing text.',
  '- If the summary carries a staleness note, prefer the verbatim conversation turns for anything recent.',
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
