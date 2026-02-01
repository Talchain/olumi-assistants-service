/**
 * Integration tests for /assist/v1/review robustness synthesis feature
 *
 * Tests that PLoT robustness_data is properly processed and returned
 * as robustness_synthesis in the response.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Configure API keys for test (multiple keys to avoid rate limiting across test groups)
vi.stubEnv("ASSIST_API_KEYS", "rs-key-full,rs-key-partial,rs-key-none,rs-key-edge");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn().mockReturnValue({
    warnings: [],
    uncertainNodeIds: [],
  }),
  detectUniformStrengths: () => ({
    detected: false,
    totalEdges: 0,
    defaultStrengthCount: 0,
    defaultStrengthPercentage: 0,
  }),
  detectStrengthClustering: () => ({
    detected: false,
    coefficientOfVariation: 0,
    edgeCount: 0,
  }),
  detectSameLeverOptions: () => ({
    detected: false,
    maxOverlapPercentage: 0,
    overlappingOptionPairs: [],
  }),
  detectMissingBaseline: () => ({
    detected: false,
    hasBaseline: false,
  }),
  detectGoalNoBaselineValue: () => ({
    detected: false,
    goalHasValue: false,
  }),
  checkGoalConnectivity: () => ({
    status: "full",
    disconnectedOptions: [],
    weakPaths: [],
  }),
  computeModelQualityFactors: () => ({
    estimate_confidence: 0.5,
    strength_variation: 0,
    range_confidence_coverage: 0,
    has_baseline_option: false,
  }),
  normaliseDecisionBranchBeliefs: (graph: unknown) => graph,
  validateAndFixGraph: (graph: unknown) => ({
    graph,
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  }),
  fixNonCanonicalStructuralEdges: (graph: unknown) => ({
    graph,
    fixedEdgeCount: 0,
    fixedEdgeIds: [],
    repairs: [],
  }),
  // Goal inference utilities
  hasGoalNode: (graph: any) => {
    if (!graph || !Array.isArray(graph.nodes)) return false;
    return graph.nodes.some((n: any) => n.kind === "goal");
  },
  ensureGoalNode: (graph: any) => ({
    graph,
    goalAdded: false,
    inferredFrom: undefined,
    goalNodeId: undefined,
  }),
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/review robustness synthesis", () => {
  let app: FastifyInstance;

  // Different keys for each test group to avoid rate limiting
  const headersFull = { "X-Olumi-Assist-Key": "rs-key-full" } as const;
  const headersPartial = { "X-Olumi-Assist-Key": "rs-key-partial" } as const;
  const headersNone = { "X-Olumi-Assist-Key": "rs-key-none" } as const;
  const headersEdge = { "X-Olumi-Assist-Key": "rs-key-edge" } as const;

  const minimalGraph = {
    nodes: [
      { id: "g1", kind: "goal", label: "Maximize Revenue" },
      { id: "d1", kind: "decision", label: "Pricing Strategy" },
      { id: "o1", kind: "option", label: "Premium Pricing" },
      { id: "o2", kind: "option", label: "Economy Pricing" },
      { id: "f1", kind: "factor", label: "Market Size" },
    ],
    edges: [
      { from: "d1", to: "o1" },
      { from: "d1", to: "o2" },
      { from: "o1", to: "g1", weight: 0.8 },
      { from: "o2", to: "g1", weight: 0.6 },
      { from: "f1", to: "g1", weight: 0.7 },
    ],
  };

  beforeAll(async () => {
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("full robustness_data", () => {
    it("returns complete robustness_synthesis when full data provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersFull,
        payload: {
          graph: minimalGraph,
          brief: "Should we increase our subscription price from £49 to £59 per month?",
          robustness_data: {
            recommendation_stability: 0.87,
            recommended_option: {
              id: "opt_premium",
              label: "Premium Pricing",
            },
            fragile_edges: [
              {
                edge_id: "fac_price->goal_revenue",
                from_label: "Price",
                to_label: "Revenue",
                alternative_winner_id: "opt_economy",
                alternative_winner_label: "Economy Pricing",
                switch_probability: 0.34,
              },
            ],
            robust_edges: [
              {
                edge_id: "fac_market_size->goal_revenue",
                from_label: "Market Size",
                to_label: "Revenue",
              },
            ],
            factor_sensitivity: [
              {
                factor_id: "fac_market_size",
                factor_label: "Market Size",
                elasticity: 0.73,
                importance_rank: 1,
                interpretation: "Decision is highly sensitive to Market Size",
              },
            ],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.robustness_synthesis).toBeDefined();
      expect(body.robustness_synthesis.headline).toBe(
        "87% confident that Premium Pricing remains your best option"
      );
      // With contextualised templates, check for key elements
      expect(body.robustness_synthesis.assumption_explanations).toHaveLength(1);
      expect(body.robustness_synthesis.assumption_explanations[0].edge_id).toBe("fac_price->goal_revenue");
      expect(body.robustness_synthesis.assumption_explanations[0].severity).toBe("fragile");
      expect(body.robustness_synthesis.assumption_explanations[0].explanation).toContain("Price");
      expect(body.robustness_synthesis.assumption_explanations[0].explanation).toContain("Revenue");
      expect(body.robustness_synthesis.assumption_explanations[0].explanation).toContain("Economy Pricing");

      expect(body.robustness_synthesis.investigation_suggestions).toHaveLength(1);
      expect(body.robustness_synthesis.investigation_suggestions[0].factor_id).toBe("fac_market_size");
      expect(body.robustness_synthesis.investigation_suggestions[0].elasticity).toBe(0.73);
      expect(body.robustness_synthesis.investigation_suggestions[0].suggestion).toContain("Market Size");
      expect(body.robustness_synthesis.investigation_suggestions[0].suggestion).toContain("high influence");
    });
  });

  describe("partial robustness_data", () => {
    it("returns partial synthesis with only stability", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersPartial,
        payload: {
          graph: minimalGraph,
          brief: "Should we hire more engineers or invest in automation?",
          robustness_data: {
            recommendation_stability: 0.75,
            recommended_option: {
              id: "opt_a",
              label: "Hire Engineers",
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.robustness_synthesis).toBeDefined();
      expect(body.robustness_synthesis.headline).toBe(
        "75% confident that Hire Engineers remains your best option"
      );
      // With fallback behavior, these have fallback messages
      expect(body.robustness_synthesis.assumption_explanations[0].explanation).toContain("No critical assumptions");
      expect(body.robustness_synthesis.investigation_suggestions[0].suggestion).toContain("stable influence");
    });

    it("returns synthesis with only fragile edges", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersPartial,
        payload: {
          graph: minimalGraph,
          brief: "Should we expand to European markets?",
          robustness_data: {
            fragile_edges: [
              {
                edge_id: "e1",
                from_label: "Market Size",
                to_label: "Growth",
              },
            ],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.robustness_synthesis).toBeDefined();
      // With fallback behavior, headline has fallback message when stability is missing
      expect(body.robustness_synthesis.headline).toBe("Robustness analysis in progress");
      expect(body.robustness_synthesis.assumption_explanations).toHaveLength(1);
      // With contextualised templates, check for key elements
      expect(body.robustness_synthesis.assumption_explanations[0].explanation).toContain("Market Size");
      expect(body.robustness_synthesis.assumption_explanations[0].explanation).toContain("Growth");
    });

    it("returns synthesis with only factor sensitivity", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersPartial,
        payload: {
          graph: minimalGraph,
          brief: "Should we launch a new product line?",
          robustness_data: {
            factor_sensitivity: [
              {
                factor_id: "fac_cost",
                factor_label: "Development Cost",
                elasticity: 0.55,
                importance_rank: 1,
              },
            ],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.robustness_synthesis).toBeDefined();
      // With fallback behavior enabled, headline is populated with fallback message
      expect(body.robustness_synthesis.headline).toBe("Robustness analysis in progress");
      expect(body.robustness_synthesis.investigation_suggestions).toHaveLength(1);
      expect(body.robustness_synthesis.investigation_suggestions[0].suggestion).toContain(
        "Development Cost"
      );
    });
  });

  describe("no robustness_data", () => {
    it("returns null robustness_synthesis when no data provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersNone,
        payload: {
          graph: minimalGraph,
          brief: "Should we change our pricing model from monthly to annual?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Still null when no robustness_data provided at all
      expect(body.robustness_synthesis).toBeNull();
    });

    it("returns fallback robustness_synthesis when empty data provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersNone,
        payload: {
          graph: minimalGraph,
          brief: "Should we outsource development?",
          robustness_data: {
            fragile_edges: [],
            factor_sensitivity: [],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // With fallback behavior enabled, returns fallback messages instead of null
      expect(body.robustness_synthesis).toBeDefined();
      expect(body.robustness_synthesis.headline).toBe("Robustness analysis in progress");
      expect(body.robustness_synthesis.assumption_explanations[0].explanation).toContain(
        "No critical assumptions"
      );
      expect(body.robustness_synthesis.investigation_suggestions[0].suggestion).toContain(
        "stable influence"
      );
    });
  });

  describe("edge cases", () => {
    it("handles factors below elasticity threshold", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersEdge,
        payload: {
          graph: minimalGraph,
          brief: "Test brief for edge case",
          robustness_data: {
            recommendation_stability: 0.9,
            factor_sensitivity: [
              {
                factor_id: "fac_low",
                factor_label: "Low Impact Factor",
                elasticity: 0.1,
                importance_rank: 10,
              },
            ],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Should have headline and fallback investigation suggestion
      expect(body.robustness_synthesis.headline).toBeDefined();
      // With fallback behavior, returns a "stable influence" message when no factors meet criteria
      expect(body.robustness_synthesis.investigation_suggestions).toHaveLength(1);
      expect(body.robustness_synthesis.investigation_suggestions[0].suggestion).toContain("stable influence");
    });

    it("coexists with existing robustness field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: headersEdge,
        payload: {
          graph: minimalGraph,
          brief: "Test coexistence of robustness and robustness_data",
          // Old ISL robustness field
          robustness: {
            status: "computed",
            overall_score: 0.85,
            sensitivities: [
              {
                node_id: "f1",
                label: "Factor 1",
                sensitivity_score: 0.7,
                classification: "high",
              },
            ],
          },
          // New PLoT robustness_data field
          robustness_data: {
            recommendation_stability: 0.92,
            recommended_option: {
              id: "opt_a",
              label: "Option A",
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Should have both blocks and synthesis
      const robustnessBlock = body.blocks.find((b: any) => b.type === "robustness");
      expect(robustnessBlock).toBeDefined();
      expect(robustnessBlock.status).toBe("computed");

      expect(body.robustness_synthesis).toBeDefined();
      expect(body.robustness_synthesis.headline).toContain("92%");
    });
  });
});
