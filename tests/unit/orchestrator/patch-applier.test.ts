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

  // Regression: a previous shallow Object.assign on update_edge replaced the
  // entire `strength` object, dropping `std` when a patch carried only
  // `{mean: ...}`. The persisted graph then failed GraphV3.safeParse and the
  // next chip-click run_analysis returned 500 with cause_kind=scenario_read_failed.
  // See diagnostic: edge fac_hiring_spend → out_delivery_capacity went from
  // {mean: 0.153, std: 0.069} to {mean: 0.28} after a "make this factor more
  // important" turn on staging build 0eecac8.
  describe('update_edge: partial nested strength', () => {
    it('partial strength { mean } preserves existing std', () => {
      const graph = makeGraph();
      const ops: PatchOperation[] = [
        {
          op: 'update_edge',
          path: 'opt_a::fac_x',
          value: { strength: { mean: 0.9 } },
        },
      ];

      const candidate = applyPatchOperations(graph, ops);

      const edge = candidate.edges.find((e) => e.from === 'opt_a' && e.to === 'fac_x')!;
      expect(edge.strength).toEqual({ mean: 0.9, std: 0.2 });
      expect(edge.exists_probability).toBe(0.9);

      // Original graph unchanged (purity)
      expect(graph.edges.find((e) => e.from === 'opt_a' && e.to === 'fac_x')!.strength)
        .toEqual({ mean: 0.5, std: 0.2 });
    });

    it('partial strength { std } preserves existing mean', () => {
      const graph = makeGraph();
      const ops: PatchOperation[] = [
        {
          op: 'update_edge',
          path: 'opt_a::fac_x',
          value: { strength: { std: 0.05 } },
        },
      ];

      const candidate = applyPatchOperations(graph, ops);

      const edge = candidate.edges.find((e) => e.from === 'opt_a' && e.to === 'fac_x')!;
      expect(edge.strength).toEqual({ mean: 0.5, std: 0.05 });
    });

    it('full strength { mean, std } replaces both members', () => {
      const graph = makeGraph();
      const ops: PatchOperation[] = [
        {
          op: 'update_edge',
          path: 'opt_a::fac_x',
          value: { strength: { mean: 0.95, std: 0.02 } },
        },
      ];

      const candidate = applyPatchOperations(graph, ops);

      const edge = candidate.edges.find((e) => e.from === 'opt_a' && e.to === 'fac_x')!;
      expect(edge.strength).toEqual({ mean: 0.95, std: 0.02 });
    });

    it('exact staging failure shape: { strength: { mean }, exists_probability } preserves std', () => {
      // Reproduces the exact patch shape captured from staging scenario
      // 9f23a6c1-b366-4dd2-94cd-ce2d2d42106e on build 0eecac8.
      const graph = makeGraph();
      const ops: PatchOperation[] = [
        {
          op: 'update_edge',
          path: 'opt_a::fac_x',
          value: { strength: { mean: 0.28 }, exists_probability: 0.88 },
        },
      ];

      const candidate = applyPatchOperations(graph, ops);

      const edge = candidate.edges.find((e) => e.from === 'opt_a' && e.to === 'fac_x')!;
      expect(edge.strength.std).toBeDefined();
      expect(edge.strength.std).toBeGreaterThan(0);
      expect(edge.strength.mean).toBe(0.28);
      expect(edge.exists_probability).toBe(0.88);
    });

    it('update_edge without strength field leaves existing strength untouched', () => {
      const graph = makeGraph();
      const ops: PatchOperation[] = [
        {
          op: 'update_edge',
          path: 'opt_a::fac_x',
          value: { exists_probability: 0.5 },
        },
      ];

      const candidate = applyPatchOperations(graph, ops);

      const edge = candidate.edges.find((e) => e.from === 'opt_a' && e.to === 'fac_x')!;
      expect(edge.strength).toEqual({ mean: 0.5, std: 0.2 });
      expect(edge.exists_probability).toBe(0.5);
    });

    // Direct-JS-call boundary contract: explicit `undefined` subfields on
    // `strength` are treated as no-op rather than as a wipe. JSON parsing
    // cannot produce an undefined own property (the LLM/HTTP path is
    // unaffected); this guards direct-callsite use where treating
    // `{ std: undefined }` as a wipe would silently re-introduce the
    // staging defect.
    it('partial strength { std: undefined } leaves existing std untouched (direct-call boundary)', () => {
      const graph = makeGraph();
      const ops: PatchOperation[] = [
        {
          op: 'update_edge',
          path: 'opt_a::fac_x',
          value: { strength: { mean: 0.9, std: undefined } },
        },
      ];

      const candidate = applyPatchOperations(graph, ops);

      const edge = candidate.edges.find((e) => e.from === 'opt_a' && e.to === 'fac_x')!;
      expect(edge.strength).toEqual({ mean: 0.9, std: 0.2 });
    });

    // Non-plain-object strength values (null, array, primitive) survive
    // patch-validation because UpdateEdgeValue is permissive. They are
    // incoherent: the patch claims to update strength but cannot. The
    // applier rejects via PatchApplyError('INVALID_OPERATION') to avoid
    // a false-success narration on a candidate that matches the base
    // graph unchanged.
    it.each([
      ['null', null],
      ['array', []],
      ['string', 'not-an-object'],
      ['number', 0.5],
      ['boolean', true],
    ])('rejects strength=%s with PatchApplyError(INVALID_OPERATION)', (_label, badValue) => {
      const graph = makeGraph();
      const ops: PatchOperation[] = [
        {
          op: 'update_edge',
          path: 'opt_a::fac_x',
          value: { strength: badValue as unknown },
        },
      ];

      expect(() => applyPatchOperations(graph, ops)).toThrow(PatchApplyError);
      try {
        applyPatchOperations(graph, ops);
      } catch (err) {
        expect(err).toBeInstanceOf(PatchApplyError);
        expect((err as PatchApplyError).code).toBe('INVALID_OPERATION');
      }
    });
  });
});
