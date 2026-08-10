/**
 * ROADMAP 2.692 — INTERVENTION TIERS: what KIND of reasoning issue is most
 * worth resolving next.
 *
 * ── WHY THIS IS A NEW CONCEPT AND NOT A CONJUNCT ON THE OLD ONE ──────────────
 * `lens-selector.ts` answers ONE question: *"which coaching CARD occupies the
 * single proactive slot on this turn?"* — and it answers it with a flat
 * priority order over METHODS (sensitivity, pre-mortem, EVPI, …), locked by the
 * capability-layer brief. This module answers a DIFFERENT question: *"what kind
 * of ISSUE is most worth this team resolving next?"* Those two questions were
 * being answered by one ladder, which is why every new issue class had to fight
 * the method ladder for the slot and lost — three times, measured
 * (ROADMAP 2.490 `devils_advocacy` 0/5 sessions; 2.989 `fragile_edge_resolution`
 * 2/16 cells and 0/2 on a first analysis; and this lane's own measurement of the
 * resolved `p_win_sensitivity` signal, below). CLAUDE.md trap 21: when two authorities disagree,
 * write down the question each one answers before reconciling them — and if the
 * questions differ, name the concepts APART. That is what this file is.
 *
 * The tier is the OUTER, lexicographic ordering: first non-empty tier wins.
 * The locked method ladder survives UNCHANGED as the WITHIN-tier ordering, so
 * this file adds an ordering, it does not replace one.
 *
 * ── THE ORDER IS A DECISION, AND IT IS THE ONLY ONE THIS FILE MAKES ──────────
 * Design `NEXT-BEST-ISSUE-DESIGN-2026-08-08.md` §2.1 states the tier order is
 * *"a DECISION for Paul to ratify — the tiers are the design; the permutation is
 * his call"*, and its §5 OQ-1 asks precisely whether a resolve-class tier may
 * outrank the locked core three. {@link INTERVENTION_TIER_ORDER} is that
 * permutation, expressed as ONE named constant so ratifying or permuting it is a
 * one-line reviewed change rather than an archaeology exercise across a 1,600-
 * line ladder.
 *
 * ⚠⚠ THE MEASUREMENT THAT DECIDED IT — AND IT REFUTED THIS LANE'S OWN FIRST
 *     ANSWER. Recorded in full because the refutation IS the finding.
 *
 * Census at CEE `edcaa98b`, both COMMITTED captures × all `previousAnalysisLens`
 * states (the whole in-repo evidence base for this seam; a claim about THOSE
 * CAPTURES ONLY — never generalised to the 56-turn census, which is not in this
 * repo and was not replayed):
 *
 *   - `sensitivity_flip_risk` wins **7 of 8** session-b2 cells, INCLUDING the
 *     fresh first analysis (`prev = null`). On session-a it yields on its
 *     CORRELATED door and `consider_opposite` wins 6 of 8.
 *   - session-b2 carries **one `p_win_sensitivity` row ISL marks
 *     `status: 'resolved'`** — its own noise-floor test passed — and CEE has
 *     **zero consumers of that field**. (⚠ It is NOT value-of-information and
 *     must never be described as one; see `coaching/uncertainty-priority.ts`
 *     for the producer bytes and the premise they refute.)
 *   - Placed anywhere BELOW `orient`, the candidate was selected on **0 of 16**
 *     cells on these captures — ELIGIBLE-AND-OUTRANKED, never "dark": on
 *     session-b2 the trigger FIRED and it ranked third. That distinction is what
 *     made the copy gate blocking rather than academic: a run whose higher tiers
 *     are all silent would have put the text on a user's screen, and an
 *     adversarial review built exactly such an enrichment. **The lens has since
 *     been removed on the science ruling; the measurement is kept because it is
 *     what the tier order was chosen against, and because it is the evidence the
 *     re-add will be judged on.**
 *   - Placed ABOVE `orient` it is reachable — and this lane MEASURED what that
 *     costs, by shipping it that way first and running the existing suites:
 *     **it takes the head on every session-b2 cell, the no-repeat rule then
 *     degenerates to an `uncertainty ↔ sensitivity` 2-cycle, and `pre_mortem`,
 *     `devils_advocacy` and `fragile_edge_resolution` ALL go dark on that
 *     capture.** Nine assertions in `lens-dsk-sequence-2490.test.ts` went RED:
 *     it re-created ROADMAP 2.490's STARVATION SWAP verbatim — *"reordering
 *     chooses WHICH protocol is dark; it cannot surface both"* — one tier higher.
 *
 * ⭐ SO THE ORDER SHIPPED HERE IS THE RATIFIED-SAFE ONE, NOT THIS LANE'S
 *    PREFERENCE, and the trade-off is the deliverable rather than the code:
 *    `resolve_uncertainty` sits in the band BOTH prior designs ratified — below
 *    the locked core three, above `consider_opposite` (2.690 §B.3 sequencing,
 *    adopted by 2.692 §2.2). Restricted to the seven pre-existing lenses this
 *    order is **byte-identical to the locked ladder**: nothing is reordered,
 *    nothing is starved, and every 2.490 / 2.211 / 2.211-① pin holds.
 *
 * ⚠ AND THE OPEN QUESTION IS ANSWERED — WITH ITS SCOPE STATED, BECAUSE THE
 *   FIRST VERSION OF THIS PARAGRAPH OVERSTATED IT. 2.692 §5 OQ-1 asks whether a
 *   resolve-class tier may outrank the locked core three. The measured answer:
 *
 *     **On the two committed captures, no ordering surfaces the new class
 *     without starving an existing one; the class is reachable only when the
 *     orient / pre-mortem / estimate tiers are all silent.**
 *
 *   State it in exactly that form. An earlier revision of this comment
 *   generalised the same measurement into *"a single slot filled by a total
 *   priority order cannot absorb another intervention class"* — a claim about
 *   the ARCHITECTURE, drawn from two captures. **It is refuted by construction**:
 *   an adversarial review built a legitimate enrichment (spread influence,
 *   negligible flip risk, decisive leader, high confidence, one resolved row) on
 *   which the higher tiers are all silent and this class takes the slot at the
 *   order shipped here. The class IS absorbed — just not on any shape these two
 *   captures contain. This is CLAUDE.md trap 20 happening inside the record: the
 *   measurement was correctly scoped and the GENERALISATION was the defect.
 *
 *   What follows from the narrow claim, and no more: the ranked list is a
 *   first-class value (`rankInterventions`) and this order is ONE constant, so
 *   permuting it is a one-line reviewed change and
 *   `next-best-intervention.test.ts` re-measures the consequence. **Widening the
 *   slot is ONE candidate remedy, NOT an established necessity** — nothing here
 *   establishes that it is the only one. **Escalated with a corrected premise
 *   rather than shipped silently, per 2.490 doctrine.**
 *
 * ── SCOPE HONESTY ────────────────────────────────────────────────────────────
 * `resolve_disagreement` has NO members in this slice. It is declared because it
 * is the design's T1/T2 — an unanswered `edge_adjudication` override, and a
 * `validation.status === 'contested'` edge with no adjudication fact — whose
 * inputs (`prior_facts`, the persisted graph) live in `compose.ts`'s closure and
 * are NOT threaded to the selector today. Declaring the tier makes the extension
 * point real rather than retrofitted; implementing an evaluator with nothing
 * feeding it would ship a dark capability, which is the failure this whole file
 * is arguing against.
 */

