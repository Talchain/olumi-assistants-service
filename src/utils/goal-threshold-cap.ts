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
 *   1. an existing valid `goal_threshold_cap` (STRICTLY GREATER than the
 *      raw target, same unit) wins — re-registering a compatible, larger
 *      cap should not shrink an already-sound denominator;
 *      ⚠ ROADMAP 2.239: this test was `>=` until 2026-08-01, which made
 *      rule 3's parenthesised "never `cap === target`" guard
 *      UNENFORCEABLE — rule 1 fired first and returned the equal cap
 *      verbatim, so the forbidden state was reachable through the very
 *      module written to forbid it. `goal_threshold_cap` is an
 *      LLM-WRITABLE draft field (cee/draft/anthropic-graph-schema.ts:299)
 *      and the draft prompt tells the model "goal_threshold_cap MUST be
 *      >= goal_threshold_raw" (prompts/defaults-v19.ts:183), so an equal
 *      cap is not a corner case — it is what the prompt permits. Measured
 *      cost on the deployed ISL build (diagnosis §5): at the resulting
 *      `goal_threshold = 1.0` the options returned probability_of_goal
 *      0.021 and exactly 0.0 while the leader won 95% of scenarios;
 *   2. '%' targets within 0–100 normalise against 100 — an inherited
 *      absolute cap from a previous registration (e.g. cap 1000 from an
 *      "800 customers" target) must not distort a percentage
 *      re-registration (80% against cap 1000 would silently score
 *      against 0.08 instead of 0.8);
 *   3. otherwise a 25% headroom cap above the target (never
 *      `cap === target`, which would force `goal_threshold = 1.0` and
 *      kill probability spread).
 *
 * THE ONE SANCTIONED `cap === target`: rule 2 returns 100 for a '%'
 * target, so `raw = 100` DOES yield `cap === raw` and `goal_threshold =
 * 1.0`. That is deliberate and must not be "fixed" by a later reading of
 * rule 3. "Achieve 100% retention" is a genuine ask-for-the-ceiling —
 * `P(x >= 1.0)` is the honest question — whereas an absolute target
 * pinned to its own cap is a normalisation artefact. Applying headroom
 * here would silently rescale the user's stated 100% to 0.8 of the scale
 * and break rule 2's whole purpose. Pinned in
 * `tests/unit/cee.goal-threshold-degenerate-cap.test.ts`.
 * Returns `null` when no sound denominator exists (non-positive target) —
 * the caller then stamps raw/unit only, which still registers the target.
 *
 * NOTE on the '%' convention: `raw` here is the RAW PERCENT NUMBER (e.g.
 * `5` for "5%"), matching add-constraint.ts's "value stored in USER
 * UNITS" convention. The enricher's regex extraction pre-divides
 * percentages into a 0–1 fraction (`cee/factor-extraction/index.ts`)
 * BEFORE the enricher's goal-threshold branch runs, so that caller
 * RECONSTRUCTS the raw percent number (`factor.value * 100`) before
 * delegating here (ROADMAP 1.18 completion — full delegation, both paths
 * persist the same raw/unit/cap/threshold contract). Passing the
 * already-divided fraction directly would double-divide (0.15 → cap 100
 * → 0.0015, a 100x regression) — never route a pre-divided '%' value
 * through this function without reconstructing the percent number first.
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
    // STRICTLY greater (ROADMAP 2.239 — was `>=`). An existing cap EQUAL
    // to the target is not a sound denominator: it forces
    // `goal_threshold = raw / cap = 1.0`, i.e. "what is the probability of
    // hitting the maximum of the scale", which is the state rule 3's guard
    // names as forbidden. Falling through to rule 3 re-derives the 25%
    // headroom instead of honouring a degenerate inherited/LLM-drafted cap.
    existingCap > raw
  ) {
    return existingCap;
  }
  if (raw > 0) return raw * 1.25;
  return null;
}
