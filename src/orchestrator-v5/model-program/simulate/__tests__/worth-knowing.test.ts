/**
 * SC4: what is most worth finding out, as the value of knowing a figure's third before choosing. The flip model's value is
 * worked out by hand (each option meets the goal on one side of 5, so knowing the third is worth about a third); the null
 * rows hold the cross-fitting (no upward bias on a figure that cannot change the result) and the family-wise bound; the
 * presenter rows read the same finding in words, licensed as the leader is.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, Goal, Limit, Option, OptionSet, Quantity, Risk } from '../../executable.js';
import { simulate } from '../simulate.js';
import { bandGain, WORTH_ALPHA, worthKnowing, type WorthInput } from '../worth-knowing.js';
import { presentAnalysisView, WORTH_KNOWING_BASIS } from '../../present/present.js';

const N = 4000;
const SEED = 20261027;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };
const fixed = (id: string, value: number): Quantity => ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'fixed', value, author: 'person' } });
const range = (id: string, low: number, high: number): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'range', low, high, basis: 'person_range', range_kind: 'plausible' } });
const def = (id: string, op: 'sum' | 'difference' | 'product', parts: string[]): Quantity => ({ id, label: id, unit: '', reading: 'state', equation: { form: 'definition', op, parts } });
const set = (quantity: string, to: string): OptionSet => ({ quantity, to, from_period: 0 });
const option = (id: string, sets: OptionSet[]): Option => ({ id, label: id, sets });
const goal = (id: string, quantity: string, target: string): Goal => ({ id, label: id, quantity, cmp: '>=', target, aggregation: 'end', window: ONE });

/** ‘a’ meets y ≥ 5 where x ≥ 5, ‘b’ where x ≤ 5 (x read as 0 to 10, 8 times in 10): each about half; w reaches ‘a’ but cannot move it. */
const flip = (limits: Limit[] = []): ExecutableModel => ({ periods: 1, period_unit: 'month', withheld: [], risks: [], limits,
  quantities: [range('x', 0, 10), range('w', 0, 10), fixed('zero', 0), fixed('ten', 10), fixed('five', 5), fixed('y', 0),
    def('ww', 'product', ['w', 'zero']), def('ya', 'sum', ['x', 'ww']), def('yb', 'difference', ['ten', 'x'])],
  goals: [goal('g', 'y', 'five')], options: [option('a', [set('y', 'ya')]), option('b', [set('y', 'yb')])] });
/** Each option meets y ≥ 1 unless its own risk fires (a 50% chance each): x reaches both, but neither chance moves with it. */
const nullModel = (): ExecutableModel => ({ periods: 1, period_unit: 'month', withheld: [], limits: [],
  quantities: [range('x', 0, 10), fixed('zero', 0), fixed('one', 1), fixed('minus_one', -1), fixed('half', 0.5), fixed('y', 0),
    def('xx', 'product', ['x', 'zero']), def('ya', 'sum', ['one', 'xx']), def('yb', 'sum', ['one', 'xx'])],
  risks: [{ id: 'ra', occurrence: 'half', severity: 'minus_one', effect_on: 'ya', mode: 'add', from_period: 0 } as Risk,
    { id: 'rb', occurrence: 'half', severity: 'minus_one', effect_on: 'yb', mode: 'add', from_period: 0 } as Risk],
  goals: [goal('g', 'y', 'one')], options: [option('a', [set('y', 'ya')]), option('b', [set('y', 'yb')])] });

/** The simulator's own thirds (by value, ties by draw), rebuilt from the per-draw inputs. */
function inputOf(m: ExecutableModel, seed: number, draws: number, quantity: string): WorthInput {
  const r = simulate(m, { seed, draws, perDraw: true });
  const xs = r.per_draw!.inputs[quantity]!, third = Math.floor(draws / 3);
  const idx = Int32Array.from({ length: draws }, (_, i) => i).sort((a, b) => xs[a]! - xs[b]! || a - b);
  return { draws, options: r.options.map((o) => o.option_id), headlines: r.per_draw!.options.map((o) => o.joint_within_limits),
    figures: [{ quantity, low: idx.slice(0, third), high: idx.slice(draws - third) }] };
}

