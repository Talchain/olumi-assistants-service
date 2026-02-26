/**
 * Boundary stage (Stage 6) canary test — V3 transform field preservation
 *
 * Proves that known important fields survive the `transformResponseToV3`
 * transform that runs in Stage 6 (Boundary).
 *
 * Design note: Unlike the adapter-layer canary test (canary-field-passthrough),
 * the V3 transform intentionally constructs new node/edge objects with explicit
 * field mapping. Arbitrary additive fields on V1 nodes/edges are NOT preserved
 * by design — the V3 transform is a controlled schema migration, not a
 * passthrough. The `.passthrough()` on V3 Zod schemas guards fields that make
 * it into the V3 object, but does not inject fields that the transform omits.
 *
 * What this test guards against:
 * - Regressions where known mapped fields are accidentally dropped
 * - V3 response-level fields (coaching, causal_claims, goal_constraints) lost
 * - Node-level fields (category, goal_threshold_*) lost in transformNodeToV3
 * - Edge-level fields (edge_type) lost in transformEdgeToV3
 */

import { describe, it, expect } from "vitest";
import {
  transformResponseToV3,
  transformNodeToV3,
  transformEdgeToV3,
} from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse, V1Node, V1Edge } from "../../src/cee/transforms/schema-v2.js";

// =============================================================================
// Fixture: minimal valid V1 response with all known boundary-crossing fields
// =============================================================================

function makeV1Response(): V1DraftGraphResponse {
  return {
    graph: {
      nodes: [
        { id: "decision_1", kind: "decision", label: "Hire or Build?" },
        {
          id: "opt_a",
          kind: "option",
          label: "Option A",
          data: { interventions: { fac_cost: 100 } },
        },
        {
          id: "fac_cost",
          kind: "factor",
          label: "Cost Factor",
          category: "controllable",
          data: {
            value: 50,
            baseline: 40,
            unit: "GBP",
            factor_type: "cost",
            uncertainty_drivers: ["market volatility"],
          },
        },
        {
          id: "fac_ext",
          kind: "factor",
          label: "External Factor",
          category: "external",
        },
        {
          id: "out_1",
          kind: "outcome",
          label: "Revenue Outcome",
        },
        {
          id: "goal_1",
          kind: "goal",
          label: "Target 800 customers",
          goal_threshold: 0.8,
          goal_threshold_raw: 800,
          goal_threshold_unit: "customers",
          goal_threshold_cap: 1000,
        },
      ],
      edges: [
        {
          from: "decision_1",
          to: "opt_a",
          strength_mean: 1,
          strength_std: 0.01,
          belief_exists: 1,
        },
        {
          from: "opt_a",
          to: "fac_cost",
          strength_mean: 0.6,
          strength_std: 0.1,
          belief_exists: 0.9,
        },
        {
          from: "fac_cost",
          to: "out_1",
          strength_mean: -0.5,
          strength_std: 0.15,
          belief_exists: 0.85,
          edge_type: "bidirected" as const,
        },
        {
          from: "fac_ext",
          to: "out_1",
          strength_mean: 0.3,
          strength_std: 0.1,
          belief_exists: 0.7,
          edge_type: "directed" as const,
        },
        {
          from: "out_1",
          to: "goal_1",
          strength_mean: 0.9,
          strength_std: 0.05,
          belief_exists: 1,
        },
      ],
    },
    quality: {
      overall: 0.85,
      structure: 0.9,
      coverage: 0.8,
      structural_proxy: 0.75,
    },
    trace: {
      request_id: "test-req-123",
      engine: { provider: "test" },
    },
    // Response-level fields that Stage 6 must carry through
    coaching: {
      status_quo_present: true,
      recommendations: ["consider alternatives"],
    },
    causal_claims: [
      { claim: "Cost affects revenue", from_id: "fac_cost", to_id: "out_1", confidence: 0.8 },
    ],
    goal_constraints: [
      { type: "minimum", target_node_id: "goal_1", value: 0.5 },
    ],
  } as V1DraftGraphResponse;
}

