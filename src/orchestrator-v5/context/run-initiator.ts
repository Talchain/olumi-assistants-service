/**
 * WHO STARTED THIS ANALYSIS — the one authority on run initiation.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * Since R2 (2026-08-16) a `run_analysis` fact can be committed WITHOUT the user
 * asking for one: `scheduleAutoRunAfterFreshDraft` dispatches a server-initiated
 * provisional run after every admissible fresh draft
 * (`handlers/auto-run-after-draft.ts`, single call site `orchestrator/route-v2.ts`).
 * That fact is real, it is persisted, and it is the CURRENT analysis for the
 * graph — freshness and the analysis projection are right to read it.
 *
 * It is NOT, however, something the user has SEEN. Measured on the deployed
 * quartet (UI `2b6ec553`, CEE `19a60fd`, PLoT `fb63b03`, ISL `28fe0c9`) on
 * 2026-08-20: after a fresh draft landed, the browser issued ZERO requests for
 * 120 s, and the auto-run's stored disclosure sentence never appeared in the
 * DOM. The reason is structural, not a timing artefact — the draft's SSE stream
 * closes on a terminal COMPLETE frame, the auto-run turn is server-initiated and
 * has no client listening, and `routes/assist.v1.scenario-graph.ts` (the only
 * scenario read leg) returns no analysis at all. The two open PRs that would
 * change this are CEE #1010 (producer) and UI #752 (consumer); BOTH are
 * unmerged.
 *
 * So any surface whose copy presupposes the user has already seen a result must
 * ask "was this run the USER's?", and that question needs an answer that cannot
 * be guessed from the fact's shape. This module owns it.
 *
 * ── ONE OWNER, WRITER AND READER (CLAUDE.md trap #12) ───────────────────────
 * The marker vocabulary is defined HERE and imported by both ends:
 *   - the WRITER, `handlers/chip-click-dispatch.ts`'s `stampAutoRunProvenance`,
 *     builds its stamp from {@link buildAutoRunProvenance};
 *   - the READER, `signals/coaching-signals.ts`, tests it with
 *     {@link isAutoInitiatedRunAnalysisFact}.
 * Neither spells the literal `'auto_post_draft'`. A hand-copied string on one
 * side is precisely the drift this estate keeps paying for, and the round-trip
 * is additionally pinned by test (writer output → reader verdict) so agreement
 * survives a refactor that loses the shared import.
 *
 * ── WHY THE MARKER IS ON THE FACT AND NOT DERIVED FROM THE TURN ─────────────
 * The auto-run's turn carries `chip.id = AUTO_RUN_POST_DRAFT_CHIP_ID`, so the
 * initiator is derivable at the TURN level too — via `readFactsWithTurnFor` plus
 * a join back to the turn row. That path is strictly worse: it costs an extra
 * read on every coaching turn, it is only available on stores that implement the
 * optional method (mocks do not), and it reconstructs by JOIN a fact the
 * producer already states directly. `enrichment.run_provenance.initiated_by` is
 * written by the dispatch itself, is inside `z.record(z.unknown())` at every
 * published contract version (so no schemas change and no version bump), and
 * travels with the fact through commit and read-back.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

/**
 * The CEE-authored key stamped into the `run_analysis` fact's open `enrichment`
 * record when the run was auto-initiated after a fresh draft.
 *
 * Same carrier pattern as the decision_review enricher (a freshly-cloned record,
 * PLoT keys preserved). NO schema change: `enrichment` is `z.record(z.unknown())`
 * at every published contract version, so the stamp validates at the UI's
 * deployed pin and at 0.48.0 alike. It is NOT on the wire transport keep-list
 * (`P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` — which must stay element-for-element
 * equal to the schemas package's `CEE_UI_ENRICHMENT_KEEP_LIST`), so today's UI
 * sees an ordinary completed analysis: the graceful-degradation posture R2
 * requires. Surfacing it to the browser is a schemas-train keep-list change,
 * deliberately not made here.
 */
