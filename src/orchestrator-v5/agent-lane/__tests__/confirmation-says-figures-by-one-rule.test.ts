/**
 * ⛔ CEE SAYS A FIGURE BY ONE RULE (DL #72 5870353946: the CEE half of Panel's ROOT 5870330356).
 *
 * Served on UI `f0c8814f` (`panel/served-gbp/served-f0c8814f.json`): one price edit was said four ways. CEE's own
 * assistant text read "Updated Pro plan monthly price from 49 GBP/month to 58.8 GBP/month.", because
 * `formatValueWithUnit` (d1-shared) placed a currency CODE after the figure, while the Agent's consent labels
 * (`agent-lane/say-figure.ts`) already said "£49/month".
 *
 * The rule: with a unit, `formatValueWithUnit` IS `sayFigureAsWritten`. A currency code says its symbol, money with pence
 * says both digits, "percent" says "%", and a count agrees with its figure. It stays exact to four decimal places,
 * because a confirmation names the value the model now holds. Display only: no stored value or unit changes.
 */
import { describe, it, expect } from 'vitest';
import {
  formatConstraintAdded,
  formatFactorChange,
  formatFactorValueSet,
  formatFactorValueUnchanged,
  formatValueWithUnit,
  pluraliseUnit,
} from '../../tools/handlers/d1-shared/format-confirmation.js';
import { sayFigureAsWritten } from '../say-figure.js';
import { extractQuantities } from '../../context/cqe/extract-quantities.js';
import { buildClarifyChipMessage, deriveOperator, mapCqeQuantityToProposalValue } from '../../routing/deterministic-value-update.js';

// The ≥10-shape probe: [value, unit, as a person writes it].
const PROBE: ReadonlyArray<readonly [number, string, string]> = [
  [49, 'GBP/month', '£49 / month'],
  [58.8, 'GBP/month', '£58.80 / month'],
  [58.8, 'GBP per month', '£58.80 per month'],
  [30000, 'GBP', '£30,000'],
  [49, '£', '£49'],
  [100000, 'USD/year', '$100,000 / year'],
  [49, 'GBP per subscriber/month', '£49 per subscriber / month'],
  [1500, 'subscribers/month', '1,500 subscribers / month'],
  [5, '%', '5%'],
  [5, 'percent', '5%'],
  [0.0525, '%', '0.0525%'],
  [12, 'months', '12 months'],
  [1, 'months', '1 month'],
  [1500, 'subscribers', '1,500 subscribers'],
  [3, 'story_points', '3 story points'],
  [-5, '%', '-5%'],
  [2, 'CHF', '2 CHF'],
  [45, '£k per month', '45 £k per month'],
  // AIQ meaning rows on #2247 (5871017629): the sign before the symbol, and points are not percent.
  [-500, 'GBP', '-£500'],
  [-58.8, 'GBP/month', '-£58.80 / month'],
  [4, 'percentage points', '4 percentage points'],
  [1, 'percentage points', '1 percentage point'],
];

