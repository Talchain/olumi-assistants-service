import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { goalChanceDriverOf } from '../../../goal-target/goal-chance-driver.js';
import { convertingOlumiEstimate } from '../../../admission/target-testability.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id)!;
function money() {
  const m = structuredClone(KNOWN_ANSWER);
  Object.assign(m.aims[0]!.target!, { unit: '£ per month', value: 80000, current: 40000 });
  Object.assign(m.factors[0]!, { unit: '£ per month', value: 40 });
  Object.assign(m.options[1]!.settings[0]!, { unit: '£ per month', value: 50 });
  Object.assign(m.links[0]!, { source: 'olumi', quote: null });
  Object.assign(m.links[0]!.effect, { unit: '£ per month', form: 'normal', value: 200, sd: 40 });
  return m;
}

describe('B1: quantity-owned frames and honest range conversion', () => {
  it('equal unit strings do not give a unit price the total revenue frame; natural effects survive a changed target', () => {
    const m = money(), before = structuredClone(m);
    const a = mapLivingModel(m), f = node(a.graph, 'f'), g = node(a.graph, 'g');
    expect(f.observed_state.cap).toBe(62.5);
    expect(f.observed_state.raw_value).toBe(40);
    expect(f.observed_state.source).toBe('brief_extraction');
    const e = a.graph.edges.find((x: Rec) => x.id === 'f_g')!;
    expect((e.strength as Rec).mean * g.goal_threshold_cap / f.observed_state.cap).toBeCloseTo(200, 12);
    m.aims[0]!.target!.value = 160000;
    const b = mapLivingModel(m), next = b.graph.edges.find((x: Rec) => x.id === 'f_g')!;
    expect(node(b.graph, 'f').observed_state).toEqual(f.observed_state);
    expect((next.strength as Rec).mean * node(b.graph, 'g').goal_threshold_cap / f.observed_state.cap).toBeCloseTo(200, 12);
    expect(before.factors).toEqual(m.factors);
    expect(before.options).toEqual(m.options);
  });

  it('a limit participates in its own numerical frame before link conversion, without changing the limit or figure', () => {
    const m = money();
    Object.assign(m.factors[0]!, { unit: '£', value: 0, low: 0, high: 20000,
      limit: { comparator: '<=', value: 20000, source: 'user', party: null, quote: 'spend at most £20,000' } });
    Object.assign(m.options[1]!.settings[0]!, { unit: '£', value: 15000 });
    const before = structuredClone(m), out = mapLivingModel(m);
    expect(node(out.graph, 'f').observed_state.cap).toBe(25000);
    expect((out.graph as Rec).goal_constraints).toContainEqual(expect.objectContaining({ node_id: 'f', value: 20000, value_frame: 'level', provenance: 'explicit' }));
    expect(out.withheld).not.toContainEqual({ id: 'f', reason: 'limit_not_in_slice' });
    expect(m).toEqual(before);
    // A real percentage domain is not widened to make an invalid limit fit.
    Object.assign(m.factors[0]!, { unit: '%', low: null, high: null, limit: { ...m.factors[0]!.limit!, value: 150 } });
    Object.assign(m.options[1]!.settings[0]!, { unit: '%', value: 40 });
    expect(node(mapLivingModel(m).graph, 'f').observed_state.cap).toBe(100);
    expect(mapLivingModel(m).withheld).toContainEqual({ id: 'f', reason: 'limit_not_in_slice' });
  });

  it('a bare observed range keeps its source words and bounds; only the derived centre and Normal moments are Olumi’s', () => {
    const m = structuredClone(KNOWN_ANSWER);
    m.factors.push({ ...m.factors[0]!, id: 'context', label: 'Available time', value: null, low: 20, high: 30, unit: '%', quote: 'available time is 20–30%' });
    m.links.push({ ...m.links[0]!, id: 'context_g', from: 'context', effect: { ...m.links[0]!.effect, value: 10, sd: 2 } });
    const before = structuredClone(m), out = mapLivingModel(m), context = node(out.graph, 'context');
    expect(context.observed_state).toMatchObject({ raw_value: 25, value: 0.25, cap: 100, source: 'cee_inference', std_source: 'olumi' });
    expect(context.observed_state).not.toHaveProperty('extractionType', 'explicit');
    expect(context.observed_state.std).toBeCloseTo(10 / Math.sqrt(12) / 100, 14);
    expect(context.observed_state.uncertainty_defaults[0].reason).toContain('without a central figure');
    expect(context.observed_state.uncertainty_defaults[0].reason).toContain('Normal');
    expect(context.observed_state.uncertainty_defaults[0].reason).toContain('not bounds on the draws');
    expect(out.withheld).not.toContainEqual({ id: 'context', reason: 'level_range_not_in_slice' });
    expect(m).toEqual(before);
    expect(GraphV3.parse({ ...out.graph, living_model: m }).living_model).toEqual(before);
    expect(GraphV3.parse({ ...out.graph, living_model: m }).nodes.find(n => n.id === 'context')!.observed_state).toEqual(context.observed_state);
  });

  it('the real mapper → saved graph → driver preserves the person’s range author, separately from Normal conversion', () => {
    const m = structuredClone(KNOWN_ANSWER);
    m.factors.push({ ...m.factors[0]!, id: 'capacity', label: 'Capacity', value: 20, low: 10, high: 30, unit: 'cases', quote: 'Capacity is 20 cases, between 10 and 30.' });
    const row = { quantity_id: 'capacity', kind: 'factor_value', p_goal_if_low: 0.3, p_goal_if_high: 0.6,
      n_low: 333, n_high: 333, spread: 0.3, status: 'resolved', spread_noise_floor: 0.08, correlated: false,
      low_upper_display: 15, high_lower_display: 25, display_unit: 'cases' };
    const record = { probability_of_goal_drivers: { method: 'tercile_conditional_v1', min_group_n: 30,
      n_candidates: 1, n_compared: 1, n_dropped: 0, dropped_by_reason: {}, drivers: [row] } };
    for (const value of [20, null]) for (const source of ['user', 'olumi', 'party', 'unverified'] as const) {
      Object.assign(m.factors[1]!, { value, source, party: source === 'party' ? 'Operations' : null });
      const graph = GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m });
      const state = node(graph, 'capacity').observed_state;
      expect(state.std_source).toBe('olumi'); // PLoT must still map this to ISL spread_source: template.
      expect(state.range_basis).toEqual({ low: 10, high: 30, source });
      const author = source === 'user' ? 'user' : source === 'olumi' ? 'olumi' : 'unattributed';
      const claim = goalChanceDriverOf(record, 'push', graph, { factor_evppi: [{ factor_id: 'capacity', spread_source: 'template' }] });
      expect('driver' in claim ? claim.driver.authored_by : claim).toBe(author);
      expect(state.uncertainty_defaults[0].reason).toContain('Olumi');
      const changed = structuredClone(graph);
      node(changed, 'capacity').observed_state.std *= 2;
      const rejected = goalChanceDriverOf(record, 'push', changed, {});
      expect('driver' in rejected ? rejected.driver.authored_by : rejected).toBe('unattributed');
    }
  });

  it('does not turn a bare intervention range, one-sided range or unsafe positive Normal into a point assumption', () => {
    const m = structuredClone(KNOWN_ANSWER);
    Object.assign(m.factors[0]!, { value: null, low: 20, high: 30, unit: '%' });
    expect(node(mapLivingModel(m).graph, 'f')).not.toHaveProperty('observed_state');
    m.options[1]!.settings = [];
    for (const [low, high] of [[20, null], [0, 8], [30, 20]] as const) {
      Object.assign(m.factors[0]!, { low, high });
      const out = mapLivingModel(m);
      expect(node(out.graph, 'f')).not.toHaveProperty('observed_state');
      expect(out.withheld).toContainEqual({ id: 'f', reason: 'level_range_not_in_slice' });
    }
  });
});

