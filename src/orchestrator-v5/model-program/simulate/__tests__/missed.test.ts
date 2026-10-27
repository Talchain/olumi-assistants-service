/**
 * SC7: what a miss looks like in the model (the computed half of "If it failed"). The counts are bound by identity to what
 * the simulator already reports (each chance × draws, exactly); the two hand models are the method's own cases: one risk
 * behind every miss, and only a figure's low (or high) end missing, against the draws that do not miss (a common miss: a
 * third can hold at most a third of all draws, so against all draws a figure behind most misses barely rises); the noise row
 * holds the family-wise bound on figures
 * that have nothing to do with a miss; the presenter row reads the same summary in words on the Run's view.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, Goal, Limit, Option, Quantity, Risk } from '../../executable.js';
import { simulate } from '../simulate.js';
import { FAMILY_ALPHA, MISS_FLOOR, summariseMisses, type WhenMissed } from '../missed.js';
import { isWithheld, type Chance } from '../result.js';
import { presentAnalysisView, WHEN_MISSED_BASIS } from '../../present/present.js';

const N = 4000;
const SEED = 20261027;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };
const fixed = (id: string, value: number): Quantity => ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'fixed', value, author: 'person' } });
const range = (id: string, low: number, high: number): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'range', low, high, basis: 'person_range', range_kind: 'plausible' } });
const def = (id: string, op: 'sum' | 'product', parts: string[]): Quantity => ({ id, label: id, unit: '', reading: 'state', equation: { form: 'definition', op, parts } });
const goal = (id: string, quantity: string, cmp: Goal['cmp'], target: string): Goal => ({ id, label: id, quantity, cmp, target, aggregation: 'end', window: ONE });
const limit = (id: string, quantity: string, cmp: Limit['cmp'], bound: string): Limit => ({ id, label: id, quantity, cmp, bound, aggregation: 'end', window: ONE });
const option = (id: string): Option => ({ id, label: id, sets: [] });
const model = (quantities: Quantity[], goals: Goal[], risks: Risk[] = [], limits: Limit[] = []): ExecutableModel =>
  ({ periods: 1, period_unit: 'month', quantities, goals, limits, options: [option('keep')], risks, withheld: [] });
const summary = (w: WhenMissed): Extract<WhenMissed, { kind: 'summary' }> => { if (w.kind !== 'summary') throw new Error(`${w.kind}: ${w.reason}`); return w; };
const chanceOf = (c: unknown): number => { if (isWithheld(c as Chance)) throw new Error('withheld'); return (c as Chance).chance; };

/** y = 1 + z × 0, so z reaches the goal but cannot move it; the risk takes 1 off y with chance 0.3: it is behind every miss. */
const riskBehindEveryMiss = (chance = 0.3): ExecutableModel => model(
  [fixed('one', 1), fixed('minus_one', -1), fixed('zero', 0), fixed('q', chance), range('z', 0, 10), def('zz', 'product', ['z', 'zero']), def('y', 'sum', ['one', 'zz'])],
  [goal('g', 'y', '>=', 'one')],
  [{ id: 'r', occurrence: 'q', severity: 'minus_one', effect_on: 'y', mode: 'add', from_period: 0 }]);
/** y = x + w × 0: only x moves the goal (x read as 0 to 10, 8 times in 10); w reaches it but cannot move it. */
const figureEnd = (cmp: Goal['cmp'], target: number): ExecutableModel => model(
  [fixed('t', target), fixed('zero', 0), range('x', 0, 10), range('w', 0, 10), def('ww', 'product', ['w', 'zero']), def('y', 'sum', ['x', 'ww'])],
  [goal('g', 'y', cmp, 't')]);

