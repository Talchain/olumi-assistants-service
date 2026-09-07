/**
 * THE FACTOR-NODE NORMALISATION CAP — its one definition, and the derived
 * predicate that recognises its own output.
 *
 * `computeNormalisationCap` lived as a module-private function inside
 * `enricher.ts` until this module existed. It is unchanged; it moved so that
 * the ONE definition can be imported by the edit seam as well as the draft
 * seam, rather than re-spelled there (CLAUDE.md trap 12 — the hand-maintained
 * mirror is this estate's dominant defect, and a second copy of an
 * order-of-magnitude rule would read correct on the day it was written).
 *
 * ── WHAT THIS CAP IS, AND WHAT IT IS NOT ───────────────────────────────────
 * It is a DISPLAY/MODEL NORMALISATION ARTEFACT for a plain factor node: the
 * pipeline stores `value = raw_value / cap` so a magnitude sits in [0,1]. It
 * is NOT a semantic bound anybody stated. Nothing in the estate records that
 * distinction — `cap` is a bare `z.number().optional()` on both
 * `ObservedStateV3` and `FactorData`, with no companion field (swept at
 * 578e8093: `cap_source` / `cap_provenance` / `cap_origin` / `declared_cap`
 * and eight more spellings all read ZERO in `src/`, against contrast controls
 * `raw_value` 2182 and `extractionType` 837 in the same sweep).
 *
 * ⚠ AND `observed_state.source` DOES NOT ANSWER IT. `source:
 * 'brief_extraction'` is classified `'user_stated'` by `OBSERVED_STATE_SOURCE`
 * (`cee/graph-readiness/obligation-provenance.ts`) — it says the VALUE came
 * from the user's own brief, and says nothing whatever about who minted the
 * CAP beside it. A predicate keyed on it would have been asking a different
 * question under a similar name (CLAUDE.md trap 21).
 *
 * ── SO THE PREDICATE IS DERIVED FROM THE PRODUCER, NOT FROM A STORED FLAG ──
 * `isNormalisationMintedCap` asks exactly one question: COULD THIS CAP HAVE
 * BEEN MINTED BY `computeNormalisationCap` FOR THIS FACTOR? Its three
 * conjuncts are the minting sites' own conditions, read at the bytes — both
 * call sites in `enricher.ts` are byte-identical:
 *
 *     if (factor.unit !== "%" && factor.value > 1) {
 *       cap = computeNormalisationCap(factor.value);
 *       rawValue = factor.value;
 *       normalizedValue = factor.value / cap;
 *     }
 *
 * so the predicate is the minting gate (`unit !== '%'`, `raw > 1`) plus the
 * minting function's own output (`cap === computeNormalisationCap(raw)`).
 * Derived from the producer's declared semantics rather than from the failure
 * mode in hand (CLAUDE.md traps 13c and 13d).
 *
 * ⚠ IT IS A NECESSARY CONDITION, NEVER A PROOF OF ORIGIN. A user who declares
 * a cap that happens to equal the next power of ten above the stored value is
 * indistinguishable here, because the estate stores nothing that could tell
 * them apart. Callers must therefore use it ONLY to decide whether a
 * user-stated value may OUTRANK the cap — never to weaken a guard, and never
 * on a bare number. It answers "is this bound plausibly an artefact?", not
 * "did a machine write this?".
 *
 * ⚠ THE `%` CONJUNCT IS LOAD-BEARING IN THE OPPOSITE DIRECTION. A percentage
 * factor on a 0–100 scale is the canonical UNIT-SLIP catch, and its cap is
 * intrinsic to the unit rather than minted here — `computeNormalisationCap`
 * is never reached for it. Dropping that conjunct would let "120000%" extend a
 * genuine percentage scale, which is the exact defect class the cap exists to
 * catch. Pinned by opposite-direction twins in
 * `__tests__/normalisation-cap-authority.test.ts`.
 */

/**
 * Compute a normalisation cap for a large FACTOR-NODE value (display/model
 * normalisation for regular factor nodes — NOT goal thresholds).
 * Uses order-of-magnitude rounding: 800 → 1000, 50000 → 100000.
 *
 * NOTE (cap-doctrine unification, ROADMAP 1.18): the goal-threshold
 * redirection branch in `enricher.ts` does NOT use this function — it
 * delegates to the shared `resolveGoalThresholdCap` doctrine
 * (`utils/goal-threshold-cap.ts`) so a goal target scores identically via the
 * draft and chat (add_constraint handler) registration paths. This function
 * remains the cap for plain factor nodes (the enhance/create branches), a
 * separate, unrelated concern (factor display legibility, not goal-fit
 * scoring).
 */
export function computeNormalisationCap(rawValue: number): number {
  if (rawValue <= 0) return 1;
  // Round up to next order of magnitude
  const orderOfMagnitude = Math.pow(10, Math.ceil(Math.log10(rawValue)));
  return orderOfMagnitude;
}

/**
 * Could `factorCap` be the normalisation artefact `computeNormalisationCap`
 * mints for a factor whose stored magnitude is `factorObservedRawValue`?
 *
 * Read the module header before using this — in particular that a `true` here
 * is a NECESSARY condition and not a proof of origin, and that it must never
 * be used to weaken a guard.
 */
export function isNormalisationMintedCap(input: {
  readonly factorCap: number | undefined;
  readonly factorObservedRawValue: number | undefined;
  readonly factorUnit: string | undefined;
}): boolean {
  const { factorCap, factorObservedRawValue, factorUnit } = input;
  if (factorCap === undefined || !Number.isFinite(factorCap)) return false;
  if (factorObservedRawValue === undefined || !Number.isFinite(factorObservedRawValue)) {
    return false;
  }
  // The minting gate's own conditions, in its own order.
  if (factorUnit === '%') return false;
  if (!(factorObservedRawValue > 1)) return false;
  return factorCap === computeNormalisationCap(factorObservedRawValue);
}
