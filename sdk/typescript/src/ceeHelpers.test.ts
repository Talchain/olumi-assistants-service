import { describe, it, expect } from "vitest";
import {
  buildDecisionStorySummary,
  ceeAnyTruncated,
  getCEEQualityOverall,
  getCEETrace,
  getCEEValidationIssues,
  isRetryableCEEError,
  getCeeErrorMetadata,
  buildCeeErrorViewModel,
  type CeeHealthSummary,
  buildCeeHealthSummary,
  mapCeeHealthStatusToTone,
  buildCeeJourneySummary,
  buildCeeUiFlags,
  type CeeDecisionReviewPayload,
  buildCeeDecisionReviewPayload,
  buildCeeEvidenceCoverageSummary,
  type CeeEvidenceCoverageSummary,
  buildCeeTraceSummary,
  buildCeeErrorView,
  buildCeeIntegrationReviewBundle,
  type CeeTraceSummary,
  type CeeErrorView,
  type CeeIntegrationReviewBundle,
  classifyCeeQuality,
  type CeeQualityBand,
  getCeeErrorCategory,
  type CeeErrorCategory,
  isCeeEmptyGraphError,
  getCeeRecoveryHints,
  shouldRetry,
  buildCeeBiasStructureSnapshot,
  buildCeeCausalValidationStats,
  buildCeeDecisionHealthSnapshot,
  type CeeCausalValidationStats,
  type CeeCausalCoverageLevel,
  type CeeDecisionHealthSnapshot,
} from "./ceeHelpers.js";
import { OlumiAPIError, OlumiNetworkError } from "./errors.js";
import type {
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1,
  CEEBiasCheckResponseV1,
  CEETeamPerspectivesResponseV1,
  CEESensitivityCoachResponseV1,
  CEEExplainGraphResponseV1,
  CEEQualityMeta,
} from "./ceeTypes.js";
import type { ErrorResponse } from "./types.js";

