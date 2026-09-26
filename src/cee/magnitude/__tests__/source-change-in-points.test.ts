/**
 * A PERCENTAGE LEVEL MOVES IN POINTS ON BOTH SIDES OF A LINK (served-claim audit MAG-4 / UF-2, #70 5850056041).
 *
 * ⚠ SERVED (browser run bf-20260926T202507Z, CEE d6b09c0): one reply said "Olumi estimated that raising "Price
 * resistance" by 10 raises "Monthly churn" by 1.5 points … Olumi estimated that raising "Monthly churn" by 1 % lowers
 * "MRR" by 1000 GBP/month". Churn (unit "%", 6 on its 0–100 frame) is a percentage LEVEL: its change is 1 point, as the
 * same reply says when churn is the target. "1 %" reads as a relative change (6% → 6.06%).
 */
import { describe, expect, it } from 'vitest';

import { sizeLink, type MagnitudeNode } from '../link-effect.js';

const churn: MagnitudeNode = {
  label: 'Monthly churn', kind: 'factor', scale_frame: 100,
  observed_state: { value: 0.06, raw_value: 6, unit: '%', source: 'cee_inference', extractionType: 'inferred' },
  option_levels: [],
};
const mrr: MagnitudeNode = {
  label: 'MRR', kind: 'goal', goal_threshold_cap: 25000, goal_threshold_unit: 'GBP/month', option_levels: [],
};
const price: MagnitudeNode = {
  label: 'Pro plan price', kind: 'factor', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP/month', source: 'brief_extraction' },
  option_levels: [0.295],
};
const asked = (per: number, source: MagnitudeNode, amount = -1000): string =>
  sizeLink({ direction: amount < 0 ? 'negative' : 'positive', effect_amount: amount, effect_per_source_change: per, user_stated: false }, source, mrr).question ?? '';

describe('a percentage-level source is said in points, like a percentage-level target', () => {
  it('RED (served): Olumi\'s "−1000 GBP/month per 1 point of churn" is asked as "raising "Monthly churn" by 1 point", never "by 1 %"', () => {
    const q = asked(1, churn);
    expect(q).toContain('raising "Monthly churn" by 1 point lowers "MRR"');
    expect(q).not.toMatch(/by 1 %/);
  });

  it('plural: a 2-point change says "2 points"', () => {
    expect(asked(2, churn)).toContain('raising "Monthly churn" by 2 points');
  });

  it('CONTRAST: a money source keeps its own unit ("by 10 GBP/month")', () => {
    // +5000 per £10 is β 4 on these frames (not representable), so the statement is asked back.
    expect(asked(10, price, 5000)).toContain('raising "Pro plan price" by 10 GBP/month');
  });

  it('CONTRAST: a percent CHANGE (not a level) keeps its unit, never "points"', () => {
    const growth: MagnitudeNode = { ...churn, label: 'Revenue growth', observed_state: { value: 0.06, raw_value: 6, unit: '% change vs last year' } };
    const q = asked(1, growth);
    expect(q).toContain('by 1 % change vs last year');
    expect(q).not.toMatch(/by 1 point/);
  });
});
