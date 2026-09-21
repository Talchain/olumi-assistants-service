/**
 * ROADMAP 2.1160 — MAY THIS STATED CURRENT LEVEL BE MINTED BESIDE THIS TARGET?
 *
 * ONE question, asked once, by both goal-registration routes. It is NOT a new
 * doctrine: rule 1 below is the estate's existing `direction_unsupported`
 * refusal (ROADMAP 2.353 review A2), MOVED here from the one place it lived so
 * that the draft path can consult it instead of re-deriving it. Two copies of
 * one rule drift and the drift reads as green (CLAUDE.md trap 12); this module
 * exists so there is exactly one.
 *
 * ── RULE 1: `direction_unsupported` ───────────────────────────────────────
 * ISL scores `P(level >= threshold)` and the goal contract carries NO DIRECTION
 * FIELD — `goal_threshold_frame` is the code constant `'level'`
 * (`utils/goal-threshold-cap.ts`). A target BELOW its stated current level
 * therefore enters a `>=` seam that INVERTS the question, and what comes back
 * is not a smaller probability, it is the wrong one wearing the same confident
 * badge. Equality is deliberately NOT refused: `threshold == baseline` is a
 * meaningful "hold the line". Real decrease support is rowed as 2.367 and runs
 * the whole way through the contract and ISL.
 *
 * ── RULE 2: `baseline_off_cap_scale` ──────────────────────────────────────
 * A DIFFERENT QUESTION FROM RULE 1, named apart deliberately (trap 21). Rule 1
 * asks *"can the `>=` frame express this pair?"*; rule 2 asks *"is this number
 * a point on the cap's scale at all?"* — the `value * cap ~= raw_value`
 * convention every normalised quantity in this service obeys
 * (`cee/transforms/observed-state-cap-corroboration.ts:1-30`). A stamped
 * `goal_baseline` outside `[0, 1]` is not a level that happens to be
 * unflattering, it is a number on a different scale from the threshold it will
 * be subtracted from.
 *
 * ⚠ WHAT RULE 2 IS AND IS NOT, MEASURED RATHER THAN ASSERTED. Given a cap from
 * `resolveGoalThresholdCapWithProvenance`, every branch returns `cap >= raw`,
 * so `rawBaseline <= rawTarget` already implies `normalised <= 1` — i.e. from
 * the enricher's call site rule 2 is UNREACHABLE TODAY, and rule 1 is the limb
 * that fires. It is kept, and tested at this module's own boundary, because it
 * is the limb that keeps the withholding correct if that cap guarantee ever
 * moves — a guard whose only defence is a guarantee stated in prose elsewhere
 * is a guard agreeing with itself (trap 13b). The cap guarantee itself is
 * pinned by execution in `__tests__/goal-baseline-scale-coherence.test.ts`
 * rather than by this paragraph.
 *
 * ⛔ WHAT THIS MODULE DOES **NOT** CLOSE, stated so nobody reads it as more
 * than it is. It does not detect a stated level that is on a DIFFERENT
 * MAGNITUDE from its target while still pointing the right way. Measured on
 * the same staging corpus: eight persisted goal nodes from
 * "grow ARR from 8 to 11 million within 12 months" carry
 * `goal_threshold_raw 11,000,000` with `observed_state.raw_value 8` — an
 * elided magnitude word on one member of a from-to pair, normalising to
 * `5.8e-7`, which is INSIDE `[0, 1]` and points the right way, so neither rule
 * here can see it. That is an extraction defect upstream of this seam (a
 * magnitude-scope question, rowed separately), and inventing a plausible-ratio
 * constant to catch it here would be exactly the arbitrary-cliff predicate
 * CLAUDE.md trap 22f rules against.
 */

/** The named ways a stated current level can fail to be mintable. */
export const GOAL_BASELINE_REFUSALS = [
  'direction_unsupported',
  'baseline_off_cap_scale',
] as const;

export type GoalBaselineRefusal = (typeof GOAL_BASELINE_REFUSALS)[number];

/**
 * RULE 1, alone and importable: does the stated current level sit ABOVE the
 * stated target, i.e. is this a decrease the `>=` frame cannot carry?
 *
 * Both operands must already be on ONE scale — the callers guarantee that by
 * construction (same extraction match, same unit reconstruction) or by an
 * explicit comparability refusal that runs first.
 */
export function statedLevelExceedsTarget(target: number, level: number): boolean {
  return target < level;
}

export type GoalBaselineAdmission =
  | { readonly admitted: true; readonly normalised: number }
  | { readonly admitted: false; readonly reason: GoalBaselineRefusal };

/**
 * The whole decision, and the normalised value when the answer is yes.
 *
 * Returns the normalised baseline rather than leaving the caller to divide, so
 * the admitted number and the number that was judged cannot diverge.
 */
export function admitGoalBaseline(args: {
  readonly rawTarget: number;
  readonly rawBaseline: number;
  readonly cap: number;
}): GoalBaselineAdmission {
  const { rawTarget, rawBaseline, cap } = args;

  if (
    !Number.isFinite(rawTarget) ||
    !Number.isFinite(rawBaseline) ||
    !Number.isFinite(cap) ||
    cap === 0
  ) {
    return { admitted: false, reason: 'baseline_off_cap_scale' };
  }

  if (statedLevelExceedsTarget(rawTarget, rawBaseline)) {
    return { admitted: false, reason: 'direction_unsupported' };
  }

  const normalised = rawBaseline / cap;
  if (!(normalised >= 0 && normalised <= 1)) {
    return { admitted: false, reason: 'baseline_off_cap_scale' };
  }

  return { admitted: true, normalised };
}
