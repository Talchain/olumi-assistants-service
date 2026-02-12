/**
 * CIL Phase 2: Field Preservation Tests
 *
 * Validates that .passthrough() on internal schemas prevents silent field
 * stripping, and that synthetic edges contain all required fields.
 *
 * Tasks: 1A, 1B, 1C, 1D, 1E, 1F
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Graph, Edge, Node } from "../../src/schemas/graph.js";
import { LLMEdge } from "../../src/adapters/llm/shared-schemas.js";
import { DraftGraphOutput } from "../../src/schemas/assist.js";
import { PipelineTraceSchema } from "../../src/schemas/ceeResponses.js";
import { simpleRepair } from "../../src/services/repair.js";
import type { GraphT } from "../../src/schemas/graph.js";

// ============================================================================
// Task 1B: LLMEdge .passthrough()
// ============================================================================

describe("Task 1B: LLMEdge passthrough", () => {
  it("preserves unknown fields through LLMEdge.parse()", () => {
    const input = {
      from: "a",
      to: "b",
      strength_mean: 0.5,
      strength_std: 0.1,
      belief_exists: 0.8,
      effect_direction: "positive" as const,
      weight: 0.5,
      _test_passthrough: true,
      origin: "ai",
    };
    const parsed = LLMEdge.parse(input);
    expect((parsed as any)._test_passthrough).toBe(true);
    expect((parsed as any).origin).toBe("ai");
  });

  it("still validates known fields", () => {
    expect(() =>
      LLMEdge.parse({ from: "", to: "b" })
    ).toThrow(); // from must be min(1)
  });
});

// ============================================================================
// Task 1C: Graph Edge/Node .passthrough()
// ============================================================================

describe("Task 1C: Graph Edge/Node passthrough", () => {
  const minimalGraph = {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Goal" },
      { id: "factor_1", kind: "factor", label: "Factor" },
    ],
    edges: [
      {
        from: "factor_1",
        to: "goal_1",
        strength_mean: 0.5,
        strength_std: 0.1,
        belief_exists: 0.8,
        effect_direction: "positive",
        _test_passthrough: true,
      },
    ],
    meta: {
      roots: ["factor_1"],
      leaves: ["goal_1"],
      suggested_positions: {},
      source: "test" as const,
    },
  };

  it("preserves unknown edge fields through Graph.safeParse()", () => {
    const result = Graph.safeParse(minimalGraph);
    expect(result.success).toBe(true);
    if (result.success) {
      const edge = result.data.edges[0];
      expect((edge as any)._test_passthrough).toBe(true);
    }
  });

  it("preserves unknown node fields through Graph.safeParse()", () => {
    const graphWithExtraNodeField = {
      ...minimalGraph,
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal", _test_node_passthrough: "yes" },
        { id: "factor_1", kind: "factor", label: "Factor" },
      ],
    };
    const result = Graph.safeParse(graphWithExtraNodeField);
    expect(result.success).toBe(true);
    if (result.success) {
      const goalNode = result.data.nodes.find((n) => n.id === "goal_1");
      expect((goalNode as any)._test_node_passthrough).toBe("yes");
    }
  });

  it("edge transform (source→from) still works with passthrough", () => {
    const graphWithSourceTarget = {
      ...minimalGraph,
      edges: [
        {
          source: "factor_1",
          target: "goal_1",
          strength_mean: 0.5,
          _test_passthrough: true,
        },
      ],
    };
    const result = Graph.safeParse(graphWithSourceTarget);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.edges[0].from).toBe("factor_1");
      expect(result.data.edges[0].to).toBe("goal_1");
      expect((result.data.edges[0] as any)._test_passthrough).toBe(true);
    }
  });
});

// ============================================================================
// Task 1D: DraftGraphOutput .passthrough()
// ============================================================================

describe("Task 1D: DraftGraphOutput passthrough", () => {
  it("preserves extra top-level fields through DraftGraphOutput.parse()", () => {
    const payload = {
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "goal_1", kind: "goal", label: "Goal" }],
        edges: [],
        meta: {
          roots: [],
          leaves: ["goal_1"],
          suggested_positions: {},
          source: "test" as const,
        },
      },
      _test_passthrough: true,
    };
    const parsed = DraftGraphOutput.parse(payload);
    expect((parsed as any)._test_passthrough).toBe(true);
  });
});

// ============================================================================
// Task 1E: PipelineTraceSchema .passthrough()
// ============================================================================

describe("Task 1E: PipelineTraceSchema passthrough", () => {
  it("preserves extra fields through PipelineTraceSchema.parse()", () => {
    const payload = {
      status: "success" as const,
      total_duration_ms: 100,
      llm_call_count: 1,
      stages: [],
      // Extra fields that exist at runtime but not in schema
      checkpoints: { stage_1: { nodes: 5, edges: 3 } },
      llm_metadata: { model: "gpt-4o" },
      cee_provenance: "test",
    };
    const parsed = PipelineTraceSchema.parse(payload);
    expect((parsed as any).checkpoints).toEqual({ stage_1: { nodes: 5, edges: 3 } });
    expect((parsed as any).llm_metadata).toEqual({ model: "gpt-4o" });
    expect((parsed as any).cee_provenance).toBe("test");
  });
});

// ============================================================================
// Task 1F-i: Repair synthetic edge completeness
// ============================================================================

describe("Task 1F-i: Repair synthetic edge completeness", () => {
  /**
   * Required fields on every synthetic edge.
   */
  const REQUIRED_SYNTHETIC_EDGE_FIELDS = [
    "from",
    "to",
    "strength_mean",
    "strength_std",
    "belief_exists",
    "effect_direction",
    "origin",
    "provenance_source",
    "provenance",
  ];

  it("wireOrphansToGoal produces edges with all required fields", () => {
    // Graph with orphaned outcome that needs wiring to goal
    const graph: GraphT = Graph.parse({
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option A" },
        { id: "fac_1", kind: "factor", label: "Factor", category: "controllable" },
        { id: "out_1", kind: "outcome", label: "Orphaned Outcome" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_1", strength_mean: 1, strength_std: 0.1, belief_exists: 1 },
        { from: "opt_1", to: "fac_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8 },
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8 },
        // out_1 → goal_1 is MISSING — repair should create it
      ],
      meta: {
        roots: ["dec_1"],
        leaves: ["goal_1"],
        suggested_positions: {},
        source: "test" as const,
      },
    });

    const repaired = simpleRepair(graph);

    // Find the synthetic edge from out_1 to goal_1
    const syntheticEdge = repaired.edges.find(
      (e) => e.from === "out_1" && e.to === "goal_1"
    );
    expect(syntheticEdge).toBeDefined();

    for (const field of REQUIRED_SYNTHETIC_EDGE_FIELDS) {
      expect(syntheticEdge).toHaveProperty(field);
    }
    expect(syntheticEdge!.origin).toBe("repair");
    expect(syntheticEdge!.provenance_source).toBe("synthetic");
    expect(syntheticEdge!.provenance).toContain("wireOrphansToGoal");
  });

  it("wireOrphansFromCausalChain produces edges with all required fields", () => {
    // Graph with outcome that has edge TO goal but no INBOUND edge from factor
    const graph: GraphT = Graph.parse({
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option A" },
        { id: "fac_1", kind: "factor", label: "Factor", category: "controllable" },
        { id: "out_1", kind: "outcome", label: "Orphaned Outcome" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_1", strength_mean: 1, strength_std: 0.1, belief_exists: 1 },
        { from: "opt_1", to: "fac_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8 },
        // fac_1 → out_1 is MISSING — wireOrphansFromCausalChain should create it
        { from: "out_1", to: "goal_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8 },
      ],
      meta: {
        roots: ["dec_1"],
        leaves: ["goal_1"],
        suggested_positions: {},
        source: "test" as const,
      },
    });

    const repaired = simpleRepair(graph);

    // Find the synthetic edge from fac_1 to out_1
    const syntheticEdge = repaired.edges.find(
      (e) => e.from === "fac_1" && e.to === "out_1"
    );
    expect(syntheticEdge).toBeDefined();

    for (const field of REQUIRED_SYNTHETIC_EDGE_FIELDS) {
      expect(syntheticEdge).toHaveProperty(field);
    }
    expect(syntheticEdge!.origin).toBe("repair");
    expect(syntheticEdge!.provenance_source).toBe("synthetic");
    expect(syntheticEdge!.provenance).toContain("wireOrphansFromCausalChain");
  });
});

