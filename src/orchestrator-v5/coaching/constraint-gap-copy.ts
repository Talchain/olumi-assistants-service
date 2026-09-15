/**
 * THE RATIFIED COPY FOR "your model records no value to test this limit",
 * in ONE place, because it is now spoken at TWO moments in the product.
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────────
 * `constraint-gap-disclosure.ts` owns the run_analysis disclosure and authored
 * every sentence below. That disclosure fires AFTER the analysis has run, which
 * on the witnessed session (debug export `44e349fa`, 14 Sep 2026) was TWO TURNS
 * after the product had already said "Added constraint: …" about a limit the
 * compute path could never evaluate. Closing that gap means saying the same
 * thing at WRITE time — and the one thing that must not happen is a second set
 * of words for the same fact, drifting away from the first (CLAUDE.md trap 12,
 * and trap 21's "differently-named twins").
 *
 * So the copy moves here, unchanged, and both moments import it. This module
 * has NO imports of its own and must keep it that way: it is a leaf precisely
 * so a handler can read it without pulling in the coaching layer.
 *
 * ── WHAT IS SHARED AND WHAT IS NOT ────────────────────────────────────────
 * The SUBJECT (what is wrong) and the REPAIR (what the user can do) are
 * identical at both moments and are shared verbatim. The CONSEQUENCE is not:
 * after the run the true sentence is past tense ("It was not part of the
 * comparison"); before the run the same claim has to be future tense, and
 * shipping the past-tense sentence at write time would assert a comparison that
 * has not happened. Both spellings live here, side by side, so the difference is
 * a visible decision rather than an accident.
 */

/**
 * Lead-in for the UNMEASURED_TARGET voice. It states the OBSERVABLE and nothing
 * more: the node the limit points at records no value. It does not say the
 * engine failed (it was never asked a question it could answer), and it does
 * not say the limit is wrong (it is not — the user's sentence was clear; our
 * model has no number to test it against).
 */
export const UNMEASURED_TARGET_LEAD_IN = 'Your model records no value to test ';

/**
 * The REPAIR ASK for the UNMEASURED_TARGET voice, without the closing
 * instruction to re-run.
 *
 * It asks for the REFERENT, which is the one thing missing and the one thing
 * only the user knows. "I will record it there" is a live capability
 * (`add_constraint`, a registered V5 handler pinned against the registry by
 * `constraint-gap-disclosure`'s tests).
 *
 * ⚠ IT DISCLOSES THE RESIDUAL. There is no conversational remove/replace
 * constraint operation (ROADMAP 2.659), so a correction APPENDS beside the
 * existing row rather than replacing it. Saying so is the INV-2 discipline: a
 * repair that cannot touch the defective row must disclose that the row remains.
 */
export function unmeasuredTargetRepairAsk(total: number): string {
  return total === 1
    ? ' Tell me which part of your model it applies to and I will record it there; this one stays on the model.'
    : ' Tell me which parts of your model they apply to and I will record them there; these stay on the model.';
}

/**
 * The re-run instruction. Split out because it is true ONLY after an analysis
 * has already run — at write time the user has not run one yet, and the
 * mutation receipt's own staleness notice already tells them to.
 */
export const RUN_AGAIN_CLOSER = ' Then run the analysis again.';

/**
 * The run_analysis-time repair step: the ask plus the re-run instruction.
 * DERIVED from the two pieces above rather than spelled a second time, so the
 * write-time ask can never drift from the read-time one.
 */
export function unmeasuredTargetRepairStep(total: number): string {
  return `${unmeasuredTargetRepairAsk(total)}${RUN_AGAIN_CLOSER}`;
}

/**
 * The WRITE-TIME consequence.
 *
 * ⚠ DELIBERATELY NOT the run_analysis voice's " It was not part of the
 * comparison." — at the moment the row is written there has been no comparison
 * to be absent from, and a past-tense sentence would assert one. The CLAIM is
 * the same (this limit takes no part in the analysis); only its tense moves.
 *
 * Note what it does NOT say, for the same reason the read-time voice does not:
 * not "no option can be put forward" (false — the comparison still runs on every
 * dimension the model does carry), and nothing about who authored the row.
 */
export const UNMEASURED_TARGET_CONSEQUENCE_AT_WRITE = ', so it will not be part of the analysis.';

