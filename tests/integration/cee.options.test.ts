/**
 * CEE v1 Options Integration Tests
 *
 * Exercises POST /assist/v1/options and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";

describe("POST /assist/v1/options (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-options-key-1,cee-options-key-2,cee-options-key-rate");
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-test");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "2");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "cee-options-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "cee-options-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "cee-options-key-rate" } as const;

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

  it("returns CEEOptionsResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: headersKey1,
      payload: {
        graph: makeGraph(),
        archetype: { decision_type: "pricing_decision", match: "exact", confidence: 0.9 },
      },
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBe("options-test");
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);

    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
    expect(body.quality.overall).toBeGreaterThanOrEqual(1);
    expect(body.quality.overall).toBeLessThanOrEqual(10);

    expect(Array.isArray(body.options)).toBe(true);
    expect(body.options.length).toBeGreaterThan(0);

    expect(body.response_limits).toEqual({
      options_max: 6,
      options_truncated: false,
    });

    // Guidance block should be present and derived from quality/limits
    expect(body.guidance).toBeDefined();
    expect(typeof body.guidance.summary).toBe("string");
  });

  it("returns CEE_VALIDATION_FAILED for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
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
      url: "/assist/v1/options",
      headers: headersRate,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: headersRate,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
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
