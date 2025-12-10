/**
 * CEE v1 Explain Policy Integration Tests
 *
 * Exercises POST /assist/v1/explain-policy and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/explain-policy (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "exp-pol-key-1,exp-pol-key-2,exp-pol-key-rate,exp-pol-key-val1,exp-pol-key-val2");
    vi.stubEnv("CEE_EXPLAIN_POLICY_RATE_LIMIT_RPM", "3");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "exp-pol-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "exp-pol-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "exp-pol-key-rate" } as const;
  const headersVal1 = { "X-Olumi-Assist-Key": "exp-pol-key-val1" } as const;
  const headersVal2 = { "X-Olumi-Assist-Key": "exp-pol-key-val2" } as const;

  function makeBasicInput() {
    return {
      policy_steps: [
        { step_number: 1, action: "Assess market readiness", rationale: "Understand the landscape" },
        { step_number: 2, action: "Develop partnership strategy", rationale: "Build local relationships" },
        { step_number: 3, action: "Launch pilot program", rationale: "Test the market" },
      ],
      goal_label: "Expand to EU market",
    };
  }

  function makeSingleStepInput() {
    return {
      policy_steps: [
        { step_number: 1, action: "Execute the plan" },
      ],
    };
  }

  function makeStepsWithDependencies() {
    return {
      policy_steps: [
        { step_number: 1, action: "Gather requirements" },
        { step_number: 2, action: "Design solution", depends_on: ["step_1"] },
        { step_number: 3, action: "Implement solution", depends_on: ["step_2"] },
        { step_number: 4, action: "Deploy and monitor", depends_on: ["step_3"] },
      ],
      goal_label: "Deliver new feature",
    };
  }

  it("returns CEEExplainPolicyResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
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
    expect(typeof body.policy_narrative).toBe("string");
    expect(body.policy_narrative.length).toBeGreaterThan(0);

    expect(Array.isArray(body.steps_explained)).toBe(true);
    expect(body.steps_explained.length).toBe(3);

    // Verify steps_explained structure
    for (const step of body.steps_explained) {
      expect(typeof step.step).toBe("number");
      expect(typeof step.action).toBe("string");
      expect(typeof step.explanation).toBe("string");
    }

    // Verify narrative uses sequence connectors
    expect(body.policy_narrative.toLowerCase()).toContain("first");

    // provenance is required
    expect(body.provenance).toBe("cee");

    // trace and quality are required
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
  });

  it("handles single step gracefully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
      headers: headersKey2,
      payload: makeSingleStepInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.steps_explained.length).toBe(1);
    expect(body.policy_narrative).toBeDefined();
  });

  it("explains dependencies when present", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
      headers: headersKey1,
      payload: makeStepsWithDependencies(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.steps_explained.length).toBe(4);
    expect(body.dependencies_explained).toBeDefined();
    expect(typeof body.dependencies_explained).toBe("string");
  });

  it("includes goal in narrative when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
      headers: headersKey2,
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Goal should be referenced in narrative
    expect(body.policy_narrative.toLowerCase()).toContain("achieve");
  });

  it("returns CEE_VALIDATION_FAILED for missing policy_steps", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
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

  it("returns CEE_VALIDATION_FAILED for empty policy_steps", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
      headers: headersVal2,
      payload: {
        policy_steps: [],
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
        url: "/assist/v1/explain-policy",
        headers: headersRate,
        payload: makeBasicInput(),
      });
      expect(res.statusCode).toBe(200);
    }

    // 4th request should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
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
      url: "/assist/v1/explain-policy",
      payload: makeBasicInput(),
    });

    expect(res.statusCode).toBe(401);
  });

  it("is deterministic - same input produces same output", async () => {
    const input = makeBasicInput();

    const res1 = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
      headers: headersKey1,
      payload: input,
    });

    const res2 = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-policy",
      headers: headersKey2,
      payload: input,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = res1.json();
    const body2 = res2.json();

    // Same input should produce same narrative
    expect(body1.policy_narrative).toBe(body2.policy_narrative);
    expect(body1.steps_explained).toEqual(body2.steps_explained);
  });
});