// =============================================================================
// Tests — transformNodeToV3 (node-level field preservation)
// =============================================================================

describe("boundary canary: transformNodeToV3 field preservation", () => {
  it("preserves category on factor nodes", () => {
    const node: V1Node = {
      id: "fac_1",
      kind: "factor",
      label: "Test Factor",
      category: "controllable",
      data: { value: 50 },
    };
    const v3 = transformNodeToV3(node);
    expect(v3.category).toBe("controllable");
  });

  it("preserves all four goal_threshold fields on goal nodes", () => {
    const node: V1Node = {
      id: "goal_1",
      kind: "goal",
      label: "Target 800 customers",
      goal_threshold: 0.8,
      goal_threshold_raw: 800,
      goal_threshold_unit: "customers",
      goal_threshold_cap: 1000,
    };
    const v3 = transformNodeToV3(node);
    expect(v3.goal_threshold).toBe(0.8);
    expect(v3.goal_threshold_raw).toBe(800);
    expect(v3.goal_threshold_unit).toBe("customers");
    expect(v3.goal_threshold_cap).toBe(1000);
  });

  it("omits goal_threshold fields when null (null exclusion guard)", () => {
    const node: V1Node = {
      id: "goal_1",
      kind: "goal",
      label: "No threshold",
      goal_threshold: null as any,
      goal_threshold_raw: null as any,
    };
    const v3 = transformNodeToV3(node);
    expect(v3).not.toHaveProperty("goal_threshold");
    expect(v3).not.toHaveProperty("goal_threshold_raw");
  });

  it("preserves observed_state with factor_type and uncertainty_drivers", () => {
    const node: V1Node = {
      id: "fac_1",
      kind: "factor",
      label: "Cost",
      category: "controllable",
      data: {
        value: 100,
        factor_type: "cost",
        uncertainty_drivers: ["market volatility"],
      },
    };
    const v3 = transformNodeToV3(node);
    expect(v3.observed_state).toBeDefined();
    expect(v3.observed_state!.factor_type).toBe("cost");
    expect(v3.observed_state!.uncertainty_drivers).toEqual(["market volatility"]);
  });

  it("preserves category across all three values", () => {
    for (const cat of ["controllable", "observable", "external"] as const) {
      const node: V1Node = { id: `fac_${cat}`, kind: "factor", label: cat, category: cat };
      const v3 = transformNodeToV3(node);
      expect(v3.category).toBe(cat);
    }
  });
});

// =============================================================================
// Tests — transformEdgeToV3 (edge-level field preservation)
// =============================================================================

describe("boundary canary: transformEdgeToV3 field preservation", () => {
  it("preserves edge_type: bidirected through transform", () => {
    const edge: V1Edge = {
      from: "a",
      to: "b",
      strength_mean: 0.5,
      strength_std: 0.1,
      belief_exists: 0.8,
      edge_type: "bidirected",
    };
    const v3 = transformEdgeToV3(edge, 0, []);
    expect(v3.edge_type).toBe("bidirected");
  });

  it("preserves edge_type: directed through transform", () => {
    const edge: V1Edge = {
      from: "a",
      to: "b",
      strength_mean: 0.5,
      strength_std: 0.1,
      belief_exists: 0.8,
      edge_type: "directed",
    };
    const v3 = transformEdgeToV3(edge, 0, []);
    expect(v3.edge_type).toBe("directed");
  });

  it("omits edge_type when absent (no fabrication)", () => {
    const edge: V1Edge = {
      from: "a",
      to: "b",
      strength_mean: 0.5,
      strength_std: 0.1,
      belief_exists: 0.8,
    };
    const v3 = transformEdgeToV3(edge, 0, []);
    expect(v3).not.toHaveProperty("edge_type");
  });

  it("preserves origin field through transform", () => {
    const edge: V1Edge = {
      from: "a",
      to: "b",
      strength_mean: 0.5,
      strength_std: 0.1,
      belief_exists: 0.8,
      origin: "user",
    };
    const v3 = transformEdgeToV3(edge, 0, []);
    expect(v3.origin).toBe("user");
  });
});

