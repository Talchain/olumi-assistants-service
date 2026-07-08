/**
 * Shared goal-threshold cap-resolution doctrine (ROADMAP 1.18,
 * analysis-credibility hygiene batch, PR "cap-doctrine unification").
 *
 * Single source of truth for turning a raw goal-success target into a
 * normalisation cap (the denominator used to derive `goal_threshold`, the
 * 0–1 model value PLoT/ISL score options against). Used by BOTH
 * goal-threshold registration paths, which MUST agree so the same target
 * scores identically regardless of how the user registered it:
 *   - chat: `add_constraint` handler
 *     (orchestrator-v5/tools/handlers/add-constraint.ts) — the sanctioned
 *     doctrine this module was extracted from.
 *   - draft: factor-extraction enricher's goal-threshold redirection
 *     (cee/factor-extraction/enricher.ts, `enrichGraphWithFactorsAsync`).
 *
 * Prior to this unification the two paths diverged: the enricher used a
 * unit-blind next-power-of-10 rounding (`computeNormalisationCap`) while
 * add-constraint used this doctrine (%→/100 else 25% headroom). The SAME
 * raw target could score up to ~5x differently depending on registration
 * path — e.g. raw=150 (no unit): draft (old) → cap 1000 → threshold 0.15;
 * chat → cap 187.5 → threshold 0.8.
 *
 * Doctrine (defaults-v19 GOAL THRESHOLD / CAP SELECTION,
 * provisional_doctrine_v0):
 *   1. an existing valid `goal_threshold_cap` (>= the raw target, same
 *      unit) wins — re-registering a compatible, larger-or-equal cap
 *      should not shrink an already-sound denominator;
 *   2. '%' targets within 0–100 normalise against 100 — an inherited
 *      absolute cap from a previous registration (e.g. cap 1000 from an
 *      "800 customers" target) must not distort a percentage
 *      re-registration (80% against cap 1000 would silently score
 *      against 0.08 instead of 0.8);
 *   3. otherwise a 25% headroom cap above the target (never
 *      `cap === target`, which would force `goal_threshold = 1.0` and
 *      kill probability spread).
 * Returns `null` when no sound denominator exists (non-positive target) —
 * the caller then stamps raw/unit only, which still registers the target.
 *
 * NOTE on the '%' convention: `raw` here is the RAW PERCENT NUMBER (e.g.
 * `5` for "5%"), matching add-constraint.ts's "value stored in USER
 * UNITS" convention. The enricher's regex extraction pre-divides
 * percentages into a 0–1 fraction (`cee/factor-extraction/index.ts`)
 * BEFORE this function would ever see them — its percentage branch must
 * stay a short-circuit (raw fraction, no cap) rather than route through
 * this function with an already-divided value, or the '%'→/100 step
 * would double-divide (0.15 → cap 100 → 0.0015, a 100x regression).
 */
export function resolveGoalThresholdCap(
  existingCap: unknown,
  raw: number,
  unit: string | undefined,
  existingUnit: unknown,
): number | null {
  // '%' targets ALWAYS normalise against 100 (review hardening,
  // 2026-07-07): an inherited absolute cap from a previous registration
  // must not distort a percentage re-registration.
  if (unit === '%' && raw > 0 && raw <= 100) return 100;
  // An existing cap is only reusable when the units are compatible — a
  // cap minted for one unit is meaningless for another.
  const unitsCompatible =
    unit === existingUnit || (unit === undefined && existingUnit === undefined);
  if (
    unitsCompatible &&
    typeof existingCap === 'number' &&
    Number.isFinite(existingCap) &&
    existingCap > 0 &&
    existingCap >= raw
  ) {
    return existingCap;
  }
  if (raw > 0) return raw * 1.25;
  return null;
}
