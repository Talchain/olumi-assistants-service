/**
 * Maps an internal failure class to a well-formed OlumiResponse with an
 * ErrorBlock, using `FAILURE_USER_TEXT` for the user-visible string.
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
import { FAILURE_USER_TEXT } from '@talchain/schemas/boundary';
import type { StageType } from '@talchain/schemas/boundary';

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

export function buildFailureResponse(
  internal: InternalFailure,
  stage: StageType,
  details?: Record<string, unknown>,
): OlumiResponse {
  const wireCode: FailureTypeLiteral = INTERNAL_TO_WIRE[internal];
  // Group 3 Task B: surface retryability in the error block's details so the
  // UI can render a retry affordance and distinguish transient failures from
  // permanent ones. The shared FAILURE_USER_TEXT[wireCode] generic copy is
  // acceptable for Group 3 (and flagged in the commit as a UX risk — see
  // below), but details.retryable is machine-readable and unambiguous.
  const retryable = RETRYABLE_INTERNAL_FAILURES.has(internal);
  const mergedDetails: Record<string, unknown> = {
    retryable,
    ...(details ?? {}),
  };
  return {
    response_version: 2,
    assistant_text: FAILURE_USER_TEXT[wireCode],
    blocks: [
      {
        type: 'error',
        error_code: wireCode,
        severity: 'error',
        details: mergedDetails,
      },
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: stage,
  };
}
