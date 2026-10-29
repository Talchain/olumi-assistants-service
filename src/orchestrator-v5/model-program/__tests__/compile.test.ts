/**
 * Spike S1 rows: the canonical model's compiler and display projection. Synthetic situations only (a bakery, a gym):
 * never a test brief's words. Each row binds by identity (ids, codes, exact executable shapes), with a contrast control
 * beside every absence claim.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod-v4';
import { APPROXIMATE_FIGURE, CanonicalModel, type CanonicalModelT, type CanonicalQuantityT, type CanonicalRelationT, type CanonicalGoalT, type CanonicalLimitT } from '../canonical.js';
import { compile, compileJson, normalise } from '../compile.js';
import { project } from '../project.js';
import { probeValue } from './probe.js';
import { parseUnit, sameDims } from '../units.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';

type Edges = { readonly edges: readonly Record<string, unknown>[] };
/** W3b: what a strict GraphV3 reader objects to, as [link id, field], sorted; anything not on a link keeps its full path. */
const strictObjections = (graph: Edges): string[][] => {
  const r = GraphV3.safeParse(graph);
  return (r.success ? [] : r.error.issues.map((i) => (i.path[0] === 'edges' && i.path.length === 3 ? [String(graph.edges[i.path[1] as number]!['id']), String(i.path[2])] : [i.path.join('.'), i.message]))).sort();
};
/** A program link carries no strength (the model holds no β), and one with no sign in the model no direction: those fields, sorted. */
const linkFieldsAbsent = (graph: Edges): string[][] => graph.edges.flatMap((e) => [[String(e['id']), 'strength'], ...('effect_direction' in e ? [] : [[String(e['id']), 'effect_direction']])]).sort();
import { exactInitialValues, simulate } from '../simulate/simulate.js';
import { isWithheld } from '../simulate/result.js';
import { STARTS_AFTER_PERIODS, withDeclaredTiming } from '../canonical.js';
import { CANONICAL_JSON_SCHEMA } from '../../model-program-turn/prompt.js';
import { revisionDigest } from '../../model-program-turn/run-receipt.js';
import { evaluateCanonical } from '../../model-program-turn/evaluate.js';

// ── builders ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = { party: null, approval: 'proposed' as const, approved_by: null, author_id: null };
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
  ({ id, label, sets, status: 'live', developed_from: null, carry_on: false, author: 'person', quote, ...base });
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
  claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [], title: null, coaching_questions: [], ...over,
});
const codes = (r: ReturnType<typeof compile>) => r.errors.map((e) => e.code);
/**
 * The shared law's reading of an unbounded plausible range (W10, interim, adopted behaviour; before it, rangeSpread's Normal
 * with sd (high − low)/√12): halves σL = (m − low)/Φ⁻¹(0.9) and σH = (high − m)/Φ⁻¹(0.9), Φ⁻¹(0.9) = 1.2815516, each half
 * ½ of the draws; mean m + (σH − σL)/√(2π) and sd √(½(σL² + σH²) − (σH − σL)²/2π), equal to the conditioned moments
 * (unbounded). Each row's figures are worked out by hand beside it.
 */
const unbounded = (centre: number, below: number, above: number, mean: number, sd: number) => ({ kind: 'normal', ends: 'p10_p90', centre,
  sd_below: expect.closeTo(below, 4), sd_above: expect.closeTo(above, 4), edge_below: false, edge_above: false, share_below: 0.5,
  sd: expect.closeTo(sd, 4), lower: -Infinity, upper: Infinity, mean: expect.closeTo(mean, 4), sd_conditioned: expect.closeTo(sd, 4) });
/** Olumi's extra loaves per oven, 80 to 150 around 120: σL = 40/1.2815516 = 31.21217, σH = 30/1.2815516 = 23.40912; mean =
 *  120 − 7.80304/2.50663 = 116.88704; sd = √(½ × (974.1990 + 547.9871) − 60.8875/6.28319) = √751.4025 = 27.41172. */
