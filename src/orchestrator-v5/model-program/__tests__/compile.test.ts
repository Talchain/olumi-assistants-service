/**
 * Spike S1 rows: the canonical model's compiler and display projection. Synthetic situations only (a bakery, a gym):
 * never a test brief's words. Each row binds by identity (ids, codes, exact executable shapes), with a contrast control
 * beside every absence claim.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod-v4';
import { CanonicalModel, type CanonicalModelT, type CanonicalQuantityT, type CanonicalRelationT, type CanonicalGoalT, type CanonicalLimitT } from '../canonical.js';
import { compile, compileJson, NO_GOAL_QUESTION } from '../compile.js';
import { project } from '../project.js';
import { fillQuantity } from '../answer.js';
import { parseUnit, sameDims } from '../units.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

// ── builders ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = { party: null, approval: 'proposed' as const, author_id: null };
const qty = (id: string, unit: string, f: Partial<CanonicalQuantityT>): CanonicalQuantityT => ({
  id, label: id.replace(/_/g, ' '), unit, kind: 'fact', value: null, low: null, high: null, status: 'known', question: null, basis: null, author: 'person', quote: null, ...base, ...f,
});
const person = (id: string, unit: string, value: number, quote: string) => qty(id, unit, { value, quote });
const structure = (id: string, unit: string, value: number, basis: string) => qty(id, unit, { value, author: 'structure', basis });
const olumi = (id: string, unit: string, low: number, high: number, value: number | null = null) =>
  qty(id, unit, { kind: 'coefficient', value, low, high, status: 'estimated', author: 'olumi', basis: 'Typical for a small business of this kind.' });
type SetT = CanonicalModelT['options'][number]['sets'][number];
const set = (quantity: string, to: string | null, quote: string, f: Partial<SetT> = {}): SetT =>
  ({ quantity, to, value: null, low: null, high: null, question: null, from_period: 0, author: 'person', quote, ...f });
const option = (id: string, label: string, sets: SetT[], quote: string): CanonicalModelT['options'][number] =>
  ({ id, label, sets, status: 'live', developed_from: null, author: 'person', quote, ...base });
const asked = (id: string, unit: string, question: string) => qty(id, unit, { status: 'asked', question });
const derived = (id: string, unit: string) => qty(id, unit, { status: 'derived' });
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
const xq = (r: ReturnType<typeof compile>) => new Map(r.executable!.quantities.map((q) => [q.id, q]));

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
const gymFilled = () => { const f = fillQuantity(gym(), 'leavers', { value: 20 }, 'about 20 leave a month'); if (!f.ok) throw new Error(f.reason); return f.model; };

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
    expect(q.get('extra_per_oven')!.dist).toEqual({ kind: 'range', low: 80, high: 150, mode: 120, basis: 'olumi_estimate' });
    expect(q.get('price')!.dist).toEqual({ kind: 'fixed', value: 3, author: 'person' });
    expect(r.conversions).toEqual([{ kind: 'range_law', quantity: 'extra_per_oven', low: 80, high: 150, reading: { kind: 'normal', centre: 120, sd: 70 / Math.sqrt(12) }, author: 'olumi', provisional: true }]);
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
    expect(r.asks).toEqual([{ quantity_id: 'leavers', label: 'leavers', unit: 'member/month', question: 'How many members leave in a typical month?', feeds: ['reach_400'], cancels_out_of: [], edit: { op: 'fill_quantity', quantity_id: 'leavers' } }]);
    // Gold gap 2: what the run leaves out is echoed on the executable model and in coverage.
    expect(r.executable!.withheld).toEqual([expect.objectContaining({ id: 'reach_400', kind: 'goal', label: 'reach 400' })]);
    expect(r.executable!.withheld[0].reason).toContain('How many members leave');
    expect(r.coverage.covers).toEqual(['class income']);

    const r2 = compile(gymFilled());
    expect(r2.errors).toEqual([]);
    expect(r2.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(r2.executable!.goals.map((x) => x.id)).toEqual(['reach_400', 'class_income']);
    expect(r2.joint.status).toBe('calculable');
    expect(gymFilled().history).toHaveLength(1);
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
    expect(r2.coaching).toEqual([{ record_id: 'regulars_happy', kind: 'measure', question: 'How would you tell the regulars are happy: repeat visits a week?' }]);
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
    m.quantities = m.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, low: null, high: null } : q));
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
    expect(r.coaching).toEqual([{ record_id: '(model)', kind: 'measure', question: NO_GOAL_QUESTION }]);
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
    expect(compile(hiding).errors.map((e) => [e.code, e.items])).toEqual([['structure_value', ['costs']]]);
  });

  it('phase 0b fix 2: an ask that CANCELS OUT of a goal (checked numerically) is not asked for it, and stays asked where it matters', () => {
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
    expect(g.more_loaves).toMatchObject({ status: 'calculable', asks: [], cancelled: ['loaves_per_baker'] });
    expect(g.five_thousand).toMatchObject({ status: 'asks', asks: ['loaves_per_baker'], cancelled: [] }); // contrast: a level needs it
    expect(r.asks).toEqual([expect.objectContaining({ quantity_id: 'loaves_per_baker', feeds: ['five_thousand'], cancels_out_of: ['more_loaves'] })]);
    expect(r.executable!.goals.map((x) => x.id)).toEqual(['more_loaves']);
    expect(xq(r).get('loaves_per_baker')!.dist).toEqual({ kind: 'fixed', value: 1, author: 'placeholder' });
    // Alone, the cancelling ask is never asked at all.
    expect(compile(team([growth])).asks).toEqual([]);
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
    m.options = m.options.map((o) => (o.id === 'promo' ? { ...o, sets: [set('joins', 'promo_joins', 'a promotion could bring 40 a month', { from_period: 'opening_month' })] } : o));
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
    // Uncertain timing waits on the PL's range-law ruling: the option is withheld with that reason, the rest still compares.
    const unsure = structuredClone(m);
    unsure.quantities = unsure.quantities.map((q) => (q.id === 'opening_month' ? { ...q, value: null, low: 1, high: 4 } : q));
    const ru = compile(unsure);
    expect(ru.perOption.find((o) => o.option_id === 'promo')).toMatchObject({ status: 'withheld' });
    expect(ru.perOption.find((o) => o.option_id === 'promo')!.reasons.join(' ')).toContain('range-law ruling');
    expect(ru.executable!.options.map((o) => o.id)).toEqual(['carry_on']);
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
    const filled = fillQuantity(open, 'raise_price__price', { value: 3.5 }, '£3.50');
    expect(filled.ok && compile(filled.model).executable!.options.map((o) => o.id)).toEqual(['buy_oven', 'keep_one', 'raise_price']);
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
    expect(rm.coaching).toEqual([{ record_id: 'cash_buffer', kind: 'deadline', question: 'By when should this be met?' }]);
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

  it('DL ruling 1: the compiler sets each reading: an inflow and what an option changes from a later period are flows; states stay states', () => {
    const withPrice = (from: number) => {
      const m = gymFilled();
      m.quantities.push(person('dearer_class', 'GBP/attendance', 9, '£9 a class from the autumn'));
      m.options.push(option('dearer', 'Charge £9 a class', [set('class_price', 'dearer_class', '£9 a class from the autumn', { from_period: from })], 'charge £9 a class'));
      return Object.fromEntries(compile(m).executable!.quantities.map((q) => [q.id, q.reading]));
    };
    expect(withPrice(3)).toMatchObject({ members: 'state', members_now: 'state', joins: 'flow', leavers: 'flow', class_price: 'flow', class_revenue: 'flow', attendances: 'state' });
    expect(withPrice(0)).toMatchObject({ class_price: 'state', class_revenue: 'state', joins: 'flow' });
  });

  it('DL ruling 4: a bare range the ruled law cannot use is HELD (withholds what rests on it); a usable one is read; a most likely figure at an end is an error', () => {
    const withCosts = (f: Partial<CanonicalQuantityT>) => { const m = bakery(); m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, ...f } : q)); return compile(m); };
    const heldR = withCosts({ low: 0, high: 1200 });
    expect(heldR.errors).toEqual([]);
    expect(heldR.perGoal.map((p) => p.status)).toEqual(['withheld', 'withheld']);
    expect(heldR.perGoal[0].reasons.join(' ')).toContain('the range 0 to 1200 has no most likely value');
    expect(heldR.executable).toBeNull();
    const usable = withCosts({ low: 500, high: 700 });
    expect(usable.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(usable.conversions).toContainEqual({ kind: 'range_law', quantity: 'costs', low: 500, high: 700, reading: { kind: 'normal', centre: 600, sd: 200 / Math.sqrt(12) }, author: 'olumi', provisional: true });
    expect(xq(usable).get('costs')!.dist).toEqual({ kind: 'range', low: 500, high: 700, basis: 'person_range' });
    const atEnd = withCosts({ value: 500, low: 500, high: 700 });
    expect(atEnd.errors.map((e) => [e.code, e.items])).toEqual([['range_order', ['costs']]]);
    expect(atEnd.errors[0].message).toContain('at an end of its range');
    const m = bakery(); m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, low: 500, high: 700 } : q));
    expect(project(m).graph.nodes.find((n) => n.id === 'costs')!.display_value).toBe('500–700 GBP/week; Olumi reads it as a spread around 600 (sd 57.74), provisionally');
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
    expect(project(bakery()).items.find((i) => i.record_id === 'extra_per_oven')!.law).toEqual({ author: 'olumi', provisional: true, reading: { kind: 'normal', centre: 120, sd: 70 / Math.sqrt(12) } });
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
});
