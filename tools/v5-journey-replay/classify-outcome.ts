/**
 * V5 replay harness — outcome classification.
 *
 * Contract (from the v5-replay-proof brief):
 *   - `harness-auth-blocker` — pre-orchestrator. Never conflate with runtime.
 *     Includes: network failures, 401, 403, harness exceptions, malformed
 *     request-side errors.
 *   - `v5-runtime` — the orchestrator actually ran. Covers success (200),
 *     composed 200 error envelope (`schema: "error.v1"` body), and genuine
 *     500 / BoundaryError responses. 200 with an error envelope is still a
 *     runtime failure, not a success.
 *   - `skipped` — a prerequisite step failed; this step was not attempted.
 *
 * The classifier operates on observable HTTP signal only. It does not try
 * to distinguish "recoverable 500" from "fatal 500" — that's the P1-1
 * scope doc's job (Phase 4).
 */

import type { TurnResponse } from './types.js';

export type OutcomeClass = 'harness-auth-blocker' | 'v5-runtime' | 'skipped';

export interface ClassifyInput {
  readonly status: number;
  readonly body: TurnResponse | undefined;
}

/**
 * Classify an HTTP response into one of the three outcome classes.
 * 401/403/network → auth blocker. Everything else that reached the
 * orchestrator → v5-runtime.
 */
export function classifyResponse(input: ClassifyInput): OutcomeClass {
  if (input.status === 401 || input.status === 403) {
    return 'harness-auth-blocker';
  }
  return 'v5-runtime';
}

/**
 * Recognise a transport-level error (network / timeout / abort). Both
 * recognised transport errors and unknown harness exceptions are
 * `harness-auth-blocker` — this helper exists so callers can format
 * evidence strings differently, not so they can classify differently.
 */
export function isTransportError(message: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|aborted|AbortError/i.test(
    message,
  );
}

/**
 * Detect a 200 response that carries an error envelope shape. These are
 * V5 runtime failures disguised as success status — they should fail the
 * row and be classified as runtime (NOT as success).
 */
export function hasErrorEnvelope(body: TurnResponse | undefined): boolean {
  if (!body) return false;
  // `{ schema: "error.v1", code: "...", message: "..." }` — auth and
  // top-level validation errors.
  if (body.schema === 'error.v1') return true;
  // `{ error, boundary, details, retryable }` — BoundaryError shape.
  if (body.error != null && body.boundary != null) return true;
  return false;
}
