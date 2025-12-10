/**
 * CEE v1 Generate Recommendation Integration Tests
 *
 * Exercises POST /assist/v1/generate-recommendation and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/generate-recommendation (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "gen-rec-key-1,gen-rec-key-2,gen-rec-key-rate,gen-rec-key-val1,gen-rec-key-val2");
    vi.stubEnv("CEE_GENERATE_RECOMMENDATION_RATE_LIMIT_RPM", "3");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "gen-rec-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "gen-rec-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "gen-rec-key-rate" } as const;
  const headersVal1 = { "X-Olumi-Assist-Key": "gen-rec-key-val1" } as const;
  const headersVal2 = { "X-Olumi-Assist-Key": "gen-rec-key-val2" } as const;

  function makeBasicInput() {
    return {
      ranked_actions: [
        { node_id: "opt_a", label: "Expand to EU market", score: 85, rank: 1 },
        { node_id: "opt_b", label: "Focus on US market", score: 70, rank: 2 },
        { node_id: "opt_c", label: "Partner with local distributors", score: 55, rank: 3 },
      ],
      goal_label: "Increase market share",
    };
  }

  function makeSingleOptionInput() {
    return {
      ranked_actions: [
        { node_id: "opt_a", label: "Only option available", score: 75, rank: 1 },
      ],
    };
  }

  function makeCloseCallInput() {
    return {
      ranked_actions: [
        { node_id: "opt_a", label: "Option A", score: 72, rank: 1 },
        { node_id: "opt_b", label: "Option B", score: 70, rank: 2 },
      ],
    };
  }

  it("returns CEEGenerateRecommendationResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersKey1,
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBeDefined();
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    // Required fields from schema
    expect(typeof body.headline).toBe("string");
    expect(body.headline.length).toBeGreaterThan(0);

    expect(typeof body.recommendation_narrative).toBe("string");
    expect(body.recommendation_narrative.length).toBeGreaterThan(0);

    expect(typeof body.confidence_statement).toBe("string");
    expect(body.confidence_statement.length).toBeGreaterThan(0);

    // Optional fields
    if (body.alternatives_summary) {
      expect(typeof body.alternatives_summary).toBe("string");
    }

    // Verify no question marks in output
    expect(body.headline).not.toContain("?");
    expect(body.recommendation_narrative).not.toContain("?");

    // provenance is required
    expect(body.provenance).toBe("cee");

    // trace and quality are required
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
  });

  it("handles single option gracefully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersKey2,
      payload: makeSingleOptionInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body.headline).toBe("string");
    expect(body.alternatives_summary).toBeUndefined();
  });

  it("provides caveat for close calls", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersKey1,
      payload: makeCloseCallInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Close call (score gap < 5) should include a caveat
    expect(body.caveat).toBeDefined();
    expect(typeof body.caveat).toBe("string");
  });

  it("supports conversational tone", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersKey2,
      payload: {
        ...makeBasicInput(),
        tone: "conversational",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body.headline).toBe("string");
    // Conversational tone should use different language
    expect(body.provenance).toBe("cee");
  });

  it("returns CEE_VALIDATION_FAILED for missing ranked_actions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersVal1,
      payload: {
        goal_label: "Some goal",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
  });

  it("returns CEE_VALIDATION_FAILED for empty ranked_actions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersVal2,
      payload: {
        ranked_actions: [],
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
        url: "/assist/v1/generate-recommendation",
        headers: headersRate,
        payload: makeBasicInput(),
      });
      expect(res.statusCode).toBe(200);
    }

    // 4th request should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
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
      url: "/assist/v1/generate-recommendation",
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(401);
  });

  it("is deterministic - same input produces same output", async () => {
    const input = makeBasicInput();

    const res1 = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersKey1,
      payload: input,
    });

    const res2 = await app.inject({
      method: "POST",
      url: "/assist/v1/generate-recommendation",
      headers: headersKey2,
      payload: input,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = res1.json();
    const body2 = res2.json();

    // Same input should produce same narrative
    expect(body1.headline).toBe(body2.headline);
    expect(body1.recommendation_narrative).toBe(body2.recommendation_narrative);
    expect(body1.confidence_statement).toBe(body2.confidence_statement);
  });
});