describe('SC4: the value of knowing a figure\'s third before choosing', () => {
  it('the flip model: knowing x\'s third is worth about a third (by hand); ‘b’ in its lowest third, ‘a’ in its highest; w, which cannot move it, is not named', () => {
    const r = simulate(flip(), { seed: SEED, draws: N });
    expect(r.worth_knowing.tested).toBe(2);
    expect(r.worth_knowing.figures.map((f) => f.quantity)).toEqual(['x']);
    const [x] = r.worth_knowing.figures;
    if (x!.gain.kind !== 'sampled') throw new Error(x!.gain.kind);
    // Band policy: 1 in the lowest third, about ½ in the middle, 1 in the highest; overall about ½. So about 5/6 − 1/2 = 1/3.
    expect(x!.gain.difference).toBeGreaterThan(0.3);
    expect(x!.gain.difference).toBeLessThan(0.37);
    expect(x!.gain.precision_95[0]).toBeGreaterThan(0.25);
    expect(x!.bands.map((b) => [b.third, b.most_likely])).toEqual([['low', 'b'], ['middle', expect.any(String)], ['high', 'a']]);
    // Identity: the bands hold every draw, and each option's met draws over the bands are its chance × draws exactly.
    expect(x!.bands.reduce((s, b) => s + b.draws, 0)).toBe(N);
    for (const o of r.options) {
      const met = x!.bands.reduce((s, b) => s + b.met.find((m) => m.option_id === o.option_id)!.met, 0);
      expect(met).toBe(Math.round((o.joint_within_limits as { chance: number }).chance * N));
    }
    // In the lowest third ‘a’ never meets the goal, and in the highest ‘b’ never does.
    expect(x!.bands[0]!.met.find((m) => m.option_id === 'a')!.met).toBe(0);
    expect(x!.bands[2]!.met.find((m) => m.option_id === 'b')!.met).toBe(0);
  });

  it('cross-fitted: on a figure that cannot change the result the gain is not biased upward (mean ≤ 0.5 points over 600 seeds), and it is named in at most 1 seed in 20', () => {
    let sum = 0, named = 0;
    for (let i = 0; i < 600; i++) {
      const input = inputOf(nullModel(), 5000 + i * 31, 1000, 'x');
      sum += (bandGain(input, input.figures[0]!, 1.959963984540054).gain as { difference: number }).difference;
      if (worthKnowing(input).figures.length > 0) named++;
    }
    expect(sum / 600).toBeLessThanOrEqual(0.005);
    expect(named / 600).toBeLessThanOrEqual(WORTH_ALPHA);
  }, 60_000);

  it('one option, or a draw outside the domain: nothing is tested', () => {
    const one = flip();
    one.options = [one.options[0]!];
    expect(simulate(one, { seed: SEED, draws: 600 }).worth_knowing).toEqual({ tested: 0, figures: [] });
    const input = inputOf(flip(), SEED, 600, 'x');
    const bad = { ...input, headlines: [Int8Array.from(input.headlines[0]!, (v, d) => (d === 3 ? -1 : v)), input.headlines[1]!] };
    expect(worthKnowing(bad)).toEqual({ tested: 0, figures: [] });
  });
});

describe('SC4 on the Run\'s view: goal_chance.worth_knowing', () => {
  it('names the figure, the gain and each third\'s most likely option, once with its basis, and never chooses', () => {
    const m = flip();
    const result = simulate(m, { seed: SEED, draws: N });
    const v = presentAnalysisView({ model: m, result });
    const w = v.goal_chance?.worth_knowing;
    expect(w?.basis).toBe(WORTH_KNOWING_BASIS);
    expect(w?.figures.map((f) => f.quantity)).toEqual(['x']);
    const [x] = w!.figures;
    expect(x!.found).toEqual(result.worth_knowing.figures[0]);
    const more = Math.round((x!.found.gain as { difference: number }).difference * 100);
    expect(x!.words).toMatch(new RegExp(`^In this model, knowing which third of its draws ‘x’ \\(your range\\) falls in before choosing, and taking the option most likely there, meets the goal in about ${more} more of every 100 simulated draws than ‘[ab]’, the option most likely overall\\. Most likely in each third: in its lowest third, ‘b’ \\(100%, against 0% for ‘a’\\); in its middle third, `));
    expect(x!.words).toContain('in its highest third, ‘a’ (100%, against 0% for ‘b’).');
    expect([w!.basis, x!.words].join(' ')).not.toMatch(/\b(should|recommend|best|winner|choose ‘)/i);
  });

  it('licensed as the leader is: a Run known not to be current, or a limit not yet checked, says nothing of it', () => {
    const m = flip();
    const result = simulate(m, { seed: SEED, draws: N });
    expect(presentAnalysisView({ model: m, result, current: false, run: { run_id: 'r', graph_hash_at_run: 'h', computed_at: 't' } }).goal_chance?.worth_knowing).toBeUndefined();
    expect(presentAnalysisView({ model: m, result, limits: [{ limit_id: 'l', label: 'Budget', status: 'asks', reasons: ['waits'], asks: [] }] }).goal_chance?.worth_knowing).toBeUndefined();
  });
});
