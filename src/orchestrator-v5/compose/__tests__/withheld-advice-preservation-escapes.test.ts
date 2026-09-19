/**
 * THE TWO ESCAPES THAT HELD #1515, SEPARATED BY EXECUTION.
 *
 * Independent review 5684459808 held the selective-preservation change because two recommendations survived
 * the final wire: an imperative "Choose <option>" and an unresolved alias. Both were recorded as if they were
 * regressions introduced by the change. **They are not the same kind of thing**, and this file is the
 * measurement that separates them, so the next reader inherits facts rather than a summary.
 *
 * ESCAPE 1 — IMPERATIVE — IS PRE-EXISTING, NOT A REGRESSION.
 * Measured on BOTH heads with the same input: `textAssertsLeadingOption` returns FALSE for
 * "Choose Extend Friday Hours.", so the guard's entry gate never engages, and the projection reason is
 * `disclosure_appended` — on staging and on the selective-preservation branch alike. The sentence ships
 * either way. Holding the change for this escape attributed a pre-existing detector hole to the change.
 *
 * ESCAPE 2 — UNRESOLVED ALIAS — IS A GENUINE REGRESSION, AND IT IS IRREDUCIBLE HERE.
 * "The model favours the late-opening plan" names no roster option and asserts nothing the matcher knows, so
 * it passes `isClean` and survives surgical removal. Without selective removal the whole answer — alias
 * included — is replaced. So this case IS made worse.
 *
 * ⛔ DO NOT ATTEMPT TO CLOSE ESCAPE 2 WITH ANOTHER PATTERN. Nine independent adversarial refuters ran three
 * separate designs — span redaction, verified remainder, warranted-line survival — and refuted ALL NINE BY
 * EXECUTION, every one on this exact input class. Each design's author named the alias as their own weakness
 * before the refuters ran. Three further attempts while writing this file reached the same place. An alias is
 * a definite description with no lexical marker; resolving it needs semantics, not vocabulary. This is the
 * four-rounds-of-oscillation signal CLAUDE.md trap 22f exists to stop.
 *
 * WHAT THIS FILE IS FOR: it asserts the escapes EXACTLY, in both directions, so the set cannot grow silently
 * and cannot shrink without someone saying why.
 */

import { describe, expect, it } from 'vitest';

import { projectExplanationAnswerForWithheldClaim } from '../withheld-explanation-answer.js';
import { projectLeadingOptionProse, textNamesAnOption } from '../leading-option-prose-projection.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';

const ROSTER = ['Extend Friday Hours', 'Keep Current Schedule', 'Run the Author Event During Existing Hours'];
const REMOVED = '[removed]';

const IMPERATIVE = 'Evening footfall is still unset. Choose Extend Friday Hours.';
const ALIAS =
  'Extend Friday Hours leads in 83% of simulations. The model favours the late-opening plan. Measure evening footfall before setting the uplift.';

describe('escape 1 — the imperative is a PRE-EXISTING detector hole', () => {
  it('the entry gate does not fire on it, which is why it ships on either head', () => {
    // This is the whole point. The guard is keyed on this predicate; it is false, so nothing downstream of
    // it — selective or wholesale — ever runs. Measured identically on staging and on this branch.
    expect(textAssertsLeadingOption(IMPERATIVE)).toBe(false);
    const projected = projectExplanationAnswerForWithheldClaim(IMPERATIVE, 'unevaluated', [], true, true);
    expect(projected.reason).toBe('disclosure_appended');
    expect(projected.text).toContain('Choose Extend Friday Hours');
  });

  it('it names an option, so the failure is detection and not removal', () => {
    // The roster-aware identity check sees it perfectly well. Nothing asks that check about this sentence,
    // because the assertion gate declined first. Any future repair belongs at the gate.
    expect(textNamesAnOption(IMPERATIVE, ROSTER)).toBe(true);
    expect(projectLeadingOptionProse(IMPERATIVE, ROSTER, REMOVED)).toBeNull();
  });
});

describe('escape 2 — the unresolved alias is a REAL regression, pinned not fixed', () => {
  it('surgical removal keeps the alias sentence', () => {
    const projected = projectLeadingOptionProse(ALIAS, ROSTER, REMOVED);
    expect(projected).not.toBeNull();
    expect(projected!.mode).toBe('surgical');
    // The explicit claim goes.
    expect(projected!.text).not.toContain('leads in 83%');
    // ⛔ KNOWN-OPEN, asserted EXACTLY so it cannot grow or shrink unnoticed.
    expect(projected!.text).toContain('The model favours the late-opening plan');
    // The genuinely useful sentence is preserved — this is what the change buys.
    expect(projected!.text).toContain('Measure evening footfall before setting the uplift');
  });

  it('the alias alone is invisible to every authority this module has', () => {
    const alone = 'The model favours the late-opening plan.';
    expect(textAssertsLeadingOption(alone, { optionLabels: ROSTER })).toBe(false);
    expect(textNamesAnOption(alone, ROSTER)).toBe(false);
    // Both false is the irreducibility, stated as an assertion rather than a claim in a comment.
    expect(projectLeadingOptionProse(alone, ROSTER, REMOVED)).toBeNull();
  });
});

describe('what the change buys — the positives that must survive any repair', () => {
  it('a real leader claim is still removed', () => {
    const claim = 'Extend Friday Hours leads in 83% of simulations, so it is the one to back.';
    const projected = projectLeadingOptionProse(claim, ROSTER, REMOVED);
    expect(projected!.text).toBe(REMOVED);
  });

  it('non-ranking coaching is untouched', () => {
    const advice =
      'Evening footfall uplift has no value yet and is your strongest driver, so a number from a comparable evening would sharpen this.';
    expect(projectLeadingOptionProse(advice, ROSTER, REMOVED)).toBeNull();
  });

  it('a bare option mention that ranks nothing is untouched', () => {
    // The class Paul lost 2,187 characters of. Naming an option is not recommending it.
    const mention = 'Extend Friday Hours sets Friday extended hours active; the other two leave it at baseline.';
    expect(textNamesAnOption(mention, ROSTER)).toBe(true);
    expect(projectLeadingOptionProse(mention, ROSTER, REMOVED)).toBeNull();
  });
});