describe('⛔ CEE says a figure by one rule (Panel ROOT 5870330356, DL 5870353946)', () => {
  it('DL row (5871074397): the served option card’s two halves read identically, "£58.80 / month → £59 / month"', () => {
    const said = formatFactorChange({ label: 'Pro plan monthly price', before: { raw_value: 58.8, unit: 'GBP/month' }, after: { raw_value: 59, unit: 'GBP/month' } });
    expect(said).toBe('Updated Pro plan monthly price from £58.80 / month to £59 / month.');
  });

  it('RED (served f0c8814f): the price edit reads "£49/month" and "£58.80/month", never "GBP"', () => {
    const said = formatFactorChange({ label: 'Pro plan monthly price', before: { raw_value: 49, unit: 'GBP/month' }, after: { raw_value: 58.8, unit: 'GBP/month' } });
    expect(said).toBe('Updated Pro plan monthly price from £49 / month to £58.80 / month.');
    expect(said).not.toMatch(/GBP/);
  });

  for (const [value, unit, want] of PROBE) {
    it(`probe: ${value} "${unit}" → "${want}"`, () => {
      expect(formatValueWithUnit(value, unit)).toBe(want);
      // IDENTITY: the confirmation's form IS the one rule's, not a look-alike.
      expect(formatValueWithUnit(value, unit)).toBe(sayFigureAsWritten(value, unit));
    });
  }

  it('every confirmation formatter says a currency code as its symbol', () => {
    const texts = [
      formatFactorValueSet({ label: 'Price', after: { raw_value: 59, unit: 'GBP/month' } }),
      formatFactorValueUnchanged({ label: 'Price', after: { raw_value: 59, unit: 'GBP/month' } }),
      formatConstraintAdded({ targetLabel: 'Budget', operator: '<=', value: 20000, unit: 'GBP' }),
    ];
    for (const t of texts) expect(t, t).not.toMatch(/\bGBP\b/);
    expect(texts[0]).toBe('Updated Price to £59 / month.');
  });

  it('CONTROL: a bare number is unchanged, and it stays exact past two decimal places', () => {
    expect(formatValueWithUnit(50000)).toBe('50,000');
    expect(formatValueWithUnit(0.0525)).toBe('0.0525');
    expect(formatValueWithUnit(0.1234, 'GBP')).toBe('£0.1234');
  });

  // ⛔ The one consumer that reaches a WRITER: a clarify chip's message is replayed as the user's turn and re-parsed by
  // the real CQE. The figure it says must parse back to the same value and unit, or the click writes something else.
  // Compared WITH the message, as the writer reads it (the period rides the words, not the quantity).
  const ROUND_TRIP: ReadonlyArray<readonly [string, { value: number; unit: string | undefined }]> = [
    ['Set price to £49.50.', { value: 49.5, unit: '£' }],
    ['Set migration cost to £250k.', { value: 250000, unit: '£' }],
    ['Set churn to 3.5%.', { value: 3.5, unit: '%' }],
    ['Set the delay to 3 months.', { value: 3, unit: 'month' }],
    ['Increase the budget by £20k.', { value: 20000, unit: '£' }],
    ['Set price to $1,299.99.', { value: 1299.99, unit: '$' }],
    // AIQ 5871017629: a negative keeps its sign through the replay.
    ['Set the margin to -£500.', { value: -500, unit: '£' }],
    ['Set the margin to £-500.', { value: -500, unit: '£' }],
    ['Set growth to -3%.', { value: -3, unit: '%' }],
    // AIQ 5871084445: the spaced " / " is re-read as the same rate; "per month" is carried into the chip.
    ['Set price to £49.50 per month.', { value: 49.5, unit: '£/month' }],
    ['Set price to £49.50/month.', { value: 49.5, unit: '£/month' }],
  ];
  for (const [typed, want] of ROUND_TRIP) {
    it(`WRITER ROUND TRIP (real CQE): "${typed}" → chip message → the same value, unit and operator`, () => {
      const [q] = extractQuantities(typed);
      expect(q, typed).toBeDefined();
      const typedAs = mapCqeQuantityToProposalValue(q!, typed);
      expect(typedAs.value, 'what the user typed is read as').toBeCloseTo(want.value, 9);
      expect(typedAs.unit).toBe(want.unit);
      const msg = buildClarifyChipMessage(typed, { id: 'f1', label: 'Price', score: 1, source: 'substring' }, q!);
      const [back] = extractQuantities(msg);
      expect(back, msg).toBeDefined();
      // The writer's own reading of the replay: value, unit (with the period the words carry) and operator.
      expect(mapCqeQuantityToProposalValue(back!, msg), msg).toEqual(typedAs);
      expect(deriveOperator(msg, back!), msg).toBe(deriveOperator(typed, q!));
    });
  }

  it('the rate chip SAYS the spaced notation, and a bare amount says no period (AIQ contrast)', () => {
    const chip = (typed: string) => buildClarifyChipMessage(typed, { id: 'f1', label: 'Price', score: 1, source: 'substring' }, extractQuantities(typed)[0]!);
    expect(chip('Set price to £49.50 per month.')).toBe('Set Price to £49.50 / month.');
    expect(chip('Set price to £49.50.')).toBe('Set Price to £49.50.');
  });

  // DL CHANGES_REQUIRED on #2247 @03e509fc: CQE masks each figure it reads, so the hyphen after one looked like a word
  // start. The sign is decided on the ORIGINAL text: a range's hyphen and a bullet are never a minus.
  for (const [typed, want] of [
    ['£100-£500', [100, 500]],
    // The DL's reproduction: an edit verb's rule masks "£100" first, and at 03e509fc the hyphen then read as a sign.
    ['Set the budget to £100-£500.', [100, 500]],
    ['Increase spend by £100-£500', [100, 500]],
    ['Set price to £100-£500', [100, 500]],
    ['Budget between £100-£500.', [100, 500]],
    ['Price £100-£500', [100, 500]],
    ['between £100 -£500', [100, 500]],
    ['Costs:\n-£500 for tools', [500]],
    ['Costs:\n- £500 for tools', [500]],
    ['10k -£5k', [5000]],
    ['Costs:\n  -£500 for tools\n  -£200 for training', [500, 200]],
  ] as const) {
    it(`CONTRAST (CQE): a range’s hyphen or a bullet is never a sign — ${JSON.stringify(typed)}`, () => {
      const gbp = extractQuantities(typed).filter((q) => q.unit === 'GBP');
      expect(gbp.map((q) => q.value), typed).toEqual(want);
    });
  }
  for (const [typed, want] of [['-£500', -500], ['Set the margin to -£500.', -500], ['Margin: -£500', -500], ['Set cost to (-£20k).', -20000], ['Adjust:\nSet the margin to -£500.', -500]] as const) {
    it(`a minus that IS the sign stays negative — ${JSON.stringify(typed)}`, () => {
      expect(extractQuantities(typed).map((q) => q.value)).toEqual([want]);
    });
  }

  it('pluraliseUnit moved with the rule and still answers its importers', () => {
    expect(pluraliseUnit('months', 1)).toBe('month');
    expect(pluraliseUnit('status', 1)).toBe('status');
  });
});
