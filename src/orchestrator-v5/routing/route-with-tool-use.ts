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

import { getAdapter } from '../../adapters/llm/router.js';
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
  constructor(cause: RoutingErrorCause, message: string, opts?: { provider_message?: string }) {
    super(message);
    this.name = 'RoutingError';
    this.cause = cause;
    this.provider_message = opts?.provider_message;
  }
}

// -----------------------------------------------------------------------
// System prompt — routing instructions only
// -----------------------------------------------------------------------

/**
 * Minimal routing system prompt. Intentionally narrow: this module is the
 * routing spine, not the full orchestrator. The production orchestrator
 * prompt is authored separately (spec v2 §4 — Claude drafts).
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
  /** External abort signal (turn budget). */
  readonly signal?: AbortSignal;
  /** Injected adapter — tests pass a mock; production resolves via router. */
  readonly adapter?: {
    chatWithTools: (
      args: ChatWithToolsArgs,
      opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
    ) => Promise<ChatWithToolsResult>;
  };
}

export async function routeWithToolUse(
  contextPack: ContextPack,
  message: string,
  options: RouteWithToolUseOptions,
): Promise<RoutingResult> {
  const adapter = options.adapter ?? resolveDefaultAdapter();
  const timeoutMs = options.timeoutMs ?? ORCHESTRATOR_TIMEOUT_MS;

  const userMessage = buildUserMessage(contextPack, message);

  const firstCallArgs: ChatWithToolsArgs = {
    system: ROUTING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: [OLUMI_ACTION_TOOL],
    tool_choice: { type: 'auto' },
    temperature: 0,
  };

  let firstResult: ChatWithToolsResult;
  try {
    firstResult = await adapter.chatWithTools(firstCallArgs, {
      requestId: options.requestId,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    throw translateAdapterError(err);
  }

  const parsedOrError = tryInterpret(firstResult, 1);
  if (parsedOrError.kind === 'ok') return parsedOrError.result;
  if (parsedOrError.kind === 'non_repairable') throw parsedOrError.error;

  // REPAIR_ONCE — parse failed. Ask Sonnet to re-emit with structured
  // error feedback; if it fails again, abort.
  const repairArgs: ChatWithToolsArgs = {
    ...firstCallArgs,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: firstResult.content as ToolResponseBlock[] },
      {
        role: 'user',
        content:
          `Your previous olumi_action tool call failed schema validation: ` +
          `${parsedOrError.detail}. Emit one more attempt that strictly matches the tool's input_schema.`,
      },
    ],
  };

  let repairResult: ChatWithToolsResult;
  try {
    repairResult = await adapter.chatWithTools(repairArgs, {
      requestId: options.requestId,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    throw translateAdapterError(err);
  }

  const secondAttempt = tryInterpret(repairResult, 2);
  if (secondAttempt.kind === 'ok') return secondAttempt.result;
  throw new RoutingError(
    'schema_repair_failed',
    `Routing tool-call repair attempt failed: ${secondAttempt.kind === 'non_repairable' ? secondAttempt.error.message : secondAttempt.detail}`,
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
      error: new RoutingError('empty_response', 'Sonnet returned neither tool call nor text'),
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

function translateAdapterError(err: unknown): RoutingError {
  if (err instanceof UpstreamTimeoutError) {
    return new RoutingError('timeout', `Routing call timed out: ${err.message}`);
  }
  if (isAbortLikeError(err)) {
    return new RoutingError('aborted', 'Routing call aborted by caller signal');
  }
  if (err instanceof UpstreamHTTPError) {
    return new RoutingError('api_error', `Provider HTTP error during routing: ${err.message}`, {
      provider_message: err.message,
    });
  }
  if (err instanceof Error) {
    return new RoutingError('api_error', `Unexpected error during routing: ${err.message}`);
  }
  return new RoutingError('api_error', `Unexpected non-Error value during routing: ${String(err)}`);
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

function resolveDefaultAdapter(): MinimalToolUseAdapter {
  // 'direct_answer_narrate' is the established V5 narrate task id — same
  // routing key the replaced classifier used. The adapter must expose
  // chatWithTools; Anthropic does, fixtures may not. Fixtures/E2E paths
  // need to pass an explicit adapter override.
  const adapter = getAdapter('direct_answer_narrate');
  if (!adapter.chatWithTools) {
    throw new RoutingError(
      'api_error',
      `Resolved adapter does not implement chatWithTools (task: direct_answer_narrate)`,
    );
  }
  return adapter as unknown as MinimalToolUseAdapter;
}
