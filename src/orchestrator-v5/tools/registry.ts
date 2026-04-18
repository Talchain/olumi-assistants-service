/**
 * V5 handler registry (slice C1).
 *
 * Every turn with `turn_class === 'handler'` is routed through this registry.
 * Slice C1 ships with ZERO handlers registered by design — dispatch lookups
 * miss, `UnhandledTurnClassError(reason='handler_not_registered')` is raised,
 * and the turn-executor UNHANDLED catch maps to INTERNAL_ERROR on the wire.
 * Slice C2 will register `run_analysis` against this surface.
 *
 * ## Shape
 *
 * `HandlerInvocation` carries everything a handler needs:
 *   - `context`: the fully-built `TurnContext` from build-turn-context.ts,
 *     including prior_turns populated from the session store (Slice B).
 *   - `payload`: the raw OrchestratorTurnPayload from the route entry — the
 *     user's message and stage, useful for handlers whose behaviour depends
 *     on the input beyond what TurnContext exposes.
 *   - `requestId`: the per-turn UUID, used for log correlation and as the
 *     client-generated `turn_id` when the handler's outcome is committed.
 *   - `signal`: the AbortSignal that fires when the outer turn budget
 *     (`budgets.turn_ms`) exceeds. See AbortSignal chain below.
 *
 * `HandlerOutcome` mirrors the A2 narrate/clarify result shape + Slice B
 * commit metadata:
 *   - `assistant_text`: the user-facing narration for the OlumiResponse.
 *   - `handler_facts`: typed evidence persisted in v5_handler_facts. Slice B
 *     accepts these through `append_turn_atomic`; Slice C1 never populates.
 *   - `llm_calls_used`: incremental count of LLM calls the handler made.
 *     Turn-executor adds this to the classifier call (always 1) for the
 *     total `llm_calls_used` reported in `turn_executor.completed` telemetry.
 *
 * ## AbortSignal chain (refinement request from Paul 2026-04-18)
 *
 * The `signal` passed into `HandlerInvocation` is NOT a new construct; it is
 * the SAME AbortSignal that bounds classifier and narrate calls in A2. The
 * chain, from outermost to innermost:
 *
 *   1. `turn-executor.ts`:
 *        `const turnAbort = new AbortController();`
 *        `const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);`
 *      This AbortController fires when the wall-clock TURN_BUDGET_MS elapses.
 *
 *   2. `turn-executor.ts` passes `turnAbort.signal` to `dispatch(context, { signal })`.
 *
 *   3. `dispatch.ts` branches on `turn_class`:
 *        - 'direct_answer' / 'clarify': signal forwarded to `invokeNarrate(..., signal)`,
 *          which wraps a FRESH `LLM_BUDGET_NARRATE_MS` inner controller around it.
 *        - 'handler' (C1+): signal forwarded directly into `HandlerInvocation.signal`.
 *
 *   4. Handlers MAY layer a fresh `LLM_BUDGET_HANDLER_MS` inner controller on
 *      top of `signal` for per-handler bounded awaits. They MUST propagate
 *      the outer abort (wrap, not replace). A child controller that forgets
 *      to listen to the outer signal creates a handler that runs past the
 *      turn budget — Paul's constraint 7 violation.
 *
 * Paul's constraint 7 (A1): BUDGET_EXCEEDED wins over LLM_TIMEOUT when both
 * apply. `turn-executor.ts` inspects `turnAbort.signal.aborted` before
 * mapping any inner timeout error — a handler whose inner LLM call errors
 * out because the outer budget fired still classifies as BUDGET_EXCEEDED, not
 * HANDLER_INVOCATION_FAILED.
 *
 * ## Registry shape
 *
 * `ReadonlyMap<V5ActionType, HandlerFn>` — typed lookup keyed by the 7
 * canonical V5 action types. A `Map` (rather than `Record`) gives explicit
 * miss semantics via `.get() === undefined` and preserves insertion order
 * for telemetry iteration. The readonly modifier prevents accidental
 * mutation from outside the module.
 *
 * `EMPTY_HANDLER_REGISTRY` is the canonical empty registry used by C1.
 * Slice C2 will export a populated registry (still immutable post-
 * initialisation).
 */

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type {
  HandlerFact,
  TurnContext,
  V5ActionType,
} from '@talchain/schemas/orchestrator';

/**
 * Input to a handler invocation. Populated by dispatch.ts from the same
 * sources it hands to invokeNarrate for direct_answer / clarify, plus the
 * AbortSignal that bounds the turn.
 */
export interface HandlerInvocation {
  readonly context: TurnContext;
  readonly payload: OrchestratorTurnPayload;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

/**
 * What a handler returns on success. Throws on failure — turn-executor
 * catches and maps to HANDLER_INVOCATION_FAILED (for generic errors) or
 * HANDLER_RESULT_INVALID (for Zod-parse-failure on the returned shape).
 */
export interface HandlerOutcome {
  readonly assistant_text: string;
  readonly handler_facts: readonly HandlerFact[];
  readonly llm_calls_used: number;
}

export type HandlerFn = (invocation: HandlerInvocation) => Promise<HandlerOutcome>;

export type HandlerRegistry = ReadonlyMap<V5ActionType, HandlerFn>;

/**
 * The canonical empty registry for Slice C1. Dispatching any handler turn
 * against this registry misses and raises
 * `UnhandledTurnClassError('handler_not_registered', handlerId)`.
 */
export const EMPTY_HANDLER_REGISTRY: HandlerRegistry = new Map();

/**
 * Typed lookup. Returns the `HandlerFn` for `handlerId` if registered,
 * else `null`. Callers (dispatch.ts) branch on the null to decide
 * between invoking the handler and raising the not-registered error.
 *
 * The function never mutates the registry. Slice C2 constructs a new
 * Map when it registers `run_analysis`; Slice D1/D2 likewise produce
 * new Maps rather than mutating a shared instance. This keeps the
 * "registry immutable after construction" contract visible in the type.
 */
export function resolveHandler(
  registry: HandlerRegistry,
  handlerId: V5ActionType,
): HandlerFn | null {
  return registry.get(handlerId) ?? null;
}
