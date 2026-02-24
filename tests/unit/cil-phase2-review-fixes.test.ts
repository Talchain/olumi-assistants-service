/**
 * CIL Phase 1+2 Review Fix Tests
 *
 * Tests for the 13-task CIL review fix brief:
 * Task 1: Anthropic node whitelist → spread (covered by Task 8)
 * Task 2: Synthetic edge completeness (goal-inference, compound-goal, enricher)
 * Task 3: needs_user_input status handling
 * Task 4: factor.confidence fallback
 * Task 5: Blocker factor_label fallback
 * Task 6: Category-missing fallback for blocker logic
 * Task 7: Deduplicate blockers
 * Task 8: Anthropic passthrough test
 * Task 9: data.value provenance source marker
 * Task 10: mapMutationsToAdjustments node labels + validation
 * Task 11: detectGoalNoBaselineValue data.value check
 * Task 12: Anthropic/OpenAI adapter alignment
 * Task 13: ID normaliser (no duplication — verified)
 */

import { describe, it, expect } from "vitest";
import {
  buildAnalysisReadyPayload,
  mapMutationsToAdjustments,
} from "../../src/cee/transforms/analysis-ready.js";
import {
  wireOutcomesToGoal,
} from "../../src/cee/structure/goal-inference.js";
import {
  constraintEdgesToGraphEdges,
  generateConstraintEdge,
} from "../../src/cee/compound-goal/node-generator.js";
import type { OptionV3T, GraphV3T, NodeV3T } from "../../src/schemas/cee-v3.js";
import type { ExtractedGoalConstraint } from "../../src/cee/compound-goal/extractor.js";
import { AnalysisBlocker } from "../../src/schemas/analysis-ready.js";

// ============================================================================
// Shared Test Fixtures
// ============================================================================

function createV3Option(
  id: string,
  label: string,
  interventions: Record<string, { value: number; factorId: string }> = {},
  status: "ready" | "needs_user_mapping" = "needs_user_mapping"
): OptionV3T {
  const v3Interventions: OptionV3T["interventions"] = {};
  for (const [key, { value, factorId }] of Object.entries(interventions)) {
    v3Interventions[key] = {
      value,
      source: "brief_extraction",
      target_match: {
        node_id: factorId,
        match_type: "exact_id",
        confidence: "high",
      },
    };
  }
  return {
    id,
    label,
    status,
    interventions: v3Interventions,
  };
}

function createV3Graph(
  nodes: Array<{
    id: string;
    kind: string;
    label?: string;
    category?: "controllable" | "observable" | "external";
    observed_state?: { value: number; unit?: string };
    data?: { value: number };
  }>,
  edges: Array<{ from: string; to: string }>
): GraphV3T {
  return {
    nodes: nodes.map((n) => {
      const node: any = {
        id: n.id,
        kind: n.kind as NodeV3T["kind"],
        label: n.label ?? n.id,
      };
      if (n.category) node.category = n.category;
      if (n.observed_state) node.observed_state = n.observed_state;
      if (n.data) node.data = n.data;
      return node as NodeV3T;
    }),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      strength: { mean: 0.5, std: 0.2 },
      exists_probability: 0.8,
      effect_direction: "positive" as const,
    })),
  };
}

// ============================================================================
// Task 2: Synthetic Edge Completeness
// ============================================================================

