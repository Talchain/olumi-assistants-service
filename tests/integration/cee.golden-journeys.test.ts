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
    url: "/assist/v1/draft-graph",
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

  const optionsRes = await app.inject({
    method: "POST",
    url: "/assist/v1/options",
    headers,
    payload: {
      graph: draftBody.graph,
      archetype: draftBody.archetype,
    },
  });

  expect(optionsRes.statusCode).toBe(200);
  const optionsBody = optionsRes.json();

  let evidenceBody: any | undefined;
  if (fixture.inputs.evidence?.items && fixture.inputs.evidence.items.length > 0) {
    const evidenceRes = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers,
      payload: {
        evidence: fixture.inputs.evidence.items.map((item) => ({
          id: item.id,
          type: item.type,
        })),
      },
    });

    expect(evidenceRes.statusCode).toBe(200);
    evidenceBody = evidenceRes.json();
  }

  const biasRes = await app.inject({
    method: "POST",
    url: "/assist/v1/bias-check",
    headers,
    payload: {
      graph: draftBody.graph,
      archetype: draftBody.archetype,
    },
  });

  expect(biasRes.statusCode).toBe(200);
  const biasBody = biasRes.json();

  let teamBody: any | undefined;
  if (fixture.inputs.team?.perspectives && fixture.inputs.team.perspectives.length > 0) {
    const teamRes = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers,
      payload: {
        perspectives: fixture.inputs.team.perspectives.map((p) => ({
          id: p.id,
          stance: p.stance,
          ...(typeof p.confidence === "number" ? { confidence: p.confidence } : {}),
        })),
      },
    });

    expect(teamRes.statusCode).toBe(200);
    teamBody = teamRes.json();
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
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-golden-journeys-test");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-golden-journeys-test");
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_BIAS_CHECK_FEATURE_VERSION", "bias-golden-journeys-test");
    vi.stubEnv("CEE_BIAS_CHECK_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_FEATURE_VERSION", "team-golden-journeys-test");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM", "10");

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
    expect(snapshot.has_validation_issues).toBe(
      fixture.expectations.expect_has_validation_issues,
    );
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
    expect(snapshot.has_validation_issues).toBe(false);
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
    expect(snapshot.has_validation_issues).toBe(
      fixture.expectations.expect_has_validation_issues,
    );

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

    if (fixture.expectations.expect_has_validation_issues !== undefined) {
      expect(snapshot.has_validation_issues).toBe(
        fixture.expectations.expect_has_validation_issues,
      );
    }

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

    if (fixture.expectations.expect_has_validation_issues !== undefined) {
      expect(snapshot.has_validation_issues).toBe(
        fixture.expectations.expect_has_validation_issues,
      );
    }

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

    if (fixture.expectations.expect_has_validation_issues !== undefined) {
      expect(snapshot.has_validation_issues).toBe(
        fixture.expectations.expect_has_validation_issues,
      );
    }

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
