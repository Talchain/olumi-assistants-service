/**
 * ⭐ THE LEAD LADDER'S WORDS STAY VISIBLE TO THE WITHHELD GATE, AND "AHEAD" MEANS A LEADER ONLY WHEN IT IS ONE
 * (Science d5 #87 6008589328; DL 0df0e1 follow-up row on #2639, agreed).
 *
 * The new rung 1/2 verb ("{X} gave the highest|lowest {quantity} in N% of runs of this model") names the run-share
 * leader exactly as "scored highest" did, so `gave_the_extreme` must fire in any tense and fronted. Rung 3 ("was
 * supported by") is the pre-existing `runs_supported`. And the `ahead` code gains its adverb slot ("is just ahead",
 * "is a little ahead") while "ahead of schedule / plan / time" — a timeline, never a contest — stays LEAVE on both
 * `ahead` and `band_ahead`. Rows are CATCH (blocked on a withheld turn), LEAVE (passes), PARITY (unchanged verdict).
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

describe('LEAVE: "ahead of schedule / plan / time" is a timeline, not a contest', () => {
  it.each([
    'The rollout is ahead of schedule.',
    'We are slightly ahead of schedule.',
    'Hiring is just ahead of plan.',
    'The launch was well ahead of time.',
  ])('%s', (t) => {
    expect(both(t)).toEqual([false, false]);
  });
  it('CONTROL: "ahead of" another OPTION is still a contest', () => {
    expect(both('Raise prices 10% is slightly ahead of Hold Price.')).toEqual([true, true]);
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
