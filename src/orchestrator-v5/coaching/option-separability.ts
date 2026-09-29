/**
 * OPTION SEPARABILITY — does this model tell the options apart at all?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE QUESTION THIS MODULE ANSWERS, AND THE FIVE IT DOES NOT.
 *
 * This estate's most expensive defect class is two authorities answering
 * DIFFERENT questions under SIMILAR names, then being "reconciled" into one
 * (CLAUDE.md trap 21 — #709 and #737 recreated a harm between them in a day
 * for exactly this reason). So the question is written down first, and every
 * neighbouring question is named and disclaimed.
 *
 *   ⭐ SEPARABILITY asks: **is the ORDERING of these options a property of the
 *      model, or an artefact of the draw?**
 *
 * It is answered from the shape of the win-probability field alone.
 *
 * WHAT IT IS NOT:
 *
 *  1. NOT `nearTieReasonByMargin` (robustness-honesty.ts) — *"is the TOP-TWO
 *     gap ≤ 1pp, or did the producer flag a tie?"* That is a PAIRWISE question
 *     about the top of the field, it OWNS the "effectively tied" copy, and it
 *     is deliberately narrow. A four-way field at 0.297 / 0.26 / 0.25 / 0.193
 *     has a 3.7pp top-two gap: not a near-tie by that authority, and correctly
 *     so — yet nothing in the model separates those four. Separability sees the
 *     whole field; near-tie sees the top two. Neither subsumes the other and
 *     this module never emits near-tie copy.
 *
 *  2. NOT `hasMeaningfulLead` / MIN_LEAD_PROBABILITY — *"is the leader strong
 *     and clear enough for a CONFIDENT claim?"* That gate decides which
 *     ENRICHED shape to emit. Failing it does not currently withhold anything:
 *     a leader below the confidence floor lands on the bare Case E floor,
 *     `"{Label} currently leads."` — which is the most confident-READING
 *     sentence in the grammar precisely because every statistic and every hedge
 *     has been stripped from it. Separability is the authority that says the
 *     leader must not be NAMED at all.
 *
 *  3. NOT the three constraint verdicts — *"was the user's ratified hard
 *     condition honoured / checked / reconcilable?"* Questions about the
 *     EVIDENCE gathered on a well-formed field.
 *
 *  4. NOT `intake_options_missing` — *"does the candidate set match what the
 *     user ENUMERATED?"* A question about the INTAKE.
 *
 *  5. ⭐⭐ NOT PROVENANCE, AND THIS ONE IS A RULING, NOT AN OVERSIGHT.
 *     *"Did the user supply these numbers, or did Olumi invent them?"* is a
 *     REAL and SEPARATE question, owned elsewhere (the unset-option-effect
 *     disclosure and the result-surface defaulted-value work), and its ruled
 *     answer is CAVEAT, NOT WITHHOLD — withholding on invented numbers would
 *     destroy the "argue with a first model" loop the product is built on.
 *     The two questions are orthogonal in both directions:
 *
 *       - a model can be entirely Olumi-authored AND decisively separable
 *         ⇒ caveat it, KEEP the winner (their job, not this module's);
 *       - a model can be built from the user's own numbers AND near-uniform
 *         ⇒ WITHHOLD the winner (this module's job, whatever the provenance).
 *
 *     **Nothing in this file may read a provenance, confidence, source or
 *     defaulted marker.** Its entire input is a list of probabilities. If a
 *     later change wants one, that is the other authority's predicate and
 *     merging them is how one parameter ends up guarding two harms.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY TWO PARAMETERS AND NOT ONE.
 *
 * One threshold here would guard two OPPOSITE harms, which is the shape this
 * codebase has paid four consecutive rounds for on a different predicate:
 *
 *   - withhold too eagerly ⇒ a genuinely decisive run goes quiet. A GAP.
 *   - withhold too little  ⇒ we keep naming a winner on a flat field. A LIE,
 *                            and it is today's behaviour.
 *
 * A single dispersion cut trades one directly for the other, so each harm gets
 * its OWN parameter and the verdict is their CONJUNCTION — which fails toward
 * TODAY'S BEHAVIOUR (keep the winner), the reversible direction:
 *
 *   P1 {@link MIN_FIELD_SEPARATION} — the LEADER must be lifted off a uniform
 *      field. Guards the LIE. It is scale-free in the number of options, which
 *      a raw probability floor cannot be: a leader on 0.55 of two options and
 *      one on 0.297 of four options are the same weak separation, and no single
 *      probability threshold describes both.
 *
 *   P2 {@link contenderBandProbability} — a RIVAL must be genuinely level with
 *      the leader. Guards the GAP. A leader clearly ahead of everyone is never
 *      silenced just because the tail is crowded: 0.34 / 0.22 / 0.22 / 0.22 is
 *      barely off uniform (P1 fires) but nothing is level with the leader
 *      (P2 does not), so the winner stands.
 *
 * They bite on different populations, and each one's opposite-direction twin is
 * pinned in the test file. Neither is a restatement of the other.
 *
 * ⚠⚠ A MEASURED CONSEQUENCE OF THE `n_eff` REPAIR, DISCLOSED RATHER THAN BURIED,
 * BECAUSE IT CHANGES HOW THE CONJUNCTION BEHAVES AND A REVIEWER MUST SEE IT.
 * Over 200,000 random fields (n = 2..8), the two parameters' populations move
 * like this:
 *
 *                        P1 fires alone   P2 fires alone   both fire
 *     raw-count P1          20,274           17,977          75,817
 *     n_eff     P1          47,058                0          93,794
 *
 * P2 STILL SAVES WINNERS FROM P1 — that population GREW, and it is the GAP
 * guard, so the direction the design most cares about is strengthened. What
 * NARROWS is the reverse: P1 saving a winner that P2 would withhold.
 *
 * ⚠⚠ AND THE PRECISE WIDTH OF THAT CLAIM MATTERS, BECAUSE THE FIRST DRAFT OF
 * THIS PARAGRAPH GOT IT WRONG. The 0 above is a SAMPLING RESULT over fields of
 * n = 2..8; it is NOT a proof of emptiness, and reading it as one is exactly
 * the over-generalisation this estate keeps paying for. Searched directly, the
 * population is NON-EMPTY: `[0.337, 0.288, 0.0625 x 6]` has a rival 0.049
 * inside the band and separation 0.150054, so P1 keeps its winner. What is TRUE
 * is that the population is drastically narrowed — the highest separation
 * reachable with a rival inside the band falls from 0.427 under the raw count
 * to 0.171 under the effective size, and it needs a wide field with an even
 * tail (n >= 8), a shape the producer has never emitted (its measured fields
 * are n in {2, 3, 4}).
 *
 * So: the conjunction is NOT collapsing — the verdict still requires both, both
 * populations are non-empty, and the fail-safe is unchanged. P1 has stopped
 * licensing the claim it exists to suppress across most of the range where it
 * used to. Every field in the vacated part has a rival within `band` of the
 * leader, and the refuted counterexamples were drawn FROM it.
 * ⚠ Measured, in the same runs: the structural guarantee below is intact —
 * 0 of 67,580 confident runs (p_max ≥ 0.4, margin ≥ band) are withheld — and
 * 0 of the 21 committed runs change verdict. **If a later reader wants P1 to
 * resume saving winners on a flat field, that is a PRODUCT decision about
 * naming leaders the model cannot separate, not a tuning question.**
 *
 * ⚠ P2 IS DERIVED, NEVER MINTED. The contender band IS the module's existing
 * `MIN_LEAD_MARGIN`, passed in by the caller rather than re-declared here. That
 * is deliberate and it buys a STRUCTURAL non-regression guarantee, not a
 * measured one: a run that currently emits a confident headline (cases A/B/C/D)
 * has already cleared a margin ≥ MIN_LEAD_MARGIN, so no rival can be inside the
 * band, so {@link isFieldUnseparable} CANNOT return true for it. Class-a and
 * class-c decisive runs are safe by construction, not by corpus. A second,
 * independently-tuned constant here would have thrown that guarantee away.
 */