const EXTRA_PER_OVEN = unbounded(120, 31.21217, 23.40912, 116.88704, 27.41172);
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
    expect(r.conversions).toEqual([{ kind: 'range_law', quantity: 'extra_per_oven', low: 80, high: 150, range_kind: 'plausible', domain: null, reading: EXTRA_PER_OVEN, author: 'olumi', provisional: true }]);
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

  it('integrated review 26 Oct: an applied assumption on a risk is a premise of the result the risk reaches, so the basis names it', () => {
    const m = bakery();
    m.quantities.push(olumi('breakdown_chance', '1', 0.05, 0.2), olumi('lost_loaves', 'loaf/week', -150, -50, -100));
    m.risks.push({ id: 'breakdown', label: 'The oven breaks down', occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', direction: 'unknown', mode: 'add', starts_after_periods: 4, author: 'olumi', quote: null, ...base });
    m.assumptions.push({ id: 'repaired_in_a_week', text: 'A breakdown is repaired within a week.', applied: true, concerns: ['breakdown'], author: 'olumi', quote: null, ...base },
      // Contrast: a noted assumption on the same risk is never a premise.
      { id: 'parts_in_stock', text: 'Spare parts are usually in stock.', applied: false, concerns: ['breakdown'], author: 'olumi', quote: null, ...base });
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.perGoal[0].rests_on).toEqual(['repaired_in_a_week']);
  });

  it('row 6: qualitative records are never in the executable model, and not cards: the canvas draws them by id from the model (DL 24 Oct)', () => {
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
    expect(p.graph.nodes.find((n) => n.id === 'oven_full_speed')).toBeUndefined();
    expect(p.graph.nodes.find((n) => n.id === 'partner_doubts')).toBeUndefined();
    expect(node('profit')).toMatchObject({ kind: 'outcome', analysis_participation: 'included' });
    expect(p.items.find((i) => i.record_id === 'partner_doubts')).toMatchObject({ shown_as: {}, in_calculation: false, concerns: ['sales_rel'], author: 'person' });
    expect(m.dissent.find((d) => d.id === 'partner_doubts')).toMatchObject({ quote: 'my business partner thinks demand will not keep up' });
    const recordIds = [...m.quantities, ...m.relations, ...m.goals, ...m.options, ...m.assumptions, ...m.dissent].map((x) => x.id);
    for (const id of recordIds) expect(p.items.filter((i) => i.record_id === id)).toHaveLength(1);
    // Every node passes the strict reader whole; a strict reader's only objections are the links' absent strength (W3b).
    const nodes = GraphV3.shape.nodes.safeParse(p.graph.nodes);
    expect(nodes.success && nodes.data.map((n) => n.id)).toEqual(p.graph.nodes.map((n) => n.id));
    expect(strictObjections(p.graph)).toEqual(linkFieldsAbsent(p.graph));
    expect(GraphStateIngressSchema.safeParse(p.graph).success).toBe(true);
    expect(p.items.find((i) => i.record_id === 'extra_per_oven')!.shown_as).toEqual({ on_edge: 'ovens_added__sales' });
    expect(p.graph.edges.find((e) => e.id === 'ovens_added__sales')).toMatchObject({ provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 120, amount_unit: 'loaf/week', per_source_change_unit: 'oven' } } });
  });

  it('W3 (26 Oct): claims and conditions are not cards: no node, no "Claim:" or "Condition:" card; the canonical record still holds each, whole', () => {
    const m = bakery();
    m.claims.push({ id: 'busy_saturdays', text: 'Saturdays are the busy day.', concerns: ['sales'], author: 'olumi', quote: null, ...base });
    m.conditions.push({ id: 'landlord_agrees', text: 'Only once the landlord agrees to the wiring.', kind: 'prerequisite', concerns: ['ovens_added'], author: 'person', quote: 'once the landlord agrees', ...base });
    // Same kind, expected PRESENT: a guardrail with no measure yet is still its own text card (limits are unchanged).
    m.limits.push({ id: 'keep_staff', label: 'Keep the staff we have', measure: null, question: 'How would you know?', author: 'person', quote: 'keep the staff we have', ...base });
    const before = structuredClone(m);
    const p = project(m, compile(m));
    const notes = ['busy_saturdays', 'landlord_agrees'];
    expect(p.graph.nodes.filter((n) => notes.includes(String(n.id)))).toEqual([]);
    expect(p.graph.nodes.filter((n) => /^(Claim|Condition): /.test(String(n.label)))).toEqual([]);
    expect(p.graph.nodes.filter((n) => n.kind === 'action').map((n) => [n.id, n.label])).toEqual([['mp:limit:keep_staff', 'Limit: Keep the staff we have']]);
    expect(p.graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['profit', 'sales', 'base_sales']));
    expect(GraphV3.shape.nodes.safeParse(p.graph.nodes).success).toBe(true);
    expect(strictObjections(p.graph)).toEqual(linkFieldsAbsent(p.graph));
    expect(GraphStateIngressSchema.safeParse(p.graph).success).toBe(true);
    // The canonical record is the notes' home: untouched by the projection, every word kept, by the record's own id.
    expect(m).toEqual(before);
    expect(m.claims).toEqual([expect.objectContaining({ id: 'busy_saturdays', text: 'Saturdays are the busy day.', concerns: ['sales'], author: 'olumi' })]);
    expect(m.conditions).toEqual([expect.objectContaining({ id: 'landlord_agrees', text: 'Only once the landlord agrees to the wiring.', kind: 'prerequisite', concerns: ['ovens_added'], quote: 'once the landlord agrees' })]);
    // Each keeps its one item, out of the calculation, with no drawn place: the canvas draws it from the model by id.
    expect(p.items.filter((i) => notes.includes(i.record_id))).toEqual([
      expect.objectContaining({ record_id: 'busy_saturdays', family: 'claims', shown_as: {}, in_calculation: false, concerns: ['sales'], author: 'olumi' }),
      expect.objectContaining({ record_id: 'landlord_agrees', family: 'conditions', shown_as: {}, in_calculation: false, concerns: ['ovens_added'], author: 'person' }),
    ]);
  });

  // Two saved drafts from the real path (model-program-turn's fixtures), never this file's own words.
  const savedDraft = (file: string) => {
    const s = JSON.parse(readFileSync(new URL(`../../model-program-turn/__tests__/${file}`, import.meta.url), 'utf8')) as { brief: string; canonical: unknown };
    const m = CanonicalModel.parse(withDeclaredTiming(s.canonical));
    return project(m, compile(m, { sourceText: s.brief }), { brief: s.brief });
  };
  const NOTE_FAMILIES = new Set(['claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'left_out', 'preference']);

  it('W3 (26 Oct), a saved draft with nine notes: none is a card; its unmeasured limit still is; each note keeps its one item', () => {
    const p = savedDraft('hiring-alpha3.saved.json');
    const notes = p.items.filter((i) => NOTE_FAMILIES.has(i.family));
    expect(notes.map((i) => [i.record_id, i.family, i.shown_as])).toEqual([
      ['prefer_lower_spend', 'preference', {}], ['leadership_gap', 'claims', {}], ['budget_cost_scope', 'assumptions', {}],
      ['hiring_decision_not_start_date', 'assumptions', {}], ['productivity_mechanism_unresolved', 'left_out', {}],
      ['launch_readiness_not_calculated', 'left_out', {}], ['hiring_and_onboarding_timing', 'left_out', {}],
      ['code_quality_not_calculated', 'left_out', {}], ['productivity_target_timing', 'left_out', {}],
    ]);
    expect(p.graph.nodes.filter((n) => notes.some((i) => i.record_id === n.id))).toEqual([]);
    expect(p.graph.nodes.filter((n) => n.kind === 'action').map((n) => n.id)).toEqual(['mp:limit:maintain_code_quality']);
    // Q1 (Paul, 28 Oct: the situation, not the arithmetic): the two hiring levers are said on their option cards (16 → 14).
    // DET-HARM D185/D186 (28 Oct): only the tech-lead hire is an off/on switch (0 to 1); two developers (0 to 2) multiply the
    // per-developer size, so "Developers hired" keeps its card (14 → 15). Changed knowingly.
    expect(p.graph.nodes).toHaveLength(15);
  });

  it('W3 contrast (26 Oct), a saved draft with no notes has no text card; its cards in order (Q1, 28 Oct: its total and zero are said on the goal)', () => {
    const p = savedDraft('capacity-s4.saved.json');
    expect(p.items.filter((i) => NOTE_FAMILIES.has(i.family))).toEqual([]);
    // The cards staging drew for this draft before W3 (13e6bd5d), bound as literals: a note-less model is untouched.
    expect(p.graph.nodes.map((n) => [n.id, n.kind])).toEqual([
      ['mp:decision', 'decision'], ['support_capacity_goal', 'goal'], ['keep_current_staffing', 'option'], ['add_one_specialist', 'option'],
      ['existing_capacity', 'factor'], ['additional_specialists', 'factor'], ['weekly_support_capacity', 'outcome'],
    ]);
    // Q1 (Paul, 28 Oct): Olumi's total and its structural zero are said in the goal's workings, never their own cards.
    expect(['zero_additional_capacity', 'additional_capacity'].map((id) => p.items.find((i) => i.record_id === id)!.shown_as))
      .toEqual([{ on_node: 'support_capacity_goal' }, { on_node: 'support_capacity_goal' }]);
  });

  it('S1 strip (B8, B10 off): an Olumi figure without a range is no error: it calculates as Olumi\'s exact figure, as written', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, low: null, high: null, range_kind: null } : q));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(xq(r).get('extra_per_oven')!.dist).toEqual({ kind: 'fixed', value: 120, author: 'olumi' });
    const known = bakery();
    known.quantities.push(qty('weeks_per_year', 'week/year', { value: 52, author: 'olumi', status: 'known', basis: 'A year has 52 weeks.' }));
    expect(codes(compile(known))).toEqual([]);
    // Contrast (MATHS, kept): an estimate with no figure at all would be read as 0, so it is still an error.
    const empty = bakery();
    empty.quantities = empty.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, value: null, low: null, high: null, range_kind: null } : q));
    expect(compile(empty).errors.map((e) => [e.code, e.items])).toEqual([['figure_status', ['extra_per_oven']]]);
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

  it('S1 strip (B14 off): a condition stated as both a goal and a limit is no error: both calculate; a different limit on the same quantity too', () => {
    const m = bakery();
    m.limits.push(limit('profit_limit', 'Profit over £900', 'profit', '>', 'profit_target', 'every', 'quarter', 'over £900'));
    const both = compile(m);
    expect(both.errors).toEqual([]);
    expect(both.executable!.goals.map((g) => g.id)).toContain('weekly_profit');
    expect(both.executable!.limits.map((l) => l.id)).toEqual(['profit_limit']);
    const ok = bakery();
    ok.quantities.push(person('zero_profit', 'GBP/week', 0, 'never make a loss'));
    ok.limits.push(limit('no_loss', 'Never make a loss', 'profit', '>=', 'zero_profit', 'every', 'quarter', 'never make a loss'));
    const r = compile(ok);
    expect(r.errors).toEqual([]);
    expect(r.executable!.limits).toEqual([{ id: 'no_loss', label: 'Never make a loss', quantity: 'profit', cmp: '>=', bound: 'zero_profit', aggregation: 'every', window: { start_period: 0, periods: 13 } }]);
  });

  it('S1 strip (A25a, X4 off): authorship is the AI\'s alone: a quote not in the person\'s words, or none, is drawn as the AI wrote it', () => {
    const m = bakery();
    const brief = 'We sell 400 loaves a week at £3 and costs £600 a week. A second oven? Buy it or keep one oven. Weekly profit over £900 within 3 months, and at least £10,000 in the bank. We have £2,000 in the bank.';
    m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, quote: 'costs are £650 a week' } : q.id === 'price' ? { ...q, quote: null } : q));
    const r = compile(m, { sourceText: brief });
    expect(r.errors).toEqual([]);
    expect(r.unverified).toEqual([]);
    expect(r.perGoal[0].unverified_inputs).toEqual([]);
    const p = project(m, r);
    expect(p.graph.nodes.find((n) => n.id === 'costs')).toMatchObject({ provenance: 'from_brief', source_quote: 'costs are £650 a week' });
    expect(p.graph.nodes.find((n) => n.id === 'price')).toMatchObject({ provenance: 'from_brief' });
    expect(p.graph.nodes.find((n) => n.id === 'price')).not.toHaveProperty('source_quote');
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
    // S1 strip (B12 off): a person's exact figure as a link size is no error; the link runs with that exact size.
    const bad = bakery();
    bad.quantities = bad.quantities.map((q2) => (q2.id === 'extra_per_oven' ? person('extra_per_oven', 'loaf/week/oven', 150, 'each oven adds exactly 150') : q2));
    const rb = compile(bad);
    expect(codes(rb)).toEqual([]);
    expect(xq(rb).get('extra_per_oven')!.dist).toEqual({ kind: 'fixed', value: 150, author: 'person' });
  });

  it('phase 0b fix 3: a structural constant is exact, authored structure, never drawn as Olumi\'s; S1 strip (B2 off): any figure the AI labels structure is read as written', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'ovens_added' ? structure('ovens_added', 'oven', 0, 'No extra oven: as now.') : q));
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(xq(r).get('ovens_added')!.dist).toEqual({ kind: 'fixed', value: 0, author: 'structure' });
    // Q1 (Paul, 28 Oct): the switch an option sets is said on that option's card, with its own label, never as Olumi's.
    const p = project(m, r);
    expect(p.graph.nodes.find((n) => n.id === 'ovens_added')).toBeUndefined();
    expect(p.items.find((i) => i.record_id === 'ovens_added')!.shown_as).toEqual({ on_node: 'buy_oven' });
    const setting = (p.graph.nodes.find((n) => n.id === 'buy_oven')!.interventions as Record<string, Record<string, unknown>>).ovens_added!;
    expect(setting.label).toBe(m.quantities.find((q) => q.id === 'ovens_added')!.label);
    expect(String(setting.display_value)).not.toContain('Olumi');
    const hiding = bakery();
    hiding.quantities = hiding.quantities.map((q) => (q.id === 'costs' ? structure('costs', 'GBP/week', 612.5, 'Costs.') : q));
    // The structure rewrite (B2) is off the path: the AI's label passes through unchanged and the figure calculates as structure.
    const hid = compile(hiding);
    expect(hid.errors).toEqual([]);
    expect(normalise(hiding).quantities.find((q) => q.id === 'costs')).toMatchObject({ author: 'structure', status: 'known', value: 612.5, basis: 'Costs.' });
    expect(hid.blockers).toEqual([]);
    expect(xq(hid).get('costs')!.dist).toEqual({ kind: 'fixed', value: 612.5, author: 'structure' });
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
    // S1 strip (X2 off): kind is the AI's word; a derived quantity marked fact, and kind derived on a figure, both compile as written.
    const asFact = bakery();
    asFact.quantities = asFact.quantities.map((q) => (q.id === 'profit' ? { ...q, kind: 'fact' as const } : q));
    expect(compile(asFact).errors).toEqual([]);
    const figure = bakery();
    figure.quantities = figure.quantities.map((q) => (q.id === 'costs' ? { ...q, kind: 'derived' as const } : q));
    expect(compile(figure).errors).toEqual([]);
    expect(xq(compile(figure)).get('costs')!.dist).toEqual({ kind: 'fixed', value: 600, author: 'person' });
    const schemaText = JSON.stringify(z.toJSONSchema(CanonicalModel));
    expect(schemaText).not.toContain('A derived or structural quantity is a fact');
    // Round 1 (27 Oct, the PL's candidate wording): the coefficient description is shortened; the rule is unchanged.
    // Round 2 (27 Oct, consolidation): the kind description in one sentence each; the rule is unchanged.
    expect(schemaText).toContain('coefficient: a causal response per unit of driver, still a coefficient when derived.'); // contrast: the new rule is said (r10: its estimate rule moved to the status description)
    expect(schemaText).toContain('derived: a quantity worked out by its relation that is not a link\'s size.');
  });

  it('phase 0b fix 6: a preference is shown and reported, never a goal or a limit', () => {
    const m = bakery();
    m.preferences.push({ id: 'spend_less', quantity: 'costs', direction: 'lower', author: 'person', quote: "we'd like to spend less", ...base });
    const r = compile(m);
    expect(r.errors).toEqual([]);
    expect(r.preferences).toEqual([{ id: 'spend_less', quantity: 'costs', direction: 'lower', label: 'costs' }]);
    expect(r.executable!.goals.map((g) => g.id)).toEqual(['weekly_profit', 'cash_buffer']);
    expect(JSON.stringify(r.executable)).not.toContain('spend_less');
    // Not a card (DL 24 Oct): the canvas draws it from the model by id; its item says so.
    expect(project(m, r).graph.nodes.find((n) => n.id === 'spend_less')).toBeUndefined();
    expect(project(m, r).items.find((i) => i.record_id === 'spend_less')).toMatchObject({ family: 'preference', shown_as: {}, in_calculation: false, concerns: ['costs'] });
  });

  it('S1 strip (B15 off): a goal measuring an asked quantity is no error: it waits on that answer; asking for a target is not either', () => {
    const m = bakery();
    m.quantities = m.quantities.map((q) => (q.id === 'profit_target' ? asked('profit_target', 'GBP/week', 'What weekly profit would count as success?') : q));
    expect(compile(m).errors).toEqual([]);
    const bad = bakery();
    bad.quantities.push(asked('launch_success', '1', 'Was the launch a success?'), person('one', '1', 1, 'a success'));
    bad.goals.push(goal('success', 'launch_success', '>=', 'one', 'end', 'quarter', 'a successful launch'));
    const rb = compile(bad);
    expect(codes(rb)).toEqual([]);
    expect(rb.perGoal.find((p) => p.goal_id === 'success')).toMatchObject({ status: 'asks', asks: ['launch_success'] });
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
    // S1 strip (B9 off): Olumi's estimate of a fact is no error; it calculates as Olumi's range, labelled as the AI wrote it.
    const rf = compile({ ...fact, quantities: fact.quantities.map((q) => (q.id === 'costs' ? { ...q, kind: 'fact' as const } : q)) });
    expect(rf.errors).toEqual([]);
    expect(xq(rf).get('costs')!.dist).toMatchObject({ kind: 'range', low: 500, high: 700, basis: 'olumi_estimate' });
    expect(compile(fact).errors).toEqual([]);
  });

  it('S1 strip (M3, M11): a setting on a worked-out figure overrides it unless it is a stock (the engine cannot set a stock); an inline setting\'s status and kind never vary by author', () => {
    // M3: setting `sales` (an effect) compiles, and the option's set reaches the Run; setting `cash` (a stock) is still an error.
    const over = bakery();
    over.quantities.push(person('sales_cap', 'loaf/week', 350, 'cap sales at 350'));
    over.options.push(option('cap_sales', 'Cap sales', [set('sales', 'sales_cap', 'cap sales at 350')], 'cap sales'));
    const ro = compile(over);
    expect(codes(ro)).toEqual([]);
    expect(ro.executable!.options.find((o) => o.id === 'cap_sales')!.sets).toEqual([{ quantity: 'sales', to: 'sales_cap', from_period: 0 }]);
    const onStock = bakery();
    onStock.quantities.push(person('cash_reset', 'GBP', 0, 'start from nothing'));
    onStock.options.push(option('reset_cash', 'Reset cash', [set('cash', 'cash_reset', 'start from nothing')], 'reset cash'));
    expect(compile(onStock).errors.map((e) => [e.code, e.items])).toEqual([['set_derived', ['reset_cash', 'cash']]]);
    // M11: an option set carries no status or kind of its own (canonical.ts CanonicalOptionSet), so the host's default is one
    // for every author: a figure in hand is known, a fact; whose it is stays the AI's.
    const inline = (author: 'person' | 'olumi') => {
      const m = bakery();
      m.options.push(option('raise_price', 'Raise the price', [set('price', null, 'put the price up to £3.50', { value: 3.5, author, ...(author === 'olumi' ? { quote: null } : {}) })], 'put the price up'));
      return normalise(m).quantities.find((q) => q.id === 'raise_price__price')!;
    };
    for (const author of ['person', 'olumi'] as const) expect(inline(author), author).toMatchObject({ status: 'known', kind: 'fact', author, value: 3.5 });
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

  it('C3 (spec §3.5): with no deadline, an aim or guardrail resting on a live option or a risk that starts later asks for a deadline, never read as in effect', () => {
    // Weekly profit with no deadline is static (no stock), so it is read once at period 0; the cash goal keeps its quarter.
    const timed = (t: number | string, f: (m: CanonicalModelT) => void = () => {}) => {
      const m = bakery();
      m.goals = m.goals.map((g) => (g.id === 'weekly_profit' ? { ...g, measure: { ...g.measure!, window: null } } : g));
      m.options = m.options.map((o) => (o.id === 'buy_oven' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: t })) } : o));
      f(m);
      return compile(m);
    };
    const waits = (r: ReturnType<typeof compile>, what: string) => {
      expect(r.errors, what).toEqual([]);
      expect(r.perGoal.find((p) => p.goal_id === 'weekly_profit'), what).toMatchObject({ status: 'asks', needs_deadline: true, asks: [], reasons: ['It changes over time, so it needs a deadline.'] });
      expect(r.blockers, what).toEqual([{ id: 'weekly_profit', code: 'deadline', scope: ['weekly_profit'] }]);
      expect(r.executable!.goals.map((g) => g.id), what).toEqual(['cash_buffer']);
    };
    const risk = (from: number) => (m: CanonicalModelT) => {
      m.quantities.push(olumi('breakdown_chance', '1', 0.05, 0.2), olumi('lost_loaves', 'loaf/week', -150, -50, -100));
      m.risks.push({ id: 'breakdown', label: 'The oven breaks down', occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', direction: 'unknown', mode: 'add', starts_after_periods: from, author: 'olumi', quote: null, ...base });
    };
    waits(timed(4), 'the oven arrives in week 5');
    waits(timed('delivery', (m) => m.quantities.push(qty('delivery', 'week', { low: 2, high: 6, range_kind: 'plausible', status: 'estimated', author: 'olumi', basis: 'Typical delivery time.' }))), 'its start is a quantity');
    waits(timed(0, risk(4)), 'a breakdown from week 5');
    // A start held in a known single figure is read as that figure: a known 2 waits, a known 0 is from the start (below).
    waits(timed('lead_time', (m) => m.quantities.push(person('lead_time', 'week', 2, 'it takes 2 weeks to arrive'))), 'a known 2-week start');
    // A guardrail with no deadline is read the same way.
    const guard = timed(4, (m) => {
      m.goals = m.goals.filter((g) => g.id === 'cash_buffer');
      m.quantities.push(person('takings_floor', 'GBP/week', 1000, 'takings of at least £1,000 a week'));
      m.limits.push({ ...limit('min_takings', 'Takings at least £1,000 a week', 'takings', '>=', 'takings_floor', 'end', 'quarter', 'at least £1,000 a week'), measure: { ...limit('x', 'x', 'takings', '>=', 'takings_floor', 'end', 'quarter', 'q').measure!, window: null } });
    });
    expect(guard.errors).toEqual([]);
    expect(guard.perLimit).toEqual([expect.objectContaining({ limit_id: 'min_takings', status: 'asks', reasons: ['It changes over time, so it needs a deadline.'] })]);
    expect(guard.blockers).toEqual([{ id: 'min_takings', code: 'deadline', scope: ['min_takings'] }]);
    // Contrast: from the start, or a later start on what it does not rest on, or on an option not compared: read once, in effect.
    for (const [what, r] of [['from the start', timed(0)], ['a breakdown from the start', timed(0, risk(0))],
      ['a later change it does not rest on', timed(0, (m) => { m.quantities.push(person('hours', 'hour/week', 50, '50 hours a week'), person('fewer_hours', 'hour/week', 40, 'cut to 40 hours'));
        m.options.push(option('cut_hours', 'Cut my hours', [set('hours', 'fewer_hours', 'cut to 40 hours', { starts_after_periods: 4 })], 'Cut my hours')); })],
      ['a known 0-week start held in a figure', timed('lead_time', (m) => m.quantities.push(person('lead_time', 'week', 0, 'it arrives straight away')))],
      ['a later risk on what it does not rest on', timed(0, (m) => { m.quantities.push(person('hours', 'hour/week', 50, '50 hours a week'), olumi('strain_chance', '1', 0.05, 0.2), olumi('lost_hours', 'hour/week', -10, -2, -5));
        m.risks.push({ id: 'strain', label: 'Burnout cuts my hours', occurrence: 'strain_chance', severity: 'lost_hours', effect_on: 'hours', direction: 'unknown', mode: 'add', starts_after_periods: 4, author: 'olumi', quote: null, ...base }); })],
      ['a later start on a ruled-out option', timed(0, (m) => m.options.push({ ...option('second_hand', 'A second-hand oven', [set('ovens_added', 'one_oven', 'a used one', { starts_after_periods: 4 })], 'a used one'), status: 'ruled_out' }))]] as const) {
      expect(r.errors, what).toEqual([]);
      expect(r.blockers, what).toEqual([]);
      expect(r.executable!.goals.find((g) => g.id === 'weekly_profit'), what).toMatchObject({ window: { start_period: 0, periods: 1 }, no_deadline: true });
    }
  });

  it('DL defect (a), S1 strip (B16 off): an option that reaches only a limit reaches; one that reaches neither is no error and compares as carrying on', () => {
    const m = bakery();
    m.quantities.push(person('hours', 'hour/week', 50, '50 hours a week'), person('fewer_hours', 'hour/week', 40, 'cut to 40 hours'), person('hours_cap', 'hour/week', 45, 'no more than 45 hours'));
    m.limits.push(limit('my_hours', 'No more than 45 hours a week', 'hours', '<=', 'hours_cap', 'every', 'quarter', 'no more than 45 hours'));
    m.options.push(option('cut_hours', 'Cut my hours', [set('hours', 'fewer_hours', 'cut to 40 hours')], 'Cut my hours'));
    expect(compile(m).errors).toEqual([]);
    const none = bakery();
    none.quantities.push(person('hours', 'hour/week', 50, '50 hours a week'), person('fewer_hours', 'hour/week', 40, 'cut to 40 hours'));
    none.options.push(option('cut_hours', 'Cut my hours', [set('hours', 'fewer_hours', 'cut to 40 hours')], 'Cut my hours'));
    const rn = compile(none);
    expect(codes(rn)).toEqual([]);
    expect(rn.executable!.options.find((o) => o.id === 'cut_hours')!.sets).toEqual([]);
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

  it('S1 strip (A20b off): a figure given wholly outside its declared bounds is never asked again nor held by the compiler; it runs with its domain, which the engine reads', () => {
    const withMembers = (f: Partial<CanonicalQuantityT>) => { const g = gymFilled(); g.quantities = g.quantities.map((q) => (q.id === 'members_now' ? { ...q, floor: 0, ...f } : q)); return compile(g); };
    for (const [what, r] of [['person below', withMembers({ value: -5, low: null, high: null })], ['person above', withMembers({ value: 900, low: null, high: null, ceiling: 500 })],
      ['olumi below', withMembers({ value: -5, low: null, high: null, author: 'olumi', status: 'estimated', quote: null, basis: 'a guess' })]] as const) {
      expect(r.blockers.filter((b) => b.code === 'recount'), what).toEqual([]);
      expect(r.perGoal.find((p) => p.goal_id === 'reach_400'), what).toMatchObject({ status: 'calculable' });
      // MATHS kept (A20a): the declared bounds ride into the Run as its domain, never clamped.
      expect(xq(r).get('members_now')!.domain, what).toMatchObject({ min: 0 });
    }
  });

  it('S1 strip (A20b off): a person\'s firm range that only touches Olumi\'s floor or ceiling is never asked again; the law holds it (no room), and a range with room calculates', () => {
    // A hall's occupancy in %, which Olumi reads as 0 to 100 %, on the real compile → present path (evaluateCanonical).
    const words = 'The hall has 200 seats. We want at least 150 guests this month. Carry on as now. Between 100% and 120% full.';
    const hall = (occupancy: Partial<CanonicalQuantityT>) => evaluateCanonical(model({
      question: 'Will the hall fill?', period: 'month',
      quantities: [person('seats', 'seat', 200, 'The hall has 200 seats'), qty('occupancy', '%', { floor: 0, ceiling: 100, quote: 'Between 100% and 120% full', ...occupancy }),
        derived('guests', 'seat'), person('want', 'seat', 150, 'at least 150 guests'), person('one', 'month', 1, 'this month')],
      relations: [def('guests_rel', 'guests', 'product', ['seats', 'occupancy'])],
      goals: [goal('enough_guests', 'guests', '>=', 'want', 'end', 'one', 'at least 150 guests')],
      options: [option('carry_on', 'Carry on as now', [], 'Carry on as now')],
    }), { sourceText: words, seed: 7, draws: 2000 });
    for (const [what, f] of [['above', { low: 100, high: 120, range_kind: 'bounds' as const }], ['below', { low: -10, high: 0, range_kind: 'bounds' as const }]] as const) {
      const r = hall(f);
      expect(r.compiled.errors, what).toEqual([]);
      expect(r.compiled.blockers.filter((b) => b.code === 'recount'), what).toEqual([]);
      expect(r.compiled.perGoal.find((p) => p.goal_id === 'enough_guests'), what).toMatchObject({ status: 'withheld', asks: [] });
      expect(r.compiled.perGoal.find((p) => p.goal_id === 'enough_guests')!.reasons.join(' '), what).toContain('has no room inside what it can be');
    }
    // Contrast: a firm range INSIDE that ends at the ceiling has room (80–100 %), and a rough estimate touching it is the
    // ruled reading within what it can be (conditioned and disclosed): both calculate, nothing is asked again.
    for (const [what, f] of [['firm 80–100 %', { low: 80, high: 100, range_kind: 'bounds' as const }], ['rough 100–120 %', { low: 100, high: 120, range_kind: 'plausible' as const }]] as const) {
      const r = hall(f);
      expect(r.compiled.blockers, what).toEqual([]);
      expect(r.compiled.perGoal.map((p) => [p.goal_id, p.status]), what).toEqual([['enough_guests', 'calculable']]);
      expect(r.sim, what).not.toBeNull();
    }
  });

  it('alpha G6: a setting\'s timing that does not apply is a typed error, never period 0 (one worked out by a relation: C10 below)', () => {
    const timed = (opens: Partial<CanonicalQuantityT>) => {
      const g = gymFilled();
      g.quantities.push(qty('opens', 'month', opens), person('lease', 'month', 2, 'the lease is signed in two months'), person('fit', 'month', 1, 'a month to fit out'));
      g.options = g.options.map((o) => (o.id === 'promo' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'opens' })) } : o));
      return compile(g);
    };
    const r = timed({ status: 'not_applicable', author: 'olumi', basis: 'Nothing sets when it opens.' });
    expect(r.errors.map((e) => [e.code, e.items])).toContainEqual(['timing', ['promo', 'opens']]);
    expect(r.executable).toBeNull();
    // Codex r1 #3770: on a ruled-out option it blocks nothing; the live options still run.
    const out = (() => { const g = gymFilled();
      g.quantities.push(qty('opens', 'month', { status: 'derived', kind: 'derived' }), person('lease', 'month', 2, 'the lease is signed in two months'), person('fit', 'month', 1, 'a month to fit out'));
      g.relations.push(def('opens_rel', 'opens', 'sum', ['lease', 'fit']));
      g.options = g.options.map((o) => (o.id === 'promo' ? { ...o, status: 'ruled_out' as const, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'opens' })) } : o));
      return compile(g); })();
    expect(out.errors).toEqual([]);
    expect(out.executable!.options.map((o) => o.id)).toEqual(['carry_on']);
    // The same on a timing that does not apply: a ruled-out option is never built, so it is no error (review on #3849).
    const outNa = (() => { const g = gymFilled();
      g.quantities.push(qty('opens', 'month', { status: 'not_applicable', author: 'olumi', basis: 'Nothing sets when it opens.' }));
      g.options = g.options.map((o) => (o.id === 'promo' ? { ...o, status: 'ruled_out' as const, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'opens' })) } : o));
      return compile(g); })();
    expect(outNa.errors).toEqual([]);
    expect(outNa.executable!.options.map((o) => o.id)).toEqual(['carry_on']);
    // Contrast: an asked timing is asked of them (the option waits on it), never an error and never period 0.
    const asked = timed({ status: 'asked', question: 'When does it open?' });
    expect(asked.errors).toEqual([]);
    expect(asked.perOption.find((o) => o.option_id === 'promo')).toMatchObject({ status: 'asks', asks: ['opens'] });
  });

  it('C10 (spec §3.5): a start time worked out by a relation withholds only what rests on it, as unsupported, never period 0 and never a model error', () => {
    const opens = (g: CanonicalModelT) => {
      g.quantities.push(derived('opens', 'month'), person('lease', 'month', 2, 'the lease is signed in two months'), person('fit', 'month', 1, 'a month to fit out'));
      g.relations.push(def('opens_rel', 'opens', 'sum', ['lease', 'fit']));
      return g;
    };
    const why = 'rests on "opens": a start time worked out by a relation is unsupported; give a most likely figure, or ask';
    // A live option starting then: that option is withheld; both goals still calculate, compared with carrying on.
    const g = opens(gymFilled());
    g.options = g.options.map((o) => (o.id === 'promo' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'opens' })) } : o));
    const r = compile(g);
    expect(r.errors).toEqual([]);
    expect(r.perOption.map((p) => [p.option_id, p.status, p.reasons])).toEqual([['promo', 'withheld', [why]], ['carry_on', 'calculable', []]]);
    expect(r.perGoal.map((p) => [p.goal_id, p.status])).toEqual([['reach_400', 'calculable'], ['class_income', 'calculable']]);
    expect(r.executable!.options.map((o) => o.id)).toEqual(['carry_on']);
    expect(r.executable!.withheld).toEqual([{ id: 'promo', kind: 'option', label: 'Run a summer promotion', reason: why }]);
    expect(r.in_model).toEqual(expect.arrayContaining(['opens', 'lease', 'fit'])); // kept in the model, for correction
    // A risk starting then: only the goal it reaches is withheld; the members goal still calculates.
    const k = opens(gymFilled());
    k.quantities.push(olumi('leave_chance', '1', 0.05, 0.2), olumi('class_loss', '1', 0.5, 0.9, 0.7));
    k.risks.push({ id: 'instructor_leaves', label: 'The instructor leaves', occurrence: 'leave_chance', severity: 'class_loss', effect_on: 'class_revenue', direction: 'unknown', mode: 'multiply', starts_after_periods: 'opens', author: 'olumi', quote: null, ...base });
    const rk = compile(k);
    expect(rk.errors).toEqual([]);
    expect(rk.perGoal.map((p) => [p.goal_id, p.status])).toEqual([['reach_400', 'calculable'], ['class_income', 'withheld']]);
    expect(rk.perGoal.find((p) => p.goal_id === 'class_income')!.reasons).toEqual([why]);
    expect(rk.executable!.goals.map((x) => x.id)).toEqual(['reach_400']);
    // Contrast: the same risk from a given start time runs, with both goals.
    const given = opens(gymFilled());
    given.quantities = given.quantities.map((q) => (q.id === 'opens' ? person('opens', 'month', 3, 'it opens in three months') : q));
    given.relations = given.relations.filter((x) => x.id !== 'opens_rel');
    given.quantities.push(olumi('leave_chance', '1', 0.05, 0.2), olumi('class_loss', '1', 0.5, 0.9, 0.7));
    given.risks.push({ ...k.risks[0] });
    const rg = compile(given);
    expect(rg.errors).toEqual([]);
    expect(rg.executable!.goals.map((x) => x.id)).toEqual(['reach_400', 'class_income']);
    expect(rg.executable!.risks).toEqual([{ id: 'instructor_leaves', occurrence: 'leave_chance', severity: 'class_loss', effect_on: 'class_revenue', mode: 'multiply', from_period: 3 }]);
  });

  it('Codex r1 #3771: a setting is read within what it sets in ITS own unit, and within every quantity it sets at once, whatever the order', () => {
    // A share in "1" capped at 1, set by an option to a figure in "%": the cap is 100 % for the setting.
    const shareModel = (target: Partial<CanonicalQuantityT>, setting: Partial<CanonicalQuantityT>) => compile(model({
      question: 'Will enough visitors join?', period: 'month',
      quantities: [person('visitors', 'visitor', 1000, '1,000 visitors'), qty('share', '1', { value: 0.2, quote: 'a fifth join', ...target }),
        qty('boost_share', '%', { value: 50, quote: 'half would join', ...setting }),
        derived('joined', 'visitor'), person('want', 'visitor', 300, '300 to join'), person('one', 'month', 1, 'this month')],
      relations: [def('joined_rel', 'joined', 'product', ['visitors', 'share'])],
      goals: [goal('enough', 'joined', '>=', 'want', 'end', 'one', '300 to join')],
      options: [option('boost', 'Boost sign-ups', [set('share', 'boost_share', 'half would join')], 'boost sign-ups'), option('carry_on', 'Carry on as now', [], 'carry on as now')],
    }));
    // S1 strip (A20b off): a setting outside what it inherits is never asked again; the inherited bounds (A20a, kept) are its
    // domain in the engine's scale, which the Run reads, in either unit and whatever the options' order.
    const recounts = (r: ReturnType<typeof compile>) => r.blockers.filter((b) => b.code === 'recount').map((b) => b.id);
    const dom = (r: ReturnType<typeof compile>, id = 'boost_share') => r.domains[id];
    expect(dom(shareModel({ floor: 0, ceiling: 1 }, {}))).toEqual({ min: 0, max: 1 });                 // 50 % within 0 to 1
    const over = shareModel({ floor: 0, ceiling: 1 }, { value: 150 });
    expect(recounts(over)).toEqual([]);
    expect(dom(over)).toEqual({ min: 0, max: 1 });
    // The other way: a target capped at 100 % set by a figure in "1".
    expect(dom(shareModel({ unit: '%', value: 20, floor: 0, ceiling: 100 }, { unit: '1', value: 2 }))).toEqual({ min: 0, max: 1 });
    // Codex r2/r3: one correctly rounded conversion, so a large exact bound is kept exactly.
    expect(shareModel({ unit: '%', value: 20, floor: 0, ceiling: 29 }, { unit: '1', value: 0.29 }).domains.boost_share).toEqual({ min: 0, max: 0.29 });
    expect(dom(shareModel({ unit: '%', value: 20, ceiling: 9999999999999 }, { value: 10000000000000 }))).toEqual({ max: 9999999999999 * 0.01 });
    // numbers#6: a setting that declares one side of its own keeps the other from what it sets; one that declares both overrides.
    expect(dom(shareModel({ unit: '%', value: 20, floor: 0, ceiling: 100 }, { value: 150, floor: 0 }))).toEqual({ min: 0, max: 1 });
    expect(dom(shareModel({ unit: '%', value: 20, floor: 0, ceiling: 100 }, { value: -10, ceiling: 100 }))).toEqual({ min: 0, max: 1 });
    expect(dom(shareModel({ unit: '%', value: 20, floor: 0, ceiling: 100 }, { value: 150, floor: 0, ceiling: 200 }))).toEqual({ min: 0, max: 2 });
    // One figure setting two quantities, capped at 100 and at 1,000 a month: the lowest ceiling, in either order.
    const shared = (reversed: boolean) => {
      const g = gymFilled();
      g.quantities = g.quantities.map((q) => (q.id === 'joins' ? { ...q, ceiling: 100 } : q.id === 'promo_joins' ? { ...q, value: 200 } : q));
      g.quantities.push(qty('extra_joins', 'member/month', { value: 0, quote: 'no extra joins now', ceiling: 1000 }));
      g.relations = g.relations.map((r) => (r.form === 'stock' ? { ...r, inflows: [...r.inflows, 'extra_joins'] } : r));
      const second = option('referrals', 'Run referrals', [set('extra_joins', 'promo_joins', 'a promotion could bring 40 a month')], 'run referrals');
      g.options = reversed ? [second, ...g.options] : [...g.options, second];
      return compile(g);
    };
    for (const reversed of [false, true]) {
      expect(recounts(shared(reversed)), `reversed ${reversed}`).toEqual([]);
      expect(dom(shared(reversed), 'promo_joins'), `reversed ${reversed}`).toEqual({ max: 100 });
    }
  });

  it('numbers#4: a card reads its range within the same domain whether or not it is in a Run yet: the waiting first draft says the floor, and a chance in % stays in %', () => {
    const words = 'between 0 and 30 join each month';
    // The gym's members goal waits on leavers, so nothing in it is in the Run; class income calculates on its own.
    const gymWith = (floor: number | null) => {
      const g = gym();
      g.quantities = g.quantities.map((q) => (q.id === 'joins' ? { ...q, value: null, low: 0, high: 30, range_kind: 'plausible' as const, quote: words, floor } : q));
      g.quantities.push(qty('rival_chance', '%', { kind: 'coefficient', status: 'estimated', author: 'olumi', low: 10, high: 30, range_kind: 'plausible', basis: 'A rival opens nearby in some summers.' }),
        olumi('rival_loss', 'member', -30, -10));
      g.risks.push({ id: 'rival', label: 'A rival gym opens', occurrence: 'rival_chance', severity: 'rival_loss', effect_on: 'members', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...base });
      return g;
    };
    const nodes = (m: CanonicalModelT) => evaluateCanonical(m, { sourceText: `300 members today. ${words}.`, seed: 7, draws: 2000 }).projection.graph.nodes;
    const waiting = nodes(gymWith(0));
    expect(compile(gymWith(0)).conversions.some((c) => c.quantity === 'joins' || c.quantity === 'rival_chance')).toBe(false); // precondition: not in the Run
    const joins = waiting.find((n) => n.id === 'joins')!;
    // W10 (adopted; before it, 15.8 (sd 7.892) and 20.01 (sd 5.764)). Joins 0 to 30 with a floor of 0: its low end sits on the
    // floor (rule 2), m = 15, σ = 15/1.2815516 = 11.70456 each side, the lower half truncated at 0 keeping its ½: mean 15 +
    // 11.70456 × ½ × (0.79788 − 0.55861) = 16.400, sd 11.70456 × 0.83937 = 9.8245 (the row 2b (e) factors of the numerical check).
    // The rival's 10 to 30 % chance, within 0 to 100 %, strictly inside it: m = 20 %, σ = 10/1.2815516 = 7.80304 %; its
    // lower half within [−2.5631, 0] (mass 0.5 − 0.005187 = 0.494813; φ(2.5631) = 0.014940; mean (0.014940 − 0.398942)/0.494813
    // = −0.776055; variance 1 − 2.5631 × 0.014940/0.494813 − 0.776055² = 0.320349), its upper half a half-Normal (0.797885,
    // 0.363380, 100 % is 10.25 σ away): mean 20 + 7.80304 × ½ × (0.797885 − 0.776055) = 20.085, sd 7.80304 ×
    // √(½ × (0.320349 + 0.363380) + ¼ × 1.573940²) = 7.80304 × 0.980401 = 7.650.
    // Plain words on the card (Paul 28 Oct); the moments above are the item's law and its observed value, never the display text.
    expect(joins.display_value).toBe('0–30 member/month; Olumi reads it as a rough range, never below 0, provisionally');
    expect((joins.observed_state as { value: number }).value).toBeCloseTo(16.400, 2);
    expect(waiting.find((n) => n.id === 'rival')!.description).toContain('Chance: 10–30 %, Olumi\'s estimate; Olumi reads it as a rough range, kept between 0 and 100, provisionally.');
    expect(waiting.find((n) => n.id === 'rival')!.description).not.toMatch(/\bsd\b|spread around/);
    // Once the goal is calculable (leavers answered) the same unchanged figures read the same.
    const answeredNodes = nodes(answered(gymWith(0), 'leavers', { value: 20, quote: 'about 20 leave a month', basis: APPROXIMATE_FIGURE }));
    expect(answeredNodes.find((n) => n.id === 'joins')!.display_value).toBe('0–30 member/month; Olumi reads it as a rough range, never below 0, provisionally');
    expect(answeredNodes.find((n) => n.id === 'rival')!.description).toContain('Chance: 10–30 %, Olumi\'s estimate; Olumi reads it as a rough range, kept between 0 and 100, provisionally.');
    // Contrast: with no floor declared, the waiting card's spread is unbounded: the Normal on 15, σ = 11.70456 (W10; before, 8.66).
    expect(nodes(gymWith(null)).find((n) => n.id === 'joins')!.display_value).toBe('0–30 member/month; Olumi reads it as a rough range, provisionally');
  });

  it('numbers#2 (a), spec §3.7: a worked-out stock below Olumi\'s floor in a draw withholds every chance resting on it, with that draw counted and the stock named; never clamped, never dropped', () => {
    // The gym losing members: 300 today, 25 join and 80 leave a month, so carrying on as now members is 300 − 55k after k
    // months: 245, 190, 135, 80, 25, then −30 at month 6, down to −360 at month 12. Mean over months 1–12: −690 / 12 = −57.5.
    // With the promotion (40 join): 300 − 40k, −20 at month 8, mean (260 − 180) / 2 = 40. Fees are members × £30.
    const falling = (floor: number | null, joins?: Partial<CanonicalQuantityT>) => {
      const g = answered(gym(), 'leavers', { value: 80, quote: 'about 80 leave a month', basis: APPROXIMATE_FIGURE });
      g.quantities = g.quantities.map((q) => (q.id === 'members' ? { ...q, floor } : q.id === 'joins' && joins ? { ...q, ...joins } : q));
      g.quantities.push(person('fifty', 'member', 50, 'at least 50 members on average'), person('year', 'month', 12, 'over the next year'),
        person('fee', 'GBP/member/month', 30, '£30 a month each'), derived('fees', 'GBP/month'), person('fee_floor', 'GBP/month', 1500, 'at least £1,500 a month in fees'));
      g.relations.push(def('fees_rel', 'fees', 'product', ['members', 'fee']));
      g.goals = [goal('mean_members', 'members', '>=', 'fifty', 'mean', 'year', 'at least 50 members on average'),
        goal('mean_fees', 'fees', '>=', 'fee_floor', 'mean', 'year', 'at least £1,500 a month in fees')];
      return compile(g);
    };
    const bounded = falling(0);
    expect(bounded.errors).toEqual([]);
    expect(bounded.blockers).toEqual([]);
    // The stock carries Olumi's floor into the Run; what is worked out from it declares nothing of its own (contrast).
    expect(xq(bounded).get('members')).toMatchObject({ stock: { start: 'members_now' }, domain: { min: 0 } });
    expect(xq(bounded).get('fees')).not.toHaveProperty('domain');
    const sim = simulate(bounded.executable!, { seed: 7, draws: 200 });
    for (const o of sim.options) {
      // Every draw leaves the floor, so every chance is withheld with all 200 draws counted and the stock named, the fees
      // goal too (it reads members through the fees): never a chance over the draws that remain, never a clamped 0.
      expect(o.per_goal, o.option_id).toEqual([
        { goal_id: 'mean_members', withheld: { reason: 'invalid_domain', count: 200, quantities: ['members'] } },
        { goal_id: 'mean_fees', withheld: { reason: 'invalid_domain', count: 200, quantities: ['fees', 'members'] } },
      ]);
      expect(o.joint).toEqual({ withheld: { reason: 'invalid_domain', count: 200, quantities: ['members', 'fees'] } });
    }
    // Contrast: the same model with no floor computes both chances, as today: 0 (the means are −57.5 and 40, under 50).
    const free = simulate(falling(null).executable!, { seed: 7, draws: 200 });
    expect(xq(falling(null)).get('members')).not.toHaveProperty('domain');
    for (const o of free.options) expect(o.per_goal.map((g) => [g.goal_id, isWithheld(g) ? g.withheld : g.chance]), o.option_id).toEqual([['mean_members', 0], ['mean_fees', 0]]);
    // The count is exactly the draws that leave the floor, never fewer: joins a firm 20–80 a month (their bounds), so carrying
    // on as now members ends below 0 only where joins < 55. Counted on the same seed from the unbounded run's own draws.
    const firm = { value: null, low: 20, high: 80, range_kind: 'bounds' as const, quote: 'between 20 and 80 join each month' };
    const draws = 400, all = Array.from({ length: draws }, (_, d) => d);
    const unbounded = simulate(falling(null, firm).executable!, { seed: 7, draws, record: all });
    const below = unbounded.recorded!.filter((r) => r.option_id === 'carry_on' && r.values.members!.slice(1, 13).some((v) => v < 0)).length;
    expect(below).toBeGreaterThan(0);
    expect(below).toBeLessThan(draws);
    const carry = simulate(falling(0, firm).executable!, { seed: 7, draws }).options.find((o) => o.option_id === 'carry_on')!;
    expect(carry.per_goal[0]).toEqual({ goal_id: 'mean_members', withheld: { reason: 'invalid_domain', count: below, quantities: ['members'] } });
  });

  it('numbers#2 (b), spec §3.7: a chance is drawn within 0 to 100 % AND within the floor Olumi declares on it; the card reads the same law', () => {
    // Olumi's 10–30 % chance of a rival opening (a rough estimate) with its floor at 20 %. W10 (adopted; before it, the √12
    // Normal gave 24.61 and 3.480): its low end, 10 %, is past the floor and its middle, 20 %, sits on it, so its lower half has
    // no room and its upper half is all of it: a half-Normal above 20 %, σ = 10/1.2815516 = 7.80304 %, within 100 % (10.25 σ
    // away): mean 20 + 7.80304 × 0.797885 = 26.226, sd 7.80304 × 0.602810 = 4.7038.
    const rival = (f: Partial<CanonicalQuantityT>) => {
      const g = gymFilled();
      g.quantities.push(qty('rival_chance', '%', { kind: 'coefficient', status: 'estimated', author: 'olumi', low: 10, high: 30, range_kind: 'plausible', basis: 'A rival opens nearby in some summers.', ...f }),
        olumi('rival_loss', 'member', -30, -10));
      g.risks.push({ id: 'rival', label: 'A rival gym opens', occurrence: 'rival_chance', severity: 'rival_loss', effect_on: 'members', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...base });
      return g;
    };
    const drawn = (m: CanonicalModelT) => {
      const r = compile(m), draws = 400;
      const rec = simulate(r.executable!, { seed: 7, draws, record: Array.from({ length: draws }, (_, d) => d) }).recorded!.filter((x) => x.option_id === 'carry_on');
      return { r, chances: rec.map((x) => x.values.rival_chance![0]!) };
    };
    const floored = drawn(rival({ floor: 20 }));
    expect(floored.r.errors).toEqual([]);
    expect(lawIn(floored.r, 'rival_chance')).toMatchObject({ domain: { min: 0.2, max: 1 }, reading: { lower: 0.2, upper: 1 } });
    expect(lawIn(floored.r, 'rival_chance').reading.mean).toBeCloseTo(0.26226, 3);
    expect(Math.min(...floored.chances)).toBeGreaterThanOrEqual(0.2);
    expect(Math.max(...floored.chances)).toBeLessThanOrEqual(1);
    const node = (m: CanonicalModelT) => evaluateCanonical(m, { sourceText: 'about 20 leave a month', seed: 7, draws: 200 }).projection.graph.nodes.find((n) => n.id === 'rival')!.description;
    expect(node(rival({ floor: 20 }))).toContain('Chance: 10–30 %, Olumi\'s estimate; Olumi reads it as a rough range, kept between 20 and 100, provisionally.'); // the hard floor stays visible (PL 00:06)
    // Contrast: with no floor it is drawn within 0 to 100 % only, about half the draws below 20 %.
    const free = drawn(rival({}));
    expect(lawIn(free.r, 'rival_chance')).toMatchObject({ domain: { min: 0, max: 1 }, reading: { lower: 0, upper: 1 } });
    expect(free.chances.filter((x) => x < 0.2).length).toBeGreaterThan(100);
    expect(node(rival({}))).toContain('Olumi reads it as a rough range, kept between 0 and 100, provisionally.');
    // The person's FIRM 10–30 % with the same floor: drawn only where both hold, 20 % to 30 %.
    const theirs = drawn(rival({ author: 'person', status: 'known', kind: 'fact', basis: null, range_kind: 'bounds', quote: 'between 10 and 30 % chance a rival opens', floor: 20 }));
    expect(lawIn(theirs.r, 'rival_chance').reading).toMatchObject({ lower: 0.2, upper: 0.3 });
    expect(Math.min(...theirs.chances)).toBeGreaterThanOrEqual(0.2);
    expect(Math.max(...theirs.chances)).toBeLessThanOrEqual(0.3);
    expect(lawIn(drawn(rival({ author: 'person', status: 'known', kind: 'fact', basis: null, range_kind: 'bounds', quote: 'between 10 and 30 % chance a rival opens' })).r, 'rival_chance').reading)
      .toMatchObject({ lower: 0.1, upper: 0.3 }); // contrast: their bounds alone
  });

  it('numbers#2 (c), S1 strip (A20b off) + GAP 2 (29 Oct): a fixed timing given below the floor Olumi declares on it is never asked again; it is held, naming it, as a drawn figure outside its domain is (spec §3.7), and read as written at or above it', () => {
    const starting = (floor: number | null) => {
      const g = gymFilled();
      g.quantities.push(qty('promo_start', 'month', { value: 1, quote: 'the promotion starts in a month', floor }));
      g.options = g.options.map((o) => (o.id === 'promo' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 'promo_start' })) } : o));
      return compile(g);
    };
    const below = starting(2);
    expect(below.blockers.filter((b) => b.code === 'recount' || b.code === 'asked')).toEqual([]);
    expect(below.perOption.find((o) => o.option_id === 'promo')).toMatchObject({ status: 'withheld', asks: [], reasons: ['rests on "promo start": it is 1 month, but Olumi reads it as at least 2 month.'] });
    for (const floor of [1, null]) {
      const r = starting(floor);
      expect(r.blockers, `floor ${floor}`).toEqual([]);
      expect(r.executable!.options.find((o) => o.id === 'promo')!.sets.map((s) => s.from_period), `floor ${floor}`).toEqual([1]);
    }
  });

  it('numbers#2, spec §3.7: bounds that leave a figure nothing it can be withhold what rests on it, named in its unit; never run with the bound ignored, never asked of the person', () => {
    const why = (r: ReturnType<typeof compile>) => r.perGoal.find((p) => p.goal_id === 'reach_400')!;
    // Olumi's floor above its ceiling on the members stock.
    const g = gymFilled();
    g.quantities = g.quantities.map((q) => (q.id === 'members' ? { ...q, floor: 10, ceiling: 5 } : q));
    const reversed = compile(g);
    expect(why(reversed)).toMatchObject({ status: 'withheld', asks: [] });
    expect(why(reversed).reasons).toEqual(['rests on "members": Olumi reads "members" as never below 10 member and never above 5 member, which leaves nothing it can be.']);
    expect(reversed.blockers.filter((b) => b.code === 'recount')).toEqual([]);
    // A chance's floor above its 100 %: what the rival affects is withheld, said in %, never the law's "no room" in fractions.
    const c = gymFilled();
    c.quantities.push(qty('rival_chance', '%', { kind: 'coefficient', status: 'estimated', author: 'olumi', low: 10, high: 30, range_kind: 'plausible', basis: 'A rival opens nearby in some summers.', floor: 120 }),
      olumi('rival_loss', 'member', -30, -10));
    c.risks.push({ id: 'rival', label: 'A rival gym opens', occurrence: 'rival_chance', severity: 'rival_loss', effect_on: 'members', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...base });
    expect(why(compile(c)).reasons).toEqual(['rests on "rival chance": Olumi reads "rival chance" as never below 120 %, but a chance is never above 100 %.']);
    // Contrast: bounds with room calculate.
    const roomy = gymFilled();
    roomy.quantities = roomy.quantities.map((q) => (q.id === 'members' ? { ...q, floor: 0, ceiling: 5000 } : q));
    expect(why(compile(roomy))).toMatchObject({ status: 'calculable', reasons: [] });
  });

  it('Codex r2 numbers#2 (1a), spec §3.7: a worked-out chance above 100 % is outside the domain in that draw, never clipped to a certain event; within 0 to 100 % it is a chance', () => {
    // A rival's chance worked out as the sum of two parts, with Olumi's floor of 0 declared on it: 80 % + 80 % = 160 %, never a
    // certain rival (160 % clipped to 100 %): every draw of reach_400 is outside the domain, the chance named. 30 % + 40 % = 70 %.
    const rival = (a: number, b: number) => {
      const g = gymFilled();
      g.quantities.push(person('rival_a', '%', a, `${a} % from one rival`), person('rival_b', '%', b, `${b} % from another`),
        { ...derived('rival_chance', '%'), floor: 0 }, person('rival_loss', 'member', -10, 'we would lose 10 members'));
      g.relations.push(def('rival_rel', 'rival_chance', 'sum', ['rival_a', 'rival_b']));
      g.risks.push({ id: 'rival', label: 'A rival gym opens', occurrence: 'rival_chance', severity: 'rival_loss', effect_on: 'members', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...base });
      return compile(g);
    };
    const over = rival(80, 80);
    expect(over.errors).toEqual([]);
    // What it can be is its floor AND a chance's 0 to 1, never its declared floor alone.
    expect(xq(over).get('rival_chance')).toMatchObject({ equation: { form: 'definition', op: 'sum' }, domain: { min: 0, max: 1 } });
    for (const o of simulate(over.executable!, { seed: 7, draws: 100 }).options) {
      expect(o.per_goal[0], o.option_id).toEqual({ goal_id: 'reach_400', withheld: { reason: 'invalid_domain', count: 100, quantities: ['members', 'rival_chance'] } });
      expect(o.per_goal[1], o.option_id).toMatchObject({ goal_id: 'class_income', chance: 1 }); // unaffected: 8 × 450 = £3,600 every month
      expect(isWithheld(o.joint), o.option_id).toBe(true);
    }
    // Contrast: 70 % is a chance, and reach_400 computes for every option.
    for (const o of simulate(rival(30, 40).executable!, { seed: 7, draws: 100 }).options) expect(isWithheld(o.per_goal[0]!), o.option_id).toBe(false);
  });

  it('Codex r2 numbers#2 (1b), spec §3.7: a given figure a risk takes below Olumi\'s floor is outside the domain in that draw; never a chance on a level it cannot be', () => {
    // 450 class visits a month, floor 0; a certain (100 %) closure takes 500 a month off: −50 visits, never a chance on revenue
    // of 8 × −50 = −£400. Taking 100 off leaves 350 visits: £2,800, below £3,000 every month, a chance of 0.
    const closing = (loss: number) => {
      const g = gymFilled();
      g.quantities = g.quantities.map((q) => (q.id === 'attendances' ? { ...q, floor: 0 } : q));
      g.quantities.push(person('closure_chance', '%', 100, 'the studio will certainly close for works'), person('closure_loss', 'attendance/month', -loss, `${loss} fewer class visits a month`));
      g.risks.push({ id: 'closure', label: 'The studio closes for works', occurrence: 'closure_chance', severity: 'closure_loss', effect_on: 'attendances', direction: 'unknown', mode: 'add', starts_after_periods: 0, author: 'person', quote: 'the studio will certainly close for works', ...base });
      return compile(g);
    };
    const deep = closing(500);
    expect(deep.errors).toEqual([]);
    expect(xq(deep).get('attendances')).toMatchObject({ dist: { kind: 'fixed', value: 450 }, domain: { min: 0 } });
    for (const o of simulate(deep.executable!, { seed: 7, draws: 50 }).options) {
      expect(o.per_goal[1], o.option_id).toEqual({ goal_id: 'class_income', withheld: { reason: 'invalid_domain', count: 50, quantities: ['class_revenue', 'attendances'] } });
    }
    for (const o of simulate(closing(100).executable!, { seed: 7, draws: 50 }).options) expect(o.per_goal[1], o.option_id).toMatchObject({ goal_id: 'class_income', chance: 0 });
  });

  it('Codex r2 numbers#2 (2), spec §3.7: a draw whose worked-out value leaves its floor stays outside the domain however the value later recovers; never counted as met', () => {
    // total = start + bump × change: −1 member until "Make the change" turns change from 0 to 1 at month 1, then −1 + 2 = 1.
    // The goal reads the end of month 3 (1 ≥ 1, met), but at month 0 total is −1 against Olumi's floor of 0: every draw is
    // outside the domain for the goal, the joint and joint_within_limits, the total named; never "met in every draw".
    const recovering = (floor: number | null) => compile(model({
      question: 'Should we make the change?', period: 'month',
      quantities: [person('start', 'member', -1, 'one member short today'), qty('bump', 'member', { kind: 'coefficient', value: 2, quote: 'the change adds two members' }),
        structure('change', '1', 0, 'No change before the option.'), structure('on', '1', 1, 'The option is on.'),
        { ...derived('total', 'member'), floor }, person('one_member', 'member', 1, 'at least one member'), person('three', 'month', 3, 'in three months')],
      relations: [eff('total_rel', 'total', 'start', [['change', 'bump']])],
      goals: [goal('enough', 'total', '>=', 'one_member', 'end', 'three', 'at least one member in three months')],
      options: [option('make', 'Make the change', [set('change', 'on', 'make the change', { starts_after_periods: 1 })], 'make the change')],
    }));
    const floored = recovering(0);
    expect(floored.errors).toEqual([]);
    const sim = simulate(floored.executable!, { seed: 7, draws: 20, record: [0] });
    const make = sim.options.find((o) => o.option_id === 'make')!;
    expect(sim.recorded![0]!.values.total).toEqual([NaN, 1, 1, 1]);
    const out = { withheld: { reason: 'invalid_domain', count: 20, quantities: ['total'] } };
    expect(make.per_goal[0]).toEqual({ goal_id: 'enough', ...out });
    expect(make.joint).toEqual(out);
    expect(make.joint_within_limits).toEqual(out);
    // Contrast: with no floor, −1 is a value it can be, and the goal is met in every draw.
    const free = simulate(recovering(null).executable!, { seed: 7, draws: 20 }).options.find((o) => o.option_id === 'make')!;
    expect(free.per_goal[0]).toEqual({ goal_id: 'enough', chance: 1, precision_95: [1, 1] });
  });

  it('Codex r2 numbers#2 (3), spec §3.7: a worked-out value on its ceiling up to rounding is within it (£0.10 + £0.20 against £0.30); one genuinely above it is not', () => {
    // £0.10 + £0.20 is 0.30000000000000004 in binary floating point: on Olumi's ceiling of £0.30, never outside it, so the goal
    // (spend at most £1) and the joint are met in both draws. Against a ceiling of £0.29 the £0.30 is outside: both draws withheld.
    const spending = (ceiling: number) => compile(model({
      question: 'Can we keep spend under £1?', period: 'month',
      quantities: [person('tea', 'GBP', 0.1, '10p on tea'), person('milk', 'GBP', 0.2, '20p on milk'), { ...derived('spend', 'GBP'), ceiling },
        person('pound', 'GBP', 1, 'at most £1'), person('one_month', 'month', 1, 'this month')],
      relations: [def('spend_rel', 'spend', 'sum', ['tea', 'milk'])],
      goals: [goal('under_a_pound', 'spend', '<=', 'pound', 'end', 'one_month', 'at most £1')],
      options: [option('as_is', 'Carry on', [], 'carry on')],
    }));
    expect(0.1 + 0.2).toBeGreaterThan(0.3); // the rounding this row is about
    const on = spending(0.3);
    expect(on.errors).toEqual([]);
    const at = simulate(on.executable!, { seed: 7, draws: 2 }).options[0]!;
    expect(at.per_goal[0]).toEqual({ goal_id: 'under_a_pound', chance: 1, precision_95: [1, 1] });
    expect(at.joint).toEqual({ chance: 1, precision_95: [1, 1] });
    const above = simulate(spending(0.29).executable!, { seed: 7, draws: 2 }).options[0]!;
    expect(above.per_goal[0]).toEqual({ goal_id: 'under_a_pound', withheld: { reason: 'invalid_domain', count: 2, quantities: ['spend'] } });
  });

  it('Codex r3 numbers#2 (1), spec §3.7: a value that turns nonfinite (a ratio by zero) and later recovers leaves the whole draw outside the domain, named where it arose', () => {
    // ratio = 1 ÷ denominator, floor 0; the denominator is 0 until the change at month 1, so ratio reads [NaN, 1, 1, 1]. The
    // end goal, the limit, the joint, within-limits and the combined finding are each withheld in all 3 draws, naming `ratio`.
    const dividing = (start: number) => compile(model({
      question: 'Should we make the change?', period: 'month',
      quantities: [person('start', 'member', start, 'no members today'), qty('bump', 'member', { kind: 'coefficient', value: 1, quote: 'the change adds one member' }),
        structure('change', '1', 0, 'No change before the option.'), structure('on', '1', 1, 'The option is on.'), person('one', '1', 1, 'one'),
        derived('denominator', 'member'), { ...derived('ratio', '1/member'), floor: 0 }, person('target', '1/member', 0.5, 'at least a half'),
        person('cap', '1/member', 2, 'never above two'), person('three', 'month', 3, 'in three months')],
      relations: [eff('den_rel', 'denominator', 'start', [['change', 'bump']]), def('ratio_rel', 'ratio', 'ratio', ['one', 'denominator'])],
      goals: [goal('half', 'ratio', '>=', 'target', 'end', 'three', 'at least a half in three months')],
      limits: [limit('capped', 'Never above two', 'ratio', '<=', 'cap', 'end', 'three', 'never above two')],
      options: [option('make', 'Make the change', [set('change', 'on', 'make the change', { starts_after_periods: 1 })], 'make the change')],
    }));
    const zero = dividing(0);
    expect(zero.errors).toEqual([]);
    const make = simulate(zero.executable!, { seed: 7, draws: 3, record: [0] }).options.find((o) => o.option_id === 'make')!;
    expect(make.per_goal[0]).toEqual({ goal_id: 'half', withheld: { reason: 'invalid_domain', count: 3, quantities: ['ratio'] } });
    expect(make.per_limit[0]).toEqual({ limit_id: 'capped', withheld: { reason: 'invalid_domain', count: 3, quantities: ['ratio'] } });
    for (const f of [make.joint, make.within_limits, make.joint_within_limits]) expect(isWithheld(f) && f.withheld.count).toBe(3);
    // Contrast: a denominator of 1 from the start is never nonfinite, and every finding has its chance.
    const one = simulate(dividing(1).executable!, { seed: 7, draws: 3 }).options.find((o) => o.option_id === 'make')!;
    expect(one.per_goal[0]).toEqual({ goal_id: 'half', chance: 1, precision_95: [1, 1] });
    expect(one.joint_within_limits).toEqual({ chance: 1, precision_95: [1, 1] });
  });

  it('Codex r3 numbers#2 (2), spec §3.7: rounding is allowed by the calculation, never by the size of the end (£1tn + £500 is above a £1tn ceiling; 100000000 + 0.3 − 100000000 is on a 0.3 floor)', () => {
    const big = (extra: number) => compile(model({
      question: 'Can we stay within £1tn?', period: 'month',
      quantities: [person('core', 'GBP', 1e12, '£1tn of core spend'), person('extra', 'GBP', extra, 'and the extra'), { ...derived('spend', 'GBP'), ceiling: 1e12 },
        person('budget', 'GBP', 2e12, 'at most £2tn'), person('one_month', 'month', 1, 'this month')],
      relations: [def('spend_rel', 'spend', 'sum', ['core', 'extra'])],
      goals: [goal('within', 'spend', '<=', 'budget', 'end', 'one_month', 'at most £2tn')],
      options: [option('as_is', 'Carry on', [], 'carry on')],
    }));
    const over = big(500).executable!;
    expect(simulate(over, { seed: 7, draws: 2 }).options[0]!.per_goal[0]).toEqual({ goal_id: 'within', withheld: { reason: 'invalid_domain', count: 2, quantities: ['spend'] } });
    expect(exactInitialValues(over).has('spend')).toBe(false);
    const on = big(0).executable!;
    expect(simulate(on, { seed: 7, draws: 2 }).options[0]!.per_goal[0]).toEqual({ goal_id: 'within', chance: 1, precision_95: [1, 1] });
    expect(exactInitialValues(on).get('spend')).toBe(1e12);

    // Cancellation across quantities: 0.3 worked out as (100000000 + 0.3) − 100000000 is 0.29999999701976776, on its floor.
    const cancelling = (floor: number) => compile(model({
      question: 'Is the share enough?', period: 'month',
      quantities: [person('whole', '1', 100000000, 'a hundred million'), person('part', '1', 0.3, 'and 0.3'), derived('sum', '1'), { ...derived('share', '1'), floor },
        person('fifth', '1', 0.2, 'at least a fifth'), person('one_month', 'month', 1, 'this month')],
      relations: [def('sum_rel', 'sum', 'sum', ['whole', 'part']), def('share_rel', 'share', 'difference', ['sum', 'whole'])],
      goals: [goal('enough', 'share', '>=', 'fifth', 'end', 'one_month', 'at least a fifth')],
      options: [option('as_is', 'Carry on', [], 'carry on')],
    }));
    expect(100000000 + 0.3 - 100000000).toBeLessThan(0.3); // the rounding this half is about
    const floored = cancelling(0.3).executable!;
    expect(simulate(floored, { seed: 7, draws: 2 }).options[0]!.per_goal[0]).toEqual({ goal_id: 'enough', chance: 1, precision_95: [1, 1] });
    expect(exactInitialValues(floored).has('share')).toBe(true);
    // Contrast: a floor of 0.31 is genuinely above it.
    expect(simulate(cancelling(0.31).executable!, { seed: 7, draws: 2 }).options[0]!.per_goal[0]).toEqual({ goal_id: 'enough', withheld: { reason: 'invalid_domain', count: 2, quantities: ['share'] } });
  });

  it('Codex r3 numbers#2 (3), spec §3.7: a rounding allowance that overflows bounds nothing, so 0 + 1 × 1e308 is above a ceiling of 1', () => {
    // U × (|1e308| + |1e308|) would overflow to Infinity and admit any value; an allowance that is not finite admits none.
    const huge = (ceiling: number | null) => compile(model({
      question: 'Is the share within one?', period: 'month',
      quantities: [person('none', '1', 0, 'none yet'), person('big', '1', 1e308, 'a huge figure'), qty('one', '1', { kind: 'coefficient', value: 1, quote: 'one for one' }),
        { ...derived('share', '1'), ceiling }, person('two', '1', 2, 'at most two'), person('one_month', 'month', 1, 'this month')],
      relations: [eff('share_rel', 'share', 'none', [['big', 'one']])],
      goals: [goal('small', 'share', '<=', 'two', 'end', 'one_month', 'at most two')],
      options: [option('as_is', 'Carry on', [], 'carry on')],
    }));
    const capped = huge(1);
    expect(capped.errors).toEqual([]);
    expect(simulate(capped.executable!, { seed: 7, draws: 3 }).options[0]!.per_goal[0]).toEqual({ goal_id: 'small', withheld: { reason: 'invalid_domain', count: 3, quantities: ['share'] } });
    expect(exactInitialValues(capped.executable!).has('share')).toBe(false);
    // Contrast: with no ceiling the same finite value is one it can be, and the goal is worked out (not met).
    const free = huge(null).executable!;
    expect(simulate(free, { seed: 7, draws: 3 }).options[0]!.per_goal[0]).toEqual({ goal_id: 'small', chance: 0, precision_95: [0, 0] });
    expect(exactInitialValues(free).get('share')).toBe(1e308);
    // Codex r4: a value inside its ends needs no allowance, so an overflowed one never withholds it. (1e308 − 1e308) × 1e308 is 0
    // with an Infinity allowance; plus 0 against [0, 1] it is within, in every draw and as an initial value.
    const zeroed = compile(model({
      question: 'Is the share within one?', period: 'month',
      quantities: [person('a', '1', 1e308, 'a huge figure'), person('b', '1', 1e308, 'the same huge figure'), derived('cancel', '1'), derived('wide', '1'),
        person('none', '1', 0, 'none yet'), qty('one', '1', { kind: 'coefficient', value: 1, quote: 'one for one' }),
        { ...derived('share', '1'), floor: 0, ceiling: 1 }, person('two', '1', 2, 'at most two'), person('one_month', 'month', 1, 'this month')],
      relations: [def('cancel_rel', 'cancel', 'difference', ['a', 'b']), def('wide_rel', 'wide', 'product', ['cancel', 'a']), eff('share_rel', 'share', 'none', [['wide', 'one']])],
      goals: [goal('small', 'share', '<=', 'two', 'end', 'one_month', 'at most two')],
      options: [option('as_is', 'Carry on', [], 'carry on')],
    }));
    expect(zeroed.errors).toEqual([]);
    expect(simulate(zeroed.executable!, { seed: 7, draws: 3 }).options[0]!.per_goal[0]).toEqual({ goal_id: 'small', chance: 1, precision_95: [1, 1] });
    expect(exactInitialValues(zeroed.executable!).get('share')).toBe(0);
  });

  it('Codex r2 numbers#2 (4), S1 strip (A20b off) + GAP 2 (29 Oct): a window length given outside Olumi\'s reading of it is held, naming it, never asked again (spec §3.7); reversed bounds on it (A20d, kept) withhold', () => {
    const windowed = (f: Partial<CanonicalQuantityT>) => {
      const g = gymFilled();
      g.quantities = g.quantities.map((q) => (q.id === 'half_year' ? { ...q, value: 12, quote: 'within a year', ...f } : q));
      return compile(g);
    };
    const capped = windowed({ ceiling: 6 });
    expect(capped.errors).toEqual([]);
    for (const p of capped.perGoal) {
      expect(p, p.goal_id).toMatchObject({ status: 'withheld', asks: [], reasons: ['rests on "half year": it is 12 month, but Olumi reads it as at most 6 month.'] });
    }
    expect(capped.executable).toBeNull();
    const reversed = windowed({ floor: 10, ceiling: 5 });
    for (const p of reversed.perGoal) {
      expect(p, p.goal_id).toMatchObject({ status: 'withheld', asks: [], reasons: ['rests on "half year": Olumi reads "half year" as never below 10 month and never above 5 month, which leaves nothing it can be.'] });
    }
    expect(reversed.executable).toBeNull();
    // Contrast: within its reading the window is read, and run for 12 months.
    const roomy = windowed({ ceiling: 12 });
    expect(roomy.blockers).toEqual([]);
    expect(roomy.executable!.goals.map((x) => x.window)).toEqual([{ start_period: 0, periods: 12 }, { start_period: 0, periods: 12 }]);
  });

  it('DL ruling 4 (S2 law 9d34ef05+): a plausible range is a spread, never a point and never an invented domain; one with no room is HELD; a most likely figure at an end is an error', () => {
    const withCosts = (f: Partial<CanonicalQuantityT>) => { const m = bakery(); m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, ...f } : q)); return compile(m); };
    // A wide money range with no most likely figure: read unbounded (money carries no invented domain), so it calculates.
    const wide = withCosts({ low: 0, high: 1200, range_kind: 'plausible' });
    expect(wide.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    // W10: 0 to 1,200 around its middle, 600: σ = 600/1.2815516 = 468.18249 each side, the Normal on 600.
    expect(wide.conversions.find((c) => c.quantity === 'costs')).toMatchObject({ reading: unbounded(600, 468.18249, 468.18249, 600, 468.18249) });
    // A count whose WHOLE range is below 0 has no room inside what it can be: never pinned near 0, never read as a spread.
    // S1 strip (A20b off): it is never asked again; the law refuses it and it is HELD with the law's reason, whoever's it is.
    for (const author of ['person', 'olumi'] as const) {
      const g = gymFilled();
      g.quantities = g.quantities.map((q) => (q.id === 'members_now' ? { ...q, value: null, low: -1010, high: -990, range_kind: 'plausible' as const, floor: 0, author, ...(author === 'olumi' ? { status: 'estimated' as const, quote: null, basis: 'a guess' } : {}) } : q));
      const r = compile(g);
      expect(r.perGoal.find((p) => p.goal_id === 'reach_400'), author).toMatchObject({ status: 'withheld', asks: [] });
      expect(r.blockers.filter((b) => b.code === 'recount'), author).toEqual([]);
      expect(r.perGoal.find((p) => p.goal_id === 'reach_400')!.reasons.join(' '), author).toContain('the range -1010 to -990 has no room inside what it can be');
      expect(r.conversions.some((c) => c.quantity === 'members_now'), author).toBe(false);
      expect(r.perGoal.find((p) => p.goal_id === 'class_income'), author).toMatchObject({ status: 'calculable' }); // contrast
    }
    // Only a count's domain: a money range wholly below 0 (a loss) stays an ordinary spread.
    const loss = withCosts({ low: -700, high: -500, range_kind: 'plausible' });
    expect(loss.conversions.find((c) => c.quantity === 'costs')).toMatchObject({ kind: 'range_law', domain: null });
    const usable = withCosts({ low: 500, high: 700, range_kind: 'plausible' });
    expect(usable.perGoal.map((p) => p.status)).toEqual(['calculable', 'calculable']);
    expect(usable.conversions).toContainEqual({ kind: 'range_law', quantity: 'costs', low: 500, high: 700, range_kind: 'plausible', domain: null, reading: unbounded(600, 78.03041, 78.03041, 600, 78.03041), author: 'olumi', provisional: true }); // W10: σ = 100/1.2815516
    expect(xq(usable).get('costs')!.dist).toEqual({ kind: 'range', low: 500, high: 700, basis: 'person_range', range_kind: 'plausible' });
    const atEnd = withCosts({ value: 500, low: 500, high: 700, range_kind: 'plausible' });
    expect(atEnd.errors.map((e) => [e.code, e.items])).toEqual([['range_order', ['costs']]]);
    expect(atEnd.errors[0].message).toContain('at an end of its range');
    const m = bakery(); m.quantities = m.quantities.map((q) => (q.id === 'costs' ? { ...q, value: null, low: 500, high: 700, range_kind: 'plausible' as const } : q));
    expect(project(m).graph.nodes.find((n) => n.id === 'costs')!.display_value).toBe('500–700 GBP/week; Olumi reads it as a rough range, provisionally');
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
    m.risks.push({ id: 'breakdown', label: 'The oven breaks down', occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', direction: 'unknown', mode: 'add', starts_after_periods: 4, author: 'olumi', quote: null, ...base });
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
    // S1 strip (B13 off): Olumi's range with no kind is no error; it is read as plausible (compile.ts rangeDistOf).
    const noKind = bakery(); noKind.quantities = noKind.quantities.map((q) => (q.id === 'extra_per_oven' ? { ...q, range_kind: null } : q));
    expect(compile(noKind).errors).toEqual([]);
    expect(xq(compile(noKind)).get('extra_per_oven')!.dist).toMatchObject({ kind: 'range', range_kind: 'plausible', basis: 'olumi_estimate' });
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
    expect(project(bakery()).items.find((i) => i.record_id === 'extra_per_oven')!.law).toEqual({ author: 'olumi', provisional: true, range_kind: 'plausible', reading: EXTRA_PER_OVEN });
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
    const cases: [string, CanonicalModelT, { id: string; code: string; scope: string[]; reason?: string }[]][] = [
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
      ['S1 strip (A20b off): a range with no room is held, never a recount', edit(gymFilled(), (m) => { m.quantities = m.quantities.map((q) => (q.id === 'members_now' ? { ...q, value: null, low: -1010, high: -990, range_kind: 'plausible' as const, floor: 0 } : q)); }),
        []],
      ['S1 strip (B2 off): structure as written, no ask', edit(bakery(), (m) => { m.quantities = m.quantities.map((q) => (q.id === 'costs' ? structure('costs', 'GBP/week', 612.5, 'Costs.') : q)); }),
        []],
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
    // The structure figure passes through as the AI wrote it (B2 off): no ask, no question of the code's.
    expect(normalise(cases[7]![1]).quantities.find((q) => q.id === 'costs')).toMatchObject({ author: 'structure', status: 'known', value: 612.5, question: null });
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
  /** The price link as drawn: its direction, and that it carries no strength (W3b: its sign is its direction alone). */
  const linkOf = (m: CanonicalModelT) => {
    const e = (project(m).graph.edges as Record<string, unknown>[]).find((x) => x.from === 'price_rise' && x.to === 'sales')!;
    return { direction: e.effect_direction, strength: 'strength' in e };
  };
  const UNKNOWN = { status: 'unknown' as const, basis: 'Last year\'s sales after a price change would size it.' };
  const STRADDLES = { status: 'estimated' as const, low: -60, high: 20, range_kind: 'plausible' as const, basis: 'It could go either way.' };

  it('an unknown size that lowers what it moves is drawn negative; one that raises it, positive', () => {
    expect(linkOf(priced({ ...UNKNOWN, direction: 'lowers' }))).toEqual({ direction: 'negative', strength: false });
    expect(linkOf(priced({ ...UNKNOWN, direction: 'raises' }))).toEqual({ direction: 'positive', strength: false });
  });

  it('a range that spans zero takes its stated direction, not the sign of its centre', () => {
    // Contrast: with no stated direction the centre (-20) still decides, as before.
    expect(linkOf(priced({ ...STRADDLES, direction: null }))).toEqual({ direction: 'negative', strength: false });
    expect(linkOf(priced({ ...STRADDLES, direction: 'raises' }))).toEqual({ direction: 'positive', strength: false });
  });

  it('a range across zero with a most likely figure keeps that figure\'s sign, whatever the direction says (Codex r1 #3734)', () => {
    const across = { status: 'estimated' as const, low: -1, high: 1, range_kind: 'plausible' as const, basis: 'It could go either way, most likely a little down.' };
    expect(linkOf(priced({ ...across, value: -0.2, direction: 'raises' }))).toEqual({ direction: 'negative', strength: false });
    expect(linkOf(priced({ ...across, value: 0.2, direction: 'lowers' }))).toEqual({ direction: 'positive', strength: false });
  });

  it('a figure keeps its own sign: a stated direction never overrides it', () => {
    expect(linkOf(priced({ status: 'estimated', low: -60, high: -10, value: -30, range_kind: 'plausible', basis: 'Fewer loaves sell at a higher price.', direction: 'raises' })))
      .toEqual({ direction: 'negative', strength: false });
  });

  it('S1 strip (show, never hide): an unknown size with no stated direction is drawn with no sign and no strength; its record is on it', () => {
    const items = (m: CanonicalModelT) => new Map(project(m).items.map((i) => [i.record_id, i] as const));
    const linked = (m: CanonicalModelT) => (project(m).graph.edges as Record<string, unknown>[]).map((e) => `${String(e.from)}>${String(e.to)}`);
    const none = priced({ ...UNKNOWN, direction: null });
    const lowers = priced({ ...UNKNOWN, direction: 'lowers' });
    expect(linked(none)).toContain('price_rise>sales');
    expect(linkOf(none)).toEqual({ direction: undefined, strength: false });
    expect(linkOf(lowers), 'contrast: the same link with a direction has its sign').toEqual({ direction: 'negative', strength: false });
    expect(linked(none), 'the base level is still drawn').toContain('base_sales>sales');
    expect(items(none).get('price_effect')).toMatchObject({ shown_as: { on_edge: 'price_rise__sales' }, in_calculation: false, why_out: items(lowers).get('price_effect')!.why_out });
    expect(items(none).get('price_effect')!.why_out).toContain('unknown: Last year\'s sales after a price change would size it.');
    expect(items(none).get('sales_rel:price_rise')).toMatchObject({ shown_as: { edge: 'price_rise__sales' } });
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

  it('S1 strip (B3 off): the AI\'s direction is kept as written; the projection still draws a sign from a given size, never from a direction beside it', () => {
    const dirOf = (m: CanonicalModelT, id = 'price_effect') => normalise(m).quantities.find((x) => x.id === id)!.direction;
    const without = (m: CanonicalModelT, id = 'price_effect'): CanonicalModelT => ({ ...m, quantities: m.quantities.map((x) => (x.id === id ? { ...x, direction: null } : x)) });
    const ONE_SIDE = { status: 'estimated' as const, low: -60, high: -10, range_kind: 'plausible' as const, basis: 'Fewer loaves sell at a higher price.' };
    const stray = priced({ ...UNKNOWN, direction: null });
    stray.quantities.push(qty('stray_effect', 'loaf/week/GBP', { kind: 'coefficient', author: 'olumi', ...UNKNOWN, direction: 'lowers' }));
    // Kept as written: a figure is given; a range on one side of zero; a size no link has. What is drawn is the same with or without.
    for (const [m, id, said] of [[priced({ ...ONE_SIDE, value: -30, direction: 'raises' }), 'price_effect', 'raises'], [priced({ ...ONE_SIDE, direction: 'raises' }), 'price_effect', 'raises'], [stray, 'stray_effect', 'lowers']] as const) {
      expect(dirOf(m, id)).toBe(said);
      expect(project(m).graph).toEqual(project(without(m, id)).graph);
    }
    // An unknown size, and a range across zero, take their stated direction (issue 39), and it moves what is drawn.
    expect(dirOf(priced({ ...UNKNOWN, direction: 'lowers' }))).toBe('lowers');
    expect(dirOf(priced({ ...STRADDLES, direction: 'raises' }))).toBe('raises');
    expect(project(priced({ ...STRADDLES, direction: 'raises' })).graph).not.toEqual(project(priced({ ...STRADDLES, direction: null })).graph);
  });
});

describe('AIE §5 AMEND (DL 24 Oct): a first draft never waits on an ask no one can see', () => {
  const withQ = (m: CanonicalModelT, id: string, f: Partial<CanonicalQuantityT>): CanonicalModelT => ({ ...m, quantities: m.quantities.map((q) => (q.id === id ? { ...q, ...f } : q)) });
  it('S1 strip (B7, B2 off): an asked figure with no question is no error on a first draft either: it is the typed blocker only', () => {
    const noQ = withQ(gym(), 'leavers', { question: null });
    for (const opts of [{ asksNeedQuestions: true }, {}]) {
      const r = compile(noQ, opts);
      expect(codes(r)).toEqual([]);
      expect(r.blockers.map((b) => [b.id, b.code])).toContainEqual(['leavers', 'asked']);
    }
    expect(codes(compile(withQ(gym(), 'leavers', { question: '  ' }), { asksNeedQuestions: true }))).toEqual([]);
    // A figure the AI labels structure is read as written (B2 off): no ask, no error, first draft or not.
    const mislabelled = withQ(gym(), 'joins', { author: 'structure', quote: null, basis: 'Today.' });
    expect(codes(compile(mislabelled, { asksNeedQuestions: true }))).toEqual([]);
    expect(compile(mislabelled).blockers.map((b) => b.id)).not.toContain('joins');
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
    // S1 strip (B7 off): the same lever asked with no question is no error on a first draft; it waits as a typed ask.
    const askedShare = compile(withQ(division, 'share', { author: 'person', status: 'asked', value: null, basis: null }), { asksNeedQuestions: true });
    expect(codes(askedShare)).toEqual([]);
    expect(askedShare.blockers.map((b) => [b.id, b.code])).toContainEqual(['share', 'asked']);
  });
});
