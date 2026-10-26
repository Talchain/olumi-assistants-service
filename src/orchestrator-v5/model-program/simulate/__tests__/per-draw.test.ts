/**
 * SC0: per-draw results and the straight-line (degree) check. The per-draw rows are bound by identity to what the simulator
 * already reports (its counts, and `record` for named draws); the degree rows are worked out by hand from the forms, and the
 * last pair binds the check to the engine itself: where it says straight, two runs predict a third draw by draw; where it says
 * not straight, they do not.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, FixedAuthor, Goal, Limit, Option, OptionSet, Quantity, Risk } from '../../executable.js';
import { simulate } from '../simulate.js';
import { straightness } from '../degree.js';
import { isWithheld, type ChanceOrWithheld, type PerDrawOption, type SimResult } from '../result.js';

const N = 4000;
const SEED = 20261026;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };

const fixed = (id: string, value: number, author: FixedAuthor = 'person'): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'fixed', value, author } });
const range = (id: string, low: number, high: number, domain?: { min?: number; max?: number }): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', dist: { kind: 'range', low, high, basis: 'olumi_estimate', range_kind: 'plausible', ...(domain ? { domain } : {}) } });
const def = (id: string, op: 'sum' | 'difference' | 'product' | 'ratio', parts: string[]): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', equation: { form: 'definition', op, parts } });
const effect = (id: string, base: string, terms: [string, string][]): Quantity =>
  ({ id, label: id, unit: '', reading: 'state', equation: { form: 'effect', base, terms: terms.map(([coefficient, driver]) => ({ coefficient, driver })) } });
const flow = (x: Quantity): Quantity => ({ ...x, reading: 'flow' });
const goal = (id: string, quantity: string, cmp: Goal['cmp'], target: string, aggregation: Goal['aggregation'] = 'end', window: Goal['window'] = ONE): Goal =>
  ({ id, label: id, quantity, cmp, target, aggregation, window });
const limit = (id: string, quantity: string, cmp: Limit['cmp'], bound: string): Limit => ({ id, label: id, quantity, cmp, bound, aggregation: 'end', window: ONE });
const option = (id: string, sets: Option['sets'] = []): Option => ({ id, label: id, sets });
const set = (quantity: string, to: string, from_period: number | string = 0): OptionSet => ({ quantity, to, from_period } as OptionSet);
function model(periods: number, quantities: Quantity[], goals: Goal[], options: Option[], more: { limits?: Limit[]; risks?: Risk[] } = {}): ExecutableModel {
  return { periods, period_unit: 'month', quantities, goals, limits: more.limits ?? [], options, risks: more.risks ?? [], withheld: [] };
}
const withFigure = (m: ExecutableModel, id: string, value: number): ExecutableModel =>
  ({ ...m, quantities: m.quantities.map((q) => (q.id === id ? { id: q.id, label: q.label, unit: q.unit, reading: q.reading, dist: { kind: 'fixed', value, author: 'olumi' } } : q)) });
const count = (a: Int8Array, v: number): number => a.reduce((s, x) => s + (x === v ? 1 : 0), 0);
const chanceN = (c: ChanceOrWithheld): number => { if (isWithheld(c)) throw new Error('withheld'); return Math.round(c.chance * N); };
const perOption = (r: SimResult, id: string): PerDrawOption => r.per_draw!.options.find((o) => o.option_id === id)!;
const withoutPerDraw = (r: SimResult): string => { const rest: Partial<SimResult> = { ...r }; delete rest.per_draw; return JSON.stringify(rest); };

/** Capacity: y = 80 + added × each (each 10 to 30, Olumi's), cost = added × 40 within 50, and a breakdown (25%) taking 15 off y. */
const capacity = (): ExecutableModel => model(1, [
  fixed('base', 80), fixed('added', 0, 'structure'), fixed('one', 1, 'structure'), range('each', 10, 30), fixed('target', 100),
  effect('y', 'base', [['each', 'added']]), fixed('per_hire', 40), def('cost', 'product', ['added', 'per_hire']), fixed('budget', 50),
  fixed('breakdown_chance', 0.25), fixed('breakdown_size', -15),
], [goal('g', 'y', '>=', 'target')], [option('hold'), option('add', [set('added', 'one')])],
{ limits: [limit('budget_limit', 'cost', '<=', 'budget')], risks: [{ id: 'breakdown', occurrence: 'breakdown_chance', severity: 'breakdown_size', effect_on: 'y', mode: 'add', from_period: 0 }] });

