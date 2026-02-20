import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyRequest } from "fastify";
import type { DraftGraphInputT } from "../../src/schemas/assist.js";
import { TelemetrySink } from "../utils/telemetry-sink.js";
import { TelemetryEvents } from "../../src/utils/telemetry.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

// Mocks for underlying draft pipeline, structural helpers, and response guards
const runDraftGraphPipelineMock = vi.fn();
const validateResponseMock = vi.fn();
const detectStructuralWarningsMock = vi.fn();

vi.mock("../../src/routes/assist.draft-graph.js", () => ({
  runDraftGraphPipeline: (...args: any[]) => runDraftGraphPipelineMock(...args),
}));

vi.mock("../../src/utils/responseGuards.js", () => ({
  validateResponse: (...args: any[]) => validateResponseMock(...args),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: (...args: any[]) => detectStructuralWarningsMock(...args),
  detectUniformStrengths: () => ({
    detected: false,
    totalEdges: 0,
    defaultStrengthCount: 0,
    defaultStrengthPercentage: 0,
  }),
  normaliseDecisionBranchBeliefs: (graph: unknown) => graph,
  validateAndFixGraph: (graph: unknown) => ({
    graph,
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  }),
  hasGoalNode: (graph: any) => {
    if (!graph || !Array.isArray(graph.nodes)) return false;
    return graph.nodes.some((n: any) => n.kind === "goal");
  },
  ensureGoalNode: (graph: any, _brief: string, _explicitGoal?: string) => ({
    graph,
    goalAdded: false,
    inferredFrom: undefined,
    goalNodeId: undefined,
  }),
  wireOutcomesToGoal: (graph: any, _goalId: string) => graph,
  detectStrengthClustering: () => ({
    detected: false,
    edgeCount: 0,
    coefficientOfVariation: undefined,
    warning: undefined,
  }),
  detectSameLeverOptions: () => ({
    detected: false,
    maxOverlapPercentage: undefined,
    warning: undefined,
  }),
  detectMissingBaseline: () => ({
    detected: false,
    hasBaseline: true,
    warning: undefined,
  }),
  detectGoalNoBaselineValue: () => ({
    detected: false,
    goalHasValue: true,
    goalNodeId: undefined,
    warning: undefined,
  }),
  detectZeroExternalFactors: () => ({
    detected: false,
    factorCount: 0,
    externalCount: 0,
  }),
  checkGoalConnectivity: () => ({
    status: "full" as const,
    disconnectedOptions: [],
    weakPaths: [],
    warning: undefined,
  }),
  computeModelQualityFactors: () => ({
    estimate_confidence: 0.5,
    strength_variation: 0,
    range_confidence_coverage: 0,
    has_baseline_option: false,
  }),
}));

import { finaliseCeeDraftResponse } from "../../src/cee/validation/pipeline.js";
import { UpstreamNonJsonError, UpstreamHTTPError } from "../../src/adapters/llm/errors.js";

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method: "POST",
    url: "/assist/v1/draft-graph",
    headers: {},
    requestId: "upstream-err-test-1",
    ...overrides,
  } as any;
}

function makeInput(
  overrides: Partial<DraftGraphInputT & { seed?: string; archetype_hint?: string }> = {}
): DraftGraphInputT & { seed?: string; archetype_hint?: string } {
  return {
    brief: "A sufficiently long decision brief for upstream error tests.",
    ...(overrides as any),
  } as DraftGraphInputT & { seed?: string; archetype_hint?: string };
}

