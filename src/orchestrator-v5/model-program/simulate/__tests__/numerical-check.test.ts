/**
 * The numerical check for the natural-unit simulator. Every expected value is worked out BY HAND in the comment beside it, in
 * closed form, and written as a literal: nothing here calls the code under test to make its own expectation. Probabilities
 * checked by simulation use 20,000 draws and the Wilson interval the result reports (its simulation precision) must contain
 * the hand value.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, Goal, Limit, Option, Quantity, Risk } from '../../executable.js';
import { simulate } from '../simulate.js';
import { rangeLaw } from '../range-law.js';
import { mapLivingModel } from '../../../path-b/living-model/mapper.js';
import { KNOWN_ANSWER } from '../../../path-b/living-model/__tests__/fixtures.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';

type Rec = Record<string, any>;
const N = 20_000;
const SEED = 20261023;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };

const fixed = (id: string, value: number, unit = ''): Quantity => ({ id, unit, dist: { kind: 'fixed', value } });
const range = (id: string, low: number, high: number, mode?: number, unit = ''): Quantity =>
  ({ id, unit, dist: { kind: 'range', low, high, ...(mode !== undefined ? { mode } : {}), basis: 'person_range' } });
const def = (id: string, op: 'sum' | 'difference' | 'product' | 'ratio', parts: string[], unit = ''): Quantity =>
  ({ id, unit, equation: { form: 'definition', op, parts } });
const effect = (id: string, base: string, terms: { coefficient: string; driver: string }[], unit = ''): Quantity =>
  ({ id, unit, equation: { form: 'effect', base, terms } });
const stock = (id: string, start: string, inflows: string[], outflows: string[], unit = ''): Quantity =>
  ({ id, unit, stock: { start, inflows, outflows } });
const goal = (id: string, quantity: string, cmp: Goal['cmp'], target: string, aggregation: Goal['aggregation'] = 'end',
  window: Goal['window'] = ONE): Goal => ({ id, quantity, cmp, target, aggregation, window });
const option = (id: string, sets: Option['sets'] = []): Option => ({ id, label: id, sets });
const HOLD = option('hold');
function model(periods: number, quantities: Quantity[], goals: Goal[], options: Option[] = [HOLD],
  more: { limits?: Limit[]; risks?: Risk[] } = {}): ExecutableModel {
  return { periods, period_unit: 'month', quantities, goals, limits: more.limits ?? [], options, risks: more.risks ?? [] };
}
const opt = (r: { options: Rec[] }, id: string): Rec => r.options.find((o) => o.option_id === id)!;
const goalOf = (o: Rec, id: string): Rec => o.per_goal.find((g: Rec) => g.goal_id === id)!;
const outcomeOf = (o: Rec, id: string): Rec => o.outcomes.find((g: Rec) => g.goal_id === id)!;
const inside = (x: number, [lo, hi]: [number, number]): boolean => lo <= x && x <= hi;

/** The capacity brief as the core path holds it (mapper-level-range.test.ts): today 80, one specialist adds 20, 10 to 30. */
function capacityLivingModel(): LivingModelT {
  const who = { source: 'user' as const, party: null, quote: 'Our capacity today is 80; one specialist adds 20, between 10 and 30.' };
  const m = structuredClone(KNOWN_ANSWER);
  Object.assign(m.aims[0]!, { text: 'At least 100 cases', quote: 'at least 100 cases; today 80', defined_as: { op: 'sum', of: ['today', 'added'], ...who } });
  Object.assign(m.aims[0]!.target!, { value: 100, current: 80, unit: 'cases', quantity: 'cases' });
  const level = (id: string, value: number, unit: string) => ({ ...m.factors[0]!, id, label: id, value, unit, ...who });
  m.factors = [level('today', 80, 'cases'), level('count', 0, 'specialists'), { ...level('each', 20, 'cases per specialist'), low: 10, high: 30 },
    { ...level('added', 0, 'cases'), defined_as: { op: 'product', of: ['count', 'each'], ...who } }];
  m.options[1]!.settings = [{ ...m.options[1]!.settings[0]!, factor_id: 'count', value: 1, unit: 'specialists' }];
  m.links = [];
  return m;
}