/**
 * P1 — how far the leader must be lifted off a uniform field before its
 * ordering counts as a property of the model.
 *
 * ⭐ THIS IS A JUDGEMENT AND IT IS STATED PLAINLY SO A REVIEWER CAN ATTACK IT.
 * The statistic is normalised excess concentration:
 *
 *     separation = (p_max − 1/n) / (1 − 1/n)
 *
 * 0 when the leader sits exactly at uniform, 1 when it takes everything, and
 * scale-free in the field size. ⚠ The size in that formula is the EFFECTIVE
 * field size (see {@link effectiveFieldSize}), not the raw count, so the
 * induced probability floor below is indexed by `n_eff` and a field with a
 * low-mass tail sits at a SMALLER effective size than its option count:
 *
 *     n_eff = 2  ⇒  p_max ≥ 0.575
 *     n_eff = 3  ⇒  p_max ≥ 0.433
 *     n_eff = 4  ⇒  p_max ≥ 0.363
 *     n_eff = 5  ⇒  p_max ≥ 0.320
 *
 * WHAT BOUNDS THE CHOICE. It has to sit above the measured open-brief shape
 * (a four-way field led at 0.297 scores 0.063) and below the decisive briefs
 * the product must not touch (a three-way led at 0.62 scores 0.43; a four-way
 * led at 0.45 scores 0.267). 0.15 sits inside that interval with room on both
 * sides rather than hugging either edge.
 *
 * ⚠ WHAT MAKES A WRONG VALUE SURVIVABLE, and it is the reason to review the
 * CONJUNCTION rather than this number in isolation: because P2 must also fire,
 * this constant cannot silence any run that currently emits a confident
 * headline, at ANY value up to 1. Set it too high and the only runs newly
 * withheld are ones already landing on the bare Case E floor; set it too low
 * and the change simply does less. The blast radius of getting it wrong is
 * bounded by the second parameter, by construction.
 *
 * ⚠ NOT A CLIFF-FREE DESIGN, AND NOT CLAIMED TO BE. A field one hair either
 * side of the floor gets opposite treatments. That is honest for a threshold
 * whose two sides are "name a winner" and "do not"; what it must not do is
 * trade the two harms against each other, and the conjunction is what stops it.
 */
