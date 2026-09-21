/**
 * ⭐ THE GOAL-REFERENCED RESULT SENTENCE — ONE OWNER FOR THE PHRASE, SHARED BY
 * THE COMPOSERS THAT EMIT IT AND THE GUARDS THAT MUST SEE IT.
 *
 * PAUL'S RULING, 21 Sep 2026, VERBATIM: "It's not a leading option. It's the
 * option from the causal analysis that either is most likely to happen or, if
 * we can provide this, is most likely to achieve the user's goal. We are a
 * reasoning enhancement tool, not a causal analysis tool. We are giving them
 * information to improve their critical and creative thinking, not
 * recommending options."
 *
 * WHAT THIS REPLACES, and why the old wording was wrong in two different ways:
 *
 *   "Based on this model, the analysis currently favours ${label}${p}."
 *       `favours` is a RECOMMENDATION VERB. It reports the product's
 *       preference, not a measurement. The ruling forbids exactly this.
 *
 *   "${label} sits in second place${p}."
 *       League-table framing with NO STATED REFERENT — second place at what?
 *       It also adjudicates a standing the analysis does not produce.
 *
 * WHAT THE NUMBER ACTUALLY MEASURES, derived at the producer rather than
 * assumed: ISL `robustness_analyzer_v2.py:1078-1092` evaluates every option at
 * `request.goal_node_id` on each Monte Carlo draw and credits the highest (ties
 * split equally); the field is described at `robustness_v2.py:851` as
 * "P(this option is best)". So `win_probability` is THE FRACTION OF SAMPLED
 * FUTURES IN WHICH THAT OPTION CAME OUT HIGHEST ON THE USER'S OWN GOAL.
 * Goal-referenced and comparative — NOT a forecast that the option succeeds,
 * which is exactly how "performs best" and "favours" were being read.
 *
 * Naming the goal is therefore the whole point: "came out highest on {goal}"
 * is a measurement the reader can argue with; "favours" is a verdict they can
 * only accept or reject.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS MODULE EXISTS AT ALL, RATHER THAN THE COPY LIVING AT ITS SIX
 *    CALL SITES — AND IT IS A LEAK-SAFETY REQUIREMENT, NOT TIDINESS.
 *
 * The superseded sentence was READ as well as written. `withheld-history-
 * redaction.ts`'s `favour` pattern
 * (`/\bfavou?r(?:s|ed|ing|ite|ites|able)?\b/i`) exists because "the analysis
 * currently favours …" was a LIVE LEAK on the POST-#713 walk: when a later
 * turn withholds a leader claim, that stored sentence has to be scrubbed out
 * of the model's own history or the withheld leader reaches the user anyway.
 *
 * MEASURED ON THIS BRANCH, by running the real exported readers (not by
 * reading the regexes):
 *
 *     sentence                                       alarm   history
 *     "…the analysis currently favours X…"           false   TRUE
 *     "…X came out highest on your goal…"            false   false   ⛔
 *
 * So changing the emitter ALONE moves the history reader from TRUE to false
 * and re-opens precisely the leak that pattern was added to close. The new
 * phrasing has to be visible to the guards on the SAME commit that starts
 * emitting it.
 *
 * Hence: the verb lives here once, {@link RESULT_STANDING_PATTERN} is DERIVED
 * from it rather than hand-copied beside it (CLAUDE.md trap 12), and
 * `compose/leading-option-egress-guard.ts` consumes that pattern. Because
 * `withheld-history-redaction.ts`'s `historyAssertsLeaderClaim` CALLS the
 * alarm reader rather than copying its patterns, the history redactor inherits
 * the coverage on the same commit with no second list to keep in step.
 *
 * ⚠ CHANGING {@link RESULT_STANDING_VERB} CHANGES BOTH THE PRODUCT'S WORDS AND
 * THE GUARD'S PATTERN, BY CONSTRUCTION. That is the property being bought. The
 * module-load assertion in the egress guard pins it: if the derivation ever
 * stops matching what the composers emit, the process fails at startup.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE. No imports, so it can be consumed by the guard layer without a cycle.
 * Callers pass their OWN already-rendered probability fragment: the advice gate
 * renders ", with a probability of 56%" (leading comma) and the explanation
 * fallback renders " with a probability of 62%" (no comma). That difference is
 * each caller's sentence rhythm and is deliberately NOT unified here — what is
 * shared is the VERB and the skeleton, which is what drifts.
 */

