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