describe('SC7: what a miss looks like, from the Run\'s own draws', () => {
  it('counts by identity: misses, and each goal\'s and limit\'s failures, are the simulator\'s own chances × draws', () => {
    const m = model([fixed('two', 2), fixed('eight', 8), range('x', 0, 10), range('v', 0, 10)], [goal('g', 'x', '>=', 'two')], [], [limit('l', 'v', '<=', 'eight')]);
    const o = simulate(m, { seed: SEED, draws: N }).options[0]!;
    const w = summary(o.when_missed);
    expect(w.draws).toBe(N);
    expect(w.misses).toBe(N - Math.round(chanceOf(o.joint_within_limits) * N));
    expect(w.aims).toEqual([
      { id: 'g', role: 'goal', failed: N - Math.round(chanceOf(o.per_goal[0]) * N) },
      { id: 'l', role: 'limit', failed: N - Math.round(chanceOf(o.per_limit[0]) * N) },
    ]);
    // Both aims fail somewhere, and a draw can fail both: the misses are at least each aim's failures, at most their sum.
    expect(w.misses).toBeGreaterThanOrEqual(Math.max(w.aims[0]!.failed, w.aims[1]!.failed));
    expect(w.misses).toBeLessThanOrEqual(w.aims[0]!.failed + w.aims[1]!.failed);
  });

  it('one risk behind every miss: it is named, in every miss against none of the draws that do not miss; the figure that cannot move the goal is not', () => {
    const o = simulate(riskBehindEveryMiss(), { seed: SEED, draws: N }).options[0]!;
    const w = summary(o.when_missed);
    // The risk fires in exactly the missed draws, and is read in every draw.
    expect(w.risks).toEqual([{ risk_id: 'r', in_misses: w.misses, read_in_misses: w.misses, share: 1, in_met: 0, read_in_met: N - w.misses, met_share: 0 }]);
    expect(w.misses / N).toBeGreaterThan(0.27);
    expect(w.misses / N).toBeLessThan(0.33);
    expect(w.figures).toEqual([]);
    expect(w.looked_at).toBe(2);
    // y is 0 wherever it falls short: its middle and its 1-in-10 bad end there.
    expect(w.outcomes).toEqual([{ goal_id: 'g', failed: w.misses, middle: 0, bad_end: 0 }]);
  });

  it('only a figure\'s low end misses an at-least goal, and only its high end an at-most one: that third, that bad end; the other figure is not named', () => {
    // x ≥ 2 misses about 22% of draws (2 is below x's lowest third, which ends near 3.3): every miss is in that third.
    const third = Math.floor(N / 3);
    const low = summary(simulate(figureEnd('>=', 2), { seed: SEED, draws: N }).options[0]!.when_missed);
    // The rest of that third meets the goal: its share of the draws that do not miss.
    expect(low.figures).toEqual([{ quantity: 'x', third: 'low', in_misses: low.misses, share: 1, in_met: third - low.misses, met_share: (third - low.misses) / (N - low.misses) }]);
    expect(low.risks).toEqual([]);
    const [lo] = low.outcomes;
    expect(lo!.bad_end).toBeLessThan(lo!.middle);
    expect(lo!.middle).toBeLessThan(2);
    // Contrast: x ≤ 8 misses only at x's high end; the bad end is then the 90th percentile, above the middle.
    const high = summary(simulate(figureEnd('<=', 8), { seed: SEED, draws: N }).options[0]!.when_missed);
    expect(high.figures).toEqual([{ quantity: 'x', third: 'high', in_misses: high.misses, share: 1, in_met: third - high.misses, met_share: (third - high.misses) / (N - high.misses) }]);
    const [hi] = high.outcomes;
    expect(hi!.bad_end).toBeGreaterThan(hi!.middle);
    expect(hi!.middle).toBeGreaterThan(8);
  });

  it('a common miss: a figure behind most of them is named, against the draws that do not miss (against all draws it could barely rise)', () => {
    // x ≥ 9 misses about 85% of draws; x's lowest third always misses (it ends near 3.3), so none of the draws that meet the
    // goal are in it, while it holds only about 39% of the misses.
    const w = summary(simulate(figureEnd('>=', 9), { seed: SEED, draws: N }).options[0]!.when_missed);
    expect(w.misses / N).toBeGreaterThan(0.8);
    const f = w.figures.find((x) => x.quantity === 'x')!;
    expect(f).toEqual({ quantity: 'x', third: 'low', in_misses: Math.floor(N / 3), share: Math.floor(N / 3) / w.misses, in_met: 0, met_share: 0 });
    // Against all draws its third's share of the misses is at most a third of the draws over the misses, under 10 points above it.
    expect(Math.floor(N / 3) / w.misses - Math.floor(N / 3) / N).toBeLessThan(0.1);
    expect(w.figures.map((x) => x.quantity)).toEqual(['x']);
  });

  it('a figure that cannot move the goal is named in at most 1 seed in 20 at the miss floor (the family-wise bound), and one that does in every seed', () => {
    // About 60 misses in 300 draws, near MISS_FLOOR, where noise is largest: z can never move y; only the risk misses.
    let irrelevant = 0, risky = 0, runs = 0;
    for (let i = 0; i < 400; i++) {
      const w = simulate(riskBehindEveryMiss(0.2), { seed: 9000 + i * 37, draws: 300 }).options[0]!.when_missed;
      if (w.kind !== 'summary') continue;
      runs++;
      if (w.figures.some((f) => f.quantity === 'z')) irrelevant++;
      if (w.risks.some((r) => r.risk_id === 'r')) risky++;
    }
    expect(runs).toBeGreaterThan(300);
    expect(irrelevant / runs).toBeLessThanOrEqual(FAMILY_ALPHA);
    expect(risky).toBe(runs);
  });

  it('too few misses, none, or a draw outside the domain: nothing is summarised, and the reason is kept', () => {
    // A 1% risk in 2,000 draws misses about 20 times, under the floor.
    const few = simulate(riskBehindEveryMiss(0.01), { seed: SEED, draws: 2000 }).options[0]!.when_missed;
    expect(few).toMatchObject({ kind: 'none', reason: 'too_few_misses', draws: 2000 });
    expect(few.misses).toBeLessThan(MISS_FLOOR);
    expect(simulate(riskBehindEveryMiss(0), { seed: SEED, draws: 500 }).options[0]!.when_missed).toEqual({ kind: 'none', reason: 'no_misses', misses: 0, draws: 500 });
    const both = Uint8Array.from([0, 1]);
    expect(summariseMisses({ draws: 2, bad: 1, both, goals: [], limits: [], figures: [], risks: [] })).toEqual({ kind: 'none', reason: 'invalid_domain', misses: 1, draws: 2 });
  });
});

