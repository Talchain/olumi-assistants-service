/**
 * Spike S1 rows: the canonical model's compiler and display projection. Synthetic situations only (a bakery, a gym):
 * never a test brief's words. Each row binds by identity (ids, codes, exact executable shapes), with a contrast control
 * beside every absence claim.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod-v4';
import { APPROXIMATE_FIGURE, CanonicalModel, type CanonicalModelT, type CanonicalQuantityT, type CanonicalRelationT, type CanonicalGoalT, type CanonicalLimitT } from '../canonical.js';
import { compile, compileJson, normalise } from '../compile.js';
import { project } from '../project.js';
import { probeValue } from './probe.js';
import { parseUnit, sameDims } from '../units.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { simulate } from '../simulate/simulate.js';
import { isWithheld } from '../simulate/result.js';
import { STARTS_AFTER_PERIODS, withDeclaredTiming } from '../canonical.js';
import { CANONICAL_JSON_SCHEMA } from '../../model-program-turn/prompt.js';
import { revisionDigest } from '../../model-program-turn/run-receipt.js';

// ── builders ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = { party: null, approval: 'proposed' as const, author_id: null };
const qty = (id: string, unit: string, f: Partial<CanonicalQuantityT>): CanonicalQuantityT => ({
  id, label: id.replace(/_/g, ' '), unit, kind: 'fact', value: null, low: null, high: null, range_kind: null, status: 'known', question: null, basis: null, direction: null, floor: null, ceiling: null, author: 'person', quote: null, ...base, ...f,
});
const person = (id: string, unit: string, value: number, quote: string) => qty(id, unit, { value, quote });
const structure = (id: string, unit: string, value: number, basis: string) => qty(id, unit, { value, author: 'structure', basis });
const olumi = (id: string, unit: string, low: number, high: number, value: number | null = null) =>
  qty(id, unit, { kind: 'coefficient', value, low, high, range_kind: 'plausible', status: 'estimated', author: 'olumi', basis: 'Typical for a small business of this kind.' });
type SetT = CanonicalModelT['options'][number]['sets'][number];
const set = (quantity: string, to: string | null, quote: string, f: Partial<SetT> = {}): SetT =>
  ({ quantity, to, value: null, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0, author: 'person', quote, ...f });
const option = (id: string, label: string, sets: SetT[], quote: string): CanonicalModelT['options'][number] =>
  ({ id, label, sets, status: 'live', developed_from: null, author: 'person', quote, ...base });
const asked = (id: string, unit: string, question: string) => qty(id, unit, { status: 'asked', question });
const derived = (id: string, unit: string) => qty(id, unit, { status: 'derived', kind: 'derived' });
const who = (quote: string | null) => (quote === null ? { author: 'olumi' as const, quote: null } : { author: 'person' as const, quote });
/** sum / product with signed or powered parts; `difference` and `ratio` are the first part against the rest. */
const def = (id: string, defines: string, op: 'sum' | 'difference' | 'product' | 'ratio', parts: string[], quote: string | null = null): CanonicalRelationT =>
  (op === 'sum' || op === 'difference'
    ? { form: 'definition', id, defines, op: 'sum', parts: parts.map((p, i) => ({ id: p, sign: op === 'difference' && i > 0 ? -1 : 1 })), ...base, ...who(quote) }
    : { form: 'definition', id, defines, op: 'product', parts: parts.map((p, i) => ({ id: p, power: op === 'ratio' && i > 0 ? -1 : 1 })), ...base, ...who(quote) });
const eff = (id: string, defines: string, b: string, terms: [string, string][], quote: string | null = null): CanonicalRelationT =>
  ({ form: 'effect', id, defines, base: b, terms: terms.map(([driver, coefficient]) => ({ driver, coefficient, ...base, ...who(quote) })), ...base, ...who(quote) });
const stock = (id: string, defines: string, start: string, inflows: string[], outflows: string[], quote: string | null = null): CanonicalRelationT =>
  ({ form: 'stock', id, defines, start, inflows, outflows, ...base, ...who(quote) });
type Agg = 'end' | 'sum' | 'mean' | 'every' | 'max' | 'min';
const win = (periods: string, start = 0) => ({ origin_event: null, origin_offset: null, start, periods });
const goal = (id: string, quantity: string, cmp: '>=' | '<=' | '>' | '<', target: string, aggregation: Agg, periods: string, quote: string): CanonicalGoalT => ({
  id, label: id.replace(/_/g, ' '), measure: { quantity, per: null, cmp, target, frame: 'level', reference: null, aggregation, window: win(periods), measure_by: 'person', assumptions: [], exclusions: [] },
  question: null, author: 'person', quote, ...base,
});
const limit = (id: string, label: string, quantity: string, cmp: '>=' | '<=' | '>' | '<', bound: string, aggregation: Agg, periods: string, quote: string): CanonicalLimitT => ({
  id, label, measure: { quantity, per: null, cmp, bound, aggregation, window: win(periods) }, question: null, author: 'person', quote, ...base,
});
const model = (over: Partial<CanonicalModelT>): CanonicalModelT => ({
  version: 'canonical.v1', question: 'Should the bakery buy a second oven?', period: 'week',
  quantities: [], relations: [], goals: [], limits: [], preferences: [], options: [], risks: [],
  claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [], ...over,
});
const codes = (r: ReturnType<typeof compile>) => r.errors.map((e) => e.code);
/** The shared law's reading of an unbounded range: its conditioned moments equal rangeSpread's centre and sd. */
const unbounded = (centre: number, sd: number) => ({ kind: 'normal', centre, sd, lower: -Infinity, upper: Infinity, mean: centre, sd_conditioned: sd });
const xq = (r: ReturnType<typeof compile>) => new Map(r.executable!.quantities.map((q) => [q.id, q]));
/** The range-law disclosure for one quantity (a typed find: a % conversion has no reading). */
const lawIn = (r: ReturnType<typeof compile>, id: string) => {
  const c = r.conversions.find((x) => x.quantity === id && x.kind === 'range_law');
  if (!c || c.kind !== 'range_law') throw new Error(`no range-law disclosure for ${id}`);
  return c;
};

/** The bakery: a definition (profit), an effect (sales from ovens) and a stock (cash), with two goals. */
function bakery(): CanonicalModelT {
  return model({
    quantities: [
      person('price', 'GBP/loaf', 3, 'at £3'),
      person('base_sales', 'loaf/week', 400, 'We sell 400 loaves a week'),
      olumi('extra_per_oven', 'loaf/week/oven', 80, 150, 120),
      person('ovens_added', 'oven', 0, 'keep one oven'),
      person('one_oven', 'oven', 1, 'A second oven'),
      derived('sales', 'loaf/week'),
      derived('takings', 'GBP/week'),
      person('costs', 'GBP/week', 600, 'costs £600 a week'),
      derived('profit', 'GBP/week'),
      person('cash_now', 'GBP', 2000, '£2,000 in the bank'),
      derived('cash', 'GBP'),
      person('profit_target', 'GBP/week', 900, 'over £900'),
      person('cash_target', 'GBP', 10000, 'at least £10,000'),
      person('quarter', 'week', 13, 'within 3 months'),
    ],
    relations: [
      eff('sales_rel', 'sales', 'base_sales', [['ovens_added', 'extra_per_oven']]),
      def('takings_rel', 'takings', 'product', ['price', 'sales']),
      def('profit_rel', 'profit', 'difference', ['takings', 'costs'], 'profit is takings minus costs'),
      stock('cash_rel', 'cash', 'cash_now', ['profit'], []),
    ],
    goals: [
      goal('weekly_profit', 'profit', '>', 'profit_target', 'end', 'quarter', 'weekly profit over £900'),
      goal('cash_buffer', 'cash', '>=', 'cash_target', 'end', 'quarter', 'at least £10,000 in the bank'),
    ],
    options: [option('buy_oven', 'Buy a second oven', [set('ovens_added', 'one_oven', 'A second oven')], 'Buy it'), option('keep_one', 'Keep one oven', [], 'keep one oven')],
  });
}

/** The gym: a members stock whose leavers only the owner knows, and class revenue that is fully stated. */
function gym(): CanonicalModelT {
  return model({
    question: 'Should the gym run a summer promotion?', period: 'month',
    quantities: [
      person('members_now', 'member', 300, '300 members today'),
      person('joins', 'member/month', 25, 'about 25 join each month'),
      person('promo_joins', 'member/month', 40, 'a promotion could bring 40 a month'),
      asked('leavers', 'member/month', 'How many members leave in a typical month?'),
      derived('members', 'member'),
      person('class_price', 'GBP/attendance', 8, '£8 a class'),
      person('attendances', 'attendance/month', 450, '450 class visits a month'),
      derived('class_revenue', 'GBP/month'),
      person('member_target', 'member', 400, 'reach 400 members'),
      person('revenue_floor', 'GBP/month', 3000, 'at least £3,000 a month from classes'),
      person('half_year', 'month', 6, 'within six months'),
    ],
    relations: [stock('members_rel', 'members', 'members_now', ['joins'], ['leavers']), def('revenue_rel', 'class_revenue', 'product', ['class_price', 'attendances'])],
    goals: [
      goal('reach_400', 'members', '>=', 'member_target', 'end', 'half_year', 'reach 400 members'),
      goal('class_income', 'class_revenue', '>=', 'revenue_floor', 'every', 'half_year', 'at least £3,000 a month from classes'),
    ],
    options: [option('promo', 'Run a summer promotion', [set('joins', 'promo_joins', 'a promotion could bring 40 a month')], 'run a summer promotion'), option('carry_on', 'Carry on as now', [], 'carry on as now')],
  });
}
/** An asked figure answered, exactly as an approved update writes it: the person's, in their words. */
const answered = (m: CanonicalModelT, id: string, f: Partial<CanonicalQuantityT>): CanonicalModelT =>
  ({ ...m, quantities: m.quantities.map((q) => (q.id === id ? { ...q, status: 'known' as const, author: 'person' as const, question: null, approval: 'approved' as const, ...f } : q)) });
const gymFilled = () => answered(gym(), 'leavers', { value: 20, quote: 'about 20 leave a month', basis: APPROXIMATE_FIGURE });

