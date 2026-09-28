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

// The ≥10-shape probe: [value, unit, as a person writes it].
const PROBE: ReadonlyArray<readonly [number, string, string]> = [
  [49, 'GBP/month', '£49/month'],
  [58.8, 'GBP/month', '£58.80/month'],
  [58.8, 'GBP per month', '£58.80 per month'],
  [30000, 'GBP', '£30,000'],
  [49, '£', '£49'],
  [100000, 'USD/year', '$100,000/year'],
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
];

describe('⛔ CEE says a figure by one rule (Panel ROOT 5870330356, DL 5870353946)', () => {
  it('RED (served f0c8814f): the price edit reads "£49/month" and "£58.80/month", never "GBP"', () => {
    const said = formatFactorChange({ label: 'Pro plan monthly price', before: { raw_value: 49, unit: 'GBP/month' }, after: { raw_value: 58.8, unit: 'GBP/month' } });
    expect(said).toBe('Updated Pro plan monthly price from £49/month to £58.80/month.');
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
    expect(texts[0]).toBe('Updated Price to £59/month.');
  });

  it('CONTROL: a bare number is unchanged, and it stays exact past two decimal places', () => {
    expect(formatValueWithUnit(50000)).toBe('50,000');
    expect(formatValueWithUnit(0.0525)).toBe('0.0525');
    expect(formatValueWithUnit(0.1234, 'GBP')).toBe('£0.1234');
  });

  it('pluraliseUnit moved with the rule and still answers its importers', () => {
    expect(pluraliseUnit('months', 1)).toBe('month');
    expect(pluraliseUnit('status', 1)).toBe('status');
  });
});
