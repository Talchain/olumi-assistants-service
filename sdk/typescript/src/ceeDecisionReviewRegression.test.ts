import { describe, it, expect } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEExplainGraphResponseV1,
  CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1,
  CEEBiasCheckResponseV1,
  CEESensitivityCoachResponseV1,
  CEETeamPerspectivesResponseV1,
} from "./ceeTypes.js";
import {
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
} from "./ceeHelpers.js";

async function expectNoSecretLikeKeysShared(payload: unknown): Promise<void> {
  const mod = await import("../../../tests/utils/shared-privacy-guards.js");
  mod.expectNoSecretLikeKeysShared(payload);
}

async function expectNoBannedSubstringsShared(payload: unknown): Promise<void> {
  const mod = await import("../../../tests/utils/shared-privacy-guards.js");
  mod.expectNoBannedSubstringsShared(payload);
}

describe("buildCeeDecisionReviewPayload regression", () => {
  it("builds a high-quality, complete, untruncated review from deterministic envelopes", async () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-journey-ok", correlation_id: "r-journey-ok", engine: {} },
      quality: { overall: 8 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-journey-ok", correlation_id: "r-journey-ok", engine: {} },
      quality: { overall: 8 } as any,
      options: [{ id: "opt-1" } as any],
    } as any;

    const explain: CEEExplainGraphResponseV1 = {
      trace: { request_id: "r-journey-ok", correlation_id: "r-journey-ok", engine: {} },
      quality: { overall: 8 } as any,
      explanations: [] as any,
    } as any;

    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-journey-ok", correlation_id: "r-journey-ok", engine: {} },
      quality: { overall: 8 } as any,
      items: [{ id: "e1" } as any],
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-journey-ok", correlation_id: "r-journey-ok", engine: {} },
      quality: { overall: 8 } as any,
      bias_findings: [] as any,
    } as any;

    const sensitivity: CEESensitivityCoachResponseV1 = {
      trace: { request_id: "r-journey-ok", correlation_id: "r-journey-ok", engine: {} },
      quality: { overall: 8 } as any,
      suggestions: [] as any,
    } as any;

    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-journey-ok", correlation_id: "r-journey-ok", engine: {} },
      quality: { overall: 8 } as any,
      summary: {
        participant_count: 3,
        for_count: 2,
        against_count: 0,
        neutral_count: 1,
        weighted_for_fraction: 0.8,
        disagreement_score: 0,
        has_team_disagreement: false,
      } as any,
    } as any;

    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft,
      explain,
      evidence,
      options,
      bias,
      sensitivity,
      team,
    });

    expect(review.story).toBeDefined();
    expect(typeof review.story.headline).toBe("string");
    expect(Array.isArray(review.story.key_drivers)).toBe(true);
    expect(Array.isArray(review.story.risks_and_gaps)).toBe(true);
    expect(Array.isArray(review.story.next_actions)).toBe(true);
    expect(typeof review.story.any_truncated).toBe("boolean");

    expect(review.journey).toBeDefined();
    expect(review.journey.health).toBeDefined();
    expect(review.journey.health.overallStatus).toBe("ok");
    expect(review.journey.health.overallTone).toBe("success");
    expect(review.journey.health.any_truncated).toBe(false);
    expect(review.journey.health.has_validation_issues).toBe(false);

    expect(review.uiFlags).toBeDefined();
    expect(review.uiFlags.has_high_risk_envelopes).toBe(false);
    expect(review.uiFlags.has_team_disagreement).toBe(false);
    expect(review.uiFlags.has_truncation_somewhere).toBe(false);
    expect(review.uiFlags.is_journey_complete).toBe(true);

    expect(review.trace).toBeDefined();
    expect(review.trace?.request_id).toBe("r-journey-ok");
    expect(review.trace?.correlation_id).toBe("r-journey-ok");

    await expectNoSecretLikeKeysShared(review);
    await expectNoBannedSubstringsShared(review);
  });

  it("captures truncation, validation issues, and team disagreement in review metadata", async () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-journey-mixed", correlation_id: "r-journey-mixed", engine: {} },
      quality: { overall: 6 } as any,
      graph: {} as any,
      response_limits: {
        options_max: 6,
        options_truncated: true,
      } as any,
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-journey-mixed", correlation_id: "r-journey-mixed", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [] as any,
      validation_issues: [{ code: "serious_issue", severity: "error" } as any],
    } as any;

    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-journey-mixed", correlation_id: "r-journey-mixed", engine: {} },
      quality: { overall: 6 } as any,
      summary: {
        participant_count: 3,
        for_count: 1,
        against_count: 1,
        neutral_count: 1,
        weighted_for_fraction: 1 / 3,
        disagreement_score: 0.6,
        has_team_disagreement: true,
      } as any,
    } as any;

    const review = buildCeeDecisionReviewPayload({ draft, bias, team });

    expect(review.journey.health.overallStatus).toBe("risk");
    expect(review.journey.health.overallTone).toBe("danger");
    expect(review.journey.health.any_truncated).toBe(true);
    expect(review.journey.health.has_validation_issues).toBe(true);

    expect(review.uiFlags.has_high_risk_envelopes).toBe(true);
    expect(review.uiFlags.has_truncation_somewhere).toBe(true);
    expect(review.uiFlags.has_team_disagreement).toBe(true);
    expect(review.uiFlags.is_journey_complete).toBe(false);

    await expectNoSecretLikeKeysShared(review);
    await expectNoBannedSubstringsShared(review);
  });
});
