/**
 * ⭐ THE LEAD LADDER'S WORDS STAY VISIBLE TO THE WITHHELD GATE, AND "AHEAD" WITH AN ADVERB IS STILL A LEADER
 * (Science d5 #87 6008589328; DL 0df0e1 follow-up row on #2639, agreed).
 *
 * The new rung 1/2 verb ("{X} gave the highest|lowest {quantity} in N% of runs of this model") names the run-share
 * leader exactly as "scored highest" did, so `gave_the_extreme` must fire in any tense and fronted. Rung 3 ("was
 * supported by") is the pre-existing `runs_supported`. The `ahead` code gains its adverb slot ("is just ahead",
 * "is a little ahead"); "ahead of schedule / plan / time" stays caught as on the base (an option may be named "Plan").
 * Rows are CATCH (blocked on a withheld turn), LEAVE (passes), PARITY (unchanged verdict).
 */
import { describe, expect, it } from 'vitest';
import { textAssertsLeadingOption, textNamesLeadingOption } from '../leading-option-egress-guard.js';

const both = (t: string): [boolean, boolean] => [textNamesLeadingOption(t), textAssertsLeadingOption(t)];

describe('CATCH: the ladder verb, in any tense and fronted', () => {
  it.each([
    'Raise to £59 gave the highest monthly recurring revenue in 62% of runs of this model.',
    'Raise to £59 gave the lowest churn in 62% of runs of this model.',
    'Raise to £59 gave the highest monthly recurring revenue in the most runs of this model.',
    'Raise to £59 gives the highest MRR.',
    'Raise to £59 would give the lowest churn.',
    'The highest monthly recurring revenue came from Raise to £59 in 62% of runs.',
    'The lowest churn was Raise to £59’s, in the most runs.',
  ])('%s', (t) => {
    expect(both(t)).toEqual([true, true]);
  });
  it('CONTROL: rung 3 is the pre-existing runs_supported', () => {
    expect(both('Raise to £59 was supported by 62% of runs of this model.')).toEqual([true, true]);
  });
});

describe('CATCH: the runner-up lines alone (d5 mutant row: a runner-up line on a withheld Run is SEEN, so the gate replaces it)', () => {
  it.each([
    "In this model, 'Hold Price' was supported by the next most runs (38%).",
    'In this model, ‘Hold Price’ was supported by the next most runs.',
    "'Hold Price' was supported by 38% of runs, so the two are clearly separated in this model.",
  ])('%s', (t) => {
    expect(both(t)).toEqual([true, true]);
  });
});

describe('CATCH: "ahead" with an adverb names a leader (the r18 sentence and its siblings)', () => {
  it.each([
    'Raise prices 10% is slightly ahead.',
    'Raise prices 10% is just ahead.',
    'Raise prices 10% is a little ahead.',
    'Raise prices 10% is still ahead.',
    'Raise prices 10% is now ahead.',
    'Raise prices 10% is ahead.',
  ])('%s', (t) => {
    expect(both(t)).toEqual([true, true]);
  });
});

describe('PARITY with the base: "ahead of schedule / plan / time" stays caught (Codex buddy #2646 r1 F3)', () => {
  // A context-free reader cannot tell an option named "Plan" from a plan, so no timeline exemption ships. These are
  // caught exactly as the base catches them; an honest one ships on a withheld turn only through the NAME gate.
  it.each([
    'The rollout is ahead of schedule.',
    'Hiring is ahead of plan.',
    'The launch was well ahead of time.',
    'Raise prices 10% is ahead of Plan.',
    'Raise prices 10% is slightly ahead of Plan.',
    'Raise prices 10% is ahead of Plan B.',
  ])('%s', (t) => {
    expect(both(t)).toEqual([true, true]);
  });
  it('CONTROL: "ahead of" another OPTION is a contest', () => {
    expect(both('Raise prices 10% is slightly ahead of Hold Price.')).toEqual([true, true]);
  });
});

describe('LEAVE: "the highest priority" is a weighting, not a result (Codex buddy #2646 r1 F4)', () => {
  it.each([
    'The team gave the highest priority to testing Raise prices 10%.',
    'We gave the lowest weighting to the churn estimate.',
    'Finance gives the highest importance to cash runway.',
  ])('%s', (t) => {
    expect(both(t)).toEqual([false, false]);
  });
  it('CONTROL: the same verb with a QUANTITY is the ladder\'s claim', () => {
    expect(both('Raise prices 10% gave the highest monthly revenue.')).toEqual([true, true]);
  });
});

describe('PARITY: lines the ladder verb must not newly claim', () => {
  it.each([
    // The goal-chance headline: its own licence, not this gate's. False WITH the ladder verb; the pattern set only grows,
    // so it was false before too.
    ['goal-chance highest', 'In this model, on current information, ‘Raise to £59’ has the highest chance of meeting your goal (at least £150,000 / month): about 62%, against about 30% for ‘Hold Price’.', [false, false]],
    ['an aim, not a finding', 'You want the lowest churn you can get.', [false, false]],
    ['the highest-cost assumption', 'The highest-cost assumption in your model is the delivery estimate.', [false, false]],
  ] as const)('%s', (_n, t, expected) => {
    expect(both(t)).toEqual(expected);
  });
});
