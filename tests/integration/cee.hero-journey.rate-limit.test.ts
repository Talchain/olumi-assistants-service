/**
 * CEE v1 Hero Journey Integration Test (Mid-journey Rate Limit)
 *
 * Exercises a CEE journey where Draft and Options succeed but Evidence Helper
 * hits a per-feature rate limit, then builds a partial CeeJourneySummary via
 * the SDK helper. Asserts that the error is retryable and that no brief text
 * leaks into error or journey metadata.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import {
  buildCeeJourneySummary,
  type CeeJourneySummary,
} from "../../sdk/typescript/src/ceeHelpers.js";

describe("CEE hero journey: mid-journey evidence rate limit", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-rate-limit-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-hero-rate-limit-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-hero-rate-limit-test");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-hero-rate-limit-test");
    // Set a low per-feature rate limit so the second evidence call hits CEE_RATE_LIMIT
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "1");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("handles an evidence-helper rate-limit failure without leaking brief text", async () => {
    const SECRET = "DO_NOT_LEAK_RATE_LIMIT";

    // 1) Draft My Model
    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-hero-rate-limit-key" },
      payload: {
        brief: `Rate-limit journey decision with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();

    // 2) Options Helper
    const optionsRes = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: { "X-Olumi-Assist-Key": "cee-hero-rate-limit-key" },
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
    });

    expect(optionsRes.statusCode).toBe(200);
    const optionsBody = optionsRes.json();

    // 3) Evidence Helper – first call succeeds, second hits per-feature rate limit
    const evidencePayload = {
      evidence: [
        { id: "e1", type: "experiment" },
        { id: "e2", type: "user_research" },
      ],
    };

    const evidenceFirst = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: { "X-Olumi-Assist-Key": "cee-hero-rate-limit-key" },
      payload: evidencePayload,
    });

    expect(evidenceFirst.statusCode).toBe(200);

    const evidenceLimited = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: { "X-Olumi-Assist-Key": "cee-hero-rate-limit-key" },
      payload: evidencePayload,
    });

    expect(evidenceLimited.statusCode).toBe(429);
    const requestId = evidenceLimited.headers["x-cee-request-id"] as string;
    expect(typeof requestId).toBe("string");

    const errorBody = evidenceLimited.json();
    expect(errorBody.schema).toBe("cee.error.v1");
    expect(errorBody.code).toBe("CEE_RATE_LIMIT");
    expect(errorBody.retryable).toBe(true);
    expect(typeof errorBody.details?.retry_after_seconds).toBe("number");
    expect(errorBody.details.retry_after_seconds).toBeGreaterThan(0);

    // Build a journey summary from the envelopes that succeeded (draft + options).
    const journey: CeeJourneySummary = buildCeeJourneySummary({
      draft: draftBody,
      options: optionsBody,
    });

    expect(typeof journey.story.headline).toBe("string");
    expect(journey.story.headline.length).toBeGreaterThan(0);
    expect(journey.is_complete).toBe(false);
    expect(journey.missing_envelopes).toContain("evidence");

    // Privacy: ensure the secret marker does not leak into error or journey metadata
    const serialized = JSON.stringify({ errorBody, journey }).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
