/**
 * CEE v1 Hero Journey Integration Test (Heavy Truncation & Journey Helpers)
 *
 * Exercises a "heavy but valid" CEE journey using fixtures, with large
 * evidence input that triggers truncation caps. Verifies that:
 * - Truncation metadata is surfaced on the evidence envelope.
 * - Journey health and UI flags reflect truncation.
 * - The decision review helper preserves truncation semantics.
 * - No brief text leaks into any helper output.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import {
  buildCeeJourneySummary,
  buildCeeUiFlags,
  buildCeeDecisionReviewPayload,
  type CeeJourneySummary,
  type CeeDecisionReviewPayload,
  type CeeUiFlags,
} from "../../sdk/typescript/src/ceeHelpers.js";

describe("CEE hero journey: heavy truncation and journey helpers", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-heavy-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-hero-heavy-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-hero-heavy-test");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-hero-heavy-test");
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "5");

    delete process.env.BASE_URL;
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("handles heavy evidence with truncation while keeping helpers metadata-only", async () => {
    const SECRET_HEAVY = "DO_NOT_LEAK_HEAVY_TRUNCATION";

    // 1) Draft My Model
    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-hero-heavy-key" },
      payload: {
        brief: `Heavy truncation journey with secret marker ${SECRET_HEAVY}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();

    // 2) Options Helper (normal size, just to keep journey realistic)
    const optionsRes = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: { "X-Olumi-Assist-Key": "cee-hero-heavy-key" },
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
    });

    expect(optionsRes.statusCode).toBe(200);
    const optionsBody = optionsRes.json();

    // 3) Evidence Helper with many items to trigger truncation caps
    const evidencePayload = {
      evidence: Array.from({ length: 40 }, (_, i) => ({
        id: `e-${i}`,
        type: "experiment",
      })),
    };

    const evidenceRes = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: { "X-Olumi-Assist-Key": "cee-hero-heavy-key" },
      payload: evidencePayload,
    });

    expect(evidenceRes.statusCode).toBe(200);
    const evidenceBody = evidenceRes.json();

    // Evidence Helper should report truncation in response_limits
    expect(Array.isArray(evidenceBody.items)).toBe(true);
    expect(evidenceBody.items.length).toBeGreaterThan(0);
    expect(evidenceBody.response_limits).toEqual({
      items_max: evidenceBody.response_limits.items_max,
      items_truncated: true,
    });
    expect(evidenceBody.response_limits.items_max).toBeGreaterThan(0);

    // Build a journey summary across draft + options + evidence
    const journey: CeeJourneySummary = buildCeeJourneySummary({
      draft: draftBody,
      options: optionsBody,
      evidence: evidenceBody,
    });

    // At least the evidence envelope should report truncation
    expect(journey.health.perEnvelope.evidence).toBeDefined();
    expect(journey.health.perEnvelope.evidence?.any_truncated).toBe(true);

    // Journey-level health should reflect truncation
    expect(journey.health.any_truncated).toBe(true);
    expect(journey.health.overallStatus).toBe("warning");
    expect(journey.health.overallTone).toBe("warning");

    // UI flags should light up truncation
    const uiFlags: CeeUiFlags = buildCeeUiFlags(journey);
    expect(uiFlags.has_truncation_somewhere).toBe(true);

    // Build a decision review payload from the same envelopes
    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft: draftBody,
      options: optionsBody,
      evidence: evidenceBody,
    });

    expect(review.story.any_truncated).toBe(true);
    expect(review.journey.health.any_truncated).toBe(true);
    expect(review.uiFlags.has_truncation_somewhere).toBe(true);

    // The journey is still incomplete (we did not call bias/sensitivity/team)
    expect(review.journey.is_complete).toBe(false);
    expect(review.journey.missing_envelopes).toContain("bias");
    expect(review.journey.missing_envelopes).toContain("sensitivity");
    expect(review.journey.missing_envelopes).toContain("team");

    // Privacy: ensure the secret marker never appears in helper outputs
    const serialized = JSON.stringify({ journey, uiFlags, review, evidenceBody }).toLowerCase();
    expect(serialized.includes(SECRET_HEAVY.toLowerCase())).toBe(false);
  });
});
