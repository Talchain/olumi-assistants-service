import type { DraftRecordSet } from "./grammar.js";

/**
 * ⭐⭐ IS THIS EMISSION'S OPTION→FACTOR REFERENCE SET TRUSTWORTHY AT ALL?
 *
 * Measured 15 Sep 2026 on a fresh draft at the served staging prompt (v201,
 * `fab9aa27…`) and model (`claude-sonnet-4-6`). On one compound brief ALL SIX
 * `sets_to`-bearing option→factor links were off by exactly +1, while every
 * label named its intended source correctly:
 *
 *   [20] "Raise to £59 option sets Pro Plan Price"  sets_to 59 → claims[17] "Hold at £49"
 *   [21] "Hold at £49 option sets Pro Plan Price"   sets_to 49 → claims[18] "Staged Increase"
 *
 * Two of the six landed on a `causal_link` and were correctly refused. THE OTHER
 * FOUR LANDED ON `option_refinement` — a LEGAL source kind — so they passed
 * every existing check and the product showed the person "hold at £49" priced
 * at £59. That is the residue `grammar.ts` named when it rejected a unified
 * namespace: "an off-by-one still lands on a real node of a plausible kind,
 * which is strictly harder to machine-catch than what it replaces."
 *
 * ⛔ THIS FUNCTION NEVER REPAIRS A REFERENCE, AND NEVER SHIFTS AN INDEX. An
 * index that is wrong by one is indistinguishable, at the bytes, from an index
 * that is right — that is the whole difficulty. Re-pointing by label match
 * would be guessing a mapping. What CAN be established without guessing is
 * whether the emission's option→factor references are reliable AS A SET: a
 * PROVEN-invalid source among them is evidence about the whole group, because
 * the fault is systematic rather than per-link.
 *
 * ⛔ AND IT DOES NOT USE FIGURES. An earlier version contested a link whose
 * source option label carried a stated figure other than `sets_to`. It is
 * REFUTED: "increase the Pro plan price from £49 to £59" carries £49 in its own
 * label while £59 is the CORRECT value, so the rule fires on the commonest
 * correct shape. Figure presence establishes neither the intended value nor the
 * metric nor the role.
 */
export function countInvalidOptionEffectSources(records: DraftRecordSet): number {
  const claims = records.claims ?? [];
  const stated = records.stated_items ?? [];
  let invalid = 0;
  for (const claim of claims) {
    if (claim.claim_kind !== "causal_link") continue;
    if (typeof claim.sets_to !== "number" || !Number.isFinite(claim.sets_to)) continue;
    const fromClaim = claim.from_claim;
    const fromStated = claim.from_stated;
    // The grammar's contract: EXACTLY one of the pair. Both or neither is a
    // contradiction the projector already discloses rather than resolving.
    if ((fromClaim === undefined) === (fromStated === undefined)) { invalid += 1; continue; }
    if (fromClaim !== undefined) {
      const source = claims[fromClaim];
      if (!source || source.claim_kind !== "option_refinement") invalid += 1;
    } else {
      const source = stated[fromStated!];
      if (!source || source.kind !== "option") invalid += 1;
    }
  }
  return invalid;
}

/**
 * True when at least one option→factor source reference in this emission is
 * PROVABLY invalid — so the remaining ones in the same emission are suspect and
 * must not be defended against the repair path as if they were the user's or
 * the model's settled content.
 *
 * ⚠ HONEST LIMIT, STATED BECAUSE THE TEST IS NOT TOTAL: an emission whose
 * off-by-one happens to leave EVERY source on a legal kind reads as reliable
 * here and is not caught. This detects a systematic reference fault by its
 * provable members; it cannot detect one that left no provable member.
 */
export function optionEffectReferencesUnreliable(records: DraftRecordSet): boolean {
  return countInvalidOptionEffectSources(records) > 0;
}
