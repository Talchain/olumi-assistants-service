import { describe, it, expect } from 'vitest';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

/**
 * Minimal graph factory that satisfies GraphV3T structure.
 * Uses `as unknown as GraphV3T` per codebase convention for test fixtures.
 */
function makeGraph(overrides?: Partial<GraphV3T>): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise Revenue' },
      { id: 'dec_1', kind: 'decision', label: 'Choose supplier' },
      { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { price: 100 } },
      { id: 'opt_b', kind: 'option', label: 'Option B', interventions: { price: 200 } },
      { id: 'fac_1', kind: 'factor', label: 'Market share' },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a' },
      { from: 'dec_1', to: 'opt_b' },
      { from: 'opt_a', to: 'fac_1' },
      { from: 'opt_b', to: 'fac_1' },
      { from: 'fac_1', to: 'goal_1' },
    ],
    ...overrides,
  } as unknown as GraphV3T;
}

describe('analysis_ready recomputation (Task 8)', () => {
  it('graph with valid interventions on all options → status "ready"', () => {
    const graph = makeGraph();
    const result = computeStructuralReadiness(graph);

    expect(result).toBeDefined();
    expect(result!.status).toBe('ready');
    expect(result!.goal_node_id).toBe('goal_1');
    expect(result!.options).toHaveLength(2);
    expect(result!.options.every((o) => o.status === 'ready')).toBe(true);
  });

  it('graph after removing interventions → status reflects the change', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Maximise Revenue' },
        { id: 'dec_1', kind: 'decision', label: 'Choose supplier' },
        // Option A still has interventions
        { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { price: 100 } },
        // Option B has no interventions (simulating removal)
        { id: 'opt_b', kind: 'option', label: 'Option B' },
        { id: 'fac_1', kind: 'factor', label: 'Market share' },
      ],
      edges: [
        { from: 'dec_1', to: 'opt_a' },
        { from: 'dec_1', to: 'opt_b' },
        { from: 'opt_a', to: 'fac_1' },
        { from: 'opt_b', to: 'fac_1' },
        { from: 'fac_1', to: 'goal_1' },
      ],
    } as unknown as Partial<GraphV3T>);

    const result = computeStructuralReadiness(graph);

    expect(result).toBeDefined();
    // Not ready because opt_b has connected factors but no numeric interventions
    expect(result!.status).not.toBe('ready');
    expect(result!.options.find((o) => o.option_id === 'opt_a')!.status).toBe('ready');
  });

  it('graph with no goal node → returns undefined', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'dec_1', kind: 'decision', label: 'Choose' },
        { id: 'opt_a', kind: 'option', label: 'A' },
        { id: 'opt_b', kind: 'option', label: 'B' },
      ],
    } as unknown as Partial<GraphV3T>);

    const result = computeStructuralReadiness(graph);
    expect(result).toBeUndefined();
  });

  it('graph with fewer than 2 options → status "needs_user_input"', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'dec_1', kind: 'decision', label: 'Choose' },
        { id: 'opt_a', kind: 'option', label: 'Only Option', interventions: { price: 100 } },
      ],
      edges: [
        { from: 'dec_1', to: 'opt_a' },
        { from: 'opt_a', to: 'goal_1' },
      ],
    } as unknown as Partial<GraphV3T>);

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    expect(result!.status).toBe('needs_user_input');
  });
});
