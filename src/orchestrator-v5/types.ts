/**
 * V5 TurnExecutor — internal types.
 *
 * Wire-level contracts come from `@talchain/schemas` (`/boundary` for the
 * OlumiResponse, `/orchestrator` for TurnContext + LLMAdapter I/O).
 * This module adds CEE-internal names that never cross a service boundary.
 */

import type { FailureTypeLiteral } from '@talchain/schemas/boundary';

// Internal turn-class identifiers for V5 dispatch. A1 implements only
// `direct_answer`. Everything else is UNHANDLED per Paul's constraint 1:
// dispatch rejects the call; the outcome surfaces as an INTERNAL_ERROR block
// plus a P0 telemetry marker.
export type A1TurnClass = 'direct_answer';

// Dispatch result for A1. The outcome is always one of:
//  - the adapter's narrate-mode output text (success)
//  - an internal invariant violation (every non-direct_answer case)
export type DispatchOk = { ok: true; llm_text: string };
export type DispatchInvariantViolation = {
  ok: false;
  reason: 'unhandled_turn_class' | 'missing_prompt' | 'adapter_misuse';
  detail: string;
};

// Narrate-mode internal failure classes, per addendum §2.1.5. Every internal
// name maps to a BoundaryErrorCode (FailureType) that lands on the wire.
export type InternalFailure =
  | 'LLM_TIMEOUT'
  | 'BUDGET_EXCEEDED'
  | 'STATE_COMMIT_FAILED'
  | 'UNHANDLED';

// Mapping internal → wire code. The contamination case is NOT listed here —
// sanitiser handles it in-band, response remains a success.
export const INTERNAL_TO_WIRE: Record<InternalFailure, FailureTypeLiteral> = {
  LLM_TIMEOUT: 'UPSTREAM_TIMEOUT',
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
  turn_class: A1TurnClass;
  stages_completed: string[];
  response_emitted: boolean;
  llm_calls_used: number;
  commit_performed: boolean;
  failure_type: FailureTypeLiteral | null;
  wall_clock_ms: number;
}
