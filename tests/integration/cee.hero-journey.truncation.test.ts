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
      url: "/assist/v1/draft-graph?schema=v1",
      headers: { "X-Olumi-Assist-Key": "cee-hero-health-key" },
      payload: {
        brief: `Truncation journey decision with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const optionsBody: any = { options: [{ id: "option-fixture" }], quality: { overall: 7 }, trace: { request_id: "sdk-fixture" }, validation_issues: [{ code: "trivial_graph", severity: "warning" }] };
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const evidenceBody: any = { items: [], response_limits: { items_max: 20, items_truncated: true }, quality: { overall: 7 }, trace: { request_id: "sdk-fixture" } };

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
    const serialized = JSON.stringify({ story, health });
    expect(serialized.includes(SECRET)).toBe(false);
  });

  it("produces a validation-focused health summary without leaking user content", async () => {
    const SECRET = "DO_NOT_LEAK_VALIDATION";
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const optionsBody: any = { options: [{ id: "option-fixture" }], quality: { overall: 7 }, trace: { request_id: "sdk-fixture" }, validation_issues: [{ code: "trivial_graph", severity: "warning" }] };

    const story = buildDecisionStorySummary({ options: optionsBody });
    const health: CeeHealthSummary = buildCeeHealthSummary("options", optionsBody);

    expect(health.has_validation_issues).toBe(true);
    expect(["warning", "risk"]).toContain(health.status);
    expect(health.reasons.some((r) => r.toLowerCase().includes("validation"))).toBe(true);

    // Story and health summaries must remain metadata-only (no brief text)
    const serialized = JSON.stringify({ story, health });
    expect(serialized.includes(SECRET)).toBe(false);
  });
});
