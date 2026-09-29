/**
 * Integration tests for /assist/v1/review endpoint
 *
 * M1 CEE Orchestrator - Shape-complete response with blocks and readiness assessment
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";

describe("CEE Review Endpoint", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "test-key,test-key-2");
    vi.stubEnv("CEE_REVIEW_RATE_LIMIT_RPM", "100");
    app = await build();
  });

  afterAll(async () => {
    await app.close();
  });

  // Valid test graph
  const validGraph = {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Increase Revenue" },
      { id: "decision_1", kind: "decision", label: "Pricing Strategy" },
      { id: "option_1", kind: "option", label: "Raise Prices" },
      { id: "option_2", kind: "option", label: "Lower Prices" },
      { id: "factor_1", kind: "factor", label: "Market Competition", data: { value: 0.7 } },
    ],
    edges: [
      { from: "decision_1", to: "goal_1", belief: 0.8 },
      { from: "option_1", to: "decision_1", belief: 0.6 },
      { from: "option_2", to: "decision_1", belief: 0.5 },
      { from: "factor_1", to: "option_1", belief: 0.7 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };

  const validRequest = {
    graph: validGraph,
    brief: "We need to decide on a pricing strategy to increase revenue. The market is competitive.",
  };

  describe("POST /assist/v1/review", () => {
    it("should return 200 with shape-complete response for valid request", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Check required top-level fields
      expect(body.intent).toBeDefined();
      expect(["selection", "prediction", "validation"]).toContain(body.intent);
      expect(body.analysis_state).toBeDefined();
      expect(["not_run", "ran", "partial", "stale"]).toContain(body.analysis_state);

      // Check trace is present with required fields
      expect(body.trace).toBeDefined();
      expect(body.trace.request_id).toBeDefined();
      expect(typeof body.trace.request_id).toBe("string");
      expect(body.trace.latency_ms).toBeDefined();
      expect(typeof body.trace.latency_ms).toBe("number");
      expect(body.trace.model).toBeDefined();

      // Check readiness with required schema
      expect(body.readiness).toBeDefined();
      expect(body.readiness.level).toBeDefined();
      expect(["ready", "caution", "not_ready"]).toContain(body.readiness.level);
      expect(body.readiness.headline).toBeDefined();
      expect(typeof body.readiness.headline).toBe("string");
      expect(body.readiness.factors).toBeDefined();
      expect(Array.isArray(body.readiness.factors)).toBe(true);
      expect(body.readiness.factors.length).toBeGreaterThan(0);
      // Each factor has label and status
      for (const factor of body.readiness.factors) {
        expect(factor.label).toBeDefined();
        expect(["ok", "warning", "blocking"]).toContain(factor.status);
      }

      // Check blocks array is present
      expect(body.blocks).toBeDefined();
      expect(Array.isArray(body.blocks)).toBe(true);
      expect(body.blocks.length).toBeGreaterThan(0);

      // Check response headers
      expect(response.headers["x-cee-api-version"]).toBe("v1");
      expect(response.headers["x-cee-request-id"]).toBeDefined();
    });

    it("should return blocks of various types", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const blockTypes = body.blocks.map((b: any) => b.type);

      // Should have various block types
      expect(blockTypes).toContain("next_steps");

      // Each block should have required fields
      for (const block of body.blocks) {
        expect(block.id).toBeDefined();
        expect(block.type).toBeDefined();
        expect(block.generated_at).toBeDefined();
      }
    });

    it("should use X-Request-Id header when provided", async () => {
      const customRequestId = "test-request-id-12345";

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
          "x-request-id": customRequestId,
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.trace.request_id).toBe(customRequestId);
      expect(response.headers["x-cee-request-id"]).toBe(customRequestId);
    });

    it("should return 400 for invalid graph", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          brief: "Test brief that is long enough",
          graph: "not-a-valid-graph", // Invalid: should be object
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("CEE_REVIEW_VALIDATION_FAILED");
      expect(body.error.retryable).toBe(false);
    });

    it("should return 400 for brief too short", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          brief: "short", // Less than 10 chars
          graph: validGraph,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("CEE_REVIEW_VALIDATION_FAILED");
    });

    it("should return 400 for missing graph", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          brief: "Test brief that is long enough for validation",
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });

    it("should include archetype in response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          ...validRequest,
          archetype_hint: "vendor_selection",
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.archetype).toBeDefined();
      expect(body.archetype.decision_type).toBeDefined();
      expect(body.archetype.match).toBeDefined();
      expect(body.archetype.confidence).toBeDefined();
    });

    it("should include guidance in response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.guidance).toBeDefined();
      expect(body.guidance.headline).toBeDefined();
    });

    it("should handle inference data when provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          ...validRequest,
          inference: {
            ranked_actions: [
              { node_id: "option_1", label: "Raise Prices", expected_utility: 0.75, rank: 1, dominant: true },
              { node_id: "option_2", label: "Lower Prices", expected_utility: 0.55, rank: 2 },
            ],
            top_drivers: [
              { node_id: "factor_1", label: "Market Competition", impact_pct: 65, direction: "negative" },
            ],
            summary: "Raising prices is the dominant strategy.",
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Prediction block should reference inference data
      const predictionBlock = body.blocks.find((b: any) => b.type === "prediction");
      if (predictionBlock) {
        expect(predictionBlock.headline).toBeDefined();
      }
    });

    it("should return response_limits metadata", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.response_limits).toBeDefined();
      expect(body.response_limits.blocks_max).toBeDefined();
      expect(typeof body.response_limits.blocks_truncated).toBe("boolean");
    });
  });

  describe("Error handling", () => {
    it("should return error with request_id in trace", async () => {
      const customRequestId = "error-test-id-789";

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
          "x-request-id": customRequestId,
        },
        payload: {
          brief: "short", // Invalid
          graph: validGraph,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.trace).toBeDefined();
      expect(body.trace.request_id).toBe(customRequestId);
    });

    it("should return retryable=false for validation errors", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          brief: "short",
          graph: validGraph,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.retryable).toBe(false);
    });
  });

  describe("Block content verification", () => {
    it("should return biases block with findings array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const biasBlock = body.blocks.find((b: any) => b.type === "biases");

      if (biasBlock) {
        expect(biasBlock.findings).toBeDefined();
        expect(Array.isArray(biasBlock.findings)).toBe(true);
        expect(biasBlock.confidence).toBeDefined();
      }
    });

    it("should return risks block with warnings array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const risksBlock = body.blocks.find((b: any) => b.type === "risks");

      if (risksBlock) {
        expect(risksBlock.warnings).toBeDefined();
        expect(Array.isArray(risksBlock.warnings)).toBe(true);
      }
    });

    it("should return next_steps block with factors breakdown", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const nextStepsBlock = body.blocks.find((b: any) => b.type === "next_steps");

      expect(nextStepsBlock).toBeDefined();
      expect(nextStepsBlock.level).toBeDefined();
      expect(nextStepsBlock.score).toBeDefined();
      expect(nextStepsBlock.factors).toBeDefined();
      expect(nextStepsBlock.factors.completeness).toBeDefined();
      expect(nextStepsBlock.factors.structure).toBeDefined();
      expect(nextStepsBlock.factors.evidence).toBeDefined();
      expect(nextStepsBlock.factors.bias_risk).toBeDefined();
    });

    it("should mark all blocks as placeholder (M1)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      for (const block of body.blocks) {
        expect(block.placeholder).toBe(true);
      }
    });
  });

  describe("Robustness block", () => {
    it("should return robustness block with status 'requires_run' when no robustness data", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const robustnessBlock = body.blocks.find((b: any) => b.type === "robustness");

      expect(robustnessBlock).toBeDefined();
      expect(robustnessBlock.id).toBe("robustness");
      expect(robustnessBlock.status).toBe("requires_run");
      expect(robustnessBlock.status_reason).toBeDefined();
    });

    it("should return computed robustness block when ISL data is provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          ...validRequest,
          robustness: {
            status: "computed",
            overall_score: 0.75,
            confidence: 0.85,
            sensitivities: [
              {
                node_id: "factor_1",
                label: "Market Competition",
                sensitivity_score: 0.9,
                classification: "high", // High sensitivity to generate findings
                description: "Highly sensitive to market competition",
              },
            ],
            prediction_intervals: [
              {
                node_id: "goal_1",
                lower_bound: 0.5,
                upper_bound: 0.9,
                confidence_level: 0.9,
                well_calibrated: false, // Not well calibrated to generate findings
              },
            ],
            critical_assumptions: [
              {
                node_id: "factor_1",
                label: "Market stability",
                impact: 0.9, // High impact to generate findings
                recommendation: "Validate market conditions",
              },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const robustnessBlock = body.blocks.find((b: any) => b.type === "robustness");

      expect(robustnessBlock).toBeDefined();
      expect(robustnessBlock.status).toBe("computed");
      expect(robustnessBlock.overall_score).toBe(0.75);
      expect(robustnessBlock.confidence).toBe(0.85);
      expect(robustnessBlock.findings).toBeDefined();
      expect(robustnessBlock.findings.length).toBeGreaterThan(0);
      expect(robustnessBlock.summary).toBeDefined();
    });

    it("should return cannot_compute when ISL failed", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          ...validRequest,
          robustness: {
            status: "failed",
            status_reason: "ISL engine timeout",
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const robustnessBlock = body.blocks.find((b: any) => b.type === "robustness");

      expect(robustnessBlock).toBeDefined();
      expect(robustnessBlock.status).toBe("cannot_compute");
      expect(robustnessBlock.status_reason).toContain("ISL engine timeout");
    });

    it("should return degraded when ISL degraded", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          ...validRequest,
          robustness: {
            status: "degraded",
            status_reason: "Partial sensitivity analysis",
            overall_score: 0.6,
            sensitivities: [
              {
                node_id: "factor_1",
                label: "Market Competition",
                sensitivity_score: 0.2,
                classification: "low",
                description: "Low sensitivity",
              },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const robustnessBlock = body.blocks.find((b: any) => b.type === "robustness");

      expect(robustnessBlock).toBeDefined();
      expect(robustnessBlock.status).toBe("degraded");
      expect(robustnessBlock.overall_score).toBe(0.6);
      // Findings may be undefined for degraded status (partial data)
      expect(robustnessBlock.status_reason).toContain("Partial sensitivity analysis");
    });

    it("should never fail overall review when robustness is missing", async () => {
      // Even with invalid robustness data, the review should succeed
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          ...validRequest,
          robustness: {
            status: "not_run",
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.readiness).toBeDefined();
      expect(body.blocks).toBeDefined();

      const robustnessBlock = body.blocks.find((b: any) => b.type === "robustness");
      expect(robustnessBlock).toBeDefined();
      expect(robustnessBlock.status).toBe("requires_run");
    });
  });

  describe("Graph with issues", () => {
    it("should detect orphan nodes", async () => {
      const graphWithOrphans = {
        ...validGraph,
        nodes: [
          ...validGraph.nodes,
          { id: "orphan_1", kind: "factor", label: "Orphan Factor" },
        ],
      };

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          brief: validRequest.brief,
          graph: graphWithOrphans,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const risksBlock = body.blocks.find((b: any) => b.type === "risks");

      if (risksBlock) {
        const orphanWarning = risksBlock.warnings.find(
          (w: any) => w.type === "orphan_nodes"
        );
        expect(orphanWarning).toBeDefined();
      }
    });

    it("should detect missing goal in incomplete graph", async () => {
      const incompleteGraph = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Some Decision" },
          { id: "option_1", kind: "option", label: "Option A" },
        ],
        edges: [{ from: "option_1", to: "decision_1", belief: 0.5 }],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: {
          "content-type": "application/json",
          "x-olumi-assist-key": "test-key",
        },
        payload: {
          brief: validRequest.brief,
          graph: incompleteGraph,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const risksBlock = body.blocks.find((b: any) => b.type === "risks");

      if (risksBlock) {
        const missingGoalWarning = risksBlock.warnings.find(
          (w: any) => w.type === "missing_goal"
        );
        expect(missingGoalWarning).toBeDefined();
      }
    });
  });
});