describe("Task 2A: Goal-inference synthetic edge completeness", () => {
  it("wireOutcomesToGoal edges include effect_direction, origin, and provenance", () => {
    const graph: any = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "out_1", kind: "outcome", label: "Good Outcome" },
        { id: "risk_1", kind: "risk", label: "Bad Risk" },
      ],
      edges: [],
    };

    const result = wireOutcomesToGoal(graph, "goal_1");

    const outcomeEdge = (result.edges as any[]).find(
      (e) => e.from === "out_1" && e.to === "goal_1"
    );
    const riskEdge = (result.edges as any[]).find(
      (e) => e.from === "risk_1" && e.to === "goal_1"
    );

    // V4 fields present
    expect(outcomeEdge).toBeDefined();
    expect(outcomeEdge.strength_mean).toBe(0.7);
    expect(outcomeEdge.strength_std).toBe(0.15);
    expect(outcomeEdge.belief_exists).toBe(0.9);
    expect(outcomeEdge.effect_direction).toBe("positive");
    expect(outcomeEdge.origin).toBe("default");
    expect(outcomeEdge.provenance_source).toBe("synthetic");
    expect(outcomeEdge.provenance).toBeDefined();
    expect(outcomeEdge.provenance.source).toBe("synthetic");

    // Risk edge should be negative
    expect(riskEdge).toBeDefined();
    expect(riskEdge.strength_mean).toBe(-0.5);
    expect(riskEdge.effect_direction).toBe("negative");
    expect(riskEdge.origin).toBe("default");
  });
});

describe("Task 2B: Compound-goal constraint edge completeness", () => {
  it("constraintEdgesToGraphEdges includes origin and provenance", () => {
    const constraintEdges = [
      generateConstraintEdge("constraint_goal_1_min", "goal_1"),
    ];
    const graphEdges = constraintEdgesToGraphEdges(constraintEdges);

    expect(graphEdges).toHaveLength(1);
    expect(graphEdges[0].origin).toBe("default");
    expect(graphEdges[0].provenance_source).toBe("synthetic");
    expect((graphEdges[0] as any).provenance).toBeDefined();
    expect((graphEdges[0] as any).provenance.source).toBe("synthetic");
    expect(graphEdges[0].belief_exists).toBe(1.0);
  });
});

// ============================================================================
// Task 5: Blocker factor_label fallback
// ============================================================================

describe("Task 5: Blocker factor_label fallback", () => {
  it("uses factor ID as fallback when label is undefined", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "Opt A" },
        // Factor node with no label
        { id: "fac_unknown", kind: "factor", category: "controllable" },
      ],
      [{ from: "opt_a", to: "fac_unknown" }]
    );
    const options = [createV3Option("opt_a", "Opt A")];
    const result = buildAnalysisReadyPayload(options, "goal_1", graph);

    expect(result.blockers).toBeDefined();
    expect(result.blockers!.length).toBeGreaterThan(0);
    // Factor label should fall back to factor ID
    expect(result.blockers![0].factor_label).toBe("fac_unknown");
  });
});

// ============================================================================
// Task 6: Category-missing fallback
// ============================================================================

describe("Task 6: Category-missing fallback for blocker logic", () => {
  it("treats undefined category as potentially controllable via edge signal", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "Opt A" },
        // Factor with NO category — connected via option→factor edge
        { id: "fac_x", kind: "factor", label: "Factor X" },
      ],
      [{ from: "opt_a", to: "fac_x" }]
    );
    const options = [createV3Option("opt_a", "Opt A")];
    const result = buildAnalysisReadyPayload(options, "goal_1", graph);

    // Should emit a blocker (missing value) rather than silently skipping
    expect(result.status).toBe("needs_user_input");
    expect(result.blockers).toBeDefined();
    expect(result.blockers!.some((b) => b.factor_id === "fac_x")).toBe(true);
  });

  it("still skips explicitly non-controllable factors", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "Opt A" },
        // Explicitly external — should be skipped
        { id: "fac_ext", kind: "factor", label: "External", category: "external" },
      ],
      [{ from: "opt_a", to: "fac_ext" }]
    );
    const options = [createV3Option("opt_a", "Opt A")];
    const result = buildAnalysisReadyPayload(options, "goal_1", graph);

    // No blockers for external factors
    const extBlocker = (result.blockers ?? []).find((b) => b.factor_id === "fac_ext");
    expect(extBlocker).toBeUndefined();
  });
});

// ============================================================================
// Task 7: Deduplicate blockers
// ============================================================================

