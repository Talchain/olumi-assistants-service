/**
 * WHO STARTED THIS ANALYSIS — the one authority on run initiation.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * Since R2 (2026-08-16) a `run_analysis` fact can be committed WITHOUT the user
 * asking for one: `scheduleAutoRunAfterFreshDraft` dispatches a server-initiated
 * provisional run after every admissible fresh draft
 * (`handlers/auto-run-after-draft.ts`, single call site `orchestrator/route-v2.ts`).
 *
 * ⚠⚠ DELETED BY #1298 AND RESTORED THE SAME DAY (2026-09-01) — HISTORY KEPT
 * RATHER THAN OVERWRITTEN (trap 14), BECAUSE THE DELETION'S RATIONALE READS AS
 * SETTLED AND IS NOT. #1298 removed this writer, reasoning from the founder's
 * verdict ("far too focused on the analysis rather than enhancing reasoning")
 * that the auto-run was the mechanism. **The founder corrected that directly:**
 * the initial analysis is deliberate — it exists to give richer material for
 * critical and creative thinking — and the real defect was that we never made
 * clear the pass is AI-ONLY and UNCONFIRMED. The behaviour is restored verbatim
 * from `cb36b1ea^`; the labelling is the part that changed
 * (`AUTO_RUN_PROVISIONAL_DISCLOSURE` in `handlers/chip-click-dispatch.ts`).
 * ⭐ Do not re-derive #1298's conclusion from this module's shape.
 *
 * ── ⭐ ONE PRODUCER, MEASURED — NOT ASSUMED ────────────────────────────────
 * The hazard #1298 flagged is that a restored writer would give
 * `enrichment.run_provenance` TWO producers (this estate's chronic defect).
 * MEASURED at the restore commit with `rg -a` over `src/` + `tests/`, with the
 * contrast control in the same sweep: while the writer was deleted there were
 * ZERO production callers of {@link buildAutoRunProvenance} (only two spec
 * files, `coaching-auto-run-delivered` and `coaching-phantom-prior-run`), so
 * restoring `stampAutoRunProvenance` returns the count to EXACTLY ONE, which is
 * the pre-#1298 shape. Same result for the wire signal it carries: `running`
 * had ZERO producers of `run_state.kind === 'running'` while the contrast
 * control `kind: 'never_run'` read one (`compose/analysis-state-v1.ts`), so the
 * restored `autoRunInFlight` thread is again the single producer named in L-A.
 * ⚠ If you add a second writer of either, you have reopened the defect —
 * this module is the one owner and both ends import from here.
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
 * scenario read leg) returns no analysis at all. ⚠ THAT MEASUREMENT IS NOW
 * HISTORY, and is kept because it is the evidence #1058 rests on: CEE #1010
 * (producer) shipped the read leg and UI #752 (consumer) renders it, so the
 * auto-run's result CAN reach the user, and does on the `delivered` outcome.
 * ⚠⚠ "CAN" IS THE LOAD-BEARING WORD, and reading it as "does" is what re-opened
 * #1058 on 2026-09-11: the hook has five outcomes and only one of them is
 * delivery. See the delivery section below for why the constant is therefore
 * fail-closed, and for the receipt that would answer the question properly.
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
 * ── WHY THIS IS STILL A CONSTANT: THE DERIVED SUCCESSOR WAS ATTEMPTED AND LOST ─
 * The successor #1010 recommended — have UI #752's read request carry a
 * client-capability marker and have `routes/scenario-graph-analysis-read.ts`
 * record delivery only when a capable client was served — was scoped at CEE's
 * tip `33c97cf` and UI #752's head `fe1944af`. It fails on TWO independent
 * grounds, and the second is fatal on its own:
 *
 *   1. THERE IS NOWHERE TO WRITE THE RECORD. `v5_handler_facts` is append-only
 *      in code: of the `SessionStore` methods, nine WRITE (`append`,
 *      `claimTurnFence`, `markTurnStopped`, `invalidateScoped`, `invalidateAll`,
 *      `storeDraftGraph`, `ensureScenarioExists`, `markGraphWriteFailed`,
 *      `resolveScenarioDraftLoss`) and the three that name a fact
 *      (`readFactsFor`, `readFactsWithTurnFor`, `readNewestAnalysisFactFor`) are
 *      ALL reads. `supabase-store.ts` issues exactly two `.update(` calls, both
 *      on `v5_turn_fence`, neither on the facts table. So a delivery stamp needs
 *      a new column or table, a migration, a new store method and every mock
 *      updated — a new persistence seam, not a wiring job.
 *
 *   2. ⭐ EVEN WITH THAT SEAM, THE READ LEG CANNOT KNOW. Delivery happens AFTER
 *      the response is sent: `canvas/hydrate/applyScenarioAnalysisRead.ts`
 *      decides client-side and returns `applied | alreadyHeld | notYet`, and the
 *      hook around it returns `delivered | already_held | deadline | aborted |
 *      unreadable`. A marker on the REQUEST proves only that a capable client
 *      ASKED. Recording on it would stamp "delivered" for every `deadline` and
 *      `aborted` outcome — which is recording capability, the one thing a
 *      delivery record must not do.
 *
 * THE SMALLEST ENABLING CHANGE, therefore, is not on the read leg at all: the
 * truth exists only in the client, so the client must report it. A DELIVERY
 * RECEIPT on the NEXT TURN's request — the UI naming the run whose result it
 * actually applied — needs no persistence (it rides the existing
 * `V5RequestExtensionsSchema` slice, whose strip-list is derived from
 * `Object.keys(...shape)` and drift-checked by
 * `tests/contract/v5-extension-fields-derived.test.ts`) and derives correctly at
 * every deploy state: an old UI sends no receipt and reads as not-delivered,
 * which is exactly today's behaviour, so CEE can ship FIRST with no window at
 * all. It was NOT built here because it is a new turn-wire field plus threading
 * through both dispatch paths — a different design from the one briefed, and the
 * scope-expansion rule says re-brief rather than expand.
 *
 * ⚠⚠ SO A `true` CONSTANT NARROWED #1058 RATHER THAN CLOSING IT, and the residual
 * it left was WITNESSED ON THE DEPLOYED BUILD on 2026-09-11 — which is why the
 * constant now reads `false`. `useProvisionalAnalysisDelivery` arms ONLY on a
 * `running` verdict and gives up at 60 s, so a user who reloads or navigates away
 * inside the ~20 s run sees nothing while the constant asserted they saw it:
 * their next manual run was narrated "The result is unchanged", #1058's witnessed
 * sentence, on a first-ever analysis. The `deadline` / `aborted` / `unreadable`
 * paths are that residual, and the receipt above is what closes them properly.
 *
 * ⚠ ONE PREMISE IN THE SENTENCE ABOVE WAS STALE AND IS CORRECTED IN PLACE (2026-09-11).
 * It read "UI #752 leaves `hydrate/serverGraphHydration.ts` UNTOUCHED". At the
 * DEPLOYED UI build `b93904c9` that file is NOT untouched: it imports
 * `applyBootAnalysisVerdict` / `applyBootLeaderClaimWithholding` at line 25.
 * ⭐ THE CONCLUSION SURVIVES, and only the premise moved: `'running'` is in that
 * file's BOOT-DECLINED set, and the file writes no analysis RESULTS at all
 * (target 0; the contrast control `useCanvasStore` reads 9 in the same file, so
 * the sweep is not blind). So the BOOT path still never applies the analysis, and
 * the residual is unchanged. Recorded rather than silently deleted, because a
 * future session reading the stale premise would conclude the residual had closed.
 */