describe('spike S1: the canonical model compiles to the executable model', () => {
  it('row 1: a definition, an effect and a stock compile, with exact executable shapes, labels and authors', () => {
    const r = compile(bakery());
    expect(r.errors).toEqual([]);
    const x = r.executable!;
    expect(x.periods).toBe(13);
    expect(x.period_unit).toBe('week');
    const q = xq(r);
    expect(q.get('sales')).toEqual({ id: 'sales', label: 'sales', unit: 'loaf/week', reading: 'state', equation: { form: 'effect', base: 'base_sales', terms: [{ coefficient: 'extra_per_oven', driver: 'ovens_added' }] } });
    expect(q.get('profit')).toEqual({ id: 'profit', label: 'profit', unit: 'GBP/week', reading: 'flow', equation: { form: 'definition', op: 'difference', parts: ['takings', 'costs'] } });
    expect(q.get('cash')).toEqual({ id: 'cash', label: 'cash', unit: 'GBP', reading: 'state', stock: { start: 'cash_now', inflows: ['profit'], outflows: [] } });
    expect(q.get('extra_per_oven')!.dist).toEqual({ kind: 'range', low: 80, high: 150, mode: 120, basis: 'olumi_estimate', range_kind: 'plausible' });
    expect(q.get('price')!.dist).toEqual({ kind: 'fixed', value: 3, author: 'person' });
    expect(r.conversions).toEqual([{ kind: 'range_law', quantity: 'extra_per_oven', low: 80, high: 150, range_kind: 'plausible', domain: null, reading: unbounded(120, 70 / Math.sqrt(12)), author: 'olumi', provisional: true }]);
    expect(q.has('quarter')).toBe(false); // a window's length is consumed into the window
    expect(x.goals).toEqual([
      { id: 'weekly_profit', label: 'weekly profit', quantity: 'profit', cmp: '>', target: 'profit_target', aggregation: 'end', window: { start_period: 0, periods: 13 } },
      { id: 'cash_buffer', label: 'cash buffer', quantity: 'cash', cmp: '>=', target: 'cash_target', aggregation: 'end', window: { start_period: 0, periods: 13 } },
    ]);
    expect(x.options.map((o) => o.id)).toEqual(['buy_oven', 'keep_one']);
    expect(x.options[0].sets).toEqual([{ quantity: 'ovens_added', to: 'one_oven', from_period: 0 }]);
    expect(x.withheld).toEqual([]);
    expect(r.perGoal.map((p) => [p.goal_id, p.status])).toEqual([['weekly_profit', 'calculable'], ['cash_buffer', 'calculable']]);
    expect(r.perGoal[0].olumi_inputs).toEqual(expect.arrayContaining(['extra_per_oven', 'sales_rel', 'sales_rel:ovens_added', 'takings_rel']));
    expect(r.perGoal[0].olumi_inputs).not.toContain('profit_rel');
  });

  it('row 2: a missing person-only figure asks; only the goal it feeds waits, the other still calculates; answering it unlocks it', () => {
    const r = compile(gym());
    expect(r.errors).toEqual([]);
    const g = Object.fromEntries(r.perGoal.map((p) => [p.goal_id, p]));
    expect(g.reach_400).toMatchObject({ status: 'asks', asks: ['leavers'] });
    expect(g.class_income).toMatchObject({ status: 'calculable', asks: [] });
    expect(r.executable!.goals.map((x) => x.id)).toEqual(['class_income']);
    expect(r.executable!.quantities.map((q) => q.id)).not.toContain('leavers');
    expect(r.executable!.quantities.map((q) => q.id)).toContain('class_revenue');
    expect(r.joint).toMatchObject({ status: 'asks', goal_ids: ['reach_400', 'class_income'], asks: ['leavers'] });
    expect(r.blockers).toEqual([{ id: 'leavers', code: 'asked', scope: ['reach_400'] }]);
    // Gold gap 2: what the run leaves out is echoed on the executable model and in coverage.
    expect(r.executable!.withheld).toEqual([expect.objectContaining({ id: 'reach_400', kind: 'goal', label: 'reach 400' })]);
    expect(r.executable!.withheld[0].reason).toContain('needs "leavers".');
    expect(r.executable!.withheld[0].reason).not.toContain('How many members leave'); // the AI's question is the AI's to ask
    expect(r.coverage.covers).toEqual(['class income']);

    const r2 = compile(gymFilled());
    expect(r2.errors).toEqual([]);
    expect(r2.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(r2.executable!.goals.map((x) => x.id)).toEqual(['reach_400', 'class_income']);
    expect(r2.joint.status).toBe('calculable');
    expect(gymFilled().quantities.find((q) => q.id === 'leavers')).toMatchObject({ status: 'known', author: 'person', approval: 'approved', value: 20 });
  });

  it('row 3: a unit mismatch is one plain error naming the items; the executable is withheld', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, unit: 'GBP/month' } : q));
    const r = compile(m);
    expect(r.executable).toBeNull();
    const e = r.errors.find((x) => x.code === 'unit_mismatch')!;
    expect(e.items).toEqual(['profit_rel', 'costs', 'profit']);
    expect(e.message).toBe('The relation "profit_rel" for "profit" (profit) is a sum, but part "costs" (costs) is gbp/month while "profit" (profit) is gbp/week; the parts of a sum share one unit.');
    expect(compile(bakery()).errors).toEqual([]); // contrast
  });

  it('row 4: a cycle not through a stock is an error; the same loop through a stock compiles', () => {
    const loop = model({
      period: 'month',
      quantities: [derived('takings', 'GBP/month'), derived('tips', 'GBP/month'), olumi('tip_rate', '1', 0.05, 0.15, 0.1), person('menu', 'GBP/month', 5000, '£5,000 of food a month'), person('takings_target', 'GBP/month', 6000, 'reach £6,000'), person('months', 'month', 3, 'in three months')],
      relations: [def('takings_rel', 'takings', 'sum', ['menu', 'tips']), def('tips_rel', 'tips', 'product', ['takings', 'tip_rate'])],
      goals: [goal('takings_goal', 'takings', '>=', 'takings_target', 'end', 'months', 'reach £6,000')],
    });
    const r = compile(loop);
    expect(codes(r)).toEqual(['cycle']);
    expect(r.errors[0].items.sort()).toEqual(['takings', 'tips']);
    expect(r.executable).toBeNull();

    const throughStock = model({
      question: 'Will referrals grow the gym?', period: 'month',
      quantities: [person('members_now', 'member', 300, '300 members today'), derived('members', 'member'), derived('referrals', 'member/month'), olumi('referral_rate', '1/month', 0.01, 0.03), person('member_target', 'member', 350, 'reach 350'), person('months', 'month', 6, 'in six months')],
      relations: [stock('members_rel', 'members', 'members_now', ['referrals'], []), def('referrals_rel', 'referrals', 'product', ['members', 'referral_rate'])],
      goals: [goal('grow', 'members', '>=', 'member_target', 'end', 'months', 'reach 350')],
    });
    const s = compile(throughStock);
    expect(s.errors).toEqual([]);
    expect(xq(s).get('members')!.stock).toEqual({ start: 'members_now', inflows: ['referrals'], outflows: [] });
  });

  it('row 5: two goals give a per-goal outcome each and a joint over both; an aim with no measure is left out, said, and coached', () => {
    const r = compile(bakery());
    expect(r.joint).toEqual({ status: 'calculable', goal_ids: ['weekly_profit', 'cash_buffer'], leaves_out: [], asks: [], reasons: [] });
    expect(r.executable!.goals).toHaveLength(2);
    const m = bakery();
    m.goals.push({ id: 'regulars_happy', label: 'Keep the regulars happy', measure: null, question: 'How would you tell the regulars are happy: repeat visits a week?', author: 'person', quote: 'keep the regulars happy', ...base });
    const r2 = compile(m);
    expect(r2.errors).toEqual([]);
    expect(r2.joint).toMatchObject({ status: 'calculable', goal_ids: ['weekly_profit', 'cash_buffer'], leaves_out: ['regulars_happy'] });
    expect(r2.perGoal.find((p) => p.goal_id === 'regulars_happy')).toMatchObject({ status: 'asks', needs_measure: true });
    expect(r2.blockers).toEqual([{ id: 'regulars_happy', code: 'measure', scope: ['regulars_happy'] }]);
    expect(r2.executable!.goals.map((g) => g.id)).toEqual(['weekly_profit', 'cash_buffer']);
    expect(r2.coverage.leaves_out.map((w) => w.id)).toEqual(['regulars_happy']);
  });

  it('row 6: qualitative records are drawn as display-only cards, never in the executable model', () => {
    const m = bakery();
    m.assumptions.push({ id: 'oven_full_speed', text: 'The new oven runs at full capacity from the first week.', applied: true, concerns: ['extra_per_oven'], author: 'olumi', quote: null, ...base });
    m.dissent.push({ id: 'partner_doubts', holder: 'my business partner', position: 'thinks demand will not keep up', concerns: ['sales_rel'], author: 'person', quote: 'my business partner thinks demand will not keep up', ...base });
    const r = compile(m);
    expect(r.errors).toEqual([]);
    const xjson = JSON.stringify(r.executable);
    expect(xjson).not.toContain('oven_full_speed');
    expect(xjson).not.toContain('partner_doubts');
    expect(xjson).toContain('extra_per_oven'); // contrast: what the assumption concerns IS calculated
    expect(r.perGoal[0].rests_on).toEqual(['oven_full_speed']);
    const p = project(m, r);
    const node = (id: string) => p.graph.nodes.find((n) => n.id === id)!;
    expect(node('oven_full_speed')).toMatchObject({ kind: 'action', analysis_participation: 'retained_excluded', provenance: 'ai_inferred' });
    expect(node('partner_doubts')).toMatchObject({ kind: 'action', analysis_participation: 'retained_excluded', provenance: 'from_brief', source_quote: 'my business partner thinks demand will not keep up' });
    expect(node('profit')).toMatchObject({ kind: 'outcome', analysis_participation: 'included' });
    expect(p.items.find((i) => i.record_id === 'partner_doubts')).toMatchObject({ in_calculation: false, concerns: ['sales_rel'], author: 'person' });
    const recordIds = [...m.quantities, ...m.relations, ...m.goals, ...m.options, ...m.assumptions, ...m.dissent].map((x) => x.id);
    for (const id of recordIds) expect(p.items.filter((i) => i.record_id === id)).toHaveLength(1);
    const parsed = GraphV3.safeParse(p.graph);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.nodes.map((n) => n.id)).toEqual(p.graph.nodes.map((n) => n.id));
    expect(p.items.find((i) => i.record_id === 'extra_per_oven')!.shown_as).toEqual({ on_edge: 'ovens_added__sales' });
    expect(p.graph.edges.find((e) => e.id === 'ovens_added__sales')).toMatchObject({ provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 120, amount_unit: 'loaf/week', per_source_change_unit: 'oven' } } });
  });

  it('row 7: an Olumi figure without a range is an error; an exact constant is STRUCTURE, never an Olumi estimate', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, low: null, high: null, range_kind: null } : q));
    const r = compile(m);
    expect(r.executable).toBeNull();
    expect(r.errors.map((e) => [e.code, e.items])).toEqual([['olumi_no_range', ['extra_per_oven']]]);
    const known = bakery();
    known.quantities.push(qty('weeks_per_year', 'week/year', { value: 52, author: 'olumi', status: 'known', basis: 'A year has 52 weeks.' }));
    expect(codes(compile(known))).toEqual(['olumi_no_range']); // phase 0b: no more zero-width Olumi "estimates"
    const ok = bakery();
    ok.quantities.push(structure('weeks_per_year', 'week/year', 52, 'A year has 52 weeks.'));
    expect(compile(ok).errors).toEqual([]);
  });

  it('phase 0b fix 1: no goal (or an aim with no measure) is VALID, never forced; a limits-only run checks the limits', () => {
    const m = bakery();
    m.limits.push(limit('spend_cap', 'Spend no more than £600 a week', 'costs', '<=', 'costs', 'every', 'quarter', 'costs £600 a week'));
    m.goals = [];
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.blockers).toEqual([{ id: '(model)', code: 'no_goal', scope: [] }]);
    expect(r.joint.status).toBe('asks');
    expect(r.executable!.goals).toEqual([]);
    expect(r.executable!.limits.map((l) => l.id)).toEqual(['spend_cap']);
  });

  it('a condition that is both a goal and a limit is an error; a different limit on the same quantity is not', () => {
    const m = bakery();
    m.limits.push(limit('profit_limit', 'Profit over £900', 'profit', '>', 'profit_target', 'every', 'quarter', 'over £900'));
    expect(compile(m).errors.map((e) => [e.code, e.items])).toEqual([['goal_and_limit', ['weekly_profit', 'profit_limit']]]);
    const ok = bakery();
    ok.quantities.push(person('zero_profit', 'GBP/week', 0, 'never make a loss'));
    ok.limits.push(limit('no_loss', 'Never make a loss', 'profit', '>=', 'zero_profit', 'every', 'quarter', 'never make a loss'));
    const r = compile(ok);
    expect(r.errors).toEqual([]);
    expect(r.executable!.limits).toEqual([{ id: 'no_loss', label: 'Never make a loss', quantity: 'profit', cmp: '>=', bound: 'zero_profit', aggregation: 'every', window: { start_period: 0, periods: 13 } }]);
  });

  it('a quote not in the person\'s words is UNVERIFIED (a typed outcome, not an error) and never drawn as theirs', () => {
    const m = bakery();
    const brief = 'We sell 400 loaves a week at £3 and costs £600 a week. A second oven? Buy it or keep one oven. Weekly profit over £900 within 3 months, and at least £10,000 in the bank. We have £2,000 in the bank.';
    m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, quote: 'costs are £650 a week' } : q));
    const r = compile(m, { sourceText: brief });
    expect(r.errors).toEqual([]);
    expect(r.unverified).toContainEqual({ id: 'costs', quote: 'costs are £650 a week' });
    expect(r.unverified.map((u) => u.id)).not.toContain('price');
    expect(r.perGoal[0].unverified_inputs).toContain('costs');
    const p = project(m, r);
    const costs = p.graph.nodes.find((n) => n.id === 'costs')!;
    expect(costs.provenance).toBe('unverified_brief');
    expect(costs).not.toHaveProperty('source_quote');
    expect(p.graph.nodes.find((n) => n.id === 'base_sales')).toMatchObject({ provenance: 'from_brief', source_quote: 'We sell 400 loaves a week' });
  });

  it('% figures become fractions explicitly; a rate per period × a stock is a flow per period (phase 0b fix 5)', () => {
    const m = gym();
    m.quantities = m.quantities.map((q) => (q.id === 'leavers' ? derived('leavers', 'member/month') : q));
    m.quantities.push(person('churn', '% monthly', 5, '5% leave each month'));
    m.relations.push(def('leavers_rel', 'leavers', 'product', ['members', 'churn']));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(xq(r).get('churn')).toEqual({ id: 'churn', label: 'churn', unit: '1/month', reading: 'state', dist: { kind: 'fixed', value: 0.05, author: 'person' } });
    expect(r.conversions).toEqual([{ kind: 'percent', quantity: 'churn', from: '% monthly', to: '1/month', factor: 0.01, author: 'olumi' }]);
    expect(xq(r).get('leavers')!.reading).toBe('flow');
  });

  it('phase 0b fix 4: a signed sum and a product of powers cover difference, ratio and mixed signs in one op', () => {
    const m = bakery();
    m.quantities.push(person('tips', 'GBP/week', 40, '£40 a week in tips'), person('rent', 'GBP/week', 150, '£150 a week rent'), derived('net', 'GBP/week'), derived('cost_per_loaf', 'GBP/loaf'), person('net_target', 'GBP/week', 600, 'at least £600 a week'));
    m.relations.push(
      { form: 'definition', id: 'net_rel', defines: 'net', op: 'sum', parts: [{ id: 'takings', sign: 1 }, { id: 'tips', sign: 1 }, { id: 'costs', sign: -1 }, { id: 'rent', sign: -1 }], author: 'person', quote: 'takings and tips, less costs and rent', ...base },
      { form: 'definition', id: 'cpl_rel', defines: 'cost_per_loaf', op: 'product', parts: [{ id: 'costs', power: 1 }, { id: 'sales', power: -1 }], author: 'olumi', quote: null, ...base },
    );
    m.goals.push(goal('net_goal', 'net', '>=', 'net_target', 'end', 'quarter', 'at least £600 a week'));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    const q = xq(r);
    expect(q.get('net__plus')!.equation).toEqual({ form: 'definition', op: 'sum', parts: ['takings', 'tips'] });
    expect(q.get('net')!.equation).toEqual({ form: 'definition', op: 'difference', parts: ['net__plus', 'costs', 'rent'] });
    // An exact identity is a definition, never an effect: a person's exact figure as a link size is refused.
    const bad = bakery();
    bad.quantities = bad.quantities.map((q2) => (q2.id === 'extra_per_oven' ? person('extra_per_oven', 'loaf/week/oven', 150, 'each oven adds exactly 150') : q2));
    expect(codes(compile(bad))).toEqual(['coefficient_kind']);
  });

  it('phase 0b fix 3: a structural constant is exact, authored structure, never drawn as Olumi\'s; a non-structural figure cannot hide there', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'ovens_added' ? structure('ovens_added', 'oven', 0, 'No extra oven: as now.') : q));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(xq(r).get('ovens_added')!.dist).toEqual({ kind: 'fixed', value: 0, author: 'structure' });
    const node = project(m, r).graph.nodes.find((n) => n.id === 'ovens_added')!;
    expect(node).not.toHaveProperty('provenance');
    expect(String(node.display_value)).not.toContain('Olumi');
    const hiding = bakery();
    hiding.quantities = hiding.quantities.map((q) => (q.id === 'costs' ? structure('costs', 'GBP/week', 612.5, 'Costs.') : q));
    // Codex r4/r5 #3709: it cannot hide there — it is the person's to give (never Olumi's fixed figure), and what rests on it
    // waits for them. S1 A4: an asked figure, with no question of the code's ("What is …?" is gone).
    const hid = compile(hiding);
    expect(hid.errors).toEqual([]);
    expect(normalise(hiding).quantities.find((q) => q.id === 'costs')).toMatchObject({ author: 'person', status: 'asked', value: null, question: null, basis: null });
    expect(hid.blockers).toEqual([{ id: 'costs', code: 'asked', scope: ['weekly_profit', 'cash_buffer'] }]);
  });

  it('finite numerical agreement cannot suppress an asked fact or invent its value', () => {
    const team = (goals: CanonicalGoalT[]) => model({
      question: 'Should the bakery hire a second baker?', period: 'month',
      quantities: [
        asked('loaves_per_baker', 'loaf/month/baker', 'How many loaves does one baker make in a month?'),
        person('bakers_now', 'baker', 2, 'two bakers'),
        person('bakers_added', 'baker', 0, 'as now'),
        person('one_more', 'baker', 1, 'hire one more'),
        derived('bakers', 'baker'),
        derived('output', 'loaf/month'),
        person('growth_target', '%', 30, 'at least 30% more loaves'),
        person('level_target', 'loaf/month', 5000, '5,000 loaves a month'),
        person('three_months', 'month', 3, 'within three months'),
      ],
      relations: [def('bakers_rel', 'bakers', 'sum', ['bakers_now', 'bakers_added']), def('output_rel', 'output', 'product', ['loaves_per_baker', 'bakers'])],
      goals,
      options: [option('hire', 'Hire a second baker', [set('bakers_added', 'one_more', 'hire one more')], 'hire a second baker'), option('as_now', 'Carry on as now', [], 'carry on')],
    });
    const growth: CanonicalGoalT = { ...goal('more_loaves', 'output', '>=', 'growth_target', 'end', 'three_months', 'at least 30% more loaves'), measure: { ...goal('x', 'output', '>=', 'growth_target', 'end', 'three_months', 'q').measure!, frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } };
    const level = goal('five_thousand', 'output', '>=', 'level_target', 'end', 'three_months', '5,000 loaves a month');
    const r = compile(team([growth, level]));
    expect(r.errors).toEqual([]);
    const g = Object.fromEntries(r.perGoal.map((p) => [p.goal_id, p]));
    expect(g.more_loaves).toMatchObject({ status: 'asks', asks: ['loaves_per_baker'], cancelled: [] });
    expect(g.five_thousand).toMatchObject({ status: 'asks', asks: ['loaves_per_baker'], cancelled: [] }); // contrast: a level needs it
    expect(r.blockers).toEqual([{ id: 'loaves_per_baker', code: 'asked', scope: ['more_loaves', 'five_thousand'] }]);
    expect(r.executable).toBeNull();
    expect(compile(team([growth])).blockers).toEqual([{ id: 'loaves_per_baker', code: 'asked', scope: ['more_loaves'] }]);
  });

  it('a nonlinear expression equal at both old probe points still depends on the missing fact', () => {
    // These are the old probe points for the first ask. Equality at those two roots is not cancellation.
    const a = 1 + 0.173, b = a * 2.3;
    const m = model({ quantities: [asked('q', '1', 'What is q?'), person('a', '1', a, 'a is 1.173'),
      person('b', '1', b, 'b is 2.6979'), derived('qa', '1'), derived('qb', '1'), derived('curve', '1'),
      person('threshold', '1', 1, 'at least one'), person('one_period', 'week', 1, 'within one week')],
      relations: [def('qa_rel', 'qa', 'difference', ['q', 'a']), def('qb_rel', 'qb', 'difference', ['q', 'b']),
        def('curve_rel', 'curve', 'product', ['qa', 'qb'])],
      goals: [goal('g', 'curve', '>=', 'threshold', 'end', 'one_period', 'at least one')] });
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.perGoal[0]).toMatchObject({ status: 'asks', asks: ['q'], cancelled: [] });
    expect(r.executable).toBeNull();
  });

  it('an unknown denominator cannot acquire a nonzero domain from sampled agreement', () => {
    const m = model({ quantities: [asked('q', '1', 'What is q?'), derived('ratio', '1'),
      person('threshold', '1', 1, 'at least one'), person('one_period', 'week', 1, 'within one week')],
      relations: [def('ratio_rel', 'ratio', 'ratio', ['q', 'q'])],
      goals: [goal('g', 'ratio', '>=', 'threshold', 'end', 'one_period', 'at least one')] });
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.perGoal[0]).toMatchObject({ status: 'asks', asks: ['q'], cancelled: [] });
    expect(r.executable).toBeNull();
  });

  it('DL (1): a derived quantity is derived, not a fact; a link\'s size stays a coefficient even when it is derived', () => {
    // The size of the oven link is worked out from two coefficients: kind coefficient, status derived.
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...derived('extra_per_oven', 'loaf/week/oven'), kind: 'coefficient' as const } : q));
    m.quantities.push(olumi('capacity_per_oven', 'loaf/week/oven', 120, 200, 160), olumi('sell_through', '1', 0.5, 0.9, 0.7));
    m.relations.push(def('extra_rel', 'extra_per_oven', 'product', ['capacity_per_oven', 'sell_through']));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(xq(r).get('extra_per_oven')!.equation).toEqual({ form: 'definition', op: 'product', parts: ['capacity_per_oven', 'sell_through'] });
    // A derived quantity marked fact, and kind derived on a figure, are both refused: schema and compiler say the same.
    const asFact = bakery();
    asFact.quantities = asFact.quantities.map((q) => (q.id === 'profit' ? { ...q, kind: 'fact' as const } : q));
    expect(compile(asFact).errors.map((e) => [e.code, e.items])).toEqual([['figure_status', ['profit']]]);
    const figure = bakery();
    figure.quantities = figure.quantities.map((q) => (q.id === 'costs' ? { ...q, kind: 'derived' as const } : q));
    expect(compile(figure).errors.map((e) => [e.code, e.items])).toEqual([['figure_status', ['costs']]]);
    const schemaText = JSON.stringify(z.toJSONSchema(CanonicalModel));
    expect(schemaText).not.toContain('A derived or structural quantity is a fact');
    expect(schemaText).toContain('a link\'s size stays a coefficient even when it is worked out by a relation'); // contrast: the new rule is said
  });

  it('phase 0b fix 6: a preference is shown and reported, never a goal or a limit', () => {
    const m = bakery();
    m.preferences.push({ id: 'spend_less', quantity: 'costs', direction: 'lower', author: 'person', quote: "we'd like to spend less", ...base });
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.preferences).toEqual([{ id: 'spend_less', quantity: 'costs', direction: 'lower', label: 'costs' }]);
    expect(r.executable!.goals.map((g) => g.id)).toEqual(['weekly_profit', 'cash_buffer']);
    expect(JSON.stringify(r.executable)).not.toContain('spend_less');
    expect(project(m, r).graph.nodes.find((n) => n.id === 'spend_less')).toMatchObject({ kind: 'action', label: 'Preference: lower costs', analysis_participation: 'retained_excluded' });
  });

  it('asking for the result itself (an asked goal quantity) is an error; asking for a target is not', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'profit_target' ? asked('profit_target', 'GBP/week', 'What weekly profit would count as success?') : q));
    expect(compile(m).errors).toEqual([]);
    const bad = bakery();
    bad.quantities.push(asked('launch_success', '1', 'Was the launch a success?'), person('one', '1', 1, 'a success'));
    bad.goals.push(goal('success', 'launch_success', '>=', 'one', 'end', 'quarter', 'a successful launch'));
    expect(codes(compile(bad))).toEqual(['asks_for_result']);
  });

  it('gold gaps 3-6: a guardrail with no measure is a typed withheld entry; max and a rate over the window compile; timing may name a quantity', () => {
    const m = gymFilled();
    m.limits.push({ id: 'friendly', label: 'Keep the gym friendly', measure: null, question: 'How would you tell the gym stays friendly?', author: 'person', quote: 'keep the gym friendly', ...base });
    m.quantities.push(person('visitors', 'visitor/month', 500, '500 visitors a month'), person('conversion_target', 'member/visitor', 0.04, 'at least 4% of visitors join'), person('opening_month', 'month', 2, 'the new studio opens in two months'));
    m.goals = m.goals.map((g) => (g.id === 'reach_400' ? { ...g, measure: { ...g.measure!, aggregation: 'max' as const } } : g));
    m.goals.push({ ...goal('conversion', 'joins', '>=', 'conversion_target', 'sum', 'half_year', 'at least 4% of visitors join'), measure: { ...goal('x', 'joins', '>=', 'conversion_target', 'sum', 'half_year', 'q').measure!, per: 'visitors' } });
    m.options = m.options.map((o) => (o.id === 'promo' ? { ...o, sets: [set('joins', 'promo_joins', 'a promotion could bring 40 a month', { starts_after_periods: 'opening_month' })] } : o));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    const x = r.executable!;
    expect(x.goals.find((g) => g.id === 'reach_400')!.aggregation).toBe('max');
    expect(x.goals.find((g) => g.id === 'conversion')).toMatchObject({ quantity: 'joins', per: 'visitors', aggregation: 'sum', target: 'conversion_target' });
    expect(x.options.find((o) => o.id === 'promo')!.sets).toEqual([{ quantity: 'joins', to: 'promo_joins', from_period: 2 }]);
    expect(x.quantities.map((q) => q.id)).not.toContain('opening_month');
    expect(x.withheld).toContainEqual(expect.objectContaining({ id: 'friendly', kind: 'limit', label: 'Keep the gym friendly' }));
    expect(r.within_limits.leaves_out).toEqual(['friendly']);
    expect(r.coverage.leaves_out.map((w) => w.id)).toEqual(['friendly']);
    // DL (2): an uncertain timing goes into the run under its quantity id (S2 samples it; its whole-period reading is the PL's).
    const unsure = structuredClone(m);
    unsure.quantities = unsure.quantities.map((q) => (q.id === 'opening_month' ? { ...q, value: null, low: 1, high: 4, range_kind: 'bounds' as const } : q));
    const ru = compile(unsure);
    expect(ru.errors).toEqual([]);
    expect(ru.executable!.options.find((o) => o.id === 'promo')!.sets).toEqual([{ quantity: 'joins', to: 'promo_joins', from_period: 'opening_month' }]);
    expect(ru.executable!.quantities.find((q) => q.id === 'opening_month')!.dist).toMatchObject({ kind: 'range', low: 1, high: 4, range_kind: 'bounds' });
    // An elapsed time is 0 or more (the PL's ruling, 23 Oct): a plausible timing range is conditioned there, as Olumi's disclosed conversion.
    const rough = structuredClone(m);
    rough.quantities = rough.quantities.map((q) => (q.id === 'opening_month' ? { ...q, value: null, low: 0, high: 3, range_kind: 'plausible' as const } : q));
    const rr = compile(rough);
    expect(rr.executable!.quantities.find((q) => q.id === 'opening_month')!.dist).toMatchObject({ kind: 'range', domain: { min: 0 } });
    expect(rr.conversions.find((c) => c.quantity === 'opening_month')).toMatchObject({ kind: 'range_law', domain: { min: 0 }, author: 'olumi', provisional: true });
    // An unclear timing range is asked, like any person's range; the other option still compares.
    const unclear = structuredClone(m);
    unclear.quantities = unclear.quantities.map((q) => (q.id === 'opening_month' ? { ...q, value: null, low: 1, high: 4 } : q));
    const rc = compile(unclear);
    expect(rc.perOption.find((o) => o.option_id === 'promo')).toMatchObject({ status: 'asks', asks: ['opening_month'] });
    expect(rc.executable!.options.map((o) => o.id)).toEqual(['carry_on']);
  });

  it('DL defect (c) + fact/coefficient: an inline option value compiles into a named quantity; a missing one is an ask that fills it', () => {
    const m = bakery();
    m.options.push(option('raise_price', 'Raise the price', [set('price', null, 'put the price up to £3.50', { value: 3.5 })], 'put the price up'));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.executable!.options.find((o) => o.id === 'raise_price')!.sets).toEqual([{ quantity: 'price', to: 'raise_price__price', from_period: 0 }]);
    expect(xq(r).get('raise_price__price')).toEqual({ id: 'raise_price__price', label: 'Raise the price: price', unit: 'GBP/loaf', reading: 'state', dist: { kind: 'fixed', value: 3.5, author: 'person' } });
    expect(project(m, r).items.find((i) => i.record_id === 'raise_price__price')).toMatchObject({ shown_as: { on_node: 'raise_price' }, in_calculation: true, author: 'person' });
    const open = bakery();
    open.options.push(option('raise_price', 'Raise the price', [set('price', null, 'put the price up', { question: 'What price would you charge?' })], 'put the price up'));
    const ro = compile(open);
    expect(ro.errors).toEqual([]);
    expect(ro.perOption.find((o) => o.option_id === 'raise_price')).toMatchObject({ status: 'asks', asks: ['raise_price__price'] });
    expect(ro.executable!.options.map((o) => o.id)).toEqual(['buy_oven', 'keep_one']);
    const filled = { ...open, options: open.options.map((o) => (o.id === 'raise_price' ? { ...o, sets: [{ ...o.sets[0]!, value: 3.5, question: null, quote: '£3.50' }] } : o)) };
    expect(compile(filled).executable!.options.map((o) => o.id)).toEqual(['buy_oven', 'keep_one', 'raise_price']);
    const fact = bakery();
    fact.quantities = fact.quantities.map((q) => (q.id === 'costs' ? olumi('costs', 'GBP/week', 500, 700) : q));
    const rf = compile({ ...fact, quantities: fact.quantities.map((q) => (q.id === 'costs' ? { ...q, kind: 'fact' as const } : q)) });
    expect(rf.errors.map((e) => [e.code, e.items])).toEqual([['fact_estimated', ['costs']]]);
    expect(compile(fact).errors).toEqual([]);
  });

  it('DL defect (b): a goal window may be null: a static level reads once at period 0; a level that moves over time asks for a deadline', () => {
    const m = bakery();
    m.quantities.push(person('price_floor', 'GBP/loaf', 2.5, 'never below £2.50'));
    m.goals.push({ ...goal('price_level', 'price', '>=', 'price_floor', 'end', 'quarter', 'never below £2.50'), label: 'Keep the price at least £2.50', measure: { ...goal('x', 'price', '>=', 'price_floor', 'end', 'quarter', 'q').measure!, window: null } });
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.executable!.goals.find((g) => g.id === 'price_level')!.window).toEqual({ start_period: 0, periods: 1 });
    const moving = bakery();
    moving.goals = moving.goals.map((g) => (g.id === 'cash_buffer' ? { ...g, measure: { ...g.measure!, window: null } } : g));
    const rm = compile(moving);
    expect(rm.errors).toEqual([]);
    expect(rm.perGoal.find((p) => p.goal_id === 'cash_buffer')).toMatchObject({ status: 'asks', needs_deadline: true, asks: [] });
    expect(rm.blockers).toEqual([{ id: 'cash_buffer', code: 'deadline', scope: ['cash_buffer'] }]);
    expect(rm.perGoal.find((p) => p.goal_id === 'cash_buffer')!.reasons).toEqual(['It changes over time, so it needs a deadline.']);
    expect(rm.executable!.goals.map((g) => g.id)).toEqual(['weekly_profit']);
  });

  it('DL defect (a): an option that reaches only a limit reaches; one that reaches neither is an error', () => {
    const m = bakery();
    m.quantities.push(person('hours', 'hour/week', 50, '50 hours a week'), person('fewer_hours', 'hour/week', 40, 'cut to 40 hours'), person('hours_cap', 'hour/week', 45, 'no more than 45 hours'));
    m.limits.push(limit('my_hours', 'No more than 45 hours a week', 'hours', '<=', 'hours_cap', 'every', 'quarter', 'no more than 45 hours'));
    m.options.push(option('cut_hours', 'Cut my hours', [set('hours', 'fewer_hours', 'cut to 40 hours')], 'Cut my hours'));
    expect(compile(m).errors).toEqual([]);
    const none = bakery();
    none.quantities.push(person('hours', 'hour/week', 50, '50 hours a week'), person('fewer_hours', 'hour/week', 40, 'cut to 40 hours'));
    none.options.push(option('cut_hours', 'Cut my hours', [set('hours', 'fewer_hours', 'cut to 40 hours')], 'Cut my hours'));
    expect(codes(compile(none))).toEqual(['set_reaches_nothing', 'option_reaches_no_goal']);
  });

  it('alpha G7: an id lowering generates is no record\'s own: an authored record with it is refused, never silently replaced or reused', () => {
    // revenue = price x loaves is derived, so a change goal against today makes revenue__today and revenue_growth__change_rel.
    // profit = revenue + grants - costs makes profit__plus, whose own today-shadow is profit__plus__today (a nested generated id).
    const shop = (extra: CanonicalQuantityT[], goals: CanonicalGoalT[]) => model({
      period: 'month',
      quantities: [person('price', 'GBP/loaf', 3, 'loaves sell at £3'), person('loaves', 'loaf/month', 1600, 'about 1,600 loaves a month'), derived('revenue', 'GBP/month'),
        person('grants', 'GBP/month', 200, 'a £200 grant'), person('costs', 'GBP/month', 3000, 'costs of £3,000'), derived('profit', 'GBP/month'),
        person('growth_target', '%', 10, 'grow by 10%'), person('year', 'month', 12, 'next year'), ...extra],
      relations: [def('revenue_rel', 'revenue', 'product', ['price', 'loaves']),
        { form: 'definition', id: 'profit_rel', defines: 'profit', op: 'sum', parts: [{ id: 'revenue', sign: 1 }, { id: 'grants', sign: 1 }, { id: 'costs', sign: -1 }], ...base, ...who(null) }],
      goals,
    });
    const growthOf = (id: string, quantity: string): CanonicalGoalT => ({ ...goal(id, quantity, '>=', 'growth_target', 'end', 'year', 'grow by 10%'),
      measure: { ...goal(id, quantity, '>=', 'growth_target', 'end', 'year', 'grow by 10%').measure!, frame: 'change_rel', reference: { kind: 'now', option: null, quantity: null } } });
    const badIds = (r: ReturnType<typeof compile>) => r.errors.filter((e) => e.code === 'bad_id').map((e) => e.items[0]);
    // The generated reference and change: before the fix, the authored revenue__today was silently replaced by Olumi's shadow.
    const clash = compile(shop([person('revenue__today', 'GBP/month', 4000, 'we make £4,000 today')], [growthOf('revenue_growth', 'revenue')]));
    expect(badIds(clash)).toEqual(['revenue__today']);
    expect(clash.errors.find((e) => e.code === 'bad_id')!.message).toBe('The id "revenue__today" is one Olumi uses for a working figure of its own; give that record another id.');
    expect(clash.executable).toBeNull();
    // A nested generated id (the shadow of a generated intermediate) is guarded the same way.
    expect(badIds(compile(shop([person('profit__plus__today', 'GBP/month', 1, 'one pound')], [growthOf('profit_growth', 'profit')])))).toEqual(['profit__plus__today']);
    // Contrast: the same goals with no clashing record compile; and an id that only LOOKS generated (no lowering makes it) is ordinary.
    expect(compile(shop([], [growthOf('revenue_growth', 'revenue'), growthOf('profit_growth', 'profit')])).errors).toEqual([]);
    expect(badIds(compile(shop([person('shop__today', 'GBP/month', 4000, 'we make £4,000 today')], [growthOf('revenue_growth', 'revenue')])))).toEqual([]);
    // Codex r2: a stock's today-shadow is its start, so no cash__today is made; an authored, unused cash__today is not refused.
    const cashModel = model({ period: 'month',
      quantities: [person('cash_now', 'GBP', 1000, '£1,000 in the bank'), person('takings', 'GBP/month', 300, '£300 a month'), derived('cash', 'GBP'),
        person('cash__today', 'GBP', 5, 'five pounds'), person('growth_target', '%', 10, 'grow by 10%'), person('year', 'month', 12, 'next year')],
      relations: [stock('cash_rel', 'cash', 'cash_now', ['takings'], [])], goals: [growthOf('cash_growth', 'cash')] });
    expect(badIds(compile(cashModel))).toEqual([]);
  });

  it('plan r3 #1: the question binds the calculation: "revenue next year", "annual revenue" and "revenue growth" compile to three different executable goals', () => {
    const change = (g: CanonicalGoalT, frame: 'change_abs' | 'change_rel', reference: NonNullable<CanonicalGoalT['measure']>['reference']): CanonicalGoalT => ({ ...g, measure: { ...g.measure!, frame, reference } });
    const sundays = (goals: CanonicalGoalT[]) => model({
      question: 'Should the bakery open on Sundays?', period: 'month',
      quantities: [
        person('loaf_price', 'GBP/loaf', 3, 'loaves sell at £3'),
        person('loaves_now', 'loaf/month', 1600, 'about 1,600 loaves a month'),
        person('growth', 'loaf/month/month', 50, 'growing by about 50 loaves a month each month'),
        person('sunday_growth', 'loaf/month/month', 80, 'Sundays could make that 80'),
        derived('loaves', 'loaf/month'),
        derived('revenue', 'GBP/month'),
        structure('months_per_year', 'month/year', 12, 'A year has 12 months.'),
        derived('annual_run_rate', 'GBP/year'),
        person('year_total_target', 'GBP', 60000, 'over £60,000 next year'),
        person('run_rate_target', 'GBP/year', 65000, 'an annual revenue of £65,000'),
        person('growth_target', '%', 10, 'grow revenue by 10%'),
        person('lift_target', 'GBP/month', 500, '£500 a month more than if we carry on'),
        person('year', 'month', 12, 'next year'),
      ],
      relations: [stock('loaves_rel', 'loaves', 'loaves_now', ['growth'], []), def('revenue_rel', 'revenue', 'product', ['loaf_price', 'loaves']), def('run_rate_rel', 'annual_run_rate', 'product', ['revenue', 'months_per_year'])],
      goals,
      options: [option('open_sundays', 'Open on Sundays', [set('growth', 'sunday_growth', 'Sundays could make that 80')], 'open on Sundays'), option('carry_on', 'Carry on as now', [], 'carry on as now')],
    });
    const r = compile(sundays([
      goal('revenue_next_year', 'revenue', '>', 'year_total_target', 'sum', 'year', 'over £60,000 next year'),
      goal('annual_revenue', 'annual_run_rate', '>=', 'run_rate_target', 'end', 'year', 'an annual revenue of £65,000'),
      change(goal('revenue_growth', 'revenue', '>=', 'growth_target', 'end', 'year', 'grow revenue by 10%'), 'change_rel', { kind: 'now', option: null, quantity: null }),
    ]));
    expect(r.errors).toEqual([]);
    const w = { start_period: 0, periods: 12 };
    expect(r.executable!.goals).toEqual([
      { id: 'revenue_next_year', label: 'revenue next year', quantity: 'revenue', cmp: '>', target: 'year_total_target', aggregation: 'sum', window: w },
      { id: 'annual_revenue', label: 'annual revenue', quantity: 'annual_run_rate', cmp: '>=', target: 'run_rate_target', aggregation: 'end', window: w },
      { id: 'revenue_growth', label: 'revenue growth', quantity: 'revenue_growth__change_rel', cmp: '>=', target: 'growth_target', aggregation: 'end', window: w },
    ]);
    const q = xq(r);
    expect(q.get('revenue__today')).toEqual({ id: 'revenue__today', label: 'revenue today', unit: 'GBP/month', reading: 'state', equation: { form: 'definition', op: 'product', parts: ['loaf_price', 'loaves_now'] } });
    expect(q.get('revenue_growth__change')!.equation).toEqual({ form: 'definition', op: 'difference', parts: ['revenue', 'revenue__today'] });
    expect(q.get('revenue_growth__change_rel')!.equation).toEqual({ form: 'definition', op: 'ratio', parts: ['revenue_growth__change', 'revenue__today'] });
    expect(q.get('growth_target')!.dist).toEqual({ kind: 'fixed', value: 0.1, author: 'person' });
    expect(q.get('months_per_year')!.dist).toEqual({ kind: 'fixed', value: 12, author: 'structure' });
    const r2 = compile(sundays([change(goal('sunday_lift', 'revenue', '>=', 'lift_target', 'end', 'year', '£500 a month more than if we carry on'), 'change_abs', { kind: 'option', option: 'carry_on', quantity: null })]));
    expect(r2.errors).toEqual([]);
    const q2 = xq(r2);
    expect(r2.executable!.goals[0].quantity).toBe('sunday_lift__change');
    expect(q2.get('sunday_lift__change')!.equation).toEqual({ form: 'definition', op: 'difference', parts: ['revenue', 'revenue__sq'] });
    expect(q2.get('revenue__sq')!.equation).toEqual({ form: 'definition', op: 'product', parts: ['loaf_price', 'loaves__sq'] });
    expect(q2.get('loaves__sq')!.stock).toEqual({ start: 'loaves_now', inflows: ['growth__base'], outflows: [] });
    expect(q2.get('growth')).toEqual({ id: 'growth', label: 'growth', unit: 'loaf/month/month', reading: 'flow', equation: { form: 'definition', op: 'sum', parts: ['growth__base'] } });
    expect(q2.get('growth__base')!.dist).toEqual({ kind: 'fixed', value: 50, author: 'person' });
    expect(r2.executable!.options[0].sets).toEqual([{ quantity: 'growth', to: 'sunday_growth', from_period: 0 }]);
    const bad = compile(sundays([change(goal('g', 'revenue', '>=', 'growth_target', 'end', 'year', 'grow revenue by 10%'), 'change_rel', null)]));
    expect(bad.errors.map((e) => e.code)).toEqual(['goal_shape']);
  });

  it('PL ruling A: readings are STRUCTURAL: an option never changes another option\'s question (the inventory counterexample)', () => {
    const shop = (alternative: boolean) => model({
      question: 'Should the shop raise its price?', period: 'month',
      quantities: [
        person('stock_now', 'item', 20, '20 items in stock'), person('restock', 'item/month', 2, '2 more items a month'),
        derived('stock_level', 'item'), person('price', 'GBP/item', 10, '£10 an item'), person('dearer', 'GBP/item', 12, '£12 from month 3'),
        derived('stock_value', 'GBP'), person('value_target', 'GBP', 250, 'at least £250 of stock'), person('three', 'month', 3, 'in three months'),
      ],
      relations: [stock('stock_rel', 'stock_level', 'stock_now', ['restock'], []), def('value_rel', 'stock_value', 'product', ['price', 'stock_level'])],
      goals: [goal('stock_worth', 'stock_value', '>=', 'value_target', 'end', 'three', 'at least £250 of stock')],
      options: [option('hold', 'Hold the price', [], 'hold the price'), ...(alternative ? [option('raise', 'Raise the price', [set('price', 'dearer', '£12 from month 3', { starts_after_periods: 2 })], 'raise the price')] : [])],
    });
    const alone = compile(shop(false));
    const both = compile(shop(true));
    expect(alone.errors).toEqual([]);
    expect(both.errors).toEqual([]);
    expect(xq(alone).get('stock_value')!.reading).toBe('state');
    expect(xq(both).get('stock_value')!.reading).toBe('state'); // the alternative's dated price never makes it a flow
    expect(xq(both).get('price')!.reading).toBe('state');
    expect(xq(both).get('restock')!.reading).toBe('flow');      // contrast: a stock's inflow is a flow
    // "Hold": value at the end of month 3 is 10 × S[3] = 10 × 26 = 260, with or without the alternative in the model.
    expect(probeValue(alone.executable!, alone.executable!.goals[0], 'hold')).toBe(260);
    expect(probeValue(both.executable!, both.executable!.goals[0], 'hold')).toBe(260);
    expect(probeValue(both.executable!, both.executable!.goals[0], 'raise')).toBe(312); // 12 × 26: the set is active at boundary 3
  });

  it('alpha G2: what a figure can be is DECLARED (Olumi\'s floor and ceiling), never inferred from its unit; a setting is read within what it sets', () => {
    const withMembers = (f: Partial<CanonicalQuantityT>) => { const g = gymFilled(); g.quantities = g.quantities.map((q) => (q.id === 'members_now' ? { ...q, value: null, range_kind: 'plausible' as const, ...f } : q)); return compile(g); };
    const domain = (r: ReturnType<typeof compile>, id = 'members_now') => (r.conversions.find((c) => c.kind === 'range_law' && c.quantity === id) as { domain?: unknown } | undefined)?.domain;
    // Undeclared: no domain, whatever the unit's name, so a level of members and a signed change are both drawn on both sides of 0.
    expect(domain(withMembers({ low: 280, high: 320 }))).toBeNull();
    expect(domain(withMembers({ kind: 'coefficient', author: 'olumi', status: 'estimated', quote: null, basis: 'a guess', low: -50, high: 200 }))).toBeNull();
    // Declared floor 0 (a count of members cannot be negative): the draw is conditioned on it.
    expect(domain(withMembers({ low: 280, high: 320, floor: 0 }))).toEqual({ min: 0 });
    // Both ends, in the quantity's own unit, scaled with it: a share declared 0 to 100 % is drawn within 0 to 1.
    const share = compile(model({
      question: 'Will enough visitors join?', period: 'month',
      quantities: [person('visitors', 'visitor', 1000, '1,000 visitors'),
        qty('share', '%', { kind: 'coefficient', author: 'olumi', status: 'estimated', basis: 'a guess', low: 10, high: 90, range_kind: 'plausible', floor: 0, ceiling: 100 }),
        derived('joined', 'visitor'), person('want', 'visitor', 300, '300 to join'), person('one', 'month', 1, 'this month')],
      relations: [def('joined_rel', 'joined', 'product', ['visitors', 'share'])],
      goals: [goal('enough', 'joined', '>=', 'want', 'end', 'one', '300 to join')],
      options: [option('carry_on', 'Carry on as now', [], 'carry on as now')],
    }));
    expect(domain(share, 'share'), JSON.stringify(share.errors)).toEqual({ min: 0, max: 1 });
    // A setting stands in for what it sets: Olumi's estimated setting of members today (inline: promo__members_now) is read
    // within the declared floor of members today; with no declaration on either, it has none.
    const setting = (floor: number | null) => {
      const m = gymFilled();
      m.quantities = m.quantities.map((q) => (q.id === 'members_now' ? { ...q, floor } : q));
      m.options = m.options.map((o) => (o.id === 'promo' ? { ...o, sets: [...o.sets, { ...o.sets[0]!, quantity: 'members_now', to: null, value: 5, low: 0, high: 10, range_kind: 'plausible' as const, author: 'olumi' as const, quote: null }] } : o));
      return compile(m);
    };
    expect(domain(setting(0), 'promo__members_now'), JSON.stringify(setting(0).errors)).toEqual({ min: 0 });
    expect(domain(setting(null), 'promo__members_now')).toBeNull();
  });

  it('alpha G2: a figure given wholly outside its declared bounds is asked again (theirs) or held (Olumi\'s), naming Olumi\'s reading; a fixed one too', () => {
    const withMembers = (f: Partial<CanonicalQuantityT>) => { const g = gymFilled(); g.quantities = g.quantities.map((q) => (q.id === 'members_now' ? { ...q, floor: 0, ...f } : q)); return compile(g); };
    const why = (r: ReturnType<typeof compile>) => r.perGoal.find((p) => p.goal_id === 'reach_400')!.reasons.join(' ');
    const fixed = withMembers({ value: -5, low: null, high: null });
    expect(fixed.blockers).toContainEqual({ id: 'members_now', code: 'recount', scope: ['reach_400'] });
    expect(why(fixed)).toContain('needs "members now" again: "members now" is given as -5 member, but Olumi reads it as never below 0 member.');
    // A ceiling, from above.
    expect(why(withMembers({ value: 900, low: null, high: null, ceiling: 500 }))).toContain('is given as 900 member, but Olumi reads it as never above 500 member');
    // Olumi's own fixed figure outside: held as unsupported, never asked of them.
    const olumis = withMembers({ value: -5, low: null, high: null, author: 'olumi', status: 'estimated', quote: null, basis: 'a guess' });
    expect(olumis.perGoal.find((p) => p.goal_id === 'reach_400')).toMatchObject({ status: 'withheld' });
    expect(why(olumis)).toContain('but Olumi reads it as never below 0 member; Olumi\'s figure is unsupported');
    // Contrast: inside its bounds, or undeclared, a figure below 0 is no contradiction.
    expect(withMembers({ value: 5, low: null, high: null }).blockers.some((b) => b.code === 'recount')).toBe(false);
    expect(withMembers({ value: -5, low: null, high: null, floor: null }).blockers.some((b) => b.code === 'recount')).toBe(false);
  });

  it('alpha G6: a setting\'s timing worked out by a relation, or one that does not apply, is a typed error, never period 0', () => {
    const timed = (opens: Partial<CanonicalQuantityT>, relation = false) => {
      const g = gymFilled();
      g.quantities.push(qty('opens', 'month', opens), person('lease', 'month', 2, 'the lease is signed in two months'), person('fit', 'month', 1, 'a month to fit out'));
      if (relation) g.relations.push(def('opens_rel', 'opens', 'sum', ['lease', 'fit']));
      g.options = g.options.map((o) => (o.id === 'promo' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'opens' })) } : o));
      return compile(g);
    };
    for (const [what, r] of [['derived', timed({ status: 'derived', kind: 'derived' }, true)],
      ['not applicable', timed({ status: 'not_applicable', author: 'olumi', basis: 'Nothing sets when it opens.' })]] as const) {
      expect(r.errors.map((e) => [e.code, e.items]), what).toContainEqual(['timing', ['promo', 'opens']]);
      expect(r.executable, what).toBeNull();
    }
    // Codex r1 #3770: on a ruled-out option it blocks nothing; the live options still run.
    const out = (() => { const g = gymFilled();
      g.quantities.push(qty('opens', 'month', { status: 'derived', kind: 'derived' }), person('lease', 'month', 2, 'the lease is signed in two months'), person('fit', 'month', 1, 'a month to fit out'));
      g.relations.push(def('opens_rel', 'opens', 'sum', ['lease', 'fit']));
      g.options = g.options.map((o) => (o.id === 'promo' ? { ...o, status: 'ruled_out' as const, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'opens' })) } : o));
      return compile(g); })();
    expect(out.errors).toEqual([]);
    expect(out.executable!.options.map((o) => o.id)).toEqual(['carry_on']);
    // Contrast: an asked timing is asked of them (the option waits on it), never an error and never period 0.
    const asked = timed({ status: 'asked', question: 'When does it open?' });
    expect(asked.errors).toEqual([]);
    expect(asked.perOption.find((o) => o.option_id === 'promo')).toMatchObject({ status: 'asks', asks: ['opens'] });
  });

  it('DL ruling 4 (S2 law 9d34ef05+): a plausible range is a spread, never a point and never an invented domain; one with no room is HELD; a most likely figure at an end is an error', () => {
    const withCosts = (f: Partial<CanonicalQuantityT>) => { const m = bakery(); m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, ...f } : q)); return compile(m); };
    // A wide money range with no most likely figure: read unbounded (money carries no invented domain), so it calculates.
    const wide = withCosts({ low: 0, high: 1200, range_kind: 'plausible' });
    expect(wide.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(wide.conversions.find((c) => c.quantity === 'costs')).toMatchObject({ reading: unbounded(600, 1200 / Math.sqrt(12)) });
    // A count whose WHOLE range is below 0 contradicts what it can be (the PL's ruling, 23 Oct): never pinned near 0, never
    // read as a spread. The person's is ASKED again with its words kept; Olumi's is HELD as unsupported.
    const g = gymFilled();
    g.quantities = g.quantities.map((q) => (q.id === 'members_now' ? { ...q, value: null, low: -1010, high: -990, range_kind: 'plausible' as const, floor: 0 } : q));
    const theirs = compile(g);
    expect(theirs.perGoal.find((p) => p.goal_id === 'reach_400')).toMatchObject({ status: 'asks', asks: ['members_now'] });
    expect(theirs.blockers).toContainEqual({ id: 'members_now', code: 'recount', scope: ['reach_400'] });
    expect(theirs.perGoal.find((p) => p.goal_id === 'reach_400')!.reasons.join(' ')).toContain('is given as -1010–-990 member, but Olumi reads it as never below 0 member.');
    expect(theirs.perGoal.find((p) => p.goal_id === 'reach_400')!.reasons.join(' ')).not.toContain('What is it?');
    expect(theirs.conversions.some((c) => c.quantity === 'members_now')).toBe(false);
    expect(theirs.perGoal.find((p) => p.goal_id === 'class_income')).toMatchObject({ status: 'calculable' }); // contrast
    const olumis = gymFilled();
    olumis.quantities = olumis.quantities.map((q) => (q.id === 'members_now' ? { ...q, value: null, low: -1010, high: -990, range_kind: 'plausible' as const, author: 'olumi' as const, status: 'estimated' as const, quote: null, basis: 'a guess', floor: 0 } : q));
    const heldR = compile(olumis);
    expect(heldR.perGoal.find((p) => p.goal_id === 'reach_400')).toMatchObject({ status: 'withheld' });
    expect(heldR.perGoal.find((p) => p.goal_id === 'reach_400')!.reasons.join(' ')).toContain('but Olumi reads it as never below 0 member; Olumi\'s range is unsupported');
    // Only a count's domain: a money range wholly below 0 (a loss) stays an ordinary spread.
    const loss = withCosts({ low: -700, high: -500, range_kind: 'plausible' });
    expect(loss.conversions.find((c) => c.quantity === 'costs')).toMatchObject({ kind: 'range_law', domain: null });
    const usable = withCosts({ low: 500, high: 700, range_kind: 'plausible' });
    expect(usable.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(usable.conversions).toContainEqual({ kind: 'range_law', quantity: 'costs', low: 500, high: 700, range_kind: 'plausible', domain: null, reading: unbounded(600, 200 / Math.sqrt(12)), author: 'olumi', provisional: true });
    expect(xq(usable).get('costs')!.dist).toEqual({ kind: 'range', low: 500, high: 700, basis: 'person_range', range_kind: 'plausible' });
    const atEnd = withCosts({ value: 500, low: 500, high: 700, range_kind: 'plausible' });
    expect(atEnd.errors.map((e) => [e.code, e.items])).toEqual([['range_order', ['costs']]]);
    expect(atEnd.errors[0].message).toContain('at an end of its range');
    const m = bakery(); m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, low: 500, high: 700, range_kind: 'plausible' as const } : q));
    expect(project(m).graph.nodes.find((n) => n.id === 'costs')!.display_value).toBe('500–700 GBP/week; Olumi reads it as a spread around 600 (sd 57.74), provisionally');
  });

  it('PL ruling B: a person\'s range carries its kind from their words; an unclear one is ASKED; domains truncate only by meaning; never a point', () => {
    const withCosts = (f: Partial<CanonicalQuantityT>) => { const m = bakery(); m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, ...f } : q)); return m; };
    // Unclear: asked, as one edit on that one quantity; answering it unlocks the goals.
    const unclear = withCosts({ low: 500, high: 700 });
    const r = compile(unclear);
    expect(r.errors).toEqual([]);
    expect(r.perGoal.map((p) => [p.status, p.asks])).toEqual([['asks', ['costs']], ['asks', ['costs']]]);
    expect(r.blockers).toEqual([{ id: 'costs', code: 'range_kind', scope: ['weekly_profit', 'cash_buffer'] }]);
    const rb = compile({ ...unclear, quantities: unclear.quantities.map((q) => (q.id === 'costs' ? { ...q, range_kind: 'bounds' as const } : q)) });
    expect(rb.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(xq(rb).get('costs')!.dist).toEqual({ kind: 'range', low: 500, high: 700, basis: 'person_range', range_kind: 'bounds' });
    expect(rb.conversions.find((c) => c.quantity === 'costs')).toMatchObject({ kind: 'range_law', range_kind: 'bounds', author: 'olumi', provisional: true });
    // Never a point: a skewed range stays a spread around its most likely figure (S2's law has no point fallback).
    const skewed = compile(withCosts({ value: 100, low: 0, high: 1200, range_kind: 'plausible' }));
    expect(skewed.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(lawIn(skewed, 'costs').reading).toMatchObject({ kind: 'normal', centre: 100 }); // a spread, never its mode alone
    // Bounds condition the spread on the person's ends: the disclosure reports the CONDITIONED sd, never the unconditioned one.
    const law = lawIn(rb, 'costs');
    expect(law.reading).toMatchObject({ lower: 500, upper: 700 });
    expect(law.reading.sd_conditioned).toBeLessThan(law.reading.sd);
    // Domains: a chance lies in [0, 1]; a count is never negative; money carries no invented domain.
    const m = bakery();
    m.quantities.push(olumi('breakdown_chance', '1', 0.05, 0.2), olumi('lost_loaves', 'loaf/week', -150, -50, -100));
    m.risks.push({ id: 'breakdown', label: 'The oven breaks down', occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', mode: 'add', starts_after_periods: 4, author: 'olumi', quote: null, ...base });
    m.quantities = m.quantities.map((q) => (q.id === 'base_sales' ? { ...q, value: null, low: 350, high: 450, range_kind: 'plausible' as const } : q));
    const rd = compile(m);
    expect(rd.errors).toEqual([]);
    expect(xq(rd).get('breakdown_chance')!.dist).toMatchObject({ domain: { min: 0, max: 1 } });
    expect(lawIn(rd, 'breakdown_chance').reading).toMatchObject({ lower: 0, upper: 1 });
    expect(xq(rd).get('extra_per_oven')!.dist).not.toHaveProperty('domain');
    // alpha G2: a count's domain is its declared floor, never its unit's name.
    const counts = (floor: number | null) => compile(model({ ...gymFilled(), quantities: gymFilled().quantities.map((q) => (q.id === 'members_now' ? { ...q, value: null, low: 280, high: 320, range_kind: 'bounds' as const, floor } : q)) }));
    expect(xq(counts(0)).get('members_now')!.dist).toMatchObject({ range_kind: 'bounds', domain: { min: 0 } });
    expect(xq(counts(null)).get('members_now')!.dist).not.toHaveProperty('domain');
    // Olumi's own range always states its kind.
    const noKind = bakery(); noKind.quantities = noKind.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, range_kind: null } : q));
    expect(compile(noKind).errors.map((e) => [e.code, e.items])).toEqual([['range_kind', ['extra_per_oven']]]);
  });

  it('PL BLOCK 1: window identity: "members after six months" is {0, 6} on a state; "class revenue in months 6 to 8" is {6, 3}; no extra period', () => {
    const m = gymFilled();
    m.quantities.push(person('months_three', 'month', 3, 'months 6 to 8'), person('revenue_6_8', 'GBP', 9000, 'at least £9,000 in months 6 to 8'));
    const summer = goal('summer_classes', 'class_revenue', '>=', 'revenue_6_8', 'sum', 'months_three', 'at least £9,000 in months 6 to 8');
    m.goals.push({ ...summer, measure: { ...summer.measure!, window: win('months_three', 6) } });
    const x = compile(m).executable!;
    expect(x.goals.find((g) => g.id === 'reach_400')!.window).toEqual({ start_period: 0, periods: 6 });
    expect(x.goals.find((g) => g.id === 'summer_classes')!.window).toEqual({ start_period: 6, periods: 3 });
    expect(x.periods).toBe(9);
    expect(x.quantities.find((q) => q.id === 'members')!.reading).toBe('state');
    expect(project(bakery()).items.find((i) => i.record_id === 'extra_per_oven')!.law).toEqual({ author: 'olumi', provisional: true, range_kind: 'plausible', reading: unbounded(120, 70 / Math.sqrt(12)) });
  });

  it('issue map class 13: a start is the DECLARED count starts_after_periods, one meaning in the schema the AI writes and in the compiler: a weekly van from week 1 makes all 4 deliveries in 4 weeks (100 %); one starting after 1 week, 3 (0 %)', () => {
    // The meaning, stated once and sent on every start the AI writes: an option's setting and a risk.
    const sent = CANONICAL_JSON_SCHEMA as any;
    const fields = [sent.properties.options.items.properties.sets.items.properties, sent.properties.risks.items.properties];
    expect(fields.map((f) => [f.starts_after_periods.description.startsWith(`${STARTS_AFTER_PERIODS}.`), 'from_period' in f])).toEqual([[true, false], [true, false]]);
    expect(STARTS_AFTER_PERIODS).toContain('0 = from the start ("straight away", "from the first month" and "from now" are all 0), "from month 3" is 2');
    const van = (starts: number) => model({
      question: 'Should the shop book a weekly van?',
      quantities: [
        person('delivered_now', 'delivery', 0, 'nothing delivered yet'),
        person('weekly_deliveries', 'delivery/week', 0, 'no deliveries without a van'),
        person('van_rate', 'delivery/week', 1, 'one delivery a week'),
        derived('delivered', 'delivery'),
        person('all_four', 'delivery', 4, 'all 4 deliveries'),
        person('four_weeks', 'week', 4, 'within 4 weeks'),
      ],
      relations: [stock('delivered_rel', 'delivered', 'delivered_now', ['weekly_deliveries'], [])],
      goals: [goal('all_delivered', 'delivered', '>=', 'all_four', 'end', 'four_weeks', 'all 4 deliveries within 4 weeks')],
      options: [option('van', 'Book a weekly van', [set('weekly_deliveries', 'van_rate', 'a van every week from week 1', { starts_after_periods: starts })], 'book a weekly van'),
        option('carry_on', 'Carry on as now', [], 'carry on as now')],
    });
    // The compiler reads only the declared count: in force from interval k = the count, the (k+1)th period.
    const chances = (m: CanonicalModelT) => {
      const x = compile(m).executable!;
      expect([x.periods, x.options.find((o) => o.id === 'van')!.sets]).toEqual([4, [{ quantity: 'weekly_deliveries', to: 'van_rate', from_period: m.options[0]!.sets[0]!.starts_after_periods }]]);
      return simulate(x, { seed: 1, draws: 50 }).options.map((o) => { const g = o.per_goal.find((y) => y.goal_id === 'all_delivered')!; return [o.option_id, isWithheld(g) ? g : g.chance]; });
    };
    expect(chances(van(0))).toEqual([['van', 1], ['carry_on', 0]]);
    expect(chances(van(1))).toEqual([['van', 0], ['carry_on', 0]]); // contrast: after 1 week, 3 deliveries by week 4
    // The old name is not read anywhere but the store's one mapping: as written, it is a schema error.
    const old = JSON.parse(JSON.stringify(van(0)).replace('"starts_after_periods":', '"from_period":'));
    expect([...new Set(codes(compileJson(old)))]).toEqual(['schema']);
  });

  it('the schema is valid as strict structured output: closed objects, every key required, anyOf unions only', () => {
    const js = z.toJSONSchema(CanonicalModel) as Record<string, unknown>;
    const bad: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if ('oneOf' in n) bad.push(`${path}: oneOf`);
      if ('default' in n) bad.push(`${path}: default`);
      if (n.type === 'object') {
        const keys = Object.keys((n.properties as object) ?? {});
        if (n.additionalProperties !== false) bad.push(`${path}: open object`);
        if (JSON.stringify([...(n.required as string[] ?? [])].sort()) !== JSON.stringify([...keys].sort())) bad.push(`${path}: not every key required`);
      }
      for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
    };
    walk(js, '$');
    expect(bad).toEqual([]);
    expect(compileJson({ version: 'canonical.v1' }).errors[0].code).toBe('schema');
    expect(CanonicalModel.safeParse(bakery()).success).toBe(true);
  });

  it('units: coefficient × driver makes the defined unit; plural and singular agree; rate words read as per period; multipliers are refused', () => {
    const u = (s: string) => { const p = parseUnit(s); if (!p.ok) throw new Error(p.message); return p.unit; };
    expect(sameDims(u('loaves per week'), u('loaf/week'))).toBe(true);
    expect(sameDims(u('£/member/month'), u('GBP per member per month'))).toBe(true);
    expect(sameDims(u('% monthly'), u('%/month'))).toBe(true);
    expect(sameDims(u('GBP'), u('USD'))).toBe(false);
    expect(parseUnit('£k').ok).toBe(false);
    expect(u('%').scale).toBe(0.01);
  });

  it('S1 one question channel (A4): what the result waits on is typed, in the model\'s order, and the compiler writes no question', () => {
    const edit = (m: CanonicalModelT, f: (m: CanonicalModelT) => void) => { f(m); return m; };
    const cases: [string, CanonicalModelT, { id: string; code: string; scope: string[] }[]][] = [
      ['asked', gym(), [{ id: 'leavers', code: 'asked', scope: ['reach_400'] }]],
      ['approximate: their figure as stated, no blocker (the AI asks for its range)', gymFilled(), []],
      ['no measure', edit(bakery(), (m) => {
        m.goals.push({ id: 'regulars_happy', label: 'Keep the regulars happy', measure: null, question: 'How would you tell the regulars are happy?', author: 'person', quote: 'keep the regulars happy', ...base });
        m.limits.push({ id: 'friendly', label: 'Keep it friendly', measure: null, question: 'How would you tell it stays friendly?', author: 'person', quote: 'keep it friendly', ...base });
      }), [{ id: 'regulars_happy', code: 'measure', scope: ['regulars_happy'] }, { id: 'friendly', code: 'measure', scope: ['friendly'] }]],
      ['no goal', edit(bakery(), (m) => { m.goals = []; }), [{ id: '(model)', code: 'no_goal', scope: [] }]],
      ['deadline', edit(bakery(), (m) => { m.goals = m.goals.map((g) => (g.id === 'cash_buffer' ? { ...g, measure: { ...g.measure!, window: null } } : g)); }),
        [{ id: 'cash_buffer', code: 'deadline', scope: ['cash_buffer'] }]],
      ['range kind', edit(bakery(), (m) => { m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, low: 500, high: 700 } : q)); }),
        [{ id: 'costs', code: 'range_kind', scope: ['weekly_profit', 'cash_buffer'] }]],
      ['recount', edit(gymFilled(), (m) => { m.quantities = m.quantities.map((q) => (q.id === 'members_now' ? { ...q, value: null, low: -1010, high: -990, range_kind: 'plausible' as const, floor: 0 } : q)); }),
        [{ id: 'members_now', code: 'recount', scope: ['reach_400'] }]],
      ['structure', edit(bakery(), (m) => { m.quantities = m.quantities.map((q) => (q.id === 'costs' ? structure('costs', 'GBP/week', 612.5, 'Costs.') : q)); }),
        [{ id: 'costs', code: 'asked', scope: ['weekly_profit', 'cash_buffer'] }]],
      ['an asked figure with no question of the AI\'s: valid, typed', edit(bakery(), (m) => { m.quantities.push(qty('flour_cost', 'GBP/week', { status: 'asked' })); }),
        [{ id: 'flour_cost', code: 'asked', scope: [] }]],
      ['a guardrail that changes over time with no deadline', edit(bakery(), (m) => { m.limits.push(limit('cash_floor', 'Keep cash above today', 'cash', '>=', 'cash_now', 'end', 'quarter', 'at least £10,000 in the bank'));
        m.limits = m.limits.map((l) => (l.id === 'cash_floor' ? { ...l, measure: { ...l.measure!, window: null } } : l)); }), [{ id: 'cash_floor', code: 'deadline', scope: ['cash_floor'] }]],
    ];
    for (const [name, m, blockers] of cases) {
      const r = compile(m);
      expect(r.errors, name).toEqual([]);
      expect(r.blockers, name).toEqual(blockers);
      // No sentence of the compiler's is a question, whatever it waits on (labels carry none here).
      expect(JSON.stringify(r), name).not.toContain('?');
    }
    // The structure figure is asked with NO question of the code's ("What is …?" is gone), and no mark the drafter could forge.
    expect(normalise(cases[7]![1]).quantities.find((q) => q.id === 'costs')).toMatchObject({ status: 'asked', question: null, basis: null });
    // Contrast: the probe sees a question where there is one: the AI's own, on the record, in the model it was given.
    expect(JSON.stringify(gym())).toContain('How many members leave in a typical month?');
    expect(JSON.stringify(cases[2]![1])).toContain('How would you tell the regulars are happy?');
  });
});