/** The club (the science page's case): members = 100 + joins − churn × members a month, for 12 months; goal 400 members. */
const club = (): ExecutableModel => model(12, [
  { id: 'members', label: 'members', unit: '', reading: 'state', stock: { start: 'start', inflows: ['joins'], outflows: ['leavers'] } },
  fixed('start', 100), flow(fixed('base_joins', 20)), flow(range('extra', 2, 10, { min: 0 })), fixed('campaign_on', 0, 'structure'), fixed('one', 1, 'structure'),
  flow(effect('joins', 'base_joins', [['extra', 'campaign_on']])), range('churn', 0.02, 0.06, { min: 0, max: 1 }), flow(def('leavers', 'product', ['churn', 'members'])),
  fixed('target', 400),
], [goal('g', 'members', '>=', 'target', 'end', { start_period: 0, periods: 12 })], [option('keep'), option('campaign', [set('campaign_on', 'one')])]);

/** Price × demand: profit = price × (a − price) − 1,500, a 90 to 110 (Olumi's): a hump in price, never a straight line. */
const price = (): ExecutableModel => model(1, [
  fixed('price', 30), range('a', 90, 110), fixed('minus_one', -1, 'structure'), effect('demand', 'a', [['minus_one', 'price']]),
  def('revenue', 'product', ['price', 'demand']), fixed('cost', 1500), def('profit', 'difference', ['revenue', 'cost']), fixed('target', 0),
], [goal('g', 'profit', '>=', 'target')], [option('as_stated')]);

describe('SC0: every draw\'s own results, on the shared draws', () => {
  it('equal the summary they come from, and asking for them changes no result', () => {
    const m = capacity();
    const plain = simulate(m, { seed: SEED, draws: N }), full = simulate(m, { seed: SEED, draws: N, perDraw: true });
    expect(plain.per_draw).toBeUndefined();
    expect(withoutPerDraw(full)).toBe(JSON.stringify(plain));
    for (const o of full.options) {
      const d = perOption(full, o.option_id);
      // Identity with the reported counts: met draws are the chance × N, exactly; nothing is outside the domain here.
      expect(count(d.goals[0]!.met, 1)).toBe(chanceN(o.per_goal[0]!));
      expect(count(d.limits[0]!.met, 1)).toBe(chanceN(o.per_limit[0]!));
      expect(count(d.joint_within_limits, 1)).toBe(chanceN(o.joint_within_limits));
      expect(count(d.joint_within_limits, -1) + count(d.goals[0]!.met, -1)).toBe(0);
      expect([...d.goals[0]!.against].every((t) => t === 100)).toBe(true);
    }
    // 'add' is 80 + each, less 15 where the breakdown fired, and keeps within the limit in every draw (cost 40 ≤ 50).
    const add = perOption(full, 'add');
    expect(count(add.limits[0]!.met, 1)).toBe(N); // 40 ≤ 50 in every draw
    for (let i = 0; i < N; i++) {
      const fired = add.risks[0]!.fired[i]!, each = full.per_draw!.inputs['each']![i]!;
      expect(add.goals[0]!.value[i]).toBeCloseTo(80 + each + (fired === 1 ? -15 : 0), 9);
    }
  });

  it('match `record` draw by draw: the same inputs for every option, the same values and the same risks fired', () => {
    const m = capacity(), at = [0, 7, 1234, N - 1];
    const r = simulate(m, { seed: SEED, draws: N, perDraw: true, record: at });
    for (const rec of r.recorded!) {
      const d = perOption(r, rec.option_id), i = rec.draw;
      expect(d.goals[0]!.value[i]).toBe(rec.values['y']![1]);
      expect(d.limits[0]!.value[i]).toBe(rec.values['cost']![1]);
      expect(r.per_draw!.inputs['each']![i]).toBe(rec.values['each']![0]);
      expect(d.risks[0]!.fired[i]).toBe(rec.risks_fired['breakdown'] === true ? 1 : rec.risks_fired['breakdown'] === false ? 0 : -1);
    }
    expect(Object.keys(r.per_draw!.inputs)).toEqual(['each']); // only ranged inputs are drawn; fixed figures are not
  });

  it('a draw outside the domain is −1 with a NaN value, exactly as many as the simulator withholds', () => {
    // y = 1 − b, never below 0; b is a plausible 0 to 2, so y leaves its floor in about half the draws.
    const m = model(1, [fixed('one_', 1), range('b', 0, 2), { ...def('y', 'difference', ['one_', 'b']), domain: { min: 0 } }, fixed('half', 0.5)],
      [goal('g', 'y', '>=', 'half')], [option('hold')]);
    const r = simulate(m, { seed: SEED, draws: N, perDraw: true });
    const pg = r.options[0]!.per_goal[0]!;
    if (!isWithheld(pg)) throw new Error('expected a withheld chance');
    const d = perOption(r, 'hold').goals[0]!;
    expect(count(d.met, -1)).toBe(pg.withheld.count);
    expect(pg.withheld.count).toBeGreaterThan(N / 4);
    for (let i = 0; i < N; i++) expect(Number.isNaN(d.value[i]!)).toBe(d.met[i] === -1);
  });

  it('a risk whose time lies beyond the horizon is never read (−1); one whose worked-out chance leaves 0 to 1 is −2', () => {
    const m = model(1, [fixed('x', 10), fixed('target', 5), fixed('p', 0.8), fixed('q', 0.5), def('chance', 'sum', ['p', 'q']), fixed('size', -1)],
      [goal('g', 'x', '>=', 'target')], [option('hold')],
      { risks: [{ id: 'late', occurrence: 'p', severity: 'size', effect_on: 'x', mode: 'add', from_period: 5 },
        { id: 'bad', occurrence: 'chance', severity: 'size', effect_on: 'x', mode: 'add', from_period: 0 }] });
    const d = perOption(simulate(m, { seed: SEED, draws: 50, perDraw: true }), 'hold');
    expect([...d.risks[0]!.fired].every((f) => f === -1)).toBe(true);
    expect([...d.risks[1]!.fired].every((f) => f === -2)).toBe(true); // 0.8 + 0.5 = 1.3 is not a chance
  });
});

