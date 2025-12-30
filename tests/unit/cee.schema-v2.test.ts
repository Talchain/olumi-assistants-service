/**
 * Unit and integration tests for CEE v2 schema transformer
 *
 * Tests the full transformation pipeline from v1 to v2.2 schema.
 */
import { describe, it, expect } from "vitest";
import {
  transformNodeToV2,
  transformEdgeToV2,
  transformGraphToV2,
  transformResponseToV2,
  parseSchemaVersion,
  isValidSchemaVersion,
  type V1Node,
  type V1Edge,
  type V1Graph,
  type V1DraftGraphResponse,
} from "../../src/cee/transforms/schema-v2.js";

describe("parseSchemaVersion", () => {
  // V3 is now the default - includes analysis_ready for PLoT consumption
  describe("defaults to v3", () => {
    it("returns v3 for undefined", () => {
      expect(parseSchemaVersion(undefined)).toBe("v3");
    });

    it("returns v3 for null", () => {
      expect(parseSchemaVersion(null)).toBe("v3");
    });

    it("returns v3 for empty string", () => {
      expect(parseSchemaVersion("")).toBe("v3");
    });

    it("returns v3 for invalid versions", () => {
      expect(parseSchemaVersion("v4")).toBe("v3");
      expect(parseSchemaVersion("invalid")).toBe("v3");
    });
  });

  describe("explicit v3 requests", () => {
    it("returns v3 for 'v3'", () => {
      expect(parseSchemaVersion("v3")).toBe("v3");
    });

    it("returns v3 for '3'", () => {
      expect(parseSchemaVersion("3")).toBe("v3");
    });

    it("returns v3 for '3.0'", () => {
      expect(parseSchemaVersion("3.0")).toBe("v3");
    });
  });

  describe("explicit v2 requests (deprecated)", () => {
    it("returns v2 for 'v2'", () => {
      expect(parseSchemaVersion("v2")).toBe("v2");
    });

    it("returns v2 for '2'", () => {
      expect(parseSchemaVersion("2")).toBe("v2");
    });

    it("returns v2 for '2.2'", () => {
      expect(parseSchemaVersion("2.2")).toBe("v2");
    });
  });

  describe("explicit v1 requests (deprecated)", () => {
    it("returns v1 for 'v1'", () => {
      expect(parseSchemaVersion("v1")).toBe("v1");
    });

    it("returns v1 for '1'", () => {
      expect(parseSchemaVersion("1")).toBe("v1");
    });

    it("returns v1 for '1.0'", () => {
      expect(parseSchemaVersion("1.0")).toBe("v1");
    });
  });
});

describe("isValidSchemaVersion", () => {
  it("returns true for v1", () => {
    expect(isValidSchemaVersion("v1")).toBe(true);
  });

  it("returns true for v2", () => {
    expect(isValidSchemaVersion("v2")).toBe(true);
  });

  it("returns true for v3", () => {
    expect(isValidSchemaVersion("v3")).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isValidSchemaVersion("v4")).toBe(false);
    expect(isValidSchemaVersion(undefined)).toBe(false);
    expect(isValidSchemaVersion(null)).toBe(false);
    expect(isValidSchemaVersion("")).toBe(false);
  });
});