/** Issue 39 (DL 24 Oct): a link whose size has no figure, or whose range spans zero, takes the direction the model states. */
describe('issue 39: an unsized link is drawn with its stated direction, never a default sign', () => {
  const priced = (c: Partial<CanonicalQuantityT>): CanonicalModelT => model({
    question: 'Should the bakery raise its price?',
    quantities: [
      person('base_sales', 'loaf/week', 400, 'We sell 400 loaves a week'),
      person('price_rise', 'GBP', 0, 'keep the price'),
      person('fifty_p', 'GBP', 0.5, 'raise it by 50p'),
      qty('price_effect', 'loaf/week/GBP', { kind: 'coefficient', author: 'olumi', ...c }),
      derived('sales', 'loaf/week'),
      person('sales_target', 'loaf/week', 380, 'keep sales at 380 or more'),
      person('quarter', 'week', 13, 'within 13 weeks'),
    ],
    relations: [eff('sales_rel', 'sales', 'base_sales', [['price_rise', 'price_effect']])],
    goals: [goal('keep_sales', 'sales', '>=', 'sales_target', 'end', 'quarter', 'keep sales at 380 or more')],
    options: [option('raise', 'Raise the price by 50p', [set('price_rise', 'fifty_p', 'raise it by 50p')], 'raise it by 50p'), option('keep', 'Keep the price', [], 'keep the price')],
  });
  /** The price link as drawn: its direction and the sign of its strength. */
  const linkOf = (m: CanonicalModelT) => {
    const e = (project(m).graph.edges as Record<string, unknown>[]).find((x) => x.from === 'price_rise' && x.to === 'sales')!;
    return { direction: e.effect_direction, mean: (e.strength as { mean: number }).mean };
  };
  const UNKNOWN = { status: 'unknown' as const, basis: 'Last year\'s sales after a price change would size it.' };
  const STRADDLES = { status: 'estimated' as const, low: -60, high: 20, range_kind: 'plausible' as const, basis: 'It could go either way.' };

  it('an unknown size that lowers what it moves is drawn negative; one that raises it, positive', () => {
    expect(linkOf(priced({ ...UNKNOWN, direction: 'lowers' }))).toEqual({ direction: 'negative', mean: -1 });
    expect(linkOf(priced({ ...UNKNOWN, direction: 'raises' }))).toEqual({ direction: 'positive', mean: 1 });
  });

  it('a range that spans zero takes its stated direction, not the sign of its centre', () => {
    // Contrast: with no stated direction the centre (-20) still decides, as before.
    expect(linkOf(priced({ ...STRADDLES, direction: null }))).toEqual({ direction: 'negative', mean: -1 });
    expect(linkOf(priced({ ...STRADDLES, direction: 'raises' }))).toEqual({ direction: 'positive', mean: 1 });
  });

  it('a range across zero with a most likely figure keeps that figure\'s sign, whatever the direction says (Codex r1 #3734)', () => {
    const across = { status: 'estimated' as const, low: -1, high: 1, range_kind: 'plausible' as const, basis: 'It could go either way, most likely a little down.' };
    expect(linkOf(priced({ ...across, value: -0.2, direction: 'raises' }))).toEqual({ direction: 'negative', mean: -1 });
    expect(linkOf(priced({ ...across, value: 0.2, direction: 'lowers' }))).toEqual({ direction: 'positive', mean: 1 });
  });

  it('a figure keeps its own sign: a stated direction never overrides it', () => {
    expect(linkOf(priced({ status: 'estimated', low: -60, high: -10, value: -30, range_kind: 'plausible', basis: 'Fewer loaves sell at a higher price.', direction: 'raises' })))
      .toEqual({ direction: 'negative', mean: -1 });
  });

  it('an unknown size with no stated direction is not drawn: no link carries a sign no one can give, and its record stays accounted for', () => {
    const items = (m: CanonicalModelT) => new Map(project(m).items.map((i) => [i.record_id, i] as const));
    const linked = (m: CanonicalModelT) => (project(m).graph.edges as Record<string, unknown>[]).map((e) => `${String(e.from)}>${String(e.to)}`);
    const none = priced({ ...UNKNOWN, direction: null });
    const lowers = priced({ ...UNKNOWN, direction: 'lowers' });
    expect(linked(none)).not.toContain('price_rise>sales');
    expect(linked(lowers), 'contrast: the same link with a direction is drawn').toContain('price_rise>sales');
    expect(linked(none), 'the base level is still drawn').toContain('base_sales>sales');
    // The size and its link stay in the model, said as before, shown nowhere on the canvas.
    expect(none.quantities.map((x) => x.id)).toContain('price_effect');
    expect(items(none).get('price_effect')).toMatchObject({ shown_as: {}, in_calculation: false, why_out: items(lowers).get('price_effect')!.why_out });
    expect(items(none).get('price_effect')!.why_out).toContain('unknown: Last year\'s sales after a price change would size it.');
    expect(items(none).get('sales_rel:price_rise')).toMatchObject({ shown_as: {} });
    expect(items(lowers).get('sales_rel:price_rise')).toMatchObject({ shown_as: { edge: 'price_rise__sales' } });
  });

  it('the revision digest leaves a null direction out, so a Run on a program saved before the field stays current', () => {
    const old = JSON.parse(JSON.stringify(priced(UNKNOWN))) as CanonicalModelT;
    for (const x of old.quantities) delete (x as Partial<CanonicalQuantityT>).direction;
    const read = CanonicalModel.parse(withDeclaredTiming(old));
    expect(revisionDigest(read, ['the brief'])).toBe(revisionDigest(old, ['the brief']));
    // Contrast: a stated direction is part of the model, so it moves the digest.
    expect(revisionDigest(priced({ ...UNKNOWN, direction: 'lowers' }), ['the brief'])).not.toBe(revisionDigest(read, ['the brief']));
  });

  it('a program saved before direction existed is read in today\'s format, every quantity with none', () => {
    const old = JSON.parse(JSON.stringify(priced(UNKNOWN))) as { quantities: Record<string, unknown>[] };
    for (const x of old.quantities) delete x.direction;
    // Contrast: the format needs the field, so the reader's mapping is what lets an old program open.
    expect(CanonicalModel.safeParse(old).success).toBe(false);
    const read = CanonicalModel.safeParse(withDeclaredTiming(old));
    expect(read.success).toBe(true);
    expect(read.data!.quantities.map((x) => [x.id, x.direction])).toEqual(old.quantities.map((x) => [x.id, null]));
  });

  it('issue 40: a direction the projection would not use is cleared when the draft is read, so the card never states it, and nothing drawn moves; one it uses is kept', () => {
    const dirOf = (m: CanonicalModelT, id = 'price_effect') => normalise(m).quantities.find((x) => x.id === id)!.direction;
    const without = (m: CanonicalModelT, id = 'price_effect'): CanonicalModelT => ({ ...m, quantities: m.quantities.map((x) => (x.id === id ? { ...x, direction: null } : x)) });
    const ONE_SIDE = { status: 'estimated' as const, low: -60, high: -10, range_kind: 'plausible' as const, basis: 'Fewer loaves sell at a higher price.' };
    const stray = priced({ ...UNKNOWN, direction: null });
    stray.quantities.push(qty('stray_effect', 'loaf/week/GBP', { kind: 'coefficient', author: 'olumi', ...UNKNOWN, direction: 'lowers' }));
    // Cleared: a figure is given; a range on one side of zero; a size no link has. The projection is the same with or without.
    for (const [m, id] of [[priced({ ...ONE_SIDE, value: -30, direction: 'raises' }), 'price_effect'], [priced({ ...ONE_SIDE, direction: 'raises' }), 'price_effect'], [stray, 'stray_effect']] as const) {
      expect(m.quantities.find((x) => x.id === id)!.direction).not.toBeNull();
      expect(dirOf(m, id)).toBeNull();
      expect(project(m).graph).toEqual(project(without(m, id)).graph);
    }
    // Kept: an unknown size, and a range across zero, take their stated direction (issue 39), and it moves what is drawn.
    expect(dirOf(priced({ ...UNKNOWN, direction: 'lowers' }))).toBe('lowers');
    expect(dirOf(priced({ ...STRADDLES, direction: 'raises' }))).toBe('raises');
    expect(project(priced({ ...STRADDLES, direction: 'raises' })).graph).not.toEqual(project(priced({ ...STRADDLES, direction: null })).graph);
  });
});

