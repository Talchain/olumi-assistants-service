import { describe, it, expect } from 'vitest';
import { checkPatchBudget, hasOptionAddition, stripNoOps } from '../../../src/orchestrator/tools/edit-graph.js';
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

  it('5 node ops + 2 edge ops: rejected (node budget)', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'n1', value: { id: 'n1', kind: 'factor', label: 'A' } },
      { op: 'add_node', path: 'n2', value: { id: 'n2', kind: 'factor', label: 'B' } },
      { op: 'add_node', path: 'n3', value: { id: 'n3', kind: 'factor', label: 'C' } },
      { op: 'update_node', path: 'n4', value: { label: 'D' } },
      { op: 'remove_node', path: 'n5' },
      { op: 'add_edge', path: 'n1::n2', value: { from: 'n1', to: 'n2' } },
      { op: 'add_edge', path: 'n2::n3', value: { from: 'n2', to: 'n3' } },
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(false);
    expect(result.nodeOps).toBe(5);
    expect(result.edgeOps).toBe(2);
  });

  it('2 node ops + 9 edge ops: rejected (edge budget)', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'n1', value: { id: 'n1', kind: 'factor', label: 'A' } },
      { op: 'update_node', path: 'n2', value: { label: 'B' } },
      ...Array.from({ length: 9 }, (_, i) => ({
        op: 'add_edge' as const,
        path: `n1::n${i + 10}`,
        value: { from: 'n1', to: `n${i + 10}` },
      })),
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(false);
    expect(result.nodeOps).toBe(2);
    expect(result.edgeOps).toBe(9);
  });

  it('option-addition with 6 edge ops: passes (elevated budget)', () => {
    // Adding an option node naturally requires connecting to multiple factors.
    // The elevated budget (8 edge ops) should allow this.
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'opt_3', value: { id: 'opt_3', kind: 'option', label: 'New Option' } },
      { op: 'add_edge', path: 'opt_3::fac_1', value: { from: 'opt_3', to: 'fac_1' } },
      { op: 'add_edge', path: 'opt_3::fac_2', value: { from: 'opt_3', to: 'fac_2' } },
      { op: 'add_edge', path: 'opt_3::fac_3', value: { from: 'opt_3', to: 'fac_3' } },
      { op: 'add_edge', path: 'opt_3::fac_4', value: { from: 'opt_3', to: 'fac_4' } },
      { op: 'add_edge', path: 'opt_3::fac_5', value: { from: 'opt_3', to: 'fac_5' } },
      { op: 'add_edge', path: 'opt_3::goal', value: { from: 'opt_3', to: 'goal_1' } },
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(true);
    expect(result.nodeOps).toBe(1);
    expect(result.edgeOps).toBe(6);
  });

  it('option-addition with 9 edge ops: rejected (exceeds elevated budget)', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'opt_3', value: { id: 'opt_3', kind: 'option', label: 'New Option' } },
      ...Array.from({ length: 9 }, (_, i) => ({
        op: 'add_edge' as const,
        path: `opt_3::fac_${i}`,
        value: { from: 'opt_3', to: `fac_${i}` },
      })),
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(false);
    expect(result.edgeOps).toBe(9);
  });

  it('intervention-addition also gets elevated edge budget', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'int_1', value: { id: 'int_1', kind: 'intervention', label: 'New Intervention' } },
      { op: 'add_edge', path: 'int_1::fac_1', value: { from: 'int_1', to: 'fac_1' } },
      { op: 'add_edge', path: 'int_1::fac_2', value: { from: 'int_1', to: 'fac_2' } },
      { op: 'add_edge', path: 'int_1::fac_3', value: { from: 'int_1', to: 'fac_3' } },
      { op: 'add_edge', path: 'int_1::fac_4', value: { from: 'int_1', to: 'fac_4' } },
      { op: 'add_edge', path: 'int_1::fac_5', value: { from: 'int_1', to: 'fac_5' } },
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(true);
    expect(result.edgeOps).toBe(5);
  });

  it('non-option add_node with 9 edge ops: rejected (standard budget)', () => {
    // A factor-addition does NOT get the elevated edge budget
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'fac_new', value: { id: 'fac_new', kind: 'factor', label: 'New Factor' } },
      ...Array.from({ length: 9 }, (_, i) => ({
        op: 'add_edge' as const,
        path: `fac_new::n${i}`,
        value: { from: 'fac_new', to: `n${i}` },
      })),
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(false);
    expect(result.edgeOps).toBe(9);
  });

  it('option-addition with unrelated edge rewires: unrelated edges capped at standard budget', () => {
    // Option-add has 3 incident edges (within elevated 8-cap), but also has 9 unrelated
    // edge ops which exceed the standard 8-cap. Should be rejected.
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'opt_3', value: { id: 'opt_3', kind: 'option', label: 'New Option' } },
      // 3 edges incident to opt_3 (within elevated cap)
      { op: 'add_edge', path: 'opt_3::fac_1', value: { from: 'opt_3', to: 'fac_1' } },
      { op: 'add_edge', path: 'opt_3::fac_2', value: { from: 'opt_3', to: 'fac_2' } },
      { op: 'add_edge', path: 'opt_3::fac_3', value: { from: 'opt_3', to: 'fac_3' } },
      // 9 unrelated edge rewires (exceeds standard 8-cap)
      ...Array.from({ length: 9 }, (_, i) => ({
        op: 'add_edge' as const,
        path: `fac_${String.fromCharCode(97 + i)}::fac_${String.fromCharCode(97 + i + 1)}`,
        value: { from: `fac_${String.fromCharCode(97 + i)}`, to: `fac_${String.fromCharCode(97 + i + 1)}` },
      })),
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(false);
    expect(result.edgeOps).toBe(12); // total
    expect(result.breachedLimit).toBe('unrelated');
    expect(result.effectiveMaxEdgeOps).toBe(8); // standard cap for unrelated edges
  });

  it('option-addition with 8 unrelated edge ops: passes (within standard cap)', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'opt_3', value: { id: 'opt_3', kind: 'option', label: 'New Option' } },
      // 3 edges incident to opt_3
      { op: 'add_edge', path: 'opt_3::fac_1', value: { from: 'opt_3', to: 'fac_1' } },
      { op: 'add_edge', path: 'opt_3::fac_2', value: { from: 'opt_3', to: 'fac_2' } },
      { op: 'add_edge', path: 'opt_3::fac_3', value: { from: 'opt_3', to: 'fac_3' } },
      // 8 unrelated edge ops (within standard 8-cap)
      ...Array.from({ length: 8 }, (_, i) => ({
        op: 'add_edge' as const,
        path: `fac_${String.fromCharCode(97 + i)}::fac_${String.fromCharCode(97 + i + 1)}`,
        value: { from: `fac_${String.fromCharCode(97 + i)}`, to: `fac_${String.fromCharCode(97 + i + 1)}` },
      })),
    ];
    const result = checkPatchBudget(ops);
    expect(result.allowed).toBe(true);
    expect(result.edgeOps).toBe(11); // total
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

describe('hasOptionAddition', () => {
  it('detects add_node with kind "option"', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'opt_1', value: { id: 'opt_1', kind: 'option', label: 'Opt' } },
    ];
    expect(hasOptionAddition(ops)).toBe(true);
  });

  it('detects add_node with kind "intervention"', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'int_1', value: { id: 'int_1', kind: 'intervention', label: 'Int' } },
    ];
    expect(hasOptionAddition(ops)).toBe(true);
  });

  it('returns false for add_node with kind "factor"', () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'fac_1', value: { id: 'fac_1', kind: 'factor', label: 'Fac' } },
    ];
    expect(hasOptionAddition(ops)).toBe(false);
  });

  it('returns false for update_node even with kind "option"', () => {
    const ops: PatchOperation[] = [
      { op: 'update_node', path: 'opt_1', value: { kind: 'option', label: 'Updated' } },
    ];
    expect(hasOptionAddition(ops)).toBe(false);
  });

  it('returns false for empty operations', () => {
    expect(hasOptionAddition([])).toBe(false);
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
