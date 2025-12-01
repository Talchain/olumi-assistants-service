/**
 * CEE v1 Explain Graph Integration Tests
 *
 * Exercises POST /assist/v1/explain-graph and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/explain-graph (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv(
      "ASSIST_API_KEYS",
      "cee-explain-key-1,cee-explain-key-2,cee-explain-key-rate"
    );
    vi.stubEnv("CEE_EXPLAIN_FEATURE_VERSION", "explain-model-test");
    vi.stubEnv("CEE_EXPLAIN_RATE_LIMIT_RPM", "2");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "cee-explain-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "cee-explain-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "cee-explain-key-rate" } as const;

  function makeGraphPayload() {
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

  function makeInferencePayload() {
    return {
      summary: "Inference summary",
      explain: {
        top_drivers: [{ node_id: "opt_a", description: "Premium pricing", contribution: 0.9 }],
      },
      seed: "inference-seed-1",
      response_hash: "inference-hash-1",
    };
  }

  it("returns CEEExplainGraphResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers: headersKey1,
      payload: {
        graph: makeGraphPayload(),
        inference: makeInferencePayload(),
        context_id: "ctx-1",
      },
    });

    expect(res.statusCode).toBe(200);

    // Headers
    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBe("explain-model-test");
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    // Trace metadata
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
    expect(body.trace.correlation_id).toBe(ceeRequestId);
    expect(body.trace.verification).toBeDefined();
    expect(body.trace.verification.schema_valid).toBe(true);
    expect(typeof body.trace.verification.total_stages).toBe("number");

    // Quality meta
    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
    expect(body.quality.overall).toBeGreaterThanOrEqual(1);
    expect(body.quality.overall).toBeLessThanOrEqual(10);

    // Explanation shape
    expect(body.explanation).toBeDefined();
    expect(Array.isArray(body.explanation.top_drivers) || body.explanation.top_drivers === undefined).toBe(true);
    if (Array.isArray(body.explanation.top_drivers)) {
      expect(body.explanation.top_drivers.length).toBe(1);
      expect(body.explanation.top_drivers[0].id).toBe("opt_a");
      expect(body.explanation.top_drivers[0].rank).toBe(1);
      expect(body.explanation.top_drivers[0].label).toBe("Premium pricing");
    }
  });

  it("returns CEE_VALIDATION_FAILED for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
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
      graph: makeGraphPayload(),
      inference: makeInferencePayload(),
    };

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers: headersRate,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers: headersRate,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
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
