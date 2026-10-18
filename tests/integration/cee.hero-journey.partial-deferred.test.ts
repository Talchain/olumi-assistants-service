/**
 * CEE v1 Hero Journey Integration Test (Partial / Deferred Envelopes)
 *
 * Exercises a realistic pattern where a client:
 * - Starts with Draft + Options only.
 * - Later adds Evidence Helper and Team Perspectives.
 *
 * At each step, we build a metadata-only decision review payload via
 * buildCeeDecisionReviewPayload and assert that:
 * - Journey completeness and missing_envelopes behave sensibly.
 * - UI flags remain consistent.
 * - No brief text leaks into the payload.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import {
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
} from "../../sdk/typescript/src/ceeHelpers.js";

describe("CEE hero journey: partial / deferred envelopes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-partial-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-partial-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("supports partial and deferred CEE envelopes with sensible journey metadata", async () => {
    const SECRET = "DO_NOT_LEAK_PARTIAL";

    // 1) Draft My Model
    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v1",
      headers: { "X-Olumi-Assist-Key": "cee-hero-partial-key" },
      payload: {
        brief: `Partial/deferred journey with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const optionsBody: any = { options: [{ id: "option-fixture" }], quality: { overall: 7 }, trace: { request_id: "sdk-fixture" } };

    // Stage 1: draft + options only
    const review1: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft: draftBody,
      options: optionsBody,
    });

    expect(review1.journey.is_complete).toBe(false);
    expect(review1.journey.missing_envelopes).toContain("evidence");
    expect(review1.journey.missing_envelopes).toContain("team");
    expect(review1.uiFlags.is_journey_complete).toBe(false);
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const evidenceBody: any = { items: [], response_limits: { items_max: 20, items_truncated: false }, quality: { overall: 7 }, trace: { request_id: "sdk-fixture" } };

    const review2: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft: draftBody,
      options: optionsBody,
      evidence: evidenceBody,
    });

    expect(review2.journey.is_complete).toBe(false);
    expect(review2.journey.missing_envelopes).toContain("team");
    expect(review2.journey.missing_envelopes).not.toContain("evidence");
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const teamBody: any = { summary: { participant_count: 3, has_team_disagreement: true }, quality: { overall: 6 }, trace: { request_id: "sdk-fixture" } };

    const review3: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft: draftBody,
      options: optionsBody,
      evidence: evidenceBody,
      team: teamBody,
    });

    expect(review3.journey.is_complete).toBe(false);
    expect(review3.journey.missing_envelopes).toContain("bias");
    expect(review3.journey.missing_envelopes).toContain("sensitivity");
    expect(review3.journey.missing_envelopes).not.toContain("draft");
    expect(review3.journey.missing_envelopes).not.toContain("options");
    expect(review3.journey.missing_envelopes).not.toContain("evidence");
    expect(review3.journey.missing_envelopes).not.toContain("team");

    // Trace metadata should be present from at least one envelope
    expect(review3.trace).toBeDefined();
    expect(typeof review3.trace?.request_id === "string" || typeof review3.trace?.correlation_id === "string").toBe(true);

    // Privacy: ensure the secret marker does not leak into any review payload
    const serialized = JSON.stringify({ review1, review2, review3 }).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
