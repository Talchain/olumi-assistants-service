import { describe, expect, it } from 'vitest';
import { GraphV3, NodeKindV3, type GraphV3T, type NodeV3T } from '../../../schemas/cee-v3.js';
import { gateAnalysableOptions } from '../../../orchestrator-v5/tools/handlers/analysable-option-gate.js';
import { comparisonFactorRequirements, requiredFactorInputs, selectQuantificationGaps } from '../select.js';

const edge = (from: string, to: string): GraphV3T['edges'][number] => ({
  from, to, strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
});
const readOption = [{ id: 'reader', interventions: {} }];
const options = (graph: GraphV3T): Record<string, unknown>[] => graph.nodes.filter(node => node.kind === 'option');
const node = (graph: GraphV3T, id: string) => graph.nodes.find(item => item.id === id)!;
const currentKinds = ['factor', 'risk', 'outcome', 'action', 'goal', 'option', 'decision'] as const;

function parentGraph(kind: NodeV3T['kind']): GraphV3T {
  return {
    nodes: [
      { id: 'parent', kind, label: 'Existing parent', observed_state: { value: 0.7, source: 'user_override' } },
      { id: 'factor', kind: 'factor', label: 'Intermediate factor' },
      { id: 'target', kind: 'goal', label: 'Requested target' },
    ],
    edges: [edge('parent', 'factor'), edge('factor', 'target')],
  };
}

function statusQuoGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'target', kind: 'goal', label: 'Requested target' },
      { id: 'baseline', kind: 'option', label: 'Keep current', is_baseline: true, interventions: {} },
      { id: 'candidate', kind: 'option', label: 'Change input', interventions: { factor: 0.8 } },
      { id: 'factor', kind: 'factor', label: 'Current input', category: 'controllable' },
    ],
    edges: [edge('baseline', 'factor'), edge('candidate', 'factor'), edge('factor', 'target')],
  };
}

describe('baseline requirements follow the current inference graph', () => {
  it('covers every supported canonical kind with independent causal/structural controls', () => {
    expect([...NodeKindV3.options].sort()).toEqual([...currentKinds].sort());
  });

  it.each(['factor', 'risk', 'outcome', 'action', 'goal'] as const)('%s parent makes the factor derived, so its baseline is not an input', kind => {
    const graph = parentGraph(kind);
    expect(GraphV3.safeParse(graph).success).toBe(true);
    const requirements = requiredFactorInputs(graph, readOption, 'target');
    expect(requirements.some(requirement => requirement.factor_id === 'factor')).toBe(false);
    // The factor-parent control is still a real root input itself.
    expect(requirements.map(requirement => requirement.factor_id)).toEqual(kind === 'factor' ? ['parent'] : []);
  });

  it.each(['option', 'decision'] as const)('%s parent is removed before inference and does not hide a root baseline', kind => {
    const graph = parentGraph(kind);
    expect(GraphV3.safeParse(graph).success).toBe(true);
    expect(requiredFactorInputs(graph, readOption, 'target')).toEqual([{
      factor_id: 'factor', operation: 'isl.factor_baseline_sampling', option_ids: ['reader'], target_id: 'target', impact: 'unassessed',
    }]);
  });

  it.each(['option', 'decision'] as const)('does not follow a claimed causal route through a filtered %s node', kind => {
    const graph = parentGraph(kind);
    graph.nodes.push({ id: 'upstream', kind: 'factor', label: 'Not an inference ancestor' });
    graph.edges.push(edge('upstream', 'parent'));
    expect(requiredFactorInputs(graph, readOption, 'target').map(requirement => requirement.factor_id)).toEqual(['factor']);
  });
});

