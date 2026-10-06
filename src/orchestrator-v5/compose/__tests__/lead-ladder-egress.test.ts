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
    expect(both('Raise prices 10% produced the highest mean revenue.')).toEqual([true, true]);
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

/**
 * ⭐ THE LADDER VERB'S PARAPHRASE CLASSES (Review Desk 6b + DL, #2646). Every class CATCHES in an active, a fronted and a
 * predicative form; the contrast rows (an aim, a weighting, a mechanism, a scope, the goal-chance copy) stay LEAVE.
 */
const CLASSES: Record<string, readonly string[]> = {
  'production verbs': [
    'Raise to £59 produced the lowest churn.',
    'Raise to £59 delivered the highest MRR.',
    'Raise to £59 yields the highest monthly revenue.',
    // Codex #2660 r2: a compound with a RESULT head is still a claim.
    'Hold delivered the lowest-churn outcome.',
    'Hold gave the highest-margin result.',
    // Desk 6b follow-up rows.
    'Raise to £59 ends up with the highest MRR.',
    'Raise to £59 resulted in the lowest churn.',
    'The highest MRR was delivered by Raise to £59.',
    'Churn was lowest under Raise to £59.',
  ],
  'has / had': [
    'Raise to £59 had the highest MRR.',
    'Raise to £59 has the lowest churn.',
    'The lowest churn came from Raise to £59.',
    'MRR was highest with Raise to £59.',
  ],
  'the most / least, with a run share': [
    'Raise to £59 gave the most MRR in 62% of runs.',
    'Raise to £59 produced the least churn in the most runs.',
    'The most MRR in 62% of runs came from Raise to £59.',
    'The most MRR came from Raise to £59.',
  ],
  'fronted and passive': [
    'The lowest churn came from Raise to £59.',
    'The highest MRR was produced by Raise to £59.',
    'The highest monthly revenue comes from Raise to £59.',
  ],
  'predicative': [
    'Churn was lowest under Raise to £59.',
    'MRR is highest with Raise to £59.',
    'Churn is the lowest for Raise to £59.',
  ],
  'top': [
    'Raise to £59 came top on MRR in 62% of runs.',
    'Raise to £59 topped MRR in 62% of runs.',
    'Raise to £59 came top.',
    'Raise to £59 was top on MRR.',
    'Top on MRR was Raise to £59.',
  ],
};
describe.each(Object.entries(CLASSES))('CATCH: %s', (_cls, rows) => {
  it.each(rows)('%s', (t) => {
    expect(both(t)).toEqual([true, true]);
  });
});

// Desk/DL follow-up rows (F1/F2, DL 6 Oct).
const F1_F2_CLAIMS = [
  'Raise to £59 has the highest-revenue path.',
  'Hire a marketing manager gives the lowest-churn route.',
  ...['revenue', 'MRR', 'ARR', 'margin', 'profit', 'return', 'growth', 'churn', 'retention', 'sales', 'income', 'conversion', 'cost']
    .map((metric) => `Raise to £59 gives the lowest-${metric} path.`),
  ...['best', 'top', 'greatest', 'largest', 'biggest', 'strongest'].flatMap((word) => [
    `Hire a marketing manager ends up with the ${word} MRR.`,
    `Both hires end up with the ${word} MRR.`,
    `Hire a marketing manager and Raise to £59 end up with the ${word} MRR.`,
    `The ${word} MRR is what Raise to £59 ends up with.`,
    `With the ${word} MRR, Raise to £59 comes out ahead.`,
    `The ${word} MRR came from Raise to £59.`,
    `The ${word} MRR was produced by Raise to £59.`,
    `MRR is ${word} with Raise to £59.`,
    `The ${word} MRR came from Raise to £59 in 62% of runs.`,
  ]),
  'Both hires end with the highest MRR.',
  'Raise to £59 ends with the highest MRR.',
  'Raise to £59 ended with the highest MRR.',
  'Raise to £59 is ending with the highest MRR.',
  'Both hires finish with the highest MRR.',
  'Raise to £59 finishes with the highest MRR.',
  'Raise to £59 finished with the highest MRR.',
  'Raise to £59 is finishing with the highest MRR.',
];
const F1_F2_PLANNING = [
  'That is the best guess we have.',
  'In the best case, churn stays flat.',
  'The top priority is pricing.',
  'This ends with a question for you.',
  'Start with the lowest-risk path.',
  'Start with the lowest-effort step.',
  'The highest-cost assumption is the hiring cost.',
  ...['assumption', 'estimate', 'input', 'setting']
    .map((head) => `We ended up with the highest-cost ${head}.`),
  ...['best', 'top', 'greatest', 'largest', 'biggest', 'strongest'].flatMap((word) =>
    ['guess', 'case', 'estimate', 'practice', 'scenario', 'way', 'next step', 'question']
      .map((noun) => `We ended up with the ${word} ${noun}.`)),
];
describe('F1/F2: result claims and planning contrasts', () => {
  it.each(F1_F2_CLAIMS)('CATCH: %s', (text) => {
    expect(both(text)).toEqual([true, true]);
    expect(textAssertsLeadingOption(text, { optionLabels: ['Hire a marketing manager', 'Raise to £59'] })).toBe(true);
  });
  it.each(F1_F2_PLANNING)('LEAVE: %s', (text) => {
    expect(both(text)).toEqual([false, false]);
    expect(textAssertsLeadingOption(text, { optionLabels: ['Hire a marketing manager', 'Raise to £59'] })).toBe(false);
  });
});

describe('LEAVE: the contrast rows the paraphrase classes must not take', () => {
  it.each([
    'You want the lowest churn you can get.',
    'This gives the lowest priority to cost.',
    'Seat price has the highest influence on the result.',
    'Churn has the highest uncertainty in your model.',
    'We have the most data on churn.',
    'Risk is highest under the current assumptions.',
    'The team topped up the budget.',
    'Retention is the top priority this quarter.',
    'The most of the uplift came from the price change.',
    'The price change resulted in the highest uncertainty in the model.',
    // Codex #2660 r1: a hyphenated compound or an input describes the thing, not a result.
    'This resulted in the lowest-risk path through the onboarding checklist.',
    'While discussing Hold, we ended up with the highest-cost assumption for the sensitivity test.',
    // v6 class C2, SERVED caf7d1a/pricing-1: a scoped STATISTIC comparison; the agent lane keeps it by its scope.
    'On the model’s internal normalised outcome scale, the £59 scenario produced the highest average outcome among the three tested prices.',
  ])('%s', (t) => {
    expect(both(t)).toEqual([false, false]);
  });
});