export const RUN_PROVENANCE_ENRICHMENT_KEY = 'run_provenance';

/**
 * The `initiated_by` value that means "the SERVER started this run after a fresh
 * draft; the user did not ask for it".
 *
 * A closed vocabulary of one. A user-initiated run carries NO provenance stamp
 * at all rather than an `initiated_by: 'user'` counterpart — so the reader must
 * treat "no marker" as user-initiated, which is the fail-SAFE direction for
 * every consumer added so far: an unrecognised or absent marker degrades to the
 * pre-R2 behaviour instead of silently suppressing a real prior run.
 */
export const AUTO_RUN_POST_DRAFT_INITIATOR = 'auto_post_draft' as const;

/** The stamp's shape. Built by {@link buildAutoRunProvenance}, read by
 *  {@link isAutoInitiatedRunAnalysisFact}. */
export interface AutoRunProvenance {
  readonly initiated_by: typeof AUTO_RUN_POST_DRAFT_INITIATOR;
  readonly provisional: true;
  readonly draft_turn_id: string;
}

/**
 * Build the provenance stamp for a post-draft auto-run.
 *
 * @param draftTurnId the fresh-draft turn this run was initiated for.
 */
export function buildAutoRunProvenance(draftTurnId: string): AutoRunProvenance {
  return {
    initiated_by: AUTO_RUN_POST_DRAFT_INITIATOR,
    provisional: true,
    draft_turn_id: draftTurnId,
  };
}

/**
 * Was this `run_analysis` fact produced by the SERVER's post-draft auto-run
 * rather than by the user?
 *
 * FALSE for every non-`run_analysis` fact, for an unstamped fact, and for a
 * stamp whose `initiated_by` is anything other than
 * {@link AUTO_RUN_POST_DRAFT_INITIATOR} — including a future initiator value
 * this build does not know. That asymmetry is deliberate: an unknown marker must
 * not be assumed to mean "invisible to the user". A false negative degrades to
 * pre-R2 behaviour; a false positive would suppress a run the user really saw.
 */
