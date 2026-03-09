import { describe, it, expect } from 'vitest';
import { applyPatchOperations, PatchApplyError } from '../../../src/orchestrator/patch-applier.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';
import type { PatchOperation } from '../../../src/orchestrator/types.js';

// ============================================================================
// Test Fixture — minimal valid graph
// ============================================================================

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Choose pricing' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_b', kind: 'option', label: 'Option B' },
      { id: 'fac_x', kind: 'factor', label: 'Market size' },
      { id: 'goal_1', kind: 'goal', label: 'Revenue' },
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

describe('applyPatchOperations', () => {
  it('add_node: candidate graph has the new node', () => {
    const graph = makeGraph();
    const ops: PatchOperation[] = [
      {
        op: 'add_node',
        path: 'fac_y',
        value: { id: 'fac_y', kind: 'factor', label: 'Competitor response' },
      },
    ];

    const candidate = applyPatchOperations(graph, ops);

    expect(candidate.nodes).toHaveLength(6);
    expect(candidate.nodes.find((n) => n.id === 'fac_y')).toBeDefined();
    expect(candidate.nodes.find((n) => n.id === 'fac_y')!.label).toBe('Competitor response');

    // Original graph unchanged (purity)
    expect(graph.nodes).toHaveLength(5);
  });

  it('remove_node: candidate lacks node AND all connected edges removed', () => {
    const graph = makeGraph();
    const ops: PatchOperation[] = [
      { op: 'remove_node', path: 'fac_x' },
    ];

    const candidate = applyPatchOperations(graph, ops);

    // Node removed
    expect(candidate.nodes.find((n) => n.id === 'fac_x')).toBeUndefined();
    expect(candidate.nodes).toHaveLength(4);

    // All edges connected to fac_x removed (3 edges: opt_a→fac_x, opt_b→fac_x, fac_x→goal_1)
    const fac_x_edges = candidate.edges.filter(
      (e) => e.from === 'fac_x' || e.to === 'fac_x',
    );
    expect(fac_x_edges).toHaveLength(0);
    expect(candidate.edges).toHaveLength(2); // Only dec_1→opt_a, dec_1→opt_b remain

    // Original graph unchanged
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(5);
  });

  it('update_node label-only: label updated, all other fields unchanged', () => {
    const graph = makeGraph();
    const ops: PatchOperation[] = [
      { op: 'update_node', path: 'fac_x', value: { label: 'Updated Market Size' } },
    ];

    const candidate = applyPatchOperations(graph, ops);

    const node = candidate.nodes.find((n) => n.id === 'fac_x')!;
    expect(node.label).toBe('Updated Market Size');
    expect(node.kind).toBe('factor'); // Unchanged
    expect(node.id).toBe('fac_x'); // Unchanged
  });

  it('remove non-existent node: throws PatchApplyError(NODE_NOT_FOUND)', () => {
    const graph = makeGraph();
    const ops: PatchOperation[] = [
      { op: 'remove_node', path: 'nonexistent_node' },
    ];

    expect(() => applyPatchOperations(graph, ops)).toThrow(PatchApplyError);
    try {
      applyPatchOperations(graph, ops);
    } catch (err) {
      expect(err).toBeInstanceOf(PatchApplyError);
      expect((err as PatchApplyError).code).toBe('NODE_NOT_FOUND');
    }
  });

  it('add_edge referencing non-existent node: throws PatchApplyError(NODE_NOT_FOUND)', () => {
    const graph = makeGraph();
    const ops: PatchOperation[] = [
      {
        op: 'add_edge',
        path: 'nonexistent::goal_1',
        value: {
          from: 'nonexistent',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      },
    ];

    expect(() => applyPatchOperations(graph, ops)).toThrow(PatchApplyError);
    try {
      applyPatchOperations(graph, ops);
    } catch (err) {
      expect(err).toBeInstanceOf(PatchApplyError);
      expect((err as PatchApplyError).code).toBe('NODE_NOT_FOUND');
    }
  });
});