/**
 * ⭐ THE ONE PLACE THE RESULT VERB IS SPELLED.
 *
 * Past tense, because the measurement is over draws already sampled. Every
 * composer in the estate must reach the phrase through this constant or
 * through the helpers below — a literal at a call site is a copy the guards
 * cannot follow.
 */
export const RESULT_STANDING_VERB = 'came out highest';

/**
 * The fallback referent, used when the caller cannot name the goal node.
 *
 * ⚠ IT IS A GENERIC, NEVER A SUBSTITUTE LABEL. A wrong goal is worse than a
 * vague one: the reader cannot tell that a wrong one is wrong, and this
 * sentence's entire claim to honesty is that its referent is stated.
 */
export const RESULT_STANDING_FALLBACK_REFERENT = 'your goal';

/**
 * {@link RESULT_STANDING_VERB} as a matcher, DERIVED from the constant.
 *
 * The head word is widened to its tense family so a composer that later says
 * "comes out highest" in a present-tense register is seen by the same guard;
 * the tail is taken verbatim from the constant with flexible whitespace, so a
 * reword of the constant moves the pattern with it and cannot be forgotten.
 *
 * Non-global, so `.test` carries no `lastIndex` state — the guards call it
 * repeatedly over one string.
 */
export const RESULT_STANDING_PATTERN: RegExp = (() => {
  const [head, ...tail] = RESULT_STANDING_VERB.split(/\s+/);
  if (head === undefined || tail.length === 0) {
    throw new Error(
      'goal-referenced-result-phrasing: RESULT_STANDING_VERB must be at least two words, so the ' +
        'tense head can be widened without widening the whole phrase.',
    );
  }
  // The head's tense family. `came` is the emitted form; `come`/`comes` are
  // admitted so a present-tense register cannot slip past the guard.
  const heads = Array.from(new Set([head, 'come', 'comes']));
  const tailSource = tail.join(String.raw`\s+`);
  return new RegExp(String.raw`\b(?:${heads.join('|')})\s+${tailSource}\b`, 'i');
})();

/**
 * The result-standing sentence: which option came out highest, on what, and
 * how often.
 *
 * @param renderedLabel   the option label, ALREADY RENDERED by the caller
 *                        (quoted or bare — the two surfaces differ and each
 *                        owns that decision).
 * @param goalLabel       the user's goal node label, or `null` when the
 *                        surface cannot resolve one.
 * @param probabilityFragment the caller's own rendered probability clause, or
 *                        `''` when the projection carries no usable value.
 * @param trailingClause  an optional extra clause appended before the full
 *                        stop (the `meaning` composer attributes a driver, or
 *                        qualifies with "given the model you've built so far").
 */
export function composeResultStandingSentence(
  renderedLabel: string,
  goalLabel: string | null | undefined,
  probabilityFragment: string,
  trailingClause = '',
): string {
  const referent =
    typeof goalLabel === 'string' && goalLabel.trim().length > 0
      ? goalLabel
      : RESULT_STANDING_FALLBACK_REFERENT;
  return `Across the futures we sampled, ${renderedLabel} ${RESULT_STANDING_VERB} on ${referent}${probabilityFragment}${trailingClause}.`;
}

/**
 * The runner-up's own standing, in the same voice.
 *
 * ⚠ IT REPORTS THE RUNNER-UP'S OWN SHARE AND NEVER THE SUBTRACTION. The
 * difference between two P(argmax) statistics inflates by construction when any
 * third option collapses and is not a difference in outcome — ROADMAP 2.1067
 * retired the gap magnitude for that reason, and this sentence is what replaced
 * it. "Less often" is comparative but states no magnitude, which is the whole
 * distinction.
 */
export function composeRunnerUpStandingSentence(
  renderedLabel: string,
  probabilityFragment: string,
): string {
  return `${renderedLabel} ${RESULT_STANDING_VERB} less often${probabilityFragment}.`;
}

/**
 * A composed exemplar of each shape, for guards and specs to use as a POSITIVE
 * CONTROL rather than re-typing the sentence (which would be the fourth copy
 * and would pass while the composer drifted away from it — trap 13b).
 *
 * Built by calling the real composers, so it cannot disagree with them.
 */
export const RESULT_STANDING_EXEMPLARS: readonly string[] = Object.freeze([
  composeResultStandingSentence(
    'Double Down on Self-Serve SMB',
    'Annual recurring revenue',
    ', with a probability of 62%',
  ),
  composeResultStandingSentence('Double Down on Self-Serve SMB', null, ' with a probability of 62%'),
  composeRunnerUpStandingSentence('Enterprise Land and Expand', ', with a probability of 24%'),
]);
