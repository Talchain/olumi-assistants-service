/**
 * ⭐⭐ THE DISPLAY LABEL — AN AUTHORED OBJECTIVE, DERIVED FROM THE USER'S OWN
 * WORDS AND INCAPABLE OF INVENTING NEW ONES.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * A goal node reading
 *   `Compound Goal: we'd like to spend less + increase productivity, while
 *    maintaining code quality`
 * and, beside it, a decision node reading `Decision` (today's placeholder is
 * `Question` — see {@link UNAUTHORED_DECISION_LABEL}; the capture is historic).
 *
 * ── THE PRODUCER, READ RATHER THAN INFERRED (P7) ───────────────────────────
 * `instruction.ts:132-189` is the producer of every stated record, and it
 * declares what `source_quote` is FOR:
 *
 *   "`source_quote` is REQUIRED and must be copied VERBATIM from the brief:
 *    do not paraphrase, tidy, translate or summarise it."
 *
 * A `stated_item` has **no `label` field at all** — only `source_quote`. So the
 * projector's `label: quote` was never the producer asking for a display label;
 * it was a display surface borrowing a field whose declared purpose is
 * PROVENANCE. `claims`, by contrast, DO carry a model-authored `label` — which
 * is exactly why every inferred node already reads "Monthly Recurring Revenue"
 * while the user's own goal read like a pasted sentence fragment.
 * `DRAFT_RECORD_STATED_KINDS` carries no `decision` member either, so the
 * decision node is minted by the projector and its label was a literal.
 *
 * ── THE RULING IMPLEMENTED (quality bar §8, answered 18 Aug) ───────────────
 * A1 — the displayed label is an AUTHORED, concise, faithful objective; the
 *      exact user language is retained as PROVENANCE (inspector/hover), NOT as
 *      a permanent second line under every node. `provenance_class` stays
 *      `stated` and `label_authored` is added beside it. No new provenance
 *      class: three live readers key on `stated` (`projector.ts:1077`, `:2046`,
 *      `transforms/schema-v3.ts:1124`).
 * A2 — conservation is asserted across `label ∪ source_quote ∪ goal_threshold
 *      ∪ goal_constraints[]`, never within the label alone. Because A1 keeps
 *      the verbatim, a shorter label loses nothing from the record.
 * A3 — OPEN, and untouched here: no label is ever produced by string-joining
 *      two objectives. Removing the visible defect does not require answering
 *      it, which is exactly why this ships first.
 *
 * ⚠⚠ AND THE FIRST VERSION OF THIS PARAGRAPH WAS THE DEFECT IT DESCRIBES. It
 * rested the faithfulness claim entirely on `labelIsDerivedFrom` — no token may
 * appear that the user did not write. True, and **the wrong claim**: that guard
 * detects ADDITION and every harm this module can do is DELETION. An
 * adversarial corpus written outside the author's head produced a
 * misrepresenting label on **28 of 61** ordinary business quotes, none of which
 * the guard could ever have caught, because every word on screen was the
 * user's own. The vetoes below — stated over what is THROWN AWAY — are what
 * carries the claim now; the token guard is the smaller half.
 *
 * ── THE PROJECTOR'S ARGUMENT, ANSWERED RATHER THAN IGNORED ─────────────────
 * `projector.ts:1342-1344` said: *"The label IS the user's own words. Nothing
 * is paraphrased: a paraphrase badged `stated` would be a misrepresentation of
 * the user to themselves."* That is not a weak argument and it is why this
 * module **cannot paraphrase**. Nothing here generates text. Every token of
 * every label it returns is a token of the user's own quote, modulo case and a
 * closed gerund→base verb map — enforced at runtime by
 * {@link labelIsDerivedFrom}, which REJECTS the derivation if it ever fails.
 * The badge is then made honest in the other direction: `label_authored` says
 * out loud that the display string is ours, and the verbatim rides alongside.
 *
 * ── WHY DETERMINISTIC, NOT GENERATED ───────────────────────────────────────
 * A generated restatement would need a change to the SERVED prompt (v195, in
 * PMS/Supabase, not in this repo) and could not carry the no-invention
 * guarantee above. Structural derivation can, and it is testable at rest.
 *
 * ── WHERE IT REFUSES, AND WHY REFUSAL IS THE FEATURE ───────────────────────
 * Some briefs state a DECISION where a goal is expected ("evaluating whether to
 * invest £800k … or to hire 15 staff"). There is no objective in that sentence
 * to derive; the promises inside it belong to ONE option, and promoting one to
 * "the team's goal" would be a fabrication of exactly the class the quality bar
 * forbids for numbers. So the derivation REFUSES, the verbatim stays as the
 * label, and `label_authored` is absent — the product says it has not authored
 * an objective rather than inventing one.
 *
 * ⭐ REFUSAL IS ALSO WHY THE VETOES ARE SAFE TO ADD FREELY: falling back to the
 * verbatim IS the pre-existing shipped behaviour, so a veto can close a harm
 * and cannot regress a label. Measured on the frozen governed corpus after the
 * vetoes landed: **9 of 13 goal labels authored** (unchanged — no win lost) and
 * **9 of 14 decision labels**, one fewer than before, the single cost being a
 * decision sentence whose trailing clause carries a `but`. Both refusal sets
 * are pinned BY NAME in `__tests__/authored-node-labels.test.ts`, so neither
 * can grow or shrink in silence (the KNOWN-DROPPED discipline, trap 22f).
 */

/** The outcome of one derivation. `authored` holds iff the label changed. */
export interface AuthoredLabel {
  readonly label: string;
  readonly authored: boolean;
  readonly reason?: AuthoredLabelRefusal;
}

export type AuthoredLabelRefusal =
  | "empty"
  /** The quote states a DECISION, not an objective. Nothing to author. */
  | "deliberation_frame"
  /** The quote offers a free-standing alternative — a choice, not an objective. */
  | "states_alternatives"
  /** A reduction would have thrown away a negation, exception, hedge or alternative. */
  | "would_drop_a_qualification"
  /** ⭐ The goal path's whitelist gate: a clause would have been discarded. */
  | "clause_discarded"
  /** The surviving head says what the objective is NOT. A disclaimer is not a goal. */
  | "head_disclaims"
  /** Still over the bound after every permitted reduction. */
  | "no_concise_form"
  | "too_few_tokens"
  /** The head names the decision APPARATUS, not its subject ("three changes"). */
  | "names_no_subject"
  /** A token appeared that the user did not write. Never expected; fail closed. */
  | "not_derivable"
  /** Normalisation was a no-op — the quote already IS the objective, verbatim. */
  | "identical_to_quote"
  | "no_derivable_decision_statement"
  /**
   * ⭐ THE OPTION PATH ONLY. The quote asks a question. A course of action is
   * never interrogative, so this is a structural fact about the span and not a
   * judgement about its wording.
   */
  | "asks_a_question";

