/**
 * W2E-2 — numeric-bounds enforcement on LLM edit_graph operations (path b:
 * LLM tool-call output → PatchOperation[] validation).
 *
 * validatePatchOperations is the single structural gatekeeper between raw LLM
 * edit output and the patch pipeline. A Zod failure here feeds the existing
 * repair/retry loop in edit-graph.ts (formatPatchValidationErrors → repair
 * prompt → rejection block after attempts exhausted) — exactly the desired
 * rejection mechanism for out-of-range LLM values.
 *
 * Contract ranges (vendored @talchain/schemas 0.16.0 dist/graph.js):
 *   strength.mean ∈ [-1, 1] · strength.std > 0 · exists_probability ∈ [0, 1]
 *   observed_state.std > 0 · all numbers finite.
 * Contract-silent numeric fields: finiteness only (no invented ranges).
 */
import { describe, it, expect } from 'vitest';

import { validatePatchOperations } from '../../../src/orchestrator/patch-validation.js';

const GRAPH = {
  nodes: [
    { id: 'fac_1' },
    { id: 'goal_1' },
  ],
  edges: [{ from: 'fac_1', to: 'goal_1' }],
};

const VALID_ADD_EDGE_VALUE = {
  from: 'fac_1',
  to: 'goal_1',
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
};

function addEdgeOp(valueOverrides: Record<string, unknown>) {
  return [
    {
      op: 'add_edge',
      path: 'fac_1::goal_1',
      value: { ...VALID_ADD_EDGE_VALUE, ...valueOverrides },
    },
  ];
}

// add_edge against an EXISTING edge is fine for these tests: referential
// integrity only checks that endpoints exist, which they do.

describe('validatePatchOperations — numeric bounds (W2E-2)', () => {
  // ── add_edge ──────────────────────────────────────────────────────────────

  it('rejects add_edge with strength.mean outside [-1, 1] (weight -7)', () => {
    const result = validatePatchOperations(
      addEdgeOp({ strength: { mean: -7, std: 0.1 } }),
      GRAPH,
    );
    expect(result.valid).toBe(false);
    expect(result.zodErrors).toBeDefined();
  });

  it('rejects add_edge with NaN strength.mean (NaN weight)', () => {
    const result = validatePatchOperations(
      addEdgeOp({ strength: { mean: Number.NaN, std: 0.1 } }),
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects add_edge with non-positive strength.std', () => {
    const result = validatePatchOperations(
      addEdgeOp({ strength: { mean: 0.5, std: 0 } }),
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects add_edge with Infinity in a passthrough numeric field', () => {
    const result = validatePatchOperations(
      addEdgeOp({ weight: Number.POSITIVE_INFINITY }),
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  // ── update_edge (record-typed value) ──────────────────────────────────────

  it('rejects update_edge setting exists_probability above 1 (prob 1.4)', () => {
    const result = validatePatchOperations(
      [{ op: 'update_edge', path: 'fac_1::goal_1', value: { exists_probability: 1.4 } }],
      GRAPH,
    );
    expect(result.valid).toBe(false);
    expect(result.zodErrors).toBeDefined();
  });

  it('rejects update_edge setting exists_probability below 0 (prob -0.1)', () => {
    const result = validatePatchOperations(
      [{ op: 'update_edge', path: 'fac_1::goal_1', value: { exists_probability: -0.1 } }],
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects update_edge setting strength.mean outside [-1, 1]', () => {
    const result = validatePatchOperations(
      [{ op: 'update_edge', path: 'fac_1::goal_1', value: { strength: { mean: 2, std: 0.1 } } }],
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  // ── update_node (record-typed value) ──────────────────────────────────────

  it('rejects update_node setting a non-finite observed_state.value (Infinity value)', () => {
    const result = validatePatchOperations(
      [
        {
          op: 'update_node',
          path: 'fac_1',
          value: { observed_state: { value: Number.POSITIVE_INFINITY } },
        },
      ],
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects update_node setting a non-positive observed_state.std', () => {
    const result = validatePatchOperations(
      [
        {
          op: 'update_node',
          path: 'fac_1',
          value: { observed_state: { value: 0.4, std: -1 } },
        },
      ],
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  // ── add_node ──────────────────────────────────────────────────────────────

  it('rejects add_node carrying a non-finite numeric field', () => {
    const result = validatePatchOperations(
      [
        {
          op: 'add_node',
          path: 'fac_new',
          value: {
            id: 'fac_new',
            kind: 'factor',
            label: 'New factor',
            observed_state: { value: Number.NaN },
          },
        },
      ],
      GRAPH,
    );
    expect(result.valid).toBe(false);
  });

  // ── Regression: valid operations stay valid and unchanged ────────────────

  it('accepts a valid add_edge unchanged (round-trip)', () => {
    const ops = addEdgeOp({});
    const result = validatePatchOperations(ops, GRAPH);
    expect(result.valid).toBe(true);
    expect(JSON.stringify(result.operations)).toBe(JSON.stringify(ops));
  });

  it('accepts boundary values exactly at the contract limits', () => {
    const result = validatePatchOperations(
      addEdgeOp({ strength: { mean: -1, std: 0.001 }, exists_probability: 0 }),
      GRAPH,
    );
    expect(result.valid).toBe(true);
  });

  it('accepts contract-silent numeric fields at any finite magnitude', () => {
    const result = validatePatchOperations(
      [
        {
          op: 'update_node',
          path: 'fac_1',
          value: { observed_state: { value: 5_000_000 } },
        },
      ],
      GRAPH,
    );
    expect(result.valid).toBe(true);
  });
});
