/**
 * V5 TurnExecutor dispatch (A2 + C1).
 *
 * A1 dispatched `direct_answer` exclusively. A2 added `clarify`. C1 adds
 * `handler`: every handler turn routes through a registry, and a registry
 * miss raises `UnhandledTurnClassError(reason='handler_not_registered')`.
 * Slice C1 ships with an empty registry by design; Slice C2 will register
 * `run_analysis` as the first real entry.
 *
 * Order of operations (C1):
 *   1. Extract latest user message from TurnContext.
 *   2. classifyTurn(...) → { turn_class: C1TurnClass, handler_id?: V5ActionType }
 *   3. Branch:
 *        direct_answer → inline narrate (direct_answer_narrate)
 *        clarify       → delegated to `dispatchClarify` in ./clarify.js
 *        handler       → resolveHandler(registry, handler_id)
 *                         miss → throw UnhandledTurnClassError
 *                         hit  → invoke HandlerFn with HandlerInvocation (C2+)
 *   4. Sanitise narrate output (shared for A2 branches; handler branch returns
 *      HandlerOutcome unchanged — handler owns its own sanitisation).
 *   5. Return DispatchResult — either an A2 {sanitised} result or a handler
 *      {handler_outcome} result; turn-executor's compose stage selects the
 *      right composer based on `turn_class`.
 *
 * `llm_calls_used` = 2 on A2 success (classifier + narrate). For handler
 * turns: classifier (1) + whatever the handler's `HandlerOutcome.llm_calls_used`
 * reports. Handlers MAY make 0+ LLM calls (set_factor_value is deterministic,
 * run_analysis makes 1+, explain_result makes 1).
 */

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { TurnContext, V5ActionType } from '@talchain/schemas/orchestrator';

import {
  invokeNarrate,
  NarrateEmptyOutputError,
} from './llm-adapter.js';
import { getSystemPrompt } from '../adapters/llm/prompt-loader.js';
import { sanitiseNarrateOutput, type SanitiseResult } from './sanitise.js';
import { classifyTurn } from './classify.js';
import { dispatchClarify } from './clarify.js';
import {
  EMPTY_HANDLER_REGISTRY,
  resolveHandler,
  type HandlerOutcome,
  type HandlerRegistry,
} from './tools/registry.js';
import { type C1TurnClass, UnhandledTurnClassError } from './types.js';

// Re-export UnhandledTurnClassError at the dispatch seam for callers that
// previously imported it here. Canonical definition is in types.ts so
// classify.ts can throw it without a circular import.
export { UnhandledTurnClassError } from './types.js';

/**
 * Discriminated union on `turn_class`. A2 branches carry `sanitised`
 * (narrate output post-sanitiser); the handler branch carries
 * `handler_outcome` (HandlerOutcome as produced by the registered HandlerFn).
 * Narrowing via `if (result.turn_class === 'handler')` gives callers the
 * correct shape without optional-field undefined gymnastics.
 *
 * C1 ships only the A2 variants in practice — the handler variant is
 * unreachable at runtime because the empty registry makes dispatchHandler
 * throw before producing one. The type is still defined so C2 can wire in
 * `run_analysis` against a stable shape.
 */
export type DispatchResult =
  | {
      turn_class: 'direct_answer' | 'clarify';
      sanitised: SanitiseResult;
      llm_calls_used: number;
      raw_text_length: number;
    }
  | {
      turn_class: 'handler';
      handler_id: V5ActionType;
      handler_outcome: HandlerOutcome;
      llm_calls_used: number;
      raw_text_length: number;
    };

export interface DispatchOpts {
  signal?: AbortSignal;
  /**
   * Fires once the classifier resolves the turn class, before the handler
   * (direct_answer inline / clarify delegated / handler-class dispatched) is
   * invoked. Lets TurnExecutor record the resolved class and increment
   * `llm_calls_used` to 1 so that failure-path telemetry is correct even when
   * the downstream stage later throws. For handler turns the callback also
   * receives the resolved `handler_id`.
   */
  onClassified?: (turnClass: C1TurnClass, handlerId?: V5ActionType) => void;
  /**
   * Registry override for tests. Production callers leave this undefined;
   * dispatch resolves against `EMPTY_HANDLER_REGISTRY` (Slice C1 default).
   * Tests pass a hand-built `HandlerRegistry` to exercise the hit path.
   */
  registry?: HandlerRegistry;
  /**
   * Original ingress payload, needed by the handler invocation construct.
   * Optional to preserve compatibility with the A2 call sites that don't
   * dispatch handler turns; required when a handler turn is expected.
   */
  payload?: OrchestratorTurnPayload;
}

/**
 * Classify the turn, then dispatch to the matching handler. Returns a single
 * uniform DispatchResult regardless of branch taken. Throws:
 *   - NarrateTimeoutError          (upstream timeout on classify OR narrate;
 *                                   carries `phase: 'classify' | 'narrate'`)
 *   - ClassifierSchemaViolationError (malformed classifier output: invalid
 *                                   JSON, missing key, wrong type, extras)
 *   - UnhandledTurnClassError      (well-formed classifier output whose
 *                                   turn_class is outside A2TurnClass — P0)
 *   - NarrateEmptyOutputError      (narrate returned nothing)
 *   - any other Error              → TurnExecutor maps to UNHANDLED
 */
