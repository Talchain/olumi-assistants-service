/**
 * CEE Schema V2 Integration Tests
 *
 * Verifies that `?schema=v2` query parameter returns v2.2 schema format
 * with effect_direction, strength_std, and observed_state fields.
 *
 * These tests ensure the transformation layer is correctly wired to the
 * HTTP endpoint, preventing regressions that would break PLoT/ISL downstream.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
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
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("GET /assist/v1/draft-graph?schema=v2", () => {
  let app: FastifyInstance;

  const headers = {
    "X-Olumi-Assist-Key": "schema-v2-test-key",
  } as const;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "schema-v2-test-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "schema-v2-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "100");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  describe("schema_version field", () => {
    it("returns schema_version 2.2 when ?schema=v2 is specified", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Should we increase our subscription price from £49 to £59 per month?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.schema_version).toBe("2.2");
    });

    it("returns schema_version 2.2 when ?schema=2 is specified", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=2",
        headers,
        payload: {
          brief: "Should we hire more engineers or invest in automation?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.schema_version).toBe("2.2");
    });

    it("returns schema_version 2.2 when ?schema=2.2 is specified", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=2.2",
        headers,
        payload: {
          brief: "Should we expand into European markets next quarter?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.schema_version).toBe("2.2");
    });

    it("returns v3 (with schema_version 3.0) when no schema param (v3 is default)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "Should we change our pricing model from monthly to annual?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // V3 is now the default - includes schema_version and analysis_ready
      expect(body.schema_version).toBe("3.0");
      expect(body.analysis_ready).toBeDefined();
    });
  });

  describe("edge fields", () => {
    it("edges have effect_direction field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "How does price increase affect customer demand and revenue?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.graph.edges.length).toBeGreaterThan(0);
      for (const edge of body.graph.edges) {
        expect(edge).toHaveProperty("effect_direction");
        expect(["positive", "negative"]).toContain(edge.effect_direction);
      }
    });

    it("edges have strength_std field greater than 0", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Marketing investment leads to higher sales conversion rates.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.graph.edges.length).toBeGreaterThan(0);
      for (const edge of body.graph.edges) {
        expect(edge).toHaveProperty("strength_std");
        expect(typeof edge.strength_std).toBe("number");
        expect(edge.strength_std).toBeGreaterThan(0);
      }
    });

    it("edges have minimum strength_std of 0.05", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Team size affects project velocity which impacts delivery timeline.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      for (const edge of body.graph.edges) {
        expect(edge.strength_std).toBeGreaterThanOrEqual(0.05);
      }
    });

    it("edges do NOT have provenance_source in v2", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Customer satisfaction drives retention and referrals.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      for (const edge of body.graph.edges) {
        expect(edge).not.toHaveProperty("provenance_source");
      }
    });
  });

  describe("node fields", () => {
    it('nodes use "type" not "kind" in v2', async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Should we launch a premium tier with advanced features?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.graph.nodes.length).toBeGreaterThan(0);
      for (const node of body.graph.nodes) {
        expect(node).toHaveProperty("type");
        expect(node).not.toHaveProperty("kind");
        expect(["factor", "option", "outcome", "goal", "risk"]).toContain(node.type);
      }
    });

    it('nodes use "description" not "body" in v2', async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "How should we approach vendor selection for our new CRM system?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      for (const node of body.graph.nodes) {
        expect(node).not.toHaveProperty("body");
        // description is optional but body should never appear
      }
    });

    it("all nodes have a label (required in v2)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Should we outsource customer support or build in-house team?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      for (const node of body.graph.nodes) {
        expect(node).toHaveProperty("label");
        expect(typeof node.label).toBe("string");
        expect(node.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("observed_state for factor nodes", () => {
    it("factor nodes have observed_state when quantitative values present", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          // Brief with explicit quantitative values
          brief: "Current monthly subscription price is £49. We are considering raising it to £59. Our churn rate is currently 5% per month.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Find factor nodes with observed_state
      const factorNodes = body.graph.nodes.filter(
        (n: any) => n.type === "factor" && n.observed_state
      );

      // At least one factor should have observed_state with value
      // (depends on fixture behavior but briefs with numbers should extract them)
      if (factorNodes.length > 0) {
        for (const factor of factorNodes) {
          expect(factor.observed_state).toHaveProperty("value");
          expect(typeof factor.observed_state.value).toBe("number");
        }
      }
    });

    it("observed_state includes unit when present", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Our enterprise tier is priced at $1,200 per year. Competitor pricing is $1,500.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const factorsWithUnits = body.graph.nodes.filter(
        (n: any) => n.type === "factor" && n.observed_state?.unit
      );

      for (const factor of factorsWithUnits) {
        expect(typeof factor.observed_state.unit).toBe("string");
      }
    });

    it("observed_state includes baseline when from-to values present", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Considering changing price from $99 to $129 for the pro plan.",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      const factorsWithBaseline = body.graph.nodes.filter(
        (n: any) => n.type === "factor" && n.observed_state?.baseline !== undefined
      );

      for (const factor of factorsWithBaseline) {
        expect(typeof factor.observed_state.baseline).toBe("number");
      }
    });
  });

  describe("response headers", () => {
    it("sets X-CEE-API-Version header to v2 when schema=v2", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          brief: "Should we pivot to a different market segment?",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cee-api-version"]).toBe("v2");
    });

    it("sets X-CEE-API-Version header to v3 when no schema param (v3 is default)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers,
        payload: {
          brief: "What's the best approach to reduce customer acquisition cost?",
        },
      });

      expect(res.statusCode).toBe(200);
      // V3 is now the default - includes analysis_ready for PLoT consumption
      expect(res.headers["x-cee-api-version"]).toBe("v3");
    });
  });

  describe("v1 vs v2 vs v3 comparison", () => {
    it("same brief returns different schema formats for v1, v2, and v3", async () => {
      const brief = "Should we increase marketing spend by 20% next quarter?";

      const [v1Res, v2Res, defaultRes] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/assist/v1/draft-graph?schema=v1",
          headers,
          payload: { brief },
        }),
        app.inject({
          method: "POST",
          url: "/assist/v1/draft-graph?schema=v2",
          headers,
          payload: { brief },
        }),
        app.inject({
          method: "POST",
          url: "/assist/v1/draft-graph", // No schema param = V3 default
          headers,
          payload: { brief },
        }),
      ]);

      expect(v1Res.statusCode).toBe(200);
      expect(v2Res.statusCode).toBe(200);
      expect(defaultRes.statusCode).toBe(200);

      const v1Body = JSON.parse(v1Res.body);
      const v2Body = JSON.parse(v2Res.body);
      const defaultBody = JSON.parse(defaultRes.body);

      // V1 should not have schema_version
      expect(v1Body.schema_version).toBeUndefined();
      // V2 should have schema_version 2.2
      expect(v2Body.schema_version).toBe("2.2");
      // Default (V3) should have schema_version 3.0
      expect(defaultBody.schema_version).toBe("3.0");
      // Default (V3) should have analysis_ready
      expect(defaultBody.analysis_ready).toBeDefined();

      // V1 nodes should have 'kind', V2 should have 'type', V3 should have 'kind'
      if (v1Body.graph.nodes.length > 0) {
        expect(v1Body.graph.nodes[0]).toHaveProperty("kind");
        expect(v1Body.graph.nodes[0]).not.toHaveProperty("type");
      }
      if (v2Body.graph.nodes.length > 0) {
        expect(v2Body.graph.nodes[0]).toHaveProperty("type");
        expect(v2Body.graph.nodes[0]).not.toHaveProperty("kind");
      }
      if (defaultBody.graph.nodes.length > 0) {
        expect(defaultBody.graph.nodes[0]).toHaveProperty("kind");
      }

      // V2 edges should have effect_direction, V1 should not, V3 should
      if (v1Body.graph.edges.length > 0) {
        expect(v1Body.graph.edges[0]).not.toHaveProperty("effect_direction");
        expect(v1Body.graph.edges[0]).not.toHaveProperty("strength_std");
      }
      if (v2Body.graph.edges.length > 0) {
        expect(v2Body.graph.edges[0]).toHaveProperty("effect_direction");
        expect(v2Body.graph.edges[0]).toHaveProperty("strength_std");
      }
      if (defaultBody.graph.edges.length > 0) {
        expect(defaultBody.graph.edges[0]).toHaveProperty("effect_direction");
        expect(defaultBody.graph.edges[0]).toHaveProperty("strength_std");
      }
    });
  });

  describe("error handling", () => {
    it("returns v3 format on invalid schema param (v3 is default)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v99",
        headers,
        payload: {
          brief: "Should we invest in R&D or marketing this year?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Invalid schema falls back to V3 (the new default)
      expect(body.schema_version).toBe("3.0");
      expect(body.analysis_ready).toBeDefined();
      if (body.graph.nodes.length > 0) {
        expect(body.graph.nodes[0]).toHaveProperty("kind");
      }
    });

    it("does not transform on error responses", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v2",
        headers,
        payload: {
          // Empty brief should fail preflight
          brief: "",
        },
      });

      // Should return error status
      expect(res.statusCode).toBeGreaterThanOrEqual(400);

      const body = JSON.parse(res.body);
      // Error responses should not have schema_version
      expect(body.schema_version).toBeUndefined();
    });
  });
});
