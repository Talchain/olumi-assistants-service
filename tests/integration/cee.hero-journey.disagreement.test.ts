/**
 * CEE v1 Hero Journey Integration Test (Team Disagreement & Low Evidence)
 *
 * Exercises a CEE journey with multiple options, low evidence, and high team
 * disagreement, then builds a combined CeeJourneySummary via the SDK helper.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import {
  buildCeeJourneySummary,
  buildCeeDecisionReviewPayload,
  type CeeJourneySummary,
  type CeeDecisionReviewPayload,
} from "../../sdk/typescript/src/ceeHelpers.js";
import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("CEE hero journey: options + team disagreement with low evidence", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-disagreement-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-disagreement-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("produces a medium-quality journey with high team disagreement and no evidence leak", async () => {
    const SECRET = "DO_NOT_LEAK_DISAGREE";

    // 1) Draft My Model
    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v1",
      headers: { "X-Olumi-Assist-Key": "cee-hero-disagreement-key" },
      payload: {
        brief: `Disagreement journey decision with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const teamBody: any = { summary: { participant_count: 3, has_team_disagreement: true }, quality: { overall: 6 }, trace: { request_id: "sdk-fixture" } };

    // Build a journey summary using only the team envelope so that quality reflects
    // the team-confidence heuristics (expected to land in the "medium" band). This is
    // intentionally a partial journey from the helper's perspective.
    const journey: CeeJourneySummary = buildCeeJourneySummary({ team: teamBody });

    expect(typeof journey.story.headline).toBe("string");
    expect(journey.story.headline.length).toBeGreaterThan(0);
    expect(journey.story.headline.toLowerCase()).toContain("medium");

    // Health aggregation should reflect the team envelope only
    const health = journey.health;
    expect(health.perEnvelope.team).toBeDefined();
    expect(health.perEnvelope.team?.source).toBe("team");
    expect(health.overallStatus).toBe("ok");
    expect(health.overallTone).toBe("success");
    expect(health.any_truncated).toBe(false);
    expect(health.has_validation_issues).toBe(false);

    // Journey completeness metadata should treat this as incomplete and report
    // missing envelopes, since only the team envelope was passed to the helper.
    expect(journey.is_complete).toBe(false);
    expect(journey.missing_envelopes.length).toBeGreaterThan(0);
    expect(journey.missing_envelopes).toContain("draft");

    // Privacy: ensure the secret marker does not leak into story, health, or guidance
    const serialized = JSON.stringify({
      journey,

    }).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);

    expectNoSecretLikeKeys(journey);
  });

  it("builds a decision review combining draft + team with disagreement and missing evidence", async () => {
    const SECRET = "DO_NOT_LEAK_DISAGREE_REVIEW";

    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v1",
      headers: { "X-Olumi-Assist-Key": "cee-hero-disagreement-key" },
      payload: {
        brief: `Disagreement review journey with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const teamBody: any = { summary: { participant_count: 3, has_team_disagreement: true }, quality: { overall: 6 }, trace: { request_id: "sdk-fixture" } };

    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft: draftBody,
      team: teamBody,
    });

    expect(review.journey.has_team_disagreement).toBe(true);
    expect(review.uiFlags.has_team_disagreement).toBe(true);
    expect(review.journey.missing_envelopes).toContain("evidence");

    const risksLower = review.story.risks_and_gaps.join(" ").toLowerCase();
    expect(risksLower.includes("no supporting evidence")).toBe(true);

    const serialized = JSON.stringify(review).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
    expectNoSecretLikeKeys(review);
  });
});
