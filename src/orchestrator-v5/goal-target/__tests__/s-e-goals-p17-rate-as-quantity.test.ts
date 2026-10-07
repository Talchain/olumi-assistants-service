/**
 * ⭐ S-E GOALS P17: a population rate written as a probability is a QUANTITY (Science ruling (b),
 * `inflight/science-393023-goals-rulings-20261007.md`). Rows are not the author's:
 *  · QUANTITY and CHANCE twins: the ruling's own rows, verbatim;
 *  · "churn probability": CEE's served drafter prompt names it as a unit example (`src/prompts/defaults-v19.ts:140`);
 *  · SERVED chance goals: every distinct (label, unit) goal pair whose unit names a chance, across the 109 captured
 *    staging/prod JSON files under `output/` (aggregate read, 7 Oct 21:5xZ). Each one must stay a chance.
 */
import { describe, expect, it } from 'vitest';
import { readRateAsQuantity } from '../rate-as-quantity.js';
import { goalKindOf } from '../goal-kind.js';
import { withholdGoalFiguresForChanceGoal } from '../../tools/handlers/run-analysis.js';

describe('Science (b) rows: a rate is a quantity, a one-off event stays a chance', () => {
  it.each([
    ['churn probability', 2],
    ['monthly churn probability', 1],
    ['probability a customer churns each month', 1], // "each month": rule 1 comes first (buddy r1 P2)
    ['conversion probability per visitor', 1],
    ['the chance a trial user converts', 2],
  ] as const)('QUANTITY: %s (rule %i)', (text, rule) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('level');
  });
  it.each([
    ['probability we hit the launch date', 3],
    ['chance of winning the Acme contract', 3],
    ['probability the hire works out', 3],
  ] as const)('CHANCE twin: %s (rule %i)', (text, rule) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'chance', rule });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('chance_of_event');
  });
  it('rule 4: nothing to read keeps today’s fail-closed chance; "within a month" is a window, not a rate', () => {
    expect(readRateAsQuantity('probability (%)')).toEqual({ kind: 'chance', rule: 4 });
    expect(readRateAsQuantity('probability the migration finishes within a month')).toEqual({ kind: 'chance', rule: 4 });
    expect(readRateAsQuantity('probability the migration finishes, 3% a month')).toEqual({ kind: 'quantity', rule: 1 });
  });
  it('bounded: text over 400 characters is not read (rule 4), whatever it says', () => {
    expect(readRateAsQuantity(`churn probability${' '.repeat(400)}`)).toEqual({ kind: 'chance', rule: 4 });
    expect(readRateAsQuantity(`churn probability${' '.repeat(300)}`)).toEqual({ kind: 'quantity', rule: 2 });
  });
});

describe('the goal’s label is read with its unit (the drafter often writes the subject only in the label)', () => {
  it.each([
    ['Monthly churn', 'probability (%)'],
    ['Customer churn', '% probability'],
    ['Trial-to-paid conversion', 'probability (0–1)'],
  ])('QUANTITY: %s measured in %s', (label, unit) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe('level');
  });
  // SERVED: every distinct goal pair from the captured corpus (counts in comments).
  it.each([
    ['ship the new platform by Q3', 'probability of shipping by Q3 (%)'], // 17
    ['Ship the new platform by Q3', 'probability (%)'], // 14
    ['ship the new platform by Q3', 'probability (%)'], // 11
    ['New platform shipment by Q3', 'probability (%)'], // 8
    ['ship the new platform', 'probability of shipment by Q3 (%)'], // 8
    ['ship the new platform', '% probability of shipping by Q3'], // 7
    ['ship the new platform', 'probability of shipping by Q3 (%)'], // 7
    ['ship the new platform by Q3', '% likelihood of shipping by Q3'], // 6
    ['ship the new platform by Q3', '% probability'], // 2
    ['ship the new platform by Q3', '% likelihood'], // 1
    ['ship the new platform by Q3', '% likelihood of shipment'], // 1
    ['meet our next feature-launch deadline', '% on-time probability'], // 1 (Paul's 6582edbc shape)
    ['New platform shipped by Q3', 'probability (0–1)'], // 1
  ])('SERVED CHANCE stays a chance: %s measured in %s', (label, unit) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe('chance_of_event');
  });
});

describe('Codex buddy r1 (#2780 @ 7ddad08b): event timing and everyday words never make a one-off event a rate', () => {
  it.each([
    ['Launch a month from now', 'probability (%)'],
    ['Probability we win the open tender', 'probability (%)'],
    ['Return the deposit by Friday', 'probability (%)'],
    ['Default supplier delivers on time', 'probability (%)'],
  ])('CHANCE: %s measured in %s', (label, unit) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe('chance_of_event');
  });
  it.each([
    ['probability of purchase each month', 1],
    ['default probability', 2],
    ['probability of default', 2],
    ['probability a customer returns', 2],
    ['the chance a visitor clicks through', 2],
  ] as const)('QUANTITY: %s (rule %i)', (text, rule) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule });
  });
  it('a million-character label is cut before it is joined, and falls to rule 4', () => {
    expect(goalKindOf({ kind: 'goal', label: `churn ${'x'.repeat(1_000_000)}`, goal_threshold_unit: 'probability (%)' })).toBe('chance_of_event');
  });
});

describe('the Run (run-analysis withhold seam): a rate goal keeps its figures; a served event goal still withholds them', () => {
  const envelope = () => ({ option_comparison: [{ option_id: 'a', probability_of_goal: 0.4, outcome: { mean: 2.5, p10: 1, p90: 4 } }], inference_warnings: [] });
  const graph = (label: string, unit: string) => ({ nodes: [{ id: 'g', kind: 'goal', label, goal_threshold_unit: unit }] });
  it('RED on staging: "Monthly churn" in "probability (%)" was withheld as a chance; now the envelope is returned as is', () => {
    const e = envelope();
    expect(withholdGoalFiguresForChanceGoal(e, graph('Monthly churn', 'probability (%)'))).toBe(e);
  });
  it('CONTROL: the served "ship the new platform by Q3" in "probability (%)" is still withheld for every option', () => {
    const out = withholdGoalFiguresForChanceGoal(envelope(), graph('ship the new platform by Q3', 'probability (%)')) as { option_comparison: { probability_of_goal?: number }[] };
    expect(out.option_comparison[0]?.probability_of_goal).toBeUndefined();
  });
});
