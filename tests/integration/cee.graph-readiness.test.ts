/**
 * CEE v1 Graph Readiness Integration Tests
 *
 * Exercises POST /assist/v1/graph-readiness and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { emit, TelemetryEvents } from "../../src/utils/telemetry.js";

describe("POST /assist/v1/graph-readiness (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "readiness-key-1,readiness-key-2,readiness-key-rate,readiness-key-alt,readiness-key-min");
    vi.stubEnv("CEE_GRAPH_READINESS_RATE_LIMIT_RPM", "3");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "readiness-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "readiness-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "readiness-key-rate" } as const;
  const headersAlt = { "X-Olumi-Assist-Key": "readiness-key-alt" } as const;
  const headersMin = { "X-Olumi-Assist-Key": "readiness-key-min" } as const;

  function makeGraph() {
    return {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "decision", kind: "decision", label: "Pricing strategy" },
        { id: "opt_a", kind: "option", label: "Premium pricing" },
        { id: "opt_b", kind: "option", label: "Volume pricing" },
        { id: "outcome_1", kind: "outcome", label: "Higher margins" },
        { id: "outcome_2", kind: "outcome", label: "Market share growth" },
        { id: "risk_1", kind: "risk", label: "Customer churn" },
      ],
      edges: [
        { id: "e1", from: "decision", to: "opt_a" },
        { id: "e2", from: "decision", to: "opt_b" },
        { id: "e3", from: "opt_a", to: "outcome_1" },
        { id: "e4", from: "opt_b", to: "outcome_2" },
        { id: "e5", from: "opt_a", to: "risk_1" },
      ],
      meta: { roots: ["goal"], leaves: ["outcome_1", "outcome_2", "risk_1"], suggested_positions: {}, source: "assistant" },
    };
  }

  function makeMinimalGraph() {
    return {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "goal", kind: "goal", label: "Test goal" },
      ],
      edges: [],
      meta: { roots: ["goal"], leaves: ["goal"], suggested_positions: {}, source: "assistant" },
    };
  }

  it("returns CEEGraphReadinessResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey1,
      payload: {
        graph: makeGraph(),
      },
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBeDefined();
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    // Required fields from schema
    expect(typeof body.readiness_score).toBe("number");
    expect(body.readiness_score).toBeGreaterThanOrEqual(0);
    expect(body.readiness_score).toBeLessThanOrEqual(100);

    expect(["ready", "fair", "needs_work"]).toContain(body.readiness_level);
    expect(["high", "medium", "low"]).toContain(body.confidence_level);
    expect(typeof body.confidence_explanation).toBe("string");

    expect(Array.isArray(body.quality_factors)).toBe(true);
    expect(body.quality_factors.length).toBeGreaterThan(0);

    for (const factor of body.quality_factors) {
      expect(["causal_detail", "weight_refinement", "risk_coverage", "outcome_balance", "option_diversity", "goal_outcome_linkage"])
        .toContain(factor.factor);
      expect(typeof factor.current_score).toBe("number");
      expect(["high", "medium", "low"]).toContain(factor.impact);
      expect(typeof factor.recommendation).toBe("string");
      expect(typeof factor.potential_improvement).toBe("number");
    }

    expect(typeof body.can_run_analysis).toBe("boolean");

    // trace is required
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
  });

  it("returns 'needs_work' for minimal graph", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey2,
      payload: {
        graph: makeMinimalGraph(),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Minimal graph should score low
    expect(body.readiness_level).toBe("needs_work");
    expect(body.readiness_score).toBeLessThan(50);
  });

  it("returns CEE_VALIDATION_FAILED for missing graph", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey1,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
  });

  it("returns CEE_VALIDATION_FAILED for invalid graph", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey1,
      payload: {
        graph: { invalid: true },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
  });

  it("enforces per-feature rate limit", async () => {
    // First 3 requests should succeed (RPM=3)
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/graph-readiness",
        headers: headersRate,
        payload: { graph: makeGraph() },
      });
      expect(res.statusCode).toBe(200);
    }

    // 4th request should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersRate,
      payload: { graph: makeGraph() },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();

    expect(body.code).toBe("CEE_RATE_LIMIT");
    expect(body.retryable).toBe(true);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("returns 401 for missing auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      payload: { graph: makeGraph() },
    });

    expect(res.statusCode).toBe(401);
  });

  it("accepts edges with source/target format (graph library compatibility)", async () => {
    // Many graph libraries (D3, Cytoscape, vis.js) use source/target instead of from/to
    const graphWithSourceTarget = {
      nodes: [
        { id: "goal", kind: "goal", label: "Test goal" },
        { id: "decision", kind: "decision", label: "Test decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
      ],
      edges: [
        { id: "e1", source: "decision", target: "opt_a" },
      ],
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersAlt,
      payload: { graph: graphWithSourceTarget },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body.readiness_score).toBe("number");
    expect(["ready", "fair", "needs_work"]).toContain(body.readiness_level);
  });

  it("emits total_factor_count, user_question_count, and deprecated factor_count in telemetry and response", async () => {
    // Build a graph with exactly 4 factor nodes
    const graphWith4Factors = {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "decision", kind: "decision", label: "Pricing" },
        { id: "opt_a", kind: "option", label: "Premium" },
        { id: "fac_price", kind: "factor", label: "Price", category: "controllable", data: { value: 100 } },
        { id: "fac_quality", kind: "factor", label: "Quality", category: "controllable", data: { value: 0.8 } },
        { id: "fac_demand", kind: "factor", label: "Demand", category: "observable", data: { value: 500 } },
        { id: "fac_competition", kind: "factor", label: "Competition", category: "external", data: { value: 0.5 } },
        { id: "outcome_1", kind: "outcome", label: "Revenue" },
      ],
      edges: [
        { id: "e1", from: "decision", to: "opt_a" },
        { id: "e2", from: "opt_a", to: "outcome_1" },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    };

    const emitSpy = vi.spyOn(await import("../../src/utils/telemetry.js"), "emit");

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersAlt,
      payload: { graph: graphWith4Factors },
    });

    expect(res.statusCode).toBe(200);

    // Telemetry: verify emit payload
    const completedCall = emitSpy.mock.calls.find(
      (call) => call[0] === TelemetryEvents.CeeGraphReadinessCompleted,
    );
    expect(completedCall).toBeDefined();

    const eventData = completedCall![1] as any;
    expect(eventData.total_factor_count).toBe(4);
    expect(typeof eventData.user_question_count).toBe("number");
    expect(typeof eventData.factor_count).toBe("number");

    // Response payload: verify all three factor count fields
    const body = res.json();
    expect(body.total_factor_count).toBe(4);
    expect(typeof body.user_question_count).toBe("number");
    expect(typeof body.factor_count).toBe("number");

    emitSpy.mockRestore();
  });

  it("accepts minimal graph without version/default_seed/meta (uses defaults)", async () => {
    // Simpler requests - only nodes and edges required
    const minimalGraph = {
      nodes: [
        { id: "goal", kind: "goal", label: "Simple goal" },
        { id: "opt", kind: "option", label: "Simple option" },
      ],
      edges: [
        { id: "e1", from: "goal", to: "opt" },
      ],
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersMin,
      payload: { graph: minimalGraph },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body.readiness_score).toBe("number");
    expect(["ready", "fair", "needs_work"]).toContain(body.readiness_level);
  });
});