export const MIN_FIELD_SEPARATION = 0.15;

/**
 * The number of options a field must hold before separability is even a
 * question. With one option there is no ordering to be an artefact of, and a
 * single-option source has no rival for P2 to find, so the predicate is
 * vacuous rather than false there. Stated as a constant so the vacuity is
 * visible instead of implied by an array index.
 */
export const MIN_FIELD_SIZE = 2;

/**
 * ⭐⭐ THE LIVE FIELD — the options still in contention.
 *
 * ⚠ WHAT THIS FILTER IS, AND WHAT IT IS NO LONGER CARRYING ALONE. It was
 * introduced at `c4a8670d` to close a count-inflation hole found by independent
 * review at `9afa8699`, and it closed that hole EXACTLY AT ZERO but only at the
 * ceiling's edge above it — a later review refuted the general claim, and the
 * REFERENCE POINT has since been made mass-weighted to fix the mechanism
 * properly (see {@link effectiveFieldSize}). This filter is retained because it
 * still does a job the reference cannot: it keeps arms the product has publicly
 * called eliminated out of P2's CONTENDER COUNT, and it keeps one definition of
 * "cannot win" in one place. The original finding, kept because it is the
 * clearest statement of the mechanism: P1's reference point was the uniform
 * share `1/n`, so it was a function of HOW MANY OPTIONS ARE COUNTED. Take the captured field
 * this gate correctly withholds — 0.3045 / 0.2895 / 0.2177 / 0.1883 — and
 * append TWO ZERO-WIN OPTIONS. Every original probability, the total mass, the
 * top-two gap, the leader id and the producer's own `near_tie.is_tie` are
 * unchanged. But `n` moves 4 → 6, the uniform reference drops 0.25 → 0.1667,
 * and separation rises **0.072667 → 0.165400**, clearing the floor. P2 is no
 * help: the contender count stays 2, because an option on zero is nowhere near
 * the leader. The product then emitted:
 *
 *   "Selling to the Wrong Customers currently leads. 2 options are effectively
 *    eliminated (each scored highest in less than 1% of runs)."
 *
 * **It declared those arms dead and then let them buy back permission to name
 * the very winner this gate exists to suppress.** Padding a close field with
 * options that cannot win is not evidence about the options that can.
 *
 * ⭐ THE REMEDY IS THE PRODUCT'S OWN VOCABULARY, NOT A NEW THRESHOLD. The
 * sentence above is generated from {@link ELIMINATED_WIN_PROBABILITY_CEILING}
 * in `analysis-result-headline.ts` — the module ALREADY has a definition of
 * "cannot win" and already tells the user which arms meet it. The statistic is
 * simply made to count the same options the product says are still in play.
 * One vocabulary, one definition, no second constant.
 *
 * ⚠ WHAT WAS DELIBERATELY NOT DONE, because both fit the counterexample
 * instead of fixing the invariant, and a threshold tuned to a counterexample is
 * the oscillation pattern this estate has already paid four rounds for:
 * `MIN_FIELD_SEPARATION` is UNCHANGED at 0.15, and there is no special case for
 * six options or for any field size.
 *
 * ⚠ THE PROPERTY THIS BUYS, STATED EXACTLY — it is narrower than "n-invariant"
 * and must not be quoted as more. Adding or removing any number of options that
 * the product itself classifies as effectively eliminated cannot change EITHER
 * PARAMETER, exactly, because they are filtered before either is computed.
 * ⚠ THAT IS A STATEMENT ABOUT ARMS BELOW THE CEILING AND NOTHING ELSE. It was
 * once quoted as containment for the whole padding class and that was REFUTED:
 * two arms at exactly 1.0% restored the winner claim on this module's own
 * oldest evidence. What contains the class now is the mass-weighted reference,
 * not this filter — do not let this paragraph be read as more than it says.
 *
 * @param ceiling the elimination ceiling, supplied by the caller
 *   (`ELIMINATED_WIN_PROBABILITY_CEILING`) so this file never mints a rival
 *   definition of "cannot win" — the same derive-don't-mirror rule the
 *   contender band follows, and for the same reason.
 */