/**
 * ⭐⭐⭐ EVERY REFUSAL ANSWERS EXACTLY ONE OF TWO QUESTIONS, AND ONLY ONE OF
 * THEM IS ABOUT AUTHORSHIP.
 *
 *   Q1 · DISPLAY SAFETY — *may I transform this span into a shorter label
 *        without changing what it means?* Every veto in this module was written
 *        to answer Q1, and its whole doctrine ("stated over what is THROWN
 *        AWAY", "refusal falls back to the verbatim") is Q1 doctrine.
 *
 *   Q2 · DESIGNATION — *did the USER put this span forward as their objective?*
 *        An authorship question. The `from_brief` badge at
 *        `schema-v3.ts:1176` is a Q2 claim, and so is the narrative quoting the
 *        label back as the user's own goal.
 *
 * ⚠⚠ THE MISTAKE THIS TABLE EXISTS TO PREVENT WAS SHIPPED IN THIS FILE'S OWN
 * PREVIOUS VERSION, AND AN INDEPENDENT REVIEWER MEASURED IT: `head_disclaims`
 * was admitted as a Q2 answer because it reads like one ("A disclaimer is not a
 * goal"). It is not. It is a **lexical negation detector** — `HEAD_DISCLAIMS`
 * is `/(^|\s)(not|never|no|nor)(\s|$)/` — and a negation is how ordinary
 * business English states an UPPER BOUND. Measured over this module's own
 * adversarial corpus (`authored-node-labels.test.ts` `MEASURED_HARMS`, written
 * outside the author's head), **3 of 3 `head_disclaims` goal quotes are genuine
 * user objectives and 0 of 3 are not**:
 *
 *   · "We must never let latency exceed 200ms"        ← a latency target
 *   · "We must not exceed £250,000"                   ← a budget cap
 *   · "Grow revenue, but not at the expense of margin" ← a compound objective
 *
 * Its precision as a designation signal is therefore ZERO on the only external
 * evidence available, and admitting it told a user who wrote *"Our objective for
 * this quarter is: We must never let latency exceed 200ms"* that **"the brief
 * designates no objective"** — the exact inverse of the harm the consumer was
 * built to stop. Trap 21: two questions were being answered by one membership
 * test, and the fail-safe direction of Q1 (refuse ⇒ keep the verbatim, which
 * cannot regress a label) is the fail-DANGEROUS direction of Q2 (refuse ⇒ strip
 * a real attribution).
 *
 * ⛔⛔ AND THE SAME MISTAKE WAS MADE TWICE, ONE REASON APART. The version that
 * removed `head_disclaims` kept `states_alternatives` on the strength of a
 * sentence calling BOTH survivors "closed, explicit construction tests". That
 * was FALSE AT THE BYTES for one of them: `states_alternatives` is
 * `NAMES_AN_ALTERNATIVE = /(^|\s)or(\s|$)/i` (`:636`) — a bare word test, the
 * same KIND of thing as the one just removed. A second independent review drove
 * three ordinary objectives end to end and every one was told the brief
 * designates no objective:
 *
 *   · "Reach 99.9% uptime or better"                   ← a COMPARATIVE
 *   · "Increase margin, or failing that, hold it flat"  ← a FALLBACK
 *   · "grow in Germany or France"                       ← a SCOPE
 *
 * ⭐ THE LESSON WORTH MORE THAN THE FIX: the defect was not the word list, it
 * was that a COMMENT was doing the work of a MEASUREMENT. "Construction test"
 * described `DELIBERATION_FRAMES` accurately and was extended to its neighbour
 * by assertion. **Before admitting any reason here, open the predicate and read
 * it — a claim about the KIND of a test is a claim about bytes.**
 *
 * ⚠ AND THE CORPUS COULD NOT HAVE CAUGHT IT: of the acceptance corpus's 8
 * designating rows, **0** contained a free-standing `or`, while 3 of its 6
 * non-designating rows did. A corpus that is one-way on the very token a
 * predicate keys on is structurally incapable of falsifying it (trap 22b). The
 * spec now carries a DISJUNCTION corpus with a contrast control asserting both
 * directions on that axis specifically.
 *
 * ⛔ SO ONE MEMBER REMAINS — and the property it was admitted on was NOT
 * checked, which is the fourth appearance of this file's own lesson. This
 * paragraph used to claim the property "was checked rather than asserted".
 * What had been checked is that {@link DELIBERATION_FRAMES} is CLOSED (32
 * members, enumerated). What was never checked is that each member is
 * unambiguous — and {@link FRAME_EVIDENCE} measures that 14 of them are not.
 * **"Closed" and "classified" are different claims about a list, and only the
 * second licenses treating a match as evidence.**
 *
 * On the governed baseline this member still accounts for **all 4** of the real
 * closures; `states_alternatives` fired on **0 of 13** and so earned nothing on
 * real data. That benefit is real and is why the member was not simply removed.
 *
 * ⭐ DERIVED, NOT MIRRORED (trap 12). `Record<AuthoredLabelRefusal, …>` is
 * EXHAUSTIVE, so a new refusal reason FAILS `tsc` until someone states which
 * question it answers. There is no default and no silent bucket.
 */
type RefusalAnswers = "designation" | "display_only";

const REFUSAL_ANSWERS: Readonly<Record<AuthoredLabelRefusal, RefusalAnswers>> = {
  /**
   * "states a DECISION, not an objective" — Q2, and the ONLY member.
   *
   * ⛔⛔ THE ADMISSION IS NOT DISCHARGED, AND THIS COMMENT USED TO SAY IT WAS.
   *
   * It read: *"it is a genuinely CLOSED, EXPLICIT list of 32 deliberation
   * constructions … each of which is unambiguous deliberation English, so a
   * match is evidence rather than a guess."* **The first clause is true and the
   * second is false, and the second is the one carrying the admission.**
   * CLOSED is a property of the LIST; UNAMBIGUOUS is a property of each MEMBER.
   * Counting the list was done four times; classifying its members was never
   * done at all — see {@link FRAME_EVIDENCE}, which now does it as a mechanism.
   *
   * **Measured: 14 of the 32 members are open-class content words with attested
   * non-deliberative readings**, so for those a match is exactly the guess this
   * comment denied. On an external corpus written by two independent reviewers,
   * **14 of 14 plainly designated objectives are told the brief designates no
   * objective** — *"Considering the runway, reach break-even by Q3."*,
   * *"Choosing an annual billing default lifts LTV by 15%."*, *"Our options are
   * limited, so cut burn to £120k per month."* The opposite-direction twins
   * (same objective, frame token removed) all keep their badge, which is what
   * proves the predicate keys on the TOKEN and not on objecthood.
   *
   * ⚠ THIS MEMBER THEREFORE REMAINS ADMITTED ON AN UNDISCHARGED CLAIM. It is
   * left in place because removing it would silently restore the original
   * defect (a CEE-chosen goal quoted back as the user's own words) and this
   * seam is PARKED for the producer-side grammar change, not for a fifth
   * lexical rule. The gap is pinned in the spec so it is countable.
   */
  deliberation_frame: "designation",

  // ── Q1 ONLY. Each is a verdict about TRANSFORMING the span, and says
  //    nothing whatever about who put it forward.
  /**
   * ⛔ DEMOTED, AND THE SECOND TIME THIS FILE MADE THE SAME MISTAKE.
   *
   * `states_alternatives` is `NAMES_AN_ALTERNATIVE = /(^|\s)or(\s|$)/i` — a
   * BARE WORD TEST, the same KIND of thing as `head_disclaims`, and it was kept
   * here on the strength of a comment calling it a "construction test". It is
   * not one. English uses a free-standing `or` for things that are not choices:
   *
   *   · "Reach 99.9% uptime or better"                  ← a COMPARATIVE
   *   · "Increase margin, or failing that, hold it flat" ← a FALLBACK
   *   · "grow in Germany or France"                      ← a SCOPE
   *
   * All three were driven end to end and every one earned `ai_inferred` and the
   * disclosure *"the brief designates no objective"* — a false authorship
   * verdict on a plainly designated objective, which is the exact harm this
   * consumer exists to prevent. Third appearance of one-predicate-two-questions
   * in this seam, found by an independent reviewer because THIS LANE'S OWN
   * CORPUS COULD NOT SEE IT: 0 of its 8 designating rows contained a
   * free-standing `or`, while 3 of 6 non-designating rows did.
   *
   * ⚠ THE PRICE, MEASURED AND ACCEPTED: a genuine unmade choice
   * ("Build our own last-mile fleet — or partner with a third-party courier")
   * now KEEPS the user's badge. That is a GAP, and it is today's shipped
   * staging behaviour — not a new lie. On the governed baseline
   * `states_alternatives` fires on **0 of 13** goal quotes, so it earned
   * nothing on real data; all 4 real closures are `deliberation_frame`.
   * Over-refusal on the DISPLAY side costs nothing; a false verdict on the
   * DESIGNATION side is the harm. Pinned KNOWN-OPEN in the spec.
   */
  states_alternatives: "display_only",
  /** A degenerate input, not a judgement. Filtered before any surface. */
  empty: "display_only",
  would_drop_a_qualification: "display_only",
  /** A REDUCTION verdict — a clause would have been discarded. */
  clause_discarded: "display_only",
  /** ⛔ A LEXICAL NEGATION test. 3/3 genuine objectives — see above. */
  head_disclaims: "display_only",
  /** A LENGTH verdict. */
  no_concise_form: "display_only",
  /** A TOKEN COUNT. */
  too_few_tokens: "display_only",
  names_no_subject: "display_only",
  /** Fail-closed on an unexpected derivation, never a claim about the user. */
  not_derivable: "display_only",
  /** "the quote already IS the objective, verbatim" — the STRONGEST evidence
   *  the user designated it, so admitting it would invert the badge outright. */
  identical_to_quote: "display_only",
  no_derivable_decision_statement: "display_only",
  /** Option path only. */
  asks_a_question: "display_only",
};

/**
 * The Q2 answers, DERIVED from {@link REFUSAL_ANSWERS} rather than restated.
 * Exported so guards bind to it by identity; pinned by name in
 * `goal-designation-provenance.test.ts` so it REDs if it grows OR shrinks.
 */
export const REFUSALS_DENYING_OBJECTHOOD: ReadonlySet<AuthoredLabelRefusal> = new Set(
  (Object.keys(REFUSAL_ANSWERS) as AuthoredLabelRefusal[]).filter(
    (reason) => REFUSAL_ANSWERS[reason] === "designation",
  ),
);

