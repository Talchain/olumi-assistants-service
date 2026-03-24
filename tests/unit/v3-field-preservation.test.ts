/**
 * V3 Field Preservation Contract Tests
 *
 * Guards against silent field loss during V1→V3 transformation.
 * Every load-bearing field produced by the Anthropic schema + normalisation
 * layer must survive through transformResponseToV3.
 *
 * If a future change drops a field, these tests fail the build.
 */

import { describe, it, expect, vi } from "vitest";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";

// Suppress noisy logs during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      debugCategoryTrace: false,
      debugLoggingEnabled: false,
    },
  },
  isProduction: () => false,
}));

// =============================================================================
// Fixture: comprehensive V1 graph with all field variants
// =============================================================================

function makeComprehensiveV1(): V1DraftGraphResponse {
  return {
    graph: {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "dec_1", kind: "decision", label: "Pricing Strategy" },
        {
          id: "opt_raise",
          kind: "option",
          label: "Raise Price",
          data: { interventions: { fac_price: 0.83, fac_marketing: 0.4 } },
        },
        {
          id: "opt_keep",
          kind: "option",
          label: "Keep Price",
          data: { interventions: { fac_price: 0.69 } },
        },
        // Controllable factor — full data
        {
          id: "fac_price",
          kind: "factor",
          label: "Price Level",
          category: "controllable",
          data: {
            value: 0.69,
            raw_value: 49,
            unit: "£",
            cap: 71,
            extractionType: "explicit",
            factor_type: "price",
            uncertainty_drivers: ["Competitor response", "Market elasticity"],
          },
        },
        // Controllable factor — second
        {
          id: "fac_marketing",
          kind: "factor",
          label: "Marketing Spend",
          category: "controllable",
          data: {
            value: 0.1,
            raw_value: 5000,
            unit: "£",
            cap: 50000,
            extractionType: "explicit",
            factor_type: "cost",
            uncertainty_drivers: ["ROI uncertainty"],
          },
        },
        // Observable factor — data with value + extractionType
        {
          id: "fac_quality",
          kind: "factor",
          label: "Product Quality",
          category: "observable",
          data: { value: 0.7, extractionType: "observed" },
        },
        // External factor — prior distribution
        {
          id: "fac_churn",
          kind: "factor",
          label: "Churn Rate",
          category: "external",
          prior: {
            distribution: "uniform",
            range_min: 0.02,
            range_max: 0.15,
          },
        } as any,
        { id: "out_revenue", kind: "outcome", label: "Revenue Growth" },
        {
          id: "goal_mrr",
          kind: "goal",
          label: "Maximize MRR",
          goal_threshold: 0.8,
          goal_threshold_raw: 800,
          goal_threshold_unit: "customers",
          goal_threshold_cap: 1000,
        },
      ],
      edges: [
        { from: "dec_1", to: "opt_raise", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "dec_1", to: "opt_keep", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_raise", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_raise", to: "fac_marketing", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_keep", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        // Causal edge with provenance_source (no structured provenance)
        {
          from: "fac_price",
          to: "out_revenue",
          strength_mean: 0.7,
          strength_std: 0.15,
          belief_exists: 0.9,
          effect_direction: "positive" as const,
          provenance_source: "brief_extraction",
        },
        {
          from: "fac_marketing",
          to: "out_revenue",
          strength_mean: 0.3,
          strength_std: 0.2,
          belief_exists: 0.7,
          effect_direction: "positive" as const,
          provenance_source: "hypothesis",
        },
        { from: "fac_quality", to: "out_revenue", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.8, effect_direction: "positive" as const },
        { from: "fac_churn", to: "out_revenue", strength_mean: -0.4, strength_std: 0.25, belief_exists: 0.6, effect_direction: "negative" as const },
        { from: "out_revenue", to: "goal_mrr", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" as const },
      ],
      meta: { roots: [], leaves: [], source: "assistant" },
    },
    // Goal constraints with rich fields
    goal_constraints: [
      {
        constraint_id: "gc_marketing_cap",
        node_id: "fac_marketing",
        operator: "<=",
        value: 0.999,
        label: "Marketing spend cap £50k",
        unit: "£",
        source_quote: "hard constraint of £50k marketing spend cap",
        confidence: 1.0,
        provenance: "explicit",
      },
    ],
    // Coaching with action_type and bias_category
    coaching: {
      summary: "Consider competitor pricing and churn impact.",
      strengthen_items: [
        {
          id: "si_1",
          label: "Add churn data",
          detail: "Include historical churn rates",
          action_type: "add_constraint",
          bias_category: "blindspots",
        },
      ],
    },
    quality: { overall: 7, structure: 8, coverage: 7 },
    trace: {
      request_id: "test-contract-001",
      goal_handling: {
        goal_source: "llm_generated" as const,
        retry_attempted: false,
      },
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("V3 field preservation contract", () => {
  it("passes CEEGraphResponseV3 schema validation", () => {
    const v1 = makeComprehensiveV1();
    const v3 = transformResponseToV3(v1, { requestId: "test-contract-001" });

    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `V3 schema validation failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);
  });

  describe("controllable factor data → observed_state", () => {
    it("preserves value, raw_value, unit, cap, extractionType", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t1" });
      const priceNode = (v3 as any).nodes.find((n: any) => n.id === "fac_price");
      expect(priceNode).toBeDefined();
      expect(priceNode.observed_state).toBeDefined();
      expect(priceNode.observed_state.value).toBe(0.69);
      expect(priceNode.observed_state.raw_value).toBe(49);
      expect(priceNode.observed_state.unit).toBe("£");
      expect(priceNode.observed_state.cap).toBe(71);
      expect(priceNode.observed_state.extractionType).toBe("explicit");
    });

    it("preserves factor_type and uncertainty_drivers", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t2" });
      const priceNode = (v3 as any).nodes.find((n: any) => n.id === "fac_price");
      expect(priceNode.observed_state.factor_type).toBe("price");
      expect(priceNode.observed_state.uncertainty_drivers).toEqual(["Competitor response", "Market elasticity"]);
    });

    it("preserves category", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t3" });
      const priceNode = (v3 as any).nodes.find((n: any) => n.id === "fac_price");
      expect(priceNode.category).toBe("controllable");
    });
  });

  describe("observable factor data → observed_state", () => {
    it("maps value and extractionType", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t4" });
      const qualityNode = (v3 as any).nodes.find((n: any) => n.id === "fac_quality");
      expect(qualityNode).toBeDefined();
      expect(qualityNode.observed_state).toBeDefined();
      expect(qualityNode.observed_state.value).toBe(0.7);
      expect(qualityNode.category).toBe("observable");
    });
  });

  describe("external factor prior", () => {
    it("preserves prior distribution data in V3 output", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t5" });
      const churnNode = (v3 as any).nodes.find((n: any) => n.id === "fac_churn");
      expect(churnNode).toBeDefined();
      expect(churnNode.category).toBe("external");
      expect(churnNode.prior).toBeDefined();
      expect(churnNode.prior.distribution).toBe("uniform");
      expect(churnNode.prior.range_min).toBe(0.02);
      expect(churnNode.prior.range_max).toBe(0.15);
    });

    it("does not create observed_state for external factors without data.value", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t6" });
      const churnNode = (v3 as any).nodes.find((n: any) => n.id === "fac_churn");
      expect(churnNode.observed_state).toBeUndefined();
    });
  });

  describe("goal threshold fields", () => {
    it("preserves all four threshold fields on goal nodes", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t7" });
      const goalNode = (v3 as any).nodes.find((n: any) => n.id === "goal_mrr");
      expect(goalNode).toBeDefined();
      expect(goalNode.goal_threshold).toBe(0.8);
      expect(goalNode.goal_threshold_raw).toBe(800);
      expect(goalNode.goal_threshold_unit).toBe("customers");
      expect(goalNode.goal_threshold_cap).toBe(1000);
    });
  });

  describe("edge provenance_source → V3 provenance", () => {
    it("maps provenance_source to V3 provenance when structured provenance is absent", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t8" });
      const priceEdge = (v3 as any).edges.find(
        (e: any) => e.from === "fac_price" && e.to === "out_revenue",
      );
      expect(priceEdge).toBeDefined();
      expect(priceEdge.provenance).toBeDefined();
      expect(priceEdge.provenance.source).toBe("brief_extraction");
    });

    it("maps hypothesis provenance_source correctly", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t9" });
      const marketingEdge = (v3 as any).edges.find(
        (e: any) => e.from === "fac_marketing" && e.to === "out_revenue",
      );
      expect(marketingEdge).toBeDefined();
      expect(marketingEdge.provenance).toBeDefined();
      expect(marketingEdge.provenance.source).toBe("cee_hypothesis");
    });
  });

  describe("goal_constraints passthrough", () => {
    it("preserves goal_constraints array in V3 response", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t10" });
      expect((v3 as any).goal_constraints).toBeDefined();
      expect(Array.isArray((v3 as any).goal_constraints)).toBe(true);
      expect((v3 as any).goal_constraints.length).toBe(1);
    });

    it("preserves rich constraint fields (constraint_id, source_quote, confidence, provenance)", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t11" });
      const gc = (v3 as any).goal_constraints[0];
      expect(gc.constraint_id).toBe("gc_marketing_cap");
      expect(gc.node_id).toBe("fac_marketing");
      expect(gc.operator).toBe("<=");
      expect(gc.value).toBe(0.999);
      expect(gc.label).toBe("Marketing spend cap £50k");
      expect(gc.unit).toBe("£");
      expect(gc.source_quote).toBe("hard constraint of £50k marketing spend cap");
      expect(gc.confidence).toBe(1.0);
      expect(gc.provenance).toBe("explicit");
    });
  });

  describe("coaching metadata", () => {
    it("preserves coaching summary and strengthen_items with action_type and bias_category", () => {
      const v3 = transformResponseToV3(makeComprehensiveV1(), { requestId: "t12" });
      expect((v3 as any).coaching).toBeDefined();
      expect((v3 as any).coaching.summary).toBe("Consider competitor pricing and churn impact.");
      const item = (v3 as any).coaching.strengthen_items[0];
      expect(item.id).toBe("si_1");
      expect(item.label).toBe("Add churn data");
      expect(item.detail).toBe("Include historical churn rates");
      expect(item.action_type).toBe("add_constraint");
      expect(item.bias_category).toBe("blindspots");
    });
  });

  describe("edge structural fields", () => {
    it("preserves edge_type when present", () => {
      const v1 = makeComprehensiveV1();
      // Add a bidirected edge
      v1.graph.edges.push({
        from: "fac_price",
        to: "fac_quality",
        strength_mean: 0.2,
        strength_std: 0.3,
        belief_exists: 0.5,
        effect_direction: "positive" as const,
        edge_type: "bidirected",
      });
      const v3 = transformResponseToV3(v1, { requestId: "t13" });
      const biEdge = (v3 as any).edges.find(
        (e: any) => e.from === "fac_price" && e.to === "fac_quality",
      );
      expect(biEdge).toBeDefined();
      expect(biEdge.edge_type).toBe("bidirected");
    });
  });
});
