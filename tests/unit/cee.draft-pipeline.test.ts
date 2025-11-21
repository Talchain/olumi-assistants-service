import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyRequest } from "fastify";
import type { DraftGraphInputT } from "../../src/schemas/assist.js";
import { TelemetrySink } from "../utils/telemetry-sink.js";
import { TelemetryEvents } from "../../src/utils/telemetry.js";
import { CEE_QUALITY_HIGH_MIN, CEE_QUALITY_MEDIUM_MIN } from "../../src/cee/policy.js";
import { CEE_CALIBRATION_CASES, loadCalibrationCase } from "../utils/cee-calibration.js";

// Mocks for underlying draft pipeline and response guards
const runDraftGraphPipelineMock = vi.fn();
const validateResponseMock = vi.fn();

vi.mock("../../src/routes/assist.draft-graph.js", () => ({
  runDraftGraphPipeline: (...args: any[]) => runDraftGraphPipelineMock(...args),
}));

vi.mock("../../src/utils/responseGuards.js", () => ({
  validateResponse: (...args: any[]) => validateResponseMock(...args),
}));

import { finaliseCeeDraftResponse } from "../../src/cee/validation/pipeline.js";

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method: "POST",
    url: "/assist/v1/draft-graph",
    headers: {},
    requestId: "cee-unit-req-1",
    ...overrides,
  } as any;
}

function makeInput(
  overrides: Partial<DraftGraphInputT & { seed?: string; archetype_hint?: string }> = {}
): DraftGraphInputT & { seed?: string; archetype_hint?: string } {
  return {
    brief: "A sufficiently long decision brief for CEE pipeline tests.",
    ...(overrides as any),
  } as DraftGraphInputT & { seed?: string; archetype_hint?: string };
}

