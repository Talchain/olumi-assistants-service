/**
 * Deterministic selector for the what-if (counterfactual) lens.
 *
 * The lens is a coach-suggestion EXTENSION of `what_would_flip`; whether it
 * fires — and on WHICH factor — is decided here from signals ALREADY computed
 * in enrichment (`flip_thresholds` → {@link FlipSummary}, `robustness` →
 * {@link RawRobustnessSignals}). This is an auditable, pure function: NEVER an
 * LLM lens choice (binding rule from the capability-layer brief).
 *
 * Selection rule (conservative by design — fail loud, never guess):
 *   1. A concrete single-factor tipping point must exist
 *      (`flipSummary.overall_status === 'concrete'`). A concrete flip entry is
 *      exactly the "high-influence factor the user could act on" the brief
 *      names — PLoT found that moving it alone can change which option leads.
 *      Without a concrete flip there is no NAMED actionable factor to probe, so
 *      the selector returns `null` (the lens emits nothing).
 *   2. The chosen factor is the FIRST concrete entry (entries arrive in the
 *      analysis's own importance order; we do not re-rank) that carries a
 *      finite `flip_value` and a non-empty `factor_id` + `factor_label`.
 *   3. A raw-fragile result strengthens the trigger label (for auditability)
 *      but is not required — a concrete flip is itself the actionable signal.
 *
 * The `flipSummary` handed in is ALREADY filtered of option-controlled levers
 * (turn-executor / chip-click both apply `filterFlipSummaryEntries`), so the
 * selector can only pick a factor the user can independently move.
 */

import type { FlipSummary } from '../../../compose/flip-proposal.js';
import { isRawFragile, type RawRobustnessSignals } from '../../../coaching/robustness-honesty.js';

export interface CounterfactualProbe {
  /** Graph node id of the factor to intervene on. */
  readonly factor_id: string;
  /** Display label of the factor (user-facing copy). */
  readonly factor_label: string;
  /**
   * Auditable trigger provenance. `fragile_concrete_flip` when the result was
   * also raw-fragile; `concrete_flip` otherwise. Never influences the model —
   * observability only.
   */
  readonly trigger: 'concrete_flip' | 'fragile_concrete_flip';
}

/**
 * Pick the counterfactual probe for this turn, or `null` when no auditable
 * high-influence actionable factor is available. Pure; no side effects.
 */
export function selectCounterfactualProbe(
  flipSummary: FlipSummary | null | undefined,
  rawRobustness: RawRobustnessSignals | null | undefined,
): CounterfactualProbe | null {
  if (!flipSummary || flipSummary.overall_status !== 'concrete') {
    return null;
  }

  const entry = flipSummary.entries.find(
    (e) =>
      typeof e.flip_value === 'number' &&
      Number.isFinite(e.flip_value) &&
      typeof e.factor_id === 'string' &&
      e.factor_id.trim().length > 0 &&
      typeof e.factor_label === 'string' &&
      e.factor_label.trim().length > 0,
  );

  if (!entry) {
    return null;
  }

  return {
    factor_id: entry.factor_id,
    factor_label: entry.factor_label,
    trigger: isRawFragile(rawRobustness) ? 'fragile_concrete_flip' : 'concrete_flip',
  };
}
