/**
 * V5 TurnExecutor — internal types.
 *
 * Wire-level contracts come from `@talchain/schemas` (`/boundary` for the
 * OlumiResponse, `/orchestrator` for TurnContext + LLMAdapter I/O).
 * This module adds CEE-internal names that never cross a service boundary.
 */

import type { FailureTypeLiteral } from '@talchain/schemas/boundary';

// Internal turn-class identifiers for V5 dispatch.
//
// Names match the wire `TurnClass` enum in `@talchain/schemas/boundary` for
// the classes A2 implements. The wire enum also lists `frame`, `propose`,
// `decide`, `review` as provisional placeholders — those are unreachable in
// A2 and yield `UnhandledTurnClassError` → UNHANDLED → P0 alert.
//
// A1 implemented `direct_answer` only. A2 adds `clarify`.
export type A2TurnClass = 'direct_answer' | 'clarify';

export const A2_TURN_CLASSES = ['direct_answer', 'clarify'] as const;

export function isA2TurnClass(value: unknown): value is A2TurnClass {
  return typeof value === 'string' && (A2_TURN_CLASSES as readonly string[]).includes(value);
}

/**
 * Raised when the classifier returns well-formed output whose `turn_class`
 * value is outside the A2TurnClass union (e.g. `{"turn_class":"propose"}`).
 * Per Paul's correction 3: this is an internal invariant breach (P0), NOT a
 * recoverable schema violation. TurnExecutor maps it to UNHANDLED →
 * INTERNAL_ERROR.
 *
 * Contrast with `ClassifierSchemaViolationError` in classify.ts, which is
 * raised for malformed JSON / missing field / wrong value type — those are
 * recoverable LLM faults mapped to LLM_UNAVAILABLE.
 *
 * Defined here (not in dispatch.ts) so classify.ts can throw it directly
 * without a circular import.
 */
export class UnhandledTurnClassError extends Error {
  readonly reason = 'unhandled_turn_class' as const;
  constructor(public readonly attempted: string) {
    super(`Unhandled turn class for A2: "${attempted}". A2 implements direct_answer + clarify only.`);
    this.name = 'UnhandledTurnClassError';
  }
}

// Dispatch result for A2. The outcome is always one of:
//  - the adapter's narrate-mode output text (success)
//  - an internal invariant violation (every unknown turn class from a valid
//    classifier output, or classifier schema parse failure after exhausted
//    retries)
export type DispatchOk = { ok: true; llm_text: string };
export type DispatchInvariantViolation = {
  ok: false;
  reason: 'unhandled_turn_class' | 'missing_prompt' | 'adapter_misuse';
  detail: string;
};

// Narrate-mode internal failure classes, per addendum §2.1.5.
//
// Every internal name maps to a BoundaryErrorCode (FailureType) that lands on
// the wire. A2 adds `LLM_SCHEMA_VIOLATION` — classifier returned output that
// failed JSON schema parse. Paul's correction 3: this is a recoverable LLM
// fault (mirrors narrate-mode LLM_TIMEOUT), NOT an internal invariant breach.
// `UNHANDLED` remains reserved for truly unknown classifier output (e.g. a
// well-formed JSON whose `turn_class` value is not in `A2TurnClass`) and for
// catch-all generic errors at the dispatch boundary.
export type InternalFailure =
  | 'LLM_TIMEOUT'
  | 'LLM_SCHEMA_VIOLATION'
  | 'BUDGET_EXCEEDED'
  | 'STATE_COMMIT_FAILED'
  | 'UNHANDLED';

// Mapping internal → wire code. The contamination case is NOT listed here —
// sanitiser handles it in-band, response remains a success.
//
// LLM_SCHEMA_VIOLATION maps to LLM_UNAVAILABLE: no dedicated wire code exists
// for classifier schema-parse failures (adding one requires a schema bump,
// which A2 is explicitly out of scope for). LLM_UNAVAILABLE's user-facing
// text ("The model is temporarily unavailable. Please retry shortly.") is the
// correct user action for a transient LLM structured-output malfunction.
export const INTERNAL_TO_WIRE: Record<InternalFailure, FailureTypeLiteral> = {
  LLM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  LLM_SCHEMA_VIOLATION: 'LLM_UNAVAILABLE',
  BUDGET_EXCEEDED: 'TURN_BUDGET_EXCEEDED',
  STATE_COMMIT_FAILED: 'INTERNAL_ERROR',
  UNHANDLED: 'INTERNAL_ERROR',
};

// Telemetry shape for `turn_executor.started` and `turn_executor.completed`.
// Exactly-one-response invariant: every `started` MUST have a matching
// `completed` with `response_emitted=true`. TurnExecutor's top-level
// try/finally enforces this.
export interface TurnExecutorTelemetry {
  request_id: string;
  session_id: string;
  stage: string;
  turn_class: A2TurnClass;
  stages_completed: string[];
  response_emitted: boolean;
  llm_calls_used: number;
  commit_performed: boolean;
  failure_type: FailureTypeLiteral | null;
  wall_clock_ms: number;
}
