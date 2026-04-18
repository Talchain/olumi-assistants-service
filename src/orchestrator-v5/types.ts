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

// C1 adds the `handler` class. A2TurnClass stays narrow so compose branches
// that only handle A2 (direct_answer / clarify) retain strict typing. Places
// that must handle all C1 classes — dispatch, classify, turn-executor —
// widen to `C1TurnClass`. See Docs/v5/slice-c1-* for the deviation note.
export type C1TurnClass = A2TurnClass | 'handler';

export const C1_TURN_CLASSES = ['direct_answer', 'clarify', 'handler'] as const;

export function isC1TurnClass(value: unknown): value is C1TurnClass {
  return typeof value === 'string' && (C1_TURN_CLASSES as readonly string[]).includes(value);
}

/**
 * Reasons the classifier output cannot be honoured by the dispatcher. Kept
 * as a union rather than a per-reason error subclass to keep the catch path
 * in turn-executor narrow — a single `instanceof UnhandledTurnClassError`
 * covers every branch, and telemetry uses `err.reason` to distinguish.
 *
 *   - `unhandled_turn_class`: well-formed output, class outside `C1TurnClass`
 *     (e.g. `propose`, `decide`). A2/C1 leave these reserved.
 *   - `handler_not_registered`: `turn_class === 'handler'` with a valid
 *     `V5ActionType` handler_id, but the registry has no entry. In C1 the
 *     registry is empty by design — every handler turn lands here.
 *   - `missing_handler_id`: `turn_class === 'handler'` but `handler_id` is
 *     absent or not a valid V5ActionType literal. Distinct from
 *     ClassifierSchemaViolationError (which fires on structural parse
 *     failure) — the biconditional check is a semantic validation.
 */
export type UnhandledTurnClassReason =
  | 'unhandled_turn_class'
  | 'handler_not_registered'
  | 'missing_handler_id';

/**
 * Raised when the classifier returns well-formed output whose `turn_class`
 * value cannot be honoured by the dispatcher. Per Paul's correction 3 (A2)
 * and Slice C1's registry-miss deviation: this is an internal invariant
 * breach (P0), NOT a recoverable schema violation. TurnExecutor maps it to
 * UNHANDLED → INTERNAL_ERROR regardless of reason.
 *
 * Contrast with `ClassifierSchemaViolationError` in classify.ts, which is
 * raised for malformed JSON / missing field / wrong value type — those are
 * recoverable LLM faults mapped to LLM_UNAVAILABLE.
 *
 * Defined here (not in dispatch.ts) so classify.ts can throw it directly
 * without a circular import.
 */
export class UnhandledTurnClassError extends Error {
  constructor(
    public readonly reason: UnhandledTurnClassReason,
    public readonly attempted: string,
  ) {
    super(messageForReason(reason, attempted));
    this.name = 'UnhandledTurnClassError';
  }
}

function messageForReason(reason: UnhandledTurnClassReason, attempted: string): string {
  switch (reason) {
    case 'unhandled_turn_class':
      return `Unhandled turn class: "${attempted}". V5 C1 implements direct_answer, clarify, handler only.`;
    case 'handler_not_registered':
      return `Handler turn class dispatched with id "${attempted}" but no handler is registered for that id.`;
    case 'missing_handler_id':
      return `Classifier returned turn_class='handler' with missing or invalid handler_id: "${attempted}".`;
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
  | 'HANDLER_INVOCATION_FAILED'
  | 'HANDLER_RESULT_INVALID'
  | 'UNHANDLED';

// Mapping internal → wire code. The contamination case is NOT listed here —
// sanitiser handles it in-band, response remains a success.
//
// LLM_SCHEMA_VIOLATION maps to LLM_UNAVAILABLE: no dedicated wire code exists
// for classifier schema-parse failures (adding one requires a schema bump,
// which A2 is explicitly out of scope for). LLM_UNAVAILABLE's user-facing
// text ("The model is temporarily unavailable. Please retry shortly.") is the
// correct user action for a transient LLM structured-output malfunction.
//
// HANDLER_INVOCATION_FAILED + HANDLER_RESULT_INVALID: reserved for C2+ when
// real handlers register. C1 ships with an empty registry, so these codes
// are plumbed but dormant — a registry miss raises UnhandledTurnClassError
// with reason='handler_not_registered' (UNHANDLED path), NOT these codes.
export const INTERNAL_TO_WIRE: Record<InternalFailure, FailureTypeLiteral> = {
  LLM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  LLM_SCHEMA_VIOLATION: 'LLM_UNAVAILABLE',
  BUDGET_EXCEEDED: 'TURN_BUDGET_EXCEEDED',
  STATE_COMMIT_FAILED: 'INTERNAL_ERROR',
  HANDLER_INVOCATION_FAILED: 'INTERNAL_ERROR',
  HANDLER_RESULT_INVALID: 'INTERNAL_ERROR',
  UNHANDLED: 'INTERNAL_ERROR',
};

// Telemetry shape for `turn_executor.started` and `turn_executor.completed`.
// Exactly-one-response invariant: every `started` MUST have a matching
// `completed` with `response_emitted=true`. TurnExecutor's top-level
// try/finally enforces this.
//
// Notes on `turn_class`:
// - `started` event OMITS `turn_class` entirely (classifier hasn't decided
//   yet; emitting a provisional value skews aggregations).
// - `completed` event emits `turn_class: C1TurnClass | null`. Null when the
//   classifier itself failed (schema violation, out-of-union value, timeout,
//   or abort) before it could produce a resolved class. C1 adds 'handler'
//   as a possible resolved value.
export interface TurnExecutorTelemetry {
  request_id: string;
  session_id: string;
  stage: string;
  turn_class: C1TurnClass | null;
  stages_completed: string[];
  response_emitted: boolean;
  llm_calls_used: number;
  commit_performed: boolean;
  failure_type: FailureTypeLiteral | null;
  wall_clock_ms: number;
}
