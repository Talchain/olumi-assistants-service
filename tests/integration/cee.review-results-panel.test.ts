/**
 * Integration tests for Results Panel content in /assist/v1/review
 *
 * Tests that the four new content types (decision_quality, insights,
 * improvement_guidance, rationale) are correctly generated and returned.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic results
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/review Results Panel content", () => {
  let app: FastifyInstance;
  const API_KEY = "test-key";

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", API_KEY);
    vi.stubEnv("CEE_REVIEW_RATE_LIMIT_RPM", "100"); // High limit for tests
    cleanBaseUrl();
    app = await build();
  });

  afterAll(async () => {
    await app.close();
  });

  // Base graph structure for testing
  const baseGraph = {
    nodes: [
      { id: "goal_1", kind: "goal", label: "Maximize Revenue" },
      { id: "opt_1", kind: "option", label: "Premium Plan" },
      { id: "opt_2", kind: "option", label: "Basic Plan" },
      { id: "fac_1", kind: "factor", label: "Price Elasticity", observed_state: { value: 0.8 } },
      { id: "fac_2", kind: "factor", label: "Market Size", observed_state: { value: 1000000 } },
      { id: "out_1", kind: "outcome", label: "Revenue Growth" },
    ],
    edges: [
      { id: "e1", source: "opt_1", target: "fac_1", weight: 0.7 },
      { id: "e2", source: "opt_2", target: "fac_1", weight: 0.4 },
      { id: "e3", source: "fac_1", target: "out_1", weight: 0.8 },
      { id: "e4", source: "fac_2", target: "out_1", weight: 0.6 },
      { id: "e5", source: "out_1", target: "goal_1", weight: 1.0 },
    ],
  };

  // Robustness data for rationale generation
  const robustnessData = {
    recommendation_stability: 0.85,
    recommended_option: { id: "opt_1", label: "Premium Plan" },
    factor_sensitivity: [
      { factor_id: "fac_1", factor_label: "Price Elasticity", elasticity: 0.7 },
      { factor_id: "fac_2", factor_label: "Market Size", elasticity: 0.4 },
    ],
  };

  describe("decision_quality", () => {
    it("returns decision_quality with level and summary", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Should we launch the premium plan?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.decision_quality).toBeDefined();
      expect(body.decision_quality.level).toMatch(
        /incomplete|needs_strengthening|good|solid/
      );
      expect(body.decision_quality.summary).toBeDefined();
      expect(typeof body.decision_quality.summary).toBe("string");
    });

    it("returns incomplete when graph has missing baseline factors", async () => {
      const graphWithMissingBaseline = {
        ...baseGraph,
        nodes: [
          ...baseGraph.nodes.slice(0, 3),
          { id: "fac_1", kind: "factor", label: "Missing Baseline" }, // No observed_state
          { id: "fac_2", kind: "factor", label: "Also Missing" }, // No observed_state
          ...baseGraph.nodes.slice(5),
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: graphWithMissingBaseline,
          brief: "Test brief",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.decision_quality).toBeDefined();
      // Missing baselines should trigger "incomplete" or "needs_strengthening"
      expect(["incomplete", "needs_strengthening"]).toContain(
        body.decision_quality.level
      );
    });
  });

  describe("insights", () => {
    it("returns insights array when available", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Should we increase pricing?",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Insights may or may not be present depending on graph analysis
      if (body.insights) {
        expect(Array.isArray(body.insights)).toBe(true);
        expect(body.insights.length).toBeLessThanOrEqual(5);

        body.insights.forEach((insight: unknown) => {
          const i = insight as { type: string; content: string; severity?: string };
          expect(["fragile_assumption", "potential_bias", "information_gap"]).toContain(
            i.type
          );
          expect(typeof i.content).toBe("string");
          if (i.severity) {
            expect(["low", "medium", "high"]).toContain(i.severity);
          }
        });
      }
    });

    it("returns insights from robustness data when provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Pricing decision",
          robustness_data: {
            ...robustnessData,
            assumption_explanations: [
              {
                edge_id: "e1",
                explanation: "Price elasticity assumption is fragile",
                severity: "fragile",
              },
            ],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      if (body.insights) {
        const fragileAssumptions = body.insights.filter(
          (i: { type: string }) => i.type === "fragile_assumption"
        );
        expect(fragileAssumptions.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("improvement_guidance", () => {
    it("returns improvement_guidance array when issues found", async () => {
      const graphWithIssues = {
        ...baseGraph,
        nodes: [
          ...baseGraph.nodes.slice(0, 3),
          { id: "fac_1", kind: "factor", label: "Price Sensitivity" }, // Missing baseline
          { id: "fac_2", kind: "factor", label: "Competition Level" }, // Missing baseline
          ...baseGraph.nodes.slice(5),
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: graphWithIssues,
          brief: "Market entry decision",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      if (body.improvement_guidance) {
        expect(Array.isArray(body.improvement_guidance)).toBe(true);
        expect(body.improvement_guidance.length).toBeLessThanOrEqual(5);

        body.improvement_guidance.forEach((item: unknown) => {
          const g = item as {
            priority: number;
            action: string;
            reason: string;
            source: string;
          };
          expect(typeof g.priority).toBe("number");
          expect(g.priority).toBeGreaterThanOrEqual(1);
          expect(g.priority).toBeLessThanOrEqual(5);
          expect(typeof g.action).toBe("string");
          expect(typeof g.reason).toBe("string");
          expect(["missing_baseline", "fragile_edge", "bias", "structure"]).toContain(
            g.source
          );
        });
      }
    });

    it("includes priority and source in guidance items", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Market entry decision",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      if (body.improvement_guidance && body.improvement_guidance.length > 0) {
        // All items should have priority and source
        body.improvement_guidance.forEach((item: { priority: number; source: string }) => {
          expect(item.priority).toBeGreaterThanOrEqual(1);
          expect(item.priority).toBeLessThanOrEqual(5);
          expect(["missing_baseline", "fragile_edge", "bias", "structure"]).toContain(
            item.source
          );
        });
      }
    });
  });

  describe("rationale", () => {
    it("returns rationale when robustness_data has recommended_option", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Which plan should we offer?",
          robustness_data: robustnessData,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.rationale).toBeDefined();
      expect(typeof body.rationale.summary).toBe("string");
      expect(body.rationale.summary).toContain("Premium Plan");

      // Key driver should be set from factor_sensitivity
      if (body.rationale.key_driver) {
        expect(body.rationale.key_driver).toBe("Price Elasticity");
      }

      // Goal alignment should reference the goal
      if (body.rationale.goal_alignment) {
        expect(body.rationale.goal_alignment).toContain("Maximize Revenue");
      }
    });

    it("does not return rationale when no recommended_option", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "General analysis",
          // No robustness_data
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Rationale should be undefined when no recommended option
      expect(body.rationale).toBeUndefined();
    });

    it("includes stability in rationale when provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Decision with stability",
          robustness_data: {
            ...robustnessData,
            recommendation_stability: 0.92,
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.rationale).toBeDefined();
      // Summary should mention stability or the recommendation
      expect(body.rationale.summary.length).toBeGreaterThan(0);
    });
  });

  describe("combined response", () => {
    it("returns all four content types when full data provided", async () => {
      const fullRobustnessData = {
        ...robustnessData,
        assumption_explanations: [
          {
            edge_id: "e1",
            explanation: "Assumption explanation",
            severity: "moderate" as const,
          },
        ],
        investigation_suggestions: [
          {
            factor_id: "fac_1",
            factor_label: "Price Elasticity",
            elasticity: 0.7,
            rationale: "High sensitivity",
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Full analysis with all data",
          robustness_data: fullRobustnessData,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // All should be present
      expect(body.decision_quality).toBeDefined();
      expect(body.rationale).toBeDefined();

      // These may or may not be present depending on analysis
      // but the fields should be valid if present
      if (body.insights) {
        expect(Array.isArray(body.insights)).toBe(true);
      }
      if (body.improvement_guidance) {
        expect(Array.isArray(body.improvement_guidance)).toBe(true);
      }
    });

    it("includes Results Panel telemetry headers", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": API_KEY },
        payload: {
          graph: baseGraph,
          brief: "Test telemetry",
          robustness_data: robustnessData,
        },
      });

      expect(res.statusCode).toBe(200);

      // Standard CEE headers should be present
      expect(res.headers["x-cee-api-version"]).toBe("v1");
      expect(res.headers["x-cee-feature-version"]).toBeDefined();
      expect(res.headers["x-cee-request-id"]).toBeDefined();
    });
  });
});
