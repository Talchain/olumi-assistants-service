/**
 * Stage 5: Package — Unit Tests
 *
 * Verifies archetype inference, quality computation, response caps,
 * structural warnings, guidance, V1 response assembly, verification pipeline,
 * pipeline trace assembly, and graph frozen invariant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      draftArchetypesEnabled: true,
      draftStructuralWarningsEnabled: true,
      pipelineCheckpointsEnabled: false,
    },
  },
  isProduction: vi.fn().mockReturnValue(false),
}));

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

// Mock archetypes
vi.mock("../../src/cee/archetypes/index.js", () => ({
  inferArchetype: vi.fn(),
}));

// Mock quality
vi.mock("../../src/cee/quality/index.js", () => ({
  computeQuality: vi.fn(),
}));

// Mock bias
vi.mock("../../src/cee/bias/index.js", () => ({
  sortBiasFindings: vi.fn(),
}));

// Mock response caps
vi.mock("../../src/cee/transforms/response-caps.js", () => ({
  applyResponseCaps: vi.fn(),
}));

// Mock guidance
vi.mock("../../src/cee/guidance/index.js", () => ({
  ceeAnyTruncated: vi.fn(),
  buildCeeGuidance: vi.fn(),
}));

// Mock structure
vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn(),
  detectUniformStrengths: vi.fn(),
  detectStrengthClustering: vi.fn(),
  detectSameLeverOptions: vi.fn(),
  detectMissingBaseline: vi.fn(),
  detectGoalNoBaselineValue: vi.fn(),
  detectZeroExternalFactors: vi.fn(),
  checkGoalConnectivity: vi.fn(),
  computeModelQualityFactors: vi.fn(),
}));

// Mock verification pipeline
vi.mock("../../src/cee/verification/index.js", () => ({
  verificationPipeline: {
    verify: vi.fn(),
  },
}));

// Mock schema
vi.mock("../../src/schemas/ceeResponses.js", () => ({
  CEEDraftGraphResponseV1Schema: {},
}));

// Mock validation pipeline
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: vi.fn(),
}));

// Mock pipeline checkpoints
vi.mock("../../src/cee/pipeline-checkpoints.js", () => ({
  captureCheckpoint: vi.fn(),
  applyCheckpointSizeGuard: vi.fn(),
  assembleCeeProvenance: vi.fn(),
}));

// Mock LLM output store
vi.mock("../../src/cee/llm-output-store.js", () => ({
  buildLLMRawTrace: vi.fn(),
}));

// Mock version
vi.mock("../../src/version.js", () => ({
  SERVICE_VERSION: "1.0.0-test",
}));

import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { config, isProduction } from "../../src/config/index.js";
import { inferArchetype } from "../../src/cee/archetypes/index.js";
import { computeQuality } from "../../src/cee/quality/index.js";
import { sortBiasFindings } from "../../src/cee/bias/index.js";
import { applyResponseCaps } from "../../src/cee/transforms/response-caps.js";
import { ceeAnyTruncated, buildCeeGuidance } from "../../src/cee/guidance/index.js";
import {
  detectStructuralWarnings,
  detectUniformStrengths,
  detectStrengthClustering,
  detectSameLeverOptions,
  detectMissingBaseline,
  detectGoalNoBaselineValue,
  detectZeroExternalFactors,
  checkGoalConnectivity,
  computeModelQualityFactors,
} from "../../src/cee/structure/index.js";
import { verificationPipeline } from "../../src/cee/verification/index.js";
import { CEEDraftGraphResponseV1Schema } from "../../src/schemas/ceeResponses.js";
import { buildCeeErrorResponse } from "../../src/cee/validation/pipeline.js";
import { captureCheckpoint, applyCheckpointSizeGuard, assembleCeeProvenance } from "../../src/cee/pipeline-checkpoints.js";
import { buildLLMRawTrace } from "../../src/cee/llm-output-store.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseGraph = {
  nodes: [
    { id: "g1", kind: "goal", label: "Goal" },
    { id: "o1", kind: "option", label: "Option A" },
    { id: "f1", kind: "factor", label: "Factor A", category: "controllable" },
  ],
  edges: [
    { id: "e1", from: "o1", to: "g1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
    { id: "e2", from: "f1", to: "o1", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.8, effect_direction: "positive" },
  ],
  version: "1.2",
  default_seed: 42,
};

const defaultQuality = { level: "moderate", score: 0.65, factors: {} };
const defaultLimits = {
  bias_findings_max: 10, bias_findings_truncated: false,
  options_max: 10, options_truncated: false,
  evidence_suggestions_max: 10, evidence_suggestions_truncated: false,
  sensitivity_suggestions_max: 10, sensitivity_suggestions_truncated: false,
};
const defaultGuidance = { recommendations: [] };

function makeCtx(overrides?: Partial<Record<string, any>>): any {
  return {
    requestId: "test-req-5",
    graph: structuredClone(baseGraph),
    input: { brief: "Test brief", seed: "abc123" },
    opts: { schemaVersion: "v3" as const, strictMode: false, includeDebug: false, unsafeCaptureEnabled: false },
    start: Date.now() - 1000,
    confidence: 0.75,
    rationales: [],
    goalConstraints: undefined,
    draftAdapter: { name: "openai", model: "gpt-4o" },
    llmMeta: {
      prompt_version: "v42",
      prompt_hash: "abc123",
      model: "gpt-4o",
      temperature: 0.3,
      token_usage: { input: 100, output: 200 },
      finish_reason: "stop",
      provider_latency_ms: 500,
      raw_llm_text: undefined,
      prompt_source: "store",
      prompt_store_version: 42,
    },
    strpResult: undefined,
    constraintStrpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentTrace: undefined,
    repairTrace: undefined,
    collector: { hasCorrections: vi.fn().mockReturnValue(false), getCorrections: vi.fn(), getSummary: vi.fn() },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    validationSummary: undefined,
    structuralMeta: undefined,
    clarifierResult: undefined,
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: undefined,
    earlyReturn: undefined,
    ...overrides,
  };
}

function setupDefaultMocks() {
  (inferArchetype as any).mockReturnValue({
    archetype: { decision_type: "investment", match: "exact", confidence: 0.75 },
    issues: [],
  });

  (computeQuality as any).mockReturnValue(defaultQuality);

  (applyResponseCaps as any).mockImplementation((payload: any) => ({
    cappedPayload: { ...payload },
    limits: { ...defaultLimits },
  }));

  (ceeAnyTruncated as any).mockReturnValue(false);
  (buildCeeGuidance as any).mockReturnValue(defaultGuidance);

  (detectStructuralWarnings as any).mockReturnValue({ warnings: [], uncertainNodeIds: [] });
  (detectUniformStrengths as any).mockReturnValue({ detected: false });
  (detectStrengthClustering as any).mockReturnValue({ detected: false });
  (detectSameLeverOptions as any).mockReturnValue({ detected: false });
  (detectMissingBaseline as any).mockReturnValue({ detected: false });
  (detectGoalNoBaselineValue as any).mockReturnValue({ detected: false });
  (detectZeroExternalFactors as any).mockReturnValue({ detected: false, factorCount: 0, externalCount: 0 });
  (checkGoalConnectivity as any).mockReturnValue({ status: "connected", disconnectedOptions: [], weakPaths: [] });
  (computeModelQualityFactors as any).mockReturnValue({});

  (verificationPipeline.verify as any).mockImplementation((resp: any) => ({
    response: { ...resp },
  }));

  (captureCheckpoint as any).mockReturnValue({ stage: "post_stabilisation", node_count: 3, edge_count: 2 });
  (applyCheckpointSizeGuard as any).mockImplementation((cps: any) => cps);
  (assembleCeeProvenance as any).mockReturnValue({ pipelinePath: "unified" });
  (buildLLMRawTrace as any).mockReturnValue({ stored: true });
  (buildCeeErrorResponse as any).mockImplementation((code: string, msg: string) => ({ error: { code, message: msg } }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runStagePackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (config.cee as any).draftArchetypesEnabled = true;
    (config.cee as any).draftStructuralWarningsEnabled = true;
    (config.cee as any).pipelineCheckpointsEnabled = false;
    (isProduction as any).mockReturnValue(false);
    setupDefaultMocks();
  });

  // ── Basic flow ──────────────────────────────────────────────────────────

  it("returns early when ctx.graph is undefined", async () => {
    const ctx = makeCtx({ graph: undefined });
    await runStagePackage(ctx);
    expect(computeQuality).not.toHaveBeenCalled();
    expect(ctx.ceeResponse).toBeUndefined();
  });

  it("produces ceeResponse and pipelineTrace on success", async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(ctx.ceeResponse).toBeDefined();
    expect(ctx.pipelineTrace).toBeDefined();
    expect(ctx.quality).toEqual(defaultQuality);
  });

  // ── Archetype inference ─────────────────────────────────────────────────

  it("calls inferArchetype when draftArchetypesEnabled = true", async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(inferArchetype).toHaveBeenCalledTimes(1);
    expect(inferArchetype).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: "Test brief",
        graph: ctx.graph,
        engineConfidence: 0.75,
      }),
    );
    expect(ctx.archetype).toEqual(expect.objectContaining({ decision_type: "investment" }));
  });

  it("falls back to generic archetype when draftArchetypesEnabled = false", async () => {
    (config.cee as any).draftArchetypesEnabled = false;
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(inferArchetype).not.toHaveBeenCalled();
    expect(ctx.archetype).toEqual(
      expect.objectContaining({ decision_type: "generic", match: "generic" }),
    );
  });

  it("uses archetype_hint for fallback when present", async () => {
    (config.cee as any).draftArchetypesEnabled = false;
    const ctx = makeCtx({ input: { brief: "Test", archetype_hint: "hiring", seed: "abc" } });
    await runStagePackage(ctx);

    expect(ctx.archetype).toEqual(
      expect.objectContaining({ decision_type: "hiring", match: "fuzzy" }),
    );
  });

  // ── Quality computation ─────────────────────────────────────────────────

  it("calls computeQuality with graph, confidence, and ceeIssues", async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(computeQuality).toHaveBeenCalledTimes(1);
    expect(computeQuality).toHaveBeenCalledWith(
      expect.objectContaining({
        graph: ctx.graph,
        confidence: 0.75,
        engineIssueCount: 0,
        ceeIssues: expect.any(Array),
      }),
    );
  });

  it("quality is recomputed (not reused from earlier stages)", async () => {
    const ctx = makeCtx({ quality: { level: "stale", score: 0.1 } });
    await runStagePackage(ctx);

    // computeQuality is called and ctx.quality is overwritten
    expect(computeQuality).toHaveBeenCalledTimes(1);
    expect(ctx.quality).toEqual(defaultQuality);
  });

  // ── Response caps ───────────────────────────────────────────────────────

  it("calls applyResponseCaps with the constructed payload", async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(applyResponseCaps).toHaveBeenCalledTimes(1);
    expect(applyResponseCaps).toHaveBeenCalledWith(
      expect.objectContaining({
        graph: ctx.graph,
        rationales: [],
        confidence: 0.75,
      }),
    );
  });

  // ── Structural warnings ─────────────────────────────────────────────────

  it("collects structural warnings when draftStructuralWarningsEnabled = true", async () => {
    (detectStructuralWarnings as any).mockReturnValue({
      warnings: [{ code: "W001", message: "test warning" }],
      uncertainNodeIds: [],
    });
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(detectStructuralWarnings).toHaveBeenCalledTimes(1);
    expect(ctx.draftWarnings).toContainEqual(expect.objectContaining({ code: "W001" }));
  });

  it("skips detectStructuralWarnings when flag = false (detectors still run)", async () => {
    (config.cee as any).draftStructuralWarningsEnabled = false;
    const ctx = makeCtx();
    await runStagePackage(ctx);

    // detectStructuralWarnings gated behind config flag
    expect(detectStructuralWarnings).not.toHaveBeenCalled();
    // But ungated detectors still run
    expect(detectUniformStrengths).toHaveBeenCalledTimes(1);
    expect(detectStrengthClustering).toHaveBeenCalledTimes(1);
  });

  it("adds uniform strength warning when detected", async () => {
    (detectUniformStrengths as any).mockReturnValue({
      detected: true,
      warning: { code: "UNIFORM_STRENGTH", message: "all edges same strength" },
    });
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(ctx.draftWarnings).toContainEqual(expect.objectContaining({ code: "UNIFORM_STRENGTH" }));
  });

  it("adds zero_external_factors warning when detected", async () => {
    (detectZeroExternalFactors as any).mockReturnValue({
      detected: true,
      factorCount: 3,
      externalCount: 0,
      warning: { id: "zero_external_factors", severity: "medium", explanation: "No external factors" },
    });
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(ctx.draftWarnings).toContainEqual(
      expect.objectContaining({ id: "zero_external_factors", severity: "medium" }),
    );
  });

  it("does not add zero_external_factors warning when not detected", async () => {
    (detectZeroExternalFactors as any).mockReturnValue({
      detected: false,
      factorCount: 3,
      externalCount: 1,
    });
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(ctx.draftWarnings).not.toContainEqual(
      expect.objectContaining({ id: "zero_external_factors" }),
    );
  });

  // ── V1 response assembly ────────────────────────────────────────────────

  it("assembles V1 response with required fields", async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    const resp = ctx.ceeResponse as any;
    expect(resp).toBeDefined();
    expect(resp.graph).toBeDefined();
    expect(resp.trace).toBeDefined();
    expect(resp.quality).toEqual(defaultQuality);
    expect(resp.guidance).toEqual(defaultGuidance);
    expect(resp.seed).toBe("abc123");
  });

  // ── Verification pipeline ──────────────────────────────────────────────

  it("calls verificationPipeline.verify with CEEDraftGraphResponseV1Schema", async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(verificationPipeline.verify).toHaveBeenCalledTimes(1);
    expect(verificationPipeline.verify).toHaveBeenCalledWith(
      expect.any(Object),
      CEEDraftGraphResponseV1Schema,
      expect.objectContaining({
        endpoint: "draft-graph",
        requiresEngineValidation: false,
        requestId: "test-req-5",
      }),
    );
  });

  it("sets earlyReturn 400 when verification fails", async () => {
    (verificationPipeline.verify as any).mockRejectedValue(new Error("Schema validation failed"));
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(400);
    expect(buildCeeErrorResponse).toHaveBeenCalledWith(
      "CEE_GRAPH_INVALID",
      "Schema validation failed",
      expect.objectContaining({ requestId: "test-req-5" }),
    );
  });

  // ── Pipeline trace assembly ─────────────────────────────────────────────

  it("includes enrichment trace when present", async () => {
    const ctx = makeCtx({
      enrichmentTrace: {
        called_count: 1,
        extraction_mode: "llm-first",
        factors_added: 2,
        factors_enhanced: 1,
        factors_skipped: 0,
      },
    });
    await runStagePackage(ctx);

    const trace = ctx.pipelineTrace;
    expect(trace.enrich).toEqual(expect.objectContaining({
      called_count: 1,
      source: "unified_pipeline",
    }));
  });

  it("includes STRP trace when mutations present", async () => {
    const ctx = makeCtx({
      strpResult: { mutations: [{ rule: "R1", field: "strength_mean" }] },
      constraintStrpResult: { mutations: [{ rule: "R5", field: "belief_exists" }] },
    });
    await runStagePackage(ctx);

    const trace = ctx.pipelineTrace;
    expect(trace.strp).toBeDefined();
    expect(trace.strp.mutation_count).toBe(2);
    expect(trace.strp.rules_triggered).toContain("R1");
    expect(trace.strp.rules_triggered).toContain("R5");
  });

  it("merges STRP mutations from both early (Stage 2) and late (Stage 4)", async () => {
    const ctx = makeCtx({
      strpResult: { mutations: [{ rule: "R1" }, { rule: "R2" }] },
      constraintStrpResult: { mutations: [{ rule: "R5" }] },
    });
    await runStagePackage(ctx);

    const trace = ctx.pipelineTrace;
    expect(trace.strp.mutations).toHaveLength(3);
  });

  it("includes repair trace when present", async () => {
    const ctx = makeCtx({
      repairTrace: { edge_restore: { restoredCount: 2 } },
    });
    await runStagePackage(ctx);

    expect(ctx.pipelineTrace.repair).toEqual({ edge_restore: { restoredCount: 2 } });
  });

  it("includes provenance with unified pipeline path", async () => {
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(assembleCeeProvenance).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelinePath: "unified",
        model: "gpt-4o",
        promptVersion: "v42",
      }),
    );
  });

  it("passes planId and planHash to assembleCeeProvenance when planAnnotation present", async () => {
    // Make the mock return plan fields so we can verify they land on the trace
    (assembleCeeProvenance as any).mockReturnValue({
      pipelinePath: "unified",
      plan_id: "plan-test-abc",
      plan_hash: "hash-test-def",
    });

    const ctx = makeCtx({
      planAnnotation: {
        plan_annotation_version: "1" as const,
        plan_id: "plan-test-abc",
        plan_hash: "hash-test-def",
        stage3_rationales: [],
        confidence: { overall: 0.8, structure: 1, parameters: 1 },
        open_questions: [],
        context_hash: "ctx-hash",
        model_id: "gpt-4o",
        prompt_version: "v42",
      },
    });
    await runStagePackage(ctx);

    // Verify call args
    expect(assembleCeeProvenance).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-test-abc",
        planHash: "hash-test-def",
      }),
    );

    // Verify plan fields survive into the assembled trace
    expect(ctx.pipelineTrace.cee_provenance.plan_id).toBe("plan-test-abc");
    expect(ctx.pipelineTrace.cee_provenance.plan_hash).toBe("hash-test-def");
  });

  it("passes undefined planId/planHash when planAnnotation absent", async () => {
    const ctx = makeCtx({ planAnnotation: undefined });
    await runStagePackage(ctx);

    expect(assembleCeeProvenance).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: undefined,
        planHash: undefined,
      }),
    );

    // Verify plan fields are NOT on the trace when absent
    expect(ctx.pipelineTrace.cee_provenance).not.toHaveProperty("plan_id");
    expect(ctx.pipelineTrace.cee_provenance).not.toHaveProperty("plan_hash");
  });

  // ── Graph frozen invariant ──────────────────────────────────────────────

  it("does not mutate ctx.graph during Stage 5", async () => {
    const ctx = makeCtx();
    const graphBefore = JSON.stringify(ctx.graph);
    await runStagePackage(ctx);
    expect(JSON.stringify(ctx.graph)).toBe(graphBefore);
  });

  it("throws if graph is mutated during Stage 5 (non-production)", async () => {
    // Make verification mock mutate the graph to trigger the invariant
    (verificationPipeline.verify as any).mockImplementation((resp: any) => {
      // Simulate an unexpected graph mutation
      resp.graph.nodes.push({ id: "rogue", kind: "factor" });
      return { response: resp };
    });

    const ctx = makeCtx();
    // The mutation happens to resp.graph which is ctx.graph (same ref in payload)
    await expect(runStagePackage(ctx)).rejects.toThrow("Stage 5 invariant violation");
  });

  it("skips frozen invariant check in production", async () => {
    (isProduction as any).mockReturnValue(true);

    // Make verification mock mutate the graph
    (verificationPipeline.verify as any).mockImplementation((resp: any) => {
      resp.graph.nodes.push({ id: "rogue", kind: "factor" });
      return { response: resp };
    });

    const ctx = makeCtx();
    // Should NOT throw in production — invariant is skipped
    await expect(runStagePackage(ctx)).resolves.not.toThrow();
  });

  // ── STRP on cappedPayload ──────────────────────────────────────────────

  it("merges STRP trace onto cappedPayload when mutations exist", async () => {
    const ctx = makeCtx({
      strpResult: { mutations: [{ rule: "R1", field: "x" }] },
    });
    await runStagePackage(ctx);

    // The ceeResponse should have trace.strp from the cappedPayload merge
    const resp = ctx.ceeResponse as any;
    expect(resp.trace?.strp).toBeDefined();
    expect(resp.trace.strp.mutation_count).toBe(1);
  });

  // ── Checkpoints ────────────────────────────────────────────────────────

  it("captures checkpoints when enabled", async () => {
    const ctx = makeCtx({ checkpointsEnabled: true });
    await runStagePackage(ctx);

    // post_stabilisation + pre_boundary = at least 2 calls
    expect(captureCheckpoint).toHaveBeenCalled();
    expect(ctx.pipelineCheckpoints.length).toBeGreaterThanOrEqual(1);
  });

  it("skips checkpoints when disabled", async () => {
    const ctx = makeCtx({ checkpointsEnabled: false });
    await runStagePackage(ctx);

    expect(captureCheckpoint).not.toHaveBeenCalled();
  });
});
