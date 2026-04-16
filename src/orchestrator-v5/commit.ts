/**
 * A1 commit() — per Paul's constraint 11 (verbatim):
 *
 *   "A1 commit() performs no storage writes, no cache writes, no graph mutation,
 *    no session mutation. It populates only OlumiResponse fields defined by
 *    the locked Zod schema."
 *
 * The function is here as a named stage so TurnExecutor telemetry can attest
 * that commit ran, and so future slices have a point to hang persistence on.
 * In A1 it is intentionally a pure pass-through that validates the composed
 * OlumiResponse shape is truthy — nothing more.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

export interface CommitResult {
  response: OlumiResponse;
  performed: true;
}

/**
 * A1 commit: no-op beyond a sanity check that the composed response exists.
 * Returns the response unchanged so the caller can feed it to the egress
 * validator.
 *
 * Any future mutation lands in later slices. Keep this function's shape
 * additive — callers treat `performed: true` as "the envelope is final".
 */
export function commitDirectAnswer(response: OlumiResponse): CommitResult {
  if (!response) {
    throw new Error('commitDirectAnswer called with falsy response — invariant violation');
  }
  return { response, performed: true };
}