/**
 * TRUE when a refusal is a positive judgement that the span states a CHOICE and
 * therefore designates no objective.
 *
 * ⚠⚠ SUFFICIENT, NEVER NECESSARY, and the gap is NAMED rather than implied —
 * this is the honest KNOWN-OPEN set, not a description of completeness:
 *
 *   (a) a WELL-FORMED invented goal returns `authored: true` and no reason at
 *       all, so it is invisible here;
 *   (b) a span that is not an objective but is refused for a DISPLAY reason
 *       keeps the badge. The lane's own motivating case — *"Churn has gone up
 *       over the last two quarters and we're not sure why."* — is in this class.
 *       It was previously caught by `head_disclaims`, but only BY ACCIDENT: the
 *       detector fired on the incidental "not" in "we're not sure why", and the
 *       same accident struck the three genuine objectives above. A coincidence
 *       is not a signal, and it may not be relied on.
 *
 * Both are closed only by asking the PRODUCER — a grammar change in
 * `DRAFT_RECORDS_INSTRUCTION`, which today offers the model only `stated_items`
 * ("what the user actually said") and `claims` ("what YOU are adding") and then
 * forbids the goal from being a claim, i.e. instructs it to infer a goal and
 * requires it to file the result as something the user said. Deliberately not
 * this slice, and pinned as KNOWN-OPEN in the spec so the gap is visible in a
 * suite rather than in a comment nobody runs (trap 22f).
 */
export function refusalDeniesObjecthood(reason: AuthoredLabelRefusal | undefined): boolean {
  return reason !== undefined && REFUSALS_DENYING_OBJECTHOOD.has(reason);
}

/**
 * ⭐⭐ CLOSED IS NOT ANCHORED — the fourth member of this defect family.
 *
 * ⚠ THIS HEADING USED TO SAY "the fourth and LAST". It was not the last: a
 * fifth followed immediately, one level in — CLOSED IS NOT CLASSIFIED (see
 * {@link FRAME_EVIDENCE}). Every round of this family has ended with a sentence
 * predicting it was the final one, and the prediction is itself part of the
 * pattern: the fix that closes a member feels like the fix that closes the
 * class. It is not, and only a measurement can tell the two apart.
 *
 * {@link DELIBERATION_FRAMES} really is a closed list of 32 explicit
 * constructions; that was checked — but "closed" is a property of the LIST, not
 * of its MEMBERS, and 14 of them are open-class content words with ordinary
 * non-deliberative readings. But {@link findDeliberationFrame} is
 * `lower.indexOf(frame)` — **UNANCHORED** — so a frame token appearing ANYWHERE
 * in a span carried the authorship verdict. Driven end to end, eight plainly
 * designated objectives were told *"the brief designates no objective"*:
 *
 *   · "Considering the runway, reach break-even by Q3"   ← `considering` as a PREPOSITION
 *   · "Cut churn to 3% so we could reinvest in R&D"      ← `we could` in a PURPOSE CLAUSE
 *   · "Cut cost per unit, working out at under £4"       ← `working out at` = "amounting to"
 *   · "Improve onboarding by choosing a simpler default plan", +4 more
 *
 * A sentence that OPENS with a deliberation frame is stating the deliberation.
 * One that merely CONTAINS the token is using ordinary English.
 *
 * ⚠⚠ AND WHY THE ANCHOR LIVES HERE AND NOT IN {@link findDeliberationFrame},
 * WHICH IS THE OBVIOUS FIX AND IS THE WRONG ONE. That function has THREE
 * callers and they do not want the same thing (trap 21, the very defect this
 * seam keeps producing):
 *
 *   · `deriveGoalObjectiveLabel` / `deriveOptionActionLabel` — a DISPLAY
 *     refusal, fail-safe: refusing keeps the verbatim and cannot regress a
 *     label. Anchoring there would turn today's refusals into AUTHORINGS and
 *     could reintroduce the label harms this module was built to prevent.
 *   · `decisionLabelFromCandidate` — the EXTRACTION ANCHOR. It slices at
 *     `frame.index` (`:1170-1173`), so it REQUIRES mid-sentence matching: a
 *     brief whose decision sentence is not the first thing in the span would
 *     stop naming a decision at all.
 *
 * So the anchor is applied to the AUTHORSHIP question only, leaving all three
 * existing callers byte-identical — the same move this file already made when
 * it withdrew the investigative frames from one of the list's two jobs rather
 * than from the list.
 *
 * ⚠⚠ KNOWN-OPEN — AND THE NUMBER IN THIS COMMENT WAS WRONG BY AT LEAST 4x.
 *
 * It said *"three sentence-INITIAL uses remain false positives — `considering `,
 * `work out `, `figure out `"*. **Measured: THIRTEEN of the 32 frames produce a
 * false withdrawal sentence-initially** — the three above plus `working out `,
 * `choosing a `, `choosing an `, `deciding `, `deciding on `, `we could `,
 * `figuring out `, `do we `, `our options are `, `the options are `. A COMMENT
 * WAS DOING THE WORK OF A MEASUREMENT, inside the fix whose own headline lesson
 * is exactly that. The commit message that introduced this comment already said
 * "at least five … MORE than the three predicted"; the correction never reached
 * the code, which is how a stale number survives a round of review.
 *
 * Anchoring still fixes the mid-span cases at zero cost on real data (all 4
 * governed decisions are sentence-initial and keep their verdict), so it is a
 * genuine improvement on the unanchored form. It is NOT a bound on the family.
 *
 * ⛔ THE STOP CONDITION FIRED, AND IT FIRED CORRECTLY. *"If a fifth instance of
 * this family appears after this, the answer is a different design, not another
 * patch."* A fifth appeared (this one). The seam is PARKED for the producer-side
 * grammar change in `DRAFT_RECORDS_INSTRUCTION`. Two candidate patches have been
 * RUN rather than assumed, and both cost real closures:
 *   · demote the open-class members  → fixes all 13, costs the `figure out `
 *     governed closure (4 of 13 → 3 of 13);
 *   · gate on `endsWith("?")`        → **refuted**: only 1 of the 4 governed
 *     closures is an interrogative, so it costs three of them.
 * **Do not add a sixth rule without running it against the governed baseline
 * first.**
 */
export function deliberationFrameOpensTheSpan(quote: string): boolean {
  const frame = findDeliberationFrame(canonical(quote));
  return frame !== undefined && frame.index === 0;
}

/**
 * ⭐ DELIBERATION FRAMES — the closed list of constructions in which a sentence
 * describes a CHOICE BEING MADE rather than an objective being pursued.
 *
 * Two jobs, opposite directions, one list:
 *  · on a GOAL it is a REFUSAL signal — the user stated a decision, not a goal;
 *  · on the DECISION node it is the EXTRACTION anchor — what follows the frame
 *    is the user's own statement of what they are deciding.
 *
 * ⚠ CLOSED AND EXPLICIT, never a regex over "decide-ish" language. Every member
 * is unambiguous deliberation English, so a match is evidence and not a guess
 * (P7: the meaning comes from the construction, not from a corpus census).
 * Longest match at the earliest position wins, so `deciding whether to` is not
 * shadowed by `deciding `.
 */
const DELIBERATION_FRAMES = [
  "should we ",
  "do we ",
  "trying to decide whether to ",
  "trying to decide ",
  "deciding whether to ",
  "deciding how to ",
  "deciding between ",
  "deciding on ",
  "evaluating whether to ",
  "considering whether to ",
  "weighing whether to ",
  "debating whether to ",
  "choosing whether to ",
  "choosing between ",
  "choosing a ",
  "choosing an ",
  "must choose between ",
  "need to choose between ",
  "torn between ",
  "the question is whether to ",
  "the question is whether ",
  "whether to ",
  "we could ",
  "we can either ",
  "our options are ",
  "the options are ",
  "figuring out ",
  "figure out ",
  "working out ",
  "work out ",
  "considering ",
  "deciding ",
] as const;

type DeliberationFrame = (typeof DELIBERATION_FRAMES)[number];

/**
 * ⭐⭐ EVERY MEMBER CLASSIFIED — the task four rounds of counting left undone.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * {@link REFUSAL_ANSWERS} admits `deliberation_frame` to the DESIGNATION
 * question on the claim that every member of {@link DELIBERATION_FRAMES} is
 * "unambiguous deliberation English, so a match is evidence rather than a
 * guess". Four rounds of review each found a different false-withdrawal member
 * and each verified that the list is CLOSED. **Closed is not classified.** In
 * an independent reviewer's words: *"every round counted the list; none
 * classified its members."* This record classifies them, so the claim is a
 * MECHANISM rather than a sentence (trap 12) — `Record<DeliberationFrame, …>`
 * is EXHAUSTIVE, so a new frame FAILS `tsc` until someone states its class.
 *
 * ── THE CLASSIFICATION, AND IT IS GRAMMATICAL, NOT A CALIBRATION ───────────
 * `closed_class` — the match is anchored on a FUNCTION WORD of alternation or
 *   indirect question (`whether`, `between`, `either`) or on subject-auxiliary
 *   inversion (`should we `, `do we `). Function words have no content reading,
 *   so the construction cannot be ordinary non-deliberative English.
 * `open_class`  — the match is carried by a CONTENT word (`considering`,
 *   `deciding`, `choosing`, `figure out`, `work out`, `could`, `options`) which
 *   has attested non-deliberative readings: `considering` as a preposition,
 *   `deciding` as an adjective, `working out` as "amounting to". **For these a
 *   match is a guess, which is precisely what the admission denies.**
 *
 * ── WHAT IT PREDICTS, AND WHERE THE PREDICTION FAILS ──────────────────────
 * Of the 13 frames measured to produce a false withdrawal sentence-initially,
 * this classification predicts **12**. It does NOT predict `do we `, which is
 * closed-class by inversion and was still reported as a false positive by the
 * round-4 sweep. No verbatim counter-example for `do we ` exists in any
 * reviewer's corpus, and writing one here would be this seam's recurring
 * defect — a self-authored corpus certifying its author's own design (trap 22).
 * **So the classification is recorded and NOT wired into the predicate.** It
 * explains most of the family and does not bound it, which is itself the
 * evidence that a lexical route cannot close this and the producer-side grammar
 * change must.
 *
 * ⚠ THIS RECORD CHANGES NO BEHAVIOUR. Nothing reads it but the spec, on
 * purpose: it is the successor lane's starting point, not a fifth patch.
 */
