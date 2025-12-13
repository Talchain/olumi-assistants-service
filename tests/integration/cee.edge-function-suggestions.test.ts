/**
 * CEE v1 Edge Function Suggestions Integration Tests
 *
 * Exercises POST /assist/v1/suggest-edge-function and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/suggest-edge-function (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Use unique keys for each test category to avoid rate limit interference
    vi.stubEnv("ASSIST_API_KEYS", "edge-fn-key-1,edge-fn-key-2,edge-fn-key-rate,edge-fn-key-val1,edge-fn-key-val2,edge-fn-key-val3,edge-fn-key-val4,edge-fn-key-det1,edge-fn-key-det2");
    // Rate limit set to 3 - rate limit test uses headersRate key
    // Other tests use unique keys to avoid interference
    vi.stubEnv("CEE_EDGE_FUNCTION_RATE_LIMIT_RPM", "3");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "edge-fn-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "edge-fn-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "edge-fn-key-rate" } as const;
  const headersVal1 = { "X-Olumi-Assist-Key": "edge-fn-key-val1" } as const;
  const headersVal2 = { "X-Olumi-Assist-Key": "edge-fn-key-val2" } as const;
  const headersVal3 = { "X-Olumi-Assist-Key": "edge-fn-key-val3" } as const;
  const headersVal4 = { "X-Olumi-Assist-Key": "edge-fn-key-val4" } as const;
  const headersDet1 = { "X-Olumi-Assist-Key": "edge-fn-key-det1" } as const;
  const headersDet2 = { "X-Olumi-Assist-Key": "edge-fn-key-det2" } as const;

  function makeBasicInput() {
    return {
      edge_id: "e1",
      source_node: { id: "n1", label: "Marketing Budget", kind: "option" },
      target_node: { id: "n2", label: "Customer Acquisition", kind: "outcome" },
    };
  }

  function makeDiminishingReturnsInput() {
    return {
      edge_id: "e2",
      source_node: { id: "n1", label: "Investment", kind: "option" },
      target_node: { id: "n2", label: "Returns", kind: "outcome" },
      relationship_description: "Shows clear diminishing returns with saturation",
    };
  }

  function makeThresholdInput() {
    return {
      edge_id: "e3",
      source_node: { id: "n1", label: "Security Investment", kind: "option" },
      target_node: { id: "n2", label: "Compliance Status", kind: "outcome" },
      relationship_description: "Must meet minimum threshold to achieve compliance",
    };
  }

  function makeSCurveInput() {
    return {
      edge_id: "e4",
      source_node: { id: "n1", label: "User Adoption", kind: "option" },
      target_node: { id: "n2", label: "Network Value", kind: "outcome" },
      relationship_description: "Reaches a tipping point after critical mass",
    };
  }

  it("returns CEEEdgeFunctionSuggestionResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersKey1,
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBeDefined();
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    // Required fields from schema (note: edge_id is not echoed in response)
    expect(["linear", "diminishing_returns", "threshold", "s_curve"]).toContain(body.suggested_function);
    expect(typeof body.suggested_params).toBe("object");
    expect(["high", "medium", "low"]).toContain(body.confidence);
    expect(typeof body.reasoning).toBe("string");
    expect(body.provenance).toBe("cee");
    expect(Array.isArray(body.alternatives)).toBe(true);

    // trace is required
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
  });

  it("suggests diminishing_returns for appropriate keywords", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersKey1,
      payload: makeDiminishingReturnsInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.suggested_function).toBe("diminishing_returns");
    expect(body.confidence).toBe("high");
    expect(body.suggested_params).toEqual({ k: 2.0 });
  });

  it("suggests threshold for appropriate keywords", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersKey2,
      payload: makeThresholdInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.suggested_function).toBe("threshold");
    expect(body.suggested_params).toEqual({ threshold: 0.5, slope: 1.0 });
  });

  it("suggests s_curve for tipping point patterns", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersKey1,
      payload: makeSCurveInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.suggested_function).toBe("s_curve");
    expect(body.suggested_params).toEqual({ k: 5.0, midpoint: 0.5 });
  });

  it("provides alternatives for low-confidence suggestions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersKey2,
      payload: {
        edge_id: "e5",
        // Use node kinds without signals to get linear default
        source_node: { id: "n1", label: "X", kind: "unknown" },
        target_node: { id: "n2", label: "Y", kind: "unknown" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.suggested_function).toBe("linear");
    expect(body.confidence).toBe("low");
    expect(body.alternatives.length).toBeGreaterThan(0);

    // Verify alternative structure - now includes new function types
    for (const alt of body.alternatives) {
      expect([
        "linear",
        "diminishing_returns",
        "threshold",
        "s_curve",
        "noisy_or",
        "noisy_and_not",
        "logistic",
      ]).toContain(alt.function_type);
      expect(typeof alt.params).toBe("object");
      expect(typeof alt.reasoning).toBe("string");
    }
  });

  it("returns CEE_VALIDATION_FAILED for missing edge_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersVal1,
      payload: {
        source_node: { id: "n1", label: "A", kind: "option" },
        target_node: { id: "n2", label: "B", kind: "outcome" },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
  });

  it("returns CEE_VALIDATION_FAILED for missing source_node", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersVal2,
      payload: {
        edge_id: "e1",
        target_node: { id: "n2", label: "B", kind: "outcome" },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
  });

  it("returns CEE_VALIDATION_FAILED for missing target_node", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersVal3,
      payload: {
        edge_id: "e1",
        source_node: { id: "n1", label: "A", kind: "option" },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
  });

  it("returns CEE_VALIDATION_FAILED for invalid node structure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersVal4,
      payload: {
        edge_id: "e1",
        source_node: { id: "n1", label: "A" }, // missing kind
        target_node: { id: "n2", label: "B", kind: "outcome" },
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
        url: "/assist/v1/suggest-edge-function",
        headers: headersRate,
        payload: makeBasicInput(),
      });
      expect(res.statusCode).toBe(200);
    }

    // 4th request should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersRate,
      payload: makeBasicInput(),
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
      url: "/assist/v1/suggest-edge-function",
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(401);
  });

  it("is deterministic - same input produces same output", async () => {
    const input = makeBasicInput();

    const res1 = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersDet1,
      payload: input,
    });

    const res2 = await app.inject({
      method: "POST",
      url: "/assist/v1/suggest-edge-function",
      headers: headersDet2,
      payload: input,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = res1.json();
    const body2 = res2.json();

    // Same input should produce same suggestion
    expect(body1.suggested_function).toBe(body2.suggested_function);
    expect(body1.suggested_params).toEqual(body2.suggested_params);
    expect(body1.confidence).toBe(body2.confidence);
  });
});