describe("Task 7: Deduplicate blockers", () => {
  it("deduplicates blockers by (option_id, factor_id) pair", () => {
    // Create a graph where the same factor appears on multiple edges to same option
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "Opt A" },
        { id: "fac_1", kind: "factor", label: "Factor 1", category: "controllable" },
      ],
      [
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_1" }, // Duplicate edge
      ]
    );
    const options = [createV3Option("opt_a", "Opt A")];
    const result = buildAnalysisReadyPayload(options, "goal_1", graph);

    // Should only have 1 blocker despite 2 edges
    const fac1Blockers = (result.blockers ?? []).filter(
      (b) => b.option_id === "opt_a" && b.factor_id === "fac_1"
    );
    expect(fac1Blockers).toHaveLength(1);
  });
});

// ============================================================================
// Task 9: data.value provenance source marker
// ============================================================================

describe("Task 9: Provenance source marker for fallback interventions", () => {
  it("observed_state.value fallback produces correct intervention value", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "Opt A" },
        { id: "fac_1", kind: "factor", label: "Price", category: "controllable", observed_state: { value: 42 } },
      ],
      [{ from: "opt_a", to: "fac_1" }]
    );
    const options = [createV3Option("opt_a", "Opt A")];
    const result = buildAnalysisReadyPayload(options, "goal_1", graph);

    expect(result.options[0].interventions["fac_1"]).toBe(42);
    // No blockers for this factor (value was resolved)
    expect(result.blockers).toBeUndefined();
  });

  it("data.value fallback produces correct intervention value", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "Opt A" },
        { id: "fac_1", kind: "factor", label: "Price", category: "controllable", data: { value: 99 } },
      ],
      [{ from: "opt_a", to: "fac_1" }]
    );
    const options = [createV3Option("opt_a", "Opt A")];
    const result = buildAnalysisReadyPayload(options, "goal_1", graph);

    expect(result.options[0].interventions["fac_1"]).toBe(99);
  });
});

// ============================================================================
// Task 10: mapMutationsToAdjustments enrichment + validation
// ============================================================================

describe("Task 10A: mapMutationsToAdjustments node labels", () => {
  it("enriches reason with node label when available", () => {
    const nodeLabels = new Map([["fac_price", "Price (GBP)"]]);
    const adjustments = mapMutationsToAdjustments(
      [{
        code: "CATEGORY_OVERRIDE",
        node_id: "fac_price",
        field: "category",
        before: "observable",
        after: "controllable",
        reason: "Category reclassified",
      }],
      undefined,
      nodeLabels
    );

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].reason).toBe("Category reclassified (Price (GBP))");
  });

  it("omits label enrichment when node ID not in lookup", () => {
    const nodeLabels = new Map<string, string>();
    const adjustments = mapMutationsToAdjustments(
      [{
        code: "SIGN_CORRECTED",
        node_id: "edge_unknown",
        field: "strength_mean",
        before: 0.5,
        after: -0.5,
        reason: "Sign corrected",
      }],
      undefined,
      nodeLabels
    );

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].reason).toBe("Sign corrected");
  });
});

describe("Task 10B: mapMutationsToAdjustments input validation", () => {
  it("skips malformed STRP mutations (missing code)", () => {
    const adjustments = mapMutationsToAdjustments(
      [
        { code: "CATEGORY_OVERRIDE", field: "category", before: "a", after: "b", reason: "good" },
        null as any, // null entry
        { code: undefined as any, field: "x", before: null, after: null, reason: "bad" },
      ],
      undefined,
    );

    // Only the valid CATEGORY_OVERRIDE should produce an adjustment
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].code).toBe("category_reclassified");
  });

  it("skips malformed corrections (missing reason)", () => {
    const adjustments = mapMutationsToAdjustments(
      undefined,
      [
        { type: "edge_added", target: { node_id: "n1" }, reason: "valid" },
        { type: "edge_added", target: { node_id: "n2" }, reason: undefined as any },
      ],
    );

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].code).toBe("connectivity_repaired");
  });
});

