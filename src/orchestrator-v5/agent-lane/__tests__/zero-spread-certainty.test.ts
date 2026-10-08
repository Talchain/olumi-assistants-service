/**
 * ⛔ ZERO SPREAD IS NOT A CHANCE (Science §(ab)(2); DL CHANGES_REQUIRED on #2858): with the user's monthly rates held
 * fixed, B1's Keep £49 reaches £20k at month 12 in EVERY draw, so its P(goal) is exactly 1. Keep moves nothing, so the
 * certainty rule called that 1 "earned" and the licence would quote "100%". A zero-spread option records no certainty:
 * the licence withholds its %, and nothing else may say 100%.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalCertaintyDecisions } from '../goal-certainty.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';

type Rec = Record<string, any>;
// B1 828d87ac's stored graph: goal MRR ≥ £20,000/month within 12 months; Keep £49 is the baseline.
const graph = JSON.parse(readFileSync(new URL('../../system-events/__tests__/fixtures/b1-828d87ac-stored-graph.json', import.meta.url), 'utf8')) as Rec;
const record = (option_id: string, p: number, std: number, p50: number): Rec => ({
  option_id, id: option_id, status: 'computed', probability_of_goal: p,
  outcome: { p10: p50 - 1.2816 * std, p50, p90: p50 + 1.2816 * std, std, mean: p50, n_samples: 1000, n_valid_samples: 1000 },
});
// Keep at fixed rates: every draw is the same £20.9k. The two price rises carry spread from their price → churn links.
const fixedRates = [record('keep_pro_price_at_49', 1, 0, 20900), record('raise_pro_price_to_59', 0.62, 1800, 21400),
  record('raise_pro_price_to_54', 0.7, 1500, 21100)];
const earnedBy = (records: Rec[]) => {
  const decisions = goalCertaintyDecisions(graph, records, undefined);
  return (id: string, p: 0 | 1) => decisions.some(d => d.option_id === id && d.probability_of_goal === p && d.earned);
};

describe('B1 Keep £49 at month 12, the user\'s rates held fixed', () => {
  it('⭐ RED: no certainty decision for a zero-spread exact 1, so it is never earned', () => {
    expect(goalCertaintyDecisions(graph, fixedRates, undefined).find(d => d.option_id === 'keep_pro_price_at_49')).toBeUndefined();
  });

  it('⭐ RED: the licence quotes no % for Keep (no "100%"), and still quotes the options with spread', () => {
    const licence = goalChanceLicenceOf({ option_comparison: fixedRates }, graph, 'mrr', earnedBy(fixedRates));
    expect(licence).not.toBeNull();
    expect(licence!.withheld_option_ids).toEqual(['keep_pro_price_at_49']);
    expect(Object.keys(licence!.pct_by_option)).toEqual(['raise_pro_price_to_59', 'raise_pro_price_to_54']);
    expect(Object.values(licence!.pct_by_option)).not.toContain(100);
  });

  it('CONTRAST: the same exact 1 WITH spread (a rounding-free 1 over varied draws) stays earned and quoted, as today', () => {
    const spread = fixedRates.map(r => (r.option_id === 'keep_pro_price_at_49' ? record('keep_pro_price_at_49', 1, 400, 22500) : r));
    expect(goalCertaintyDecisions(graph, spread, undefined).find(d => d.option_id === 'keep_pro_price_at_49'))
      .toEqual({ option_id: 'keep_pro_price_at_49', probability_of_goal: 1, earned: true });
    expect(goalChanceLicenceOf({ option_comparison: spread }, graph, 'mrr', earnedBy(spread))!.pct_by_option.keep_pro_price_at_49).toBe(100);
  });

  it('a record with no std reads its spread from p10/p90; no outcome block is not "zero spread"', () => {
    const noStd = { ...fixedRates[0], outcome: { p10: 20900, p50: 20900, p90: 20900 } };
    expect(goalCertaintyDecisions(graph, [noStd], undefined)).toEqual([]);
    const noOutcome = { option_id: 'keep_pro_price_at_49', probability_of_goal: 1 };
    expect(goalCertaintyDecisions(graph, [noOutcome], undefined).map(d => d.option_id)).toEqual(['keep_pro_price_at_49']);
  });
});