describe('B1: a finite natural-unit conversion has no artificial coefficient ceiling', () => {
  function graph(mean: number): Rec {
    return { nodes: [
      { id: 'f', kind: 'factor', observed_state: { cap: 100, unit: '£ per month', value: 0.2, raw_value: 20 } },
      { id: 'g', kind: 'goal', goal_threshold_cap: 100, goal_threshold_unit: '£ per month', goal_threshold: 0.8,
        observed_state: { cap: 100, unit: '£ per month', value: 0.4, raw_value: 40 } },
    ], edges: [{ from: 'f', to: 'g', strength: { mean, std: Math.abs(mean) / 2 }, exists_probability: 0.8,
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: mean,
        amount_unit: '£ per month', per_source_change: 1, per_source_change_unit: '£ per month', strength_mean: mean, strength_mean_frame: 'edge_strength' } } }] };
  }
  it.each([300, -4])('preserves conversion for coefficient %s while rejecting changed units, sizes or frames', (mean) => {
    const g = graph(mean);
    expect(convertingOlumiEstimate(g.edges[0], g, 'g')).toBe(true);
    const stale = structuredClone(g);
    stale.edges[0].provenance.natural_effect.amount *= 2;
    expect(convertingOlumiEstimate(stale.edges[0], stale, 'g')).toBe(false);
    const frame = structuredClone(g);
    frame.nodes[0].observed_state.cap = 50;
    expect(convertingOlumiEstimate(frame.edges[0], frame, 'g')).toBe(false);
    const unit = structuredClone(g);
    unit.edges[0].provenance.natural_effect.amount_unit = 'hours';
    expect(convertingOlumiEstimate(unit.edges[0], unit, 'g')).toBe(false);
  });
});
