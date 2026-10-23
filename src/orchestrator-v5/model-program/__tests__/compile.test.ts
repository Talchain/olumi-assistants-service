/**
 * Spike S1 rows: the canonical model's compiler and display projection. Synthetic situations only (a bakery, a gym):
 * never a test brief's words. Each row binds by identity (ids, codes, exact executable shapes), with a contrast control
 * beside every absence claim.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod-v4';
import { CanonicalModel, type CanonicalModelT, type CanonicalQuantityT, type CanonicalRelationT, type CanonicalGoalT } from '../canonical.js';
import { compile, compileJson } from '../compile.js';
import { project } from '../project.js';
import { fillQuantity } from '../answer.js';
import { parseUnit, sameDims } from '../units.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

// ── builders ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = { party: null, approval: 'proposed' as const };
const qty = (id: string, unit: string, f: Partial<CanonicalQuantityT>): CanonicalQuantityT => ({
  id, label: id.replace(/_/g, ' '), unit, value: null, low: null, high: null, status: 'known', question: null, basis: null, author: 'person', quote: null, ...base, ...f,
});
const person = (id: string, unit: string, value: number, quote: string) => qty(id, unit, { value, quote });
const olumi = (id: string, unit: string, low: number, high: number, value: number | null = null) =>
  qty(id, unit, { value, low, high, status: 'estimated', author: 'olumi', basis: 'Typical for a small business of this kind.' });
const asked = (id: string, unit: string, question: string) => qty(id, unit, { status: 'asked', question });
const derived = (id: string, unit: string) => qty(id, unit, { status: 'derived' });
const who = (quote: string | null) => (quote === null ? { author: 'olumi' as const, quote: null } : { author: 'person' as const, quote });
const def = (id: string, defines: string, op: 'sum' | 'difference' | 'product' | 'ratio', parts: string[], quote: string | null = null): CanonicalRelationT =>
  ({ form: 'definition', id, defines, op, parts, ...base, ...who(quote) });
const eff = (id: string, defines: string, b: string, terms: [string, string][], quote: string | null = null): CanonicalRelationT =>
  ({ form: 'effect', id, defines, base: b, terms: terms.map(([driver, coefficient]) => ({ driver, coefficient, ...base, ...who(quote) })), ...base, ...who(quote) });
const stock = (id: string, defines: string, start: string, inflows: string[], outflows: string[], quote: string | null = null): CanonicalRelationT =>
  ({ form: 'stock', id, defines, start, inflows, outflows, ...base, ...who(quote) });
const goal = (id: string, quantity: string, cmp: '>=' | '<=' | '>' | '<', target: string, aggregation: 'end' | 'sum' | 'mean' | 'every', periods: string, quote: string): CanonicalGoalT => ({
  id, label: id.replace(/_/g, ' '), measure: { quantity, cmp, target, aggregation, window: { origin_event: null, origin_offset: null, start: 0, periods }, measure_by: 'person' },
  question: null, author: 'person', quote, ...base,
});
const model = (over: Partial<CanonicalModelT>): CanonicalModelT => ({
  version: 'canonical.v1', question: 'Should the bakery buy a second oven?', period: 'week',
  quantities: [], relations: [], goals: [], limits: [], options: [], risks: [],
  claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [], ...over,
});
const codes = (r: ReturnType<typeof compile>) => r.errors.map((e) => e.code);

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
    options: [
      { id: 'buy_oven', label: 'Buy a second oven', sets: [{ quantity: 'ovens_added', to: 'one_oven', from_period: 0, author: 'person', quote: 'A second oven' }], status: 'live', developed_from: null, author: 'person', quote: 'Buy it', ...base },
      { id: 'keep_one', label: 'Keep one oven', sets: [], status: 'live', developed_from: null, author: 'person', quote: 'keep one oven', ...base },
    ],
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
    relations: [
      stock('members_rel', 'members', 'members_now', ['joins'], ['leavers']),
      def('revenue_rel', 'class_revenue', 'product', ['class_price', 'attendances']),
    ],
    goals: [
      goal('reach_400', 'members', '>=', 'member_target', 'end', 'half_year', 'reach 400 members'),
      goal('class_income', 'class_revenue', '>=', 'revenue_floor', 'every', 'half_year', 'at least £3,000 a month from classes'),
    ],
    options: [
      { id: 'promo', label: 'Run a summer promotion', sets: [{ quantity: 'joins', to: 'promo_joins', from_period: 0, author: 'person', quote: 'a promotion could bring 40 a month' }], status: 'live', developed_from: null, author: 'person', quote: 'run a summer promotion', ...base },
      { id: 'carry_on', label: 'Carry on as now', sets: [], status: 'live', developed_from: null, author: 'person', quote: 'carry on as now', ...base },
    ],
  });
}

describe('spike S1: the canonical model compiles to the executable model', () => {
  it('row 1: a definition, an effect and a stock compile, with exact executable shapes', () => {
    const r = compile(bakery());
    expect(r.errors).toEqual([]);
    const x = r.executable!;
    expect(x.periods).toBe(13);
    expect(x.period_unit).toBe('week');
    const byId = new Map(x.quantities.map((q) => [q.id, q]));
    expect(byId.get('sales')).toEqual({ id: 'sales', unit: 'loaf/week', equation: { form: 'effect', base: 'base_sales', terms: [{ coefficient: 'extra_per_oven', driver: 'ovens_added' }] } });
    expect(byId.get('profit')).toEqual({ id: 'profit', unit: 'GBP/week', equation: { form: 'definition', op: 'difference', parts: ['takings', 'costs'] } });
    expect(byId.get('cash')).toEqual({ id: 'cash', unit: 'GBP', stock: { start: 'cash_now', inflows: ['profit'], outflows: [] } });
    expect(byId.get('extra_per_oven')!.dist).toEqual({ kind: 'range', low: 80, high: 150, mode: 120, basis: 'olumi_estimate' });
    expect(byId.get('price')!.dist).toEqual({ kind: 'fixed', value: 3 });
    // The window's length is consumed into the window, never simulated as a quantity.
    expect(byId.has('quarter')).toBe(false);
    expect(x.goals).toEqual([
      { id: 'weekly_profit', quantity: 'profit', cmp: '>', target: 'profit_target', aggregation: 'end', window: { start_period: 0, periods: 13 } },
      { id: 'cash_buffer', quantity: 'cash', cmp: '>=', target: 'cash_target', aggregation: 'end', window: { start_period: 0, periods: 13 } },
    ]);
    expect(x.options.map((o) => o.id)).toEqual(['buy_oven', 'keep_one']);
    expect(x.options[0].sets).toEqual([{ quantity: 'ovens_added', to: 'one_oven', from_period: 0 }]);
    expect(r.perGoal.map((p) => [p.goal_id, p.status])).toEqual([['weekly_profit', 'calculable'], ['cash_buffer', 'calculable']]);
    // Olumi's estimate and Olumi's unquoted relations are named as what the result rests on.
    expect(r.perGoal[0].olumi_inputs).toEqual(expect.arrayContaining(['extra_per_oven', 'sales_rel', 'sales_rel:ovens_added', 'takings_rel']));
    expect(r.perGoal[0].olumi_inputs).not.toContain('profit_rel');
  });

  it('row 2: a missing person-only figure asks; only the goal it feeds waits, the other still calculates; answering it unlocks it', () => {
    const r = compile(gym());
    expect(r.errors).toEqual([]);
    const g = Object.fromEntries(r.perGoal.map((p) => [p.goal_id, p]));
    expect(g.reach_400.status).toBe('asks');
    expect(g.reach_400.asks).toEqual(['leavers']);
    expect(g.class_income.status).toBe('calculable');
    expect(g.class_income.asks).toEqual([]);
    expect(r.executable!.goals.map((x) => x.id)).toEqual(['class_income']);
    expect(r.executable!.quantities.map((q) => q.id)).not.toContain('leavers');
    expect(r.executable!.quantities.map((q) => q.id)).toContain('class_revenue');
    // The joint never stands for a partial subset of the measured goals.
    expect(r.joint).toMatchObject({ status: 'asks', goal_ids: ['reach_400', 'class_income'], asks: ['leavers'] });
    expect(r.asks).toEqual([{ quantity_id: 'leavers', label: 'leavers', unit: 'member/month', question: 'How many members leave in a typical month?', feeds: ['reach_400'], edit: { op: 'fill_quantity', quantity_id: 'leavers' } }]);

    const filled = fillQuantity(gym(), 'leavers', { value: 20 }, 'about 20 leave a month');
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    const r2 = compile(filled.model);
    expect(r2.errors).toEqual([]);
    expect(r2.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(r2.executable!.goals.map((x) => x.id)).toEqual(['reach_400', 'class_income']);
    expect(r2.joint.status).toBe('calculable');
    expect(filled.model.history).toHaveLength(1);
    expect(filled.model.quantities.find((q) => q.id === 'leavers')).toMatchObject({ status: 'known', author: 'person', approval: 'approved', value: 20 });
  });

  it('row 3: a unit mismatch is one plain error naming the items; the executable is withheld', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, unit: 'GBP/month' } : q));
    const r = compile(m);
    expect(r.executable).toBeNull();
    const e = r.errors.find((x) => x.code === 'unit_mismatch')!;
    expect(e.items).toEqual(['profit_rel', 'costs', 'profit']);
    expect(e.message).toBe('The relation "profit_rel" for "profit" (profit) is a difference, but part "costs" (costs) is gbp/month while "profit" (profit) is gbp/week; the parts of a difference share one unit.');
    // Contrast: the same model with the unit as stated compiles.
    expect(compile(bakery()).errors).toEqual([]);
  });

  it('row 4: a cycle not through a stock is an error; the same loop through a stock compiles', () => {
    const loop = model({
      period: 'month',
      quantities: [derived('takings', 'GBP/month'), derived('tips', 'GBP/month'), person('tip_rate', '1', 0.1, 'tips are about a tenth'), person('menu', 'GBP/month', 5000, '£5,000 of food a month'), person('takings_target', 'GBP/month', 6000, 'reach £6,000'), person('months', 'month', 3, 'in three months')],
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
    expect(s.executable!.quantities.find((q) => q.id === 'members')!.stock).toEqual({ start: 'members_now', inflows: ['referrals'], outflows: [] });
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
    // Every record appears in the manifest exactly once; the display graph is a valid GraphV3.
    const recordIds = [...m.quantities, ...m.relations, ...m.goals, ...m.options, ...m.assumptions, ...m.dissent].map((x) => x.id);
    for (const id of recordIds) expect(p.items.filter((i) => i.record_id === id)).toHaveLength(1);
    const parsed = GraphV3.safeParse(p.graph);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.nodes.map((n) => n.id)).toEqual(p.graph.nodes.map((n) => n.id));
    // The coefficient is drawn on its link, with its natural size and Olumi's authorship.
    expect(p.items.find((i) => i.record_id === 'extra_per_oven')!.shown_as).toEqual({ on_edge: 'ovens_added__sales' });
    expect(p.graph.edges.find((e) => e.id === 'ovens_added__sales')).toMatchObject({ provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 120, amount_unit: 'loaf/week', per_source_change_unit: 'oven' } } });
  });

  it('row 7: an Olumi figure without a range is an error; an exact calendar conversion is the one exception', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, low: null, high: null } : q));
    const r = compile(m);
    expect(r.executable).toBeNull();
    expect(r.errors.map((e) => [e.code, e.items])).toEqual([['olumi_no_range', ['extra_per_oven']]]);

    const known = bakery();
    known.quantities = known.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, status: 'known' as const, low: null, high: null } : q));
    expect(codes(compile(known))).toEqual(['olumi_no_range']);

    const conversion = bakery();
    conversion.quantities.push(qty('weeks_per_year', 'week/year', { value: 52, author: 'olumi', status: 'known', basis: 'A year has 52 weeks.' }));
    expect(compile(conversion).errors).toEqual([]);
  });

  it('phase 0 lesson: no goal but limits → one error that keeps limits as limits, and no cascade of reach errors', () => {
    const m = bakery();
    m.limits.push({ id: 'spend_cap', label: 'Spend no more than £600 a week', quantity: 'costs', cmp: '<=', bound: 'costs', aggregation: 'every', window: { origin_event: null, origin_offset: null, start: 0, periods: 'quarter' }, author: 'person', quote: 'costs £600 a week', ...base });
    m.goals = [];
    const r = compile(m);
    expect(codes(r)).toEqual(['no_goal']);
    expect(r.errors[0].message).toContain('The 1 limit(s) here stay limits: never copy them into goals.');
    expect(r.errors[0].message).toContain('add their aim with measure null');
  });

  it('phase 0 lesson: a condition that is both a goal and a limit is an error; a different limit on the same quantity is not', () => {
    const m = bakery();
    m.limits.push({ id: 'profit_limit', label: 'Profit over £900', quantity: 'profit', cmp: '>', bound: 'profit_target', aggregation: 'every', window: { origin_event: null, origin_offset: null, start: 0, periods: 'quarter' }, author: 'person', quote: 'over £900', ...base });
    expect(compile(m).errors.map((e) => [e.code, e.items])).toEqual([['goal_and_limit', ['weekly_profit', 'profit_limit']]]);

    const ok = bakery();
    ok.quantities.push(person('zero_profit', 'GBP/week', 0, 'never make a loss'));
    ok.limits.push({ id: 'no_loss', label: 'Never make a loss', quantity: 'profit', cmp: '>=', bound: 'zero_profit', aggregation: 'every', window: { origin_event: null, origin_offset: null, start: 0, periods: 'quarter' }, author: 'person', quote: 'never make a loss', ...base });
    const r = compile(ok);
    expect(r.errors).toEqual([]);
    expect(r.executable!.limits.map((l) => l.id)).toEqual(['no_loss']);
  });

  it('phase 0 lesson: a quote not in the person\'s words is UNVERIFIED (a typed outcome, not an error) and never drawn as theirs', () => {
    const m = bakery();
    const brief = 'We sell 400 loaves a week at £3 and costs £600 a week. A second oven? Buy it or keep one oven. Weekly profit over £900 within 3 months, and at least £10,000 in the bank. We have £2,000 in the bank.';
    m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, quote: 'costs are £650 a week' } : q));
    const r = compile(m, { sourceText: brief });
    expect(r.errors).toEqual([]);
    expect(r.unverified).toContainEqual({ id: 'costs', quote: 'costs are £650 a week' });
    expect(r.unverified.map((u) => u.id)).not.toContain('price'); // contrast: a verbatim quote stays the person's
    expect(r.perGoal[0].unverified_inputs).toContain('costs');
    const p = project(m, r);
    const costs = p.graph.nodes.find((n) => n.id === 'costs')!;
    expect(costs.provenance).toBe('unverified_brief');
    expect(costs).not.toHaveProperty('source_quote');
    expect(p.graph.nodes.find((n) => n.id === 'base_sales')).toMatchObject({ provenance: 'from_brief', source_quote: 'We sell 400 loaves a week' });
  });

  it('% figures become fractions explicitly, and a % chance is checked on its fraction', () => {
    const m = gym();
    m.quantities = m.quantities.map((q) => (q.id === 'leavers' ? derived('leavers', 'member/month') : q));
    m.quantities.push(person('churn', '%/month', 5, '5% leave each month'));
    m.relations.push(def('leavers_rel', 'leavers', 'product', ['members', 'churn']));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.executable!.quantities.find((q) => q.id === 'churn')).toEqual({ id: 'churn', unit: '1/month', dist: { kind: 'fixed', value: 0.05 } });
    expect(r.conversions).toEqual([{ quantity: 'churn', from: '%/month', to: '1/month', factor: 0.01 }]);
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

  it('units: coefficient × driver makes the defined unit; plural and singular agree; multipliers are refused', () => {
    const u = (s: string) => { const p = parseUnit(s); if (!p.ok) throw new Error(p.message); return p.unit; };
    expect(sameDims(u('loaves per week'), u('loaf/week'))).toBe(true);
    expect(sameDims(u('£/member/month'), u('GBP per member per month'))).toBe(true);
    expect(sameDims(u('GBP'), u('USD'))).toBe(false);
    expect(parseUnit('£k').ok).toBe(false);
    expect(u('%').scale).toBe(0.01);
  });
});
