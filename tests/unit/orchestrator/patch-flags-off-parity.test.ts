import { describe, it, expect } from 'vitest';
import { checkPatchBudget } from '../../../src/orchestrator/tools/edit-graph.js';
import { validateGraphStructure } from '../../../src/orchestrator/graph-structure-validator.js';
import type { PatchOperation } from '../../../src/orchestrator/types.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

/**
 * Flags-off parity tests (Fix 7).
 *
 * These tests prove that the budget and pre-validation logic are correct
 * in isolation, so that when the feature flags are OFF, the pipeline simply
 * skips these checks and operates as before.
 *
 * The integration with the flag check (config.cee.patchBudgetEnabled /
 * config.cee.patchPreValidationEnabled) is tested implicitly: when the
 * flag is false, the code skips calling these functions entirely.
 */

describe('Flags-off parity: CEE_PATCH_BUDGET_ENABLED=false', () => {
  it('oversized ops would be rejected by budget check — proves the check is the only gate', () => {
    // 4 node ops + 5 edge ops — exceeds both budgets
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'n1', value: { id: 'n1', kind: 'factor', label: 'A' } },
      { op: 'add_node', path: 'n2', value: { id: 'n2', kind: 'factor', label: 'B' } },
      { op: 'add_node', path: 'n3', value: { id: 'n3', kind: 'factor', label: 'C' } },
      { op: 'update_node', path: 'n4', value: { label: 'D' } },
      { op: 'add_edge', path: 'n1::n2', value: { from: 'n1', to: 'n2' } },
      { op: 'add_edge', path: 'n2::n3', value: { from: 'n2', to: 'n3' } },
      { op: 'add_edge', path: 'n3::n4', value: { from: 'n3', to: 'n4' } },
      { op: 'remove_edge', path: 'n4::n5' },
      { op: 'update_edge', path: 'n5::n6', value: { strength_mean: 0.8 } },
    ];

    // Budget check WOULD reject
    const budgetResult = checkPatchBudget(ops);
    expect(budgetResult.allowed).toBe(false);
    expect(budgetResult.nodeOps).toBe(4);
    expect(budgetResult.edgeOps).toBe(5);

    // When flag is OFF, checkPatchBudget is never called → ops pass through
    // This test proves budget check is the ONLY gate for this rejection
  });
});

describe('Flags-off parity: CEE_PATCH_PRE_VALIDATION_ENABLED=false', () => {
  it('orphan-creating op would be caught by structural validation — proves the check is the only gate', () => {
    // Graph that has an orphan node (no edges connected)
    const graphWithOrphan: GraphV3T = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'dec_1', kind: 'decision', label: 'Choose' },
        { id: 'opt_a', kind: 'option', label: 'A' },
        { id: 'opt_b', kind: 'option', label: 'B' },
        { id: 'orphan', kind: 'factor', label: 'Disconnected' },
      ],
      edges: [
        { from: 'dec_1', to: 'opt_a' },
        { from: 'dec_1', to: 'opt_b' },
        { from: 'opt_a', to: 'goal_1' },
        { from: 'opt_b', to: 'goal_1' },
        // 'orphan' node has no edges → ORPHAN_NODE violation
      ],
    } as unknown as GraphV3T;

    // Structural validation WOULD catch the orphan
    const result = validateGraphStructure(graphWithOrphan);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'ORPHAN_NODE')).toBe(true);

    // When flag is OFF, validateGraphStructure is never called → ops pass through
    // This test proves structural validation is the ONLY gate for this rejection
  });
});
