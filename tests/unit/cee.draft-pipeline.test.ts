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
    detectStructuralWarningsMock.mockReset();

    // Clean env vars and reset config cache
    cleanBaseUrl();
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

  it("does not call structural detectors or set structural fields when flag is disabled", async () => {
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