export function isAutoInitiatedRunAnalysisFact(fact: HandlerFact): boolean {
  if (fact.fact_type !== 'run_analysis') return false;
  const provenance = fact.result.enrichment?.[RUN_PROVENANCE_ENRICHMENT_KEY];
  if (provenance === null || typeof provenance !== 'object') return false;
  return (
    (provenance as Record<string, unknown>).initiated_by === AUTO_RUN_POST_DRAFT_INITIATOR
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SECOND QUESTION — "HAS THE USER SEEN THIS RUN'S RESULT?"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐⭐ THIS IS NOT THE SAME QUESTION AS {@link isAutoInitiatedRunAnalysisFact},
 * AND #1010 IS THE CHANGE THAT SEPARATES THEM (CLAUDE.md trap #21).
 *
 * Until this PR the two were COINCIDENT, and #1058 was right to decide delivery
 * from the provenance stamp alone: an auto-initiated run's result reached no
 * client at all, because the draft's SSE stream is already closed, the auto-run
 * turn is server-initiated with no listener, and the scenario-graph read leg
 * returned no analysis. "Auto-initiated" therefore entailed "never displayed".
 *
 * #1010 builds the delivery channel — `routes/scenario-graph-analysis-read.ts`
 * makes the scenario read leg return the committed analysis. Once the channel's
 * BOTH halves are live, an auto-initiated run's result IS on screen, the stamp
 * still reads `auto_post_draft`, and a provenance-only reader would suppress the
 * re-run acknowledgement — the product claiming a FIRST analysis on a genuine
 * re-run. That is #1058's defect facing the other way.
 *
 * So the two questions are named apart HERE, at the one authority on run
 * initiation, rather than by tightening the coaching predicate in place:
 *
 *   "was this run auto-initiated?"      → {@link isAutoInitiatedRunAnalysisFact}
 *                                         A PERMANENT fact about the run's
 *                                         provenance. Never changes. Unchanged
 *                                         by this PR.
 *   "has the user seen its result?"     → {@link hasUserSeenRunAnalysisResult}
 *                                         A fact about DELIVERY, which changes
 *                                         when the delivery channel goes live.
 *
 * ── WHY THIS IS A CONSTANT AND NOT A DERIVATION, STATED HONESTLY ────────────
 * CEE cannot derive delivery today. `readScenarioAnalysis` is a PURE READ — it
 * never mutates — so no trace of "this result was served" is persisted, and the
 * fact carries no delivery marker. The honest options were a constant or a
 * write-on-read, and a write-on-read would be WRONG at the intermediate deploy
 * state: it would stamp "delivered" the moment CEE serves the payload, while a
 * pre-#752 UI is still discarding it — re-opening #1058's defect in the window
 * between the two deploys. CLAUDE.md: *a guarantee that spans services is dark
 * until BOTH halves are live; check the copy is true at every intermediate
 * deploy state, not only the final one.*
 *
 * ⚠ A CONSTANT IS A HAND-MAINTAINED MIRROR (CLAUDE.md trap #12), so it is made
 * LOUD rather than left to be remembered: its value is asserted by test, and
 * BOTH postures of the predicate — and of the coaching signal above it — are
 * pinned by test NOW (`coaching-auto-run-delivered.test.ts`). Flipping it is a
 * one-line, reviewed change whose behaviour is already proven on both sides.
 *
 * ⭐ THE FULLY-DERIVED SUCCESSOR, deliberately NOT built here (scope-expansion
 * rule — it requires a change to UI #752, another lane's PR): have #752's read
 * request carry a client-capability marker, and have the read leg record
 * delivery only when a capable client was actually served. That derives at every
 * deploy state with no constant to flip. Recommended as the follow-up.
 */

/**
 * Does a post-draft auto-run's RESULT reach the user?
 *
 * `false` at this tip. The delivery channel needs both halves and only one is
 * merged: CEE #1010 (this PR — the read leg that returns the analysis) and UI
 * #752 (`canvas/hydrate/applyScenarioAnalysisRead.ts` — the consumer that
 * renders it). Verified 2026-08-20: that file is ABSENT from `DecisionGuideAI`
 * `staging` and PRESENT on #752's head `fe1944af`, and #752 is OPEN.
 *
 * ⭐ FLIP THIS TO `true` IN THE SAME CHANGE THAT MERGES UI #752, and not before.
 * Flipping it early re-opens #1058 (a first-ever analysis narrated as a re-run);
 * leaving it late leaves the inversion this block documents (a genuine re-run
 * narrated as a first analysis). Both directions are already under test.
 */
export const AUTO_RUN_RESULT_REACHES_USER = false;

/**
 * Has this `run_analysis` fact's result been put in front of the user?
 *
 * FALSE for every non-`run_analysis` fact. TRUE for a user-initiated run — the
 * turn that ran it is the turn that displayed it. For an auto-initiated run the
 * answer is {@link AUTO_RUN_RESULT_REACHES_USER}, because that class is visible
 * only once the delivery channel's both halves are live.
 *
 * ⚠ SAYS NOTHING ABOUT WHETHER THE RUN PRODUCED ANYTHING. A `noop` fact did not
 * run, so nothing was displayed — but that is a different question again ("did
 * it run?"), owned by the caller. `hasPriorRunAnalysisShownToUser` in
 * `signals/coaching-signals.ts` applies its own `noop` exclusion alongside this
 * predicate, deliberately, so neither predicate answers two questions.
 *
 * @param autoRunResultReachesUser injectable ONLY so both postures can be pinned
 *        by test without module mocking. Production always takes the default.
 */
export function hasUserSeenRunAnalysisResult(
  fact: HandlerFact,
  autoRunResultReachesUser: boolean = AUTO_RUN_RESULT_REACHES_USER,
): boolean {
  if (fact.fact_type !== 'run_analysis') return false;
  if (!isAutoInitiatedRunAnalysisFact(fact)) return true;
  return autoRunResultReachesUser;
}
