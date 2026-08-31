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
 * scale-free in `n`. The induced probability floor at each field size is:
 *
 *     n = 2  ⇒  p_max ≥ 0.575
 *     n = 3  ⇒  p_max ≥ 0.433
 *     n = 4  ⇒  p_max ≥ 0.363
 *     n = 5  ⇒  p_max ≥ 0.320
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
 * Normalised excess concentration of the field — P1's statistic.
 *
 * Returns `null` when the field is too small to have a shape, so a caller can
 * distinguish "not separated" from "not answerable". Never throws; never reads
 * anything but the numbers it is given.
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
  const uniform = 1 / n;
  let max = probabilities[0] as number;
  for (const p of probabilities) if (p > max) max = p;
  // `1 − uniform` is ≥ 0.5 for every n ≥ 2, so no division-by-zero guard is
  // reachable; the clamp below is for IEEE-754 noise at the endpoints only.
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
  // Strict `<=` against the raw difference. No epsilon: a value exactly `band`
  // below the leader is level with it by the same definition `hasMeaningfulLead`
  // uses to call the margin insufficient, and the two must not disagree on the
  // boundary they share.
  for (const p of probabilities) if (max - p <= band) count += 1;
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
): SeparabilityVerdict {
  const separation = fieldSeparation(probabilities);
  const contenders = contenderBandProbability(probabilities, contenderBand);
  if (separation === null) {
    return { unseparable: false, separation, contenders };
  }
  return {
    unseparable: separation < MIN_FIELD_SEPARATION && contenders >= 2,
    separation,
    contenders,
  };
}
