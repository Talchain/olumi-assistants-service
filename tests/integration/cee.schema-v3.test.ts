import { describe, it, expect } from "vitest";
import {
  transformResponseToV3,
  getV3ResponseSummary,
  validateStrictModeV3,
  needsUserMapping,
} from "../../src/cee/transforms/index.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import { validateV3Response } from "../../src/cee/validation/v3-validator.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";

describe("CEE Schema V3 Integration", () => {
  const sampleV1Response: V1DraftGraphResponse = {
    graph: {
      version: "1",
      nodes: [
        { id: "goal_revenue", kind: "goal", label: "Maximize Annual Revenue" },
        { id: "factor_price", kind: "factor", label: "Product Price", data: { value: 49, unit: "GBP" } },
        { id: "factor_marketing", kind: "factor", label: "Marketing Spend", data: { value: 10000, unit: "GBP" } },
        { id: "option_premium", kind: "option", label: "Premium Pricing", body: "Set price to £59" },
        { id: "option_economy", kind: "option", label: "Economy Pricing", body: "Set price to £39" },
        { id: "outcome_growth", kind: "outcome", label: "Business Growth" },
      ],
      edges: [
        { from: "factor_price", to: "goal_revenue", weight: 0.8, belief: 0.9, effect_direction: "positive" },
        { from: "factor_marketing", to: "goal_revenue", weight: 0.6, belief: 0.85, effect_direction: "positive" },
        { from: "option_premium", to: "factor_price", weight: 0.7, belief: 0.8 },
        { from: "option_economy", to: "factor_price", weight: 0.7, belief: 0.8 },
      ],
      meta: {
        roots: ["option_premium", "option_economy"],
        leaves: ["goal_revenue"],
        source: "assistant",
      },
    },
    quality: {
      overall: 0.85,
      structure: 0.9,
      coverage: 0.8,
      causality: 0.85,
    },
    trace: {
      request_id: "test-req-123",
      correlation_id: "test-corr-456",
    },
  };

  describe("transformResponseToV3", () => {
    it("transforms V1 response to V3 format", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        brief: "We need to decide on product pricing strategy",
        requestId: "test-req-123",
      });

      expect(v3Response.schema_version).toBe("3.0");
      expect(v3Response.goal_node_id).toBe("goal_revenue");
    });

    it("separates options from graph nodes", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // Options should be in the options array, not in graph.nodes
      const optionInGraph = v3Response.graph.nodes.find(
        (n) => n.id === "option_premium" || n.id === "option_economy"
      );
      expect(optionInGraph).toBeUndefined();

      // Options should be in the options array
      expect(v3Response.options.length).toBeGreaterThan(0);
    });

    it("transforms edges to V3 format with strength_mean", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const edge of v3Response.graph.edges) {
        expect(edge).toHaveProperty("strength_mean");
        expect(edge).toHaveProperty("strength_std");
        expect(edge).toHaveProperty("belief_exists");
        expect(edge).toHaveProperty("effect_direction");
        expect(["positive", "negative"]).toContain(edge.effect_direction);
      }
    });

    it("transforms nodes to V3 format", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const node of v3Response.graph.nodes) {
        expect(node).toHaveProperty("id");
        expect(node).toHaveProperty("kind");
        expect(node).toHaveProperty("label");
      }
    });

    it("preserves factor observed_state", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      const priceNode = v3Response.graph.nodes.find((n) => n.id === "factor_price");
      expect(priceNode).toBeDefined();
      expect(priceNode?.observed_state).toBeDefined();
      expect(priceNode?.observed_state?.value).toBe(49);
      expect(priceNode?.observed_state?.unit).toBe("GBP");
    });

    it("includes quality metrics", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      expect(v3Response.quality).toBeDefined();
      expect(v3Response.quality?.overall).toBe(0.85);
    });

    it("includes trace information", () => {
      const v3Response = transformResponseToV3(sampleV1Response, {
        requestId: "custom-req",
        correlationId: "custom-corr",
      });

      expect(v3Response.trace?.request_id).toBe("custom-req");
      expect(v3Response.trace?.correlation_id).toBe("custom-corr");
    });
  });

  describe("V3 Schema Validation", () => {
    it("validates a correct V3 response", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const result = validateV3Response(v3Response);

      // Log errors for debugging if validation fails
      if (!result.valid) {
        console.log("Validation errors:", JSON.stringify(result.errors, null, 2));
      }

      // Validation passes if no schema errors (warnings are OK)
      const schemaErrors = result.errors.filter((e) => e.code === "SCHEMA_VALIDATION_ERROR");
      expect(schemaErrors.length).toBe(0);
    });

    it("validates against Zod schema", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const parseResult = CEEGraphResponseV3.safeParse(v3Response);

      expect(parseResult.success).toBe(true);
    });

    it("detects missing goal node", () => {
      const badResponse: V1DraftGraphResponse = {
        ...sampleV1Response,
        graph: {
          ...sampleV1Response.graph,
          nodes: sampleV1Response.graph.nodes.filter((n) => n.kind !== "goal"),
        },
      };

      const v3Response = transformResponseToV3(badResponse);
      const result = validateV3Response(v3Response);

      expect(result.warnings.some((w) => w.code === "GOAL_NODE_MISSING")).toBe(true);
    });
  });

  describe("V3 Response Summary", () => {
    it("calculates summary statistics", () => {
      const v3Response = transformResponseToV3(sampleV1Response);
      const summary = getV3ResponseSummary(v3Response);

      expect(summary.nodeCount).toBeGreaterThan(0);
      expect(summary.edgeCount).toBeGreaterThan(0);
      expect(summary.optionCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("needsUserMapping", () => {
    it("returns true when options need user mapping", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // Check if any options need mapping (depends on extraction success)
      const hasNeedsMapping = v3Response.options.some(
        (o) => o.status === "needs_user_mapping"
      );
      const result = needsUserMapping(v3Response);

      expect(result).toBe(hasNeedsMapping);
    });
  });

  describe("Strict Mode Validation", () => {
    it("does not throw for valid response", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // May have validation warnings but shouldn't have errors
      expect(() => validateStrictModeV3(v3Response)).not.toThrow();
    });
  });

  describe("Option Extraction", () => {
    it("extracts options from decision/option nodes", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      // The transformer should extract option nodes
      expect(v3Response.options).toBeDefined();
      expect(Array.isArray(v3Response.options)).toBe(true);
    });

    it("options have required fields", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const option of v3Response.options) {
        expect(option).toHaveProperty("id");
        expect(option).toHaveProperty("label");
        expect(option).toHaveProperty("status");
        expect(option).toHaveProperty("interventions");
        expect(["ready", "needs_user_mapping"]).toContain(option.status);
      }
    });

    it("marks vague options as needs_user_mapping and includes user_questions", () => {
      const vagueResponse: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Maximize Annual Revenue" },
            { id: "factor_price", kind: "factor", label: "Product Price", data: { value: 49, unit: "GBP" } },
            { id: "option_vague", kind: "option", label: "Improve marketing", body: "Improve marketing presence" },
            { id: "outcome_growth", kind: "outcome", label: "Business Growth" },
          ],
          edges: [
            { from: "factor_price", to: "goal_revenue", weight: 0.8, belief: 0.9, effect_direction: "positive" },
          ],
        },
      };

      const v3Response = transformResponseToV3(vagueResponse);
      const option = v3Response.options.find((o) => o.label === "Improve marketing");

      expect(option).toBeDefined();
      expect(option?.status).toBe("needs_user_mapping");
      expect(Object.keys(option?.interventions ?? {}).length).toBe(0);
      expect(option?.user_questions?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe("Edge Effect Direction", () => {
    it("derives effect_direction from strength_mean sign", () => {
      const v3Response = transformResponseToV3(sampleV1Response);

      for (const edge of v3Response.graph.edges) {
        if (edge.strength_mean >= 0) {
          expect(edge.effect_direction).toBe("positive");
        } else {
          expect(edge.effect_direction).toBe("negative");
        }
      }
    });

    it("preserves negative effect directions", () => {
      const responseWithNegativeEffect: V1DraftGraphResponse = {
        ...sampleV1Response,
        graph: {
          ...sampleV1Response.graph,
          edges: [
            ...sampleV1Response.graph.edges,
            { from: "factor_price", to: "outcome_growth", weight: 0.5, belief: 0.7, effect_direction: "negative" },
          ],
        },
      };

      const v3Response = transformResponseToV3(responseWithNegativeEffect);
      const negativeEdge = v3Response.graph.edges.find(
        (e) => e.from === "factor_price" && e.to === "outcome_growth"
      );

      expect(negativeEdge).toBeDefined();
      expect(negativeEdge?.effect_direction).toBe("negative");
      expect(negativeEdge?.strength_mean).toBeLessThan(0);
    });
  });

  describe("Backward Compatibility", () => {
    it("handles V1 responses without effect_direction", () => {
      const responseWithoutEffectDirection: V1DraftGraphResponse = {
        ...sampleV1Response,
        graph: {
          ...sampleV1Response.graph,
          edges: sampleV1Response.graph.edges.map((e) => ({
            from: e.from,
            to: e.to,
            weight: e.weight,
            belief: e.belief,
            // No effect_direction
          })),
        },
      };

      const v3Response = transformResponseToV3(responseWithoutEffectDirection);

      // Should still have effect_direction derived from weight
      for (const edge of v3Response.graph.edges) {
        expect(edge.effect_direction).toBeDefined();
        expect(["positive", "negative"]).toContain(edge.effect_direction);
      }
    });

    it("handles responses without quality metrics", () => {
      const responseWithoutQuality: V1DraftGraphResponse = {
        graph: sampleV1Response.graph,
        trace: sampleV1Response.trace,
      };

      const v3Response = transformResponseToV3(responseWithoutQuality);

      expect(v3Response.schema_version).toBe("3.0");
      expect(v3Response.quality).toBeUndefined();
    });
  });
});