describe('SC7 on the Run\'s view: goal_chance.when_missed', () => {
  it('says the same summary in words, once with its basis, naming the risk by its label', () => {
    const m = riskBehindEveryMiss();
    const result = simulate(m, { seed: SEED, draws: N });
    const view = presentAnalysisView({ model: m, result, risk_labels: { r: 'The oven breaks down' } });
    const w = view.goal_chance?.when_missed;
    expect(w?.basis).toBe(WHEN_MISSED_BASIS);
    expect(w?.options.map((o) => o.option_id)).toEqual(['keep']);
    const [keep] = w!.options;
    expect(keep!.found).toEqual(result.options[0]!.when_missed);
    const misses = summary(keep!.found).misses;
    expect(keep!.words[0]).toBe(`In this model, ‘keep’ misses the goal in ${misses.toLocaleString('en-GB')} of 4,000 simulated draws.`);
    expect(keep!.words).toContain('‘The oven breaks down’ happens in 100% of those misses, against 0% of the draws where it does not miss.');
    // y is 0 in every miss: its middle and bad end are the same, so only the middle is said.
    expect(keep!.words).toContain(`Where ‘g’ is not met, ‘y’ at 1 month from the start of this model is typically 0, against 1.`);
    expect(keep!.words.join(' ')).not.toMatch(/‘z’/);
    // Never a cause, a forecast or advice.
    expect([w!.basis, ...keep!.words].join(' ')).not.toMatch(/\b(because|caused?|should|recommend|best|will)\b/i);
  });

  it('a chance not shown has no summary: nothing is said about a miss the view does not show', () => {
    const m = model([fixed('one', 1), fixed('zero', 0), def('y', 'product', ['one', 'zero'])], [goal('g', 'y', '>=', 'one')]);
    const view = presentAnalysisView({ model: m, result: simulate(m, { seed: SEED, draws: 200 }), goals: [{ goal_id: 'g', label: 'g', status: 'asks', reasons: ['waits'], asks: [] }] });
    expect(view.options[0]!.cell.kind).toBe('withheld');
    expect(view.goal_chance?.when_missed).toBeUndefined();
  });
});
