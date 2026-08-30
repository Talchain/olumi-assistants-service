import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphV3T, NodeV3T } from '../../../schemas/cee-v3.js';

const gate = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, features: { ...actual.config.features, get factorQuantificationEnabled() { return gate.enabled; } } } };
});

import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../analysis-ready-helper.js';

const edge = (from: string, to: string): GraphV3T['edges'][number] => ({
  from, to, strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
});

/** The two .12/.24 interventions differ; only the independent demand baseline is absent. */
function graph(quantity: Partial<NodeV3T> = {}): GraphV3T {
  return {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Expansion approach' },
      { id: 'goal', kind: 'goal', label: 'Sustainable revenue' },
      { id: 'option_a', kind: 'option', label: 'Expand gradually', interventions: { capacity: 0.12 } },
      { id: 'option_b', kind: 'option', label: 'Expand quickly', interventions: { capacity: 0.24 } },
      { id: 'capacity', kind: 'factor', label: 'Delivery capacity', category: 'controllable', observed_state: { value: 0.1, source: 'user_override' } },
      { id: 'demand', kind: 'factor', label: 'Customer demand', category: 'external', ...quantity },
      { id: 'revenue', kind: 'outcome', label: 'Revenue' },
    ],
    edges: [edge('decision', 'option_a'), edge('decision', 'option_b'), edge('option_a', 'capacity'), edge('option_b', 'capacity'), edge('capacity', 'revenue'), edge('demand', 'revenue'), edge('revenue', 'goal')],
  };
}

const explicitUnknown: Partial<NodeV3T> = {
  prior: { prior_is_unquantified: true, source: 'cee_inference', reasoning: { rationale: 'No evidence bounds demand in this market.', context_basis: [] } },
};
const quantityIssues = (g: unknown) => resolveRunAdmission(g).assessment.blockingIssues.filter(i => i.code === 'FACTOR_QUANTITY_UNKNOWN');
beforeEach(() => { gate.enabled = false; });

