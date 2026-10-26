/**
 * SC2: two results compared on the same draws. Counts are by hand; the interval's literals were worked out independently
 * (Newcombe 1998, method 10, from the two Wilson intervals and phi, in stdlib arithmetic, not by this code); the coverage rows
 * use risks, whose firing is a uniform draw, so the true gap is known exactly.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, Option, OptionSet, Quantity, Risk } from '../../executable.js';
import { simulate, wilson95 } from '../simulate.js';
import { pairedDifference, separated } from '../paired.js';

const fixed = (id: string, value: number): Quantity => ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'fixed', value, author: 'structure' } });
const set = (quantity: string, to: string): OptionSet => ({ quantity, to, from_period: 0 });
const option = (id: string, sets: OptionSet[]): Option => ({ id, label: id, sets });
/** y is 1, less 1 where a risk fires; the goal is y ≥ 1, so an option meets it exactly where none of its risks fires. */
function risky(options: Option[], risks: Risk[], chances: Quantity[]): ExecutableModel {
  return { periods: 1, period_unit: 'month', quantities: [fixed('y', 1), fixed('one', 1), fixed('minus_one', -1), fixed('zero', 0), ...chances],
    goals: [{ id: 'g', label: 'g', quantity: 'y', cmp: '>=', target: 'one', aggregation: 'end', window: { start_period: 0, periods: 1 } }],
    limits: [], options, risks, withheld: [] };
}
const risk = (id: string, occurrence: string): Risk => ({ id, occurrence, severity: 'minus_one', effect_on: 'y', mode: 'add', from_period: 0 });
/** One risk, one uniform per draw, shared: A's chance of the risk 0.30, B's 0.32. A meets the goal wherever B does, and in 2% more. */
const coupled = risky([option('a', [set('q', 'q30')]), option('b', [set('q', 'q32')])], [risk('r', 'q')], [fixed('q', 0), fixed('q30', 0.3), fixed('q32', 0.32)]);
/** Two risks with their own uniforms: A faces only r1 (0.30), B only r2 (0.32). Independent draws; the true gap is still 0.02. */
const separate = risky([option('a', [set('q1', 'q30')]), option('b', [set('q2', 'q32')])], [risk('r1', 'q1'), risk('r2', 'q2')],
  [fixed('q1', 0), fixed('q2', 0), fixed('q30', 0.3), fixed('q32', 0.32)]);

describe('SC2: the paired gap, by hand', () => {
  it('is a − b counted draw by draw, with Newcombe\'s interval; a draw outside the domain withholds it; fixed results are exact', () => {
    // both 10, only a 5, only b 1, neither 4 (n 20): gap (5 − 1)/20 = 0.2.
    const a = [...Array(10).fill(1), ...Array(5).fill(1), ...Array(1).fill(0), ...Array(4).fill(0)];
    const b = [...Array(10).fill(1), ...Array(5).fill(0), ...Array(1).fill(1), ...Array(4).fill(0)];
    const p = pairedDifference(a, b);
    if (p.kind !== 'sampled') throw new Error(p.kind);
    expect(p.difference).toBeCloseTo(0.2, 12);
    expect(p.precision_95[0]).toBeCloseTo(-0.024814877260, 9);
    expect(p.precision_95[1]).toBeCloseTo(0.397430627506, 9);
    expect([p.draws, p.differ, separated(p)]).toEqual([20, 6, false]);
    // only a met, in 4 of 10 draws: 0.4, from 0.038385820888 to 0.687326230266, so separated.
    const q = pairedDifference([1, 1, 1, 1, 0, 0, 0, 0, 0, 0], Array(10).fill(0));
    expect(q).toMatchObject({ kind: 'sampled', difference: 0.4 });
    if (q.kind !== 'sampled') throw new Error(q.kind);
    expect(q.precision_95[0]).toBeCloseTo(0.038385820888, 9);
    expect(q.precision_95[1]).toBeCloseTo(0.687326230266, 9);
    expect(separated(q)).toBe(true);
    expect(pairedDifference([1, -1, 0], [1, 1, 0])).toEqual({ kind: 'withheld', reason: 'invalid_domain', count: 1 });
    expect(pairedDifference([1, 1, 0], [0, 0, 0], true)).toEqual({ kind: 'exact', difference: 2 / 3 });
    expect(() => pairedDifference([1], [1, 0])).toThrow();
  });
});

describe('SC2: the paired gap on the engine (the true gap is known)', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => 7000 + i * 101);
  const run = (m: ExecutableModel, seed: number, draws: number) => simulate(m, { seed, draws });
  it('is the engine\'s own per-draw headlines compared, for every pair of options', () => {
    const r = simulate(coupled, { seed: 11, draws: 2000, perDraw: true });
    const [a, b] = r.per_draw!.options;
    expect(r.paired).toEqual([{ a: 'a', b: 'b', joint_within_limits: pairedDifference(a!.joint_within_limits, b!.joint_within_limits) }]);
    // Coupled: B never meets the goal where A misses it.
    for (let i = 0; i < 2000; i++) expect(b!.joint_within_limits[i]! <= a!.joint_within_limits[i]!).toBe(true);
  });
  it('covers the true gap of 0.02 in about 95% of seeds, coupled (all one way) and independent; it separates far more often than two intervals do', () => {
    for (const [name, m, draws] of [['coupled', coupled, 2000], ['separate', separate, 4000]] as const) {
      let covered = 0, pairedApart = 0, intervalsApart = 0;
      for (const seed of seeds) {
        const r = run(m, seed, draws), p = r.paired[0]!.joint_within_limits;
        if (p.kind !== 'sampled') throw new Error(`${name}: ${p.kind}`);
        if (p.precision_95[0] <= 0.02 && 0.02 <= p.precision_95[1]) covered++;
        if (separated(p)) pairedApart++;
        const [ca, cb] = r.options.map((o) => o.joint_within_limits as { chance: number });
        const wa = wilson95(Math.round(ca!.chance * draws), draws), wb = wilson95(Math.round(cb!.chance * draws), draws);
        if (wa[0] > wb[1]) intervalsApart++;
      }
      expect(covered / seeds.length, name).toBeGreaterThanOrEqual(0.9);
      expect(covered / seeds.length, name).toBeLessThanOrEqual(0.99);
      expect(pairedApart, name).toBeGreaterThanOrEqual(intervalsApart);
      if (name === 'coupled') expect([pairedApart, intervalsApart]).toEqual([seeds.length, 0]); // ±0.3 points paired, ±2 points apart
    }
  }, 60_000);
  it('is exact where both options are fixed in every draw', () => {
    const m: ExecutableModel = { periods: 1, period_unit: 'month', quantities: [fixed('y', 3), fixed('t', 2), fixed('lift', 0), fixed('minus', -2)],
      goals: [{ id: 'g', label: 'g', quantity: 'y', cmp: '>=', target: 't', aggregation: 'end', window: { start_period: 0, periods: 1 } }], limits: [],
      options: [option('keep', []), option('cut', [set('y', 'minus')])], risks: [], withheld: [] };
    expect(simulate(m, { seed: 1, draws: 100 }).paired).toEqual([{ a: 'keep', b: 'cut', joint_within_limits: { kind: 'exact', difference: 1 } }]);
  });
});
