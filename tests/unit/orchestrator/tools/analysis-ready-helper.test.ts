import { describe, it, expect } from 'vitest';
import { computeStructuralReadiness } from '../../../../src/orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';

function makeReadyGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Choose pricing' },
      {
        id: 'opt_a', kind: 'option', label: 'Option A',
        interventions: { fac_x: 0.8 },
      },
      {
        id: 'opt_b', kind: 'option', label: 'Option B',
        interventions: { fac_x: 0.3 },
      },
      { id: 'fac_x', kind: 'factor', label: 'Market size' },
      { id: 'goal_1', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_x', strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_x', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
      { from: 'fac_x', to: 'goal_1', strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

describe('computeStructuralReadiness', () => {
  it('returns undefined when no goal node exists', () => {
    const graph = makeReadyGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'goal');
    expect(computeStructuralReadiness(graph)).toBeUndefined();
  });

  it('returns "ready" when all options have numeric interventions', () => {
    const result = computeStructuralReadiness(makeReadyGraph());

    expect(result).toBeDefined();
    expect(result!.status).toBe('ready');
    expect(result!.goal_node_id).toBe('goal_1');
    expect(result!.goal_threshold).toBe(0.8);
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0].status).toBe('ready');
    expect(result!.options[1].status).toBe('ready');
  });

  it('returns "needs_user_mapping" when an option lacks interventions', () => {
    const graph = makeReadyGraph();
    // Remove interventions from opt_b
    const optB = graph.nodes.find((n) => n.id === 'opt_b') as Record<string, unknown>;
    delete optB.interventions;
    // Also remove edge so it is truly disconnected from factors
    graph.edges = graph.edges.filter((e) => !(e.from === 'opt_b' && e.to === 'fac_x'));

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    expect(result!.status).toBe('needs_user_mapping');
    expect(result!.options.find((o) => o.option_id === 'opt_b')!.status).toBe('needs_user_mapping');
  });

  it('returns "needs_encoding" when option has edges but no numeric interventions', () => {
    const graph = makeReadyGraph();
    // Remove interventions but keep edge to factor
    const optB = graph.nodes.find((n) => n.id === 'opt_b') as Record<string, unknown>;
    delete optB.interventions;

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    // opt_b has edge to fac_x but no encoded interventions → needs_encoding
    expect(result!.options.find((o) => o.option_id === 'opt_b')!.status).toBe('needs_encoding');
  });

  it('returns "needs_user_input" when fewer than 2 options', () => {
    const graph = makeReadyGraph();
    graph.nodes = graph.nodes.filter((n) => n.id !== 'opt_b');
    graph.edges = graph.edges.filter((e) => e.from !== 'opt_b' && e.to !== 'opt_b');

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    expect(result!.status).toBe('needs_user_input');
  });
});
