import { describe, it, expect } from "vitest";
import { OlumiAPIError } from "./errors.js";
import type { ErrorResponse } from "./types.js";
import type { CEEDraftGraphResponseV1 } from "./ceeTypes.js";
import {
  type ScenarioDecision,
  buildScenarioCeeDecisionReviewFromEnvelopes,
} from "./examples/ceeScenarioServiceExample.js";

describe("ceeScenarioServiceExample", () => {
  it("builds a ScenarioCeeDecisionReview with a CEE payload on success", () => {
    const SECRET = "SCENARIO_DO_NOT_LEAK";

    const decision: ScenarioDecision = {
      id: "dec-1",
      title: `Title containing ${SECRET}`,
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-scenario", correlation_id: "r-scenario", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        // Intentionally include a secret marker in a label; helpers and the
        // Scenario wrapper must not surface it in the review payload.
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
    } as any;

    const review = buildScenarioCeeDecisionReviewFromEnvelopes(decision, { draft });

    expect(review.decisionId).toBe(decision.id);
    expect(review.createdAt).toBe(decision.createdAt);
    expect(review.cee).not.toBeNull();
    expect(review.retryable).toBe(false);
    expect(review.traceId).toBe(review.cee?.trace?.request_id);

    const serialized = JSON.stringify(review).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });

  it("maps a CEE rate-limit error into a retryable ScenarioCeeDecisionReview", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_RATE_LIMIT" as any,
      message: "rate limited",
      details: {
        cee_code: "CEE_RATE_LIMIT",
        cee_retryable: true,
        cee_trace: { request_id: "cee_req_rate_limit" },
      },
      request_id: "cee_req_rate_limit",
    };

    const error = new OlumiAPIError(429, body);

    const decision: ScenarioDecision = {
      id: "dec-err",
      title: "Error case",
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    const review = buildScenarioCeeDecisionReviewFromEnvelopes(decision, {}, error);

    expect(review.cee).toBeNull();
    expect(review.retryable).toBe(true);
    expect(review.errorCode).toBe("CEE_RATE_LIMIT");
    expect(review.traceId).toBe("cee_req_rate_limit");
  });

  it("produces coherent uiFlags and journey state for a partial, truncated journey", () => {
    const decision: ScenarioDecision = {
      id: "dec-trunc",
      title: "Truncation case",
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-trunc", correlation_id: "r-trunc", engine: {} },
      quality: { overall: 6 } as any,
      graph: {} as any,
      response_limits: {
        options_max: 6,
        options_truncated: true,
      } as any,
    } as any;

    const review = buildScenarioCeeDecisionReviewFromEnvelopes(decision, { draft });

    expect(review.cee).not.toBeNull();
    if (!review.cee) throw new Error("expected cee payload");

    const { uiFlags, journey, story } = review.cee;

    expect(uiFlags.has_truncation_somewhere).toBe(true);
    expect(journey.health.any_truncated || story.any_truncated).toBe(true);
    expect(journey.is_complete).toBe(false);
    expect(journey.missing_envelopes.length).toBeGreaterThan(0);
  });

  it("treats non-CEE errors as non-retryable by default", () => {
    const decision: ScenarioDecision = {
      id: "dec-plain",
      title: "Plain",
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    const review = buildScenarioCeeDecisionReviewFromEnvelopes(
      decision,
      {},
      new Error("plain"),
    );

    expect(review.cee).toBeNull();
    expect(review.retryable).toBe(false);
    expect(review.errorCode).toBeUndefined();
  });
});