describe('SC0: is a margin a straight line in one figure? (worked out by hand from the forms)', () => {
  const only = (m: ExecutableModel, x: string, o: string | null) => straightness(m, x, o)[0]!;
  it('the club\'s stock with churn is straight in base joins (degree 1), with and without the campaign', () => {
    expect(only(club(), 'base_joins', 'keep')).toEqual({ kind: 'goal', id: 'g', straight: true, degree: 1 });
    expect(only(club(), 'base_joins', 'campaign')).toEqual({ kind: 'goal', id: 'g', straight: true, degree: 1 });
    // churn × members: churn is multiplied by a stock that moves with churn, so not straight in churn.
    expect(only(club(), 'churn', 'keep').straight).toBe(false);
  });
  it('price × (a − price) is not straight in price; it is straight in a (a enters once, times price, a constant)', () => {
    expect(only(price(), 'price', 'as_stated')).toMatchObject({ straight: false, reason: '‘revenue’ multiplies two quantities that move with ‘price’' });
    expect(only(price(), 'a', 'as_stated')).toEqual({ kind: 'goal', id: 'g', straight: true, degree: 1 });
  });
  it('a divisor, a timing, a highest reading and a risk\'s chance in x are not straight; a figure it never reaches is degree 0', () => {
    const base = (q: Quantity[], g: Goal = goal('g', 'y', '>=', 't'), o: Option[] = [option('hold')], risks: Risk[] = []) =>
      model(3, [fixed('t', 1), fixed('n', 6), fixed('x', 2), fixed('w', 4), ...q], [g], o, { risks });
    expect(only(base([def('y', 'ratio', ['n', 'x'])]), 'x', 'hold').straight).toBe(false);
    expect(only(base([def('y', 'ratio', ['x', 'n'])]), 'x', 'hold')).toMatchObject({ straight: true, degree: 1 });
    expect(only(base([fixed('y', 0), fixed('z', 5)], undefined, [option('later', [set('y', 'z', 'x')])]), 'x', 'later').straight).toBe(false);
    expect(only(base([def('y', 'sum', ['x', 'n'])], goal('g', 'y', '>=', 't', 'max', { start_period: 0, periods: 3 })), 'x', 'hold').straight).toBe(false);
    expect(only(base([def('y', 'sum', ['x', 'n'])], goal('g', 'y', '>=', 't', 'end', { start_period: 0, periods: 3 })), 'x', 'hold')).toMatchObject({ straight: true, degree: 1 });
    expect(only(base([def('y', 'sum', ['w', 'n'])]), 'x', 'hold')).toMatchObject({ straight: true, degree: 0 });
    const risk = (occurrence: string, severity: string, mode: Risk['mode']): Risk => ({ id: 'r', occurrence, severity, effect_on: 'y', mode, from_period: 0 });
    expect(only(base([def('y', 'sum', ['w', 'n'])], undefined, undefined, [risk('x', 'n', 'add')]), 'x', 'hold').straight).toBe(false);
    expect(only(base([fixed('p', 0.3), def('y', 'sum', ['w', 'n'])], undefined, undefined, [risk('p', 'x', 'add')]), 'x', 'hold')).toMatchObject({ straight: true, degree: 1 });
    expect(only(base([fixed('p', 0.3), def('y', 'sum', ['w', 'n'])], undefined, undefined, [risk('p', 'x', 'multiply')]), 'x', 'hold')).toMatchObject({ straight: true, degree: 1 });
    expect(only(base([fixed('p', 0.3), def('y', 'sum', ['x', 'n'])], undefined, undefined, [risk('p', 'x', 'multiply')]), 'x', 'hold').straight).toBe(false);
  });
  it('the margin counts the target: a target that moves with x is degree 1 even where the value does not', () => {
    const m = model(1, [fixed('x', 3), fixed('w', 4), fixed('y', 7), def('t', 'sum', ['x', 'w'])], [goal('g', 'y', '>=', 't')], [option('hold')]);
    expect(only(m, 'x', 'hold')).toEqual({ kind: 'goal', id: 'g', straight: true, degree: 1 });
    // A `per` denominator in x is not straight; in the numerator it is.
    const per = (g: Goal) => model(1, [fixed('x', 3), fixed('w', 4), fixed('t', 1)], [g], [option('hold')]);
    expect(only(per({ ...goal('g', 'w', '>=', 't'), per: 'x' }), 'x', 'hold').straight).toBe(false);
    expect(only(per({ ...goal('g', 'x', '>=', 't'), per: 'w' }), 'x', 'hold')).toMatchObject({ straight: true, degree: 1 });
  });
});