describe("CEE draft pipeline - finaliseCeeDraftResponse", () => {
  let telemetrySink: TelemetrySink;

  beforeEach(async () => {
    runDraftGraphPipelineMock.mockReset();
    validateResponseMock.mockReset();

    telemetrySink = new TelemetrySink();
    await telemetrySink.install();
    telemetrySink.clear();
  });

  afterEach(() => {
    telemetrySink.uninstall();
  });

  it("wraps successful pipeline result with CEE metadata (no raw DraftGraphOutput bypass)", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "a", kind: "goal", label: "Test" }],
      edges: [],
      meta: { roots: ["a"], leaves: ["a"], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.8,
        issues: [],
      },
      cost_usd: 0.05,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput({ seed: "cee-unit-seed", archetype_hint: "pricing_decision" });
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);

    expect(statusCode).toBe(200);

    const success = body as any;

    // Always wrapped with CEE trace/quality metadata
    expect(success.trace).toBeDefined();
    expect(success.trace.request_id).toBe("cee-unit-req-1");
    expect(success.trace.correlation_id).toBe("cee-unit-req-1");
    expect(success.trace.engine).toEqual({ provider: "fixtures", model: "fixture-v1" });

    expect(success.quality).toBeDefined();
    expect(typeof success.quality.overall).toBe("number");
    expect(success.quality.overall).toBeGreaterThanOrEqual(1);
    expect(success.quality.overall).toBeLessThanOrEqual(10);

    // validation_issues key should always be present on success payload (may be undefined or array)
    expect("validation_issues" in success).toBe(true);

    // Archetype + seed propagated
    expect(success.archetype.decision_type).toBe("pricing_decision");
    expect(success.archetype.match).toBe("fuzzy");
    expect(success.seed).toBe("cee-unit-seed");
  });

  it("produces low-band quality for golden_under_specified calibration case", async () => {
    const calibration = await loadCalibrationCase(CEE_CALIBRATION_CASES.UNDER_SPECIFIED);
    const { quality_input } = calibration;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph: quality_input.graph,
        patch: { adds: { nodes: [] as any[], edges: [] as any[] }, updates: [], removes: [] },
        rationales: [],
        confidence: quality_input.confidence,
        // Simulate one CEE issue by emitting a single engine issue string; computeQuality only
        // cares about the count of CEE issues, not their codes, so this exercises the same path.
        issues: ["structural_gap"],
      },
      cost_usd: 0.05,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput();
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);

    expect(statusCode).toBe(200);
    const success = body as any;

    const overall: number | undefined = success.quality?.overall;
    expect(typeof overall).toBe("number");

    const band =
      overall! >= CEE_QUALITY_HIGH_MIN
        ? "high"
        : overall! >= CEE_QUALITY_MEDIUM_MIN
          ? "medium"
          : "low";

    expect(band).toBe("low");
  });

  it("converts guard violations into CEE error responses with validation issues", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.6,
      },
      cost_usd: 5.0,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({
      ok: false,
      violation: {
        code: "CAP_EXCEEDED",
        message: "Graph exceeds maximum node count (60 > 50)",
        details: { nodes: 60, max_nodes: 50 },
      },
    });

    const input = makeInput();
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);

    expect(statusCode).toBe(400);

    const error = body as any;
    expect(error.schema).toBe("cee.error.v1");
    expect(error.code).toBe("CEE_GRAPH_INVALID");
    expect(error.retryable).toBe(false);
    expect(error.details).toBeDefined();
    expect(error.details.guard_violation).toMatchObject({ code: "CAP_EXCEEDED" });
    expect(Array.isArray(error.details.validation_issues)).toBe(true);
    expect(error.details.validation_issues[0].code).toBe("CAP_EXCEEDED");
    expect(error.details.validation_issues[0].severity).toBe("error");

    const failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].data.error_code).toBe("CEE_GRAPH_INVALID");
    expect(failedEvents[0].data.http_status).toBe(400);
  });

  it("maps underlying error.v1 codes into CEE error codes", async () => {
    const input = makeInput();
    const req = makeRequest();

    // BAD_INPUT → CEE_VALIDATION_FAILED
    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "error",
      statusCode: 400,
      envelope: { code: "BAD_INPUT", message: "invalid", details: { field: "brief" } },
    });

    let result = await finaliseCeeDraftResponse(input, {}, req);
    let error = result.body as any;
    expect(result.statusCode).toBe(400);
    expect(error.code).toBe("CEE_VALIDATION_FAILED");
    expect(error.retryable).toBe(false);

    let failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].data.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedEvents[0].data.http_status).toBe(400);

    // RATE_LIMITED → CEE_RATE_LIMIT
    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "error",
      statusCode: 429,
      envelope: { code: "RATE_LIMITED", message: "too many", details: { retry_after_seconds: 10 } },
    });

    result = await finaliseCeeDraftResponse(input, {}, req);
    error = result.body as any;
    expect(result.statusCode).toBe(429);
    expect(error.code).toBe("CEE_RATE_LIMIT");
    expect(error.retryable).toBe(true);

    failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(2);
    expect(failedEvents[1].data.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedEvents[1].data.http_status).toBe(429);

    // INTERNAL → CEE_INTERNAL_ERROR
    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "error",
      statusCode: 500,
      envelope: { code: "INTERNAL", message: "boom", details: {} },
    });

    result = await finaliseCeeDraftResponse(input, {}, req);
    error = result.body as any;
    expect(result.statusCode).toBe(500);
    expect(error.code).toBe("CEE_INTERNAL_ERROR");
    expect(error.retryable).toBe(false);

    failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(3);
    expect(failedEvents[2].data.error_code).toBe("CEE_INTERNAL_ERROR");
    expect(failedEvents[2].data.http_status).toBe(500);
  });

  it("returns CEE_INTERNAL_ERROR when pipeline throws", async () => {
    const input = makeInput();
    const req = makeRequest();

    runDraftGraphPipelineMock.mockRejectedValueOnce(new Error("pipeline failed"));

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(500);
    expect(error.schema).toBe("cee.error.v1");
    expect(error.code).toBe("CEE_INTERNAL_ERROR");
    expect(error.retryable).toBe(false);

    const failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].data.error_code).toBe("CEE_INTERNAL_ERROR");
    expect(failedEvents[0].data.http_status).toBe(500);
  });

  it("applies response caps and sets response_limits metadata when lists exceed thresholds", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "n1", kind: "goal", label: "Test" }],
      edges: [],
      meta: { roots: ["n1"], leaves: ["n1"], suggested_positions: {}, source: "assistant" },
    } as any;

    const bias_findings = Array.from({ length: 12 }, (_, i) => ({ id: `bias-${i}` }));
    const options = Array.from({ length: 8 }, (_, i) => ({ id: `opt-${i}` }));
    const evidence_suggestions = Array.from({ length: 25 }, (_, i) => ({ id: `evidence-${i}` }));
    const sensitivity_suggestions = Array.from({ length: 12 }, (_, i) => ({ id: `sens-${i}` }));

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.9,
        issues: [],
        bias_findings,
        options,
        evidence_suggestions,
        sensitivity_suggestions,
      },
      cost_usd: 0.05,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput();
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);

    expect(statusCode).toBe(200);

    const success = body as any;

    expect(Array.isArray(success.bias_findings)).toBe(true);
    expect(success.bias_findings).toHaveLength(10);

    expect(Array.isArray(success.options)).toBe(true);
    expect(success.options).toHaveLength(6);

    expect(Array.isArray(success.evidence_suggestions)).toBe(true);
    expect(success.evidence_suggestions).toHaveLength(20);

    expect(Array.isArray(success.sensitivity_suggestions)).toBe(true);
    expect(success.sensitivity_suggestions).toHaveLength(10);

    expect(success.response_limits).toEqual({
      bias_findings_max: 10,
      bias_findings_truncated: true,
      options_max: 6,
      options_truncated: true,
      evidence_suggestions_max: 20,
      evidence_suggestions_truncated: true,
      sensitivity_suggestions_max: 10,
      sensitivity_suggestions_truncated: true,
    });
  });

  it("does not truncate lists and marks *_truncated flags false when under thresholds", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "n1", kind: "goal", label: "Test" }],
      edges: [],
      meta: { roots: ["n1"], leaves: ["n1"], suggested_positions: {}, source: "assistant" },
    } as any;

    const bias_findings = Array.from({ length: 3 }, (_, i) => ({ id: `bias-${i}` }));
    const options = Array.from({ length: 2 }, (_, i) => ({ id: `opt-${i}` }));
    const evidence_suggestions = Array.from({ length: 5 }, (_, i) => ({ id: `evidence-${i}` }));
    const sensitivity_suggestions = Array.from({ length: 4 }, (_, i) => ({ id: `sens-${i}` }));

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.85,
        issues: [],
        bias_findings,
        options,
        evidence_suggestions,
        sensitivity_suggestions,
      },
      cost_usd: 0.02,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput();
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);

    expect(statusCode).toBe(200);

    const success = body as any;

    expect(success.bias_findings).toHaveLength(3);
    expect(success.options).toHaveLength(2);
    expect(success.evidence_suggestions).toHaveLength(5);
    expect(success.sensitivity_suggestions).toHaveLength(4);

    expect(success.response_limits).toEqual({
      bias_findings_max: 10,
      bias_findings_truncated: false,
      options_max: 6,
      options_truncated: false,
      evidence_suggestions_max: 20,
      evidence_suggestions_truncated: false,
      sensitivity_suggestions_max: 10,
      sensitivity_suggestions_truncated: false,
    });
  });

  it("maps upstream timeout errors to CEE_TIMEOUT and emits failed telemetry", async () => {
    const input = makeInput();
    const req = makeRequest();

    const timeoutError = new Error("upstream timeout");
    (timeoutError as any).name = "UpstreamTimeoutError";

    runDraftGraphPipelineMock.mockRejectedValueOnce(timeoutError);

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(504);
    expect(error.code).toBe("CEE_TIMEOUT");
    expect(error.retryable).toBe(true);

    const failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].data.error_code).toBe("CEE_TIMEOUT");
    expect(failedEvents[0].data.http_status).toBe(504);
  });

  it("propagates engine degraded header into trace and validation issues", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "a", kind: "goal", label: "Test" }],
      edges: [],
      meta: { roots: ["a"], leaves: ["a"], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.7,
        issues: [],
      },
      cost_usd: 0.01,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput();
    const req = makeRequest({ headers: { "x-olumi-degraded": "redis" } as any });

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const success = body as any;

    expect(statusCode).toBe(200);
    expect(success.trace.engine.degraded).toBe(true);
    expect(Array.isArray(success.validation_issues)).toBe(true);
    expect(success.validation_issues[0].code).toBe("ENGINE_DEGRADED");
    expect(success.validation_issues[0].severity).toBe("warning");

    const succeededEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphSucceeded);
    expect(succeededEvents.length).toBe(1);
    expect(typeof succeededEvents[0].data.has_validation_issues).toBe("boolean");
    expect(succeededEvents[0].data.has_validation_issues).toBe(true);
  });

  it("adds CEE_REPRO_MISMATCH warning when repro_mismatch flag is true", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "a", kind: "goal", label: "Test" }],
      edges: [],
      meta: { roots: ["a"], leaves: ["a"], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.9,
        issues: [],
        response_hash: "hash-123",
      },
      cost_usd: 0.03,
      provider: "fixtures",
      model: "fixture-v1",
      repro_mismatch: true,
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput();
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const success = body as any;

    expect(statusCode).toBe(200);
    expect(Array.isArray(success.validation_issues)).toBe(true);
    const reproIssue = success.validation_issues.find((i: any) => i.code === "CEE_REPRO_MISMATCH");
    expect(reproIssue).toBeDefined();
    expect(reproIssue.severity).toBe("warning");

    const succeededEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphSucceeded);
    expect(succeededEvents.length).toBe(1);
    expect(succeededEvents[0].data.has_validation_issues).toBe(true);
  });

  it("maps 503 pipeline errors to CEE_SERVICE_UNAVAILABLE and emits telemetry", async () => {
    const input = makeInput();
    const req = makeRequest();

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "error",
      statusCode: 503,
      envelope: { code: "INTERNAL", message: "engine unavailable", details: {} },
    });

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(503);
    expect(error.code).toBe("CEE_SERVICE_UNAVAILABLE");
    expect(error.retryable).toBe(true);

    const failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].data.error_code).toBe("CEE_SERVICE_UNAVAILABLE");
    expect(failedEvents[0].data.http_status).toBe(503);
  });

  it("uses archetype framework to classify pricing_decision with strong signals as exact match", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal_pricing", kind: "goal", label: "Decide pricing strategy" },
        { id: "opt_premium", kind: "option", label: "Premium pricing" },
      ],
      edges: [],
      meta: { roots: ["goal_pricing"], leaves: ["opt_premium"], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.9,
        issues: [],
      },
      cost_usd: 0.01,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput({
      brief: "We need to decide our pricing for the new SaaS plan.",
      archetype_hint: "pricing_decision",
    });
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const success = body as any;

    expect(statusCode).toBe(200);
    expect(success.archetype).toBeDefined();
    expect(success.archetype.decision_type).toBe("pricing_decision");
    expect(success.archetype.match).toBe("exact");
    expect(typeof success.archetype.confidence).toBe("number");
  });

  it("falls back to generic archetype when hint is unknown", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "goal_generic", kind: "goal", label: "Choose a data visualization library" }],
      edges: [],
      meta: { roots: ["goal_generic"], leaves: ["goal_generic"], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.8,
        issues: [],
      },
      cost_usd: 0.01,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput({
      brief: "Choose a charting library for a dashboard.",
      archetype_hint: "my_custom_type",
    });
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const success = body as any;

    expect(statusCode).toBe(200);
    expect(success.archetype).toBeDefined();
    expect(success.archetype.decision_type).toBe("my_custom_type");
    expect(success.archetype.match).toBe("generic");
  });

  it("respects CEE_DRAFT_ARCHETYPES_ENABLED flag and bypasses framework when disabled", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal_pricing", kind: "goal", label: "Decide pricing strategy" },
        { id: "opt_premium", kind: "option", label: "Premium pricing" },
      ],
      edges: [],
      meta: { roots: ["goal_pricing"], leaves: ["opt_premium"], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.9,
        issues: [],
      },
      cost_usd: 0.01,
      provider: "fixtures",
      model: "fixture-v1",
    });

    validateResponseMock.mockReturnValueOnce({ ok: true });

    // Disable archetypes via env flag
    vi.stubEnv("CEE_DRAFT_ARCHETYPES_ENABLED", "false");

    const input = makeInput({
      brief: "We need to decide our pricing for the new SaaS plan.",
      archetype_hint: "pricing_decision",
    });
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const success = body as any;

    expect(statusCode).toBe(200);
    // Fallback path uses hint + fuzzy match
    expect(success.archetype.decision_type).toBe("pricing_decision");
    expect(success.archetype.match).toBe("fuzzy");

    vi.unstubAllEnvs();
  });
});