import type { LensId } from '../compose/lens-selector.js';

/**
 * The issue KINDS, named for what the user is being asked to do about them.
 * Closed union — a new tier must be added to {@link INTERVENTION_TIER_ORDER}
 * too, and the exhaustiveness assertion at the bottom of this file fails the
 * BUILD if it is not (fail-loud on drift, never a silent default).
 */
export type InterventionTier =
  /** What this result rests on — a description, not a resolvable issue. */
  | 'orient'
  /** Imagine it went wrong and ask why (DSK-P-001). */
  | 'challenge_premortem'
  /** A disclosed-HEURISTIC estimate of where evidence would help. */
  | 'estimate'
  /** A disagreement the system itself surfaced and the team has not settled. */
  | 'resolve_disagreement'
  /**
   * An uncertainty the run's OWN statistics licensed as worth reducing.
   *
   * ⛔ NO MEMBERS, AND THAT IS A RULING — NOT AN EMPTY SLOT TO BE HELPFULLY
   * FILLED. A lens (`uncertainty_reduction_priority`, over ISL's
   * noise-floor-gated `p_win_sensitivity`) was built for this tier, reviewed,
   * measured, and REMOVED before merge because ISL's user-facing-language ban is
   * LIVE: its gating condition — "pending doctrine" — is unmet at ISL `staging`
   * `28fe0c95`, where the shipped constant is still
   * `EVPI_LABELLING_DOCTRINE = "provisional_doctrine_v0"`. The derivation, the
   * reviewed copy, the prohibition guard and the exact re-add checklist all
   * survive at `coaching/uncertainty-priority.ts`; its header carries the full
   * gate and what would lift it. **Populating this tier without clearing that
   * gate ships user-facing scientific copy past a live ban.**
   */
  | 'resolve_uncertainty'
  /** A ratified DSK protocol: argue the other side, or challenge the driver. */
  | 'challenge_protocol'
  /** A specific, identified thing in the model the platform can change. */
  | 'resolve_model_defect'
  /** Open-ended exploration — the last-resort filler. */
  | 'explore';

