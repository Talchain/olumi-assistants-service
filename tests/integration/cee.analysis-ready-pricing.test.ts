/**
 * CEE Analysis Ready - Pricing Brief Regression Test
 *
 * Validates that pricing briefs produce correct V3 analysis_ready payloads.
 * This is a critical regression test for the P0 pricing scenario.
 *
 * Key assertions:
 * 1. V3 response includes analysis_ready by default (no ?schema param needed)
 * 2. Graph contains exactly one goal node (not outcome)
 * 3. analysis_ready has correct structure for PLoT consumption
 * 4. Goal node ID is correctly identified
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic testing
vi.stubEnv("LLM_PROVIDER", "fixtures");

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
  detectZeroExternalFactors: () => ({
    detected: false,
    factorCount: 0,
    externalCount: 0,
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

describe("CEE Analysis Ready - Pricing Brief Regression", () => {
  let app: FastifyInstance;

  const headers = {
    "X-Olumi-Assist-Key": "pricing-regression-test-key",
  } as const;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "pricing-regression-test-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "pricing-regression-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "100");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  describe("V3 Default Response Structure", () => {
    it("returns V3 with analysis_ready by default (no schema param)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph", // NO ?schema param
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // V3 is now default
      expect(body.schema_version).toBe("3.0");
      expect(res.headers["x-cee-api-version"]).toBe("v3");

      // analysis_ready must be present
      expect(body.analysis_ready).toBeDefined();
      expect(typeof body.analysis_ready).toBe("object");
    });

    it("analysis_ready has required structure for PLoT", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Required fields
      expect(body.analysis_ready).toHaveProperty("status");
      expect(body.analysis_ready).toHaveProperty("options");
      expect(body.analysis_ready).toHaveProperty("goal_node_id");

      // Status must be a valid value
      expect(["ready", "needs_user_mapping"]).toContain(body.analysis_ready.status);

      // Options must be an array
      expect(Array.isArray(body.analysis_ready.options)).toBe(true);

      // Goal node ID must be a string
      expect(typeof body.analysis_ready.goal_node_id).toBe("string");
    });
  });

  describe("Required Node Types", () => {
    it("graph contains exactly one goal node (not outcome)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const nodes = body.nodes || [];
      const goalNodes = nodes.filter((n: any) => n.kind === "goal");
      const outcomeNodes = nodes.filter((n: any) => n.kind === "outcome");

      // CRITICAL: Must have exactly one goal node
      expect(goalNodes.length).toBe(1);

      // Goal node should have a meaningful label
      expect(goalNodes[0].label).toBeDefined();
      expect(typeof goalNodes[0].label).toBe("string");
      expect(goalNodes[0].label.length).toBeGreaterThan(0);

      // Outcome nodes should NOT contain what looks like a main objective
      // (This is a heuristic - outcomes shouldn't have "increase revenue" as label if that's the goal)
      for (const outcome of outcomeNodes) {
        // Main objectives should be goals, not outcomes
        const label = (outcome.label || "").toLowerCase();
        const isMainObjective =
          label.includes("maximize") ||
          label.includes("optimise") ||
          label.includes("achieve") ||
          (label.includes("increase") && label.includes("revenue"));

        if (isMainObjective) {
          // This would indicate the LLM incorrectly used outcome for the main objective
          console.warn(`Potential misclassification: "${outcome.label}" as outcome instead of goal`);
        }
      }
    });

    it("graph contains at least one decision node", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const nodes = body.nodes || [];
      const decisionNodes = nodes.filter((n: any) => n.kind === "decision");

      // CRITICAL: Must have at least one decision node
      expect(decisionNodes.length).toBeGreaterThanOrEqual(1);

      // Decision node should have a meaningful label
      if (decisionNodes.length > 0) {
        expect(decisionNodes[0].label).toBeDefined();
        expect(typeof decisionNodes[0].label).toBe("string");
      }
    });

    it("graph or options array contains at least two options", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Options can be in graph.nodes OR in top-level options array (V3)
      const nodes = body.nodes || [];
      const optionNodesInGraph = nodes.filter((n: any) => n.kind === "option");
      const optionsArray = body.options || body.analysis_ready?.options || [];

      // At least 2 options must exist (either in graph or options array)
      const totalOptions = optionNodesInGraph.length + optionsArray.length;
      expect(totalOptions).toBeGreaterThanOrEqual(2);
    });

    it("analysis_ready.goal_node_id references a valid goal node", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const goalNodeId = body.analysis_ready?.goal_node_id;
      expect(goalNodeId).toBeDefined();

      // The goal_node_id must reference an actual node in the graph
      const nodes = body.nodes || [];
      const goalNode = nodes.find((n: any) => n.id === goalNodeId);

      expect(goalNode).toBeDefined();
      expect(goalNode.kind).toBe("goal");
    });
  });

  describe("Option Structure", () => {
    it("options array contains option objects with required fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const options = body.analysis_ready?.options || [];

      for (const opt of options) {
        // Required fields per OptionForAnalysisT (analysis-ready schema)
        // Note: status is at analysis_ready.status level, NOT on individual options
        expect(opt).toHaveProperty("id");
        expect(opt).toHaveProperty("label");
        expect(opt).toHaveProperty("interventions");

        // Interventions must be Record<string, number> - plain numbers, not objects
        expect(typeof opt.interventions).toBe("object");
        for (const [_factorId, value] of Object.entries(opt.interventions)) {
          expect(typeof value).toBe("number");
        }

        // extraction_metadata is optional but if present, has correct structure
        if (opt.extraction_metadata) {
          expect(["brief_extraction", "cee_hypothesis", "user_specified"]).toContain(
            opt.extraction_metadata.source
          );
          expect(["high", "medium", "low"]).toContain(opt.extraction_metadata.confidence);
        }
      }
    });

    it("analysis_ready has top-level status (not per-option)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Status is at payload level, not option level
      expect(body.analysis_ready.status).toBeDefined();
      expect(["ready", "needs_user_mapping"]).toContain(body.analysis_ready.status);

      // If needs_user_mapping, should have user_questions
      if (body.analysis_ready.status === "needs_user_mapping") {
        expect(body.analysis_ready.user_questions).toBeDefined();
        expect(Array.isArray(body.analysis_ready.user_questions)).toBe(true);
        expect(body.analysis_ready.user_questions.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Response Headers", () => {
    it("sets correct CEE headers for V3 default", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);

      // V3 is default
      expect(res.headers["x-cee-api-version"]).toBe("v3");

      // Request ID should be present
      expect(res.headers["x-cee-request-id"]).toBeDefined();
    });
  });

  describe("Backward Compatibility", () => {
    it("explicit ?schema=v1 still returns V1 format without analysis_ready", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v1",
        headers,
        payload: {
          brief: "Should we increase Pro plan price from £49 to £59?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // V1 format
      expect(body.schema_version).toBeUndefined();
      expect(body.analysis_ready).toBeUndefined();
      expect(res.headers["x-cee-api-version"]).toBe("v1");
    });
  });
});
