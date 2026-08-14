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
import type { FreshnessDerivation, FreshnessReason } from '../context/freshness.js';

export type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

/**
 * Freshness reasons for which the finaliser may synthesise a
 * freshness-only analysis_ready block when the dispatch path produced no
 * structural readiness payload (Mission 3 transport recovery).
 *
 * Deliberately ONLY the two legacy/unparseable-graph reload reasons.
 * Other 'unknown' producers (edit_graph `derivation_failed`, the
 * `invariant_failed` defence fallback) and the analogous
 * stale-without-readiness drop stay un-synthesised: on those mid-session
 * paths the UI may hold populated readiness state, and replacing it with
 * an empty blocked block is a product decision that has not been taken.
 * Widening this set is a separate user/product decision, not assumed
 * future behaviour.
 */
export const FRESHNESS_ONLY_SYNTHESIS_REASONS: ReadonlySet<FreshnessReason> = new Set<FreshnessReason>([
  'legacy_fact_missing_hash',
  'current_graph_hash_unavailable',
]);

/**
 * Minimal freshness-only analysis_ready payload (transport recovery,
 * Tier-1 status content). Emitted by the response finaliser when a turn
 * derived an honest 'unknown' freshness verdict for a
 * FRESHNESS_ONLY_SYNTHESIS_REASONS reason but no structural readiness
 * exists (legacy or unparseable graph on reload). The block is a carrier
 * for the freshness wire fields stamped by `attachComputedAt` at the
 * call site — it carries NO science content: no bias findings, no
 * blockers, no model adjustments, no user questions, no options.
 * `status: 'blocked'` follows the CEE schema's documented semantics
 * ("validation failure prevents analysis — invalid graph structure").
 */
export function synthesiseFreshnessOnlyAnalysisReady(): AnalysisReadyPayload {
  return { status: 'blocked', goal_node_id: '', options: [], bias_findings: [] };
}

/**
 * ROADMAP 2.1085 (root 2.1041) R1 — the stage a REFUSAL turn must declare.
 *
 * A deployed-UI trace measured that a turn which is `stage_indicator !==
 * 'analyse'` AND carries no `analysis_result` block takes the UI's
 * present-but-invalid path, CLEARING ten fields that otherwise survive —
 * including the user's `goalConstraints`, `draftCoaching` and
 * `preAnalysisSensitivity` — plus the sessionStorage keys. An analyse refusal
 * has no `analysis_result` by definition, so it MUST declare `'analyse'` or
 * shipping the honest readiness block destroys user state.
 *
 * This is not a workaround: a refused analysis IS an analyse-stage turn. The
 * request's own stage cannot be trusted for it — the deployed "Run analysis"
 * chip sends `stage: 'frame'`, measured on the witnessed run.
 */
export const ANALYSE_STAGE_INDICATOR = 'analyse' as const;

/**
 * ROADMAP 2.1085 (root 2.1041) R2/R3 — the freshness verdict a REFUSAL turn
 * is allowed to ship on `analysis_ready`.
 *
 * THE SPEC: on a turn where CEE refused to analyse, the carrier's freshness
 * must be `stale` or `unknown`, always with a real reason. Never `fresh`,
 * never `none`. Both forbidden verdicts are honest ABOUT THE FACT CHAIN and
 * harmful ON THIS TURN, and a deployed-UI trace measured both harms:
 *
 *   · `fresh` → clears the local-edits dirty overlay, so the strip claims
 *     "Analysis reflects the current model" over edits CEE has never seen.
 *   · `none`  → clears a previously-good analysis fact, producing an
 *     orphaned-result banner over results that are still valid.
 *
 * ⚠ THE HASH PAIR MUST BE BROKEN, NOT JUST THE VERDICT — and this is the
 * subtle half. `checkHardInvariants` invariant 2 states "identical-hash ⇒
 * fresh, by construction" and COERCES any non-`fresh` verdict back to `fresh`
 * when both hashes are present and equal; invariant 3 forbids `unknown`
 * whenever both hashes are present at all. So a verdict-only clamp would
 * either be silently reverted by the next `enforceInvariants` call or would
 * ship a derivation that violates the module's own stated invariants. We
 * therefore drop `graph_hash_at_run` to `null` on the clamped verdicts: the
 * carrier then ASSERTS NO COMPARISON, which is exactly the claim being made.
 * `current_graph_hash` is preserved — it is the current graph's hash and is
 * true regardless — so route-v2's authoritative top-level `graph_hash` stamp
 * is unaffected.
 *
 * `stale` and an already-`unknown` verdict pass through untouched: both are
 * honest, both are permitted, and `stale` is the signal the rerun affordance
 * is gated on.
 */
export function clampRefusalFreshness(
  derivation: FreshnessDerivation,
): FreshnessDerivation {
  if (derivation.freshness === 'stale' || derivation.freshness === 'unknown') {
    return derivation;
  }
  return {
    ...derivation,
    freshness: 'unknown',
    // `none` already carries the specific, true reason (there is no
    // successful run_analysis fact) — keep it rather than replacing a precise
    // reason with a general one. `fresh` gets the refusal-specific reason,
    // because "the hashes matched" is exactly what we are declining to assert.
    reason:
      derivation.reason === 'no_successful_run_analysis_fact'
        ? 'no_successful_run_analysis_fact'
        : 'analysis_refused_currency_unverified',
    graph_hash_at_run: null,
  };
}

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
