import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

import { build } from "../../src/server.js";
import {
  loadCeeGoldenJourney,
  CEE_GOLDEN_JOURNEYS,
  type CeeGoldenJourneyFixture,
} from "../utils/cee-golden-journeys.js";
import type { CeeJourneyEnvelopes } from "../../sdk/typescript/src/ceeHelpers.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import {
  buildCeeGoldenJourneySnapshot,
  type CeeGoldenJourneySnapshot,
} from "../../sdk/typescript/src/examples/ceeGoldenJourneyExample.js";

async function runGoldenJourney(
  app: FastifyInstance,
  fixture: CeeGoldenJourneyFixture,
): Promise<{ envelopes: CeeJourneyEnvelopes; snapshot: CeeGoldenJourneySnapshot }> {
  const headers = { "X-Olumi-Assist-Key": "cee-golden-journeys-key" } as const;

  const draftRes = await app.inject({
    method: "POST",
    url: "/assist/v1/draft-graph?schema=v1",
    headers,
    payload: {
      brief: fixture.inputs.draft?.brief ?? "Synthetic CEE golden journey",
      ...(fixture.inputs.draft?.archetype_hint
        ? { archetype_hint: fixture.inputs.draft.archetype_hint }
        : {}),
    },
  });

  expect(draftRes.statusCode).toBe(200);
  const draftBody = draftRes.json();
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const optionsBody: any = { options: [{ id: "option-fixture" }], quality: { overall: 7 }, trace: { request_id: "sdk-fixture" } };

    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const biasBody: any = { bias_findings: [], quality: { overall: 7 } };

  const envelopes: CeeJourneyEnvelopes = {
    draft: draftBody,
    options: optionsBody,
    bias: biasBody,
  };

  const snapshot = buildCeeGoldenJourneySnapshot(envelopes);

  return { envelopes, snapshot };
}

// The options, evidence, bias and team routes were deleted (R2). Each row drafts
// a REAL graph and runs the kept SDK snapshot helper over it; the other
// envelopes are synthetic, so nothing here asserts truncation, team
// disagreement or journey completeness (those would only echo the stubs).
describe("CEE golden-journey SDK snapshot over real drafts (fixtures provider)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-golden-journeys-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-golden-journeys-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "10");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("healthy_product_decision: snapshot validation flag as expected, quality band not low, no brief text", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.HEALTHY_PRODUCT_DECISION);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);

    expect(snapshot.quality_band).not.toBe("low");

    const briefLower = fixture.inputs.draft?.brief.toLowerCase() ?? "";
    if (briefLower) {
      const serialized = JSON.stringify(snapshot).toLowerCase();
      expect(serialized.includes(briefLower)).toBe(false);
    }
  });

  it("evidence_heavy_with_truncation: snapshot validation flag as expected", async () => {
    const fixture = await loadCeeGoldenJourney(
      CEE_GOLDEN_JOURNEYS.EVIDENCE_HEAVY_WITH_TRUNCATION,
    );
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);
  });

  it("long_term_strategic_bet: snapshot validation flag as expected, no brief text", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.LONG_TERM_STRATEGIC_BET);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);

    const briefLower = fixture.inputs.draft?.brief.toLowerCase() ?? "";
    if (briefLower) {
      const serialized = JSON.stringify(snapshot).toLowerCase();
      expect(serialized.includes(briefLower)).toBe(false);
    }
  });

  it("launch_vs_delay_feature: snapshot validation flag as expected", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.LAUNCH_VS_DELAY_FEATURE);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);
  });
  it("high_band_portfolio_prioritisation: snapshot validation flag as expected, quality band not low", async () => {
    const fixture = await loadCeeGoldenJourney(
      CEE_GOLDEN_JOURNEYS.HIGH_BAND_PORTFOLIO_PRIORITISATION,
    );
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);

    // High-band journeys should never be classified as low band, but we avoid
    // asserting strictly on "high" to keep the test resilient to minor
    // heuristic tuning.
    expect(snapshot.quality_band).not.toBe("low");
  });
  it("kill_vs_pivot_experiment: snapshot validation flag as expected", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.KILL_VS_PIVOT_EXPERIMENT);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);
  });
});