/**
 * The write-time disclosure that a limit's TIME SPAN is recorded but not tested.
 *
 * A `goal_constraints[]` row is `{operator, value, unit}` and has no temporal
 * field of any kind, so a span named in the user's sentence survives only inside
 * the label string. The claim is therefore unconditionally true of the row it is
 * attached to, and it is scoped to that row on purpose: it says this LIMIT is
 * checked at a single threshold, never that the timing is unmodelled everywhere
 * (a deadline can reach the model by other routes, e.g. `extractDeadline`).
 */
export function durationNotEvaluatedSentence(span: string): string {
  return `This limit is checked as a single threshold, so the “${span}” in it is recorded as wording and is not part of that check.`;
}

/**
 * ⭐⭐ THE SAME CLAIM, ON EVERY LATER TURN'S READBACK — THE THIRD MOMENT.
 *
 * The two moments above are both about the turn that WRITES the row. A user who
 * then asks *"did you add that constraint?"*, *"what changed?"* or *"I can't see
 * the 7% limit"* is answered by the DETERMINISTIC state-query guard
 * (`routing/state-query-guard.ts` → `composeRecentChangeAnswer`) at
 * `llm_calls: 0`, from `ContextPack.recent_changes` — and before this sentence
 * existed that answer quoted the receipt VERBATIM and said nothing about
 * evaluability.
 *
 * ── MEASURED, AT ROUTE LEVEL, BEFORE THE FIX ──────────────────────────────
 * Six natural follow-ups on the `44e349fa` shape (a `risk` target recording
 * nothing), driven through `runTurnExecutor`: ALL SIX answered
 *
 *     "From the saved model history: Added constraint: Subscriber churn must be
 *      at most 7%. If you want to see the other saved model edits, just ask."
 *
 * at `llm_calls: 0` — the change CLAIMED, UNQUALIFIED, six times out of six,
 * while the very same `recent_changes` array carried
 * `constraint_not_checkable: "target_records_no_value"` on that entry. The write
 * told the truth; every readback afterwards took it back.
 *
 * ── WHY IT IS A THIRD SPELLING AND NOT A REUSE OF `formatConstraintNotCheckable`
 * That function names the TARGET (`…this limit: <targetLabel> has no number
 * recorded against it…`). Here the receipt being qualified sits IMMEDIATELY
 * BEFORE this sentence in the same reply and has already named the limit, so
 * repeating the label buys nothing — and it would WIDEN what the deterministic
 * surface emits verbatim. That widening is measured, not hypothetical:
 * `RecentMutation.summary` is `cap("Added constraint: " + label + " must be …")`
 * and `RecentMutation.target_label` is `cap(label)`, both at 80 chars, so the
 * LABEL is truncated inside `summary` while `target_label` carries it whole. On
 * a 64-character label that is 61 characters of persisted text on screen today
 * against 64 if this sentence named the target, and the gap grows with the
 * label. A disclosure must not be the thing that lengthens a verbatim emission.
 *
 * So the SUBJECT, the CONSEQUENCE and the REPAIR are the ratified atoms above,
 * byte-identical; the only new token in the product is the referent word, and it
 * is a pronoun pointing at the sentence before it rather than a new claim.
 *
 * ⚠ THE CONSEQUENCE IS THE **WRITE-TIME** ONE ON PURPOSE. The verdict that
 * reaches here is derived against the graph AS IT STANDS THIS TURN (see
 * `context/recent-changes.ts`), so "it will not be part of the analysis" is a
 * statement about the model the user has right now, and stays true however many
 * turns have passed. The run_analysis voice's past tense (" It was not part of
 * the comparison.") would assert a comparison that may never have happened.
 *
 * ⚠ THE REPAIR ASK IS REACHABLE FROM HERE, WHICH IS WHY IT IS KEPT. It asks the
 * user to name the referent and promises to record it; `add_constraint` is a
 * registered V5 handler reached from an ordinary following turn, and the
 * write-time site (`add-constraint.ts`) already ships this exact ask. A
 * disclosure that named no move would be the "truthful about a state, not
 * executable as an action" defect.
 */
export function unmeasuredTargetReadbackSentence(): string {
  return (
    `${UNMEASURED_TARGET_LEAD_IN}that limit` +
    `${UNMEASURED_TARGET_CONSEQUENCE_AT_WRITE}${unmeasuredTargetRepairAsk(1)}`
  );
}