describe("CEE upstream error handling", () => {
  let telemetrySink: TelemetrySink;

  beforeEach(async () => {
    runDraftGraphPipelineMock.mockReset();
    validateResponseMock.mockReset();
    detectStructuralWarningsMock.mockReset();

    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();

    telemetrySink = new TelemetrySink();
    await telemetrySink.install();
    telemetrySink.clear();
  });

  afterEach(async () => {
    telemetrySink.uninstall();
    vi.unstubAllEnvs();
    cleanBaseUrl();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
  });

  // Test 1: UpstreamNonJsonError construction
  it("UpstreamNonJsonError has all fields accessible and correct name", () => {
    const err = new UpstreamNonJsonError(
      "openai draft_graph returned non-JSON response",
      "openai",
      "draft_graph",
      5000,
      "<html>Server Error</html>",
      "text/html",
      422,
      "req-123",
      new SyntaxError("Unexpected token <"),
    );

    expect(err.name).toBe("UpstreamNonJsonError");
    expect(err.message).toBe("openai draft_graph returned non-JSON response");
    expect(err.provider).toBe("openai");
    expect(err.operation).toBe("draft_graph");
    expect(err.elapsedMs).toBe(5000);
    expect(err.bodyPreview).toBe("<html>Server Error</html>");
    expect(err.contentType).toBe("text/html");
    expect(err.upstreamStatus).toBe(422);
    expect(err.upstreamRequestId).toBe("req-123");
    expect(err.cause).toBeInstanceOf(SyntaxError);
    expect(err).toBeInstanceOf(Error);
  });

  // Test 2: When upstream returns HTML 422, CEE returns JSON 502
  it("maps UpstreamNonJsonError (HTML 422) to 502 CEE_LLM_UPSTREAM_ERROR", async () => {
    const input = makeInput();
    const req = makeRequest();

    const htmlBody = "<!DOCTYPE html><html><body><h1>422 Unprocessable Entity</h1></body></html>";
    const nonJsonError = new UpstreamNonJsonError(
      "openai draft_graph returned non-JSON response",
      "openai",
      "draft_graph",
      60000,
      htmlBody.slice(0, 500),
      "text/html",
      422,
      "req-html-422",
    );

    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);
    // Second attempt (retry) also fails
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(502);
    expect(error.code).toBe("CEE_LLM_UPSTREAM_ERROR");
    expect(typeof error).toBe("object");
    expect(error.schema).toBe("cee.error.v1");
  });

  // Test 3: When upstream returns plain text 500, CEE returns JSON 502
  it("maps UpstreamNonJsonError (plain text 500) to 502 CEE_LLM_UPSTREAM_ERROR", async () => {
    const input = makeInput();
    const req = makeRequest();

    const plainTextBody = "Internal Server Error: The service is temporarily unavailable.";
    const nonJsonError = new UpstreamNonJsonError(
      "openai draft_graph returned non-JSON response",
      "openai",
      "draft_graph",
      45000,
      plainTextBody,
      "text/plain",
      500,
      "req-plain-500",
    );

    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(502);
    expect(error.code).toBe("CEE_LLM_UPSTREAM_ERROR");
    expect(typeof error).toBe("object");
    expect(error.schema).toBe("cee.error.v1");
  });

  // Test 4: upstream_body_preview is max 500 chars (truncated in constructor)
  it("body preview is truncated to 500 chars in UpstreamNonJsonError", () => {
    const longContent = "x".repeat(1000);
    const err = new UpstreamNonJsonError(
      "test",
      "openai",
      "draft_graph",
      1000,
      longContent.slice(0, 500), // safeParseJson slices to 500
    );

    expect(err.bodyPreview.length).toBe(500);
  });

  // Test 5: upstream_content_type is captured in error details
  it("captures upstream_content_type in error response details", async () => {
    const input = makeInput();
    const req = makeRequest();

    const nonJsonError = new UpstreamNonJsonError(
      "openai draft_graph returned non-JSON response",
      "openai",
      "draft_graph",
      5000,
      "<html>Error</html>",
      "text/html",
      422,
    );

    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);

    const { body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(error.details).toBeDefined();
    expect(error.details.upstream_content_type).toBe("text/html");
    expect(error.details.provider).toBe("openai");
    expect(error.details.elapsed_ms).toBe(5000);
    expect(error.details.upstream_body_preview).toBe("<html>Error</html>");
  });

  // Test 6: HTTP status is 502 not 422 for upstream failures
  it("returns HTTP 502 (not the upstream's 422) for UpstreamNonJsonError", async () => {
    const input = makeInput();
    const req = makeRequest();

    const nonJsonError = new UpstreamNonJsonError(
      "openai draft_graph returned non-JSON response",
      "openai",
      "draft_graph",
      5000,
      "Error",
      undefined,
      422,
    );

    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);

    const { statusCode } = await finaliseCeeDraftResponse(input, {}, req);

    // Must be 502 Bad Gateway, not the upstream's 422
    expect(statusCode).toBe(502);
    expect(statusCode).not.toBe(422);
  });

  // Test 7: retryable: true for transient upstream errors
  it("sets retryable: true for UpstreamNonJsonError", async () => {
    const input = makeInput();
    const req = makeRequest();

    const nonJsonError = new UpstreamNonJsonError(
      "openai draft_graph returned non-JSON response",
      "openai",
      "draft_graph",
      5000,
      "Error",
    );

    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);

    const { body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(error.retryable).toBe(true);
  });

  // Test 8: UpstreamHTTPError → 502 (not 500)
  it("maps UpstreamHTTPError to 502 CEE_LLM_UPSTREAM_ERROR (not 500)", async () => {
    const input = makeInput();
    const req = makeRequest();

    const httpError = new UpstreamHTTPError(
      "OpenAI API returned HTTP 422",
      "openai",
      422,
      "invalid_request_error",
      "req-http-422",
      60000,
    );

    runDraftGraphPipelineMock.mockRejectedValueOnce(httpError);

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(502);
    expect(error.code).toBe("CEE_LLM_UPSTREAM_ERROR");
    expect(error.retryable).toBe(true);
    expect(error.details).toBeDefined();
    expect(error.details.upstream_status).toBe(422);
    expect(error.details.provider).toBe("openai");
    expect(error.details.upstream_error_code).toBe("invalid_request_error");
  });

  // Test 9: UpstreamNonJsonError triggers retry then 502
  it("retries once on UpstreamNonJsonError then returns 502", async () => {
    const input = makeInput();
    const req = makeRequest();

    const nonJsonError = new UpstreamNonJsonError(
      "openai draft_graph returned non-JSON response",
      "openai",
      "draft_graph",
      5000,
      "<html>Error</html>",
    );

    // Both attempts fail
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(502);
    expect(error.code).toBe("CEE_LLM_UPSTREAM_ERROR");

    // Verify the pipeline was called twice (original + 1 retry)
    expect(runDraftGraphPipelineMock).toHaveBeenCalledTimes(2);
  });

  // Test 10: All error paths return Content-Type: application/json (body is a JSON object)
  it("all upstream error responses are JSON-serialisable objects with cee.error.v1 schema", async () => {
    const input = makeInput();
    const req = makeRequest();

    // Test UpstreamNonJsonError
    const nonJsonError = new UpstreamNonJsonError(
      "test non-json",
      "openai",
      "draft_graph",
      1000,
      "not json",
    );
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);
    runDraftGraphPipelineMock.mockRejectedValueOnce(nonJsonError);

    const result1 = await finaliseCeeDraftResponse(input, {}, req);
    const body1 = result1.body as any;

    // Verify it's a valid JSON-serialisable object
    expect(() => JSON.stringify(body1)).not.toThrow();
    expect(body1.schema).toBe("cee.error.v1");
    expect(body1.source).toBe("cee");
    expect(typeof body1.code).toBe("string");
    expect(typeof body1.message).toBe("string");
    expect(typeof body1.retryable).toBe("boolean");

    // Test UpstreamHTTPError
    runDraftGraphPipelineMock.mockReset();
    const httpError = new UpstreamHTTPError(
      "test http error",
      "openai",
      500,
      undefined,
      undefined,
      2000,
    );
    runDraftGraphPipelineMock.mockRejectedValueOnce(httpError);

    const result2 = await finaliseCeeDraftResponse(input, {}, req);
    const body2 = result2.body as any;

    expect(() => JSON.stringify(body2)).not.toThrow();
    expect(body2.schema).toBe("cee.error.v1");
    expect(body2.source).toBe("cee");
    expect(typeof body2.code).toBe("string");
    expect(typeof body2.message).toBe("string");
    expect(typeof body2.retryable).toBe("boolean");
  });
});
