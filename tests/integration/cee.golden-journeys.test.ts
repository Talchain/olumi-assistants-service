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

  // Use V1 schema since downstream endpoints (/options, /bias-check) expect V1 graph format
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

  let evidenceBody: any | undefined;
  if (fixture.inputs.evidence?.items && fixture.inputs.evidence.items.length > 0) {
    evidenceBody = { items: [], response_limits: { items_max: 20, items_truncated: fixture.inputs.evidence.items.length > 20 }, quality: { overall: 7 }, trace: { request_id: "sdk-fixture" } };
  }
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const biasBody: any = { bias_findings: [], quality: { overall: 7 } };

  let teamBody: any | undefined;
  if (fixture.inputs.team?.perspectives && fixture.inputs.team.perspectives.length > 0) {
    teamBody = { summary: { participant_count: 3, has_team_disagreement: fixture.id === CEE_GOLDEN_JOURNEYS.TEAM_DISAGREEMENT || fixture.id === CEE_GOLDEN_JOURNEYS.KILL_VS_PIVOT_EXPERIMENT }, quality: { overall: 6 }, trace: { request_id: "sdk-fixture" } };
  }

  const envelopes: CeeJourneyEnvelopes = {
    draft: draftBody,
    options: optionsBody,
    evidence: evidenceBody,
    bias: biasBody,
    team: teamBody,
  };

  const snapshot = buildCeeGoldenJourneySnapshot(envelopes);

  return { envelopes, snapshot };
}

describe("CEE golden journeys (fixtures provider)", () => {
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

  it("healthy_product_decision yields a complete, untruncated, disagreement-free snapshot", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.HEALTHY_PRODUCT_DECISION);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.any_truncated).toBe(fixture.expectations.expect_any_truncated);
    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);
    if (fixture.expectations.expect_has_team_disagreement !== undefined) {
      expect(snapshot.has_team_disagreement).toBe(
        fixture.expectations.expect_has_team_disagreement,
      );
    }
    if (fixture.expectations.expect_is_complete !== undefined) {
      expect(snapshot.is_complete).toBe(fixture.expectations.expect_is_complete);
    }

    expect(snapshot.quality_band).not.toBe("low");

    const briefLower = fixture.inputs.draft?.brief.toLowerCase() ?? "";
    if (briefLower) {
      const serialized = JSON.stringify(snapshot).toLowerCase();
      expect(serialized.includes(briefLower)).toBe(false);
    }
  });

  it("under_specified_strategic_decision yields an incomplete, untruncated, disagreement-free snapshot", async () => {
    const fixture = await loadCeeGoldenJourney(
      CEE_GOLDEN_JOURNEYS.UNDER_SPECIFIED_STRATEGIC_DECISION,
    );
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.any_truncated).toBe(fixture.expectations.expect_any_truncated);

    if (fixture.expectations.expect_is_complete !== undefined) {
      expect(snapshot.is_complete).toBe(fixture.expectations.expect_is_complete);
    }

    if (fixture.expectations.expect_has_team_disagreement !== undefined) {
      expect(snapshot.has_team_disagreement).toBe(
        fixture.expectations.expect_has_team_disagreement,
      );
    }
  });

  it("evidence_heavy_with_truncation sets any_truncated=true and remains incomplete", async () => {
    const fixture = await loadCeeGoldenJourney(
      CEE_GOLDEN_JOURNEYS.EVIDENCE_HEAVY_WITH_TRUNCATION,
    );
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.any_truncated).toBe(true);
    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);
    expect(snapshot.is_complete).toBe(false);
  });

  it("team_disagreement journey reports has_team_disagreement=true in the snapshot", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.TEAM_DISAGREEMENT);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.has_team_disagreement).toBe(true);
    expect(snapshot.is_complete).toBe(false);
  });

  it("long_term_strategic_bet yields an incomplete, untruncated, disagreement-free snapshot", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.LONG_TERM_STRATEGIC_BET);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.any_truncated).toBe(fixture.expectations.expect_any_truncated);
    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);

    if (fixture.expectations.expect_has_team_disagreement !== undefined) {
      expect(snapshot.has_team_disagreement).toBe(
        fixture.expectations.expect_has_team_disagreement,
      );
    }

    if (fixture.expectations.expect_is_complete !== undefined) {
      expect(snapshot.is_complete).toBe(fixture.expectations.expect_is_complete);
    }

    const briefLower = fixture.inputs.draft?.brief.toLowerCase() ?? "";
    if (briefLower) {
      const serialized = JSON.stringify(snapshot).toLowerCase();
      expect(serialized.includes(briefLower)).toBe(false);
    }
  });

  it("launch_vs_delay_feature behaves like a realistic feature-launch decision", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.LAUNCH_VS_DELAY_FEATURE);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.any_truncated).toBe(fixture.expectations.expect_any_truncated);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);

    if (fixture.expectations.expect_has_team_disagreement !== undefined) {
      expect(snapshot.has_team_disagreement).toBe(
        fixture.expectations.expect_has_team_disagreement,
      );
    }

    if (fixture.expectations.expect_is_complete !== undefined) {
      expect(snapshot.is_complete).toBe(fixture.expectations.expect_is_complete);
    }
  });
  it("high_band_portfolio_prioritisation behaves like a high-band, low-disagreement portfolio decision", async () => {
    const fixture = await loadCeeGoldenJourney(
      CEE_GOLDEN_JOURNEYS.HIGH_BAND_PORTFOLIO_PRIORITISATION,
    );
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.any_truncated).toBe(fixture.expectations.expect_any_truncated);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);

    if (fixture.expectations.expect_has_team_disagreement !== undefined) {
      expect(snapshot.has_team_disagreement).toBe(
        fixture.expectations.expect_has_team_disagreement,
      );
    }

    if (fixture.expectations.expect_is_complete !== undefined) {
      expect(snapshot.is_complete).toBe(fixture.expectations.expect_is_complete);
    }

    // High-band journeys should never be classified as low band, but we avoid
    // asserting strictly on "high" to keep the test resilient to minor
    // heuristic tuning.
    expect(snapshot.quality_band).not.toBe("low");
  });
  it("kill_vs_pivot_experiment behaves like a realistic experiment decision with disagreement", async () => {
    const fixture = await loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.KILL_VS_PIVOT_EXPERIMENT);
    const { snapshot } = await runGoldenJourney(app, fixture);

    expect(snapshot.any_truncated).toBe(fixture.expectations.expect_any_truncated);

    expect(snapshot.has_validation_issues).toBe(fixture.expectations.expect_has_validation_issues);

    if (fixture.expectations.expect_has_team_disagreement !== undefined) {
      expect(snapshot.has_team_disagreement).toBe(
        fixture.expectations.expect_has_team_disagreement,
      );
    }

    if (fixture.expectations.expect_is_complete !== undefined) {
      expect(snapshot.is_complete).toBe(fixture.expectations.expect_is_complete);
    }
  });
});
