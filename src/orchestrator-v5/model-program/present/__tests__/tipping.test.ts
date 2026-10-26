/**
 * tipping.ts rows. Every expected state, interval and count is worked out BY HAND from the model's own figures, never by
 * calling the code under test. Z (and W) are Olumi's range −√3 to √3, so their draws are standard Normals (sd = 2√3/√12 =
 * 1), and "met" is Z at or above a threshold the figure moves: the chance is Φ(−threshold). Each probe reads 4,000 draws,
 * and the search's intervals are exact (Clopper–Pearson), Bonferroni over every interval read: 21 probes × 2 options = 42
 * for the leader, 50% read as 47.4% to 52.6% (k = 2,000), so two chances near 50% are told apart above about 5.1 points;
 * 21 for a level, about 2.4 points from it. Every gap a row calls definite is at least 7 points (6 sd of its draws).
 * Rows marked "Codex r1" are the independent reviewer's own failing inputs (26 Oct), not the author's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutableModel, Goal, Option, Quantity } from '../../executable.js';
import { compile } from '../../compile.js';
import { bakery, BRIEF } from '../../../model-program-turn/__tests__/bakery.fixture.js';
import { clopperPearson, TIPPING_PROBES, tippingPoint, type TippingInput, type TippingResult, type TippingState } from '../tipping.js';

let simulated = 0;
vi.mock('../../simulate/simulate.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../simulate/simulate.js')>();
  return { ...real, simulate: (...args: Parameters<typeof real.simulate>) => { simulated++; return real.simulate(...args); } };
});
beforeEach(() => { simulated = 0; });

type Rec = Record<string, any>;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };
const fixed = (id: string, value: number, author: 'person' | 'structure' = 'person'): Quantity => ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'fixed', value, author } });
const range = (id: string, low: number, high: number): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'range', low, high, basis: 'olumi_estimate', range_kind: 'plausible' } });
const def = (id: string, op: 'difference' | 'product', parts: string[]): Quantity => ({ id, label: id, unit: '', reading: 'state', equation: { form: 'definition', op, parts } });
const effect = (id: string, base: string, terms: { coefficient: string; driver: string }[]): Quantity => ({ id, label: id, unit: '', reading: 'state', equation: { form: 'effect', base, terms } });
const Z = range('z', -Math.sqrt(3), Math.sqrt(3)), W = range('w', -Math.sqrt(3), Math.sqrt(3)), X = range('x', 0, 20);
const model = (quantities: Quantity[], sets: Option['sets']): ExecutableModel => ({
  periods: 1, period_unit: 'month', quantities: [...quantities, fixed('zero', 0)],
  goals: [{ id: 'g', label: 'g', quantity: 'score', cmp: '>=', target: 'zero', aggregation: 'end', window: ONE }],
  limits: [], options: [{ id: 'keep', label: 'Keep', sets: [] }, { id: 'expand', label: 'Expand', sets }], risks: [], withheld: [],
});
/** Keep: Z ≥ 0, 50% whatever the figure. Expand: Z + a·(x − x0) ≥ 0, so Φ(a·(x − x0)). `scale` re-expresses x in another
 * unit (x, x0 and the ends times `scale`, a over it): the same model, so every draw meets or misses exactly as before. */
const linear = (x0: number, a: number, scale = 1): ExecutableModel => model([Z, range('x', 0, 20 * scale), fixed('x0', x0 * scale), def('dx', 'difference', ['x', 'x0']),
  fixed('s', 0, 'structure'), fixed('slope', a / scale), effect('score', 'z', [{ coefficient: 's', driver: 'dx' }])], [{ quantity: 's', to: 'slope', from_period: 0 }]);
/** Both options: score = Z + c + b·x (Codex r1's shape), so the chance is Φ(c + b·x). */
const shifted = (c: number, b: number): ExecutableModel => model([Z, X, fixed('one', 1, 'structure'), fixed('c', c), fixed('b', b),
  effect('score', 'z', [{ coefficient: 'c', driver: 'one' }, { coefficient: 'b', driver: 'x' }])], []);
