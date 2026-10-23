import { describe, expect, it } from 'vitest';
import { LivingModel } from '../../../../schemas/living-model.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { applyKernel, canonicalIds } from '../kernel.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const byId = (graph: Rec, id: string): Rec => graph.nodes.find((n: Rec) => n.id === id)!;
function recurring() {
  const m = structuredClone(KNOWN_ANSWER);
  const own = { source: 'olumi' as const, party: null, quote: null };
  const f = (id: string, value: number | null, unit: string) => ({ ...m.factors[0]!, ...own, id, label: id, value, unit });
  m.factors = [f('stock', 1000, 'customers'), f('loss', 3, '% per month'), f('inflow', 100, 'customers per month'),
    f('price', 50, '£ per customer per month'), { ...f('future', null, 'customers'), kind: 'outcome', accumulation: {
      stock_today: 'stock', loss_rate_per_month: 'loss', inflow_per_month: 'inflow', horizon_months: 6, ...own } }];
  Object.assign(m.aims[0]!.target!, { value: 100000, current: 50000, unit: '£ per month', period_months: 6 });
  m.aims[0]!.defined_as = { op: 'product', of: ['future', 'price'], ...own };
  m.options[1]!.settings = [{ ...m.options[1]!.settings[0]!, factor_id: 'inflow', value: 150, unit: 'customers per month', ...own }];
  m.links = [];
  return m;
}

