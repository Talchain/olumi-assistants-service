/**
 * ⭐ S-E GOALS P17: a population rate written as a probability is a QUANTITY (Science ruling (b),
 * `inflight/science-393023-goals-rulings-20261007.md`). Rows are not the author's:
 *  · QUANTITY and CHANCE twins: the ruling's own rows, verbatim;
 *  · "churn probability": CEE's served drafter prompt names it as a unit example (`src/prompts/defaults-v19.ts:140`);
 *  · SERVED chance goals: every distinct (label, unit) goal pair whose unit names a chance, across the 109 captured
 *    staging/prod JSON files under `output/` (aggregate read, 7 Oct 21:5xZ). Each one must stay a chance.
 */
import { describe, expect, it, vi } from 'vitest';
import { readRateAsQuantity } from '../rate-as-quantity.js';
import * as rateClassifier from '../rate-as-quantity.js';
import { goalKindOf, rateUnitInPercent } from '../goal-kind.js';
import { readStatedGoalLevel } from '../../agent-lane/goal-current-level.js';
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
    expect(readRateAsQuantity('probability the migration finishes within a month')).toEqual({ kind: 'chance', rule: 3 });
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
  it('a million-character label is bounded before the classifier reads each segment', () => {
    const read = vi.spyOn(rateClassifier, 'readRateAsQuantity');
    try {
      expect(goalKindOf({ kind: 'goal', label: `churn ${'x'.repeat(1_000_000)}`, goal_threshold_unit: 'probability (%)' })).toBe('chance_of_event');
      expect(read.mock.calls.map(([text]) => text.length)).toEqual([15, 401]);
    } finally {
      read.mockRestore();
    }
  });
});

describe('review r1: subjects and denominators are read within each segment, in Science (b) order', () => {
  it.each([
    'chance we meet the churn target by Friday',
    'probability the open tender succeeds',
    'probability that the conversion target succeeds',
    '% likelihood of reaching our MRR target',
    '% likelihood of reaching our ARR target',
    'chance we meet the monthly revenue target',
    'probability the annual tender succeeds',
    'probability the customer experiences churn',
    'probability the plan limits churn',
  ])('an event remains a chance: %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'chance', rule: 3 });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('chance_of_event');
  });
  it('bare probability and a command label never form a population subject across segments', () => {
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label: 'Return the deposit by Friday' })).toBe('chance_of_event');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability of', label: 'Return the deposit by Friday' })).toBe('chance_of_event');
  });
  it.each(['probability of a plan to cut churn', 'probability of return of the deposit', 'probability of open tender success'])(
    'a population word in an event is not its subject: %s', (text) => {
      expect(readRateAsQuantity(text).kind).toBe('chance');
    });
  it('a denominator requires a noun', () => {
    expect(readRateAsQuantity('probability per')).toEqual({ kind: 'chance', rule: 4 });
  });
  it('a period adjective on an event’s metric does not govern the probability', () => {
    const text = 'probability monthly revenue reaches target';
    expect(readRateAsQuantity(text).kind).toBe('chance');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label: text })).toBe('chance_of_event');
  });
  it.each(['The supplier defaults', 'The tender opens', 'The supplier churns'])(
    'a label’s verb is not a population subject: %s', (label) => {
      expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label })).toBe('chance_of_event');
    });
  it('a population member’s act keeps rule 2 without a chance word in the label', () => {
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability', label: 'Customer defaults' })).toBe('level');
  });
  it.each([
    'probability of repayment per loan',
    'probability of a failed payment per transaction',
    'probability of repayment for each loan',
    'probability of a failed payment every transaction',
    'probability of breakage per shipment',
    'probability of rejection for each application',
  ])('any repeated denominator fires rule 1: %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule: 1 });
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: text })).toBe('level');
  });
  it.each(['churn probability', 'probability of churn', 'probability of customer churn'])('the population noun is the subject: %s', (text) => {
    expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule: 2 });
  });
  it.each(['monthly churn probability', 'annual churn probability', 'churn probability a month', 'probability of churn per month',
    'probability of average monthly customer churn'])(
    'a real period marker fires rule 1: %s', (text) => {
      expect(readRateAsQuantity(text)).toEqual({ kind: 'quantity', rule: 1 });
    });
  it('rule 1 wins over an event in another segment; rule 2 cannot borrow a member from another segment', () => {
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability per loan', label: 'the tender succeeds' })).toBe('level');
    expect(goalKindOf({ kind: 'goal', goal_threshold_unit: 'probability of the customer', label: 'Return the deposit by Friday' })).toBe('chance_of_event');
  });
});

describe('percent scales use the existing unit readers without losing their denominators', () => {
  it.each(['probability (%) per month', 'probability (pct) per month', 'probability (per cent) per month', 'probability [0–100%] per month'])(
    '%s takes only the matching percent period', (unit) => {
      expect(rateUnitInPercent(unit, '% per month')).toBe('% per month');
      const goal = { label: 'Monthly churn', unit };
      expect(readStatedGoalLevel(5, '% per month', goal)).toEqual({ ok: true, raw: 5 });
      expect(readStatedGoalLevel(5, '% per year', goal)).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    });
  it('a per-unit percent denominator must also match', () => {
    const goal = { label: 'Repayment', unit: 'probability (%) per loan' };
    expect(readStatedGoalLevel(5, '% per loan', goal)).toEqual({ ok: true, raw: 5 });
    expect(readStatedGoalLevel(5, '% per transaction', goal)).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
  });
  it.each(['probability (percentile) per month', 'probability (percentage points) per month', 'probability (0–1) per month'])(
    '%s does not invent a percent scale', (unit) => {
      expect(rateUnitInPercent(unit, '% per month')).toBeUndefined();
    });
});

describe('Codex buddy r2 (#2780 @ c0c84cfa): date offsets, subject-bound members, per-unit counts, plural click-throughs', () => {
  it.each([
    ['Launch a month after the funding round', 'probability (%)', 'chance_of_event'],
    ['Return the customer deposit by Friday', 'probability (%)', 'chance_of_event'],
    ['Visitor click-throughs', 'probability (%)', 'level'],
    ['Scoring chances created', 'chances the team creates per match', 'level'],
    ['Customer returns', 'probability (%)', 'level'],
  ])('%s measured in %s → %s', (label, unit, kind) => {
    expect(goalKindOf({ kind: 'goal', label, goal_threshold_unit: unit })).toBe(kind);
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
