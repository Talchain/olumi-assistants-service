import { describe, it, expect } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEEBiasCheckResponseV1,
} from "./ceeTypes.js";
import {
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
} from "./ceeHelpers.js";
import { computeEngineCeeActions } from "./examples/ceeEngineOrchestratorExample.js";

function makeHealthyReview(): CeeDecisionReviewPayload {
  const draft: CEEDraftGraphResponseV1 = {
    trace: { request_id: "r-engine-ok", correlation_id: "r-engine-ok", engine: {} },
    quality: { overall: 8 } as any,
    graph: {} as any,
  } as any;

  const options: CEEOptionsResponseV1 = {
    trace: { request_id: "r-engine-ok", correlation_id: "r-engine-ok", engine: {} },
    quality: { overall: 8 } as any,
    options: [{ id: "opt-1" } as any],
  } as any;

  return buildCeeDecisionReviewPayload({ draft, options });
}

function makeRiskyReview(): CeeDecisionReviewPayload {
  const draft: CEEDraftGraphResponseV1 = {
    trace: { request_id: "r-engine-risk", correlation_id: "r-engine-risk", engine: {} },
    quality: { overall: 7 } as any,
    graph: {} as any,
  } as any;

  const bias: CEEBiasCheckResponseV1 = {
    trace: { request_id: "r-engine-risk", correlation_id: "r-engine-risk", engine: {} },
    quality: { overall: 7 } as any,
    bias_findings: [] as any,
    validation_issues: [{ code: "serious_issue", severity: "error" } as any],
  } as any;

  const review = buildCeeDecisionReviewPayload({ draft, bias });

  return review;
}

describe("ceeEngineOrchestratorExample", () => {
  it("derives neutral actions for a healthy, untruncated review", () => {
    const review = makeHealthyReview();

    const actions = computeEngineCeeActions(review);

    expect(actions.healthBand).toBe("ok");
    expect(actions.shouldWarn).toBe(false);
    expect(actions.shouldAutoReRun).toBe(false);
    expect(actions.traceId).toBe(review.trace?.request_id);
  });

  it("escalates actions when CEE reports risk with validation issues", () => {
    const review = makeRiskyReview();

    const actions = computeEngineCeeActions(review);

    expect(actions.healthBand).toBe("risk");
    expect(actions.shouldWarn).toBe(true);
    expect(actions.shouldAutoReRun).toBe(true);
    expect(actions.traceId).toBe(review.trace?.request_id);
  });

  it("never leaks raw graph labels when deriving actions", () => {
    const SECRET = "ENGINE_SECRET_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-engine-secret", correlation_id: "r-engine-secret", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        // Secret marker lives only in the graph label; helpers and the engine
        // wrapper must not surface it in any metadata.
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
    } as any;

    const review = buildCeeDecisionReviewPayload({ draft });
    const actions = computeEngineCeeActions(review);

    const serialized = JSON.stringify({ review, actions }).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