describe('canonical accumulation and all-target compilation', () => {
  it('keeps old saved forms unchanged and refuses competing or self-referencing mechanisms', () => {
    const old = structuredClone(KNOWN_ANSWER);
    expect(LivingModel.parse(old)).toEqual(old);
    const m = recurring();
    expect(LivingModel.safeParse(m).success).toBe(true);
    m.factors[4]!.defined_as = { op: 'sum', of: ['stock', 'inflow'], source: 'olumi', quote: null, party: null };
    expect(LivingModel.safeParse(m).success).toBe(false);
    m.factors[4]!.defined_as = null;
    m.factors[4]!.accumulation!.stock_today = 'future';
    expect(LivingModel.safeParse(m).success).toBe(false);
  });

  it('uses the existing accumulation carrier, with no future point, invented zero stock or new evaluator', () => {
    const m = recurring(), before = structuredClone(m), out = mapLivingModel(m);
    const future = byId(out.graph, 'future');
    expect(future).toMatchObject({ kind: 'outcome', nonlinear_identity: { operation: 'accumulation',
      factor_ids: ['stock', 'loss', 'inflow'], horizon_months: 6, rate_scale: 0.01, stated_in_brief: false } });
    expect(future.scale_frame).toBeGreaterThan(0);
    expect(future).not.toHaveProperty('observed_state');
    expect(out.withheld).not.toContainEqual({ id: 'future', reason: 'identity_not_in_slice' });
    expect(out.graph.edges.filter(e => e.to === 'future').map(e => e.from).sort()).toEqual(['inflow', 'loss', 'stock']);
    const saved = GraphV3.parse({ ...out.graph, living_model: m });
    expect(byId(saved, 'future').nonlinear_identity).toEqual(future.nonlinear_identity);
    expect(saved.living_model).toEqual(before);
    expect(m).toEqual(before);
  });

  it('holds a missing stock, annual loss rate, nonmatching horizon or future point without supplying a replacement', () => {
    for (const variant of ['stock', 'rate', 'horizon', 'point', 'origin', 'window', 'units']) {
      const m = recurring();
      if (variant === 'stock') m.factors[0]!.value = null;
      if (variant === 'rate') m.factors[1]!.unit = '% per year';
      if (variant === 'horizon') m.factors[4]!.accumulation!.horizon_months = 3;
      if (variant === 'point') m.factors[4]!.value = 0;
      if (variant === 'origin') m.aims[0]!.target!.reference = 'launch';
      if (variant === 'window') m.aims[0]!.target!.period_kind = 'over_period';
      if (variant === 'units') m.factors[2]!.unit = 'customers per year';
      const before = structuredClone(m), out = mapLivingModel(m);
      expect(byId(out.graph, 'future')).not.toHaveProperty('nonlinear_identity');
      expect(out.withheld).toContainEqual({ id: 'future', reason: 'identity_not_in_slice' });
      expect(m).toEqual(before);
    }
  });

  it('canonicalises all three references and checks mechanism authorship independently of the quantity', () => {
    const m = recurring();
    m.factors[0]!.id = 'Stock today!';
    m.factors[4]!.accumulation!.stock_today = 'Stock today!';
    const canonical = canonicalIds(m);
    expect(canonical.factors[4]!.accumulation!.stock_today).toBe('stock_today');
    Object.assign(m.factors[4]!.accumulation!, { source: 'user', quote: 'This is the monthly mechanism.' });
    const checked = applyKernel(m, []);
    expect(checked.model.factors[4]!.source).toBe('olumi');
    expect(checked.model.factors[4]!.accumulation!.source).toBe('unverified');
    expect(applyKernel(m, ['This is the monthly mechanism.']).model.factors[4]!.accumulation!.source).toBe('user');
  });

  it('sends both targets and independent limits on the same graph, preserving strictness and authorship', () => {
    const m = structuredClone(KNOWN_ANSWER);
    const extra = structuredClone(m.aims[0]!);
    Object.assign(extra, { id: 'churn', text: 'Keep monthly churn under 4%', quote: 'keep monthly churn under 4%' });
    Object.assign(extra.target!, { comparator: '<', value: 4, current: 3, unit: '%' });
    m.aims.push(extra);
    m.links.push({ ...m.links[0]!, id: 'f_churn', to: 'churn', effect: { ...m.links[0]!.effect, unit: '%' } });
    const before = structuredClone(m), out = mapLivingModel(m), graph = out.graph as Rec;
    expect(graph.nodes.filter((n: Rec) => n.kind === 'goal')).toHaveLength(1);
    expect(byId(graph, 'churn').observed_state.raw_value).toBe(3);
    expect(graph.goal_constraints).toContainEqual(expect.objectContaining({ node_id: 'g', role: 'goal_target' }));
    expect(graph.goal_constraints).toContainEqual(expect.objectContaining({ node_id: 'churn', role: 'goal_target',
      value: 4, operator: '<=', operator_as_stated: '<', unit: '%' }));
    expect(out.withheld).not.toContainEqual({ id: 'churn', reason: 'aim_not_in_slice' });
    expect(GraphV3.parse({ ...graph, living_model: m }).living_model).toEqual(before);
    expect(m).toEqual(before);
  });

  it('retains an unknown limit unscored instead of omitting it from the full joint', () => {
    const m = structuredClone(KNOWN_ANSWER);
    m.factors.push({ ...m.factors[0]!, id: 'cost', value: null, unit: '£', limit: { comparator: '<=', value: 20000,
      source: 'user', party: null, quote: 'spend at most £20,000' } });
    const out = mapLivingModel(m), graph = out.graph as Rec;
    expect(graph.goal_constraints).toContainEqual(expect.objectContaining({ node_id: 'cost', value: 20000,
      retained_unresolved_limit: expect.objectContaining({ state: 'unscored' }) }));
    expect(byId(graph, 'cost')).toMatchObject({ analysis_participation: 'retained_excluded' });
    expect(byId(graph, 'cost')).not.toHaveProperty('observed_state');
  });

  it('keeps launch origin separate from a first-three-month observation window', () => {
    const m = structuredClone(KNOWN_ANSWER);
    Object.assign(m.aims[0]!.target!, { period_months: 3, reference: 'launch', period_kind: 'over_period' });
    expect(byId(mapLivingModel(m).graph, 'g').goal_target_basis).toMatchObject({ reference: 'launch', period_kind: 'over_period', period_months: 3 });
    expect(m.aims[0]!.target!.period_months).toBe(3);
  });
});