describe("ceeHelpers", () => {
  it("classifyCeeQuality maps overall scores into deterministic bands", () => {
    const makeQuality = (overall: number): CEEQualityMeta => ({ overall } as any);

    const expectBand = (score: number, band: CeeQualityBand | undefined) => {
      expect(classifyCeeQuality(makeQuality(score))).toBe(band);
    };

    expectBand(1, "low_confidence");
    expectBand(3, "low_confidence");
    expectBand(4, "uncertain");
    expectBand(6, "uncertain");
    expectBand(7, "confident");
    expectBand(10, "confident");

    // Non-integer scores are clamped and rounded before banding.
    expectBand(6.6, "confident");
    expectBand(3.7, "uncertain");

    // Missing or invalid quality objects return undefined.
    expect(classifyCeeQuality(undefined)).toBeUndefined();
    expect(classifyCeeQuality(null)).toBeUndefined();
    expect(classifyCeeQuality({ overall: Number.NaN } as any)).toBeUndefined();
  });

  it("extracts trace and overall quality when present", () => {
    const response: CEEOptionsResponseV1 = {
      trace: {
        request_id: "req_1",
        correlation_id: "req_1",
        engine: {},
      },
      quality: {
        overall: 7,
      },
      options: [],
    } as any;

    expect(getCEETrace(response)).toEqual(response.trace);
    expect(getCEEQualityOverall(response)).toBe(7);
  });

  it("handles missing trace/quality defensively", () => {
    const response = {} as Partial<CEEOptionsResponseV1>;

    expect(getCEETrace(response as any)).toBeUndefined();
    expect(getCEEQualityOverall(response as any)).toBeUndefined();
  });

  it("normalizes validation issues to an array", () => {
    const withIssues: CEEOptionsResponseV1 = {
      trace: { request_id: "r1", correlation_id: "r1", engine: {} },
      quality: { overall: 5 },
      validation_issues: [
        {
          code: "test_issue",
          severity: "info",
        } as any,
      ],
      options: [],
    } as any;

    const withoutIssues: CEEOptionsResponseV1 = {
      trace: { request_id: "r2", correlation_id: "r2", engine: {} },
      quality: { overall: 6 },
      options: [],
    } as any;

    expect(getCEEValidationIssues(withIssues).length).toBe(1);
    expect(getCEEValidationIssues(withoutIssues)).toEqual([]);
  });

  it("detects truncation flags from response_limits", () => {
    const response: CEEOptionsResponseV1 = {
      trace: { request_id: "r", correlation_id: "r", engine: {} },
      quality: { overall: 5 },
      options: [],
      response_limits: {
        options_max: 6,
        options_truncated: true,
      },
    } as any;

    expect(ceeAnyTruncated(response)).toBe(true);
  });

  it("detects evidence truncation for draft graph and evidence helper", () => {
    const draftResponse: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r3", correlation_id: "r3", engine: {} },
      quality: { overall: 8 },
      graph: {},
      response_limits: {
        evidence_suggestions_max: 20,
        evidence_suggestions_truncated: true,
      },
    } as any;

    const evidenceResponse: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r4", correlation_id: "r4", engine: {} },
      quality: { overall: 6 },
      items: [],
      response_limits: {
        items_max: 20,
        items_truncated: true,
      },
    } as any;

    expect(ceeAnyTruncated(draftResponse)).toBe(true);
    expect(ceeAnyTruncated(evidenceResponse)).toBe(true);
  });

  it("returns false when no truncation flags are set", () => {
    const response: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r2", correlation_id: "r2", engine: {} },
      quality: { overall: 4 },
      items: [],
      response_limits: {
        items_max: 20,
        items_truncated: false,
      },
    } as any;

    expect(ceeAnyTruncated(response)).toBe(false);
    expect(ceeAnyTruncated(null)).toBe(false);
    expect(ceeAnyTruncated(undefined)).toBe(false);
  });

  it("treats network errors as retryable", () => {
    const err = new OlumiNetworkError("network", { timeout: false });
    expect(isRetryableCEEError(err)).toBe(true);
  });

  it("treats 429 API errors as retryable", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "RATE_LIMITED",
      message: "rate limited",
    };

    const err = new OlumiAPIError(429, body);
    expect(isRetryableCEEError(err)).toBe(true);
  });

  it("uses retryable and cee_retryable hints from details bag", () => {
    const base: ErrorResponse = {
      schema: "error.v1",
      code: "INTERNAL",
      message: "internal",
      details: { retryable: true },
    };

    const err1 = new OlumiAPIError(500, base);
    expect(isRetryableCEEError(err1)).toBe(true);

    const body2: ErrorResponse = {
      schema: "error.v1",
      code: "INTERNAL",
      message: "cee",
      details: { cee_retryable: true },
    } as any;

    const err2 = new OlumiAPIError(500, body2);
    expect(isRetryableCEEError(err2)).toBe(true);
  });

  it("treats CEE service-unavailable errors with cee_retryable hint as retryable", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_SERVICE_UNAVAILABLE" as any,
      message: "service unavailable",
      details: { cee_retryable: true },
    };

    const err = new OlumiAPIError(503, body);
    expect(isRetryableCEEError(err)).toBe(true);
  });

  it("returns false for non-retryable 4xx API errors without hints", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "BAD_INPUT",
      message: "invalid",
    };

    const err = new OlumiAPIError(400, body);
    expect(isRetryableCEEError(err)).toBe(false);
  });

  it("returns false for non-API, non-network errors", () => {
    expect(isRetryableCEEError(new Error("plain"))).toBe(false);
    expect(isRetryableCEEError(null)).toBe(false);
  });

  it("extracts ceeCode and traceId from CEE API errors", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_RATE_LIMIT" as any,
      message: "rate limited",
      details: {
        cee_code: "CEE_RATE_LIMIT",
        cee_retryable: true,
        cee_trace: { request_id: "cee_req_123" },
      },
      request_id: "cee_req_123",
    };

    const err = new OlumiAPIError(429, body);
    const meta = getCeeErrorMetadata(err);

    expect(meta.retryable).toBe(true);
    expect(meta.ceeCode).toBe("CEE_RATE_LIMIT");
    expect(meta.traceId).toBe("cee_req_123");
  });

  it("falls back to generic error code and omits trace when details are absent", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "BAD_INPUT",
      message: "invalid",
    };

    const err = new OlumiAPIError(400, body);
    const meta = getCeeErrorMetadata(err);

    expect(meta.retryable).toBe(false);
    expect(meta.ceeCode).toBe("BAD_INPUT");
    expect(meta.traceId).toBeUndefined();
  });

  it("handles network errors by flagging them as retryable without CEE metadata", () => {
    const networkErr = new OlumiNetworkError("timeout", { timeout: true });
    const meta = getCeeErrorMetadata(networkErr);

    expect(meta.retryable).toBe(true);
    expect(meta.ceeCode).toBeUndefined();
    expect(meta.traceId).toBeUndefined();
  });

  it("suggests retry for retryable CEE errors", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_SERVICE_UNAVAILABLE" as any,
      message: "service unavailable",
      details: { cee_retryable: true, cee_code: "CEE_SERVICE_UNAVAILABLE" },
    };

    const err = new OlumiAPIError(503, body);
    const view = buildCeeErrorViewModel(err);

    expect(view.suggestedAction).toBe("retry");
    expect(view.retryable).toBe(true);
  });

  it("suggests fix_input for validation failures regardless of retryability", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_VALIDATION_FAILED" as any,
      message: "invalid graph",
    };

    const err = new OlumiAPIError(400, body);
    const view = buildCeeErrorViewModel(err);

    expect(view.suggestedAction).toBe("fix_input");
    expect(view.code).toBe("CEE_VALIDATION_FAILED");
  });

  it("defaults to fail for non-retryable, non-validation errors", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_INTERNAL_ERROR" as any,
      message: "boom",
    };

    const err = new OlumiAPIError(500, body);
    const view = buildCeeErrorViewModel(err);

    expect(view.suggestedAction).toBe("fail");
    expect(view.retryable).toBe(false);
  });

  it("classifies CEE_GRAPH_INVALID empty-graph errors and detects them via helper", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_GRAPH_INVALID" as any,
      message: "Draft graph is empty",
      details: {
        cee_code: "CEE_GRAPH_INVALID",
        cee_retryable: false,
        reason: "empty_graph",
        node_count: 0,
        edge_count: 0,
      },
    };

    const err = new OlumiAPIError(400, body);
    const category: CeeErrorCategory = getCeeErrorCategory(err);

    expect(category).toBe("empty_graph");
    expect(isCeeEmptyGraphError(err)).toBe(true);
    expect(shouldRetry(err)).toBe(false);
  });

  it("classifies CEE_GRAPH_INVALID incomplete-structure errors distinctly", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_GRAPH_INVALID" as any,
      message: "Graph does not meet minimum structure requirements",
      details: {
        cee_code: "CEE_GRAPH_INVALID",
        cee_retryable: false,
        reason: "incomplete_structure",
        missing_kinds: ["goal"],
      },
    };

    const err = new OlumiAPIError(400, body);
    const category: CeeErrorCategory = getCeeErrorCategory(err);

    expect(category).toBe("incomplete_structure");
    expect(isCeeEmptyGraphError(err)).toBe(false);
    expect(shouldRetry(err)).toBe(false);
  });

  it("exposes recovery hints when present on the error details", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_GRAPH_INVALID" as any,
      message: "Draft graph is empty",
      details: {
        cee_code: "CEE_GRAPH_INVALID",
        reason: "empty_graph",
        recovery: {
          suggestion: "Add more detail to your decision brief before drafting a model.",
          hints: [
            "State the specific decision you are trying to make.",
            "List 2-3 concrete options you are considering.",
          ],
          example: "Should we build in-house or outsource?",
        },
      },
    };

    const err = new OlumiAPIError(400, body);
    const hints = getCeeRecoveryHints(err);

    expect(hints).toBeDefined();
    expect(hints?.suggestion).toContain("Add more detail");
    expect(hints?.hints && hints.hints.length).toBeGreaterThan(0);
    expect(hints?.example).toContain("build in-house or outsource");
  });

  it("classifies rate/availability errors and aligns shouldRetry with retryable hints", () => {
    const rateLimitedBody: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_RATE_LIMIT" as any,
      message: "CEE rate limit",
      details: { cee_code: "CEE_RATE_LIMIT", cee_retryable: true },
    };
    const rateErr = new OlumiAPIError(429, rateLimitedBody);
    expect(getCeeErrorCategory(rateErr)).toBe("rate_limit");
    expect(shouldRetry(rateErr)).toBe(true);

    const timeoutBody: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_TIMEOUT" as any,
      message: "CEE timeout",
      details: { cee_code: "CEE_TIMEOUT", cee_retryable: true },
    };
    const timeoutErr = new OlumiAPIError(504, timeoutBody);
    expect(getCeeErrorCategory(timeoutErr)).toBe("timeout");
    expect(shouldRetry(timeoutErr)).toBe(true);

    const svcBody: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_SERVICE_UNAVAILABLE" as any,
      message: "CEE unavailable",
      details: { cee_code: "CEE_SERVICE_UNAVAILABLE", cee_retryable: true },
    };
    const svcErr = new OlumiAPIError(503, svcBody);
    expect(getCeeErrorCategory(svcErr)).toBe("service_unavailable");
    expect(shouldRetry(svcErr)).toBe(true);
  });

  it("classifies generic 429 errors as rate_limit and recommends retry", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "RATE_LIMITED",
      message: "Too many requests",
    };

    const err = new OlumiAPIError(429, body);
    expect(getCeeErrorCategory(err)).toBe("rate_limit");
    expect(shouldRetry(err)).toBe(true);
  });

  it("builds a coherent decision story from draft + options + evidence + bias + team", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r1", correlation_id: "r1", engine: {} },
      quality: { overall: 7 } as any,
      graph: { nodes: [{ id: "goal", kind: "goal" }] } as any,
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: false,
        options_max: 6,
        options_truncated: false,
        evidence_suggestions_max: 20,
        evidence_suggestions_truncated: false,
        sensitivity_suggestions_max: 10,
        sensitivity_suggestions_truncated: false,
      },
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r1", correlation_id: "r1", engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt_a" } as any, { id: "opt_b" } as any],
      response_limits: {
        options_max: 6,
        options_truncated: false,
      },
    } as any;

    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r1", correlation_id: "r1", engine: {} },
      quality: { overall: 6 } as any,
      items: [{ id: "e1" } as any, { id: "e2" } as any, { id: "e3" } as any],
      response_limits: {
        items_max: 20,
        items_truncated: false,
      },
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r1", correlation_id: "r1", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [] as any,
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: false,
      },
    } as any;

    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r1", correlation_id: "r1", engine: {} },
      quality: { overall: 7 } as any,
      summary: {
        participant_count: 3,
        for_count: 2,
        against_count: 1,
        neutral_count: 0,
        weighted_for_fraction: 0.66,
        disagreement_score: 0.4,
      } as any,
    } as any;

    const story = buildDecisionStorySummary({ draft, options, evidence, bias, team });

    expect(typeof story.headline).toBe("string");
    expect(story.headline.length).toBeGreaterThan(0);
    expect(story.quality_overall).toBe(7);
    expect(story.key_drivers.length).toBeGreaterThan(0);
    expect(story.next_actions.length).toBeGreaterThan(0);
    expect(typeof story.any_truncated).toBe("boolean");
  });

  it("marks story as truncated and surfaces risks when any response is capped", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r2", correlation_id: "r2", engine: {} },
      quality: { overall: 5 } as any,
      graph: {} as any,
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: true,
        options_max: 6,
        options_truncated: false,
        evidence_suggestions_max: 20,
        evidence_suggestions_truncated: false,
        sensitivity_suggestions_max: 10,
        sensitivity_suggestions_truncated: false,
      },
    } as any;

    const story = buildDecisionStorySummary({ draft });

    expect(story.any_truncated).toBe(true);
    expect(story.risks_and_gaps.some((r) => r.toLowerCase().includes("trunc"))).toBe(true);
  });

  it("still returns a safe default story when responses are missing", () => {
    const story = buildDecisionStorySummary({});

    expect(typeof story.headline).toBe("string");
    expect(story.key_drivers.length).toBeGreaterThanOrEqual(0);
    expect(story.risks_and_gaps.length).toBeGreaterThanOrEqual(0);
    expect(story.next_actions.length).toBeGreaterThanOrEqual(0);
    expect(typeof story.any_truncated).toBe("boolean");
  });

  it("builds an 'ok' health summary for a clean response", () => {
    const response: CEEOptionsResponseV1 = {
      trace: { request_id: "r-ok", correlation_id: "r-ok", engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt-1" } as any],
      response_limits: {
        options_max: 6,
        options_truncated: false,
      } as any,
    } as any;

    const health: CeeHealthSummary = buildCeeHealthSummary("options", response);

    expect(health.status).toBe("ok");
    expect(health.any_truncated).toBe(false);
    expect(health.has_validation_issues).toBe(false);
    expect(health.reasons.length).toBe(0);
    expect(health.quality_overall).toBe(7);
  });

  it("marks health as warning with truncation and adds a truncation reason", () => {
    const response: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-trunc", correlation_id: "r-trunc", engine: {} },
      quality: { overall: 6 } as any,
      items: [{ id: "e1" } as any, { id: "e2" } as any],
      response_limits: {
        items_max: 20,
        items_truncated: true,
      } as any,
    } as any;

    const health: CeeHealthSummary = buildCeeHealthSummary("evidence", response);

    expect(health.any_truncated).toBe(true);
    expect(health.status).toBe("warning");
    expect(health.reasons.some((r) => r.toLowerCase().includes("trunc"))).toBe(true);
  });

  it("escalates health to risk when multiple truncation flags are present", () => {
    const response: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-heavy", correlation_id: "r-heavy", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: true,
        options_max: 6,
        options_truncated: true,
        evidence_suggestions_max: 20,
        evidence_suggestions_truncated: false,
        sensitivity_suggestions_max: 10,
        sensitivity_suggestions_truncated: false,
      },
    } as any;

    const health: CeeHealthSummary = buildCeeHealthSummary("draft", response);

    expect(health.any_truncated).toBe(true);
    expect(health.status).toBe("risk");
  });

  it("escalates to risk when error-level validation issues are present", () => {
    const response: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-risk", correlation_id: "r-risk", engine: {} },
      quality: { overall: 7 } as any,
      bias_findings: [] as any,
      validation_issues: [
        { code: "test_error", severity: "error" } as any,
        { code: "test_warning", severity: "warning" } as any,
      ],
    } as any;

    const health: CeeHealthSummary = buildCeeHealthSummary("bias", response);

    expect(health.has_validation_issues).toBe(true);
    expect(health.status).toBe("risk");
    expect(health.reasons.some((r) => r.toLowerCase().includes("validation"))).toBe(true);
  });

  it("handles minimal envelopes defensively and still returns a summary", () => {
    const minimal = {} as Partial<CEETeamPerspectivesResponseV1>;

    const health: CeeHealthSummary = buildCeeHealthSummary("team", minimal as any);

    expect(["ok", "warning", "risk"]).toContain(health.status);
    expect(health.any_truncated).toBe(false);
    expect(health.has_validation_issues).toBe(false);
    expect(Array.isArray(health.reasons)).toBe(true);
  });

  it("treats info-only validation issues as a warning with a validation reason", () => {
    const response: CEEOptionsResponseV1 = {
      trace: { request_id: "r-info", correlation_id: "r-info", engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt-1" } as any],
      validation_issues: [{ code: "trivial_graph", severity: "info" } as any],
    } as any;

    const health: CeeHealthSummary = buildCeeHealthSummary("options", response);

    expect(health.has_validation_issues).toBe(true);
    expect(["warning", "risk"]).toContain(health.status);
    expect(health.reasons.some((r) => r.toLowerCase().includes("validation"))).toBe(true);
  });

  it("escalates health to risk for very low quality even without validation issues", () => {
    const response: CEEOptionsResponseV1 = {
      trace: { request_id: "r-low", correlation_id: "r-low", engine: {} },
      quality: { overall: 3 } as any,
      options: [{ id: "opt-1" } as any],
    } as any;

    const health: CeeHealthSummary = buildCeeHealthSummary("options", response);
    const tone = mapCeeHealthStatusToTone(health.status);

    expect(health.has_validation_issues).toBe(false);
    expect(health.any_truncated).toBe(false);
    expect(health.status).toBe("risk");
    expect(tone).toBe("danger");
    expect(health.reasons.some((r) => r.toLowerCase().includes("low (3/10)"))).toBe(true);
  });

  it("maps health statuses to display tones deterministically", () => {
    expect(mapCeeHealthStatusToTone("ok")).toBe("success");
    expect(mapCeeHealthStatusToTone("warning")).toBe("warning");
    expect(mapCeeHealthStatusToTone("risk")).toBe("danger");
  });

  it("supports building story and health summaries together for a simple journey", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-doc", correlation_id: "r-doc", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-doc", correlation_id: "r-doc", engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt-1" } as any],
      response_limits: { options_max: 6, options_truncated: false } as any,
    } as any;

    const sensitivity: CEESensitivityCoachResponseV1 = {
      trace: { request_id: "r-doc", correlation_id: "r-doc", engine: {} },
      quality: { overall: 7 } as any,
      suggestions: [] as any,
      response_limits: {
        sensitivity_suggestions_max: 10,
        sensitivity_suggestions_truncated: false,
      } as any,
    } as any;

    const story = buildDecisionStorySummary({ draft, options, sensitivity });
    const health: CeeHealthSummary = buildCeeHealthSummary("options", options);
    const tone = mapCeeHealthStatusToTone(health.status);

    expect(typeof story.headline).toBe("string");
    expect(story.headline.length).toBeGreaterThan(0);
    expect(story.any_truncated).toBe(false);

    expect(health.status).toBe("ok");
    expect(tone).toBe("success");
  });

  it("builds a journey summary with per-envelope health and aggregates overall status and tone", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-journey", correlation_id: "r-journey", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-journey", correlation_id: "r-journey", engine: {} },
      quality: { overall: 6 } as any,
      options: [{ id: "opt-1" } as any],
      validation_issues: [{ code: "trivial_graph", severity: "warning" } as any],
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-journey", correlation_id: "r-journey", engine: {} },
      quality: { overall: 5 } as any,
      bias_findings: [] as any,
      validation_issues: [{ code: "serious_issue", severity: "error" } as any],
    } as any;

    const journey = buildCeeJourneySummary({ draft, options, bias });

    expect(typeof journey.story.headline).toBe("string");
    expect(journey.story.headline.length).toBeGreaterThan(0);

    const per = journey.health.perEnvelope;
    expect(per.draft).toBeDefined();
    expect(per.options).toBeDefined();
    expect(per.bias).toBeDefined();
    expect(per.draft?.source).toBe("draft");
    expect(per.options?.source).toBe("options");
    expect(per.bias?.source).toBe("bias");

    // Bias has an error-level validation issue, so overall status should be escalated to "risk".
    expect(journey.health.overallStatus).toBe("risk");
    expect(journey.health.overallTone).toBe("danger");
    expect(journey.health.has_validation_issues).toBe(true);
    expect(typeof journey.health.any_truncated).toBe("boolean");

    expect(journey.is_complete).toBe(false);
    // At least some envelopes (evidence, sensitivity, team, explain) should be reported missing.
    expect(journey.missing_envelopes.length).toBeGreaterThan(0);
    expect(journey.missing_envelopes).toContain("evidence");
  });

  it("returns a safe journey summary when no envelopes are provided", () => {
    const journey = buildCeeJourneySummary({});

    expect(typeof journey.story.headline).toBe("string");
    expect(journey.story.headline.length).toBeGreaterThan(0);

    expect(Object.keys(journey.health.perEnvelope).length).toBe(0);
    expect(journey.health.overallStatus).toBe("ok");
    expect(journey.health.overallTone).toBe("success");
    expect(journey.health.any_truncated).toBe(false);
    expect(journey.health.has_validation_issues).toBe(false);

    expect(journey.is_complete).toBe(false);
    expect(journey.missing_envelopes.sort()).toEqual(
      ["draft", "explain", "evidence", "options", "bias", "sensitivity", "team"].sort(),
    );
  });

  it("treats a journey with all known envelopes as complete with no missing_envelopes", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-full", correlation_id: "r-full", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const explain: CEEExplainGraphResponseV1 = {
      trace: { request_id: "r-full", correlation_id: "r-full", engine: {} },
      quality: { overall: 7 } as any,
      explanations: [] as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-full", correlation_id: "r-full", engine: {} },
      quality: { overall: 7 } as any,
      options: [] as any,
    } as any;

    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-full", correlation_id: "r-full", engine: {} },
      quality: { overall: 7 } as any,
      items: [] as any,
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-full", correlation_id: "r-full", engine: {} },
      quality: { overall: 7 } as any,
      bias_findings: [] as any,
    } as any;

    const sensitivity: CEESensitivityCoachResponseV1 = {
      trace: { request_id: "r-full", correlation_id: "r-full", engine: {} },
      quality: { overall: 7 } as any,
      suggestions: [] as any,
    } as any;

    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-full", correlation_id: "r-full", engine: {} },
      quality: { overall: 7 } as any,
      summary: {
        participant_count: 3,
        for_count: 2,
        against_count: 1,
        neutral_count: 0,
        weighted_for_fraction: 0.66,
        disagreement_score: 0.3,
      } as any,
    } as any;

    const journey = buildCeeJourneySummary({
      draft,
      explain,
      evidence,
      options,
      bias,
      sensitivity,
      team,
    });

    expect(journey.is_complete).toBe(true);
    expect(journey.missing_envelopes).toEqual([]);
  });

  it("builds a structural draft summary with counts and confidence flags", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-draft", correlation_id: "r-draft", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        nodes: [{ id: "n1", kind: "goal", label: "Should not appear" }],
        edges: [],
      } as any,
      draft_warnings: [
        {
          id: "no_outcome_node",
          severity: "medium",
          node_ids: ["n1"],
          edge_ids: [],
          explanation: "This explanation should not appear in summaries",
        } as any,
      ],
      confidence_flags: {
        uncertain_nodes: ["n1"],
        simplification_applied: true,
      } as any,
    } as any;

    const snapshot = buildCeeBiasStructureSnapshot({ draft });

    expect(snapshot.draft).toBeDefined();
    expect(snapshot.draft?.quality_overall).toBe(7);
    expect(typeof snapshot.draft?.quality_band).toBe("string");
    expect(snapshot.draft?.structural_warning_count).toBe(1);

    const byId = snapshot.draft?.structural_warnings_by_id ?? {};
    expect(byId["no_outcome_node"]).toBeDefined();
    expect(byId["no_outcome_node"].count).toBe(1);
    expect(byId["no_outcome_node"].severity).toBe("medium");

    expect(snapshot.draft?.confidence_flags?.simplification_applied).toBe(true);
    expect(snapshot.draft?.confidence_flags?.uncertain_node_count).toBe(1);
  });

  it("builds a bias summary grouped by severity, category, and code", () => {
    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-bias", correlation_id: "r-bias", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [
        {
          id: "f1",
          category: "selection",
          severity: "high",
          node_ids: [],
          explanation: "Missing options",
          code: "SELECTION_LOW_OPTION_COUNT",
        } as any,
        {
          id: "f2",
          category: "other",
          severity: "medium",
          node_ids: [],
          explanation: "Confirmation bias",
          code: "CONFIRMATION_BIAS",
        } as any,
        {
          id: "f3",
          category: "other",
          severity: "medium",
          node_ids: [],
          explanation: "Sunk cost",
          code: "SUNK_COST",
        } as any,
      ],
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: false,
      } as any,
    } as any;

    const snapshot = buildCeeBiasStructureSnapshot({ bias });

    expect(snapshot.bias).toBeDefined();
    expect(snapshot.bias?.quality_overall).toBe(6);
    expect(typeof snapshot.bias?.quality_band).toBe("string");
    expect(snapshot.bias?.total_findings).toBe(3);

    expect(snapshot.bias?.by_severity.high).toBe(1);
    expect(snapshot.bias?.by_severity.medium).toBe(2);

    expect(snapshot.bias?.by_category.selection).toBe(1);
    expect(snapshot.bias?.by_category.other).toBe(2);

    expect(snapshot.bias?.by_code["SELECTION_LOW_OPTION_COUNT"]).toBe(1);
    expect(snapshot.bias?.by_code["CONFIRMATION_BIAS"]).toBe(1);
    expect(snapshot.bias?.by_code["SUNK_COST"]).toBe(1);
  });

  it("returns a metadata-only snapshot that does not leak free-text labels", () => {
    const SECRET = "CEE_HELPERS_SECRET_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-secret", correlation_id: "r-secret", engine: {} },
      quality: { overall: 5 } as any,
      graph: {
        nodes: [{ id: "n1", kind: "goal", label: `Goal ${SECRET}` }],
        edges: [],
      } as any,
      draft_warnings: [
        {
          id: "no_outcome_node",
          severity: "medium",
          node_ids: ["n1"],
          edge_ids: [],
          explanation: `Explanation ${SECRET}`,
        } as any,
      ],
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-bias-secret", correlation_id: "r-bias-secret", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [
        {
          id: "f1",
          category: "selection",
          severity: "high",
          node_ids: ["n1"],
          explanation: `Bias explanation ${SECRET}`,
          code: "SELECTION_LOW_OPTION_COUNT",
        } as any,
      ],
      response_limits: {
        bias_findings_max: 10,
        bias_findings_truncated: false,
      } as any,
    } as any;

    const snapshot = buildCeeBiasStructureSnapshot({ draft, bias });

    const serialized = JSON.stringify(snapshot).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });

  it("builds causal validation stats from bias findings metadata", () => {
    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-causal", correlation_id: "r-causal", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [
        {
          id: "f1",
          category: "selection",
          severity: "high",
          code: "SELECTION_LOW_OPTION_COUNT",
          causal_validation: {
            identifiable: true,
            strength: 0.8,
            confidence: "high",
          },
          evidence_strength: [
            { causal_support: "strong" },
            { causal_support: "moderate" },
          ],
        } as any,
        {
          id: "f2",
          category: "other",
          severity: "medium",
          code: "CONFIRMATION_BIAS",
          causal_validation: {
            identifiable: false,
            strength: 0.4,
            confidence: "medium",
          },
          evidence_strength: [{ causal_support: "weak" }],
        } as any,
        {
          id: "f3",
          category: "other",
          severity: "low",
          code: "SUNK_COST",
          // No causal_validation block; ensures helper skips it safely.
          evidence_strength: [{ causal_support: "none" }],
        } as any,
      ],
    } as any;

    const stats: CeeCausalValidationStats | null = buildCeeCausalValidationStats({ bias });

    expect(stats).not.toBeNull();
    expect(stats?.total_bias_findings).toBe(3);
    expect(stats?.validated_biases).toBe(2);
    expect(stats?.identifiable_biases).toBe(1);
    expect(stats?.non_identifiable_biases).toBe(1);
    expect(stats?.avg_strength).toBeCloseTo((0.8 + 0.4) / 2);

    expect(stats?.by_confidence.high).toBe(1);
    expect(stats?.by_confidence.medium).toBe(1);

    expect(stats?.evidence_support.strong).toBe(1);
    expect(stats?.evidence_support.moderate).toBe(1);
    expect(stats?.evidence_support.weak).toBe(1);
    expect(stats?.evidence_support.none).toBe(1);
  });

  it("returns null causal stats when no validated metadata is present", () => {
    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-causal-empty", correlation_id: "r-causal-empty", engine: {} },
      quality: { overall: 5 } as any,
      bias_findings: [
        {
          id: "f1",
          category: "selection",
          severity: "high",
          code: "SELECTION_LOW_OPTION_COUNT",
          // No causal_validation or evidence_strength blocks.
        } as any,
      ],
    } as any;

    const stats: CeeCausalValidationStats | null = buildCeeCausalValidationStats({ bias });
    expect(stats).toBeNull();
  });

  it("builds a combined decision health snapshot from bias and causal metadata", () => {
    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-health", correlation_id: "r-health", engine: {} },
      quality: { overall: 6 } as any,
      bias_findings: [
        {
          id: "f1",
          category: "selection",
          severity: "high",
          code: "SELECTION_LOW_OPTION_COUNT",
          causal_validation: {
            identifiable: true,
            strength: 0.9,
            confidence: "high",
          },
          evidence_strength: [{ causal_support: "strong" }],
        } as any,
        {
          id: "f2",
          category: "other",
          severity: "medium",
          code: "CONFIRMATION_BIAS",
          causal_validation: {
            identifiable: false,
            strength: 0.5,
            confidence: "medium",
          },
          evidence_strength: [{ causal_support: "weak" }],
        } as any,
      ],
    } as any;

    const snapshot: CeeDecisionHealthSnapshot = buildCeeDecisionHealthSnapshot({ bias });

    expect(snapshot.bias_structure).not.toBeNull();
    expect(snapshot.bias_structure?.bias?.total_findings).toBe(2);

    expect(snapshot.causal_validation).not.toBeNull();
    expect(snapshot.causal_validation?.total_bias_findings).toBe(2);
    expect(snapshot.causal_validation?.validated_biases).toBe(2);

    expect(snapshot.has_bias_findings).toBe(true);
    expect(snapshot.has_causal_validation).toBe(true);
    expect(snapshot.causal_coverage).toBe<CeeCausalCoverageLevel>("full");
  });

  it("handles missing bias findings or causal stats defensively in decision health snapshot", () => {
    const biasEmpty: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-health-empty", correlation_id: "r-health-empty", engine: {} },
      quality: { overall: 5 } as any,
      bias_findings: [],
    } as any;

    const snapshotEmpty: CeeDecisionHealthSnapshot = buildCeeDecisionHealthSnapshot({ bias: biasEmpty });

    expect(snapshotEmpty.has_bias_findings).toBe(false);
    expect(snapshotEmpty.has_causal_validation).toBe(false);
    expect(snapshotEmpty.causal_coverage).toBeUndefined();
  });

  it("derives UI flags for a healthy, complete journey", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-ui-healthy", correlation_id: "r-ui-healthy", engine: {} },
      quality: { overall: 8 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-ui-healthy", correlation_id: "r-ui-healthy", engine: {} },
      quality: { overall: 8 } as any,
      options: [] as any,
    } as any;

    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-ui-healthy", correlation_id: "r-ui-healthy", engine: {} },
      quality: { overall: 8 } as any,
      summary: {
        participant_count: 3,
        for_count: 3,
        against_count: 0,
        neutral_count: 0,
        weighted_for_fraction: 1,
        disagreement_score: 0,
        has_team_disagreement: false,
      } as any,
    } as any;

    const journey = buildCeeJourneySummary({ draft, options, team });
    const flags = buildCeeUiFlags(journey);

    expect(flags.has_high_risk_envelopes).toBe(false);
    expect(flags.has_team_disagreement).toBe(false);
    expect(flags.has_truncation_somewhere).toBe(false);
    expect(flags.is_journey_complete).toBe(false);
  });

  it("sets has_high_risk_envelopes when any envelope is in risk", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-ui-risk", correlation_id: "r-ui-risk", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-ui-risk", correlation_id: "r-ui-risk", engine: {} },
      quality: { overall: 7 } as any,
      bias_findings: [] as any,
      validation_issues: [{ code: "serious_issue", severity: "error" } as any],
    } as any;

    const journey = buildCeeJourneySummary({ draft, bias });
    const flags = buildCeeUiFlags(journey);

    expect(journey.health.overallStatus).toBe("risk");
    expect(flags.has_high_risk_envelopes).toBe(true);
  });

  it("sets has_truncation_somewhere when any envelope is truncated", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-ui-trunc", correlation_id: "r-ui-trunc", engine: {} },
      quality: { overall: 6 } as any,
      graph: {} as any,
      response_limits: {
        options_max: 6,
        options_truncated: true,
      } as any,
    } as any;

    const journey = buildCeeJourneySummary({ draft });
    const flags = buildCeeUiFlags(journey);

    expect(journey.health.any_truncated || journey.story.any_truncated).toBe(true);
    expect(flags.has_truncation_somewhere).toBe(true);
  });

  it("sets has_team_disagreement when the team envelope reports disagreement", () => {
    const team: CEETeamPerspectivesResponseV1 = {
      trace: { request_id: "r-ui-team", correlation_id: "r-ui-team", engine: {} },
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

    const journey = buildCeeJourneySummary({ team });
    const flags = buildCeeUiFlags(journey);

    expect(journey.has_team_disagreement).toBe(true);
    expect(flags.has_team_disagreement).toBe(true);
  });

  it("builds a decision review payload from a simple journey", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-review", correlation_id: "r-review", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const options: CEEOptionsResponseV1 = {
      trace: { request_id: "r-review", correlation_id: "r-review", engine: {} },
      quality: { overall: 7 } as any,
      options: [{ id: "opt-1" } as any],
    } as any;

    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({
      draft,
      options,
    });

    expect(typeof review.story.headline).toBe("string");
    expect(review.story.headline.length).toBeGreaterThan(0);
    expect(review.journey.health.perEnvelope.draft).toBeDefined();
    expect(review.journey.health.perEnvelope.options).toBeDefined();
    expect(review.uiFlags.is_journey_complete).toBe(false);

    expect(review.trace).toBeDefined();
    expect(review.trace?.request_id).toBe("r-review");
    expect(review.trace?.correlation_id).toBe("r-review");
  });

  it("includes bias_findings from bias envelope in decision review payload", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-bias-test", correlation_id: "r-bias-test", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const bias: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-bias-test", correlation_id: "r-bias-test", engine: {} },
      quality: { overall: 7 } as any,
      bias_findings: [
        {
          code: "OPTIMISM_BIAS",
          severity: "warning",
          message: "The decision model has no risk nodes.",
          confidence: 0.85,
          affected_node_ids: ["goal_1"],
        },
        {
          code: "SELECTION_LOW_COUNT",
          severity: "warning",
          message: "Only 1 option is defined.",
          confidence: 0.92,
        },
      ],
    } as any;

    const review = buildCeeDecisionReviewPayload({ draft, bias });

    expect(review.bias_findings).toBeDefined();
    expect(review.bias_findings).toHaveLength(2);
    expect(review.bias_findings![0].code).toBe("OPTIMISM_BIAS");
    expect(review.bias_findings![0].severity).toBe("warning");
    expect(review.bias_findings![0].confidence).toBe(0.85);
    expect(review.bias_findings![1].code).toBe("SELECTION_LOW_COUNT");
  });

  it("omits bias_findings when bias envelope is empty or missing", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-no-bias", correlation_id: "r-no-bias", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    // No bias envelope
    const reviewNoBias = buildCeeDecisionReviewPayload({ draft });
    expect(reviewNoBias.bias_findings).toBeUndefined();

    // Empty bias_findings array
    const biasEmpty: CEEBiasCheckResponseV1 = {
      trace: { request_id: "r-empty-bias", engine: {} },
      quality: { overall: 7 } as any,
      bias_findings: [],
    } as any;

    const reviewEmptyBias = buildCeeDecisionReviewPayload({ draft, bias: biasEmpty });
    expect(reviewEmptyBias.bias_findings).toBeUndefined();
  });

  it("exposes only metadata in the decision review payload (no raw text leak)", () => {
    const SECRET = "DO_NOT_LEAK_REVIEW";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-secret", correlation_id: "r-secret", engine: {} },
      quality: { overall: 6 } as any,
      graph: {
        // Intentionally include a secret marker in a label to ensure helpers
        // never surface it in the review payload.
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
    } as any;

    const review = buildCeeDecisionReviewPayload({ draft });

    const serialized = JSON.stringify(review).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });

  it("builds an evidence coverage summary from counts and limits", () => {
    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-ev", correlation_id: "r-ev", engine: {} },
      quality: { overall: 7 } as any,
      items: [{ id: "e1" } as any, { id: "e2" } as any, { id: "e3" } as any],
      response_limits: {
        items_max: 20,
        items_truncated: false,
      } as any,
    } as any;

    const summary: CeeEvidenceCoverageSummary = buildCeeEvidenceCoverageSummary({
      evidence,
    });

    expect(summary.returned_count).toBe(3);
    expect(summary.max_items).toBe(20);
    expect(summary.items_truncated).toBe(false);
    expect(summary.coverage_level).toBe("full");
    expect(summary.saturation_ratio).toBeCloseTo(3 / 20);
  });

  it("marks coverage as partial when truncated or fewer items than requested", () => {
    const truncated: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-ev-trunc", correlation_id: "r-ev-trunc", engine: {} },
      quality: { overall: 7 } as any,
      items: new Array(20).fill(null).map((_, i) => ({ id: `e${i + 1}` } as any)),
      response_limits: {
        items_max: 20,
        items_truncated: true,
      } as any,
    } as any;

    const summaryTrunc = buildCeeEvidenceCoverageSummary({ evidence: truncated });
    expect(summaryTrunc.coverage_level).toBe("partial");
    expect(summaryTrunc.items_truncated).toBe(true);

    const nonTrunc: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-ev-req", correlation_id: "r-ev-req", engine: {} },
      quality: { overall: 7 } as any,
      items: [{ id: "e1" } as any, { id: "e2" } as any],
      response_limits: {
        items_max: 20,
        items_truncated: false,
      } as any,
    } as any;

    const summaryRequested = buildCeeEvidenceCoverageSummary({
      evidence: nonTrunc,
      requestedCount: 5,
    });

    expect(summaryRequested.items_truncated).toBe(false);
    expect(summaryRequested.coverage_level).toBe("partial");
    expect(summaryRequested.requested_count).toBe(5);
  });

  it("marks coverage as none when no items are returned", () => {
    const empty: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-ev-empty", correlation_id: "r-ev-empty", engine: {} },
      quality: { overall: 5 } as any,
      items: [],
      response_limits: {
        items_max: 20,
        items_truncated: false,
      } as any,
    } as any;

    const summary = buildCeeEvidenceCoverageSummary({ evidence: empty });

    expect(summary.returned_count).toBe(0);
    expect(summary.coverage_level).toBe("none");
  });

  it("builds a trace summary from trace and engine status", () => {
    const trace = {
      request_id: "req-123",
      correlation_id: "req-123",
      engine: {},
    } as any;

    const engineStatus = {
      provider: "fixtures",
      model: "fixture-v1",
      degraded: true,
    } as any;

    const timestamp = "2025-01-02T03:04:05.000Z";

    const summary: CeeTraceSummary | null = buildCeeTraceSummary({
      trace,
      engineStatus,
      timestamp,
    });

    expect(summary).not.toBeNull();
    expect(summary?.requestId).toBe("req-123");
    expect(summary?.degraded).toBe(true);
    expect(summary?.timestamp).toBe(timestamp);
    expect(summary?.provider).toBe("fixtures");
    expect(summary?.model).toBe("fixture-v1");
  });

  it("returns null trace summary when request_id is missing", () => {
    const trace = {
      correlation_id: "only-corr",
      engine: {},
    } as any;

    const summary = buildCeeTraceSummary({
      trace,
      engineStatus: undefined,
      timestamp: undefined,
    });

    expect(summary).toBeNull();
  });

  it("builds an error view alias matching buildCeeErrorViewModel", () => {
    const body: ErrorResponse = {
      schema: "error.v1",
      code: "CEE_TIMEOUT" as any,
      message: "timeout",
      details: { cee_retryable: true },
    };

    const err = new OlumiAPIError(504, body);

    const vm = buildCeeErrorViewModel(err);
    const view: CeeErrorView = buildCeeErrorView(err);

    expect(view).toEqual(vm);
  });

  it("builds an integration review bundle with sensible defaults", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-bundle", correlation_id: "r-bundle", engine: {} },
      quality: { overall: 7 } as any,
      graph: {} as any,
    } as any;

    const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({ draft });

    const traceSummary: CeeTraceSummary | null = buildCeeTraceSummary({
      trace: draft.trace as any,
      engineStatus: { provider: undefined, model: undefined, degraded: false },
      timestamp: "2025-01-02T03:04:05.000Z",
    });

    const bundle: CeeIntegrationReviewBundle = buildCeeIntegrationReviewBundle({
      review,
      trace: traceSummary,
      error: undefined,
    });

    expect(bundle.review).toEqual(review);
    expect(bundle.trace).toEqual(traceSummary);
    expect(bundle.error).toBeUndefined();
  });

  it("builds an integration review bundle with nulls when args are omitted", () => {
    const bundle: CeeIntegrationReviewBundle = buildCeeIntegrationReviewBundle({});

    expect(bundle.review).toBeNull();
    expect(bundle.trace).toBeNull();
    expect(bundle.error).toBeUndefined();
  });
});
