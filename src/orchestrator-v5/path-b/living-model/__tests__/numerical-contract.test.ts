import { readFileSync } from 'node:fs';
import { LivingModel } from '../../../../schemas/living-model.js';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { decisionSensitivityOf, analysisResultForAgent } from '../../../agent-lane/decision-sensitivity.js';
import { assembleGuidanceSignals } from '../../../agent-lane/turn-context/guidance-signals.js';
import { runFactsOf } from '../../../agent-lane/run-facts.js';
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

  it('Paul’s actual 459f8bde MRR model retains the £49→£59 frame and natural effect without changing budget handling', () => {
    // User-provided export SHA256 95d5526063aa9482e65328cab41380c058cefa7518e4d296646587a67ad69192.
    // Exact saved living_model only (no user/session identifiers or responses); this is a development regression.
    const m = LivingModel.parse(JSON.parse(readFileSync(new URL('./fixtures/mrr-459f8bde-living-model.json', import.meta.url), 'utf8')));
    const before = structuredClone(m), out = mapLivingModel(m);
    const price = node(out.graph, 'price'), edge = out.graph.edges.find(e => e.id === 'price_mrr')!;
    expect(price.observed_state).toMatchObject({ raw_value: 49, cap: 59 * 1.25, source: 'brief_extraction' });
    expect(node(out.graph, 'features_price').interventions.price.raw_value).toBe(59);
    expect((edge.strength as Rec).mean * out.frames.get('mrr')!.cap / out.frames.get('price')!.cap).toBeCloseTo(300, 12);
    expect(convertingOlumiEstimate(edge, out.graph, 'mrr')).toBe(true);
    expect((out.graph as Rec).goal_constraints).toBeUndefined(); // B1 does not change the existing off-frame-limit path.
    expect(node(out.graph, 'spend').observed_state.cap).toBe(18750);
    expect(out.withheld).toContainEqual({ id: 'spend', reason: 'limit_not_in_slice' });
    expect(m).toEqual(before); // The churn aim, conditions, risk, quotes and authorship are not simplified away.
  });

  it('the real mapper → saved graph → driver preserves the person’s range author, separately from Normal conversion', () => {
    const m = structuredClone(KNOWN_ANSWER);
    m.factors.push({ ...m.factors[0]!, id: 'capacity', label: 'Capacity', value: 20, low: 10, high: 30, unit: 'cases', quote: 'Capacity is 20 cases, between 10 and 30.' });
    const row = { quantity_id: 'capacity', kind: 'factor_value', p_goal_if_low: 0.3, p_goal_if_high: 0.6,
      n_low: 333, n_high: 333, spread: 0.3, status: 'resolved', spread_noise_floor: 0.08, correlated: false,
      low_upper_display: 15, high_lower_display: 25, display_unit: 'cases' };
    const record = { probability_of_goal_drivers: { method: 'tercile_conditional_v1', min_group_n: 30,
      n_candidates: 1, n_compared: 1, n_dropped: 0, dropped_by_reason: {}, drivers: [row] } };
    for (const source of ['user', 'olumi', 'party', 'unverified'] as const) {
      Object.assign(m.factors[1]!, { source, party: source === 'party' ? 'Operations' : null });
      const graph = GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m });
      const state = node(graph, 'capacity').observed_state;
      expect(state.std_source).toBe('olumi'); // PLoT must still map this to ISL spread_source: template.
      expect(state.range_source).toBe(source);
      const author = source === 'user' ? 'user' : source === 'olumi' ? 'olumi' : 'unattributed';
      const claim = goalChanceDriverOf(record, 'push', graph, { factor_evppi: [{ factor_id: 'capacity', spread_source: 'template' }] });
      expect('driver' in claim ? claim.driver.authored_by : claim).toBe(author);
      expect(state.uncertainty_defaults[0].reason).toContain('Olumi');
      const enrichment = { factor_evppi: [{ factor_id: 'capacity', evppi: 0.1, status: 'resolved', spread_source: 'template' }],
        factor_sensitivity: [{ factor_id: 'capacity', factor_label: 'Capacity' }] };
      const expectedRange = source === 'user' ? 'yours' : source === 'olumi' ? 'olumi_assumed' : undefined;
      const selected = decisionSensitivityOf(enrichment, graph);
      expect(selected.status).toBe('measured');
      expect('most_sensitive' in selected ? selected.most_sensitive.range : null).toBe(expectedRange);
      const block = { enrichment };
      expect((analysisResultForAgent(block, graph) as Rec).decision_sensitivity).toEqual(selected);
      const guidance = assembleGuidanceSignals({ request: 'turn', graph, analysisResult: block,
        analysisState: { run_state: { kind: 'complete_current' } }, offeredSpecific: [], leaderLicensed: true });
      expect(guidance['run.decision_sensitivity']).toEqual({ status: 'measured', most_sensitive: {
        factor_id: 'capacity', label: 'Capacity', ...(expectedRange === undefined ? {} : { range: expectedRange }) } });
      expect(runFactsOf(block, graph, true).sensitivity).toEqual({ measured: true, most_sensitive: 'Capacity' });
      expect(runFactsOf(block, graph, false).sensitivity).toEqual({ measured: false });

      const noModel = { ...graph, living_model: undefined };
      const unbound = goalChanceDriverOf(record, 'push', noModel, {});
      expect('driver' in unbound ? unbound.driver.authored_by : unbound).toBe('unattributed');
      const unboundSensitivity = decisionSensitivityOf(enrichment, noModel);
      expect('most_sensitive' in unboundSensitivity ? unboundSensitivity.most_sensitive.range : null).toBeUndefined();
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