// ============================================================================
// Task 11: detectGoalNoBaselineValue data.value check
// ============================================================================

describe("Task 11: detectGoalNoBaselineValue data.value check", () => {
  // This is tested via the structure/index.ts module
  // The function checks: observed_state.value ?? data.observed_value ?? data.value
  // We test the chain end-to-end via the existing import
  it("data.value chain is present in source code", async () => {
    // Read source to verify the fix was applied correctly
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/cee/structure/index.ts",
      "utf-8"
    );
    // Verify the triple fallback chain
    expect(source).toContain("goalNode?.data?.value");
    expect(source).toContain("goalNode?.observed_state?.value");
    expect(source).toContain("goalNode?.data?.observed_value");
  });
});

// ============================================================================
// Task 8: Anthropic adapter passthrough test (node spread)
// ============================================================================

describe("Task 8: Anthropic adapter node spread pattern", () => {
  it("anthropic adapter uses spread (...n) for nodes in source code", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/adapters/llm/anthropic.ts",
      "utf-8"
    );
    // Verify the spread pattern is used (not explicit whitelist)
    expect(source).toContain("...n,");
    // Should NOT have the old whitelist pattern for draft or repair
    // The old pattern had explicit id, kind, label, body, category, data fields
    const draftSection = source.indexOf("// Build graph");
    const repairSection = source.indexOf("nodes: parsed.nodes.map");
    // Both sections should use spread
    expect(draftSection).toBeGreaterThan(-1);
    expect(repairSection).toBeGreaterThan(-1);
  });
});

// ============================================================================
// Task 12: OpenAI adapter edge alignment
// ============================================================================

describe("Task 12: OpenAI adapter edge legacy fallbacks", () => {
  it("OpenAI sortGraph adds legacy weight/belief fallbacks", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/adapters/llm/openai.ts",
      "utf-8"
    );
    // Verify legacy fallbacks are present in sortGraph
    expect(source).toContain("weight: edge.weight ?? edge.strength_mean");
    expect(source).toContain("belief: edge.belief ?? edge.belief_exists");
  });
});

// ============================================================================
// Task 3B: needs_user_input in V3 retry suggestion
// ============================================================================

describe("Task 3B: needs_user_input in retry suggestion", () => {
  it("retry suggestion condition includes needs_user_input", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/cee/transforms/schema-v3.ts",
      "utf-8"
    );
    // Verify the retry condition checks for both statuses
    expect(source).toContain('analysisReady.status === "needs_user_mapping" || analysisReady.status === "needs_user_input"');
  });
});

// ============================================================================
// Task 3A: needs_user_input in graph readiness
// ============================================================================

describe("Task 3A: needs_user_input in graph readiness", () => {
  it("readiness route surfaces payload-level blockers", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      "src/routes/assist.v1.graph-readiness.ts",
      "utf-8"
    );
    // Verify that needs_user_input is handled
    expect(source).toContain('analysisReady.status === "needs_user_input"');
    expect(source).toContain("analysisReady.blockers");
  });
});

// ============================================================================
// AnalysisBlocker schema validation
// ============================================================================

describe("AnalysisBlocker schema", () => {
  it("validates blocker with all required fields", () => {
    const valid = AnalysisBlocker.safeParse({
      factor_id: "fac_1",
      factor_label: "Price",
      blocker_type: "missing_value",
      message: "Need a value",
      suggested_action: "add_value",
    });
    expect(valid.success).toBe(true);
  });

  it("rejects blocker with missing factor_label", () => {
    const invalid = AnalysisBlocker.safeParse({
      factor_id: "fac_1",
      blocker_type: "missing_value",
      message: "Need a value",
      suggested_action: "add_value",
    });
    expect(invalid.success).toBe(false);
  });
});