describe('required factor quantities use actual retained comparison dependencies', () => {
  it('gates a newly detected missing baseline only when the producer is enabled', () => {
    const model = graph();
    expect(resolveRunAdmission(model).willProceed).toBe(true);
    expect(quantityIssues(model)).toEqual([]);
    gate.enabled = true;
    const admission = resolveRunAdmission(model);
    expect(admission.willProceed).toBe(false);
    expect(admission.assessment.blockingIssues).toEqual([expect.objectContaining({
      code: 'FACTOR_QUANTITY_UNKNOWN', category: 'numeric_integrity', factor_id: 'demand', factor_label: 'Customer demand', repairability: 'human_input_required', obligation: 'required',
    })]);
    expect(admission.blockedNextStep).toContain('Customer demand');
    expect(admission.assessment.blockingIssues[0]).not.toHaveProperty('option_id');
    expect(buildCanonicalAnalysisReadyFromGraph(model)).toMatchObject({ status: 'blocked', may_run: false, blocked_reason: 'FACTOR_QUANTITY_UNKNOWN' });
  });

  it('persists the safety boundary for explicit nonnumeric unknown after the producer is disabled', () => {
    for (const enabled of [true, false]) {
      gate.enabled = enabled;
      const admission = resolveRunAdmission(graph(explicitUnknown));
      expect(admission.willProceed).toBe(false);
      expect(quantityIssues(graph(explicitUnknown))).toHaveLength(1);
    }
  });

  it('keeps a persisted bare nonnumeric unknown safe without requiring model attribution', () => {
    const model = graph({ prior: { prior_is_unquantified: true } });
    expect(gate.enabled).toBe(false);
    expect(quantityIssues(model)).toEqual([expect.objectContaining({
      code: 'FACTOR_QUANTITY_UNKNOWN', factor_id: 'demand', obligation: 'required',
    })]);
    expect(resolveRunAdmission(model).willProceed).toBe(false);
  });

  it.each([0.12, 0.24])('preserves unattributed numerical baseline %s without assigning new provenance', (value) => {
    gate.enabled = true;
    const model = graph({ observed_state: { value } });
    const before = JSON.stringify(model);
    expect(quantityIssues(model)).toEqual([]);
    expect(resolveRunAdmission(model).willProceed).toBe(true);
    expect(JSON.stringify(model)).toBe(before);
  });

  it.each([0.12, 0.24])('preserves supplied baseline %s beside old flagged numeric prior residue', (value) => {
    gate.enabled = true;
    const model = graph({ observed_state: { value, source: 'user_override' }, prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true } });
    expect(quantityIssues(model)).toEqual([]);
    expect(resolveRunAdmission(model).willProceed).toBe(true);
  });

  it.each([
    { distribution: 'uniform', range_min: 0.12, range_max: 0.24 },
    { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true },
    { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, source: 'user_override' },
    { distribution: 'uniform', range_min: 0.12, range_max: 0.24, value_tier: 'fallback_default' },
  ] satisfies NonNullable<NodeV3T['prior']>[])('does not turn existing numeric distribution policy into an absent-value blocker: %j', (prior) => {
    gate.enabled = true;
    const model = graph({ prior });
    expect(quantityIssues(model)).toEqual([]);
    expect(resolveRunAdmission(model).willProceed).toBe(true);
  });

  it('requires no baseline when every retained option supplies a do override', () => {
    gate.enabled = true;
    const model = graph(explicitUnknown);
    model.nodes = model.nodes.map(node => node.kind === 'option'
      ? { ...node, interventions: { ...node.interventions, demand: node.id === 'option_a' ? 0.2 : 0.8 } }
      : node);
    model.edges.push(edge('option_a', 'demand'), edge('option_b', 'demand'));
    expect(quantityIssues(model)).toEqual([]);
    expect(resolveRunAdmission(model).willProceed).toBe(true);
  });

  it('does not let an excluded option create a baseline requirement for retained do overrides', () => {
    gate.enabled = true;
    const model = graph(explicitUnknown);
    model.nodes = model.nodes.map(node => node.kind === 'option'
      ? { ...node, interventions: { ...node.interventions, demand: node.id === 'option_a' ? 0.2 : 0.8 } }
      : node);
    model.nodes.push({ id: 'option_excluded', kind: 'option', label: 'Unconfigured proposal' });
    model.edges.push(edge('option_a', 'demand'), edge('option_b', 'demand'), edge('decision', 'option_excluded'), edge('option_excluded', 'demand'));
    const admission = resolveRunAdmission(model);
    expect(admission.plan.scaffolded_option_ids).toContain('option_excluded');
    expect(quantityIssues(model)).toEqual([]);
    expect(admission.willProceed).toBe(true);
  });

  it('does not turn excluded status-quo recovery into a blocker for two configured comparisons', () => {
    gate.enabled = true;
    const model = graph(explicitUnknown);
    model.nodes = model.nodes.map(node => node.kind === 'option'
      ? { ...node, interventions: { ...node.interventions, demand: node.id === 'option_a' ? 0.2 : 0.8 } }
      : node);
    model.nodes.push({ id: 'status_quo', kind: 'option', label: 'Keep current demand', is_baseline: true });
    model.edges.push(edge('option_a', 'demand'), edge('option_b', 'demand'), edge('decision', 'status_quo'), edge('status_quo', 'demand'));
    const admission = resolveRunAdmission(model);
    expect(admission.plan.scaffolded_option_ids).toContain('status_quo');
    expect(quantityIssues(model)).toEqual([]);
    expect(admission.willProceed).toBe(true);
  });

  it('does not waive an actually consumed baseline through the existing missing-effect waiver', () => {
    gate.enabled = true;
    const model = graph(explicitUnknown);
    // Only controllable factor edges mint the existing option-effect obligation.
    // Both options remain valued via capacity, so compute-discard can answer
    // those edge-only gaps without answering the root baseline they still read.
    model.nodes = model.nodes.map(node => node.id === 'demand' ? { ...node, category: 'controllable' } : node);
    model.edges.push(edge('option_a', 'demand'), edge('option_b', 'demand'));
    const admission = resolveRunAdmission(model);
    expect(admission.assessment.blockingIssues.some(i => i.code === 'MISSING_OPTION_VALUE')).toBe(true);
    expect(admission.willProceed).toBe(false);
    expect(quantityIssues(model)).toEqual([expect.not.objectContaining({ waived_by_exclusion: true })]);
    const suppliedBaseline = {
      ...model,
      nodes: model.nodes.map(node => {
        if (node.id !== 'demand') return node;
        const { prior: _prior, ...rest } = node;
        return { ...rest, observed_state: { value: 0.4, source: 'user_override' } };
      }),
    };
    const twin = resolveRunAdmission(suppliedBaseline);
    expect(twin.assessment.blockingIssues.some(i => i.code === 'MISSING_OPTION_VALUE')).toBe(true);
    expect(twin.willProceed).toBe(true);
    expect(quantityIssues(suppliedBaseline)).toEqual([]);
  });

  it('does not require an independently sampled baseline for a factor computed from parents', () => {
    gate.enabled = true;
    const model = graph(explicitUnknown);
    model.edges.push(edge('capacity', 'demand'));
    expect(quantityIssues(model)).toEqual([]);
    expect(resolveRunAdmission(model).willProceed).toBe(true);
  });

  it('publishes calibration as factor_value rather than option effect or scale repair', () => {
    gate.enabled = true;
    const model = graph(explicitUnknown);
    model.nodes.push({ id: 'retention', kind: 'factor', label: 'Retention', category: 'external', ...explicitUnknown });
    model.edges.push(edge('retention', 'revenue'));
    const admission = resolveRunAdmission(model);
    expect(admission.willProceed).toBe(false);
    const inputs = admission.assessment.repairProposal?.unresolved_inputs;
    expect(inputs).toHaveLength(2);
    expect(inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'factor_value', factor_id: 'demand' }),
      expect.objectContaining({ kind: 'factor_value', factor_id: 'retention' }),
    ]));
  });
});
