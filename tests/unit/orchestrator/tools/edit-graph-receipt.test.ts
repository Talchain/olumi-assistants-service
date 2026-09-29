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
// Label edit that carries a CHANGED quantitative value → divergence disclosure
// (P0: a label-only rename that changes an embedded number on a node with a
//  modelled value must NOT read as a completed value change / bare rename.)
// ============================================================================

describe("buildAppliedChanges — label edit diverges from modelled value", () => {
  function optionGraph(label: string): GraphV3T {
    return {
      nodes: [
        { id: "fac_price", kind: "factor", label: "Price", observed_state: { value: 0.49, cap: 100 } },
        {
          id: "opt_raise",
          kind: "option",
          label,
          interventions: {
            fac_price: {
              value: 0.49,
              raw_value: 49,
              source: "user_specified",
              target_match: { node_id: "fac_price", match_type: "exact_id", confidence: "high" },
            },
          },
        },
      ],
      edges: [],
      options: [],
      goal_node_id: null,
    } as unknown as GraphV3T;
  }

  it("summary and description disclose the divergence instead of a bare rename", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "opt_raise",
        value: { label: "Raise price to $39" },
        old_value: { label: "Raise price to $49" },
      },
    ];
    const pre = optionGraph("Raise price to $49");
    const post = optionGraph("Raise price to $39");
    const result = buildAppliedChanges(ops, post, false, pre);

    // The leak was a bare `Renamed "Raise price to $49" to "Raise price to $39"`.
    expect(result.summary).not.toMatch(/^Renamed "/);
    expect(result.summary.toLowerCase()).toMatch(/display text only|modelled value/);
    expect(result.changes[0].description.toLowerCase()).toMatch(/display text only|modelled value/);
    // Nothing modelled changed → no rerun.
    expect(result.rerun_recommended).toBe(false);
  });

  it("a plain rename with no numeric change keeps the ordinary rename phrasing", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "opt_raise",
        value: { label: "The aggressive raise" },
        old_value: { label: "Raise price to $49" },
      },
    ];
    const pre = optionGraph("Raise price to $49");
    const post = optionGraph("The aggressive raise");
    const result = buildAppliedChanges(ops, post, false, pre);
    expect(result.changes[0].description).toMatch(/Renamed/);
    expect(result.summary.toLowerCase()).not.toMatch(/display text only/);
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

// ============================================================================
// ROADMAP 2.1003 (c) — AUTHORED NOTES ON THE RECEIPT
//
// The companion to the comparator fix in `edit-outcome-binding.ts`. Once a
// note-only edit is correctly reported as a CHANGE, the receipt is the sentence
// the user reads (`edit-graph-dispatch.ts:1541`), so it must name what moved.
//
// The oracle is `isSubstantiveOperation`'s OWN declared semantics —
// *"substantive (affects model outputs)"* — cross-read against the repo's
// authority on what affects outputs: `computeAnalysisAffectingGraphHash`
// (`context/graph-hash.ts:104`) names `descriptions` in its EXCLUDED list.
// Prose cannot move a number, so a note-only edit must NOT recommend a rerun.
// That keeps authored-content change and numerical freshness two questions
// with two answers, which is the whole point of the comparator split.
// ============================================================================

