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
  normaliseDecisionBranchBeliefs: (graph: unknown) => graph,
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
      nodes: [
        { id: "goal_1", kind: "goal", label: "Test goal" },
        { id: "dec_1", kind: "decision", label: "Test decision" },
        { id: "opt_1", kind: "option", label: "Test option" },
      ],
      edges: [
        { from: "goal_1", to: "dec_1" },
        { from: "dec_1", to: "opt_1" },
      ],
      meta: { roots: ["goal_1"], leaves: ["opt_1"], suggested_positions: {}, source: "assistant" },
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
      nodes: [
        { id: "goal_1", kind: "goal", label: "Test" },
        { id: "dec_1", kind: "decision", label: "Test decision" },
        { id: "opt_1", kind: "option", label: "Test option" },
      ],
      edges: [
        { from: "goal_1", to: "dec_1" },
        { from: "dec_1", to: "opt_1" },
      ],
      meta: { roots: ["goal_1"], leaves: ["opt_1"], suggested_positions: {}, source: "assistant" },
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
      nodes: [
        { id: "goal_1", kind: "goal", label: "Test" },
        { id: "dec_1", kind: "decision", label: "Test decision" },
        { id: "opt_1", kind: "option", label: "Test option" },
      ],
      edges: [
        { from: "goal_1", to: "dec_1" },
        { from: "dec_1", to: "opt_1" },
      ],
      meta: { roots: ["goal_1"], leaves: ["opt_1"], suggested_positions: {}, source: "assistant" },
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

  it("rejects empty graphs from pipeline as CEE_GRAPH_INVALID with telemetry context", async () => {
    const emptyGraph = {
      version: "1",
      default_seed: 17,
      nodes: [],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph: emptyGraph,
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
        rationales: [],
        confidence: 0.8,
        issues: [],
      },
      cost_usd: 0.01,
      provider: "fixtures",
      model: "fixture-v1",
    });

    // Guard should see ok=true so that the empty-graph invariant handles it
    validateResponseMock.mockReturnValueOnce({ ok: true });

    const input = makeInput();
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(400);
    expect(error.schema).toBe("cee.error.v1");
    expect(error.code).toBe("CEE_GRAPH_INVALID");
    expect(error.retryable).toBe(false);
    expect(error.details).toMatchObject({
      reason: "empty_graph",
      node_count: 0,
      edge_count: 0,
    });

    const failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].data.error_code).toBe("CEE_GRAPH_INVALID");
    expect(failedEvents[0].data.http_status).toBe(400);
    expect(failedEvents[0].data.graph_nodes).toBe(0);
    expect(failedEvents[0].data.graph_edges).toBe(0);
  });

  it("rejects disconnected graphs that meet minimum counts as incomplete_structure", async () => {
    const disconnectedGraph = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal_1", kind: "goal", label: "Test goal" },
        { id: "dec_1", kind: "decision", label: "Test decision" },
        { id: "opt_1", kind: "option", label: "Test option" },
      ],
      // Goal is connected to decision, but option is disconnected so no
      // decision node is connected to both a goal and an option.
      edges: [
        { from: "goal_1", to: "dec_1" },
      ],
      meta: { roots: ["goal_1"], leaves: ["opt_1"], suggested_positions: {}, source: "assistant" },
    } as any;

    runDraftGraphPipelineMock.mockResolvedValueOnce({
      kind: "success",
      payload: {
        graph: disconnectedGraph,
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

    const input = makeInput();
    const req = makeRequest();

    const { statusCode, body } = await finaliseCeeDraftResponse(input, {}, req);
    const error = body as any;

    expect(statusCode).toBe(400);
    expect(error.schema).toBe("cee.error.v1");
    expect(error.code).toBe("CEE_GRAPH_INVALID");
    expect(error.retryable).toBe(false);
    expect(error.details).toMatchObject({
      reason: "incomplete_structure",
      node_count: 3,
      edge_count: 1,
    });
    expect(Array.isArray(error.details.missing_kinds)).toBe(true);

    const failedEvents = telemetrySink.getEventsByName(TelemetryEvents.CeeDraftGraphFailed);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].data.error_code).toBe("CEE_GRAPH_INVALID");
    expect(failedEvents[0].data.http_status).toBe(400);
    expect(failedEvents[0].data.graph_nodes).toBe(3);
    expect(failedEvents[0].data.graph_edges).toBe(1);
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

  it("respects archetype hint when provided", async () => {
    const graph = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal_pricing", kind: "goal", label: "Decide pricing strategy" },
        { id: "dec_pricing", kind: "decision", label: "Choose pricing approach" },
        { id: "opt_premium", kind: "option", label: "Premium pricing" },
      ],
      edges: [
        { from: "goal_pricing", to: "dec_pricing" },
        { from: "dec_pricing", to: "opt_premium" },
      ],
      meta: { roots: ["goal_pricing"], leaves: ["opt_premium"], suggested_positions: {}, source: "assistant" },
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
        { id: "dec_pricing", kind: "decision", label: "Choose pricing approach" },
        { id: "opt_premium", kind: "option", label: "Premium pricing" },
      ],
      edges: [
        { from: "goal_pricing", to: "dec_pricing" },
        { from: "dec_pricing", to: "opt_premium" },
      ],
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