// =============================================================================
// Tests — transformResponseToV3 (response-level field preservation)
// =============================================================================

describe("boundary canary: transformResponseToV3 response-level fields", () => {
  it("carries coaching from V1 response to V3 output", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-1" });
    expect((v3 as any).coaching).toEqual({
      status_quo_present: true,
      recommendations: ["consider alternatives"],
    });
  });

  it("carries causal_claims from V1 response to V3 output", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-2" });
    expect((v3 as any).causal_claims).toEqual([
      { claim: "Cost affects revenue", from_id: "fac_cost", to_id: "out_1", confidence: 0.8 },
    ]);
  });

  it("carries goal_constraints from V1 response to V3 output", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-3" });
    expect((v3 as any).goal_constraints).toEqual([
      { type: "minimum", target_node_id: "goal_1", value: 0.5 },
    ]);
  });

  it("omits coaching when absent in V1 (no fabrication)", () => {
    const v1 = makeV1Response();
    delete (v1 as any).coaching;
    const v3 = transformResponseToV3(v1, { requestId: "test-4" });
    expect(v3).not.toHaveProperty("coaching");
  });

  it("omits causal_claims when absent in V1 (no fabrication)", () => {
    const v1 = makeV1Response();
    delete (v1 as any).causal_claims;
    const v3 = transformResponseToV3(v1, { requestId: "test-5" });
    expect(v3).not.toHaveProperty("causal_claims");
  });

  it("omits goal_constraints when empty array in V1", () => {
    const v1 = makeV1Response();
    (v1 as any).goal_constraints = [];
    const v3 = transformResponseToV3(v1, { requestId: "test-6" });
    expect(v3).not.toHaveProperty("goal_constraints");
  });

  it("preserves quality scores through V3 transform", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-7" });
    expect(v3.quality).toEqual({
      overall: 0.85,
      structure: 0.9,
      coverage: 0.8,
      structural_proxy: 0.75,
    });
  });
});

// =============================================================================
// Tests — full V3 transform preserves node fields end-to-end
// =============================================================================

describe("boundary canary: end-to-end node field survival through transformResponseToV3", () => {
  it("factor node category survives full V3 transform", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "e2e-1" });
    const facCost = v3.nodes.find((n) => n.id === "fac_cost");
    expect(facCost).toBeDefined();
    expect(facCost!.category).toBe("controllable");
  });

  it("external factor category survives full V3 transform", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "e2e-2" });
    const facExt = v3.nodes.find((n) => n.id === "fac_ext");
    expect(facExt).toBeDefined();
    expect(facExt!.category).toBe("external");
  });

  it("goal_threshold fields survive full V3 transform", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "e2e-3" });
    const goal = v3.nodes.find((n) => n.id === "goal_1");
    expect(goal).toBeDefined();
    expect(goal!.goal_threshold).toBe(0.8);
    expect(goal!.goal_threshold_raw).toBe(800);
    expect(goal!.goal_threshold_unit).toBe("customers");
    expect(goal!.goal_threshold_cap).toBe(1000);
  });

  it("edge_type: bidirected survives full V3 transform", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "e2e-4" });
    const edge = v3.edges.find((e) => e.from === "fac_cost" && e.to === "out_1");
    expect(edge).toBeDefined();
    expect((edge as any).edge_type).toBe("bidirected");
  });

  it("observed_state.factor_type survives full V3 transform", () => {
    const v1 = makeV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "e2e-5" });
    const facCost = v3.nodes.find((n) => n.id === "fac_cost");
    expect(facCost).toBeDefined();
    expect(facCost!.observed_state).toBeDefined();
    expect((facCost!.observed_state as any).factor_type).toBe("cost");
  });
});
