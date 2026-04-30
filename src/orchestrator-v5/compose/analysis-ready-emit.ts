/**
 * V5 analysis_ready wire-emit helper.
 *
 * Centralises the rule "every analysis_ready payload that ships on the wire
 * carries a computed_at ISO timestamp". The UI store uses computed_at as a
 * monotonic ordering guard so out-of-order responses cannot overwrite a
 * fresher value with a stale one.
 *
 * V5 state-trust (0.10.0+): when a freshness derivation is provided AND it
 * selected a prior run_analysis fact, computed_at is set to THAT fact's
 * timestamp — not the wire-emit time. This means explain / direct-answer
 * turns do NOT restamp computed_at to "now"; they preserve the original
 * analysis-run timestamp. Only when no fact was selected (freshness ===
 * 'none' or 'unknown' with no underlying fact) does the helper fall back to
 * wire-emit time.
 *
 * Freshness wire fields (freshness / freshness_reason / graph_hash_at_run /
 * current_graph_hash) are stamped from the derivation when provided.
 * Backwards-compatible: callers that pass no derivation still get the old
 * "stamp wire-emit time" behaviour and no freshness fields.
 */

import type { GraphPatchBlockData } from '../../orchestrator/types.js';
import type { FreshnessDerivation } from '../context/freshness.js';

export type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

/**
 * Attach computed_at and (optional) freshness fields to the payload
 * immediately before it ships on the wire. Returns a shallow copy so
 * caller-held references stay timestamp-free.
 *
 * @param payload   The analysis_ready payload to stamp.
 * @param freshness Optional freshness derivation. When provided and the
 *                  derivation selected a fact with a computed_at, that
 *                  timestamp is used. Freshness wire fields are stamped
 *                  from the derivation regardless of whether a fact was
 *                  selected. When omitted, falls back to legacy behaviour
 *                  (Date.now ISO + no freshness fields).
 */
export function attachComputedAt(
  payload: AnalysisReadyPayload,
  freshness?: FreshnessDerivation,
): AnalysisReadyPayload {
  // Use the selected fact's computed_at when freshness derivation found
  // one, so explain / direct-answer turns preserve the analysis-run
  // timestamp. Otherwise stamp wire-emit time.
  const computedAt =
    freshness?.computed_at ?? new Date().toISOString();

  if (!freshness) {
    return { ...payload, computed_at: computedAt };
  }

  const out: AnalysisReadyPayload = {
    ...payload,
    computed_at: computedAt,
    freshness: freshness.freshness,
    freshness_reason: freshness.reason,
  };
  if (freshness.graph_hash_at_run !== null) {
    out.graph_hash_at_run = freshness.graph_hash_at_run;
  }
  if (freshness.current_graph_hash !== null) {
    out.current_graph_hash = freshness.current_graph_hash;
  }
  return out;
}
