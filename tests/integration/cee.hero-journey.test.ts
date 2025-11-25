/**
 * CEE v1 Hero Journey Integration Test
 *
 * Exercises a full CEE journey using fixtures: Draft My Model → Options →
 * Evidence Helper → Bias Check → Team Perspectives, then builds a
 * DecisionStorySummary via the SDK helper.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { buildDecisionStorySummary } from "../../sdk/typescript/src/ceeHelpers.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("CEE hero journey: draft → options → evidence → bias → team", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-journey-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-hero-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-hero-test");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-hero-test");
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_BIAS_CHECK_FEATURE_VERSION", "bias-hero-test");
    vi.stubEnv("CEE_BIAS_CHECK_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_FEATURE_VERSION", "team-hero-test");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM", "5");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("produces a coherent decision story without leaking brief text", async () => {
    const SECRET = "DO_NOT_LEAK";

    // 1) Draft My Model
    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-hero-journey-key" },
      payload: {
        brief: `Hero journey decision with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();

    // 2) Options Helper
    const optionsRes = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: { "X-Olumi-Assist-Key": "cee-hero-journey-key" },
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
    });

    expect(optionsRes.statusCode).toBe(200);
    const optionsBody = optionsRes.json();

    // 3) Evidence Helper
    const evidenceRes = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: { "X-Olumi-Assist-Key": "cee-hero-journey-key" },
      payload: {
        evidence: [
          { id: "e1", type: "experiment" },
          { id: "e2", type: "user_research" },
        ],
      },
    });

    expect(evidenceRes.statusCode).toBe(200);
    const evidenceBody = evidenceRes.json();

    // 4) Bias Check
    const biasRes = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: { "X-Olumi-Assist-Key": "cee-hero-journey-key" },
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
    });

    expect(biasRes.statusCode).toBe(200);
    const biasBody = biasRes.json();

    // 5) Team Perspectives
    const teamRes = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers: { "X-Olumi-Assist-Key": "cee-hero-journey-key" },
      payload: {
        perspectives: [
          { id: "p1", stance: "for", confidence: 0.8 },
          { id: "p2", stance: "against", confidence: 0.6 },
          { id: "p3", stance: "neutral" },
        ],
      },
    });

    expect(teamRes.statusCode).toBe(200);
    const teamBody = teamRes.json();

    const story = buildDecisionStorySummary({
      draft: draftBody,
      options: optionsBody,
      evidence: evidenceBody,
      bias: biasBody,
      team: teamBody,
    });

    expect(typeof story.headline).toBe("string");
    expect(story.headline.length).toBeGreaterThan(0);
    expect(Array.isArray(story.key_drivers)).toBe(true);
    expect(Array.isArray(story.risks_and_gaps)).toBe(true);
    expect(Array.isArray(story.next_actions)).toBe(true);

    const serialized = JSON.stringify(story);
    expect(serialized.includes(SECRET)).toBe(false);
  });
});
