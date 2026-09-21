/**
 * ROADMAP 2.918 — the ELICITED-ANSWER extraction path.
 *
 * `deriveElicitedBaselineAnswerPercent` answers ONE question: in reply to a
 * pending baseline question that already NAMES the target ("Roughly what
 * percentage is Churn rate at right now?"), did the user's message state a
 * single unambiguous percent level? It is the #868 extractor extended with a
 * bounded question-context carry, NOT a second parser: the full-sentence limb
 * IS `deriveStatedTargetBaselinePercent` (same grammar, same competitor
 * unanimity), and the elliptical limb accepts ONLY a whole-message bare
 * answer built from the module's own qualifier vocabulary — the subject
 * binding the grammar cannot see is supplied by the pending question's
 * target, which is why callers MUST gate this function on a live pending
 * question (no pending question ⇒ no elliptical binding; the handler enforces
 * it, and `add-constraint-baseline-elicitation.test.ts` pins that gate).
 *
 * FAIL DIRECTION: identical to the parent module — every ambiguity refuses.
 * An elliptical answer must be the WHOLE message: any extra clause ("about
 * 12% if things improve"), any delta word, any bound word, any question mark,
 * or a second number refuses, because the extra content may change the claim
 * and only the full grammar (which demands a subject) can judge it.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyElicitedBaselineAnswer,
  deriveElicitedBaselineAnswerPercent,
} from '../stated-level.js';

const LABEL = 'Churn rate';

describe('2.918 — elliptical answers that MUST bind through the question context', () => {
  const answers: ReadonlyArray<readonly [string, number]> = [
    ['about 12%', 12],
    ['12%', 12],
    ['12%.', 12],
    ['roughly 12%', 12],
    ['around 12.5%', 12.5],
    ["it's about 12%", 12],
    ['it is 12%', 12],
    ["It's currently 12%.", 12],
    ['that is about 12%', 12],
    ["we're at about 12%", 12],
    ['we are at 12% today', 12],
    ['at about 12%', 12],
    ['12% today', 12],
    ['about 12% right now', 12],
    // Zero is a legitimate stated level, same as the parent grammar.
    ['0%', 0],
  ];

  it.each(answers)('"%s" → %d', (message, expected) => {
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBe(expected);
  });
});

describe('2.918 — full-sentence answers ride the UNCHANGED #868 grammar', () => {
  it('a subject-bearing answer binds through the parent extractor', () => {
    expect(deriveElicitedBaselineAnswerPercent('Churn is about 12%.', LABEL)).toBe(12);
  });

  it('a subject that binds a COMPETING label refuses (unanimity carried over)', () => {
    expect(
      deriveElicitedBaselineAnswerPercent('The rate is 12% today.', LABEL, ['Win rate']),
    ).toBeUndefined();
  });

  it("a full sentence about a DIFFERENT metric never binds the question's target", () => {
    expect(deriveElicitedBaselineAnswerPercent('Win rate is 12% today.', LABEL)).toBeUndefined();
  });
});

describe('2.918 — non-answers that must NOT bind (the no-invention rule, answer-shaped)', () => {
  const nonAnswers: ReadonlyArray<readonly [string, string]> = [
    ['delta-post word', '12% higher'],
    ['delta-post word after hedge', 'about 12% up'],
    ['bound word before', 'under 12%'],
    ['bound word before hedge', 'below about 12%'],
    ['direction word', 'down 12%'],
    ['negative level', '-12%'],
    ['question echo', '12%?'],
    ['question echo with hedge', 'about 12%?'],
    ['guesswork is not a statement', 'maybe 12%'],
    ['conditional tail', 'about 12% if things improve'],
    ['two candidate numbers', '12% or 15%'],
    ['range answer', '10-15%'],
    ['past tense', 'it was 12%'],
    ['second sentence changes the claim', 'About 12%. But it varies a lot.'],
    ['quoted number', '"12%"'],
    ['over 100 refuses (same [0,100] rule as the parent)', '120%'],
    ['a second clause after a comma', 'about 12%, I think'],
    ['empty message', ''],
    ['whitespace only', '   '],
  ];

  it.each(nonAnswers)('%s: no bind', (_name, message) => {
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBeUndefined();
  });

  it('POSITIVE CONTROL for the battery above (trap 13b): a genuine bare answer DOES bind', () => {
    expect(deriveElicitedBaselineAnswerPercent('about 12%', LABEL)).toBe(12);
  });
});

describe('R2918B — the ask supplies the UNIT, so a BARE NUMBER is an answer', () => {
  // CORPUS PROVENANCE (this suite's own rule, restated because the previous
  // corpus violated it): NOT invented to suit the rule under test.
  //   (a) the ASK's own copy, `formatBaselineElicitation`: "Roughly what
  //       percentage is <target> at right now?" — so "roughly", "about",
  //       "percentage", "right now" and "today" are the question's OWN words
  //       coming back, and a grammar that refuses them refuses its own echo;
  //   (b) the two rows this suite previously pinned as MUST-NOT-BIND ('12',
  //       'about 12'), authored by the 2.918 lane — kept verbatim, reclassified
  //       by evidence rather than replaced;
  //   (c) the reported real answer that lands nowhere today: a bare '30'.
  const answers: ReadonlyArray<readonly [string, number]> = [
    ['30', 30],
    ['12', 12],
    ['about 12', 12],
    ['roughly 30', 30],
    ['about 30', 30],
    ['30 percent', 30],
    ['30 per cent', 30],
    ['30 percentage', 30],
    ['30 pct', 30],
    ['30 today', 30],
    ['roughly 30 right now', 30],
    ["it's 30", 30],
    ['we are at 30', 30],
    ['0', 0],
    ['100', 100],
    ['12.5', 12.5],
  ];

  it.each(answers)('"%s" → %d', (message, expected) => {
    expect(deriveElicitedBaselineAnswerPercent(message, LABEL)).toBe(expected);
  });
});

describe('2.918 — degenerate inputs fail closed like the parent', () => {
  it('null / undefined message and label', () => {
    expect(deriveElicitedBaselineAnswerPercent(null, LABEL)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent(undefined, LABEL)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent('12%', undefined)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent('12%', null)).toBeUndefined();
    expect(deriveElicitedBaselineAnswerPercent('12%', '')).toBeUndefined();
  });
});

describe('R2918B — the THREE-WAY verdict: bound / unresolved / not answering', () => {
  it('a readable answer is bound', () => {
    // `authority` records WHICH LIMB bound it. "roughly 30" carries no subject,
    // so it borrowed the pending question's — the carry that a competing ask
    // makes ambiguous, and the only one sole-pending permission licenses.
    expect(classifyElicitedBaselineAnswer('roughly 30', LABEL)).toEqual({
      outcome: 'bound',
      percent: 30,
      authority: 'elliptical',
    });
  });

  const unresolved: ReadonlyArray<readonly [string, string]> = [
    ['120%', 'out_of_range'],
    ['0.3', 'ambiguous_scale'],
    ['maybe 12%', 'unreadable'],
    ['10-15%', 'unreadable'],
  ];
  it.each(unresolved)('"%s" is an ANSWER the product cannot read (%s)', (message, reason) => {
    expect(classifyElicitedBaselineAnswer(message, LABEL)).toEqual({
      outcome: 'unresolved',
      reason,
    });
  });

  it('an explicit unit settles the scale, so "0.3%" binds where bare "0.3" refuses', () => {
    // The pair matters: without it, "ambiguous_scale" could be a blanket
    // sub-1 refusal rather than the unit-less carve-out it claims to be.
    expect(classifyElicitedBaselineAnswer('0.3%', LABEL)).toEqual({
      outcome: 'bound',
      percent: 0.3,
      authority: 'elliptical',
    });
  });

  const notAnswering: readonly string[] = [
    'run the analysis',
    'what do you mean by that?',
    'about 12% if things improve',
    'Win rate is 12% today.',
  ];
  it.each(notAnswering)('"%s" is not answering this question at all', (message) => {
    expect(classifyElicitedBaselineAnswer(message, LABEL)).toEqual({ outcome: 'not_an_answer' });
  });
});

describe('R2918B — the attempt classifier has BOUNDS, and both are load-bearing', () => {
  it('the CLOSED VOCABULARY bounds it: one word outside the set means not answering', () => {
    // Identical but for a single token the set does not carry.
    expect(classifyElicitedBaselineAnswer('about 12 or 15', LABEL)).toEqual({
      outcome: 'unresolved',
      reason: 'unreadable',
    });
    expect(classifyElicitedBaselineAnswer('about 12 or 15 tomorrow', LABEL)).toEqual({
      outcome: 'not_an_answer',
    });
  });

  it('the TOKEN CAP bounds it: an in-vocabulary message past the cap is not an attempt', () => {
    // Every token below is inside the closed vocabulary, so ONLY the cap
    // refuses this one. Measured before it was pinned: an unpinned cap
    // survived its own mutant, which is how a guard quietly becomes decorative.
    const atCap = 'about around roughly now today still at 12 or 15';
    const pastCap = `${atCap} maybe`;
    expect(atCap.split(/\s+/)).toHaveLength(10);
    expect(pastCap.split(/\s+/)).toHaveLength(11);
    expect(classifyElicitedBaselineAnswer(atCap, LABEL)).toEqual({
      outcome: 'unresolved',
      reason: 'unreadable',
    });
    expect(classifyElicitedBaselineAnswer(pastCap, LABEL)).toEqual({ outcome: 'not_an_answer' });
  });
});
