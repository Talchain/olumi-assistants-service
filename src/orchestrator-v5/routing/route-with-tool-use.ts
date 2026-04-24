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
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { recordModelResolution } from '../debug/turn-debug-store.js';

import type { ContextPack } from '../context/context-pack-assembler.js';

import {
  OLUMI_ACTION_TOOL,
  OLUMI_ACTION_TOOL_NAME,
  ToolCallParseError,
  parseToolCallResponse,
  type ToolCallResponse,
} from './tool-schema.js';

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
 * Intentionally narrow in its current form: this module is the routing
 * spine, not the full orchestrator.
 */
export const ROUTING_SYSTEM_PROMPT = `You are Olumi's routing layer. You receive a ContextPack and a user turn. \
Your single job is to decide the intent:

- Call the olumi_action tool with intent_class="execute" when an action is needed.
- Call the olumi_action tool with intent_class="clarify" when the turn is ambiguous and you cannot safely act.
- Respond with plain text (no tool call) for conversational turns.
- Call the olumi_action tool with intent_class="coach" to mark the turn as coaching — the user-facing text you emit alongside is the coaching response.

Rules:
- When calling the tool on execute turns, you may accompany it with SHORT pre-action orientation text (context, not outcomes). Never narrate results you have not seen.
- When resolving entities, cite which ContextPack fields you used in cited_context_fields.
- When the user's request is ambiguous (entity, parameter, intent, scope, or missing context), prefer clarify over a guessed execute.
- Do not invent entities or parameters not present in the ContextPack.`;

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

  const firstCallArgs: ChatWithToolsArgs = {
    system: options.systemPromptOverride ?? ROUTING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: [OLUMI_ACTION_TOOL],
    tool_choice: { type: 'auto' },
    temperature: 0,
  };

  assertAnthropicMessageProtocol(firstCallArgs.messages);

  let firstResult: ChatWithToolsResult;
  try {
    firstResult = await adapter.chatWithTools(firstCallArgs, {
      requestId: options.requestId,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    throw translateAdapterError(err, 1);
  }

  const parsedOrError = tryInterpret(firstResult, 1);
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

  let repairResult: ChatWithToolsResult;
  try {
    repairResult = await adapter.chatWithTools(repairArgs, {
      requestId: options.requestId,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    throw translateAdapterError(err, 2);
  }

  const secondAttempt = tryInterpret(repairResult, 2);
  if (secondAttempt.kind === 'ok') return secondAttempt.result;
  throw new RoutingError(
    'schema_repair_failed',
    `Routing tool-call repair attempt failed: ${secondAttempt.kind === 'non_repairable' ? secondAttempt.error.message : secondAttempt.detail}`,
    { llmCallCount: 2 },
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
  return [
    '## ContextPack',
    JSON.stringify(contextPack, null, 2),
    '',
    '## User turn',
    message,
  ].join('\n');
}

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
