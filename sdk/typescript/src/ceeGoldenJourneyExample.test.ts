import { describe, it, expect, vi } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEExplainGraphResponseV1,
  CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1,
  CEEBiasCheckResponseV1,
  CEESensitivityCoachResponseV1,
  CEETeamPerspectivesResponseV1,
} from "./ceeTypes.js";
import type { CEEClient } from "./ceeClient.js";
import {
  buildCeeGoldenJourneySnapshot,
  runCeeGoldenJourney,
  type CeeGoldenJourneyInput,
  buildCeeGoldenJourneyInputFromFixtureInputs,
  type CeeGoldenJourneyFixtureInputsLike,
} from "./examples/ceeGoldenJourneyExample.js";

describe("ceeGoldenJourneyExample", () => {
  it("produces a high-quality, complete, untruncated journey snapshot", () => {
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
      items: [] as any,
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

    const snap = buildCeeGoldenJourneySnapshot({
      draft,
      explain,
      options,
      evidence,
      bias,
      sensitivity,
      team,
    });

    expect(snap.quality_overall).toBe(8);
    expect(snap.quality_band).toBe("high");
    expect(snap.any_truncated).toBe(false);
    expect(snap.has_validation_issues).toBe(false);
    expect(snap.has_team_disagreement).toBe(false);
    expect(snap.is_complete).toBe(true);
  });

  it("tracks truncation, validation issues, and team disagreement across envelopes", () => {
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

    const snap = buildCeeGoldenJourneySnapshot({ draft, bias, team });

    expect(snap.quality_overall).toBe(6);
    expect(snap.quality_band).toBe("medium");
    expect(snap.any_truncated).toBe(true);
    expect(snap.has_validation_issues).toBe(true);
    expect(snap.has_team_disagreement).toBe(true);
    expect(snap.is_complete).toBe(false);
  });

  it("never leaks raw graph labels or briefs into the journey snapshot", () => {
    const SECRET = "JOURNEY_SECRET_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-journey-secret", correlation_id: "r-journey-secret", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
    } as any;

    const snap = buildCeeGoldenJourneySnapshot({ draft });

    expect(snap.is_complete).toBe(false);
    expect(snap.quality_overall).toBe(7);
    expect(snap.quality_band).toBe("medium");
    expect(snap.any_truncated).toBe(false);
    expect(snap.has_validation_issues).toBe(false);
    expect(snap.has_team_disagreement).toBe(false);

    const serialized = JSON.stringify(snap).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });

  it("maps golden-journey fixture-style inputs into CeeGoldenJourneyInput", () => {
    const fixtureInputs: CeeGoldenJourneyFixtureInputsLike = {
      draft: {
        brief: "Synthetic: Decide long-term strategy",
        archetype_hint: "strategy_decision",
      },
      evidence: {
        items: [
          { id: "e1", type: "experiment" },
          { id: "e2", type: "user_research" },
        ],
      },
      team: {
        perspectives: [
          { id: "p1", stance: "for", confidence: 0.8 },
          { id: "p2", stance: "against" },
        ],
      },
    };

    const input: CeeGoldenJourneyInput =
      buildCeeGoldenJourneyInputFromFixtureInputs(fixtureInputs);

    expect(input.draftBrief).toBe(fixtureInputs.draft?.brief);
    expect(input.draftArchetypeHint).toBe("strategy_decision");

    expect(input.evidenceItems).toEqual([
      { id: "e1", type: "experiment" },
      { id: "e2", type: "user_research" },
    ]);

    expect(input.teamPerspectives).toEqual([
      { id: "p1", stance: "for", confidence: 0.8 },
      { id: "p2", stance: "against" },
    ]);
  });

  it("runs a small end-to-end journey via CEEClient and returns envelopes + snapshot", async () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-runner", correlation_id: "r-runner", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        schema: "graph.v1",
        nodes: [
          { id: "goal", kind: "goal", label: "Grow revenue" },
          { id: "opt_a", kind: "option", label: "Premium pricing" },
        ],
        edges: [],
      } as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-runner", correlation_id: "r-runner", engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt-1" } as any],
    } as any;

    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-runner", correlation_id: "r-runner", engine: {} },
      quality: { overall: 7 } as any,
      items: [] as any,
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-runner", correlation_id: "r-runner", engine: {} },
      quality: { overall: 7 } as any,
      bias_findings: [] as any,
    } as any;

    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-runner", correlation_id: "r-runner", engine: {} },
      quality: { overall: 7 } as any,
      summary: {
        participant_count: 3,
        for_count: 2,
        against_count: 0,
        neutral_count: 1,
        weighted_for_fraction: 0.8,
        disagreement_score: 0.1,
        has_team_disagreement: false,
      } as any,
    } as any;

    const client: CEEClient = {
      draftGraph: vi.fn().mockResolvedValue(draft),
      explainGraph: vi.fn(),
      evidenceHelper: vi.fn().mockResolvedValue(evidence),
      biasCheck: vi.fn().mockResolvedValue(bias),
      options: vi.fn().mockResolvedValue(options),
      sensitivityCoach: vi.fn(),
      teamPerspectives: vi.fn().mockResolvedValue(team),
    };

    const input: CeeGoldenJourneyInput = {
      draftBrief: "Runner journey brief (not logged)",
      draftArchetypeHint: "pricing_decision",
      archetype: { decision_type: "pricing_decision", match: "exact", confidence: 0.9 },
      evidenceItems: [
        { id: "e1", type: "experiment" },
        { id: "e2", type: "user_research" },
      ],
      teamPerspectives: [
        { id: "p1", stance: "for", confidence: 0.8 },
        { id: "p2", stance: "for", confidence: 0.7 },
        { id: "p3", stance: "neutral", confidence: 0.6 },
      ],
    };

    const { envelopes, snapshot } = await runCeeGoldenJourney(client, input);

    expect(client.draftGraph).toHaveBeenCalledTimes(1);
    expect(client.options).toHaveBeenCalledTimes(1);
    expect(client.evidenceHelper).toHaveBeenCalledTimes(1);
    expect(client.biasCheck).toHaveBeenCalledTimes(1);
    expect(client.teamPerspectives).toHaveBeenCalledTimes(1);

    const draftCall = (client.draftGraph as any).mock.calls[0]?.[0];
    expect(draftCall.brief).toBe(input.draftBrief);
    expect(draftCall.archetype_hint).toBe("pricing_decision");

    expect(envelopes.draft).toBe(draft);
    expect(envelopes.options).toBe(options);
    expect(envelopes.evidence).toBe(evidence);
    expect(envelopes.bias).toBe(bias);
    expect(envelopes.team).toBe(team);

    expect(snapshot.quality_overall).toBe(7);
    expect(snapshot.quality_band).toBe("medium");
    expect(typeof snapshot.any_truncated).toBe("boolean");
    expect(typeof snapshot.has_validation_issues).toBe("boolean");
    expect(typeof snapshot.has_team_disagreement).toBe("boolean");
    expect(snapshot.is_complete).toBe(false);

    const serialized = JSON.stringify({ snapshot, envelopes }).toLowerCase();
    expect(serialized.includes("runner journey brief".toLowerCase())).toBe(false);
  });

  it("returns a partial journey when the draft step does not return a usable graph", async () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: {
        request_id: "r-runner-partial",
        correlation_id: "r-runner-partial",
        engine: {},
      },
      quality: { overall: 3 } as any,
      // Note: no graph field; this simulates an under-specified or invalid draft
      validation_issues: [{ code: "structural_gap", severity: "error" } as any],
    } as any;

    const client: CEEClient = {
      draftGraph: vi.fn().mockResolvedValue(draft),
      explainGraph: vi.fn(),
      evidenceHelper: vi.fn(),
      biasCheck: vi.fn(),
      options: vi.fn(),
      sensitivityCoach: vi.fn(),
      teamPerspectives: vi.fn(),
    };

    const input: CeeGoldenJourneyInput = {
      draftBrief: "Under-specified strategic decision (not logged)",
    };

    const { envelopes, snapshot } = await runCeeGoldenJourney(client, input);

    expect(client.draftGraph).toHaveBeenCalledTimes(1);
    expect(client.options).not.toHaveBeenCalled();
    expect(client.evidenceHelper).not.toHaveBeenCalled();
    expect(client.biasCheck).not.toHaveBeenCalled();
    expect(client.teamPerspectives).not.toHaveBeenCalled();

    expect(envelopes.draft).toBe(draft);
    expect(envelopes.options).toBeUndefined();
    expect(envelopes.evidence).toBeUndefined();
    expect(envelopes.bias).toBeUndefined();
    expect(envelopes.team).toBeUndefined();

    expect(snapshot.is_complete).toBe(false);
    expect(snapshot.any_truncated).toBe(false);
    expect(snapshot.has_validation_issues).toBe(true);
    expect(snapshot.quality_overall).toBe(3);
    expect(snapshot.quality_band).toBe("low");

    const serialized = JSON.stringify({ snapshot, envelopes }).toLowerCase();
    expect(serialized.includes("under-specified strategic decision".toLowerCase())).toBe(false);
  });
});
