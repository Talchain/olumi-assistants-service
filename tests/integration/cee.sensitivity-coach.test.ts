/**
 * CEE v1 Sensitivity Coach Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";

describe("POST /assist/v1/sensitivity-coach (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv(
      "ASSIST_API_KEYS",
      ["cee-sensitivity-key-1", "cee-sensitivity-key-2", "cee-sensitivity-key-rate"].join(","),
    );
    vi.stubEnv("CEE_SENSITIVITY_COACH_FEATURE_VERSION", "sensitivity-coach-test");
    vi.stubEnv("CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM", "2");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "cee-sensitivity-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "cee-sensitivity-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "cee-sensitivity-key-rate" } as const;

  function makeGraph() {
    return {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "driver", kind: "option", label: "Premium pricing" },
      ],
      edges: [],
      meta: { roots: ["goal"], leaves: ["driver"], suggested_positions: {}, source: "assistant" },
    };
  }

  function makeInference() {
    return {
      summary: "Telemetry explain summary",
      explain: {
        top_drivers: [{ node_id: "driver", description: "Premium pricing", contribution: 0.9 }],
      },
      seed: "seed-telemetry-explain",
      response_hash: "hash-telemetry-explain",
    };
  }

  it("returns CEESensitivityCoachResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers: headersKey1,
      payload: {
        graph: makeGraph(),
        inference: makeInference(),
      },
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBe("sensitivity-coach-test");
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);

    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
    expect(body.quality.overall).toBeGreaterThanOrEqual(1);
    expect(body.quality.overall).toBeLessThanOrEqual(10);

    expect(Array.isArray(body.sensitivity_suggestions)).toBe(true);
    expect(body.sensitivity_suggestions.length).toBeGreaterThan(0);

    expect(body.response_limits).toEqual({
      sensitivity_suggestions_max: 10,
      sensitivity_suggestions_truncated: false,
    });
  });

  it("returns CEE_VALIDATION_FAILED for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
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
      inference: makeInference(),
    };

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers: headersRate,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers: headersRate,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
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
