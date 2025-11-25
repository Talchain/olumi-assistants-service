/**
 * CEE v1 Bias Check Integration Tests
 *
 * Exercises POST /assist/v1/bias-check and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";

describe("POST /assist/v1/bias-check (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-bias-key-1,cee-bias-key-2,cee-bias-key-rate");
    vi.stubEnv("CEE_BIAS_CHECK_FEATURE_VERSION", "bias-check-test");
    vi.stubEnv("CEE_BIAS_CHECK_RATE_LIMIT_RPM", "2");

    delete process.env.BASE_URL;
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "cee-bias-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "cee-bias-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "cee-bias-key-rate" } as const;

  function makeGraph() {
    return {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "opt_a", kind: "option", label: "Premium pricing" },
      ],
      edges: [],
      meta: { roots: ["goal"], leaves: ["opt_a"], suggested_positions: {}, source: "assistant" },
    };
  }

  it("returns CEEBiasCheckResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: headersKey1,
      payload: {
        graph: makeGraph(),
        archetype: { decision_type: "pricing_decision", match: "exact", confidence: 0.9 },
      },
    });

    expect(res.statusCode).toBe(200);

    // Headers
    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBe("bias-check-test");
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    // Trace metadata
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
    expect(body.trace.correlation_id).toBe(ceeRequestId);

    // Quality meta
    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
    expect(body.quality.overall).toBeGreaterThanOrEqual(1);
    expect(body.quality.overall).toBeLessThanOrEqual(10);

    // Bias findings and limits
    expect(Array.isArray(body.bias_findings)).toBe(true);
    expect(body.response_limits).toEqual({
      bias_findings_max: 10,
      bias_findings_truncated: false,
    });
  });

  it("orders bias_findings deterministically and accepts optional seed", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "g1", kind: "goal", label: "Increase revenue" },
        { id: "opt1", kind: "option", label: "Premium pricing" },
        { id: "opt2", kind: "option", label: "Discount pricing" },
      ],
      edges: [],
      meta: { roots: ["g1"], leaves: ["opt1", "opt2"], suggested_positions: {}, source: "assistant" },
    };

    const payload = {
      graph,
      archetype: { decision_type: "pricing_decision", match: "exact", confidence: 0.9 },
      seed: "cee-bias-seed-1",
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: headersKey1,
      payload,
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();

    expect(Array.isArray(body.bias_findings)).toBe(true);

    const ids = body.bias_findings.map((f: any) => f.id);

    // With this graph and archetype we expect measurement, optimisation, then framing biases.
    expect(ids).toEqual([
      "measurement_missing_risks_or_outcomes",
      "optimisation_pricing_no_risks",
      "framing_single_goal_no_risks",
    ]);
  });

  it("emits structural confirmation bias with enrichment when CEE_BIAS_STRUCTURAL_ENABLED is true", async () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal", kind: "goal", label: "Increase revenue" },
          { id: "opt_a", kind: "option", label: "Path A" },
          { id: "opt_b", kind: "option", label: "Path B" },
          { id: "r1", kind: "risk", label: "Risk for A" },
        ],
        edges: [{ from: "opt_a", to: "r1" }],
        meta: {
          roots: ["goal"],
          leaves: ["opt_a", "opt_b"],
          suggested_positions: {},
          source: "assistant",
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/bias-check",
        headers: headersKey2,
        payload: { graph },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      const confirmation = body.bias_findings.find(
        (f: any) => f.code === "CONFIRMATION_BIAS",
      );

      expect(confirmation).toBeDefined();
      expect(confirmation.node_ids).toEqual(expect.arrayContaining(["opt_a", "opt_b"]));
      expect(typeof confirmation.mechanism).toBe("string");
      expect(typeof confirmation.citation).toBe("string");
      const steps = confirmation.micro_intervention?.steps ?? [];
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("returns CEE_VALIDATION_FAILED for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: headersKey2,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
    expect(body.trace).toBeDefined();
  });

  it("enforces per-feature rate limiting with CEE_RATE_LIMIT", async () => {
    const payload = {
      graph: makeGraph(),
    };

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: headersRate,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: headersRate,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: headersRate,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const body = limited.json();

    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_RATE_LIMIT");
    expect(body.retryable).toBe(true);
    expect(body.details?.retry_after_seconds).toBeGreaterThan(0);

    const retryAfter = limited.headers["retry-after"];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});