/**
 * Does a post-draft auto-run's RESULT reach the user?
 *
 * ⭐⭐ `false` — FAIL CLOSED. It read `true` from the flip that landed alongside
 * UI #752, and that posture was REFUTED BY A SECOND WITNESS ON THE DEPLOYED
 * BUILD, 2026-09-11: a journey witness saw a model's FIRST-EVER successful
 * analysis open with "The result is unchanged: <option> still leads", when both
 * prior runs had REFUSED and the panel had been reading "No analysis has run yet
 * for this model". That is #1058's witnessed sentence, verbatim, twenty-three
 * days after #1058 closed it.
 *
 * ⭐ THIS CONSTANT IS AN ESTATE-WIDE CLAIM ABOUT A CHANNEL, NOT A PER-USER
 * OBSERVATION, and that is the whole defect. The channel exists — CEE #1010
 * (`routes/scenario-graph-analysis-read.ts`) and UI #752
 * (`canvas/hooks/useProvisionalAnalysisDelivery.ts` +
 * `canvas/hydrate/applyScenarioAnalysisRead.ts`) are both live — but "the channel
 * can deliver" and "this user received it" are different questions, and only the
 * first one is answerable here. The hook arms only on a `running` verdict, gives
 * up at 60 s, and returns `delivered | already_held | deadline | aborted |
 * unreadable`; the boot path applies no analysis at all. On every outcome but the
 * first, `true` asserted a delivery that did not happen.
 *
 * ⭐ THE TRADE THIS INVERSION BUYS, PRICED RATHER THAN HIDDEN. `false` costs the
 * re-run acknowledgement to users who genuinely DID see the provisional result:
 * their second analysis is narrated as their first ("Your first analysis is
 * ready") and they lose the delta, the attribution and the inert-edit
 * explanation. That is a real loss and it is not rare. It is still the right side
 * of the trade, and it is the estate's standing ruling: under-claiming tells a
 * user less than we know, whereas over-claiming asserts a comparison against
 * something they never saw — a fabrication about their own history, on the first
 * screen of the product.
 *
 * ⚠ NEITHER POSTURE IS CORRECT; ONE IS MERELY SAFE. The real answer is the
 * DELIVERY RECEIPT described in the block above — the UI naming, on its next
 * request, the run whose result it actually applied. Until that exists this
 * constant is a hand-maintained mirror of a per-user fact it cannot see
 * (CLAUDE.md trap #12), which is why BOTH postures are pinned by test rather than
 * left to be remembered: `coaching-phantom-prior-run.test.ts` is now production
 * and `coaching-auto-run-delivered.test.ts` carries the injected counterfactual.
 */