const search = (m: ExecutableModel, more: Partial<TippingInput> = {}): TippingResult & Rec =>
  tippingPoint({ model: m, seed: 20261026, draws: 4000, quantity: 'x', ends: [0, 20], question: { kind: 'leader' }, maxOperations: 150_000_000, ...more }) as TippingResult & Rec;
const HALF = { kind: 'level', option_id: 'expand', level: 0.5 } as const;

const keep: TippingState = { kind: 'leader', option_id: 'keep' }, expand: TippingState = { kind: 'leader', option_id: 'expand' };
const close: TippingState = { kind: 'too_close' };
/** The state at each probe 0..20, written as runs. */
const runs = (...parts: [TippingState, number][]): TippingState[] => parts.flatMap(([s, n]) => Array.from({ length: n }, () => s));
const chanceOf = (r: Rec, j: number, id: string): number => r.probes[j].chances.find((c: Rec) => c.option_id === id).chance;
const PROBES = Array.from({ length: 21 }, (_, j) => j);

describe('tipping point: a sampled crossing on common draws, stated as an interval with its probes', () => {
  it('a single crossing: Expand overtakes Keep between 9 and 11, too close at 10, where both read the same draws', () => {
    // Expand = Φ(0.25·(x − 10)): at 9 Φ(−0.25) = 40.1% against 50% (a 9.9-point gap), at 11 59.9%; at 10 its threshold is
    // Keep's (Z ≥ 0), so the two counts are equal and cannot be told apart.
    const r = search(linear(10, 0.25));
    expect(TIPPING_PROBES).toBe(21);
    expect(r.probes.map((p: Rec) => p.value)).toEqual(PROBES);
    expect(r.probes.map((p: Rec) => p.state)).toEqual(runs([keep, 10], [close, 1], [expand, 10]));
    expect(r).toMatchObject({ kind: 'crossing', from: keep, to: expand, between: [9, 11], spacing: 1, draws: 4000, confidence: 0.95 });
    // Common draws: Keep does not read x, so its count is the same at every probe; at 10 Expand reads exactly Keep's draws.
    expect(new Set(PROBES.map((j) => chanceOf(r, j, 'keep'))).size).toBe(1);
    expect(chanceOf(r, 10, 'expand')).toBe(chanceOf(r, 10, 'keep'));
    // By hand: Φ(−2.5) = 0.62% at 0 and Φ(2.5) = 99.38% at 20 (±3 sd of 4,000 draws).
    expect(Math.abs(chanceOf(r, 0, 'expand') - 0.0062)).toBeLessThan(0.004);
    expect(Math.abs(chanceOf(r, 20, 'expand') - 0.9938)).toBeLessThan(0.004);
    expect(simulated).toBe(21);
  });

  it('the precision holds for all 42 intervals at once: a 4-point gap one probe alone would call is too close here', () => {
    // Expand = Φ(0.1·(x − 10)): at 9 and 11 a gap of Φ(0.1) − 50% = 3.98 points, above the 3.1 that each probe's own 95%
    // would separate but below the 5.1 of the whole search; at 8 and 12 Φ(0.2) − 50% = 7.93 points, told apart.
    const r = search(linear(10, 0.1));
    expect(r.probes.map((p: Rec) => p.state)).toEqual(runs([keep, 9], [close, 3], [expand, 9]));
    expect(r).toMatchObject({ kind: 'crossing', from: keep, to: expand, between: [8, 12] });
  });

  it('the intervals are exact (Clopper–Pearson): textbook and closed-form values', () => {
    // 5 of 10 at 95%: 0.187086 to 0.812914 (the textbook values); 0 of 10: up to 1 − 0.025^(1/10) = 0.308497;
    // 1 of 4,000 at 0.05/42: from 1 − (1 − 0.05/84)^(1/4000) = 1.4885e-7.
    const [lo, hi] = clopperPearson(5, 10, 0.05);
    expect(lo).toBeCloseTo(0.187086, 6);
    expect(hi).toBeCloseTo(0.812914, 6);
    expect(clopperPearson(0, 10, 0.05)[1]).toBeCloseTo(0.308497, 6);
    expect(clopperPearson(1, 4000, 0.05 / 42)[0] / 1.4885e-7).toBeCloseTo(1, 4);
  });

  it('no crossing: with the change at 40, beyond the range, Keep stays the more likely at every value tried', () => {
    // Expand at its best (x = 20) is Φ(0.25 × −20) = Φ(−5), about 0 in 4,000 draws, against Keep's 50%.
    const r = search(linear(40, 0.25));
    expect(r.probes.map((p: Rec) => p.state)).toEqual(runs([keep, 21]));
    expect(r).toMatchObject({ kind: 'none', state: keep });
    expect(new Set(PROBES.map((j) => chanceOf(r, j, 'keep'))).size).toBe(1);
  });

  it('three crossings are refused as non-monotone, every change listed, though each chance only rises', () => {
    // Keep: Z + 0.2·d ≥ 0; Expand: Z + 0.0125·d³ ≥ 0, d = x − 10. They read the same threshold where 0.2·d = 0.0125·d³:
    // d = −4, 0 and 4 (x = 6, 10, 14). Between them: d = −3 Keep Φ(−0.6) = 27.4%, Expand Φ(−0.3375) = 36.8%;
    // d = −1 42.1% / 49.5%; d = 1 57.9% / 50.5%; d = 3 72.6% / 63.2%; d = 5 84.1% / 94.1%; d = −5 15.9% / 5.9%.
    const m = model([Z, X, fixed('x0', 10), def('dx', 'difference', ['x', 'x0']), def('cube', 'product', ['dx', 'dx', 'dx']),
      fixed('s1', 0.2), fixed('s3', 0, 'structure'), fixed('c3', 0.0125), fixed('nought', 0, 'structure'),
      effect('score', 'z', [{ coefficient: 's1', driver: 'dx' }, { coefficient: 's3', driver: 'cube' }])],
    [{ quantity: 's1', to: 'nought', from_period: 0 }, { quantity: 's3', to: 'c3', from_period: 0 }]);
    const r = search(m);
    expect(r.probes.map((p: Rec) => p.state)).toEqual(runs([keep, 6], [close, 1], [expand, 3], [close, 1], [keep, 3], [close, 1], [expand, 6]));
    expect(r).toMatchObject({ kind: 'non_monotone', changes: [
      { from: keep, to: expand, between: [5, 7] }, { from: expand, to: keep, between: [9, 11] }, { from: keep, to: expand, between: [13, 15] }] });
  });

  it('a chance that turns back leaves it unresolved: one change at the probes, but Expand rises to 14 and falls', () => {
    // Expand: Z ≥ (x − 14)²/64 − 1. At 5 Φ(−0.266) = 39.5% (Keep's 50% leads), at 6 Keep's own threshold, at 7 Φ(0.234) = 59.3%;
    // highest at 14, Φ(1) = 84.1%, down to Φ(0.4375) = 66.9% at 20, still above Keep at every probe.
    const m = model([Z, X, fixed('x0', 14), def('dx', 'difference', ['x', 'x0']), def('dd', 'product', ['dx', 'dx']),
      fixed('one', 1, 'structure'), fixed('k', -1 / 64), effect('w', 'one', [{ coefficient: 'k', driver: 'dd' }]), fixed('s', 0, 'structure'),
      effect('score', 'z', [{ coefficient: 's', driver: 'w' }])], [{ quantity: 's', to: 'one', from_period: 0 }]);
    const r = search(m);
    expect(r.probes.map((p: Rec) => p.state)).toEqual(runs([keep, 6], [close, 1], [expand, 14]));
    expect(r).toMatchObject({ kind: 'unresolved', reason: 'turns_back', options: ['expand'] });
    expect(chanceOf(r, 14, 'expand')).toBeGreaterThan(chanceOf(r, 20, 'expand'));
  });

  it('a level: Expand becomes more likely to meet the goal than to miss it between 9 and 11', () => {
    // Expand = Φ(0.5·(x − 10)): 30.9% at 9, 69.1% at 11; at 10 exactly Z ≥ 0, about 50%, which cannot be told from the level.
    const r = search(linear(10, 0.5), { question: HALF });
    expect(r.probes.map((p: Rec) => p.state)).toEqual(runs([{ kind: 'below' }, 10], [close, 1], [{ kind: 'above' }, 10]));
    expect(r).toMatchObject({ kind: 'crossing', from: { kind: 'below' }, to: { kind: 'above' }, between: [9, 11] });
    expect(r.probes[0].chances.map((c: Rec) => c.option_id)).toEqual(['expand']);
  });

  it('Codex r1: too close is never evidence of a change, nor of none', () => {
    // Φ(0.025 + 0.01·x) is 51.0% at 0 and 58.9% at 20: above 50% throughout, so there is no crossing; near 0 it is within
    // the 2.4 points the search can tell from 50%, so that end is too close, and the result is unresolved, not a crossing.
    const above = search(shifted(0.025, 0.01), { question: HALF });
    expect(above.probes[0].state).toEqual(close);
    expect(above.probes[20].state).toEqual({ kind: 'above' });
    expect(above).toMatchObject({ kind: 'unresolved', reason: 'too_close' });
    expect(above.values[0]).toBe(0);
    // Φ(−0.01 + 0.001·x) is 49.6% to 50.4%, crossing 50% at x = 10: too close at every probe, so unresolved, never "none".
    const level = search(shifted(-0.01, 0.001), { question: HALF });
    expect(level.probes.map((p: Rec) => p.state)).toEqual(runs([close, 21]));
    expect(level).toMatchObject({ kind: 'unresolved', reason: 'too_close', values: PROBES });
  });

  it('Codex r1: exact only when nothing is sampled: one draw of Z is no exact chance', () => {
    // score = Z (x moves nothing), one draw: the simulator calls a single draw constant, but the chance is 50%. With one
    // draw the exact interval runs from 0.05/42 to 1 (met) or from 0 to 1 − 0.05/42 (missed): too close to 50% everywhere.
    const r = search(shifted(0, 0), { question: HALF, draws: 1 });
    expect(r.probes.map((p: Rec) => p.state)).toEqual(runs([close, 21]));
    expect(r).toMatchObject({ kind: 'unresolved', reason: 'too_close' });
  });

  it('Codex r1: a rare chance at its own level is never called above it (exact intervals cover near 0)', () => {
    // score = Z − 4.10748 (Codex r1's figure), so the chance is Φ(−4.10748) = 0.002%, the level itself. On seed 16 one draw in
    // 4,000 meets it; its exact interval starts at 1.5e-7, below the level, so too close, where a Wilson interval said above.
    const r = search(shifted(-4.1074796717863915, 0), { question: { kind: 'level', option_id: 'expand', level: 0.00002 }, seed: 16 });
    expect(chanceOf(r, 0, 'expand')).toBe(1 / 4000);
    expect(r).toMatchObject({ kind: 'unresolved', reason: 'too_close', values: PROBES });
  });

  it('Codex r1: a chance that is 50% at every value (score = W + x·Z) is never called non-monotone', () => {
    // Each draw's outcome moves with x (Z's sign decides which way), but the chance is 50% throughout: unresolved.
    const r = search(model([Z, W, X, effect('score', 'w', [{ coefficient: 'x', driver: 'z' }])], []), { question: HALF });
    expect(r.kind).toBe('unresolved');
  });

  it('the work bound is refused by name before anything is simulated, and admitted at exactly the bound', () => {
    // costOf by hand for the model with x fixed: 2 times, 2 options, 1 goal, 1 ranged input (Z), 1 set, no risks.
    // Reads: z 1, x 1, x0 1, dx 1 + 2, s 1, slope 1, score 1 + (1 + 2 × 1), zero 1 = 13. Windows: 2 × (1 + 1) = 4.
    // Sorts: ⌈log₂ 4001⌉ × (1 + 2 × 1) = 12 × 3 = 36. Per probe: 4,000 × (2 × (2 × 13 + 4) + 1 × 3 + 36) = 396,000; × 21 = 8,316,000.
    const refused = search(linear(10, 0.25), { maxOperations: 8_315_999 });
    expect(refused).toEqual({ kind: 'refused', reason: 'work_bound', operations: 8_316_000, limit: 8_315_999 });
    expect(simulated).toBe(0);
    expect(search(linear(10, 0.25), { maxOperations: 8_316_000 }).kind).toBe('crossing');
    expect(simulated).toBe(21);
  });

  it('units: the same model in thousands gives the same draws met at every probe and the interval in thousands', () => {
    const base = search(linear(10, 0.25));
    const k = search(linear(10, 0.25, 0.001), { ends: [0, 0.02] });
    expect(k.probes.map((p: Rec) => p.state)).toEqual(base.probes.map((p: Rec) => p.state));
    expect(k.probes.map((p: Rec) => p.chances.map((c: Rec) => c.chance))).toEqual(base.probes.map((p: Rec) => p.chances.map((c: Rec) => c.chance)));
    expect(k.kind).toBe('crossing');
    expect(k.between[0]).toBeCloseTo(0.009, 12);
    expect(k.between[1]).toBeCloseTo(0.011, 12);
    PROBES.forEach((j) => expect(k.probes[j].value).toBeCloseTo(j / 1000, 12));
  });

  it('the real path: the compiled bakery, where a second oven meets 380 loaves exactly when sell-through is at least 0.8', () => {
    // 300 + 100 × sell-through ≥ 380 ⇔ sell-through ≥ 0.8; keeping one oven is 300 whatever it is. Probes 0.5, 0.52 … 0.9:
    // 0.78 gives 378 (missed), 0.8 gives 380 (met). With sell-through fixed nothing is sampled: every chance is exactly 0 or 1.
    const x = compile(bakery(), { sourceText: BRIEF }).executable!;
    const ask = (question: TippingInput['question']) => search(x, { quantity: 'sell_through', ends: [0.5, 0.9], question }) as Rec;
    const level = ask({ kind: 'level', option_id: 'second_oven', level: 0.5 });
    expect(level.probes.map((p: Rec) => p.state)).toEqual(runs([{ kind: 'below' }, 15], [{ kind: 'above' }, 6]));
    expect(level).toMatchObject({ kind: 'crossing', from: { kind: 'below' }, to: { kind: 'above' } });
    expect(level.between[0]).toBeCloseTo(0.78, 12);
    expect(level.between[1]).toBeCloseTo(0.8, 12);
    expect(level.probes.map((p: Rec) => p.chances[0].interval)).toEqual(runs([[0, 0] as any, 15], [[1, 1] as any, 6]));
    // The leader: both exactly 0% below 0.8 (a tie, nothing sampled), then the second oven at 100% against 0%.
    const leader = ask({ kind: 'leader' });
    expect(leader.probes.map((p: Rec) => p.state)).toEqual(runs([{ kind: 'tie' }, 15], [{ kind: 'leader', option_id: 'second_oven' }, 6]));
    expect(leader).toMatchObject({ kind: 'crossing', from: { kind: 'tie' }, to: { kind: 'leader', option_id: 'second_oven' } });
    expect(leader.between).toEqual(level.between);
  });

  it('a figure an option sets, or one with no range, is not searched', () => {
    expect(search(linear(10, 0.25), { quantity: 's' })).toEqual({ kind: 'refused', reason: 'not_searchable', why: 'it is not a figure with a range' });
    const set = linear(10, 0.25);
    set.options[0]!.sets = [{ quantity: 'x', to: 'x0', from_period: 0 }];
    expect(search(set)).toEqual({ kind: 'refused', reason: 'not_searchable', why: 'an option sets it' });
    expect(simulated).toBe(0);
  });
});