describe('AIE §5 AMEND (DL 24 Oct): a first draft never waits on an ask no one can see', () => {
  const withQ = (m: CanonicalModelT, id: string, f: Partial<CanonicalQuantityT>): CanonicalModelT => ({ ...m, quantities: m.quantities.map((q) => (q.id === id ? { ...q, ...f } : q)) });
  it('an asked figure with no question is refused on a first draft; with its question, or on a saved model or an update, it compiles as before', () => {
    const noQ = withQ(gym(), 'leavers', { question: null });
    expect(compile(noQ, { asksNeedQuestions: true }).errors.map((e) => [e.code, e.items])).toEqual([['asked_no_question', ['leavers']]]);
    expect(codes(compile(withQ(gym(), 'leavers', { question: '  ' }), { asksNeedQuestions: true }))).toEqual(['asked_no_question']); // blank is none
    // Contrast: with its question a first draft compiles; a saved model or an update (no flag) keeps A4, the typed blocker only.
    expect(codes(compile(gym(), { asksNeedQuestions: true }))).toEqual([]);
    const saved = compile(noQ);
    expect(codes(saved)).toEqual([]);
    expect(saved.blockers.map((b) => [b.id, b.code])).toContainEqual(['leavers', 'asked']);
    // A figure labelled structure that is no structural constant is the person's ask (normalise): on a first draft it needs its question too.
    const mislabelled = withQ(gym(), 'joins', { author: 'structure', quote: null, basis: 'Today.' });
    expect(compile(mislabelled, { asksNeedQuestions: true }).errors.map((e) => [e.code, e.items])).toEqual([['asked_no_question', ['joins']]]);
    expect(codes(compile(mislabelled))).toEqual([]);
  });

  it('the starting level of a setting only the options change, and a whole, are structure: Olumi\'s proposed divisions compile with no ask', () => {
    const olumiOption = (id: string, label: string, value: number): CanonicalModelT['options'][number] =>
      ({ ...option(id, label, [set('share', null, 'x', { value, author: 'olumi', quote: null })], 'x'), author: 'olumi', quote: null });
    const division = model({
      question: 'How should the week be divided between baking and deliveries?',
      quantities: [
        structure('share', '%', 0, 'No option set yet: each option sets its own share.'),
        structure('start', '%', 0, 'Nothing done yet.'),
        olumi('pace', '1', 0.8, 1.6, 1.2),
        derived('coverage', '%'),
        structure('whole', '%', 100, 'All of it.'),
        person('weeks', 'week', 6, 'over six weeks'),
      ],
      relations: [eff('coverage_rel', 'coverage', 'start', [['share', 'pace']])],
      goals: [{ ...goal('done', 'coverage', '>=', 'whole', 'end', 'weeks', 'over six weeks'), measure: { ...goal('done', 'coverage', '>=', 'whole', 'end', 'weeks', 'x').measure!, measure_by: 'olumi' } }],
      options: [olumiOption('even', 'Even split', 50), olumiOption('baking_led', 'Baking-led split', 80)],
    });
    const r = compile(division, { asksNeedQuestions: true });
    expect(codes(r)).toEqual([]);
    expect(r.blockers.filter((b) => b.code === 'asked')).toEqual([]);
    expect(r.executable).not.toBeNull();
    // Contrast (the AMEND's draft 1): the same lever asked with no question is refused on a first draft.
    expect(compile(withQ(division, 'share', { author: 'person', status: 'asked', value: null, basis: null }), { asksNeedQuestions: true }).errors.map((e) => [e.code, e.items]))
      .toEqual([['asked_no_question', ['share']]]);
  });
});