describe('excluded explicit status quo can request baseline recovery without gate mutation', () => {
  it('recovers the missing input that prevented status quo holding, without calling it a current ISL read', () => {
    const graph = statusQuoGraph();
    const before = structuredClone(graph);
    expect(GraphV3.safeParse(graph).success).toBe(true);
    const gate = gateAnalysableOptions({ graph, rawPersistedGraph: graph, options: options(graph), scaleNetEnabled: true });
    expect(gate.excluded).toEqual([{ option_id: 'baseline', label: 'Keep current', reason: 'no_interventions' }]);
    // The existing science dependency really is empty: the retained candidate
    // overrides this factor. Recovery is a separate named consumer request.
    expect(requiredFactorInputs(graph, gate.options, 'target')).toEqual([]);
    const requirements = comparisonFactorRequirements(graph, options(graph), 'target');
    expect(requirements).toEqual([{
      factor_id: 'factor', operation: 'cee.status_quo_hold', option_ids: ['baseline'], target_id: 'target', impact: 'unassessed',
    }]);
    expect(selectQuantificationGaps(graph, requirements).gaps).toEqual([expect.objectContaining({ factor_id: 'factor', requested_by: ['cee.status_quo_hold'] })]);
    expect(graph).toEqual(before);
    expect(gate.options.map(option => option.id)).toEqual(['candidate']);
    expect(gate.held).toEqual([]);
  });

  it('does not recover an arbitrary excluded option or accept a caller-only baseline claim', () => {
    const graph = statusQuoGraph();
    node(graph, 'baseline').is_baseline = false;
    const proposed = options(graph).map(option => option.id === 'baseline' ? { ...option, is_baseline: true } : option);
    expect(comparisonFactorRequirements(graph, proposed, 'target')).toEqual([]);
  });

  it('does not recover a goal-connected root outside the baseline own hold targets', () => {
    const graph = statusQuoGraph();
    graph.nodes.push({ id: 'unrelated', kind: 'factor', label: 'Different lever' });
    graph.edges.push(edge('unrelated', 'target'));
    node(graph, 'candidate').interventions = { factor: 0.8, unrelated: 0.6 };
    const requirements = comparisonFactorRequirements(graph, options(graph), 'target');
    expect(requirements).toEqual([{
      factor_id: 'factor', operation: 'cee.status_quo_hold', option_ids: ['baseline'], target_id: 'target', impact: 'unassessed',
    }]);
    expect(selectQuantificationGaps(graph, requirements).gaps.map(gap => gap.factor_id)).toEqual(['factor']);
  });

  it('uses retained siblings intervention targets only when the baseline has no factor edges', () => {
    const graph = statusQuoGraph();
    graph.edges = graph.edges.filter(item => item.from !== 'baseline');
    expect(comparisonFactorRequirements(graph, options(graph), 'target')).toEqual([{
      factor_id: 'factor', operation: 'cee.status_quo_hold', option_ids: ['baseline'], target_id: 'target', impact: 'unassessed',
    }]);
  });

  it('does not treat a malformed nonempty intervention map as an empty status quo', () => {
    const graph = statusQuoGraph();
    const proposed = options(graph).map(option => option.id === 'baseline' ? { ...option, interventions: { factor: 'unknown' } } : option);
    const gate = gateAnalysableOptions({ graph, rawPersistedGraph: graph, options: proposed, scaleNetEnabled: true });
    // Do not change the existing gate contract here: a nonempty map is retained.
    // It must receive only the ordinary dependency treatment, never recovery.
    const requirements = comparisonFactorRequirements(graph, proposed, 'target');
    expect(requirements).toEqual(requiredFactorInputs(graph, gate.options, 'target'));
    expect(requirements.some(requirement => requirement.operation === 'cee.status_quo_hold')).toBe(false);
  });

  it('does not recover when a caller omitted an existing canonical baseline intervention', () => {
    const graph = statusQuoGraph();
    node(graph, 'baseline').interventions = { factor: 0.12 };
    const proposed = options(graph).map(option => option.id === 'baseline' ? { ...option, interventions: {} } : option);
    expect(comparisonFactorRequirements(graph, proposed, 'target')).toEqual([]);
  });

  it('leaves an already-held supplied baseline untouched and creates no recovery request', () => {
    const graph = statusQuoGraph();
    node(graph, 'factor').observed_state = { value: 0.12, source: 'user_override' };
    const gate = gateAnalysableOptions({ graph, rawPersistedGraph: graph, options: options(graph), scaleNetEnabled: true });
    expect(gate.held.map(option => option.option_id)).toEqual(['baseline']);
    expect(comparisonFactorRequirements(graph, options(graph), 'target')).toEqual([]);
  });

  it('keeps a real retained-option dependency intact when the same quantity could also restore a baseline', () => {
    const graph = statusQuoGraph();
    graph.nodes.push(
      { id: 'other', kind: 'factor', label: 'Other lever', observed_state: { value: 0.1, source: 'user_override' } },
      { id: 'reader', kind: 'option', label: 'Change the other lever', interventions: { other: 0.3 } },
    );
    graph.edges.push(edge('reader', 'other'), edge('other', 'target'));
    const requirements = comparisonFactorRequirements(graph, options(graph), 'target');
    const sameFactor = requirements.filter(requirement => requirement.factor_id === 'factor');
    expect(sameFactor).toEqual([{
      factor_id: 'factor', operation: 'isl.factor_baseline_sampling', option_ids: ['reader'], target_id: 'target', impact: 'unassessed',
    }]);
    expect(sameFactor[0]!.option_ids).not.toContain('baseline');
  });

  it('names recovery-only demand even when two configured retained alternatives already override it', () => {
    const graph = statusQuoGraph();
    graph.nodes.push({ id: 'second', kind: 'option', label: 'Different change', interventions: { factor: 0.6 } });
    graph.edges.push(edge('second', 'factor'));
    const gate = gateAnalysableOptions({ graph, rawPersistedGraph: graph, options: options(graph), scaleNetEnabled: true });
    expect(gate.options).toHaveLength(2);
    const requirements = comparisonFactorRequirements(graph, options(graph), 'target');
    expect(requirements).toEqual([expect.objectContaining({ factor_id: 'factor', operation: 'cee.status_quo_hold', option_ids: ['baseline'] })]);
  });
});
