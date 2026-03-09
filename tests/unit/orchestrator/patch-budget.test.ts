import { describe, it, expect } from 'vitest';
import { checkPatchBudget, stripNoOps } from '../../../src/orchestrator/tools/edit-graph.js';
import type { PatchOperation } from '../../../src/orchestrator/types.js';

describe('checkPatchBudget', () => {
  it('3 node ops + 4 edge ops: passes', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'n1', value: { id: 'n1', kind: 'factor', label: 'A' } },
      { op: 'update_node', path: 'n2', value: { label: 'B' } },
      { op: 'remove_node', path: 'n3' },
      { op: 'add_edge', path: 'n1::n2', value: { from: 'n1', to: 'n2' } },
      { op: 'update_edge', path: 'n2::n3', value: { strength_mean: 0.5 } },
      { op: 'remove_edge', path: 'n3::n4' },
      { op: 'add_edge', path: 'n4::n5', value: { from: 'n4', to: 'n5' } },
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(true);
    expect(result.nodeOps).toBe(3);
    expect(result.edgeOps).toBe(4);
  });

  it('4 node ops + 2 edge ops: rejected (node budget)', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'n1', value: { id: 'n1', kind: 'factor', label: 'A' } },
      { op: 'add_node', path: 'n2', value: { id: 'n2', kind: 'factor', label: 'B' } },
      { op: 'update_node', path: 'n3', value: { label: 'C' } },
      { op: 'remove_node', path: 'n4' },
      { op: 'add_edge', path: 'n1::n2', value: { from: 'n1', to: 'n2' } },
      { op: 'add_edge', path: 'n2::n3', value: { from: 'n2', to: 'n3' } },
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(false);
    expect(result.nodeOps).toBe(4);
    expect(result.edgeOps).toBe(2);
  });

  it('2 node ops + 5 edge ops: rejected (edge budget)', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'n1', value: { id: 'n1', kind: 'factor', label: 'A' } },
      { op: 'update_node', path: 'n2', value: { label: 'B' } },
      { op: 'add_edge', path: 'n1::n2', value: { from: 'n1', to: 'n2' } },
      { op: 'add_edge', path: 'n2::n3', value: { from: 'n2', to: 'n3' } },
      { op: 'remove_edge', path: 'n3::n4' },
      { op: 'update_edge', path: 'n4::n5', value: { strength_mean: 0.5 } },
      { op: 'add_edge', path: 'n5::n6', value: { from: 'n5', to: 'n6' } },
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(false);
    expect(result.nodeOps).toBe(2);
    expect(result.edgeOps).toBe(5);
  });

  it('remove_node with 3 connected edges: 1 node op, 0 edge ops', () => {
    // Implicit edge removals from remove_node do NOT count against edge budget
    const ops: PatchOperation[] = [
      { op: 'remove_node', path: 'fac_x' },
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(true);
    expect(result.nodeOps).toBe(1);
    expect(result.edgeOps).toBe(0);
  });
});

describe('stripNoOps', () => {
  it('2 no-op updates + 2 real updates: passes (2 counted after strip)', () => {
    const ops: PatchOperation[] = [
      // No-op: value equals old_value
      { op: 'update_node', path: 'n1', value: { label: 'Same' }, old_value: { label: 'Same' } },
      // No-op: value equals old_value (nested)
      { op: 'update_edge', path: 'n1::n2', value: { strength_mean: 0.5 }, old_value: { strength_mean: 0.5 } },
      // Real: different values
      { op: 'update_node', path: 'n2', value: { label: 'New' }, old_value: { label: 'Old' } },
      // Real: no old_value (treated as non-no-op)
      { op: 'update_node', path: 'n3', value: { label: 'New2' } },
    ];

    const stripped = stripNoOps(ops);
    expect(stripped).toHaveLength(2);
    expect(stripped[0].path).toBe('n2');
    expect(stripped[1].path).toBe('n3');
  });

  it('keeps operations without old_value', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'n1', value: { id: 'n1', kind: 'factor', label: 'A' } },
    ];
    const stripped = stripNoOps(ops);
    expect(stripped).toHaveLength(1);
  });
});
