/**
 * V5 analysis_ready wire-emit helper.
 *
 * Centralises the rule "every analysis_ready payload that ships on the wire
 * carries a computed_at ISO timestamp, set at emission time". The UI store
 * uses computed_at as an ordering guard now that analysis_ready rides on
 * every graph-bearing turn — without it, an out-of-order response could
 * overwrite a fresher value with a stale one.
 *
 * Computed_at must be set at emission, not at compute. The same upstream
 * payload may be reused across handler retries; the timestamp must reflect
 * the moment the wire response was built so the UI can reason about
 * freshness from a single canonical source.
 */

import type { GraphPatchBlockData } from '../../orchestrator/types.js';

export type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

/**
 * Attach a fresh computed_at to the payload immediately before it ships on
 * the wire. Returns a shallow copy so caller-held references stay
 * timestamp-free (otherwise downstream re-emissions would carry the original
 * stamp and the UI ordering guard would mis-order).
 */
export function attachComputedAt(
  payload: AnalysisReadyPayload,
): AnalysisReadyPayload {
  return { ...payload, computed_at: new Date().toISOString() };
}
