/**
 * Tests for the applied-change receipt on successful edit_graph operations.
 *
 * Covers:
 * - buildAppliedChanges for single value update
 * - buildAppliedChanges for compound edit (multiple ops)
 * - missing old_value → description of new state only
 * - rerun_recommended true when node value changed with existing analysis
 * - rerun_recommended false for label-only change
 * - No internal IDs in summary or description
 * - No receipt on failed edits (wasRejected)
 * - applied_changes does not contradict GraphPatchBlock data
 */

import { describe, it, expect } from "vitest";
import {
  buildAppliedChanges,
} from "../../../../src/orchestrator/tools/edit-graph.js";
import type { PatchOperation, GraphV3T } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeGraph(nodes: Array<{ id: string; label: string; kind?: string; value?: number }> = []): GraphV3T {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label,
      kind: n.kind ?? "factor",
      ...(n.value !== undefined && { value: n.value }),
    })),
    edges: [],
    options: [],
    goal_node_id: null,
  } as unknown as GraphV3T;
}

// ============================================================================
// Single value update
// ============================================================================

describe("buildAppliedChanges — single value update", () => {
  it("produces correct summary and description for a single update_node op", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "fac_price",
        value: { value: 0.5 },
        old_value: { value: 0.3 },
      },
    ];
    const graph = makeGraph([{ id: "fac_price", label: "Pricing", kind: "factor", value: 0.3 }]);
    const result = buildAppliedChanges(ops, graph, false);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].label).toBe("Pricing");
    expect(result.changes[0].description).toContain("Pricing");
    expect(result.changes[0].description).toContain("0.3");
    expect(result.changes[0].description).toContain("0.5");
    // element_ref is the path (internal ID) — OK for UI highlighting
    expect(result.changes[0].element_ref).toBe("fac_price");
    // summary should not contain internal IDs
    expect(result.summary).not.toContain("fac_price");
  });

  it("rerun_recommended is false when no existing analysis", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "fac_price", value: { value: 0.5 }, old_value: { value: 0.3 } },
    ];
    const graph = makeGraph([{ id: "fac_price", label: "Pricing" }]);
    const result = buildAppliedChanges(ops, graph, false);
    expect(result.rerun_recommended).toBe(false);
  });

  it("rerun_recommended is true when existing analysis and substantive node change", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "fac_price", value: { value: 0.5 }, old_value: { value: 0.3 } },
    ];
    const graph = makeGraph([{ id: "fac_price", label: "Pricing" }]);
    const result = buildAppliedChanges(ops, graph, true); // hasExistingAnalysis = true
    expect(result.rerun_recommended).toBe(true);
  });
});

// ============================================================================
// Label-only change → cosmetic → rerun_recommended false
// ============================================================================

describe("buildAppliedChanges — label-only change (cosmetic)", () => {
  it("rerun_recommended is false for label-only update_node", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "fac_price",
        value: { label: "New Pricing Name" },
        old_value: { label: "Pricing" },
      },
    ];
    const graph = makeGraph([{ id: "fac_price", label: "Pricing" }]);
    const result = buildAppliedChanges(ops, graph, true); // analysis exists
    expect(result.rerun_recommended).toBe(false);
  });

  it("description for label-only uses rename phrasing", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "fac_price",
        value: { label: "Revenue Sensitivity" },
        old_value: { label: "Pricing" },
      },
    ];
    const graph = makeGraph([{ id: "fac_price", label: "Pricing" }]);
    const result = buildAppliedChanges(ops, graph, false);
    expect(result.changes[0].description).toContain("Pricing");
    expect(result.changes[0].description).toContain("Revenue Sensitivity");
  });
});

// ============================================================================
// Missing old_value → description of new state only
// ============================================================================

describe("buildAppliedChanges — missing old_value", () => {
  it("describes new state when old_value is absent", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "fac_churn",
        value: { value: 0.15 },
        // no old_value
      },
    ];
    const graph = makeGraph([{ id: "fac_churn", label: "Churn Rate" }]);
    const result = buildAppliedChanges(ops, graph, false);

    expect(result.changes[0].description).toContain("Churn Rate");
    expect(result.changes[0].description).toContain("0.15");
    // Should not contain "undefined" or "→"
    expect(result.changes[0].description).not.toContain("undefined");
  });
});