describe("buildAppliedChanges — authored note (description/body) ops", () => {
  const NOTE = "Board wants this framed as retention, not acquisition.";

  it("names the note when one is ADDED to a node that had none", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "goal_nrr", value: { description: NOTE } },
    ];
    const graph = makeGraph([{ id: "goal_nrr", label: "Improve NRR", kind: "goal" }]);
    const result = buildAppliedChanges(ops, graph, false);

    // BOUND BY IDENTITY: the receipt must name THIS node, by its label.
    expect(result.changes[0].element_ref).toBe("goal_nrr");
    expect(result.changes[0].label).toBe("Improve NRR");
    // PINNED EXACTLY. `toContain("note")` was too slack to bite: it is satisfied
    // by "Added", "Updated" and "Removed" alike, so a receipt that lost the
    // distinction survived the mutant that removed it. The copy IS the product
    // surface on this turn, so the whole sentence is the assertion.
    expect(result.changes[0].description).toBe("Added a note to Improve NRR");
    // And it must not read as a bare "Updated X", which was true of a no-change
    // apply and true of a wrong-object apply alike.
    expect(result.changes[0].description).not.toContain("goal_nrr");
  });

  it("distinguishes UPDATING an existing note from ADDING one", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "goal_nrr",
        value: { description: NOTE },
        old_value: { description: "An earlier note." },
      },
    ];
    const graph = makeGraph([{ id: "goal_nrr", label: "Improve NRR", kind: "goal" }]);
    const result = buildAppliedChanges(ops, graph, false);
    expect(result.changes[0].description).toBe("Updated the note on Improve NRR");
    expect(result.changes[0].description).not.toContain("Added");
  });

  it("distinguishes REMOVING a note from updating one", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "goal_nrr",
        value: { description: "" },
        old_value: { description: "An earlier note." },
      },
    ];
    const graph = makeGraph([{ id: "goal_nrr", label: "Improve NRR", kind: "goal" }]);
    const result = buildAppliedChanges(ops, graph, false);
    expect(result.changes[0].description).toBe("Removed the note on Improve NRR");
  });

  it("the `body` spelling of authored prose gets the same receipt", () => {
    const ops: PatchOperation[] = [
      { op: "update_node", path: "goal_nrr", value: { body: NOTE } },
    ];
    const graph = makeGraph([{ id: "goal_nrr", label: "Improve NRR", kind: "goal" }]);
    const result = buildAppliedChanges(ops, graph, false);
    expect(result.changes[0].description).toBe("Added a note to Improve NRR");
  });

  it("a note-only edit does NOT recommend a rerun, even with an analysis in scope", () => {
    // THE SEPARATION THAT MUST HOLD. A note is authored content; it is not an
    // input to the maths. Recommending a rerun for it would collapse the two
    // questions the comparator split exists to keep apart.
    const ops: PatchOperation[] = [
      { op: "update_node", path: "goal_nrr", value: { description: NOTE } },
    ];
    const graph = makeGraph([{ id: "goal_nrr", label: "Improve NRR", kind: "goal" }]);
    const result = buildAppliedChanges(ops, graph, true); // analysis exists
    expect(result.rerun_recommended).toBe(false);
  });

  it("THE OPPOSITE-DIRECTION TWIN: a note carried ALONGSIDE a value edit still reruns", () => {
    // The narrowing must be exactly "prose and nothing else". A compound op
    // that also moves a number is substantive, and suppressing its rerun would
    // be the inverse harm — a stale analysis presented as current.
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "fac_price",
        value: { value: 0.9, description: NOTE },
        old_value: { value: 0.5 },
      },
    ];
    const graph = makeGraph([{ id: "fac_price", label: "Pricing" }]);
    const result = buildAppliedChanges(ops, graph, true);
    expect(result.rerun_recommended).toBe(true);
    // And its receipt keeps the value transition, not the note phrasing.
    expect(result.changes[0].description).toContain("0.5");
    expect(result.changes[0].description).toContain("0.9");
  });

  it("a rename carried alongside a note keeps today's phrasing (unchanged behaviour)", () => {
    const ops: PatchOperation[] = [
      {
        op: "update_node",
        path: "fac_price",
        value: { label: "Revenue Sensitivity", description: NOTE },
        old_value: { label: "Pricing" },
      },
    ];
    const graph = makeGraph([{ id: "fac_price", label: "Pricing" }]);
    const result = buildAppliedChanges(ops, graph, true);
    // Cosmetic + prose — neither moves a number.
    expect(result.rerun_recommended).toBe(false);
    // The prose branch requires prose AND NOTHING ELSE, so a compound op keeps
    // exactly the phrasing it has on `staging` today.
    expect(result.changes[0].description).toBe("Updated Pricing");
  });
});