export async function dispatch(
  context: TurnContext,
  opts?: DispatchOpts,
): Promise<DispatchResult> {
  const userMessage = findLatestUserMessage(context);

  const classified = await classifyTurn(
    {
      user_message: userMessage,
      request_id: context.request_id,
      budget_ms: context.budgets.llm_narrate_ms,
    },
    { signal: opts?.signal },
  );
  const { turn_class, handler_id } = classified;
  opts?.onClassified?.(turn_class, handler_id);

  if (turn_class === 'direct_answer') {
    const answered = await dispatchDirectAnswer(context, opts);
    return {
      turn_class: 'direct_answer',
      sanitised: answered.sanitised,
      llm_calls_used: 1 + answered.llm_calls_used, // classifier + narrate
      raw_text_length: answered.raw_text_length,
    };
  }
  if (turn_class === 'clarify') {
    const clarified = await dispatchClarify(context, opts);
    return {
      turn_class: 'clarify',
      sanitised: clarified.sanitised,
      llm_calls_used: 1 + clarified.llm_calls_used, // classifier + narrate
      raw_text_length: clarified.raw_text_length,
    };
  }
  if (turn_class === 'handler') {
    // classifier guarantees handler_id when turn_class === 'handler' — the
    // biconditional schema refinement enforces it, and the V5ActionType
    // semantic check rejects anything outside the 7 literals.
    // The non-null assertion is safe here; TS cannot infer it from the
    // runtime guard in classify.ts.
    const resolvedHandlerId = handler_id!;
    const outcome = await dispatchHandler(context, resolvedHandlerId, opts);
    return {
      turn_class: 'handler',
      handler_id: resolvedHandlerId,
      handler_outcome: outcome,
      llm_calls_used: 1 + outcome.llm_calls_used,
      raw_text_length: outcome.assistant_text.length,
    };
  }

  // Defensive: `classifyTurn` narrows to the C1TurnClass union (it throws
  // UnhandledTurnClassError inside classify.ts for unsupported values), so
  // this branch is type-unreachable. Kept as a runtime tripwire in case the
  // classifier narrowing is weakened without updating this switch.
  throw new UnhandledTurnClassError('unhandled_turn_class', turn_class as unknown as string);
}

/**
 * Resolve and invoke the registered handler for `handler_id`. Slice C1 ships
 * with an empty registry by default — every call reaches the `resolved===null`
 * branch and throws `UnhandledTurnClassError(reason='handler_not_registered')`.
 * TurnExecutor's existing UNHANDLED catch maps that to INTERNAL_ERROR on the
 * wire, preserving BI-01.
 *
 * Tests pass a populated registry via `opts.registry` to exercise the hit
 * path; Slice C2+ production wire-in will replace `EMPTY_HANDLER_REGISTRY`
 * with a statically-initialised Map containing real handlers.
 */
async function dispatchHandler(
  context: TurnContext,
  handlerId: V5ActionType,
  opts?: DispatchOpts,
): Promise<HandlerOutcome> {
  const registry = opts?.registry ?? EMPTY_HANDLER_REGISTRY;
  const handler = resolveHandler(registry, handlerId);
  if (!handler) {
    throw new UnhandledTurnClassError('handler_not_registered', handlerId);
  }
  if (!opts?.payload) {
    // Dispatcher contract: callers that allow handler turns must provide the
    // payload. TurnExecutor does; unit tests that skip payload hit this guard.
    throw new Error(
      'dispatchHandler invoked without opts.payload — caller contract violation',
    );
  }
  return handler({
    context,
    payload: opts.payload,
    requestId: context.request_id,
    signal: opts.signal ?? new AbortController().signal,
  });
}

interface HandlerResult {
  sanitised: SanitiseResult;
  llm_calls_used: 1; // handler-internal: just the narrate call
  raw_text_length: number;
}

/**
 * A2 direct_answer handler. Kept inline in dispatch.ts so the A1 implementation
 * shape is preserved; clarify lives in its own module (see ./clarify.js) since
 * later slices will extend it with MCQ / follow-up state independently.
 *
 * Reports its own narrate count only (1). The dispatcher adds +1 for the
 * pre-narrate classifier call.
 */
async function dispatchDirectAnswer(
  context: TurnContext,
  opts?: DispatchOpts,
): Promise<HandlerResult> {
  const system = await getSystemPrompt('direct_answer_narrate');
  const userMessage = findLatestUserMessage(context);

  const response = await invokeNarrate(
    {
      system,
      user_message: userMessage,
      request_id: context.request_id,
      budget_ms: context.budgets.llm_narrate_ms,
      temperature: 0,
    },
    { signal: opts?.signal },
  );

  const sanitised = sanitiseNarrateOutput(response.text);
  if (sanitised.output.length === 0) {
    throw new NarrateEmptyOutputError();
  }

  return {
    sanitised,
    llm_calls_used: 1,
    raw_text_length: response.text.length,
  };
}

function findLatestUserMessage(context: TurnContext): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const msg = context.messages[i];
    if (msg && msg.role === 'user') return msg.content;
  }
  throw new Error('TurnContext has no user message — invariant violation');
}