/**
 * THE LEXICOGRAPHIC TIER ORDER. First non-empty tier wins; within a tier the
 * locked method ladder decides. This constant IS the permutation the design
 * reserves for Paul (§5 OQ-1/OQ-2) — see the module header for the measurement
 * behind it and for the two disclosed demotions.
 */
export const INTERVENTION_TIER_ORDER: readonly InterventionTier[] = Object.freeze([
  'orient',
  'challenge_premortem',
  'estimate',
  'resolve_disagreement',
  'resolve_uncertainty',
  'challenge_protocol',
  'resolve_model_defect',
  'explore',
] as const);

/**
 * Lens → tier. Compile-EXHAUSTIVE over `LensId`: a new lens fails the build here
 * until it declares the kind of issue it is about. That is deliberate — the
 * defect this module exists to prevent is a new capability being appended to the
 * foot of a ladder without anyone deciding what kind of thing it is.
 *
 * Keyed by LENS, not by rationale. The one place a rationale changes the
 * strength of the claim — flip-risk's CORRELATED door, "the weakest rule-1 door"
 * — is ALREADY handled by the ratified 2.211-① correlated yield inside
 * `selectLens`, and re-expressing it here would be two authorities for one
 * decision (the `generateGraphHash`-twins shape).
 */
const TIER_BY_LENS: Readonly<Record<LensId, InterventionTier>> = Object.freeze({
  sensitivity_flip_risk: 'orient',
  pre_mortem: 'challenge_premortem',
  evpi_evidence_priority: 'estimate',
  // ⛔ `resolve_uncertainty` HAS NO MEMBER, DELIBERATELY — see the tier's own
  // note on {@link InterventionTier}. It is not an empty slot waiting to be
  // filled; it is a slot held open by a live science ban.
  consider_opposite: 'challenge_protocol',
  devils_advocacy: 'challenge_protocol',
  fragile_edge_resolution: 'resolve_model_defect',
  what_if_counterfactual: 'explore',
});

/** The tier a candidate competes in. Total over `LensId` by construction. */
export function tierForCandidate(lens: LensId): InterventionTier {
  return TIER_BY_LENS[lens];
}

/**
 * Rank of a tier in {@link INTERVENTION_TIER_ORDER}. Never `-1`: every member of
 * the union is in the order, asserted below at MODULE LOAD so a tier added to
 * the type but forgotten in the order fails LOUDLY at import rather than sorting
 * to the front by accident (a `-1` from `indexOf` would silently promote it).
 */
export function tierRank(tier: InterventionTier): number {
  return INTERVENTION_TIER_ORDER.indexOf(tier);
}

// Load-time completeness check. `TIER_BY_LENS` is compile-exhaustive over
// `LensId`, but nothing in the type system forces every tier VALUE to appear in
// the ORDER — that is the classic derived-guard blind spot (CLAUDE.md trap 12d:
// deriving a guard from a list proves the copies agree, never that the list is
// complete). This closes it from the OTHER direction, at runtime, for free.
for (const tier of Object.values(TIER_BY_LENS)) {
  if (!INTERVENTION_TIER_ORDER.includes(tier)) {
    throw new Error(
      `intervention-tiers: tier "${tier}" is assigned to a lens but missing from INTERVENTION_TIER_ORDER`,
    );
  }
}