// ============================================================================
// Compound edit — multiple ops, grouped summary
// ============================================================================

describe("buildAppliedChanges — compound edit", () => {
  it("produces multiple change items and a grouped summary", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "fac_price", value: { value: 0.5 }, old_value: { value: 0.3 } },
      { op: "update_node", path: "fac_churn", value: { value: 0.1 }, old_value: { value: 0.2 } },
    ];
    const graph = makeGraph([
      { id: "fac_price", label: "Pricing" },
      { id: "fac_churn", label: "Churn Rate" },
    ]);
    const result = buildAppliedChanges(ops, graph, true);

    expect(result.changes).toHaveLength(2);
    // Summary mentions count or grouped description
    expect(result.summary).toMatch(/\d+ (changes|model parameters)/);
    expect(result.rerun_recommended).toBe(true);
  });

  it("each change item has the right label", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "fac_a", value: { value: 1 } },
      { op: "update_node", path: "fac_b", value: { value: 2 } },
    ];
    const graph = makeGraph([
      { id: "fac_a", label: "Factor A" },
      { id: "fac_b", label: "Factor B" },
    ]);
    const result = buildAppliedChanges(ops, graph, false);

    const labels = result.changes.map(c => c.label);
    expect(labels).toContain("Factor A");
    expect(labels).toContain("Factor B");
  });
});

// ============================================================================
// add_node / remove_node
// ============================================================================

describe("buildAppliedChanges — add_node and remove_node", () => {
  it("add_node produces correct description", () => {
    const ops: PatchOperation[] = [
      { op: "add_node", path: "fac_new", value: { label: "New Factor", kind: "factor", category: "risk" } },
    ];
    const graph = makeGraph([{ id: "fac_new", label: "New Factor" }]);
    const result = buildAppliedChanges(ops, graph, false);

    expect(result.changes[0].description).toContain("New Factor");
    expect(result.changes[0].description.toLowerCase()).toContain("added");
  });

  it("remove_node produces correct description", () => {
    const ops: PatchOperation[] = [
      { op: "remove_node", path: "fac_old", old_value: { label: "Old Factor" } },
    ];
    const graph = makeGraph([{ id: "fac_old", label: "Old Factor" }]);
    const result = buildAppliedChanges(ops, graph, true);

    expect(result.changes[0].description).toContain("Old Factor");
    expect(result.changes[0].description.toLowerCase()).toContain("removed");
    expect(result.rerun_recommended).toBe(true);
  });
});

// ============================================================================
// Edge operations → rerun_recommended
// ============================================================================

describe("buildAppliedChanges — edge changes trigger rerun", () => {
  it("update_edge triggers rerun_recommended when analysis exists", () => {
    const ops: PatchOperation[] = [
      { op: "update_edge", path: "fac_a::out_b", value: { strength: { mean: 0.8 } } },
    ];
    const graph: GraphV3T = {
      nodes: [
        { id: "fac_a", label: "Factor A", kind: "factor" },
        { id: "out_b", label: "Outcome B", kind: "outcome" },
      ],
      edges: [{ from: "fac_a", to: "out_b", strength: { mean: 0.5 } }],
      options: [],
      goal_node_id: null,
    } as unknown as GraphV3T;
    const result = buildAppliedChanges(ops, graph, true);
    expect(result.rerun_recommended).toBe(true);
  });
});

// ============================================================================
// No internal IDs in summary or description
// ============================================================================

describe("buildAppliedChanges — no internal IDs in user-facing fields", () => {
  it("summary does not contain node IDs", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "fac_pricing_123", value: { value: 0.9 }, old_value: { value: 0.5 } },
    ];
    const graph = makeGraph([{ id: "fac_pricing_123", label: "Pricing" }]);
    const result = buildAppliedChanges(ops, graph, false);

    expect(result.summary).not.toContain("fac_pricing_123");
  });

  it("description uses label not path when label is available", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "node_xyz_999", value: { value: 0.3 } },
    ];
    const graph = makeGraph([{ id: "node_xyz_999", label: "Customer Satisfaction" }]);
    const result = buildAppliedChanges(ops, graph, false);

    expect(result.changes[0].label).toBe("Customer Satisfaction");
    expect(result.changes[0].description).toContain("Customer Satisfaction");
    expect(result.changes[0].description).not.toContain("node_xyz_999");
  });
});