export function liveField(
  probabilities: readonly number[],
  ceiling: number,
): readonly number[] {
  return probabilities.filter((p) => p >= ceiling);
}

/**
 * ⭐⭐ THE EFFECTIVE FIELD SIZE — how many options the mass actually supports.
 *
 * ⚠ THE HOLE THIS CLOSES, found by independent review at `c4a8670d` and
 * confirmed twice (a wider review and an independent triage reproduction), NOT
 * by this author's corpus. The previous reference point was the RAW COUNT of
 * live options, so P1 was a step function of a hard magnitude threshold. Every
 * arm at or above {@link liveField}'s ceiling counted for a whole option, no
 * matter how little mass it carried. Measured through the real builder on the
 * March-2026 capture `0.353 / 0.347 / 0.300` — a 0.6pp three-way dead heat:
 *
 *   arm at 0.00999  ⇒  separation 0.018921  ⇒  WITHHELD
 *   arm at 0.01000  ⇒  separation 0.182425  ⇒  "…currently leads."
 *
 * **One thousandth of probability on a nearly-dead arm moved the statistic
 * nine-fold and flipped the verdict.** And it was not adversarial: the producer
 * emits live arms at 0.0108, 0.0134, 0.0163, 0.0202 and 0.0212 — five of them
 * inside the interval the old tests never touched. The corpus could not see it
 * because no measured run combines a near-ceiling arm with a flat top.
 *
 * ⭐ THE REMEDY IS A COUNT THAT WEIGHTS BY MASS, NOT A NEW THRESHOLD. The
 * inverse-Simpson effective count (the Hill number of order 2) is the standard,
 * parameter-free answer to "how many categories does this distribution
 * effectively hold":
 *
 *     n_eff = (Σp)² / Σp²
 *
 * An arm carrying 1% of the mass contributes ~1% of an option to the reference
 * instead of a whole one, and it does so CONTINUOUSLY — which is what kills the
 * whole padding attack class rather than one instance of it. Measured on the
 * realistic population (the 21 committed runs plus the March capture, padded
 * with the tail magnitudes the producer actually emits): padding flipped a
 * withheld field into a named winner in **80 of 108 cases before, 0 of 108
 * after**.
 *
 * ⚠ WHAT WAS DELIBERATELY NOT DONE. `MIN_FIELD_SEPARATION` is UNCHANGED at
 * 0.15; there is no special case for any field size; no constant is minted
 * here. A variant that rounded the effective count back up to an integer
 * (`min(n, ceil(n_eff))`) was measured and REJECTED: it preserves more of the
 * old statistic but re-introduces the integer cliff one step along, and still
 * leaked on 5 of the same 108 realistic cases, at magnitudes the producer
 * emits (0.0202, 0.0424, 0.0425). Fitting the shape of the counterexample
 * instead of the invariant is the oscillation pattern this estate has already
 * paid four rounds for.
 *
 * ⚠ THE CLAIM AT ITS TRUE WIDTH. This is NOT exact invariance to added
 * options, and must not be quoted as more. A LIVE option still moves the
 * reference — by design, because a real contender is real information about how
 * separated a field is. What changed is that its influence is now proportional
 * to the mass it carries, so no arm can buy a whole option's worth of reference
 * with a thousandth of probability. Options at exactly zero remain EXACTLY
 * invariant (they add nothing to either sum), which is the property
 * {@link liveField} was introduced for and which is unchanged.
 */