describe("transformNodeToV2", () => {
  it("transforms basic node without data", () => {
    const v1Node: V1Node = {
      id: "goal_1",
      kind: "goal",
      label: "Increase Revenue",
      body: "Target 20% growth",
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node).toEqual({
      id: "goal_1",
      type: "goal",
      label: "Increase Revenue",
      description: "Target 20% growth",
    });
    expect(v2Node.observed_state).toBeUndefined();
  });

  it("transforms factor node with data to observed_state", () => {
    const v1Node: V1Node = {
      id: "factor_price",
      kind: "factor",
      label: "Pro Plan Price",
      data: {
        value: 59,
        baseline: 49,
        unit: "£",
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.id).toBe("factor_price");
    expect(v2Node.type).toBe("factor");
    expect(v2Node.observed_state).toBeDefined();
    expect(v2Node.observed_state?.value).toBe(59);
    expect(v2Node.observed_state?.baseline).toBe(49);
    expect(v2Node.observed_state?.unit).toBe("£");
    expect(v2Node.observed_state?.source).toBe("brief_extraction");
  });

  it("includes range in observed_state if present", () => {
    const v1Node: V1Node = {
      id: "factor_discount",
      kind: "factor",
      label: "Discount Rate",
      data: {
        value: 10,
        unit: "%",
        range: { min: 5, max: 20 },
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.observed_state?.range).toEqual({ min: 5, max: 20 });
  });

  it("skips observed_state for empty data object", () => {
    const v1Node: V1Node = {
      id: "factor_x",
      kind: "factor",
      label: "Factor X",
      data: {},
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.observed_state).toBeUndefined();
  });

  it("skips observed_state when only baseline present (no value)", () => {
    const v1Node: V1Node = {
      id: "factor_y",
      kind: "factor",
      label: "Factor Y",
      data: {
        baseline: 100,
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    // Per contract: observed_state.value is required, so don't create if only baseline
    expect(v2Node.observed_state).toBeUndefined();
  });

  it("uses id as label fallback when label is missing", () => {
    const v1Node: V1Node = {
      id: "factor_z",
      kind: "factor",
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.label).toBe("factor_z");
  });

  it("maps decision kind to option type", () => {
    const v1Node: V1Node = {
      id: "decision_1",
      kind: "decision",
      label: "Choose Vendor",
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.type).toBe("option");
  });

  it("maps action kind to option type", () => {
    const v1Node: V1Node = {
      id: "action_1",
      kind: "action",
      label: "Deploy Feature",
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.type).toBe("option");
  });

  it("defaults unknown kind to factor type", () => {
    const v1Node: V1Node = {
      id: "unknown_1",
      kind: "some_unknown_kind",
      label: "Unknown Node",
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.type).toBe("factor");
  });
});

describe("transformEdgeToV2", () => {
  const testNodes = [
    { id: "price", kind: "factor", label: "Price" },
    { id: "demand", kind: "outcome", label: "Demand" },
    { id: "marketing", kind: "factor", label: "Marketing" },
    { id: "sales", kind: "outcome", label: "Sales" },
  ];

  it("transforms edge with all properties", () => {
    const v1Edge: V1Edge = {
      id: "edge_1",
      from: "marketing",
      to: "sales",
      weight: 0.8,
      belief: 0.9,
      provenance: "market research",
      provenance_source: "document",
    };

    const v2Edge = transformEdgeToV2(v1Edge, 0, testNodes);

    expect(v2Edge.id).toBe("edge_1");
    expect(v2Edge.from).toBe("marketing");
    expect(v2Edge.to).toBe("sales");
    expect(v2Edge.weight).toBe(0.8);
    expect(v2Edge.belief).toBe(0.9);
    expect(v2Edge.effect_direction).toBe("positive");
    expect(v2Edge.strength_std).toBeGreaterThan(0);
    expect(v2Edge.provenance).toBe("market research");
    // provenance_source should NOT be in v2
    expect(v2Edge).not.toHaveProperty("provenance_source");
  });

  it("generates edge id from index if not provided", () => {
    const v1Edge: V1Edge = {
      from: "marketing",
      to: "sales",
    };

    const v2Edge = transformEdgeToV2(v1Edge, 5, testNodes);

    expect(v2Edge.id).toBe("edge_5");
  });

  it("defaults weight and belief to 0.5", () => {
    const v1Edge: V1Edge = {
      from: "marketing",
      to: "sales",
    };

    const v2Edge = transformEdgeToV2(v1Edge, 0, testNodes);

    expect(v2Edge.weight).toBe(0.5);
    expect(v2Edge.belief).toBe(0.5);
  });

  it("infers negative effect_direction for price → demand", () => {
    const v1Edge: V1Edge = {
      from: "price",
      to: "demand",
    };

    const v2Edge = transformEdgeToV2(v1Edge, 0, testNodes);

    expect(v2Edge.effect_direction).toBe("negative");
  });

  it("uses LLM-provided effect_direction if present", () => {
    const v1Edge: V1Edge = {
      from: "price",
      to: "demand",
      effect_direction: "positive", // Override inferred
    };

    const v2Edge = transformEdgeToV2(v1Edge, 0, testNodes);

    expect(v2Edge.effect_direction).toBe("positive");
  });

  it("derives strength_std from belief and provenance", () => {
    const evidenceEdge: V1Edge = {
      from: "marketing",
      to: "sales",
      weight: 1.0,
      belief: 0.9,
      provenance: "evidence",
    };

    const hypothesisEdge: V1Edge = {
      from: "marketing",
      to: "sales",
      weight: 1.0,
      belief: 0.5,
      provenance: "hypothesis",
    };

    const evidenceResult = transformEdgeToV2(evidenceEdge, 0, testNodes);
    const hypothesisResult = transformEdgeToV2(hypothesisEdge, 1, testNodes);

    // Hypothesis should have higher std (more uncertainty)
    expect(hypothesisResult.strength_std).toBeGreaterThan(evidenceResult.strength_std);
  });

  it("extracts string from ProvenanceObject", () => {
    const v1Edge: V1Edge = {
      from: "marketing",
      to: "sales",
      provenance: {
        source: "annual report",
        quote: "Revenue grew 23%",
        location: "page 12",
      },
    };

    const v2Edge = transformEdgeToV2(v1Edge, 0, testNodes);

    // Should extract quote (preferred) as string
    expect(v2Edge.provenance).toBe("Revenue grew 23%");
    expect(typeof v2Edge.provenance).toBe("string");
  });

  it("extracts source when quote is missing from ProvenanceObject", () => {
    const v1Edge: V1Edge = {
      from: "marketing",
      to: "sales",
      provenance: {
        source: "expert_hypothesis",
      },
    };

    const v2Edge = transformEdgeToV2(v1Edge, 0, testNodes);

    expect(v2Edge.provenance).toBe("expert_hypothesis");
  });
});

describe("transformGraphToV2", () => {
  it("transforms complete graph", () => {
    const v1Graph: V1Graph = {
      version: "1.0",
      default_seed: 42,
      nodes: [
        { id: "goal_1", kind: "goal", label: "Increase Revenue" },
        { id: "factor_price", kind: "factor", label: "Price", data: { value: 50, unit: "$" } },
        { id: "outcome_demand", kind: "outcome", label: "Demand" },
      ],
      edges: [
        { from: "factor_price", to: "outcome_demand", weight: 0.8, belief: 0.7 },
        { from: "outcome_demand", to: "goal_1", weight: 1.0, belief: 0.9 },
      ],
      meta: {
        roots: ["factor_price"],
        leaves: ["goal_1"],
      },
    };

    const v2Graph = transformGraphToV2(v1Graph);

    // Check version preserved
    expect(v2Graph.version).toBe("1.0");
    expect(v2Graph.default_seed).toBe(42);

    // Check nodes transformed
    expect(v2Graph.nodes).toHaveLength(3);
    const priceNode = v2Graph.nodes.find((n) => n.id === "factor_price");
    expect(priceNode?.observed_state?.value).toBe(50);
    expect(priceNode?.observed_state?.unit).toBe("$");

    // Check edges transformed
    expect(v2Graph.edges).toHaveLength(2);
    v2Graph.edges.forEach((edge) => {
      expect(edge.effect_direction).toMatch(/^(positive|negative)$/);
      expect(edge.strength_std).toBeGreaterThan(0);
    });

    // Check first edge is negative (price → demand)
    expect(v2Graph.edges[0].effect_direction).toBe("negative");

    // Check meta preserved
    expect(v2Graph.meta?.roots).toEqual(["factor_price"]);
    expect(v2Graph.meta?.leaves).toEqual(["goal_1"]);
  });

  it("handles empty graph", () => {
    const v1Graph: V1Graph = {
      nodes: [],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    expect(v2Graph.nodes).toEqual([]);
    expect(v2Graph.edges).toEqual([]);
    expect(v2Graph.version).toBe("1");
  });

  it("defaults version to '1' if not provided", () => {
    const v1Graph: V1Graph = {
      nodes: [{ id: "n1", kind: "factor" }],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    expect(v2Graph.version).toBe("1");
  });
});

describe("transformResponseToV2", () => {
  it("transforms complete response with schema_version", () => {
    const v1Response: V1DraftGraphResponse = {
      graph: {
        version: "1.0",
        nodes: [
          { id: "goal_1", kind: "goal", label: "Success" },
          { id: "risk_1", kind: "risk", label: "Risk Factor" },
        ],
        edges: [
          { from: "risk_1", to: "goal_1", weight: 0.6, belief: 0.8 },
        ],
      },
      quality: {
        overall: 0.85,
        structure: 0.9,
        coverage: 0.8,
      },
      trace: {
        request_id: "req-123",
        correlation_id: "corr-456",
      },
      draft_warnings: [
        { type: "LOW_FACTOR_COUNT", message: "Consider adding more factors" },
      ],
    };

    const v2Response = transformResponseToV2(v1Response);

    // Check schema_version added
    expect(v2Response.schema_version).toBe("2.2");

    // Check graph transformed
    expect(v2Response.graph.nodes).toHaveLength(2);
    expect(v2Response.graph.edges).toHaveLength(1);
    expect(v2Response.graph.edges[0].effect_direction).toBe("negative"); // risk → goal
    expect(v2Response.graph.edges[0].strength_std).toBeGreaterThan(0);

    // Check other properties preserved
    expect(v2Response.quality?.overall).toBe(0.85);
    expect(v2Response.trace?.request_id).toBe("req-123");
    expect(v2Response.draft_warnings).toHaveLength(1);
  });

  it("preserves additional properties via spread", () => {
    const v1Response: V1DraftGraphResponse = {
      graph: {
        nodes: [{ id: "n1", kind: "goal" }],
        edges: [],
      },
      custom_field: "preserved",
      another_field: { nested: true },
    };

    const v2Response = transformResponseToV2(v1Response);

    expect((v2Response as any).custom_field).toBe("preserved");
    expect((v2Response as any).another_field).toEqual({ nested: true });
  });
});

describe("full integration - realistic scenarios", () => {
  it("transforms vendor selection decision model", () => {
    const v1Response: V1DraftGraphResponse = {
      graph: {
        version: "1.0",
        default_seed: 12345,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Select Best Vendor" },
          { id: "decision_1", kind: "decision", label: "Vendor Selection" },
          { id: "option_a", kind: "option", label: "Vendor A" },
          { id: "option_b", kind: "option", label: "Vendor B" },
          {
            id: "factor_price",
            kind: "factor",
            label: "Annual Cost",
            data: { value: 100000, baseline: 120000, unit: "$" },
          },
          {
            id: "factor_quality",
            kind: "factor",
            label: "Quality Score",
            data: { value: 85, unit: "%" },
          },
          { id: "outcome_satisfaction", kind: "outcome", label: "Customer Satisfaction" },
          { id: "risk_vendor", kind: "risk", label: "Vendor Lock-in Risk" },
        ],
        edges: [
          { from: "decision_1", to: "option_a", belief: 0.6 },
          { from: "decision_1", to: "option_b", belief: 0.4 },
          { from: "factor_price", to: "outcome_satisfaction", weight: 0.7, belief: 0.8 },
          { from: "factor_quality", to: "outcome_satisfaction", weight: 0.9, belief: 0.85 },
          { from: "outcome_satisfaction", to: "goal_1", weight: 1.0, belief: 0.9 },
          { from: "risk_vendor", to: "goal_1", weight: 0.5, belief: 0.7 },
        ],
        meta: {
          roots: ["decision_1", "factor_price", "factor_quality", "risk_vendor"],
          leaves: ["goal_1"],
        },
      },
      quality: { overall: 0.88 },
    };

    const v2Response = transformResponseToV2(v1Response);

    // Schema version added
    expect(v2Response.schema_version).toBe("2.2");

    // Factor nodes have observed_state
    const priceNode = v2Response.graph.nodes.find((n) => n.id === "factor_price");
    expect(priceNode?.observed_state).toEqual({
      value: 100000,
      baseline: 120000,
      unit: "$",
      source: "brief_extraction",
    });

    const qualityNode = v2Response.graph.nodes.find((n) => n.id === "factor_quality");
    expect(qualityNode?.observed_state?.value).toBe(85);
    expect(qualityNode?.observed_state?.unit).toBe("%");

    // All edges have effect_direction and strength_std
    v2Response.graph.edges.forEach((edge) => {
      expect(edge.effect_direction).toMatch(/^(positive|negative)$/);
      expect(typeof edge.strength_std).toBe("number");
      expect(edge.strength_std).toBeGreaterThanOrEqual(0.05);
    });

    // Risk → Goal should be negative
    const riskEdge = v2Response.graph.edges.find((e) => e.from === "risk_vendor");
    expect(riskEdge?.effect_direction).toBe("negative");

    // Quality → Satisfaction should be positive
    const qualityEdge = v2Response.graph.edges.find((e) => e.from === "factor_quality");
    expect(qualityEdge?.effect_direction).toBe("positive");

    // Meta preserved
    expect(v2Response.graph.meta?.roots).toContain("factor_price");

    // decision_1 should be mapped to type: "option"
    const decisionNode = v2Response.graph.nodes.find((n) => n.id === "decision_1");
    expect(decisionNode?.type).toBe("option");
  });

  it("handles pricing decision with currency", () => {
    const v1Response: V1DraftGraphResponse = {
      graph: {
        nodes: [
          { id: "goal_revenue", kind: "goal", label: "Maximize Revenue" },
          {
            id: "factor_price",
            kind: "factor",
            label: "Pro Plan Price",
            data: { value: 1000000, baseline: 800000, unit: "$" },
          },
          { id: "outcome_demand", kind: "outcome", label: "Customer Demand" },
          { id: "outcome_revenue", kind: "outcome", label: "Revenue" },
        ],
        edges: [
          { from: "factor_price", to: "outcome_demand", weight: 0.8, belief: 0.85 },
          { from: "outcome_demand", to: "outcome_revenue", weight: 1.0, belief: 0.9 },
          { from: "outcome_revenue", to: "goal_revenue", weight: 1.0, belief: 0.95 },
        ],
      },
    };

    const v2Response = transformResponseToV2(v1Response);

    // Price → Demand is negative relationship
    const priceToDemand = v2Response.graph.edges.find(
      (e) => e.from === "factor_price" && e.to === "outcome_demand"
    );
    expect(priceToDemand?.effect_direction).toBe("negative");

    // Demand → Revenue is positive
    const demandToRevenue = v2Response.graph.edges.find(
      (e) => e.from === "outcome_demand" && e.to === "outcome_revenue"
    );
    expect(demandToRevenue?.effect_direction).toBe("positive");

    // Factor has observed_state with correct values
    const priceNode = v2Response.graph.nodes.find((n) => n.id === "factor_price");
    expect(priceNode?.observed_state?.value).toBe(1000000);
    expect(priceNode?.observed_state?.baseline).toBe(800000);
  });
});

// ============================================================================
// Contract Compliance Tests
// ============================================================================

describe("v2 output contract compliance", () => {
  const v1Response: V1DraftGraphResponse = {
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Success" },
        { id: "factor_1", kind: "factor", label: "Factor", data: { value: 10 } },
        { id: "outcome_1", kind: "outcome", label: "Outcome" },
        { id: "decision_1", kind: "decision", label: "Decision" },
        { id: "action_1", kind: "action", label: "Action" },
        { id: "risk_1", kind: "risk", label: "Risk" },
        { id: "constraint_1", kind: "constraint", label: "Constraint" },
      ],
      edges: [
        { from: "factor_1", to: "outcome_1", provenance: { source: "doc", quote: "evidence" } },
        { from: "risk_1", to: "goal_1", provenance_source: "hypothesis" },
      ],
    },
  };

  it('should output "type" not "kind" for nodes', () => {
    const result = transformResponseToV2(v1Response);
    for (const node of result.graph.nodes) {
      expect(node).toHaveProperty("type");
      expect(node).not.toHaveProperty("kind");
      expect(["factor", "option", "outcome", "goal", "risk", "constraint"]).toContain(node.type);
    }
  });

  it("should require label on all nodes", () => {
    const result = transformResponseToV2(v1Response);
    for (const node of result.graph.nodes) {
      expect(typeof node.label).toBe("string");
      expect(node.label.length).toBeGreaterThan(0);
    }
  });

  it("should use id as label fallback for nodes without label", () => {
    const noLabelResponse: V1DraftGraphResponse = {
      graph: {
        nodes: [{ id: "node_without_label", kind: "factor" }],
        edges: [],
      },
    };

    const result = transformResponseToV2(noLabelResponse);
    expect(result.graph.nodes[0].label).toBe("node_without_label");
  });

  it("should not create observed_state with undefined value", () => {
    const v1WithBaselineOnly: V1DraftGraphResponse = {
      graph: {
        nodes: [
          {
            id: "test",
            kind: "factor",
            label: "Test",
            data: { baseline: 50 }, // No value
          },
        ],
        edges: [],
      },
    };

    const result = transformResponseToV2(v1WithBaselineOnly);
    expect(result.graph.nodes[0].observed_state).toBeUndefined();
  });

  it("should output provenance as string only", () => {
    const result = transformResponseToV2(v1Response);
    for (const edge of result.graph.edges) {
      if (edge.provenance !== undefined) {
        expect(typeof edge.provenance).toBe("string");
      }
    }
  });

  it("should not include provenance_source in v2 edges", () => {
    const result = transformResponseToV2(v1Response);
    for (const edge of result.graph.edges) {
      expect(edge).not.toHaveProperty("provenance_source");
    }
  });

  it('should output "description" not "body" for nodes', () => {
    const withBody: V1DraftGraphResponse = {
      graph: {
        nodes: [{ id: "n1", kind: "goal", label: "Goal", body: "Description text" }],
        edges: [],
      },
    };

    const result = transformResponseToV2(withBody);
    expect(result.graph.nodes[0]).toHaveProperty("description");
    expect(result.graph.nodes[0]).not.toHaveProperty("body");
    expect(result.graph.nodes[0].description).toBe("Description text");
  });

  it("should map decision and action kinds to option type", () => {
    const result = transformResponseToV2(v1Response);

    const decisionNode = result.graph.nodes.find((n) => n.id === "decision_1");
    const actionNode = result.graph.nodes.find((n) => n.id === "action_1");

    expect(decisionNode?.type).toBe("option");
    expect(actionNode?.type).toBe("option");
  });

  it("should have schema_version 2.2", () => {
    const result = transformResponseToV2(v1Response);
    expect(result.schema_version).toBe("2.2");
  });

  it("should map constraint kind to factor type", () => {
    const constraintResponse: V1DraftGraphResponse = {
      graph: {
        nodes: [{ id: "constraint_1", kind: "constraint", label: "Budget Constraint" }],
        edges: [],
      },
    };

    const result = transformResponseToV2(constraintResponse);
    expect(result.graph.nodes[0].type).toBe("factor");
  });
});

// ============================================================================
// Parameter Uncertainty Tests
// ============================================================================

describe("value_std derivation", () => {
  it("derives value_std when extraction metadata is present", () => {
    const v1Node: V1Node = {
      id: "factor_price",
      kind: "factor",
      label: "Price",
      data: {
        value: 59,
        unit: "£",
        extractionType: "explicit",
        confidence: 0.9,
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.observed_state).toBeDefined();
    expect(v2Node.observed_state?.value_std).toBeDefined();
    expect(v2Node.observed_state?.value_std).toBeGreaterThan(0);
  });

  it("does not derive value_std without extraction metadata", () => {
    const v1Node: V1Node = {
      id: "factor_price",
      kind: "factor",
      label: "Price",
      data: {
        value: 59,
        unit: "£",
        // No extractionType or confidence
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.observed_state).toBeDefined();
    expect(v2Node.observed_state?.value_std).toBeUndefined();
  });

  it("derives higher value_std for inferred extractions", () => {
    const explicitNode: V1Node = {
      id: "factor_explicit",
      kind: "factor",
      label: "Explicit Price",
      data: {
        value: 100,
        extractionType: "explicit",
        confidence: 0.9,
      },
    };

    const inferredNode: V1Node = {
      id: "factor_inferred",
      kind: "factor",
      label: "Inferred Price",
      data: {
        value: 100,
        extractionType: "inferred",
        confidence: 0.9,
      },
    };

    const v2Explicit = transformNodeToV2(explicitNode);
    const v2Inferred = transformNodeToV2(inferredNode);

    // Verify both have value_std
    expect(v2Explicit.observed_state?.value_std).toBeDefined();
    expect(v2Inferred.observed_state?.value_std).toBeDefined();

    // Inferred should have higher uncertainty
    const explicitStd = v2Explicit.observed_state?.value_std ?? 0;
    const inferredStd = v2Inferred.observed_state?.value_std ?? 0;
    expect(inferredStd).toBeGreaterThan(explicitStd);
  });

  it("derives value_std from range bounds for range extractions", () => {
    const v1Node: V1Node = {
      id: "factor_range",
      kind: "factor",
      label: "Price Range",
      data: {
        value: 60,
        extractionType: "range",
        confidence: 0.8,
        rangeMin: 50,
        rangeMax: 70,
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.observed_state?.value_std).toBeDefined();
    // For range [50, 70]: std = (70 - 50) / 4 = 5
    expect(v2Node.observed_state?.value_std).toBeCloseTo(5, 1);
  });

  it("synthesizes range object from rangeMin/rangeMax", () => {
    const v1Node: V1Node = {
      id: "factor_range",
      kind: "factor",
      label: "Price Range",
      data: {
        value: 60,
        extractionType: "range",
        confidence: 0.8,
        rangeMin: 50,
        rangeMax: 70,
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.observed_state?.range).toEqual({ min: 50, max: 70 });
  });
});

describe("parameter_uncertainties array", () => {
  it("populates parameter_uncertainties from nodes with value_std", () => {
    const v1Graph: V1Graph = {
      nodes: [
        {
          id: "factor_price",
          kind: "factor",
          label: "Price",
          data: {
            value: 59,
            extractionType: "explicit",
            confidence: 0.9,
          },
        },
        {
          id: "factor_churn",
          kind: "factor",
          label: "Churn Rate",
          data: {
            value: 0.05,
            extractionType: "inferred",
            confidence: 0.7,
          },
        },
        { id: "goal_1", kind: "goal", label: "Success" },
      ],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    expect(v2Graph.parameter_uncertainties).toBeDefined();
    expect(v2Graph.parameter_uncertainties).toHaveLength(2);

    const priceUncertainty = v2Graph.parameter_uncertainties?.find(
      (u) => u.node_id === "factor_price"
    );
    expect(priceUncertainty).toBeDefined();
    expect(priceUncertainty?.std).toBeGreaterThan(0);
    expect(priceUncertainty?.distribution).toBe("normal");

    const churnUncertainty = v2Graph.parameter_uncertainties?.find(
      (u) => u.node_id === "factor_churn"
    );
    expect(churnUncertainty).toBeDefined();
    expect(churnUncertainty?.std).toBeGreaterThan(0);
    expect(churnUncertainty?.distribution).toBe("normal");
  });

  it("does not include parameter_uncertainties when no nodes have value_std", () => {
    const v1Graph: V1Graph = {
      nodes: [
        {
          id: "factor_price",
          kind: "factor",
          label: "Price",
          data: {
            value: 59,
            // No extraction metadata
          },
        },
        { id: "goal_1", kind: "goal", label: "Success" },
      ],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    expect(v2Graph.parameter_uncertainties).toBeUndefined();
  });

  it("parameter_uncertainties values match observed_state.value_std", () => {
    const v1Graph: V1Graph = {
      nodes: [
        {
          id: "factor_test",
          kind: "factor",
          label: "Test Factor",
          data: {
            value: 100,
            extractionType: "explicit",
            confidence: 0.85,
          },
        },
      ],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    const nodeStd = v2Graph.nodes[0].observed_state?.value_std;
    const paramStd = v2Graph.parameter_uncertainties?.[0]?.std;

    expect(nodeStd).toBeDefined();
    expect(paramStd).toBeDefined();
    expect(nodeStd).toBe(paramStd);
  });

  it("handles mixed nodes with and without extraction metadata", () => {
    const v1Graph: V1Graph = {
      nodes: [
        {
          id: "factor_with_meta",
          kind: "factor",
          label: "With Metadata",
          data: {
            value: 50,
            extractionType: "explicit",
            confidence: 0.9,
          },
        },
        {
          id: "factor_without_meta",
          kind: "factor",
          label: "Without Metadata",
          data: {
            value: 100,
            // No extractionType or confidence
          },
        },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    // Only one node should have parameter uncertainty
    expect(v2Graph.parameter_uncertainties).toHaveLength(1);
    expect(v2Graph.parameter_uncertainties?.[0].node_id).toBe("factor_with_meta");
  });
});