describe('numerical check: natural-unit simulator, hand-calculated rows', () => {
  it('row 1: fixed level, 80 + 1×20 ≥ 100 is exactly 1 and ≥ 101 exactly 0', () => {
    // capacity = 80 + 20 × 1 = 100 exactly. 100 ≥ 100 holds in every draw → 1; 100 ≥ 101 fails in every draw → 0.
    // Fixed inputs only: the chance is reported as is, and its simulation precision is that point.
    const qs = [fixed('today', 80), fixed('each', 20), fixed('count', 1), effect('capacity', 'today', [{ coefficient: 'each', driver: 'count' }]),
      fixed('t100', 100), fixed('t101', 101)];
    const r = simulate(model(1, qs, [goal('g100', 'capacity', '>=', 't100'), goal('g101', 'capacity', '>=', 't101')]), { seed: SEED, draws: N });
    const o = opt(r, 'hold');
    expect(goalOf(o, 'g100')).toEqual({ goal_id: 'g100', chance: 1, precision_95: [1, 1] });
    expect(goalOf(o, 'g101')).toEqual({ goal_id: 'g101', chance: 0, precision_95: [0, 0] });
    expect(outcomeOf(o, 'g100')).toEqual({ goal_id: 'g100', p10: 100, p50: 100, p90: 100 });
    expect(o.joint.chance).toBe(0);
    expect(o.nan_draws).toBe(0);
  });

  it('row 2: a range is drawn with the reused conversion; P(X ≥ t) matches its closed form within the Wilson interval at 20k', () => {
    // The conversion (mapper.ts rangeSpread, :104-110): Normal, centre = most likely value (else the middle), sd = (high − low)/√12.
    // Range 10 to 30: sd = 20/√12 = 5.7735027.
    //  (a) mode 20, P(X ≥ 25): z = 5/5.7735027 = √3/2 = 0.8660254. Table Φ(0.86) = 0.80511, Φ(0.87) = 0.80785, interpolated
    //      Φ(0.8660254) = 0.80511 + 0.60254 × 0.00274 = 0.80676, so P = 0.19324.
    //  (b) no mode: centre = (10 + 30)/2 = 20, the same law, P(X ≥ 25) = 0.19324.
    //  (c) mode 15, P(X ≥ 20): z = 5/5.7735027 = √3/2 again, P = 0.19324.
    //  (d) the capacity brief: 80 + 1 × X ≥ 100 with X mode 20 → P(X ≥ 20) = 0.5 (the served engine witness on #3688: 0.4971).
    // Wilson 95% half-width at 20,000 draws: 1.96 × √(0.19324 × 0.80676 / 20000) = 0.00547; at 0.5: 1.96 × √(0.25/20000) = 0.00693.
    const P = 0.19324;
    const cases: [Quantity, number][] = [[range('x', 10, 30, 20), 25], [range('x', 10, 30), 25], [range('x', 10, 30, 15), 20]];
    for (const [x, t] of cases) {
      const g = simulate(model(1, [x, fixed('t', t)], [goal('g', 'x', '>=', 't')]), { seed: SEED, draws: N }).options[0]!.per_goal[0]!;
      expect(inside(P, g.precision_95)).toBe(true);
      expect(Math.abs(g.chance - P)).toBeLessThanOrEqual(0.00547);
    }
    const cap = simulate(model(1, [fixed('today', 80), range('each', 10, 30, 20), fixed('count', 0), fixed('one', 1),
      effect('capacity', 'today', [{ coefficient: 'each', driver: 'count' }]), fixed('t', 100)], [goal('g', 'capacity', '>=', 't')],
    [HOLD, option('add', [{ quantity: 'count', to: 'one', from_period: 0 }])]), { seed: SEED, draws: N });
    // Hold: 80 + 0 × X = 80 < 100 in every draw → exactly 0, though X is uncertain.
    expect(opt(cap, 'hold').per_goal[0].chance).toBe(0);
    expect(inside(0.5, opt(cap, 'add').per_goal[0].precision_95)).toBe(true);
    expect(Math.abs(opt(cap, 'add').per_goal[0].chance - 0.5)).toBeLessThanOrEqual(0.00693);

    // The law is the producer's, by identity: the core mapper converts the same person's level range 10 to 30 around 20 into
    // observed_state {raw_value 20, std × cap = 20/√12 = 5.773502691896258}; the simulator's draws of that range must have that
    // centre and spread (sample mean within 4 × 5.7735/√20000 = 0.163 of 20; sample sd within 2% of 5.7735).
    const node = (mapLivingModel(capacityLivingModel()).graph.nodes as Rec[]).find((n) => n.id === 'each')!;
    expect(node.observed_state.raw_value).toBe(20);
    expect(node.observed_state.std * node.observed_state.cap).toBeCloseTo(5.773502691896258, 12);
    const law = rangeLaw({ kind: 'range', low: 10, high: 30, mode: 20, basis: 'person_range' });
    expect(law.centre).toBe(node.observed_state.raw_value);
    expect(law.sd).toBeCloseTo(node.observed_state.std * node.observed_state.cap, 12);
    const rec = simulate(model(1, [range('each', 10, 30, 20), fixed('t', 0)], [goal('g', 'each', '>=', 't')]),
      { seed: SEED, draws: N, record: Array.from({ length: N }, (_, i) => i) }).recorded!.map((d) => d.values.each![0]!);
    const mean = rec.reduce((s, v) => s + v, 0) / N;
    const sd = Math.sqrt(rec.reduce((s, v) => s + (v - mean) ** 2, 0) / (N - 1));
    expect(Math.abs(mean - 20)).toBeLessThanOrEqual(0.163);
    expect(Math.abs(sd / 5.773502691896258 - 1)).toBeLessThanOrEqual(0.02);
  });

  it('row 3: product identity MRR = price × customers keeps the interaction a linear model drops', () => {
    // (a) Customers unchanged (−0 per £): 49 × 100 = 4,900; 59 × 100 = 5,900, so the price rise adds exactly +£1,000.
    // (b) Customers fall 1.8 per £1 of price rise: at £59, customers = 100 − 1.8 × 10 = 82, MRR = 59 × 82 = 4,838: −£62.
    //     The linearised change c·Δp + p·Δc = 100 × 10 + 49 × (−18) = +£118 has the WRONG sign. Goal MRR ≥ 4,900:
    //     hold 4,900 ≥ 4,900 → 1; raise 4,838 < 4,900 → 0 (a linear model would say 1).
    const build = (perPound: number) => model(1, [fixed('price', 49), fixed('price_59', 59), fixed('price_ref', 49),
      def('price_change', 'difference', ['price', 'price_ref']), fixed('customers_today', 100), fixed('per_pound', perPound),
      effect('customers', 'customers_today', [{ coefficient: 'per_pound', driver: 'price_change' }]),
      def('mrr', 'product', ['price', 'customers'], '£'), fixed('t4900', 4900)], [goal('g', 'mrr', '>=', 't4900')],
    [HOLD, option('raise', [{ quantity: 'price', to: 'price_59', from_period: 0 }])]);
    const a = simulate(build(0), { seed: SEED, draws: 100 });
    expect(outcomeOf(opt(a, 'hold'), 'g').p50).toBe(4900);
    expect(outcomeOf(opt(a, 'raise'), 'g').p50 - outcomeOf(opt(a, 'hold'), 'g').p50).toBe(1000);
    const b = simulate(build(-1.8), { seed: SEED, draws: 100 });
    expect(outcomeOf(opt(b, 'raise'), 'g').p50).toBeCloseTo(4838, 9);
    expect(outcomeOf(opt(b, 'raise'), 'g').p50 - 4900).toBeLessThan(0);
    expect(goalOf(opt(b, 'hold'), 'g').chance).toBe(1);
    expect(goalOf(opt(b, 'raise'), 'g').chance).toBe(0);
  });

  it('row 4: accumulation S[t+1] = S[t] + I − c×S[t] is exact to 1e-9 at T = 6', () => {
    // S_T = S0(1−c)^T + I(1−(1−c)^T)/c, S0 = 1000, c = 0.04, I = 50, T = 6.
    // 0.96^2 = 0.9216, 0.96^3 = 0.884736, 0.96^6 = 0.884736^2 = 0.782757789696.
    // S_6 = 782.757789696 + 1250 × 0.217242210304 = 782.757789696 + 271.55276288 = 1054.310552576.
    // By steps: S1 = 1000 × 0.96 + 50 = 1010; S2 = 1010 × 0.96 + 50 = 1019.6.
    // Period t reads the level before t's flows, so S_6 is period 6 of a 7-period model.
    const r = simulate(model(7, [fixed('s0', 1000), fixed('c', 0.04), fixed('inflow', 50), def('out', 'product', ['c', 's']),
      stock('s', 's0', ['inflow'], ['out']), fixed('t', 1054.31)], [goal('g', 's', '>=', 't', 'end', { start_period: 6, periods: 1 })]),
    { seed: SEED, draws: 10, record: [0] });
    expect(Math.abs(outcomeOf(r.options[0]!, 'g').p50 - 1054.310552576)).toBeLessThanOrEqual(1e-9);
    const s = r.recorded![0]!.values.s!;
    expect(s[0]).toBe(1000);
    expect(Math.abs(s[1]! - 1010)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(s[2]! - 1019.6)).toBeLessThanOrEqual(1e-9);
    expect(r.options[0]!.per_goal[0]!.chance).toBe(1); // 1054.3106 ≥ 1054.31
  });

  it('row 5: the joint AND is counted on the same draws, never a product of marginals', () => {
    // A ~ range 10..30 mode 20, B ~ range 10..30 (independent streams). P(A ≥ 20) = 0.5; P(B ≥ 25) = 0.19324 (row 2).
    // (a) P(A≥20 ∧ B≥25) ≤ min(0.5, 0.19324) in counts, exactly; and ≈ 0.5 × 0.19324 = 0.09662 for independent inputs
    //     (Wilson half-width at 20k: 1.96 × √(0.09662 × 0.90338 / 20000) = 0.00409).
    // (b) Same quantity: A ≥ 25 implies A ≥ 20, so P(A≥20 ∧ A≥25) = P(A≥25) = 0.19324, NOT 0.5 × 0.19324 = 0.09662.
    const qs = [range('a', 10, 30, 20), range('b', 10, 30), fixed('t20', 20), fixed('t25', 25)];
    const o = simulate(model(1, qs, [goal('ga', 'a', '>=', 't20'), goal('gb', 'b', '>=', 't25')]), { seed: SEED, draws: N }).options[0]!;
    expect(o.joint.chance).toBeLessThanOrEqual(Math.min(goalOf(o, 'ga').chance, goalOf(o, 'gb').chance));
    expect(inside(0.09662, o.joint.precision_95)).toBe(true);
    expect(Math.abs(o.joint.chance - 0.09662)).toBeLessThanOrEqual(0.00409);
    const same = simulate(model(1, qs, [goal('g20', 'a', '>=', 't20'), goal('g25', 'a', '>=', 't25')]), { seed: SEED, draws: N }).options[0]!;
    expect(same.joint.chance).toBe(goalOf(same, 'g25').chance);
    expect(inside(0.19324, same.joint.precision_95)).toBe(true);
    expect(Math.abs(same.joint.chance - 0.09662)).toBeGreaterThan(0.05);
  });

  it('row 6: the same model in £ and in £k gives identical chances for the same seed', () => {
    // Every £ quantity ÷ 1000: price 39..59 mode 49 → 0.039..0.059 mode 0.049; unit cost 10 → 0.01; target 5,000 → 5;
    // budget 1,100 → 1.1. The law is linear in its ends (centre/1000, sd/1000), so every draw scales by 1/1000 and every
    // comparison is the same comparison: chances, joint, limits and drivers identical; outcomes ÷ 1000.
    const build = (k: number) => model(1, [range('price', 39 / k, 59 / k, 49 / k, k === 1 ? '£' : '£k'), range('customers', 80, 120, 100),
      def('mrr', 'product', ['price', 'customers']), fixed('unit_cost', 10 / k), def('cost', 'product', ['customers', 'unit_cost']),
      fixed('target', 5000 / k), fixed('budget', 1100 / k)], [goal('g', 'mrr', '>=', 'target')], [HOLD],
    { limits: [{ id: 'l', quantity: 'cost', cmp: '<=', bound: 'budget', aggregation: 'end', window: ONE }] });
    const pounds = simulate(build(1), { seed: SEED, draws: N }).options[0]!;
    const thousands = simulate(build(1000), { seed: SEED, draws: N }).options[0]!;
    expect(pounds.per_goal[0]!.chance).toBeGreaterThan(0.05);
    expect(pounds.per_goal[0]!.chance).toBeLessThan(0.95);
    expect(thousands.per_goal).toEqual(pounds.per_goal);
    expect(thousands.joint).toEqual(pounds.joint);
    expect(thousands.within_limits).toEqual(pounds.within_limits);
    expect(thousands.joint_within_limits).toEqual(pounds.joint_within_limits);
    expect(thousands.drivers).toEqual(pounds.drivers);
    expect(thousands.outcomes[0]!.p50 * 1000).toBeCloseTo(pounds.outcomes[0]!.p50, 6);
  });

  it('row 7: a risk acts only in the draws where its occurrence fires, from its own period', () => {
    // level = 100; risk occurrence 0.5, severity −30 (add) from period 3 of 6. Fired: 100 − 30 = 70 < 90; not fired: 100 ≥ 90.
    // P(goal, end of window) = 1 − 0.5 = 0.5 (Wilson half-width at 20k: 0.00693). Periods 0..2 read 100 in every draw.
    // Occurrence 0 → never fires → exactly 1; occurrence 1 → always fires → exactly 0.
    const build = (p: number, severity: Quantity) => model(6, [fixed('level', 100), fixed('occ', p), severity, fixed('t', 90)],
      [goal('g', 'level', '>=', 't', 'end', { start_period: 0, periods: 6 })], [HOLD],
      { risks: [{ id: 'loss', occurrence: 'occ', severity: 'sev', effect_on: 'level', mode: 'add', from_period: 3 }] });
    const r = simulate(build(0.5, fixed('sev', -30)), { seed: SEED, draws: N, record: Array.from({ length: 400 }, (_, i) => i) });
    const g = r.options[0]!.per_goal[0]!;
    expect(inside(0.5, g.precision_95)).toBe(true);
    expect(Math.abs(g.chance - 0.5)).toBeLessThanOrEqual(0.00693);
    const fired = r.recorded!.filter((d) => d.risks_fired.loss === true).length;
    expect(fired).toBeGreaterThan(150);
    expect(fired).toBeLessThan(250);
    for (const d of r.recorded!) {
      expect(d.values.level!.slice(0, 3)).toEqual([100, 100, 100]);
      expect(d.values.level!.slice(3)).toEqual(d.risks_fired.loss ? [70, 70, 70] : [100, 100, 100]);
    }
    // An uncertain severity (−40..−20) still never touches a draw where the risk did not fire.
    const u = simulate(build(0.5, range('sev', -40, -20)), { seed: SEED, draws: 2000, record: Array.from({ length: 200 }, (_, i) => i) });
    for (const d of u.recorded!) {
      expect(d.values.level![5]).toBe(d.risks_fired.loss ? 100 + d.values.sev![3]! : 100);
    }
    expect(simulate(build(0, fixed('sev', -30)), { seed: SEED, draws: N }).options[0]!.per_goal[0]!.chance).toBe(1);
    expect(simulate(build(1, fixed('sev', -30)), { seed: SEED, draws: N }).options[0]!.per_goal[0]!.chance).toBe(0);
  });

  it('row 8: window aggregation over periods 6–8 matches the hand sum', () => {
    // subscribers S_t = 100 + 10t (start 100, inflow 10 per period); revenue_t = price × S_t, price 5.
    // Periods 6, 7, 8: S = 160, 170, 180; revenue = 800, 850, 900. sum = 2,550; mean = 850; end = 900; every ≥ 800 holds
    // (worst period 800), every ≥ 801 fails.
    // Option 'later' sets price to 6 from period 7: 800 + 6 × 170 + 6 × 180 = 800 + 1,020 + 1,080 = 2,900; end 1,080.
    const w = { start_period: 6, periods: 3 };
    const r = simulate(model(12, [fixed('s0', 100), fixed('inflow', 10), stock('subs', 's0', ['inflow'], []), fixed('price', 5), fixed('price_6', 6),
      def('revenue', 'product', ['price', 'subs']), fixed('t2550', 2550), fixed('t850', 850), fixed('t900', 900), fixed('t800', 800), fixed('t801', 801)],
    [goal('sum', 'revenue', '>=', 't2550', 'sum', w), goal('mean', 'revenue', '>=', 't850', 'mean', w), goal('end', 'revenue', '>=', 't900', 'end', w),
      goal('every800', 'revenue', '>=', 't800', 'every', w), goal('every801', 'revenue', '>=', 't801', 'every', w)],
    [HOLD, option('later', [{ quantity: 'price', to: 'price_6', from_period: 7 }])]), { seed: SEED, draws: 10 });
    const hold = opt(r, 'hold'), later = opt(r, 'later');
    expect(outcomeOf(hold, 'sum').p50).toBe(2550);
    expect(outcomeOf(hold, 'mean').p50).toBe(850);
    expect(outcomeOf(hold, 'end').p50).toBe(900);
    expect(outcomeOf(hold, 'every800').p50).toBe(800);
    expect(['sum', 'mean', 'end', 'every800'].map((id) => goalOf(hold, id).chance)).toEqual([1, 1, 1, 1]);
    expect(goalOf(hold, 'every801').chance).toBe(0);
    expect(outcomeOf(later, 'sum').p50).toBe(2900);
    expect(outcomeOf(later, 'end').p50).toBe(1080);
  });

  it('row 9: common random numbers: two options that differ in one set share every other draw', () => {
    // a ~ 10..30, b ~ 100..200, c = a + spend. 'low' sets spend to 5, 'high' to 9. In any one draw a and b are the same number
    // under both options, c differs by exactly 9 − 5 = 4, and spend is 5 or 9 in every period (never randomised). The goal
    // on b alone has the identical chance under both options.
    const r = simulate(model(2, [range('a', 10, 30), range('b', 100, 200), fixed('spend', 0), fixed('s5', 5), fixed('s9', 9),
      def('c', 'sum', ['a', 'spend']), fixed('t150', 150), fixed('t25', 25)], [goal('gb', 'b', '>=', 't150'), goal('gc', 'c', '>=', 't25')],
    [option('low', [{ quantity: 'spend', to: 's5', from_period: 0 }]), option('high', [{ quantity: 'spend', to: 's9', from_period: 0 }])]),
    { seed: SEED, draws: N, record: [0, 1, 7, 4999] });
    for (const draw of [0, 1, 7, 4999]) {
      const [lo, hi] = ['low', 'high'].map((id) => r.recorded!.find((d) => d.option_id === id && d.draw === draw)!.values);
      expect(hi!.a).toEqual(lo!.a);
      expect(hi!.b).toEqual(lo!.b);
      expect(lo!.spend).toEqual([5, 5]);
      expect(hi!.spend).toEqual([9, 9]);
      expect(Math.abs(hi!.c![0]! - lo!.c![0]! - 4)).toBeLessThanOrEqual(1e-12);
    }
    expect(goalOf(opt(r, 'high'), 'gb')).toEqual(goalOf(opt(r, 'low'), 'gb'));
    expect(goalOf(opt(r, 'high'), 'gc').chance).toBeGreaterThan(goalOf(opt(r, 'low'), 'gc').chance);
  });

  it('guards: a same-period cycle throws, a loop through a stock does not, a ratio by zero is NaN and counted', () => {
    expect(() => simulate(model(1, [def('x', 'sum', ['y']), def('y', 'sum', ['x'])], [goal('g', 'x', '>=', 'x')]), { seed: 1 }))
      .toThrow(/cycle not through a stock: x → y → x|cycle not through a stock: y → x → y/);
    // An option's set can close a loop too: p reads p_up, which reads p.
    expect(() => simulate(model(1, [fixed('p', 1), fixed('one', 1), def('p_up', 'sum', ['p', 'one'])], [goal('g', 'p', '>=', 'one')],
      [option('up', [{ quantity: 'p', to: 'p_up', from_period: 0 }])]), { seed: 1 })).toThrow(/cycle not through a stock/);
    // Ratio 10 ÷ 0: every draw is NaN, none meets the goal, and all 50 are counted.
    const r = simulate(model(1, [fixed('a', 10), fixed('zero', 0), def('q', 'ratio', ['a', 'zero']), fixed('t', 0)], [goal('g', 'q', '>=', 't')]),
      { seed: 1, draws: 50 });
    expect(r.options[0]!.per_goal[0]!.chance).toBe(0);
    expect(r.options[0]!.nan_draws).toBe(50);
    expect(() => simulate(model(1, [range('x', 10, 30, 30), fixed('t', 0)], [goal('g', 'x', '>=', 't')]), { seed: 1 })).toThrow(/strictly inside/);
  });
});