export function effectiveFieldSize(probabilities: readonly number[]): number {
  const n = probabilities.length;
  let sum = 0;
  let sumOfSquares = 0;
  for (const p of probabilities) {
    sum += p;
    sumOfSquares += p * p;
  }
  if (!(sumOfSquares > 0)) return n;
  const effective = (sum * sum) / sumOfSquares;
  if (!Number.isFinite(effective)) return n;
  // Cauchy-Schwarz puts `effective` in [1, n] for any non-negative field, so
  // both clamps are for IEEE-754 noise at the endpoints and for the degenerate
  // near-certain field, where `effective` approaches 1 and would send the
  // uniform reference to 1 (and the denominator below to 0). A field of at
  // least MIN_FIELD_SIZE real options is never narrower than MIN_FIELD_SIZE.
  if (effective < MIN_FIELD_SIZE) return MIN_FIELD_SIZE;
  return effective > n ? n : effective;
}

/**
 * Normalised excess concentration of the field — P1's statistic.
 *
 *     separation = (p_max − 1/n_eff) / (1 − 1/n_eff)
 *
 * Returns `null` when the field is too small to have a shape, so a caller can
 * distinguish "not separated" from "not answerable". Never throws; never reads
 * anything but the numbers it is given.
 *
 * ⚠ The size guard is on the RAW length, not the effective one: whether a field
 * is ANSWERABLE is a question about how many options exist, not about how much
 * mass they carry. Only the REFERENCE POINT is mass-weighted.
 *
 * @param probabilities usable win probabilities from ONE accepted source
 *   (finite, in [0, 1]). Same-source is the caller's invariant — mixing
 *   sources is the cross-source defect `resolveWinner` exists to prevent.
 */