export const AUTO_RUN_RESULT_REACHES_USER = false;

/**
 * Has this `run_analysis` fact's result been put in front of the user?
 *
 * FALSE for every non-`run_analysis` fact. TRUE for a user-initiated run — the
 * turn that ran it is the turn that displayed it. For an auto-initiated run the
 * answer is {@link AUTO_RUN_RESULT_REACHES_USER} — `false`, fail-closed, after the
 * delivered posture was refuted by a second deployed witness on 2026-09-11.
 * ⚠ That constant is an ESTATE-WIDE claim about a channel, not a per-user
 * observation, which is why it cannot be right in either direction: read its
 * block for the cost `false` charges to users who genuinely were served, and for
 * the delivery receipt that would make this a derivation instead of a posture.
 *
 * ⚠ SAYS NOTHING ABOUT WHETHER THE RUN PRODUCED ANYTHING. A `noop` fact did not
 * run, so nothing was displayed — but that is a different question again ("did
 * it run?"), owned by the caller. `hasPriorRunAnalysisShownToUser` in
 * `signals/coaching-signals.ts` applies its own `noop` exclusion alongside this
 * predicate, deliberately, so neither predicate answers two questions.
 *
 * @param autoRunResultReachesUser injectable ONLY so both postures can be pinned
 *        by test without module mocking. Production always takes the default.
 *        ⭐ It is also the ONLY discriminating handle either posture spec has now
 *        that the constant equals the delivered posture — a control asserting the
 *        constant's current value alone cannot fail (CLAUDE.md trap #12b).
 */
export function hasUserSeenRunAnalysisResult(
  fact: HandlerFact,
  autoRunResultReachesUser: boolean = AUTO_RUN_RESULT_REACHES_USER,
): boolean {
  if (fact.fact_type !== 'run_analysis') return false;
  if (!isAutoInitiatedRunAnalysisFact(fact)) return true;
  return autoRunResultReachesUser;
}
