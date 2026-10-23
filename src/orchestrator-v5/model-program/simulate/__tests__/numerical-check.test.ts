/**
 * The numerical check for the natural-unit simulator. Every expected value is worked out BY HAND in the comment beside it, in
 * closed form, and written as a literal: nothing here calls the code under test to make its own expectation. Probabilities
 * checked by simulation use 20,000 draws and the Wilson interval the result reports (its simulation precision) must contain
 * the hand value.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutableModel, FixedAuthor, Goal, Limit, Option, OptionSet, Quantity, Risk, Withheld } from '../../executable.js';
import { simulate } from '../simulate.js';
import { rangeLaw, type Domain, type RangeDist, type RangeKind } from '../range-law.js';
import { isWithheld, type Chance, type ChanceOrWithheld, type SimResult } from '../result.js';
import { mapLivingModel } from '../../../path-b/living-model/mapper.js';
import { KNOWN_ANSWER } from '../../../path-b/living-model/__tests__/fixtures.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';

type Rec = Record<string, any>;
const N = 20_000;
const SEED = 20261023;
const ONE: Goal['window'] = { start_period: 0, periods: 1 };

// Every quantity reads as a state (a boundary) unless `flow()` marks it as read over intervals (executable.ts r2).
const fixed = (id: string, value: number, unit = '', author: FixedAuthor = 'person'): Quantity =>
  ({ id, label: id, unit, reading: 'state', dist: { kind: 'fixed', value, author } });
const range = (id: string, low: number, high: number, mode?: number, unit = ''): Quantity =>
  ({ id, label: id, unit, reading: 'state', dist: { kind: 'range', low, high, ...(mode !== undefined ? { mode } : {}), basis: 'person_range', range_kind: 'plausible' } });
const def = (id: string, op: 'sum' | 'difference' | 'product' | 'ratio', parts: string[], unit = ''): Quantity =>
  ({ id, label: id, unit, reading: 'state', equation: { form: 'definition', op, parts } });
const effect = (id: string, base: string, terms: { coefficient: string; driver: string }[], unit = ''): Quantity =>
  ({ id, label: id, unit, reading: 'state', equation: { form: 'effect', base, terms } });
const stock = (id: string, start: string, inflows: string[], outflows: string[], unit = ''): Quantity =>
  ({ id, label: id, unit, reading: 'state', stock: { start, inflows, outflows } });
const flow = (x: Quantity): Quantity => ({ ...x, reading: 'flow' });
const aggregated = (g: Goal, aggregation: Goal['aggregation']): Goal => ({ ...g, aggregation });
// Gold-model ruling 2, ahead of S1's executable.ts type: a `from_period` naming a timing quantity.
const timed = (quantity: string, to: string, timing: string): OptionSet => {
  const set: { quantity: string; to: string; from_period: number | string } = { quantity, to, from_period: timing };
  return set as OptionSet;
};
const timedRisk = (r: Risk, timing: string): Risk => {
  const risk: Omit<Risk, 'from_period'> & { from_period: number | string } = { ...r, from_period: timing };
  return risk as Risk;
};
const goal = (id: string, quantity: string, cmp: Goal['cmp'], target: string, aggregation: Goal['aggregation'] = 'end',
  window: Goal['window'] = ONE): Goal => ({ id, label: id, quantity, cmp, target, aggregation, window });
const limit = (id: string, quantity: string, cmp: Limit['cmp'], bound: string, window: Limit['window'] = ONE): Limit =>
  ({ id, label: id, quantity, cmp, bound, aggregation: 'end', window });
const option = (id: string, sets: Option['sets'] = []): Option => ({ id, label: id, sets });
const HOLD = option('hold');
function model(periods: number, quantities: Quantity[], goals: Goal[], options: Option[] = [HOLD],
  more: { limits?: Limit[]; risks?: Risk[]; withheld?: Withheld[] } = {}): ExecutableModel {
  return { periods, period_unit: 'month', quantities, goals, limits: more.limits ?? [], options, risks: more.risks ?? [], withheld: more.withheld ?? [] };
}
const opt = (r: { options: Rec[] }, id: string): Rec => r.options.find((o) => o.option_id === id)!;
const goalOf = (o: Rec, id: string): Rec => o.per_goal.find((g: Rec) => g.goal_id === id)!;
const outcomeOf = (o: Rec, id: string): Rec => o.outcomes.find((g: Rec) => g.goal_id === id)!;
const inside = (x: number, [lo, hi]: [number, number]): boolean => lo <= x && x <= hi;
/** A chance that must have been worked out (a withheld one fails the row here, with its reason). */
const ch = (x: ChanceOrWithheld): Chance => {
  if (isWithheld(x)) throw new Error(`withheld: ${JSON.stringify(x.withheld)}`);
  return x;
};
const first = (r: SimResult): Rec => r.options[0]!;

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
    expect(o.joint).toEqual({ chance: 0, precision_95: [0, 0] });
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
      const g = ch(simulate(model(1, [x, fixed('t', t)], [goal('g', 'x', '>=', 't')]), { seed: SEED, draws: N }).options[0]!.per_goal[0]!);
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
    const law = rangeLaw({ kind: 'range', low: 10, high: 30, mode: 20, basis: 'person_range', range_kind: 'plausible' });
    if (law.kind !== 'normal') throw new Error(`expected a spread, got ${law.kind}`);
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

  it('row 4: accumulation S[k+1] = S[k] + I − c×S[k] is exact to 1e-9 at the boundary after six periods', () => {
    // S_T = S0(1−c)^T + I(1−(1−c)^T)/c, S0 = 1000, c = 0.04, I = 50, T = 6.
    // 0.96^2 = 0.9216, 0.96^3 = 0.884736, 0.96^6 = 0.884736^2 = 0.782757789696.
    // S_6 = 782.757789696 + 1250 × 0.217242210304 = 782.757789696 + 271.55276288 = 1054.310552576.
    // By steps: S1 = 1000 × 0.96 + 50 = 1010; S2 = 1010 × 0.96 + 50 = 1019.6.
    // DL ruling 1: the stock is a state, read at boundaries; `end` over {0, 6} is S[0 + 6] = S_6, on a 6-period model.
    // The outflow is a flow: interval 0 reads c × S[0] = 0.04 × 1000 = 40, the flow that moved the stock.
    const r = simulate(model(6, [fixed('s0', 1000), fixed('c', 0.04), flow(fixed('inflow', 50)), flow(def('out', 'product', ['c', 's'])),
      stock('s', 's0', ['inflow'], ['out']), fixed('t', 1054.31)], [goal('g', 's', '>=', 't', 'end', { start_period: 0, periods: 6 })]),
    { seed: SEED, draws: 10, record: [0] });
    expect(Math.abs(outcomeOf(first(r), 'g').p50 - 1054.310552576)).toBeLessThanOrEqual(1e-9);
    const s = r.recorded![0]!.values.s!;
    expect(s[0]).toBe(1000);
    expect(Math.abs(s[1]! - 1010)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(s[2]! - 1019.6)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(s[6]! - 1054.310552576)).toBeLessThanOrEqual(1e-9);
    expect(r.recorded![0]!.values.out![0]).toBe(40);
    expect(first(r).per_goal[0].chance).toBe(1); // 1054.3106 ≥ 1054.31
  });

  it('row 5: the joint AND is counted on the same draws, never a product of marginals', () => {
    // A ~ range 10..30 mode 20, B ~ range 10..30 (independent streams). P(A ≥ 20) = 0.5; P(B ≥ 25) = 0.19324 (row 2).
    // (a) P(A≥20 ∧ B≥25) ≤ min(0.5, 0.19324) in counts, exactly; and ≈ 0.5 × 0.19324 = 0.09662 for independent inputs
    //     (Wilson half-width at 20k: 1.96 × √(0.09662 × 0.90338 / 20000) = 0.00409).
    // (b) Same quantity: A ≥ 25 implies A ≥ 20, so P(A≥20 ∧ A≥25) = P(A≥25) = 0.19324, NOT 0.5 × 0.19324 = 0.09662.
    const qs = [range('a', 10, 30, 20), range('b', 10, 30), fixed('t20', 20), fixed('t25', 25)];
    const o = first(simulate(model(1, qs, [goal('ga', 'a', '>=', 't20'), goal('gb', 'b', '>=', 't25')]), { seed: SEED, draws: N }));
    expect(o.joint.chance).toBeLessThanOrEqual(Math.min(goalOf(o, 'ga').chance, goalOf(o, 'gb').chance));
    expect(inside(0.09662, o.joint.precision_95)).toBe(true);
    expect(Math.abs(o.joint.chance - 0.09662)).toBeLessThanOrEqual(0.00409);
    const same = first(simulate(model(1, qs, [goal('g20', 'a', '>=', 't20'), goal('g25', 'a', '>=', 't25')]), { seed: SEED, draws: N }));
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
    { limits: [limit('l', 'cost', '<=', 'budget')] });
    const pounds = first(simulate(build(1), { seed: SEED, draws: N }));
    const thousands = first(simulate(build(1000), { seed: SEED, draws: N }));
    expect(pounds.per_goal[0].chance).toBeGreaterThan(0.05);
    expect(pounds.per_goal[0].chance).toBeLessThan(0.95);
    expect(thousands.per_goal).toEqual(pounds.per_goal);
    expect(thousands.joint).toEqual(pounds.joint);
    expect(thousands.within_limits).toEqual(pounds.within_limits);
    expect(thousands.joint_within_limits).toEqual(pounds.joint_within_limits);
    expect(thousands.drivers).toEqual(pounds.drivers);
    expect(thousands.outcomes[0].p50 * 1000).toBeCloseTo(pounds.outcomes[0].p50, 6);
  });

  it('row 7: a risk acts only in the draws where its occurrence fires, from its own period', () => {
    // level = 100 (a flow); risk occurrence 0.5, severity −30 (add) from period 3 of 6. Fired: 100 − 30 = 70 < 90; not fired:
    // 100 ≥ 90. P(goal at interval 5) = 1 − 0.5 = 0.5 (Wilson half-width at 20k: 0.00693). Times 0..2 read 100 in every draw;
    // times 3..6 read 70 exactly where it fired.
    // Occurrence 0 → never fires → exactly 1; occurrence 1 → always fires → exactly 0.
    const build = (p: number, severity: Quantity) => model(6, [flow(fixed('level', 100)), fixed('occ', p), severity, fixed('t', 90)],
      [goal('g', 'level', '>=', 't', 'end', { start_period: 0, periods: 6 })], [HOLD],
      { risks: [{ id: 'loss', occurrence: 'occ', severity: 'sev', effect_on: 'level', mode: 'add', from_period: 3 }] });
    const r = simulate(build(0.5, fixed('sev', -30)), { seed: SEED, draws: N, record: Array.from({ length: 400 }, (_, i) => i) });
    const g = ch(r.options[0]!.per_goal[0]!);
    expect(inside(0.5, g.precision_95)).toBe(true);
    expect(Math.abs(g.chance - 0.5)).toBeLessThanOrEqual(0.00693);
    const fired = r.recorded!.filter((d) => d.risks_fired.loss === true).length;
    expect(fired).toBeGreaterThan(150);
    expect(fired).toBeLessThan(250);
    for (const d of r.recorded!) {
      expect(d.values.level!.slice(0, 3)).toEqual([100, 100, 100]);
      expect(d.values.level!.slice(3)).toEqual(d.risks_fired.loss ? [70, 70, 70, 70] : [100, 100, 100, 100]);
    }
    // An uncertain severity (−40..−20) still never touches a draw where the risk did not fire.
    const u = simulate(build(0.5, range('sev', -40, -20)), { seed: SEED, draws: 2000, record: Array.from({ length: 200 }, (_, i) => i) });
    for (const d of u.recorded!) {
      expect(d.values.level![5]).toBe(d.risks_fired.loss ? 100 + d.values.sev![3]! : 100);
    }
    expect(first(simulate(build(0, fixed('sev', -30)), { seed: SEED, draws: N })).per_goal[0].chance).toBe(1);
    expect(first(simulate(build(1, fixed('sev', -30)), { seed: SEED, draws: N })).per_goal[0].chance).toBe(0);
  });

  it('row 8: window aggregation over months 6–8 (ordinal) matches the hand sum (the PL\'s ruling: a sum takes start-of-interval samples)', () => {
    // subscribers S[k] = 100 + 10k (start 100, inflow 10 per interval); revenue in interval k = price × S[k], price 5.
    // "Months 6–8" is ordinal: {5, 3}, intervals 5, 6, 7 (interval k is month k+1). Revenue is a flow: S = 150, 160, 170;
    // revenue = 750, 800, 850. sum = 2,400; mean = 800; end = 850 (interval 7); every ≥ 750 holds, every ≥ 751 fails.
    // Option 'later' sets price to 6 from period 6: 750 + 6 × 160 + 6 × 170 = 750 + 960 + 1,020 = 2,730; end 1,020.
    // Subscribers are a state. sum: the start-of-interval samples 5, 6, 7 (as for a flow): 150 + 160 + 170 = 480.
    // mean: boundaries 6, 7, 8: (160 + 170 + 180) / 3 = 170; end: S[8] = 180. Horizon 5 + 3 = 8 periods.
    const w = { start_period: 5, periods: 3 };
    const r = simulate(model(8, [fixed('s0', 100), flow(fixed('inflow', 10)), stock('subs', 's0', ['inflow'], []), fixed('price', 5), fixed('price_6', 6),
      flow(def('revenue', 'product', ['price', 'subs'])), fixed('t2400', 2400), fixed('t800', 800), fixed('t850', 850), fixed('t750', 750), fixed('t751', 751),
      fixed('t480', 480), fixed('t170', 170), fixed('t180', 180)],
    [goal('sum', 'revenue', '>=', 't2400', 'sum', w), goal('mean', 'revenue', '>=', 't800', 'mean', w), goal('end', 'revenue', '>=', 't850', 'end', w),
      goal('every750', 'revenue', '>=', 't750', 'every', w), goal('every751', 'revenue', '>=', 't751', 'every', w),
      goal('subs_sum', 'subs', '>=', 't480', 'sum', w), goal('subs_mean', 'subs', '>=', 't170', 'mean', w), goal('subs_end', 'subs', '>=', 't180', 'end', w)],
    [HOLD, option('later', [{ quantity: 'price', to: 'price_6', from_period: 6 }])]), { seed: SEED, draws: 10 });
    const hold = opt(r, 'hold'), later = opt(r, 'later');
    expect(outcomeOf(hold, 'sum').p50).toBe(2400);
    expect(outcomeOf(hold, 'mean').p50).toBe(800);
    expect(outcomeOf(hold, 'end').p50).toBe(850);
    expect(outcomeOf(hold, 'every750').p50).toBe(750);
    expect(['sum', 'mean', 'end', 'every750'].map((id) => goalOf(hold, id).chance)).toEqual([1, 1, 1, 1]);
    expect(goalOf(hold, 'every751').chance).toBe(0);
    expect(outcomeOf(later, 'sum').p50).toBe(2730);
    expect(outcomeOf(later, 'end').p50).toBe(1020);
    expect([outcomeOf(hold, 'subs_sum').p50, outcomeOf(hold, 'subs_mean').p50, outcomeOf(hold, 'subs_end').p50]).toEqual([480, 170, 180]);
  });

  it('row 8b: a ratio (per) reads its denominator through the same window selector, with the same aggregation', () => {
    // Revenue (flow) over subscribers (state), both summed over {5, 3}: 2,400 ÷ (150 + 160 + 170) = 2,400 ÷ 480 = 5 exactly.
    // A state denominator read at the boundaries instead (160 + 170 + 180 = 510) would give 4.706 and fail ≥ 5.
    const w = { start_period: 5, periods: 3 };
    const r = simulate(model(8, [fixed('s0', 100), flow(fixed('inflow', 10)), stock('subs', 's0', ['inflow'], []), fixed('price', 5),
      flow(def('revenue', 'product', ['price', 'subs'])), fixed('t5', 5)],
    [{ ...goal('per_sub', 'revenue', '>=', 't5', 'sum', w), per: 'subs' }], [HOLD]), { seed: SEED, draws: 10 });
    expect([outcomeOf(opt(r, 'hold'), 'per_sub').p50, goalOf(opt(r, 'hold'), 'per_sub').chance]).toEqual([5, 1]);
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
      expect(lo!.spend).toEqual([5, 5, 5]);
      expect(hi!.spend).toEqual([9, 9, 9]);
      expect(Math.abs(hi!.c![0]! - lo!.c![0]! - 4)).toBeLessThanOrEqual(1e-12);
    }
    expect(goalOf(opt(r, 'high'), 'gb')).toEqual(goalOf(opt(r, 'low'), 'gb'));
    expect(goalOf(opt(r, 'high'), 'gc').chance).toBeGreaterThan(goalOf(opt(r, 'low'), 'gc').chance);
  });

  it('guards: a same-period cycle throws (a loop through a stock does not: row 4); a most likely value at an end throws', () => {
    expect(() => simulate(model(1, [def('x', 'sum', ['y']), def('y', 'sum', ['x'])], [goal('g', 'x', '>=', 'x')]), { seed: 1 }))
      .toThrow(/cycle not through a stock: x → y → x|cycle not through a stock: y → x → y/);
    // An option's set can close a loop too: p reads p_up, which reads p.
    expect(() => simulate(model(1, [fixed('p', 1), fixed('one', 1), def('p_up', 'sum', ['p', 'one'])], [goal('g', 'p', '>=', 'one')],
      [option('up', [{ quantity: 'p', to: 'p_up', from_period: 0 }])]), { seed: 1 })).toThrow(/cycle not through a stock/);
    expect(() => simulate(model(1, [range('x', 10, 30, 30), fixed('t', 0)], [goal('g', 'x', '>=', 't')]), { seed: 1 })).toThrow(/strictly inside/);
  });

  it('row 2b: the PL\u2019s range law: a person\u2019s bounds condition the spread; other ranges only a domain; no point fallback', () => {
    // The law is rangeSpread's Normal (centre = most likely value, else the middle; sd = (high − low)/√12), conditioned:
    //  (a) Capacity 80 + 1 × X against a target of 110, X the person's range 10 to 30 around 20 (sd 5.7735).
    //      As 'bounds', X < 30 in every draw, so capacity < 110: the chance is exactly 0 (no draw meets it).
    //      As 'plausible' (unbounded): P(X ≥ 30) = 1 − Φ(10/5.7735) = 1 − Φ(1.7321) = 1 − 0.95837 = 0.04163
    //      (table Φ(1.73) = 0.95818, Φ(1.74) = 0.95907, interpolated); Wilson half-width at 20k: 0.00277.
    //  (b) "Between 10 and 30" as 'bounds': 0 of 20,000 draws outside [10, 30], and none sits on an end (no clamping).
    //  (c) Olumi's one-signed coefficient, −2.2 to −1.4 around −1.8 (sd 0.8/√12 = 0.23094), stays UNBOUNDED even if marked
    //      'bounds' (only a person's bounds bound): P(outside) = 2 × (1 − Φ(0.4/0.23094)) = 2 × 0.04163 = 0.08326 (Wilson
    //      half-width at 20k: 0.00383). With a stated sign restriction (≤ 0) it is conditioned on (−∞, 0]: no draw above 0,
    //      and P(> 0) = 1 − Φ(7.79) ≈ 3e-15, so the share outside the range is the same 0.08326.
    //  (d) Hard-bound control, the conditioned moments: [10, 30] around 20: α = −1.7321, β = 1.7321; φ(1.7321) =
    //      0.39894 × e^−1.5 = 0.089016; Z = 2 × 0.95837 − 1 = 0.91674; mean 20 (symmetric); variance factor
    //      1 − 2 × 1.7321 × 0.089016 / 0.91674 = 0.66363 → sd = 5.7735 × 0.81464 = 4.7033.
    //      [10, 30] around 12: α = −0.34641, β = 3.1177; Φ(α) = 1 − Φ(0.3464) = 1 − 0.63548 = 0.36452, Φ(β) = 0.99909,
    //      Z = 0.63457; φ(α) = 0.39894 × e^−0.06 = 0.37571, φ(β) = 0.39894 × e^−4.86 = 0.003091;
    //      mean = 12 + 5.7735 × (0.37571 − 0.003091) / 0.63457 = 15.390;
    //      variance factor 1 + (−0.34641 × 0.37571 − 3.1177 × 0.003091) / 0.63457 − 0.58720² = 0.43491 → sd = 3.8075.
    //  (e) Domain control: Olumi's 0 to 8 (no most likely value; centre 4, sd 2.3094) for a count (≥ 0): α = −1.7321,
    //      Z = 0.95837, mean = 4 + 2.3094 × 0.089016 / 0.95837 = 4.2145, variance factor 1 − 1.7321 × 0.089016 / 0.95837
    //      − (0.089016 / 0.95837)² = 0.83049 → sd = 2.1046; no draw below 0 (unbounded, about 4% are).
    //      A risk's occurrence 0 to 0.2 is a chance, conditioned on [0, 1]: mean 0.1 + 0.057735 × 0.092883 = 0.10536,
    //      sd 0.057735 × 0.91131 = 0.052615; P(≤ 0) = 0 exactly and P(≥ 0) = 1 exactly.
    //  (f) Degenerate control, low = high = 20: not uncertain, exactly 20: P(X ≥ 20) = 1 and P(X > 20) = 0, exact.
    const kinded = (q: Quantity, range_kind: RangeKind, domain?: Domain): Quantity => {
      const dist: RangeDist = { ...(q.dist as RangeDist), range_kind, ...(domain !== undefined ? { domain } : {}) };
      return { ...q, dist };
    };
    const capacity = (each: Quantity) => model(1, [fixed('today', 80), each, fixed('count', 1),
      effect('capacity', 'today', [{ coefficient: 'each', driver: 'count' }]), fixed('t110', 110)], [goal('g', 'capacity', '>=', 't110')]);
    expect(first(simulate(capacity(kinded(range('each', 10, 30, 20), 'bounds')), { seed: SEED, draws: N })).per_goal[0].chance).toBe(0);
    const plausible = ch(first(simulate(capacity(kinded(range('each', 10, 30, 20), 'plausible')), { seed: SEED, draws: N })).per_goal[0]);
    expect(inside(0.04163, plausible.precision_95)).toBe(true);
    expect(Math.abs(plausible.chance - 0.04163)).toBeLessThanOrEqual(0.00277);

    const all = Array.from({ length: N }, (_, i) => i);
    const drawsOf = (x: Quantity): number[] => simulate(model(1, [x, fixed('t', 0)], [goal('g', x.id, '>=', 't')]), { seed: SEED, draws: N, record: all })
      .recorded!.map((d) => d.values[x.id]![0]!);
    const between = drawsOf(kinded(range('x', 10, 30, 20), 'bounds'));
    expect(between.filter((v) => v < 10 || v > 30)).toEqual([]);
    expect(between.filter((v) => v === 10 || v === 30)).toEqual([]);

    const olumi = (d?: Domain): Quantity => kinded({ id: 'k', label: 'k', unit: '', reading: 'state', dist: { kind: 'range', low: -2.2, high: -1.4, mode: -1.8, basis: 'olumi_estimate', range_kind: 'plausible' } }, 'bounds', d);
    for (const k of [drawsOf(olumi()), drawsOf(olumi({ max: 0 }))]) {
      const outside = k.filter((v) => v < -2.2 || v > -1.4).length / N;
      expect(Math.abs(outside - 0.08326)).toBeLessThanOrEqual(0.00383);
    }
    expect(Math.max(...drawsOf(olumi({ max: 0 })))).toBeLessThanOrEqual(0);

    const law = (q: Quantity, opts = {}) => {
      const r = rangeLaw(q.dist as RangeDist, opts);
      if (r.kind !== 'normal') throw new Error('expected a spread');
      return r;
    };
    const sym = law(kinded(range('x', 10, 30, 20), 'bounds')), skew = law(kinded(range('x', 10, 30, 12), 'bounds'));
    expect(sym.mean).toBeCloseTo(20, 9);
    expect(Math.abs(sym.sd_conditioned - 4.7033)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(skew.mean - 15.390)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(skew.sd_conditioned - 3.8075)).toBeLessThanOrEqual(0.005);
    const skewDraws = drawsOf(kinded(range('x', 10, 30, 12), 'bounds'));
    const mean = skewDraws.reduce((a, v) => a + v, 0) / N, sd = Math.sqrt(skewDraws.reduce((a, v) => a + (v - mean) ** 2, 0) / (N - 1));
    expect(Math.abs(mean - skew.mean)).toBeLessThanOrEqual(4 * 3.8075 / Math.sqrt(N));
    expect(Math.abs(sd / skew.sd_conditioned - 1)).toBeLessThanOrEqual(0.02);

    const count = (d?: Domain): Quantity => kinded({ id: 'n', label: 'n', unit: 'people', reading: 'state', dist: { kind: 'range', low: 0, high: 8, basis: 'olumi_estimate', range_kind: 'plausible' } }, 'plausible', d);
    const counted = law(count({ min: 0 }));
    expect(Math.abs(counted.mean - 4.2145)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(counted.sd_conditioned - 2.1046)).toBeLessThanOrEqual(0.001);
    expect(Math.min(...drawsOf(count({ min: 0 })))).toBeGreaterThanOrEqual(0);
    expect(drawsOf(count()).filter((v) => v < 0).length).toBeGreaterThan(0);
    const occ = law(range('occ', 0, 0.2), { domain: { min: 0, max: 1 } });
    expect(Math.abs(occ.mean - 0.10536)).toBeLessThanOrEqual(0.0001);
    expect(Math.abs(occ.sd_conditioned - 0.052615)).toBeLessThanOrEqual(0.0001);
    const c = first(simulate(model(1, [fixed('level', 100), range('occ', 0, 0.2), fixed('sev', -30), fixed('zero', 0)],
      [goal('le0', 'occ', '<=', 'zero'), goal('ge0', 'occ', '>=', 'zero')], [HOLD],
      { risks: [{ id: 'loss', occurrence: 'occ', severity: 'sev', effect_on: 'level', mode: 'add', from_period: 0 }] }), { seed: SEED, draws: N }));
    expect([goalOf(c, 'le0').chance, goalOf(c, 'ge0').chance]).toEqual([0, 1]);

    const flat = first(simulate(model(1, [range('x', 20, 20), fixed('t', 20)], [goal('ge', 'x', '>=', 't'), goal('gt', 'x', '>', 't')]), { seed: SEED, draws: 100 }));
    expect(goalOf(flat, 'ge')).toEqual({ goal_id: 'ge', chance: 1, precision_95: [1, 1] });
    expect(goalOf(flat, 'gt')).toEqual({ goal_id: 'gt', chance: 0, precision_95: [0, 0] });
  });

  it('row 11: max and min over a window: a flow\u2019s highest and lowest interval, a state\u2019s highest and lowest boundary', () => {
    // Row 8's model. Revenue intervals 6, 7, 8: 800, 850, 900 → max 900, min 800; with 'later' (price 6 from period 7):
    // 800, 1,020, 1,080 → max 1,080, min 800. Subscribers' boundaries 7, 8, 9: 170, 180, 190 → max 190, min 170.
    const w = { start_period: 6, periods: 3 };
    const r = simulate(model(9, [fixed('s0', 100), flow(fixed('inflow', 10)), stock('subs', 's0', ['inflow'], []), fixed('price', 5), fixed('price_6', 6),
      flow(def('revenue', 'product', ['price', 'subs'])), fixed('t900', 900), fixed('t170', 170)],
    [aggregated(goal('rmax', 'revenue', '>=', 't900', 'end', w), 'max'), aggregated(goal('rmin', 'revenue', '>=', 't900', 'end', w), 'min'),
      aggregated(goal('smax', 'subs', '>=', 't170', 'end', w), 'max'), aggregated(goal('smin', 'subs', '>=', 't170', 'end', w), 'min')],
    [HOLD, option('later', [{ quantity: 'price', to: 'price_6', from_period: 7 }])]), { seed: SEED, draws: 10 });
    const hold = opt(r, 'hold'), later = opt(r, 'later');
    expect(['rmax', 'rmin', 'smax', 'smin'].map((id) => outcomeOf(hold, id).p50)).toEqual([900, 800, 190, 170]);
    expect(['rmax', 'rmin'].map((id) => outcomeOf(later, id).p50)).toEqual([1080, 800]);
    expect(['rmax', 'rmin', 'smax', 'smin'].map((id) => goalOf(hold, id).chance)).toEqual([1, 0, 1, 1]);
  });

  it('row 12: a timing quantity: sampled once per draw, strict ceil to its period, per option, and for a risk', () => {
    // Sales (a flow) are 10 a month; the option lifts them to 20 from the launch period L. Over months 1–6 (intervals 0..5):
    // total = 10 L + 20 (6 − L) = 120 − 10 L. Goal: total ≥ 90 ⇔ L ≤ 3.
    //  (a) L a figure, 3: total 90, met in every draw → exactly 1, the same as from_period 3 written as a number.
    //  (b) L a range 2 to 6 with no most likely value, conditioned to 0 or more as the compiler gives it (an elapsed time):
    //      centre 4, sd 4/√12 = 1.1547; the period is ceil(L), so met ⇔ L ≤ 3:
    //      P = (Φ(−0.866) − Φ(−3.4641)) / (1 − Φ(−3.4641)) = (0.193238 − 0.000266) / 0.999734 = 0.19302 (Wilson half-width
    //      at 20k: 0.00547).
    //  (c) Each option its own timing: 'early' at 2 → 100 ≥ 90 → 1; 'late' at 5 → 70 → 0.
    //  (d) A risk timed by a quantity of 3 (certain, −5 a month) is the risk timed by the number 3: 10 × 3 + 5 × 3 = 45.
    const sales = (timing: Quantity, options: Option[], risks: Risk[] = []) => model(6, [flow(fixed('sales', 10)), fixed('lifted', 20), timing,
      fixed('early', 2), fixed('late', 5), fixed('t90', 90), fixed('one', 1), fixed('cut', -5)],
    [goal('g', 'sales', '>=', 't90', 'sum', { start_period: 0, periods: 6 })], options, { risks });
    const byNumber = simulate(sales(fixed('launch', 3), [option('launch', [{ quantity: 'sales', to: 'lifted', from_period: 3 }])]), { seed: SEED, draws: 100 });
    const byFigure = simulate(sales(fixed('launch', 3), [option('launch', [timed('sales', 'lifted', 'launch')])]), { seed: SEED, draws: 100 });
    expect(first(byFigure).per_goal).toEqual(first(byNumber).per_goal);
    expect(first(byFigure).per_goal[0]).toEqual({ goal_id: 'g', chance: 1, precision_95: [1, 1] });
    expect(outcomeOf(first(byFigure), 'g').p50).toBe(90);
    const elapsed = { ...range('launch', 2, 6), dist: { ...(range('launch', 2, 6).dist as RangeDist), domain: { min: 0 } } };
    const sampled = ch(first(simulate(sales(elapsed, [option('launch', [timed('sales', 'lifted', 'launch')])]), { seed: SEED, draws: N })).per_goal[0]);
    expect(inside(0.19302, sampled.precision_95)).toBe(true);
    expect(Math.abs(sampled.chance - 0.19302)).toBeLessThanOrEqual(0.00547);
    // Strict ceil (the PL's ruling): a fraction waits for the next period (2.5 → 3: total 90, met); beyond the horizon it
    // never takes effect (6.5: sales stay 10, total 60, missed); a timing below 0 is outside the domain, never clamped to 0.
    const at = (v: number) => first(simulate(sales(fixed('launch', v), [option('launch', [timed('sales', 'lifted', 'launch')])]), { seed: SEED, draws: 10 }));
    expect([outcomeOf(at(2.5), 'g').p50, outcomeOf(at(2), 'g').p50, outcomeOf(at(6.5), 'g').p50]).toEqual([90, 100, 60]);
    expect(at(-0.5).per_goal[0]).toEqual({ goal_id: 'g', withheld: { reason: 'invalid_domain', count: 10, quantities: ['sales'] } });
    const each = simulate(sales(fixed('launch', 3), [option('early', [timed('sales', 'lifted', 'early')]), option('late', [timed('sales', 'lifted', 'late')])]),
      { seed: SEED, draws: 100 });
    expect([goalOf(opt(each, 'early'), 'g').chance, goalOf(opt(each, 'late'), 'g').chance]).toEqual([1, 0]);
    const risk: Risk = { id: 'r', occurrence: 'one', severity: 'cut', effect_on: 'sales', mode: 'add', from_period: 3 };
    const riskByNumber = simulate(sales(fixed('launch', 3), [HOLD], [risk]), { seed: SEED, draws: 100 });
    const riskByFigure = simulate(sales(fixed('launch', 3), [HOLD], [timedRisk(risk, 'launch')]), { seed: SEED, draws: 100 });
    expect(outcomeOf(first(riskByFigure), 'g').p50).toBe(45);
    expect(first(riskByFigure).outcomes).toEqual(first(riskByNumber).outcomes);
  });

  it('row 13: each limit\u2019s own chance and its quantity\u2019s summary (the cost)', () => {
    // cost = specialists × salary. Fixed salary £40,000: limits cost ≤ £50,000 and cost ≤ £30,000.
    //   hold (0): 0 ≤ both → 1, 1; add (1): 40,000 ≤ 50,000 → 1, 40,000 > 30,000 → 0; within_limits add = 0. All exact.
    // Uncertain salary, £30,000 to £50,000 around £40,000 (sd 20,000/√12 = 5,773.5): P(cost ≤ £45,000) for add =
    //   Φ(5,000/5,773.5) = Φ(0.866) = 0.80676 (Wilson half-width at 20k: 0.00547); its median cost is £40,000 (the sample
    //   median's standard error 1.2533 × 5,773.5/√20000 = 51, so within 4 × 51 = 204).
    const build = (salary: Quantity, limits: [string, string][]) => model(1, [fixed('count', 0), fixed('one', 1), salary,
      def('cost', 'product', ['count', 'salary']), fixed('b50', 50000), fixed('b45', 45000), fixed('b30', 30000), fixed('zero', 0)],
    [goal('g', 'count', '>=', 'zero')], [HOLD, option('add', [{ quantity: 'count', to: 'one', from_period: 0 }])],
    { limits: limits.map(([id, bound]) => limit(id, 'cost', '<=', bound)) });
    const r = simulate(build(fixed('salary', 40000), [['l50', 'b50'], ['l30', 'b30']]), { seed: SEED, draws: 100 });
    expect(opt(r, 'hold').per_limit).toEqual([{ limit_id: 'l50', chance: 1, precision_95: [1, 1] }, { limit_id: 'l30', chance: 1, precision_95: [1, 1] }]);
    expect(opt(r, 'add').per_limit).toEqual([{ limit_id: 'l50', chance: 1, precision_95: [1, 1] }, { limit_id: 'l30', chance: 0, precision_95: [0, 0] }]);
    expect(opt(r, 'add').within_limits).toEqual({ chance: 0, precision_95: [0, 0] });
    expect(opt(r, 'add').limit_outcomes[0]).toEqual({ limit_id: 'l50', p10: 40000, p50: 40000, p90: 40000 });
    const u = opt(simulate(build(range('salary', 30000, 50000, 40000), [['l45', 'b45']]), { seed: SEED, draws: N }), 'add');
    expect(inside(0.80676, u.per_limit[0].precision_95)).toBe(true);
    expect(Math.abs(u.per_limit[0].chance - 0.80676)).toBeLessThanOrEqual(0.00547);
    expect(Math.abs(u.limit_outcomes[0].p50 - 40000)).toBeLessThanOrEqual(204);
  });

  it('row 14: a fixed-only option is exact (no Monte Carlo interval); an uncertain one or one with a risk is not', () => {
    // Capacity: today 80 + specialists × X, X ~ 10..30 around 20. 'Keep' sets no specialist: 80 + 0 × X = 80 in every draw,
    // so its chance of ≥ 100 is exactly 0 with precision [0, 0]. 'Add one' rests on X: about 0.5 with a Wilson interval.
    // A risk in play (occurrence 0.0001, −1 case) is never exact, even where no draw happens to fire it.
    const build = (risks: Risk[] = []) => model(1, [fixed('today', 80), range('each', 10, 30, 20), fixed('count', 0), fixed('one', 1),
      effect('capacity', 'today', [{ coefficient: 'each', driver: 'count' }]), fixed('t', 100), fixed('rare', 0.0001), fixed('minus1', -1)],
    [goal('g', 'capacity', '>=', 't')], [option('keep'), option('add', [{ quantity: 'count', to: 'one', from_period: 0 }])], { risks });
    const r = simulate(build(), { seed: SEED, draws: N });
    expect(opt(r, 'keep').per_goal[0]).toEqual({ goal_id: 'g', chance: 0, precision_95: [0, 0] });
    expect(opt(r, 'keep').joint_within_limits).toEqual({ chance: 0, precision_95: [0, 0] });
    const add = opt(r, 'add').per_goal[0];
    expect(add.precision_95[0]).toBeLessThan(add.chance);
    expect(add.precision_95[1]).toBeGreaterThan(add.chance);
    const risky = opt(simulate(build([{ id: 'r', occurrence: 'rare', severity: 'minus1', effect_on: 'capacity', mode: 'add', from_period: 0 }]),
      { seed: SEED, draws: 1000 }), 'keep').per_goal[0];
    expect(risky.chance).toBe(0);
    expect(risky.precision_95[1]).toBeGreaterThan(0);
  });

  it('row 15: drivers exclude option switches, even uncertain ones; an uncertain input stays a driver', () => {
    // c = a + spend; spend has a range (4 to 10 around 7: sd 1.732, |7| ≥ 3.46, so drawn) but options set it: a switch, never
    // an uncertainty to rank. a (10 to 30) is the only driver, for every option.
    const r = simulate(model(2, [range('a', 10, 30), range('spend', 4, 10, 7), fixed('s9', 9), flow(def('c', 'sum', ['a', 'spend'])), fixed('t25', 25)],
      [goal('g', 'c', '>=', 't25', 'end', { start_period: 0, periods: 2 })],
      [HOLD, option('high', [{ quantity: 'spend', to: 's9', from_period: 1 }])]), { seed: SEED, draws: 3000 });
    for (const id of ['hold', 'high']) expect(opt(r, id).drivers.map((x: Rec) => x.quantity)).toEqual(['a']);
  });

  it('row 16: every chance the simulator withheld is listed once (withheld_chances); the compiler\u2019s withheld[] is echoed unchanged', () => {
    // Row 10's ratio: the goal on q, the joint and joint_within_limits are withheld for 'hold'; nothing else is.
    const m = model(1, [fixed('a', 10), flow(fixed('denominator', 10)), fixed('occ', 0.5), fixed('sev', -10), fixed('zero', 0),
      flow(def('q', 'ratio', ['a', 'denominator']))], [goal('gq', 'q', '>=', 'zero'), goal('ga', 'a', '>=', 'zero')], [HOLD],
    { risks: [{ id: 'cut', occurrence: 'occ', severity: 'sev', effect_on: 'denominator', mode: 'add', from_period: 0 }] });
    const r = simulate(m, { seed: SEED, draws: 2000 });
    const count = goalOf(first(r), 'gq').withheld.count;
    expect(r.withheld_chances).toEqual([
      { option_id: 'hold', scope: 'goal', id: 'gq', reason: 'invalid_domain', count, quantities: ['q'] },
      { option_id: 'hold', scope: 'joint', reason: 'invalid_domain', count, quantities: ['q'] },
      { option_id: 'hold', scope: 'joint_within_limits', reason: 'invalid_domain', count, quantities: ['q'] },
    ]);
    expect(r.withheld).toEqual([]);
    const clean = simulate(model(1, [fixed('x', 1)], [goal('g', 'x', '>=', 'x')], [HOLD],
      { withheld: [{ id: 'morale', kind: 'goal', label: 'Keep the team happy', reason: 'It has no measure yet.' }] }), { seed: 1, draws: 10 });
    expect(clean.withheld_chances).toEqual([]);
    expect(clean.withheld).toEqual([{ id: 'morale', kind: 'goal', label: 'Keep the team happy', reason: 'It has no measure yet.' }]);
  });

  it('row 17: a ratio of two window aggregates (per), and a limits-only run', () => {
    // Sign-ups 10 a month and visitors 200 a month (flows). Conversion over the first three months = sum(sign-ups) ÷
    // sum(visitors) = 30 ÷ 600 = 0.05: ≥ 0.05 holds (exactly 1), > 0.05 fails (exactly 0); its outcome is 0.05.
    // With no visitors the ratio has no value: the goal is withheld (invalid_domain, 'visitors', every draw), never failed.
    // Limits only: no goals; the joint is withheld as 'no_goals' and joint_within_limits is within_limits
    // (cost 40 ≤ 50 → exactly 1).
    const w = { start_period: 0, periods: 3 };
    const conv = (visitors: number) => model(3, [flow(fixed('signups', 10)), flow(fixed('visitors', visitors)), fixed('t', 0.05)],
      [{ ...goal('ge', 'signups', '>=', 't', 'sum', w), per: 'visitors' }, { ...goal('gt', 'signups', '>', 't', 'sum', w), per: 'visitors' }]);
    const r = first(simulate(conv(200), { seed: SEED, draws: 50 }));
    expect([goalOf(r, 'ge').chance, goalOf(r, 'gt').chance]).toEqual([1, 0]);
    expect(outcomeOf(r, 'ge').p50).toBeCloseTo(0.05, 12);
    expect(goalOf(first(simulate(conv(0), { seed: SEED, draws: 50 })), 'ge').withheld).toEqual({ reason: 'invalid_domain', count: 50, quantities: ['visitors'] });
    const only = first(simulate(model(1, [fixed('cost', 40), fixed('cap', 50)], [], [HOLD], { limits: [limit('l', 'cost', '<=', 'cap')] }), { seed: SEED, draws: 50 }));
    expect(only.joint).toEqual({ withheld: { reason: 'no_goals', count: 0, quantities: [] } });
    expect(only.within_limits).toEqual({ chance: 1, precision_95: [1, 1] });
    expect(only.joint_within_limits).toEqual(only.within_limits);
  });

  it('row 10: a nonfinite draw is outside the domain: the chance it touches is withheld, typed, with its count — never a failure', () => {
    // (a) A ratio whose denominator can be 0: denominator = 10, and a risk (occurrence 0.5, severity −10, add) makes it 0 in
    //     the draws where it fires (about 0.5 × 20,000 = 10,000; 1.96 × √(20000 × 0.25) = 139). In those draws 10 ÷ 0 is NaN,
    //     so the goal on the ratio is WITHHELD (invalid_domain, its count, quantity 'q'), as is the joint; the other goal
    //     ('a' ≥ 0, 10 ≥ 0) keeps its chance, exactly 1. Occurrence 0: the denominator is never 0, q = 1 ≥ 0 → exactly 1.
    // (b) ±Infinity: 1e200 × 1e200 overflows to Infinity in every draw (50 of 50). A limit on it withholds within_limits and
    //     joint_within_limits; the goal ('a' ≥ 0) and the joint keep their chance, 1. A goal on it is withheld itself.
    const ratio = (p: number) => model(1, [fixed('a', 10), flow(fixed('denominator', 10)), fixed('occ', p), fixed('sev', -10), fixed('zero', 0),
      flow(def('q', 'ratio', ['a', 'denominator']))], [goal('gq', 'q', '>=', 'zero'), goal('ga', 'a', '>=', 'zero')], [HOLD],
    { risks: [{ id: 'cut', occurrence: 'occ', severity: 'sev', effect_on: 'denominator', mode: 'add', from_period: 0 }] });
    const r = first(simulate(ratio(0.5), { seed: SEED, draws: N }));
    const gq = goalOf(r, 'gq');
    expect(gq.chance).toBeUndefined();
    expect(gq.withheld.reason).toBe('invalid_domain');
    expect(gq.withheld.quantities).toEqual(['q']);
    expect(Math.abs(gq.withheld.count - 10000)).toBeLessThanOrEqual(139);
    expect(r.joint.withheld).toEqual(gq.withheld);
    expect(outcomeOf(r, 'gq').withheld).toEqual(gq.withheld);
    expect(outcomeOf(r, 'gq').p50).toBeUndefined();
    expect(goalOf(r, 'ga').chance).toBe(1);
    expect(r.drivers).toEqual([]);
    expect(goalOf(first(simulate(ratio(0), { seed: SEED, draws: N })), 'gq').chance).toBe(1);

    const inf = first(simulate(model(1, [fixed('a', 10), fixed('zero', 0), fixed('e200', 1e200), def('big', 'product', ['e200', 'e200']), fixed('cap', 1)],
      [goal('ga', 'a', '>=', 'zero')], [HOLD], { limits: [limit('l', 'big', '<=', 'cap')] }),
    { seed: 1, draws: 50 }));
    expect(inf.joint).toEqual({ chance: 1, precision_95: [1, 1] });
    expect(inf.within_limits).toEqual({ withheld: { reason: 'invalid_domain', count: 50, quantities: ['big'] } });
    expect(inf.joint_within_limits).toEqual({ withheld: { reason: 'invalid_domain', count: 50, quantities: ['big'] } });
    const g = first(simulate(model(1, [fixed('e200', 1e200), def('big', 'product', ['e200', 'e200']), fixed('zero', 0)],
      [goal('gb', 'big', '>=', 'zero')]), { seed: 1, draws: 50 }));
    expect(g.per_goal[0]).toEqual({ goal_id: 'gb', withheld: { reason: 'invalid_domain', count: 50, quantities: ['big'] } });
  });
});
