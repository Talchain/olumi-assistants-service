/**
 * Maps an internal failure class to a well-formed OlumiResponse with an
 * ErrorBlock plus a recovery chip. This is the egress safety layer the
 * cross-service audit §6.1 (P0) flagged: every failure path must carry an
 * actionable chip, and the wire `error_code` on `blocks[0]` is preserved
 * so machine consumers (UI parser, error dashboards) keep their existing
 * parsing path while the human-readable `assistant_text` is owned by the
 * recovery helper.
 *
 * `recovery` is required: every in-tree caller (turn-executor.ts) threads
 * `FailureResponseRecoveryContext`, and the legacy empty-chip fallback
 * was removed once the migration completed. Future callers cannot
 * reintroduce a blank failure turn at this layer.
 *
 * This module builds the ENVELOPE; the HTTP STATUS is decided by the route
 * handler. Group 3 Task B changed the status contract:
 *
 *   - Happy path (commit_performed === true) → 200 + OlumiResponse
 *   - Egress validation failure              → 200 + OlumiResponse fallback
 *     (schema-drift fallback from validators/b1.ts — NOT a runtime failure)
 *   - Commit failure (commit_performed === false) → 500 + BoundaryError
 *     (route-v2.ts wraps this envelope's `retryable` flag into a
 *     BoundaryError body so the UI parser preserves the typed error_code)
 *
 * B1 contract failures (ingress Zod parse) are handled by validators/b1.ts
 * and return HTTP 422 + BoundaryError — this module is only invoked for
 * TurnExecutor runtime failures.
 */

import type { OlumiResponse, FailureTypeLiteral } from '@talchain/schemas/boundary';
import type { StageType } from '@talchain/schemas/boundary';

import {
  buildRecoveryChip,
  emitRecoveryChipServed,
  recoveryFailureTypeFromInternal,
} from './compose/recovery-chips.js';
import { INTERNAL_TO_WIRE, type InternalFailure } from './types.js';

// Group 3 Task B: internal failures that are transient / user can retry and
// succeed. STATE_COMMIT_FAILED is the flag case — the LLM produced a valid
// response but persistence failed. LLM_TIMEOUT is also retryable (upstream
// hiccup). Everything else (UNHANDLED, HANDLER_INVOCATION_FAILED,
// HANDLER_RESULT_INVALID, LLM_SCHEMA_VIOLATION, BUDGET_EXCEEDED) is either
// structural or model-pathology; retrying won't help.
const RETRYABLE_INTERNAL_FAILURES: ReadonlySet<InternalFailure> = new Set([
  'STATE_COMMIT_FAILED',
  'LLM_TIMEOUT',
]);

/**
 * Recovery context passed through from turn-executor.ts. Required so every
 * failure envelope carries an actionable chip (cross-service audit §6.1
 * P0 — no blank failure turns). The fallback empty-chip path was removed
 * after every in-tree caller was migrated, so future callers cannot
 * reintroduce a blank failure turn at this layer.
 */
export interface FailureResponseRecoveryContext {
  readonly previousUserMessage: string | null | undefined;
  readonly analysisReady: boolean;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly isRetry: boolean;
  readonly handlerId: string | null;
  /**
   * Optional refinement read from the failure's `details` payload —
   * e.g. `'schema_repair_failed'` discriminates the repair-exhausted
   * variant of `LLM_SCHEMA_VIOLATION` from generic schema-parse failures.
   */
  readonly cause?: string;
}

export function buildFailureResponse(
  internal: InternalFailure,
  stage: StageType,
  details: Record<string, unknown> | undefined,
  recovery: FailureResponseRecoveryContext,
): OlumiResponse {
  const wireCode: FailureTypeLiteral = INTERNAL_TO_WIRE[internal];
  // Group 3 Task B: surface retryability in the error block's details so the
  // UI can render a retry affordance and distinguish transient failures from
  // permanent ones. `details.retryable` is machine-readable and unambiguous;
  // the human-readable `assistant_text` is owned by the recovery helper.
  const retryable = RETRYABLE_INTERNAL_FAILURES.has(internal);
  const mergedDetails: Record<string, unknown> = {
    retryable,
    ...(details ?? {}),
  };

  const failureType = recoveryFailureTypeFromInternal(
    internal,
    recovery.cause ?? readCauseFromDetails(details),
  );
  const recoveryResult = buildRecoveryChip({
    failureType,
    previousUserMessage: recovery.previousUserMessage,
    analysisReady: recovery.analysisReady,
  });
  emitRecoveryChipServed({
    failureType,
    chips: recoveryResult.chips,
    scenarioId: recovery.scenarioId,
    turnId: recovery.turnId,
    isRetry: recovery.isRetry,
    handlerId: recovery.handlerId,
  });
  return {
    response_version: 2,
    assistant_text: recoveryResult.assistantText,
    blocks: [
      {
        type: 'error',
        error_code: wireCode,
        severity: 'error',
        details: mergedDetails,
      },
    ],
    suggested_actions: [...recoveryResult.chips],
    insights: [],
    stage_indicator: stage,
  };
}

function readCauseFromDetails(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const cause = details['routing_error_cause'];
  return typeof cause === 'string' ? cause : undefined;
}
