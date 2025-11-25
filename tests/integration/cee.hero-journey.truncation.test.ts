/**
 * CEE v1 Hero Journey Integration Tests (health & truncation focus)
 *
 * Exercises CEE journeys using fixtures to verify truncation behaviour,
 * guidance, DecisionStorySummary, and CeeHealthSummary, while ensuring
 * no user content leaks into summaries.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import {
  buildDecisionStorySummary,
  buildCeeHealthSummary,
  type CeeHealthSummary,
} from "../../sdk/typescript/src/ceeHelpers.js";

describe("CEE hero journey (health): truncation and validation scenarios", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-health-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-hero-health-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-hero-health-test");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-hero-health-test");
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "5");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("produces sensible health and story summaries when evidence is truncated", async () => {
    const SECRET = "DO_NOT_LEAK_TRUNC";

    // 1) Draft My Model
    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-hero-health-key" },
      payload: {
        brief: `Truncation journey decision with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();

    // 2) Options Helper (no truncation required here, just to keep the journey realistic)
    const optionsRes = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: { "X-Olumi-Assist-Key": "cee-hero-health-key" },
      payload: {
        graph: draftBody.graph,
        archetype: draftBody.archetype,
      },
    });

    expect(optionsRes.statusCode).toBe(200);
    const optionsBody = optionsRes.json();

    // 3) Evidence Helper with more than 20 items to trigger truncation
    const evidencePayload = {
      evidence: Array.from({ length: 25 }, (_, i) => ({
        id: `e-${i}`,
        type: "experiment",
      })),
    };

    const evidenceRes = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: { "X-Olumi-Assist-Key": "cee-hero-health-key" },
      payload: evidencePayload,
    });

    expect(evidenceRes.statusCode).toBe(200);
    const evidenceBody = evidenceRes.json();

    // Evidence Helper should report truncation in response_limits and guidance
    expect(Array.isArray(evidenceBody.items)).toBe(true);
    expect(evidenceBody.items.length).toBe(20);
    expect(evidenceBody.response_limits).toEqual({
      items_max: 20,
      items_truncated: true,
    });

    expect(evidenceBody.guidance).toBeDefined();
    expect(evidenceBody.guidance.any_truncated).toBe(true);
    const guidanceText = JSON.stringify(evidenceBody.guidance).toLowerCase();
    expect(guidanceText.includes("trunc") || guidanceText.includes("capped")).toBe(true);

    // Build story and health summaries
    const story = buildDecisionStorySummary({
      draft: draftBody,
      options: optionsBody,
      evidence: evidenceBody,
    });

    expect(story.any_truncated).toBe(true);
    expect(story.risks_and_gaps.some((r) => r.toLowerCase().includes("trunc"))).toBe(true);

    const health: CeeHealthSummary = buildCeeHealthSummary("evidence", evidenceBody);
    expect(health.any_truncated).toBe(true);
    expect(["warning", "risk"]).toContain(health.status);
    expect(health.reasons.some((r) => r.toLowerCase().includes("trunc"))).toBe(true);

    // Privacy: no brief text should leak into story or health summaries
    const serialized = JSON.stringify({ story, health, guidance: evidenceBody.guidance });
    expect(serialized.includes(SECRET)).toBe(false);
  });

  it("produces a validation-focused health summary without leaking user content", async () => {
    const SECRET = "DO_NOT_LEAK_VALIDATION";

    // Use a trivial graph to trigger a validation issue in CEE Options
    const trivialGraph = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "g1", kind: "goal", label: `Trivial graph ${SECRET}` }],
      edges: [],
      meta: { roots: ["g1"], leaves: ["g1"], suggested_positions: {}, source: "assistant" },
    };

    const optionsRes = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: { "X-Olumi-Assist-Key": "cee-hero-health-key" },
      payload: {
        graph: trivialGraph,
      },
    });

    expect(optionsRes.statusCode).toBe(200);
    const optionsBody = optionsRes.json();

    // Options should carry at least one validation issue (e.g. trivial_graph)
    expect(Array.isArray(optionsBody.validation_issues)).toBe(true);
    expect(optionsBody.validation_issues.length).toBeGreaterThan(0);

    // Guidance should mention validation/quality issues generically
    expect(optionsBody.guidance).toBeDefined();
    const optionsGuidanceText = JSON.stringify(optionsBody.guidance).toLowerCase();
    expect(optionsGuidanceText.includes("validation") || optionsGuidanceText.includes("quality")).toBe(true);

    const story = buildDecisionStorySummary({ options: optionsBody });
    const health: CeeHealthSummary = buildCeeHealthSummary("options", optionsBody);

    expect(health.has_validation_issues).toBe(true);
    expect(["warning", "risk"]).toContain(health.status);
    expect(health.reasons.some((r) => r.toLowerCase().includes("validation"))).toBe(true);

    // Story and health summaries must remain metadata-only (no brief text)
    const serialized = JSON.stringify({ story, health, guidance: optionsBody.guidance });
    expect(serialized.includes(SECRET)).toBe(false);
  });
});