export const FRAME_EVIDENCE: Readonly<
  Record<DeliberationFrame, "closed_class" | "open_class">
> = {
  // ── closed-class: anchored on a function word or on inversion ────────────
  "should we ": "closed_class",
  "do we ": "closed_class",
  "trying to decide whether to ": "closed_class",
  "deciding whether to ": "closed_class",
  "deciding between ": "closed_class",
  "evaluating whether to ": "closed_class",
  "considering whether to ": "closed_class",
  "weighing whether to ": "closed_class",
  "debating whether to ": "closed_class",
  "choosing whether to ": "closed_class",
  "choosing between ": "closed_class",
  "must choose between ": "closed_class",
  "need to choose between ": "closed_class",
  "torn between ": "closed_class",
  "the question is whether to ": "closed_class",
  "the question is whether ": "closed_class",
  "whether to ": "closed_class",
  "we can either ": "closed_class",
  // ── open-class: the match is carried by a content word ───────────────────
  /** "Trying to decide the right size" — bare, no alternation marker. */
  "trying to decide ": "open_class",
  /** "Deciding how to allocate the £2m budget" — `deciding` is the content word. */
  "deciding how to ": "open_class",
  /** Measured false positive. */
  "deciding on ": "open_class",
  /** "Choosing a simpler default plan should lift activation to 60%." */
  "choosing a ": "open_class",
  /** "Choosing an annual billing default lifts LTV by 15%." */
  "choosing an ": "open_class",
  /** "We could see churn rising, so cut it to 3% this year." */
  "we could ": "open_class",
  /** "Our options are limited, so cut burn to £120k per month." */
  "our options are ": "open_class",
  /** "The options are already chosen; hold CAC under £400." */
  "the options are ": "open_class",
  /** Measured false positive. */
  "figuring out ": "open_class",
  /** ⚠ Also the ONE governed closure an open-class demotion would cost. */
  "figure out ": "open_class",
  /** "Working out at under £4 per unit is the target." (= amounting to) */
  "working out ": "open_class",
  /** "Work out cheaper unit economics before the Series B." */
  "work out ": "open_class",
  /** "Considering the runway, reach break-even by Q3." (preposition) */
  "considering ": "open_class",
  /** "Deciding factors are cost and speed; cut cost per seat to £9." (adjective) */
  "deciding ": "open_class",
};

/**
 * ⭐ THE SUBSET THAT INTRODUCES ALTERNATIVES.
 *
 * Only these may speak for the DECISION node from a goal quote. A bare
 * `considering ` or `figure out ` marks deliberation about a subject; it does
 * not say the sentence is the decision, and treating it as one let a goal from
 * an unrelated sentence become the decision node's name.
 */
const CHOICE_FRAMES: ReadonlySet<string> = new Set([
  "should we ",
  "do we ",
  "trying to decide whether to ",
  "deciding whether to ",
  "deciding between ",
  "evaluating whether to ",
  "considering whether to ",
  "weighing whether to ",
  "debating whether to ",
  "choosing whether to ",
  "choosing between ",
  "must choose between ",
  "need to choose between ",
  "torn between ",
  "the question is whether to ",
  "the question is whether ",
  "whether to ",
  "we could ",
  "we can either ",
  "our options are ",
  "the options are ",
]);

/**
 * ⭐⭐ THE INVESTIGATIVE SUBSET — frames that introduce a QUESTION TO BE
 * ANSWERED, and may therefore never anchor the decision node's extraction.
 *
 * ── THE WITNESSED DEFECT (deployed `a18e194`, driven 30 Aug 2026) ──────────
 * A brief ending "…I need to work out what is actually driving it before we
 * commit budget to a fix." produced a DECISION node reading
 * `What Is Actually Driving It Before We Commit Budget to a Fix` — the user's
 * own question, title-cased, naming no choice at all. All four frames below
 * did the same thing at pristine, so the defect was systematic:
 *
 *   working out  → "Which of the Three Regions Is Losing Us Money"
 *   figure out   → "Why Conversion Rate Halved Last Quarter"
 *   figuring out → "Where the Bottleneck Actually Sits"
 *
 * ── WHY THESE FOUR, STRUCTURALLY AND NOT BY CALIBRATION ────────────────────
 * One works out, figures out — *finds out* — a FACT. The complement of these
 * verbs is epistemic, so the span that follows is a question about the world
 * and never a course of action. That is a property of the construction, the
 * same footing {@link DELIBERATION_FRAMES} itself stands on, and it is why a
 * match here is evidence rather than a guess.
 *
 * ⚠ NOT `!CHOICE_FRAMES`, WHICH WAS THE OBVIOUS FIX AND IS THE WRONG ONE.
 * Measured across the frame families at pristine, requiring a choice frame on
 * the brief path destroys SIX labels that name a real decision subject —
 * `deciding how to allocate the £2m marketing budget`, `choosing a payroll
 * vendor`, `deciding on a pricing model`, `considering a move to a subscription
 * model`, `deciding the launch date`, `trying to decide the right size`. The
 * harm is narrower than "not a choice", and so is this.
 *
 * ⚠ THEY REMAIN DELIBERATION FRAMES. On the GOAL path "I need to work out what
 * is driving it" must still be REFUSED as an objective, and it is. This subset
 * withdraws them from ONE of that list's two opposite jobs — the decision's
 * extraction anchor — rather than from the list (trap 21: two questions were
 * being answered by one membership test).
 *
 * ⚠⚠ AND THE FRAME ALONE IS NOT THE PREDICATE — THE FIRST VERSION OF THIS RULE
 * WAS FRAME-ONLY AND THE GOVERNED CORPUS REFUTED IT WITHIN ONE RUN. Brief
 * `03-vague-underspecified` reads "We need to figure out our hiring strategy for
 * next quarter" and authored `Hiring Strategy for Next Quarter` — a good label
 * naming a real subject, which frame-only matching destroyed. The claim written
 * here ("the complement of these verbs is epistemic") is FALSE when the
 * complement is a plain noun phrase; it was written against the failure mode in
 * hand rather than against the construction space (trap 13d), and a corpus
 * drawn from outside the author's head is what caught it (trap 22).
 *
 * So the predicate is a CONJUNCTION of two independent conditions — an
 * investigative frame AND an {@link INTERROGATIVE_COMPLEMENT} — which is the
 * prescribed shape when one predicate guards two opposite harms (trap 22b:
 * dropping a real decision, and inventing one from a question). It is not a
 * widened window with a moving cliff, so closing the question harm cannot
 * reopen the noun-phrase one.
 */
const INVESTIGATIVE_FRAMES: ReadonlySet<string> = new Set([
  "figuring out ",
  "figure out ",
  "working out ",
  "work out ",
]);

/**
 * ⭐ THE SECOND CONJUNCT: the complement is a QUESTION, not a subject.
 *
 * `figure out WHY conversion halved` asks something; `figure out OUR HIRING
 * STRATEGY` names something. The distinction is grammatical and visible at the
 * first word, which is why it is a closed list of interrogatives rather than a
 * judgement about wording.
 *
 * ⚠ `how` IS INCLUDED AND IT IS THE ARGUABLE MEMBER. "figure out how to fix the
 * pipeline" reads as a decision; "figure out how our churn got this bad" reads
 * as a question, and the two are not separable at the first word. It refuses,
 * which is the direction that falls back to today's honest generic rather than
 * the one that names a decision the user did not state. Pinned by name in
 * `authored-node-labels.test.ts`.
 */
const INTERROGATIVE_COMPLEMENT =
  /^(what|why|which|where|when|who|whom|whose|whether|how|if)\b/i;

/** Frames whose own verb carries the choice and must NOT be stripped. */
const BETWEEN_FRAMES: ReadonlySet<string> = new Set([
  "deciding between ",
  "choosing between ",
  "must choose between ",
  "need to choose between ",
  "torn between ",
]);

