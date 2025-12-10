/**
 * CEE v1 Narrate Conditions Integration Tests
 *
 * Exercises POST /assist/v1/narrate-conditions and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/narrate-conditions (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "narr-cond-key-1,narr-cond-key-2,narr-cond-key-rate,narr-cond-key-val1,narr-cond-key-val2");
    vi.stubEnv("CEE_NARRATE_CONDITIONS_RATE_LIMIT_RPM", "3");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "narr-cond-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "narr-cond-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "narr-cond-key-rate" } as const;
  const headersVal1 = { "X-Olumi-Assist-Key": "narr-cond-key-val1" } as const;
  const headersVal2 = { "X-Olumi-Assist-Key": "narr-cond-key-val2" } as const;

  function makeBasicInput() {
    return {
      conditions: [
        {
          condition_id: "cond_1",
          condition_label: "Budget exceeds $1M?",
          if_true: { recommendation: "Proceed with full implementation", confidence: 85 },
          if_false: { recommendation: "Start with pilot program", confidence: 70 },
        },
      ],
      primary_recommendation: "Expand to EU market",
    };
  }

  function makeMultiConditionInput() {
    return {
      conditions: [
        {
          condition_id: "cond_1",
          condition_label: "Budget exceeds $1M",
          if_true: { recommendation: "Full implementation", confidence: 85 },
          if_false: { recommendation: "Pilot program", confidence: 70 },
        },
        {
          condition_id: "cond_2",
          condition_label: "Team has capacity",
          if_true: { recommendation: "Start immediately", confidence: 80 },
          if_false: { recommendation: "Hire additional staff first", confidence: 65 },
        },
      ],
    };
  }

  it("returns CEENarrateConditionsResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
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
    expect(typeof body.narrative).toBe("string");
    expect(body.narrative.length).toBeGreaterThan(0);

    expect(Array.isArray(body.conditions_summary)).toBe(true);
    expect(body.conditions_summary.length).toBeGreaterThan(0);

    expect(Array.isArray(body.key_decision_points)).toBe(true);
    expect(body.key_decision_points.length).toBeGreaterThan(0);

    // Verify conditions_summary structure
    for (const summary of body.conditions_summary) {
      expect(typeof summary.condition).toBe("string");
      expect(typeof summary.if_true_action).toBe("string");
      expect(typeof summary.if_false_action).toBe("string");
    }

    // Verify no question marks in output (labels should be sanitised)
    expect(body.narrative).not.toContain("?");
    for (const summary of body.conditions_summary) {
      expect(summary.condition).not.toContain("?");
    }

    // provenance is required
    expect(body.provenance).toBe("cee");

    // trace and quality are required
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
  });

  it("handles multiple conditions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
      headers: headersKey2,
      payload: makeMultiConditionInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.conditions_summary.length).toBe(2);
    expect(body.key_decision_points.length).toBe(2);

    // Narrative should mention both conditions
    expect(body.narrative.toLowerCase()).toContain("if");
  });

  it("includes primary recommendation in narrative when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
      headers: headersKey1,
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Primary recommendation should be mentioned
    expect(body.narrative.toLowerCase()).toContain("recommendation");
  });

  it("returns CEE_VALIDATION_FAILED for missing conditions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
      headers: headersVal1,
      payload: {
        primary_recommendation: "Some recommendation",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
  });

  it("returns CEE_VALIDATION_FAILED for empty conditions", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
      headers: headersVal2,
      payload: {
        conditions: [],
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
        url: "/assist/v1/narrate-conditions",
        headers: headersRate,
        payload: makeBasicInput(),
      });
      expect(res.statusCode).toBe(200);
    }

    // 4th request should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
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
      url: "/assist/v1/narrate-conditions",
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(401);
  });

  it("is deterministic - same input produces same output", async () => {
    const input = makeBasicInput();

    const res1 = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
      headers: headersKey1,
      payload: input,
    });

    const res2 = await app.inject({
      method: "POST",
      url: "/assist/v1/narrate-conditions",
      headers: headersKey2,
      payload: input,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = res1.json();
    const body2 = res2.json();

    // Same input should produce same narrative
    expect(body1.narrative).toBe(body2.narrative);
    expect(body1.conditions_summary).toEqual(body2.conditions_summary);
    expect(body1.key_decision_points).toEqual(body2.key_decision_points);
  });
});
