/**
 * CEE v1 Decision Review Integration Tests (M2 Schema)
 *
 * Exercises POST /assist/v1/decision-review using fixtures adapter
 * and verifies CEE response structure, feature flags, and rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic responses and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Enable the decision review feature
vi.stubEnv("CEE_DECISION_REVIEW_ENABLED", "true");

// Set rate limit for testing
vi.stubEnv("CEE_DECISION_REVIEW_RATE_LIMIT_RPM", "5");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/decision-review (M2 Schema)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Allow multiple API keys so tests can use independent rate limit buckets
    // - review-key-success: success scenarios (4 tests)
    // - review-key-validation: validation error scenarios (9 tests)
    // - review-key-rate-limit: rate limit test (6 requests)
    vi.stubEnv(
      "ASSIST_API_KEYS",
      "review-key-success,review-key-validation,review-key-rate-limit"
    );
    // Increase rate limit so each bucket can handle its test count
    vi.stubEnv("CEE_DECISION_REVIEW_RATE_LIMIT_RPM", "15");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  // Separate keys for each test group to avoid rate limit conflicts
  const headersSuccess = {
    "X-Olumi-Assist-Key": "review-key-success",
  } as const;

  const headersValidation = {
    "X-Olumi-Assist-Key": "review-key-validation",
  } as const;

  const headersRateLimit = {
    "X-Olumi-Assist-Key": "review-key-rate-limit",
  } as const;

  // M2 deterministic package payload
  const validM2Payload = {
    brief: "Should we expand to the UK or Germany market first?",
    brief_hash: "abc123def456",
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "European Expansion Success" },
        { id: "option_uk", kind: "option", label: "UK Expansion" },
        { id: "option_de", kind: "option", label: "Germany Expansion" },
        { id: "factor_timing", kind: "factor", label: "Market Timing" },
      ],
      edges: [
        { id: "e1", from: "option_uk", to: "goal_1", strength: 0.8 },
        { id: "e2", from: "option_de", to: "goal_1", strength: 0.65 },
        { id: "e3", from: "factor_timing", to: "option_uk", strength: 0.7 },
      ],
    },
    isl_results: {
      option_comparison: [
        { option_id: "option_uk", win_prob: 0.65, expected_value: 0.72 },
        { option_id: "option_de", win_prob: 0.35, expected_value: 0.58 },
      ],
      factor_sensitivity: [
        { factor_id: "factor_timing", elasticity: 0.45, voi: 0.28 },
      ],
      fragile_edges: [
        {
          edge_id: "e3",
          from_label: "Market Timing",
          to_label: "UK Expansion",
          switch_prob: 0.23,
        },
      ],
      robustness: { score: 0.72, classification: "moderate" },
    },
    deterministic_coaching: {
      readiness: "close_call",
      headline_type: "competitive",
      evidence_gaps: [
        {
          factor_id: "factor_timing",
          confidence: 0.35,
          voi: 0.28,
          label: "Market Timing",
        },
      ],
      model_critiques: [
        { code: "DOMINANT_FACTOR", factor_id: "factor_timing", elasticity: 0.45 },
      ],
    },
    winner: { id: "option_uk", label: "UK Expansion", win_probability: 0.65, outcome_mean: 0.72 },
    runner_up: { id: "option_de", label: "Germany Expansion", win_probability: 0.35, outcome_mean: 0.58 },
    flip_threshold_data: [
      {
        factor_id: "factor_timing",
        factor_label: "Market Timing",
        current_value: 0.72,
        flip_value: 0.45,
        direction: "decrease",
      },
    ],
  };

  describe("success scenarios", () => {
    it("returns 200 with M2 review response for valid request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersSuccess,
        payload: validM2Payload,
      });

      expect(res.statusCode).toBe(200);

      // Check CEE headers
      expect(res.headers["x-cee-api-version"]).toBe("v1");
      expect(res.headers["x-cee-feature-version"]).toBe("decision-review-2.0.0");
      const requestId = res.headers["x-cee-request-id"];
      expect(typeof requestId).toBe("string");
      expect((requestId as string).length).toBeGreaterThan(0);

      const body = res.json();

      // Check M2 review structure - required fields
      expect(body.review).toBeDefined();
      expect(typeof body.review.narrative_summary).toBe("string");
      expect(typeof body.review.story_headlines).toBe("object");
      expect(Object.keys(body.review.story_headlines).length).toBeGreaterThan(0);
      expect(typeof body.review.robustness_explanation).toBe("object");
      expect(typeof body.review.readiness_rationale).toBe("string");
      expect(typeof body.review.evidence_enhancements).toBe("object");
      expect(typeof body.review.scenario_contexts).toBe("object");
      expect(Array.isArray(body.review.bias_findings)).toBe(true);
      expect(Array.isArray(body.review.key_assumptions)).toBe(true);
      expect(Array.isArray(body.review.decision_quality_prompts)).toBe(true);

      // Check structural limits
      expect(body.review.bias_findings.length).toBeLessThanOrEqual(3);
      expect(body.review.key_assumptions.length).toBeLessThanOrEqual(5);
      expect(body.review.decision_quality_prompts.length).toBeLessThanOrEqual(3);

      // Check trace metadata includes brief_hash
      expect(body.trace).toBeDefined();
      expect(body.trace.request_id).toBe(requestId);
      expect(body.trace.brief_hash).toBe("abc123def456");

      // Check _meta
      expect(body._meta).toBeDefined();
      expect(typeof body._meta.model).toBe("string");
      expect(typeof body._meta.latency_ms).toBe("number");
      expect(body._meta.token_usage).toBeDefined();
    });

    it("uses correlation_id from request when provided", async () => {
      const correlationId = "test-correlation-id-m2-12345";
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersSuccess,
        payload: {
          ...validM2Payload,
          correlation_id: correlationId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.trace.correlation_id).toBe(correlationId);
    });

    it("accepts payload without flip_threshold_data", async () => {
      const payloadWithoutFlip = { ...validM2Payload };
      delete (payloadWithoutFlip as Record<string, unknown>).flip_threshold_data;

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersSuccess,
        payload: payloadWithoutFlip,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.review).toBeDefined();
    });

    it("accepts flip_threshold_data with null flip_value", async () => {
      const payloadWithNullFlip = {
        ...validM2Payload,
        flip_threshold_data: [
          {
            factor_id: "factor_timing",
            factor_label: "Market Timing",
            current_value: 0.72,
            flip_value: null,
            direction: "decrease",
            flip_reason: "no_crossover",
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersSuccess,
        payload: payloadWithNullFlip,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.review).toBeDefined();
    });

    it("includes optional pre_mortem when readiness allows", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersSuccess,
        payload: validM2Payload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // For close_call readiness with fragile_edges, pre_mortem should be present
      // (depends on mock response)
      if (body.review.pre_mortem) {
        expect(typeof body.review.pre_mortem).toBe("object");
        expect(typeof body.review.pre_mortem.failure_scenario).toBe("string");
      }
    });
  });

  describe("validation errors (M2 input schema)", () => {
    it("returns 400 for missing brief", async () => {
      const invalidPayload = { ...validM2Payload };
      delete (invalidPayload as Record<string, unknown>).brief;

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersValidation,
        payload: invalidPayload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 400 for missing brief_hash", async () => {
      const invalidPayload = { ...validM2Payload };
      delete (invalidPayload as Record<string, unknown>).brief_hash;

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersValidation,
        payload: invalidPayload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 400 for missing isl_results", async () => {
      const invalidPayload = { ...validM2Payload };
      delete (invalidPayload as Record<string, unknown>).isl_results;

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersValidation,
        payload: invalidPayload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 400 for missing deterministic_coaching", async () => {
      const invalidPayload = { ...validM2Payload };
      delete (invalidPayload as Record<string, unknown>).deterministic_coaching;

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersValidation,
        payload: invalidPayload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 400 for missing winner", async () => {
      const invalidPayload = { ...validM2Payload };
      delete (invalidPayload as Record<string, unknown>).winner;

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersValidation,
        payload: invalidPayload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 400 for missing runner_up", async () => {
      const invalidPayload = { ...validM2Payload };
      delete (invalidPayload as Record<string, unknown>).runner_up;

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersValidation,
        payload: invalidPayload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 401 for missing API key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        payload: validM2Payload,
      });

      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for invalid API key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: { "X-Olumi-Assist-Key": "invalid-key" },
        payload: validM2Payload,
      });

      expect(res.statusCode).toBe(403);
    });

    it("allows extra fields on input via passthrough", async () => {
      const payloadWithExtra = {
        ...validM2Payload,
        extra_field_from_plot: "this should not cause rejection",
        another_future_field: { nested: true },
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersValidation,
        payload: payloadWithExtra,
      });

      // Should succeed, not fail validation
      expect(res.statusCode).toBe(200);
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding rate limit", async () => {
      // Rate limit is 15 requests/min for this test suite
      // Exhaust rate limit (15 requests)
      for (let i = 0; i < 15; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/assist/v1/decision-review",
          headers: headersRateLimit,
          payload: validM2Payload,
        });
        expect(res.statusCode).toBe(200);
      }

      // Next request should be rate limited
      const limitedRes = await app.inject({
        method: "POST",
        url: "/assist/v1/decision-review",
        headers: headersRateLimit,
        payload: validM2Payload,
      });

      expect(limitedRes.statusCode).toBe(429);
      const body = limitedRes.json();

      expect(body.code).toBe("CEE_RATE_LIMIT");
      expect(body.message).toContain("rate limit exceeded");
      expect(limitedRes.headers["retry-after"]).toBeDefined();
    });
  });
});

describe("POST /assist/v1/decision-review (feature disabled)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Disable the feature flag
    vi.stubEnv("CEE_DECISION_REVIEW_ENABLED", "false");
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", "disabled-key");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("returns 503 when feature is disabled", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      headers: { "X-Olumi-Assist-Key": "disabled-key" },
      payload: {
        brief: "Test brief",
        brief_hash: "hash123",
        graph: { nodes: [], edges: [] },
        isl_results: {
          option_comparison: [],
          factor_sensitivity: [],
        },
        deterministic_coaching: {
          readiness: "ready",
          headline_type: "clear",
          evidence_gaps: [],
          model_critiques: [],
        },
        winner: { id: "opt1", label: "Option 1", win_probability: 0.6 },
        runner_up: { id: "opt2", label: "Option 2", win_probability: 0.4 },
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();

    expect(body.code).toBe("CEE_SERVICE_UNAVAILABLE");
    expect(body.message).toContain("not enabled");
  });
});

describe("POST /assist/v1/decision-review (include_raw gating)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("CEE_DECISION_REVIEW_ENABLED", "true");
    vi.stubEnv("CEE_OBSERVABILITY_RAW_IO", "false"); // Raw IO disabled
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", "raw-test-key");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const validPayload = {
    brief: "Test brief",
    brief_hash: "hash123",
    graph: { nodes: [{ id: "n1", kind: "goal" }], edges: [] },
    isl_results: {
      option_comparison: [],
      factor_sensitivity: [],
    },
    deterministic_coaching: {
      readiness: "ready",
      headline_type: "clear",
      evidence_gaps: [],
      model_critiques: [],
    },
    winner: { id: "opt1", label: "Option 1", win_probability: 0.6 },
    runner_up: { id: "opt2", label: "Option 2", win_probability: 0.4 },
  };

  it("does not include raw_llm_output when CEE_OBSERVABILITY_RAW_IO is false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      headers: { "X-Olumi-Assist-Key": "raw-test-key" },
      payload: {
        ...validPayload,
        config: { include_raw: true },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // raw_llm_output should NOT be present even though include_raw was requested
    expect(body._meta.raw_llm_output).toBeUndefined();
  });
});

describe("POST /assist/v1/decision-review (include_raw enabled)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("CEE_DECISION_REVIEW_ENABLED", "true");
    vi.stubEnv("CEE_OBSERVABILITY_RAW_IO", "true"); // Raw IO enabled
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", "raw-enabled-key");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const validPayload = {
    brief: "Test brief",
    brief_hash: "hash123",
    graph: { nodes: [{ id: "n1", kind: "goal" }], edges: [] },
    isl_results: {
      option_comparison: [],
      factor_sensitivity: [],
    },
    deterministic_coaching: {
      readiness: "ready",
      headline_type: "clear",
      evidence_gaps: [],
      model_critiques: [],
    },
    winner: { id: "opt1", label: "Option 1", win_probability: 0.6 },
    runner_up: { id: "opt2", label: "Option 2", win_probability: 0.4 },
  };

  it("includes raw_llm_output when CEE_OBSERVABILITY_RAW_IO is true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/decision-review",
      headers: { "X-Olumi-Assist-Key": "raw-enabled-key" },
      payload: {
        ...validPayload,
        config: { include_raw: true },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // raw_llm_output SHOULD be present
    expect(body._meta.raw_llm_output).toBeDefined();
    expect(typeof body._meta.raw_llm_output).toBe("string");
  });
});