describe('SC0: the check is about the engine (a discriminating pair)', () => {
  /** Largest relative miss when each draw's margin at c is predicted from its margins at a and b on the same draws. */
  const miss = (m: ExecutableModel, x: string, opt: string, [a, b, c]: [number, number, number]): number => {
    const at = (v: number) => perOption(simulate(withFigure(m, x, v), { seed: SEED, draws: N, perDraw: true }), opt).goals[0]!;
    const A = at(a), B = at(b), C = at(c);
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const ma = A.value[i]! - A.against[i]!, mb = B.value[i]! - B.against[i]!, mc = C.value[i]! - C.against[i]!;
      worst = Math.max(worst, Math.abs(ma + ((mb - ma) * (c - a)) / (b - a) - mc) / Math.max(1, Math.abs(mc)));
    }
    return worst;
  };
  it('straight (the club in base joins): two runs predict a third in every draw, to rounding', () => {
    expect(only2(club(), 'base_joins', 'campaign')).toBe(true);
    expect(miss(club(), 'base_joins', 'campaign', [10, 40, 25])).toBeLessThan(1e-9);
  });
  it('not straight (price × demand): the same prediction misses by far', () => {
    expect(only2(price(), 'price', 'as_stated')).toBe(false);
    expect(miss(price(), 'price', 'as_stated', [10, 40, 25])).toBeGreaterThan(1);
  });
  function only2(m: ExecutableModel, x: string, o: string): boolean { return straightness(m, x, o)[0]!.straight; }
});
