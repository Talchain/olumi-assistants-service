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
    // The typed reason the face renders instead of a % (a1 #7 keys on it); words per Science §(ab)(2).
    expect(licence!.withheld_reason_by_option).toEqual({
      keep_pro_price_at_49: { reason: 'zero_spread', side: 'meets', line: 'Meets £20,000 / month by month 12 if today’s figures hold.' },
    });
  });

  it('the face line: falls short at an exact 0; "rates" where the goal is projected from monthly rates; no reason on other withholds', () => {
    const short = fixedRates.map(r => (r.option_id === 'keep_pro_price_at_49' ? record('keep_pro_price_at_49', 0, 0, 18500) : r));
    expect(goalChanceLicenceOf({ option_comparison: short }, graph, 'mrr', earnedBy(short))!.withheld_reason_by_option)
      .toEqual({ keep_pro_price_at_49: { reason: 'zero_spread', side: 'falls_short', line: 'Falls short of £20,000 / month if today’s figures hold.' } });
    const acc = structuredClone(graph);
    acc.nodes.find((n: Rec) => n.id === 'pro_paying_subscribers').nonlinear_identity = { operation: 'accumulation',
      factor_ids: ['s0', 'monthly_churn', 'new_pro_subscribers_per_month'], horizon_months: 12, rate_scale: 0.01, stated_in_brief: true };
    expect(goalChanceLicenceOf({ option_comparison: fixedRates }, acc, 'mrr', earnedBy(fixedRates))!.withheld_reason_by_option!.keep_pro_price_at_49.line)
      .toBe('Meets £20,000 / month by month 12 if today’s rates hold.');
    // CONTRAST: an exact 1 withheld for an UNSIZED path (spread present, not earned) carries no zero-spread reason.
    const spread = fixedRates.map(r => (r.option_id === 'keep_pro_price_at_49' ? record('keep_pro_price_at_49', 1, 400, 22500) : r));
    const licence = goalChanceLicenceOf({ option_comparison: spread }, graph, 'mrr', () => false)!;
    expect(licence.withheld_option_ids).toEqual(['keep_pro_price_at_49']);
    expect(licence.withheld_reason_by_option).toBeUndefined();
  });

  it('CONTRAST: the same exact 1 WITH spread (a rounding-free 1 over varied draws) stays earned and quoted, as today', () => {
    const spread = fixedRates.map(r => (r.option_id === 'keep_pro_price_at_49' ? record('keep_pro_price_at_49', 1, 400, 22500) : r));
    expect(goalCertaintyDecisions(graph, spread, undefined).find(d => d.option_id === 'keep_pro_price_at_49'))
      .toEqual({ option_id: 'keep_pro_price_at_49', probability_of_goal: 1, earned: true });
    expect(goalChanceLicenceOf({ option_comparison: spread }, graph, 'mrr', earnedBy(spread))!.pct_by_option.keep_pro_price_at_49).toBe(100);
  });

  it('⭐ RED (served form since 6 Oct): float-noise std with identical deciles is zero spread (B1 72ce907d Keep: std 1.67e-16)', () => {
    const noise = { ...fixedRates[0], outcome: { p10: 20900, p50: 20900, p90: 20900, std: 1.67e-16 } };
    expect(goalCertaintyDecisions(graph, [noise], undefined)).toEqual([]);
    const noiseOnly = { ...fixedRates[0], outcome: { p50: 20900, std: 3.3e-10 } };
    expect(goalCertaintyDecisions(graph, [noiseOnly], undefined)).toEqual([]);
    // CONTRAST: the smallest REAL spread in the census (B1 £59, std 0.0045 on a 0–1 frame) is a spread.
    const real = { ...fixedRates[0], outcome: { p10: 0.79, p50: 0.8, p90: 0.81, std: 0.0045 } };
    expect(goalCertaintyDecisions(graph, [real], undefined).map(d => d.option_id)).toEqual(['keep_pro_price_at_49']);
  });

  it('a record with no std reads its spread from p10/p90; no outcome block is not "zero spread"', () => {
    const noStd = { ...fixedRates[0], outcome: { p10: 20900, p50: 20900, p90: 20900 } };
    expect(goalCertaintyDecisions(graph, [noStd], undefined)).toEqual([]);
    const noOutcome = { option_id: 'keep_pro_price_at_49', probability_of_goal: 1 };
    expect(goalCertaintyDecisions(graph, [noOutcome], undefined).map(d => d.option_id)).toEqual(['keep_pro_price_at_49']);
  });
});
