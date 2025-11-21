import { describe, it, expect } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEETeamPerspectivesResponseV1,
} from "../../sdk/typescript/src/ceeTypes.js";
import { buildCeeDecisionReviewPayload } from "../../sdk/typescript/src/ceeHelpers.js";
import { summarizeReviewForSnapshot } from "../../scripts/cee-health-snapshot.js";
import type { CeeEngineStatus } from "../../sdk/typescript/src/ceeHelpers.js";
import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";

describe("cee-health-snapshot", () => {
  it("summarizes a truncated, partial journey without leaking secrets", () => {
    const SECRET = "SNAPSHOT_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-snap", correlation_id: "r-snap", engine: {} },
      quality: { overall: 6 } as any,
      graph: {
        // Intentionally include a secret marker; helpers and the snapshot must
        // not surface it in the summary.
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
      response_limits: {
        options_max: 6,
        options_truncated: true,
      } as any,
    } as any;

    const review = buildCeeDecisionReviewPayload({ draft });
    const snapshot = summarizeReviewForSnapshot(review, null);

    expect(snapshot.overallStatus).toBeDefined();
    expect(typeof snapshot.overallTone).toBe("string");
    expect(snapshot.any_truncated).toBe(true);
    expect(snapshot.is_journey_complete).toBe(false);
    expect(snapshot.missing_envelopes.length).toBeGreaterThan(0);
    expect(snapshot.uiFlags.has_truncation_somewhere).toBe(true);

    const serialized = JSON.stringify(snapshot).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);

    expectNoSecretLikeKeys(snapshot);
  });

  it("captures team disagreement in the snapshot", () => {
    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-team", correlation_id: "r-team", engine: {} },
      quality: { overall: 7 } as any,
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

    const review = buildCeeDecisionReviewPayload({ team });
    const snapshot = summarizeReviewForSnapshot(review, null);

    expect(snapshot.has_team_disagreement).toBe(true);
    expect(snapshot.uiFlags.has_team_disagreement).toBe(true);
  });

  it("maps per-envelope health into the snapshot", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-draft", correlation_id: "r-draft", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-draft", correlation_id: "r-draft", engine: {} },
      quality: { overall: 6 } as any,
      options: [{ id: "opt-1" } as any],
    } as any;

    const review = buildCeeDecisionReviewPayload({ draft, options });
    const snapshot = summarizeReviewForSnapshot(review, null);

    expect(snapshot.perEnvelope.draft).toBeDefined();
    expect(snapshot.perEnvelope.options).toBeDefined();
    expect(snapshot.perEnvelope.draft?.status).toBe("ok");
  });

  it("surfaces engine degraded status when provided", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-eng", correlation_id: "r-eng", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const review = buildCeeDecisionReviewPayload({ draft });

    const engine: CeeEngineStatus = {
      provider: "fixtures",
      model: "fixture-v1",
      degraded: true,
    };

    const snapshot = summarizeReviewForSnapshot(review, engine);

    expect(snapshot.engine).toBeDefined();
    expect(snapshot.engine?.degraded).toBe(true);
  });
});