/** Leading modals left behind when a `between` frame keeps its verb. */
const CHOICE_MODALS: readonly string[] = ["must ", "need to ", "have to ", "will "];

function stripChoiceModal(text: string): string {
  const lower = text.toLowerCase();
  for (const modal of CHOICE_MODALS) {
    if (lower.startsWith(modal)) return text.slice(modal.length).trim();
  }
  return text;
}

/**
 * Gerund → base form. A CLOSED MAP, not a `-ing` rule: a general rule turns
 * "marketing" into "market" and "engineering" into "engineer", inventing a verb
 * the user never used. Membership is the whole safety property, so the map is
 * also what {@link labelIsDerivedFrom} consults when it checks that a token was
 * derived rather than introduced.
 */
const GERUND_TO_BASE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    achieving: "achieve",
    adding: "add",
    building: "build",
    choosing: "choose",
    closing: "close",
    cutting: "cut",
    debating: "debate",
    deciding: "decide",
    delivering: "deliver",
    doubling: "double",
    entering: "enter",
    evaluating: "evaluate",
    exiting: "exit",
    expanding: "expand",
    growing: "grow",
    halving: "halve",
    hiring: "hire",
    improving: "improve",
    increasing: "increase",
    investing: "invest",
    keeping: "keep",
    launching: "launch",
    lowering: "lower",
    maintaining: "maintain",
    migrating: "migrate",
    moving: "move",
    opening: "open",
    outsourcing: "outsource",
    partnering: "partner",
    providing: "provide",
    raising: "raise",
    reaching: "reach",
    reducing: "reduce",
    removing: "remove",
    replacing: "replace",
    scaling: "scale",
    shifting: "shift",
    switching: "switch",
  }),
);

/**
 * First-person intent preambles. "We'd like to spend less" states the objective
 * "spend less"; the preamble is the speaker announcing that they are speaking.
 */
const INTENT_PREAMBLES: readonly string[] = [
  "we would like to ",
  "we'd like to ",
  "i would like to ",
  "i'd like to ",
  "we're aiming to ",
  "we are aiming to ",
  "our aim is to ",
  "our goal is to ",
  "the goal is to ",
  "we intend to ",
  "we want to ",
  "we need to ",
  "we plan to ",
  "we hope to ",
  "we aim to ",
  "we must ",
  "i want to ",
  "i need to ",
  "aiming to ",
  "trying to ",
];

/** Lower-cased in a title unless they lead. Calibrated against the four gold
 *  pre-cutover labels (`Reach £20m ARR by End of FY28`,
 *  `Achieve EBITDA Breakeven by Q3 2027`,
 *  `Achieve 15% ARR Growth Without Worsening Attrition`,
 *  `Deliver 4-Day Week Within Budget and CSAT Floor`) — note `Within` and
 *  `Without` are NOT minor there, and `by`/`of`/`and` are. */
const MINOR_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "nor", "but", "of", "in", "on", "at", "to",
  "by", "for", "from", "as", "per", "vs",
]);

/**
 * Nouns that name the decision APPARATUS rather than its subject. A label built
 * on one of these is the same defect as labelling the decision node with its
 * own kind:
 * it tells the reader the node's category and nothing about their situation.
 */
const APPARATUS_NOUNS: ReadonlySet<string> = new Set([
  "change", "changes", "option", "options", "alternative", "alternatives",
  "choice", "choices", "thing", "things", "decision", "decisions",
]);

/** A goal label renders in the node body; the four gold labels are 6-8 words. */
const GOAL_WORD_BOUND = 9;
/**
 * An option label renders on a node AND in the ranked list beside a win
 * probability, so it is the tightest of the three. Set one word under the goal's
 * bound rather than derived from it: the two answer different questions and a
 * shared constant would be trap 21 in a number.
 */
const OPTION_WORD_BOUND = 8;
/** The decision node is the graph's root and carries the widest label. */
const DECISION_WORD_BOUND = 12;