export function fieldSeparation(
  probabilities: readonly number[],
): number | null {
  const n = probabilities.length;
  if (n < MIN_FIELD_SIZE) return null;
  const uniform = 1 / effectiveFieldSize(probabilities);
  let max = probabilities[0] as number;
  for (const p of probabilities) if (p > max) max = p;
  // `effectiveFieldSize` is clamped at MIN_FIELD_SIZE, so `uniform` is at most
  // 0.5 and `1 − uniform` is at least 0.5; the division below cannot blow up.
  const raw = (max - uniform) / (1 - uniform);
  if (!Number.isFinite(raw)) return null;
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}

/**
 * P2 — how many options are level with the leader, the leader included.
 *
 * "Level" means within `band` of the maximum, in probability space. A count of
 * 1 means the leader stands alone at the top of the field; 2 or more means the
 * model holds at least one rival it cannot tell apart from the leader.
 *
 * @param band the contender band, in probability space. Supplied by the caller
 *   (it is the headline module's `MIN_LEAD_MARGIN`) so this file never mints a
 *   rival constant — see the header on why that derivation is load-bearing.
 */
export function contenderBandProbability(
  probabilities: readonly number[],
  band: number,
): number {
  const n = probabilities.length;
  if (n === 0) return 0;
  let max = probabilities[0] as number;
  for (const p of probabilities) if (p > max) max = p;
  let count = 0;
  // ⚠ STRICT `<`, AND THE STRICTNESS IS LOAD-BEARING — corrected after an
  // independent triage found the previous `<=` made this comment FALSE at the
  // bytes. `hasMeaningfulLead` rejects on `margin < MIN_LEAD_MARGIN`, so a
  // margin of EXACTLY `band` is MEANINGFUL there. Counting that same rival as
  // "level" here made the two authorities disagree on precisely the boundary
  // they share — and that disagreement is not cosmetic: it is the one input on
  // which a run that qualifies for a confident headline could also be withheld,
  // which is exactly the structural guarantee the header claims. With `<` the
  // two are exact complements and the guarantee holds at the boundary too.
  // No epsilon: the guarantee is about agreeing with `hasMeaningfulLead`, and
  // an epsilon here would re-open the same gap one float along.
  for (const p of probabilities) if (max - p < band) count += 1;
  return count;
}

/** Why a field was judged unseparable, for the caller's telemetry reason. */
export interface SeparabilityVerdict {
  /** True when the ordering is not supportable as a property of the model. */
  readonly unseparable: boolean;
  /** P1's statistic, or null when the field was too small to answer. */
  readonly separation: number | null;
  /** P2's count: options level with the leader, leader included. */
  readonly contenders: number;
}

/**
 * ⭐ THE VERDICT. Unseparable iff BOTH parameters fire:
 *
 *   P1  the leader is not lifted off uniform by {@link MIN_FIELD_SEPARATION},
 *   P2  AND at least one rival sits within `contenderBand` of it.
 *
 * The conjunction is the whole design. Either condition alone is a single
 * threshold guarding two opposite harms; together each guards one.
 *
 * ⚠ FAIL-SAFE DIRECTION IS "SEPARABLE". An unanswerable field (fewer than
 * {@link MIN_FIELD_SIZE} entries) returns `unseparable: false`, so a thin or
 * degenerate envelope keeps today's behaviour rather than acquiring a new
 * silence. This module can only ever REMOVE a winner claim on evidence it
 * positively holds — it never withholds because something was missing.
 */
export function isFieldUnseparable(
  probabilities: readonly number[],
  contenderBand: number,
  eliminatedCeiling: number,
): SeparabilityVerdict {
  // ⭐ BOTH parameters are computed over the LIVE field, never the raw one.
  // Filtering once, here, is what makes the zero-tail invariance exact rather
  // than approximate: neither P1's reference point nor P2's count can see an
  // option the product has already called eliminated. See `liveField`.
  const live = liveField(probabilities, eliminatedCeiling);
  const separation = fieldSeparation(live);
  const contenders = contenderBandProbability(live, contenderBand);
  if (separation === null) {
    return { unseparable: false, separation, contenders };
  }
  return {
    unseparable: separation < MIN_FIELD_SEPARATION && contenders >= 2,
    separation,
    contenders,
  };
}