// ============================================================================
// Task 1F-ii: Enrichment synthetic edge completeness
// ============================================================================

describe("Task 1F-ii: Enrichment synthetic edge completeness", () => {
  it("enricher creates edges with all V4 strength fields", async () => {
    const { enrichGraphWithFactorsAsync } = await import(
      "../../src/cee/factor-extraction/enricher.js"
    );

    // Graph that needs factor enrichment (no existing factors with data)
    const graph: GraphT = Graph.parse({
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal_1", kind: "goal", label: "Increase Revenue" },
        { id: "dec_1", kind: "decision", label: "Pricing Strategy" },
        { id: "opt_1", kind: "option", label: "Raise Prices" },
        { id: "opt_2", kind: "option", label: "Keep Prices" },
        { id: "out_1", kind: "outcome", label: "Higher Margin" },
      ],
      edges: [
        { from: "dec_1", to: "opt_1", strength_mean: 1, strength_std: 0.1, belief_exists: 1 },
        { from: "dec_1", to: "opt_2", strength_mean: 1, strength_std: 0.1, belief_exists: 1 },
        { from: "opt_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.8 },
        { from: "out_1", to: "goal_1", strength_mean: 0.6, strength_std: 0.1, belief_exists: 0.8 },
      ],
      meta: {
        roots: ["dec_1"],
        leaves: ["goal_1"],
        suggested_positions: {},
        source: "test" as const,
      },
    });

    const brief =
      "Should I raise prices by 20% from £50 to £60 per unit to increase revenue? Current demand is 1000 units per month.";
    const result = await enrichGraphWithFactorsAsync(graph, brief);

    // Check that any injected edges have all required fields
    const enrichedEdges = result.graph.edges.filter(
      (e: any) => e.origin === "enrichment"
    );

    for (const edge of enrichedEdges) {
      expect(edge.from).toBeDefined();
      expect(edge.to).toBeDefined();
      expect(edge.strength_mean).toBeDefined();
      expect(edge.strength_std).toBeDefined();
      expect(edge.belief_exists).toBeDefined();
      expect(edge.effect_direction).toBeDefined();
      expect(edge.origin).toBe("enrichment");
      expect(edge.provenance).toBeDefined();
      expect(edge.provenance_source).toBeDefined();
    }
  });
});