const canonical = (text: string): string => String(text ?? "").replace(/\s+/g, " ").trim();
const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Strip surrounding punctuation for comparison, keeping `%` and currency. */
const bareToken = (token: string): string =>
  token.replace(/^[^\p{L}\p{N}£$€]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");

/**
 * ⭐⭐ THE NO-INVENTION GUARANTEE, AS AN EXECUTABLE PREDICATE.
 *
 * Every token of `label` must be a TOKEN of `source` — case-folded, or the base
 * form of a gerund the source contains. Nothing else may appear.
 *
 * ⚠ IT WAS A SUBSTRING TEST AND THAT WAS FAR WEAKER THAN THIS DOCSTRING CLAIMED
 * — an adversarial review measured it. `Or` passed against `for the quarter`
 * (`or` sits inside `for`), and `Exceed £250,000` passed against `we must not
 * exceed £250,000`. The first is a genuine hole; the second is the deeper point
 * and is why this guard alone was never enough: **a substring test detects
 * ADDITION, and every harm in this module is DELETION.** Tokenising closes the
 * first. The second is closed by the discard vetoes below, not here.
 *
 * Callers treat `false` as a REFUSAL, not a warning — if the derivation ever
 * produces a token the user did not write, the verbatim is kept instead.
 */
export function labelIsDerivedFrom(label: string, source: string): boolean {
  const sourceTokens = new Set(
    words(source.toLowerCase()).map((t) => bareToken(t)).filter((t) => t.length > 0),
  );
  // Hyphenated compounds are also compared piecewise, so `cost-per-delivery`
  // admits `cost`, `per` and `delivery` — the split is the user's own text.
  for (const token of [...sourceTokens]) {
    for (const piece of token.split("-")) if (piece.length > 0) sourceTokens.add(piece);
  }
  for (const token of words(label)) {
    const bare = bareToken(token).toLowerCase();
    if (bare.length === 0) continue;
    if (sourceTokens.has(bare)) continue;
    if (bare.split("-").every((piece) => piece.length === 0 || sourceTokens.has(piece))) continue;
    let viaGerund = false;
    for (const [gerund, base] of GERUND_TO_BASE) {
      if (base === bare && sourceTokens.has(gerund)) {
        viaGerund = true;
        break;
      }
    }
    if (!viaGerund) return false;
  }
  return true;
}

/** The earliest deliberation frame, preferring the longest at that position. */
function findDeliberationFrame(text: string): { index: number; frame: string } | undefined {
  const lower = text.toLowerCase();
  let best: { index: number; frame: string } | undefined;
  for (const frame of DELIBERATION_FRAMES) {
    const index = lower.indexOf(frame);
    if (index < 0) continue;
    if (
      best === undefined ||
      index < best.index ||
      (index === best.index && frame.length > best.frame.length)
    ) {
      best = { index, frame };
    }
  }
  return best;
}

function stripPreamble(text: string): string {
  const lower = text.toLowerCase();
  for (const preamble of INTENT_PREAMBLES) {
    if (lower.startsWith(preamble)) return text.slice(preamble.length).trim();
  }
  return text;
}

/** Removes `(…)` asides AND reports them, because what was removed is the
 *  thing the veto below has to look at. */
function dropParentheticals(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out = text
    .replace(/\s*\(([^)]*)\)\s*/g, (_m, inner: string) => {
      removed.push(inner);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text: out, removed };
}

/** Cuts that separate a PREAMBLE from its elaboration. The head is a summary. */
const PREAMBLE_CUTS: readonly string[] = [":", ";", " — ", "—"];
/** Cuts that begin a descriptive aside. The head is the thing being described. */
const RELATIVE_CUTS: readonly string[] = [" that ", " which ", " where ", " who "];
/** A top-level `or` — the marker of a second alternative. Hyphenated compounds
 *  ("feast-or-famine") are deliberately NOT matched: only a free-standing `or`. */
const NAMES_AN_ALTERNATIVE = /(^|\s)or(\s|$)/i;

/**
 * ⭐⭐⭐ THE VETOES — AND WHY THEY ARE THE LOAD-BEARING PART OF THIS MODULE.
 *
 * The first version of this file rested its faithfulness claim on
 * {@link labelIsDerivedFrom}: no token may appear that the user did not write.
 * That claim was true and it was **the wrong claim**, because it detects
 * ADDITION and every harm this module can do is DELETION. An adversarial
 * corpus written outside the author's head found 28 of 61 ordinary British
 * business quotes producing a misrepresenting label — and not one of them
 * could ever have been caught by an add-only guard, because every word on
 * screen was genuinely the user's. Trap 13d: the invariant had been written
 * with the same asymmetry as the code it guarded.
 *
 * So the rule is now stated over what is THROWN AWAY. Three vetoes, all
 * FAIL-CLOSED — a veto means "keep the verbatim", which is exactly today's
 * shipped behaviour, so a veto can never make any label worse than it is now.
 */

/**
 * V1 · A DISCARDED SPAN CARRYING A QUALIFICATION. Dropping "but not the
 * payments platform" from a scope, or "but only for new customers" from a
 * price rise, leaves a label that CONTRADICTS its own quote while consisting
 * entirely of the user's words.
 */
const DISCARD_CARRIES_A_QUALIFICATION =
  /(^|[\s,;:—(])(not|never|without|except|unless|only|but|provided|assuming|no|nor|rather|instead)([\s,;:—).]|$)/i;
const CONTRACTED_NEGATION = /\p{L}n['’]t\b/iu;

/**
 * V2 · A SURVIVING HEAD THAT DISCLAIMS. "This is not about cutting costs",
 * "We are not trying to grow headcount", "Cost is not the problem" — each is
 * the user saying what the objective is NOT, immediately before saying what it
 * IS. Displaying the disclaimer as the team's goal inverts them, and it is the
 * worst class the review found because the label reads fluently and wrongly.
 */
const HEAD_DISCLAIMS = /(^|\s)(not|never|no|nor)(\s|$)/i;

/**
 * V3 · A RESTRICTIVE RELATIVE CLAUSE. "any change that degrades latency" is one
 * noun phrase; cutting at ` that ` leaves "without any change", widening a
 * latency guard into a freeze on all change. A relative clause after a
 * quantifier or an exception is restricting it, not describing it.
 */
const HEAD_TAKES_A_RESTRICTIVE_CLAUSE =
  /(^|\s)(without|except|unless|only|any|all|every)(\s|$)/i;

/** V1 proper: a negation, exception or hedge was thrown away. Never exempt. */
const discardCarriesAQualification = (span: string): boolean =>
  DISCARD_CARRIES_A_QUALIFICATION.test(span) || CONTRACTED_NEGATION.test(span);

/**
 * The whole discard veto, for spans with no surviving head to consider
 * (parentheticals). Alternatives count as qualifications here because a
 * parenthetical is removed from INSIDE a clause, never from beside it.
 */
const discardIsUnsafe = (span: string): boolean =>
  discardCarriesAQualification(span) || NAMES_AN_ALTERNATIVE.test(span);

/**
 * ⚠ ONE EXEMPTION, AND IT IS MEASURED RATHER THAN ARGUED.
 *
 * Vetoing every `or`-bearing tail cost two governed decision labels, and the
 * reason is the distinction the original (false) comment was reaching for. When
 * the surviving head is ITSELF a choice construction — "decide between two
 * major feature investments for Q3" — the enumeration that follows the colon is
 * the list of alternatives, and dropping it asserts none of them. When the head
 * is a bare action — "build our own last-mile fleet" — dropping the `or` clause
 * settles a choice the user has not made. The head is what tells the two apart,
 * which is why the veto reads it.
 */
const headNamesTheChoiceItself = (head: string): boolean => /(^|\s)between(\s|$)/i.test(head);

const discardEndsAChoice = (head: string, tail: string): boolean =>
  NAMES_AN_ALTERNATIVE.test(tail) && !headNamesTheChoiceItself(head);

function cutAt(text: string, cuts: readonly string[]): { head: string; tail: string } | undefined {
  const lower = text.toLowerCase();
  let earliest = -1;
  let width = 0;
  for (const cut of cuts) {
    const index = lower.indexOf(cut);
    if (index >= 0 && (earliest === -1 || index < earliest)) {
      earliest = index;
      width = cut.length;
    }
  }
  if (earliest < 0) return undefined;
  return {
    head: text.slice(0, earliest).replace(/[,\s]+$/, "").trim(),
    tail: text.slice(earliest + width),
  };
}

/**
 * Reduce a sentence to its label body with TWO reductions and no more.
 *
 * ⚠ THE COUNT IS DELIBERATE. Each additional reduction rule over natural
 * language buys one direction and reopens another — this estate has watched
 * four consecutive rounds of that on one predicate (trap 22f). Two reductions,
 * both structural:
 *
 *  1. drop a PREAMBLE (`:` `;` `—`) — the head is the sentence's own summary;
 *  2. drop a trailing RELATIVE clause (` that `, ` which `, ` where `, ` who `)
 *     — the head is the thing described.
 *
 * ⚠⚠ THE PREAMBLE CUT USED TO BE UNVETOED, ON THE GROUND THAT *"its head
 * describes the whole set, not one member of it"*. **That sentence was false**
 * and a review measured it: `Build our own last-mile fleet — or partner with a
 * third-party courier` reduced to `Build Our Own Last-Mile Fleet`, promoting an
 * unmade choice to a settled objective. Every cut is now vetoed on the same
 * terms; a reduction that throws away a qualification, an exception or an
 * alternative refuses instead.
 *
 * Returns `undefined` when a veto fires — the caller then keeps the verbatim,
 * which is the pre-existing behaviour, so a veto cannot regress a label.
 */
function reduceToLabelBody(text: string): string | undefined {
  let body = text;
  const preamble = cutAt(body, PREAMBLE_CUTS);
  if (preamble && preamble.head.length > 0) {
    if (discardCarriesAQualification(preamble.tail)) return undefined;
    if (discardEndsAChoice(preamble.head, preamble.tail)) return undefined;
    body = preamble.head;
  }
  const relative = cutAt(body, RELATIVE_CUTS);
  if (relative && relative.head.length > 0) {
    if (discardCarriesAQualification(relative.tail)) return undefined;
    if (discardEndsAChoice(relative.head, relative.tail)) return undefined;
    // V3: the clause is RESTRICTING the head, not describing it.
    if (HEAD_TAKES_A_RESTRICTIVE_CLAUSE.test(relative.head)) return undefined;
    body = relative.head;
  }
  return body.replace(/[,\s]+$/, "").trim();
}

function capitaliseSegment(segment: string, leads: boolean): string {
  if (!leads && MINOR_WORDS.has(segment.toLowerCase())) return segment.toLowerCase();
  return segment.replace(/^(\p{L})/u, (c) => c.toUpperCase());
}

/**
 * Title case in the register of the four gold pre-cutover labels. Tokens the
 * user already cased distinctively (`ARR`, `GMV`, `AI-powered`, `£25M`) and any
 * numeric or currency token are returned BYTE-IDENTICAL — re-casing them would
 * be editing the user's own notation.
 */
function titleCase(text: string): string {
  return words(text)
    .map((token, position) => {
      const bare = bareToken(token);
      if (/\p{Lu}/u.test(bare.slice(1))) return token;
      if (bare.length === 1 && /\p{Lu}/u.test(bare)) return token;
      if (/^[\d£$€]/.test(token)) return token;
      const lower = token.toLowerCase();
      if (position > 0 && MINOR_WORDS.has(lower.replace(/[^\p{L}]/gu, ""))) return lower;
      return lower
        .split("-")
        .map((segment, segmentIndex) =>
          capitaliseSegment(segment, position === 0 && segmentIndex === 0 ? true : segmentIndex === 0),
        )
        .join("-");
    })
    .join(" ");
}

/**
 * Put the leading verb in its base form and drop a bare possessive.
 *
 * ⚠ `our own` is NEVER stripped: "build our own fleet" → "build own fleet" is
 * not a tidier label, it is a broken sentence. The possessive is removed only
 * when it is followed by the thing possessed.
 */
function normaliseHead(text: string): string {
  const tokens = words(text);
  if (tokens.length === 0) return text;
  const base = GERUND_TO_BASE.get(tokens[0].toLowerCase().replace(/[^a-z]/g, ""));
  if (base) tokens[0] = base;
  for (const position of [0, 1]) {
    if (
      tokens.length > position + 1 &&
      /^(our|my)$/i.test(tokens[position]) &&
      !/^own$/i.test(tokens[position + 1])
    ) {
      tokens.splice(position, 1);
      break;
    }
  }
  return tokens.join(" ");
}

/**
 * ⭐⭐⭐ WOULD ANY CLAUSE BE THROWN AWAY? — the goal path's single question.
 *
 * ── WHY THIS REPLACED THREE VETOES, AND WHY IT IS NOT "ONE MORE RULE" ──────
 * Round 2 answered "the harm is DELETION" with three vetoes that black-listed
 * the TOKENS deletion tends to carry: `not`, `but`, `only`, `or`, `without`…
 * A verification against a fresh 46-quote corpus — none of the 14 cases those
 * vetoes were built against — showed why that could not work: **32 of 45
 * authored quotes still changed meaning**, and six MINIMAL PAIRS settled it,
 * meaning held constant with only the veto token varied:
 *
 *     `— or partner with a courier`        refused
 *     `— and partner with a courier`       AUTHORED as `Build Our Own Fleet`
 *     `— but only for new customers`       refused
 *     `— new customers alone`              AUTHORED as `Raise Prices`
 *     `(but not the payments platform)`    refused
 *     `(payments platform excluded)`       AUTHORED as `Move the Whole Estate to Azure`
 *
 * Six for six. **Each veto matched a token list, not a semantic class, so every
 * class had a synonym that walked straight through** — and seven whole classes
 * (restrictive clauses, temporal and conditional clauses, quantifiers,
 * beneficiaries, regions, comparative baselines, purpose clauses) were never
 * guarded at all. The vetoes were the fourteen original cases in structural
 * clothing.
 *
 * ── THE INVERSION ──────────────────────────────────────────────────────────
 * Stop black-listing what is discarded. **WHITE-LIST THE TRANSFORMATIONS.** On
 * the goal path a label may be produced only by transformations that delete no
 * propositional content —
 *
 *     · strip a first-person intent preamble ("we'd like to …")
 *     · gerund → base form, from the closed map
 *     · drop a bare possessive
 *     · title case
 *
 * — and the derivation REFUSES the moment any clause would be discarded at all.
 * No token list to outrun, because the property is structural: either a clause
 * was cut or it was not.
 *
 * ⭐ THE ASYMMETRY THAT MAKES THIS THE RIGHT SHAPE: refusal falls back to the
 * verbatim, which IS the shipped behaviour, so over-refusal cannot regress
 * anything while under-refusal ships a lie. A whitelist errs in the free
 * direction. **Measured: governed goal labels 9/13 → 9/13, zero cost** — not
 * one of the thirteen governed goal quotes ever reached a cut, so the entire
 * clause-cutting apparatus on this path bought nothing measurable and was the
 * sole source of the harms.
 *
 * ⚠ AND IT IS DELIBERATELY *NOT* APPLIED TO THE DECISION PATH, where the same
 * cuts genuinely earn four labels (9/14 → 5/14 without them). The residual risk
 * is scoped there on purpose: a decision node names the QUESTION being asked,
 * not the team's objective, so a clause lost from it understates the question
 * rather than misstating what the team wants.
 */
function wouldDiscardAClause(text: string): boolean {
  if (/\([^)]*\)/.test(text)) return true;
  const preamble = cutAt(text, PREAMBLE_CUTS);
  if (preamble && preamble.head.length > 0 && preamble.tail.trim().length > 0) return true;
  const relative = cutAt(text, RELATIVE_CUTS);
  if (relative && relative.head.length > 0 && relative.tail.trim().length > 0) return true;
  return false;
}

/**
 * ⭐ THE GOAL NODE'S DISPLAY LABEL.
 *
 * Returns the authored objective, or the quote unchanged with the reason it
 * could not be authored. IDEMPOTENT: feeding an already-authored label back in
 * returns it unchanged (`identical_to_quote`), so a second pass anywhere in the
 * pipeline cannot compound the transform.
 */
export function deriveGoalObjectiveLabel(quote: string): AuthoredLabel {
  const source = canonical(quote);
  if (source.length === 0) return { label: source, authored: false, reason: "empty" };

  // A decision stated where a goal was expected. There is no objective in the
  // sentence to derive, and one of its options' promises is not the team's goal.
  if (findDeliberationFrame(source)) {
    return { label: source, authored: false, reason: "deliberation_frame" };
  }

  // The structural form of the same thing, which no frame list can outrun: a
  // quote offering a free-standing alternative is a choice, and a choice is not
  // an objective however it is worded.
  if (NAMES_AN_ALTERNATIVE.test(source)) {
    return { label: source, authored: false, reason: "states_alternatives" };
  }

  const stripped = stripPreamble(source).replace(/[.?!]+$/, "").trim();

  // ⭐⭐ THE WHITELIST GATE. Everything the six minimal pairs exposed lives on
  // the other side of this line.
  if (wouldDiscardAClause(stripped)) {
    return { label: source, authored: false, reason: "clause_discarded" };
  }

  const normalised = normaliseHead(stripped);
  // A head that says what the objective is NOT is not an objective, even when
  // nothing was discarded to produce it.
  if (HEAD_DISCLAIMS.test(normalised) || CONTRACTED_NEGATION.test(normalised)) {
    return { label: source, authored: false, reason: "head_disclaims" };
  }
  const tokenCount = words(normalised).length;
  // ⚠ NOTHING MAY BE CUT TO REACH THE BOUND ANY MORE — an over-long objective
  // is refused, not shortened. That is the whitelist's whole point.
  if (tokenCount > GOAL_WORD_BOUND) {
    return { label: source, authored: false, reason: "no_concise_form" };
  }
  if (tokenCount < 2) return { label: source, authored: false, reason: "too_few_tokens" };

  const label = titleCase(normalised);
  if (!labelIsDerivedFrom(label, source)) {
    return { label: source, authored: false, reason: "not_derivable" };
  }
  if (canonical(label) === source) {
    return { label: source, authored: false, reason: "identical_to_quote" };
  }
  return { label, authored: true };
}

/**
 * ⭐⭐ THE OPTION NODE'S DISPLAY LABEL — THE NAME OF A COURSE OF ACTION.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * Option nodes that shipped, scored and ranked with win probabilities, measured
 * on the deployed build across 16 signed-in runs and 7 briefs:
 *
 *   "Should we hire a sales lead?"                       ← the user's own question
 *   "events budget which everyone loves but I've never
 *    seen a deal come out of one"
 *   "We do not know what local certification would cost"  ← a stated unknown
 *   "Today, suitability records are captured in free text
 *    by 60 advisers across four offices…"                 ← win probability 0.0542
 *
 * ── THE CAUSE, DERIVED RATHER THAN INFERRED ────────────────────────────────
 * NOT "the served prompt has no node-label rule", which is true and not the
 * operative cause. On the live records path (`anthropic.ts:842` — "shipped ON,
 * with no flag and no env gate") an option node's label IS
 * `stated_items[].source_quote`, and `instruction.ts:138-139` REQUIRES that
 * field to be "copied VERBATIM from the brief: do not paraphrase, tidy,
 * translate or summarise it". A `stated_item` carries no `label` field, so no
 * label rule addressed to the model can reach an option label at all: the
 * display string is a provenance field, exactly as the goal's was before
 * {@link deriveGoalObjectiveLabel}.
 *
 * ── THE BLOCKER THE GOAL LANE NAMED, RE-DERIVED AND REFUTED ────────────────
 * `projector.ts` said: *"Option labels are NOT touched: `transforms/schema-v3.ts:1130`
 * binds an option's provenance on its LABEL, so authoring one flips `from_brief`
 * → `ai_inferred`."* Derived at those bytes, that is TRUE OF THE LEGACY PATH AND
 * FALSE OF THIS ONE. `projectNodeProvenance` reads the typed record provenance
 * FIRST and `continue`s (`schema-v3.ts:1185`) — for EVERY kind, not only `goal`
 * — so a records-path option never reaches the label binding at `:1188`. The
 * verdict keys on `provenance_class` + `brief_binding`, and `brief_binding` is
 * derived from the QUOTE by `bindStatedItemToBrief`, which this cannot move.
 * The one real coupling was `option.provenance.brief_quote = node.label`
 * (`schema-v3.ts:1317`); it now reads `source_quote`, so the recorded brief
 * quote stays the user's verbatim whatever the label says.
 *
 * ── WHAT IT MAY DO, AND WHY REFUSAL IS THE SAFE DIRECTION ──────────────────
 * The SAME whitelist as the goal path — strip an intent preamble, gerund → base
 * form from the closed map, drop a bare possessive, title case — and a refusal
 * the moment any clause would be discarded. Nothing generates text;
 * {@link labelIsDerivedFrom} rejects the derivation if a token the user did not
 * write ever appears. Refusal keeps the verbatim, which IS the shipped
 * behaviour, so over-refusal cannot regress a single label while under-refusal
 * would put words in the user's mouth. The opposite-direction harm the brief
 * names — "a label so aggressively normalised that the user cannot recognise
 * their own idea" — is closed by construction rather than by calibration.
 *
 * ⭐ MEASURED ON THE SIX WITNESSED LABELS: all six REFUSE, and that is the
 * honest result rather than a shortfall. Five of them are not courses of action
 * at all (a question, a stated unknown, two pieces of history, one description
 * of how things work today) and the sixth is the decision question. **A tidier
 * label for a non-option would make a classification defect harder to see, not
 * easier** — so the label path refuses and the CLASSIFICATION half is answered
 * where it belongs, in the instruction's `option` bullet. The two are different
 * questions and are deliberately not merged into one predicate (trap 21).
 *
 * IDEMPOTENT, on the same terms as the goal path: an already-authored label fed
 * back in returns `identical_to_quote`.
 */
export function deriveOptionActionLabel(quote: string): AuthoredLabel {
  const source = canonical(quote);
  if (source.length === 0) return { label: source, authored: false, reason: "empty" };

  // ⭐ A COURSE OF ACTION IS NEVER A QUESTION. Structural — the terminal `?` is
  // the user's own punctuation, not a phrase list to be outrun — and it is the
  // single worst witnessed case ("Should we hire a sales lead?", which then
  // shipped as the BASELINE option). Refusing keeps the question visible as the
  // question it is, rather than dressing it as an alternative.
  if (/\?\s*$/.test(source)) {
    return { label: source, authored: false, reason: "asks_a_question" };
  }

  // The quote states the CHOICE, not one of its branches. Same signal as the
  // goal path and the same verdict: there is no single action in it to name.
  if (findDeliberationFrame(source)) {
    return { label: source, authored: false, reason: "deliberation_frame" };
  }

  // A free-standing `or` is two alternatives inside one quote. Naming either one
  // settles a choice the user has not made — the same reasoning the projector
  // gives for never collapsing the user's own option set.
  if (NAMES_AN_ALTERNATIVE.test(source)) {
    return { label: source, authored: false, reason: "states_alternatives" };
  }

  const stripped = stripPreamble(source).replace(/[.!]+$/, "").trim();

  // The whitelist gate, unchanged from the goal path: if any clause would be
  // thrown away, refuse. This is what catches the rambling aside
  // ("… which everyone loves but I've never seen a deal come out of one").
  if (wouldDiscardAClause(stripped)) {
    return { label: source, authored: false, reason: "clause_discarded" };
  }

  const normalised = normaliseHead(stripped);
  // A span saying what is NOT so is a statement about the world, not something
  // the user could do.
  if (HEAD_DISCLAIMS.test(normalised) || CONTRACTED_NEGATION.test(normalised)) {
    return { label: source, authored: false, reason: "head_disclaims" };
  }

  const tokens = words(normalised);
  if (tokens.length < 1) return { label: source, authored: false, reason: "too_few_tokens" };
  // ⚠ NOTHING IS CUT TO REACH THE BOUND. An over-long span is refused, not
  // shortened — shortening is the direction that loses the user's meaning.
  if (tokens.length > OPTION_WORD_BOUND) {
    return { label: source, authored: false, reason: "no_concise_form" };
  }

  // "the other option", "a third alternative" — the decision APPARATUS, which
  // names no course of action however well it is cased.
  const head = tokens[tokens.length - 1]!.toLowerCase().replace(/[^a-z]/g, "");
  if (APPARATUS_NOUNS.has(head)) {
    return { label: source, authored: false, reason: "names_no_subject" };
  }

  const label = titleCase(normalised);
  if (!labelIsDerivedFrom(label, source)) {
    return { label: source, authored: false, reason: "not_derivable" };
  }
  if (canonical(label) === source) {
    return { label: source, authored: false, reason: "identical_to_quote" };
  }
  return { label, authored: true };
}

/** Sentence split for scanning a brief. Abbreviation-naive by design: a wrong
 *  split can only produce a candidate that fails the bound and is refused. */
const splitSentences = (text: string | undefined): string[] =>
  String(text ?? "")
    .split(/(?<=[.?!])\s+/)
    .map(canonical)
    .filter(Boolean);

/** One candidate sentence → a decision label, or `undefined` to keep looking. */
function decisionLabelFromCandidate(
  candidate: string,
  requireChoiceFrame = false,
): string | undefined {
  const source = canonical(candidate);
  const frame = findDeliberationFrame(source);
  if (!frame) return undefined;
  // ⭐ A QUESTION THE USER ASKED IS NOT THE DECISION THEY ARE MAKING. Both
  // conjuncts are required: an investigative frame whose complement NAMES a
  // subject ("figure out our hiring strategy") still authors. This runs on BOTH
  // call sites, because a question is no more the decision when it arrives in a
  // goal quote than when it arrives in the brief.
  //
  // ⚠ THE DELIBERATE COST, PINNED BY NAME in `authored-node-labels.test.ts`:
  // "figure out whether to renew the contract" does state a choice, and
  // `whether` is an interrogative, so it refuses. One label traded, in the safe
  // direction — refusal restores the pre-authoring behaviour and cannot put
  // words in the user's mouth, whereas the extra rule needed to recover it
  // would be the next round on a natural-language predicate (trap 22f: the
  // ratified point to stop guessing).
  if (
    INVESTIGATIVE_FRAMES.has(frame.frame) &&
    INTERROGATIVE_COMPLEMENT.test(source.slice(frame.index + frame.frame.length).trim())
  ) {
    return undefined;
  }
  if (requireChoiceFrame && !CHOICE_FRAMES.has(frame.frame)) return undefined;

  // ⭐ A `between` FRAME IS NOT A PREAMBLE — THE FRAME WORD *IS* THE SEMANTICS.
  // Stripping it turned "We must choose between closing Leeds and closing
  // Bristol" into `Close Leeds and Closing Bristol`, which reads as an
  // instruction to do BOTH. The verb is kept (it is the user's own word), so
  // the label states the choice instead of collapsing it.
  const startsAt = BETWEEN_FRAMES.has(frame.frame)
    ? frame.index
    : frame.index + frame.frame.length;
  const stated = stripChoiceModal(source.slice(startsAt).replace(/[.?!]+$/, "").trim());
  const withoutAsides = dropParentheticals(stated);
  if (withoutAsides.removed.some(discardIsUnsafe)) return undefined;
  const reduced = reduceToLabelBody(withoutAsides.text);
  if (reduced === undefined) return undefined;

  const normalised = normaliseHead(reduced);
  const tokens = words(normalised);
  if (tokens.length < 2 || tokens.length > DECISION_WORD_BOUND) return undefined;

  const head = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (APPARATUS_NOUNS.has(head)) return undefined;

  const label = titleCase(normalised);
  return labelIsDerivedFrom(label, stated) ? label : undefined;
}

/**
 * ⭐⭐ THE DECISION NODE'S UNAUTHORED PLACEHOLDER — one constant, because it is
 * a CROSS-SERVICE VOCABULARY WORD, not a local string.
 *
 * This is the label the decision node carries when nothing in the brief yields
 * a faithful decision statement. It is USER-FACING DISPLAY COPY: it is what a
 * person reads on the node itself. It must therefore match the word the UI
 * shows for that node's KIND — `DECISION_NODE_LABEL` in
 * `DecisionGuideAI:src/canvas/domain/vocabulary.ts` — or a freshly-drafted
 * graph contradicts its own legend on screen.
 *
 * ⚠ IT IS NOT A WIRE VALUE. The node's kind is the lowercase `"decision"`
 * enum member, which is the contract shared with the UI, PLoT and every
 * persisted graph, and which this constant does not touch. Renaming this
 * string changes what a user reads; renaming the kind would be a `NodeKind`
 * contract train across four repos.
 *
 * ⚠ IT IS ALSO A SENTINEL, AND THAT IS WHY IT IS EXPORTED. The post-draft
 * narrative reads it to decide whether the product may claim it built a
 * decision model or must hedge (`post-draft-narrative.ts`,
 * `hasProvisionalDecision`). That consumer used to hold a hand-copied literal
 * with a test to keep the copy honest — the hand-maintained mirror this estate
 * keeps paying for (trap 12). It now imports this constant, so there is one
 * string and no copy to drift.
 */
export const UNAUTHORED_DECISION_LABEL = "Question";

/**
 * ⭐ THE DECISION NODE'S LABEL — the user's own statement of what they are
 * deciding, never a join of the option labels.
 *
 * Q3's TWIN forbids programmatic string-joining of option labels and permits an
 * authored contrastive framing. This does neither: it takes the sentence in
 * which the user framed the decision, strips the deliberation frame, and bounds
 * it. The user's own `A or B` phrasing survives when they wrote one; nothing
 * concatenates two node labels.
 *
 * Stated goal quotes are searched FIRST because the model already judged those
 * sentences decision-bearing; the brief is the fallback. When neither yields a
 * short, faithful, subject-naming statement {@link UNAUTHORED_DECISION_LABEL}
 * is kept and
 * `authored` is false — an honest generic in preference to a confident wrong
 * one, which is the same rule the quality bar applies to numbers.
 */
export function deriveDecisionLabel(input: {
  readonly brief?: string;
  readonly goalQuotes?: readonly string[];
}): AuthoredLabel {
  // ⚠ THE GOAL-QUOTE PATH REQUIRES A *CHOICE* FRAME, NOT ANY FRAME. It accepted
  // any of them, and `considering ` is one — so a brief reading "We are
  // deciding whether to acquire Northgate or build in-house", carrying a goal
  // quote "We are considering hiring 15 more engineers", labelled the decision
  // node `Hire 15 More Engineers`: the decision node naming a goal from a
  // different sentence while the real decision sat unread. Only a frame that
  // introduces alternatives may speak for the decision; everything else falls
  // through to the brief, which is where the decision sentence actually is.
  for (const quote of input.goalQuotes ?? []) {
    const label = decisionLabelFromCandidate(quote, true);
    if (label !== undefined) return { label, authored: true };
  }
  for (const sentence of splitSentences(input.brief)) {
    const label = decisionLabelFromCandidate(sentence);
    if (label !== undefined) return { label, authored: true };
  }
  return {
    label: UNAUTHORED_DECISION_LABEL,
    authored: false,
    reason: "no_derivable_decision_statement",
  };
}
