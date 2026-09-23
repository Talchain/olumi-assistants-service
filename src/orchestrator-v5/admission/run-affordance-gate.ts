/**
 * ⭐⭐ THE ONE PREDICATE FOR "MAY WE OFFER THE RUN AFFORDANCE?"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES, IN THE ESTATE'S OWN WORDS.
 *
 * `analysis-ready-helper.ts` published `may_run` specifically so consumers
 * would stop reconstructing an admission rule they cannot see, and its
 * docblock names this exact victim:
 *
 *   *"`status` answers 'is this model ready as it stands?'. The client gates
 *    its `run_analysis` chip on `status === 'ready'`, which is the STRICTER
 *    question — so on the turn where the readiness loop says 'that's enough to
 *    run, I'll leave the others out and say so' the chip is filtered out,
 *    because that turn is `needs_user_input` WITH an admitting run path."*
 *
 * And the schema states the consumer rule outright: *"gate the Run affordance
 * on `structurally_analysable` (or `may_run` — same value) and NEVER on
 * `status`"*, with *"absence means an older producer, never 'no'"*.
 *
 * The field shipped. FOUR CEE chip surfaces were never migrated, and every one
 * still read `status`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ MEASURED — and the first number I published was a sampling artefact.
 *
 * I measured 400 rows ordered by `updated_at DESC` and reported 27.0%.
 * Independent review re-derived it over the FULL population — all 15,255 rows
 * with a non-null `graph`, ordered by `id`, `threw: 0`:
 *
 *   gained the affordance: 3,168 (20.77%)
 *   lost it:               0
 *
 * The 27.0% was recency bias: `needs_user_input | may_run:false` is 1,962 in
 * the corpus against 13 in my slice. **20.77% is the number.** The
 * no-regression half survives at population scale, which is the half the
 * design rests on.
 *
 * ⚠ AND THE "BOTH DIVERGENT CELLS ARE EMPTY" CLAIM WAS FALSE.
 * `(status: 'ready', may_run: false)` is NOT empty — there are 11 such models.
 * They are admitted here by the `status` disjunct, exactly as the deployed UI
 * admits them, so the BEHAVIOUR is right; it was my evidence for it that was
 * wrong. A cell being rare is not a cell being empty, and parity with the
 * terminal consumer — not a frequency count — is what makes this correct.
 *
 * ⛔ ONE SPELLING, DELIBERATELY. The helper's own note records that two
 * spellings of one shape is this estate's signature defect ("three
 * `blockedIdentityCarrier` literals, two `generateGraphHash` twins") and that
 * the fix "is not to add the missing field at the second site — that keeps two
 * sites. It is for both to call this, so the drift is structurally impossible."
 * Four sites called for exactly that remedy.
 */

/** The shape every call site already holds; both fields optional by contract. */
export interface RunAffordanceReadiness {
  readonly status?: unknown;
  readonly may_run?: unknown;
}

/**
 * Whether the Run/Rerun affordance may be offered for this readiness payload.
 *
 * ⭐⭐ THIS IS THE DEPLOYED UI PREDICATE, CHARACTER FOR CHARACTER. The client
 * already widened its own filter in UI #809 and it is live on staging today
 * (`canvas/hooks/useAnalysisReady.ts`):
 *
 *     export function admitsRunAffordance(analysisStatus, mayRun) {
 *       return analysisStatus === 'ready' || mayRun === true
 *     }
 *
 * So the UI has been waiting for chips CEE never emitted. Writing a DIFFERENT
 * predicate on the producing side would recreate this estate's signature defect
 * — one question, two gates — across a repo boundary, where it is hardest to
 * see. Two cells actually disagreed under the first draft of this function
 * (`may_run !== false`): `(ready, false)`, where the UI renders and CEE would
 * have withheld — a REGRESSION — and `(not-ready, malformed)`, where CEE would
 * have emitted a chip the UI drops. Both cells are empty across 400 real models,
 * which is exactly why a measurement alone would have let the divergence ship.
 *
 * ⚠ A DISJUNCTION, SO NOTHING THAT RENDERS TODAY STOPS RENDERING. That is a
 * property of the shape, not a fact about the current data.
 *
 * ⚠ ABSENCE IS NOT "NO". `may_run` is optional so pre-`may_run` producers still
 * validate; `status === 'ready'` alone still admits them, byte-identically to
 * the behaviour before this predicate existed.
 */
export function isRunAffordanceAdmitted(readiness: RunAffordanceReadiness | undefined | null): boolean {
  if (readiness === undefined || readiness === null || typeof readiness !== 'object') return false;
  return readiness.status === 'ready' || readiness.may_run === true;
}
