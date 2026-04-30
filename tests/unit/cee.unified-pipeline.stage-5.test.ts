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
  detectBiases: vi.fn().mockReturnValue([]),
  sortBiasFindings: vi.fn().mockImplementation((findings: unknown[]) => findings),
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
  detectOptionSimilarity: vi.fn().mockReturnValue({ detected: false, critiques: [], warnings: [], validationIssues: [] }),
  detectMissingBaseline: vi.fn(),
  detectMissingCounterfactual: vi.fn().mockReturnValue({ detected: false, hasCounterfactual: false }),
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

// Mock context pack (assembleContextPack computes hashes over pipeline state)
vi.mock("../../src/context/context-pack.js", () => ({
  assembleContextPack: vi.fn().mockReturnValue({
    pipelinePath: "unified",
    context_hash: "test-hash",
  }),
}));

// Mock version
vi.mock("../../src/version.js", () => ({
  SERVICE_VERSION: "1.0.0-test",
}));

import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { config, isProduction } from "../../src/config/index.js";
import { inferArchetype } from "../../src/cee/archetypes/index.js";
import { computeQuality } from "../../src/cee/quality/index.js";
import { detectBiases, sortBiasFindings } from "../../src/cee/bias/index.js";
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
    nodeRenames: new Map(),
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
    pipelineOutcome: {
      graph_drafted: false,
      graph_structurally_valid: false,
      deterministic_sweep_violations: 0,
      verification_status: 'skipped',
      validation_status: 'skipped',
      enrichment_status: 'skipped',
      coaching_status: 'partial',
      warnings: [],
    },
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
    (config.cee as any).verificationPipelineEnabled = true;
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

  // ── Strengthen item action_type defaulting ─────────────────────────────

  it("defaults action_type to 'improve' on LLM strengthen_items missing it", async () => {
    const ctx = makeCtx({
      coaching: {
        summary: "Some coaching",
        strengthen_items: [
          { id: "str_1", label: "Add detail", detail: "More info needed" },
          { id: "str_2", label: "Refine", detail: "Refine weights", action_type: "refine" },
        ],
      },
    });
    await runStagePackage(ctx);

    const items = (ctx.coaching as any).strengthen_items;
    expect(items[0].action_type).toBe("improve");
    expect(items[1].action_type).toBe("refine");
  });

  // ── Coaching narrow + sanitise on the response ──────────────────────────

  it("narrows ctx.coaching onto ceeResponse.coaching with widening_log + bias_signals", async () => {
    // Use a graph with a status-quo option so Stage 5's synthetic
    // str_status_quo injection is a no-op — keeps the assertion focused on
    // the narrower's output.
    const ctx = makeCtx({
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Goal" },
          { id: "o1", kind: "option", label: "Option A", data: { is_status_quo: true } },
          { id: "f1", kind: "factor", label: "Factor A", category: "controllable" },
        ],
        edges: [
          { id: "e1", from: "o1", to: "g1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
          { id: "e2", from: "f1", to: "o1", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.8, effect_direction: "positive" },
        ],
        version: "1.2",
        default_seed: 42,
      },
      coaching: {
        summary: "Solid scaffold; broaden the competitor scope.",
        strengthen_items: [
          { id: "s1", label: "Add a churn driver", detail: "Missing churn elasticity.", action_type: "add_node" },
        ],
        widening_log: [
          { node_id: "fac_competition", label: "Competitive intensity", reason: "considered alternatives" },
        ],
        bias_signals: [
          { type: "anchoring", detail: "pinned to last quarter's figure", target: "fac_revenue" },
        ],
      },
    });
    await runStagePackage(ctx);

    const coaching = (ctx.ceeResponse as any).coaching;
    expect(coaching).toBeDefined();
    expect(coaching.summary).toBe("Solid scaffold; broaden the competitor scope.");
    expect(coaching.strengthen_items).toHaveLength(1);
    expect(coaching.strengthen_items[0].id).toBe("s1");
    expect(coaching.widening_log).toEqual([
      { node_id: "fac_competition", label: "Competitive intensity", reason: "considered alternatives" },
    ]);
    expect(coaching.bias_signals).toEqual([
      { type: "anchoring", detail: "pinned to last quarter's figure", target: "fac_revenue" },
    ]);
  });

  it("sanitises raw entity IDs out of coaching.summary at the wire boundary", async () => {
    const ctx = makeCtx({
      coaching: {
        summary: "We should add fac_churn_rate to widen the model.",
        strengthen_items: [
          { id: "s1", label: "Add fac_churn_rate", detail: "Missing fac_churn_rate.", action_type: "add_node" },
        ],
      },
    });
    await runStagePackage(ctx);

    const coaching = (ctx.ceeResponse as any).coaching;
    // The graph projection has no node id "fac_churn_rate", so resolveLabel
    // returns null and we fall through to the prefix-aware generic. Either
    // outcome is correct — the invariant is that raw IDs never reach the wire.
    expect(coaching.summary).not.toContain("fac_churn_rate");
    expect(coaching.summary).toContain("the relevant factor");
    expect(coaching.strengthen_items[0].label).not.toContain("fac_churn_rate");
    expect(coaching.strengthen_items[0].detail).not.toContain("fac_churn_rate");
  });

  it("resolves leaked entity IDs to actual node labels when the graph contains them", async () => {
    // When the leaked ID matches a node in the projected graph, the
    // sanitiser substitutes the node's label rather than the generic.
    const ctx = makeCtx({
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Goal" },
          { id: "o1", kind: "option", label: "Option A", data: { is_status_quo: true } },
          { id: "fac_churn_rate", kind: "factor", label: "Customer churn rate", category: "controllable" },
        ],
        edges: [
          { id: "e1", from: "fac_churn_rate", to: "g1", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.9, effect_direction: "positive" },
        ],
        version: "1.2",
        default_seed: 42,
      },
      coaching: {
        summary: "Consider widening fac_churn_rate.",
        strengthen_items: [
          { id: "s1", label: "Refine fac_churn_rate", detail: "fac_churn_rate is underspecified.", action_type: "refine" },
        ],
      },
    });
    await runStagePackage(ctx);

    const coaching = (ctx.ceeResponse as any).coaching;
    expect(coaching.summary).toContain("Customer churn rate");
    expect(coaching.summary).not.toContain("fac_churn_rate");
    expect(coaching.strengthen_items[0].label).toContain("Customer churn rate");
    expect(coaching.strengthen_items[0].detail).toContain("Customer churn rate");
  });

  it("falls back to generic when a graph node's label equals its id (label-less projection)", async () => {
    // Direct regression for the label-less guard in projectGraphForLabelLookup:
    // when a node's label is the raw id (or absent), the projection skips it
    // so resolveLabel returns null and the sanitiser substitutes the
    // prefix-aware generic instead of re-emitting the leaked id as itself.
    const ctx = makeCtx({
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Goal" },
          { id: "o1", kind: "option", label: "Continue as-is" },
          // label === id → must be skipped by the projection
          { id: "fac_revenue", kind: "factor", label: "fac_revenue", category: "controllable" },
        ],
        edges: [
          { id: "e1", from: "fac_revenue", to: "g1", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.9, effect_direction: "positive" },
        ],
        version: "1.2",
        default_seed: 42,
      },
      coaching: {
        summary: "Consider widening fac_revenue.",
        strengthen_items: [
          { id: "s1", label: "Refine fac_revenue", detail: "fac_revenue underspecified.", action_type: "refine" },
        ],
      },
    });
    await runStagePackage(ctx);

    const coaching = (ctx.ceeResponse as any).coaching;
    // Must NOT echo the raw id (which would happen if projection kept the
    // node and resolveLabel returned the id-as-label).
    expect(coaching.summary).not.toContain("fac_revenue");
    expect(coaching.strengthen_items[0].label).not.toContain("fac_revenue");
    expect(coaching.strengthen_items[0].detail).not.toContain("fac_revenue");
    // Generic-fallback path fires.
    expect(coaching.summary).toContain("the relevant factor");
  });

  it("preserves bias_signals[].target as a structural node-ID pointer (not scrubbed)", async () => {
    // target is the UI's link to highlight the referenced node; scrubbing
    // it would break that link. detail (the prose) is the only user-facing
    // field on bias_signals that gets sanitised.
    const ctx = makeCtx({
      coaching: {
        summary: "ok",
        strengthen_items: [],
        bias_signals: [
          { type: "anchoring", detail: "Pinned on fac_revenue last quarter.", target: "fac_revenue" },
        ],
      },
    });
    await runStagePackage(ctx);

    const sig = (ctx.ceeResponse as any).coaching.bias_signals[0];
    expect(sig.target).toBe("fac_revenue"); // structural pointer survives
    expect(sig.detail).not.toContain("fac_revenue"); // prose scrubbed
  });

  it("omits coaching when ctx.coaching is absent and no synthetic injection runs", async () => {
    // Graph without options → status-quo synthesiser is a no-op, so a missing
    // ctx.coaching stays missing through Stage 5.
    const ctx = makeCtx({
      coaching: undefined,
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Goal" },
          { id: "f1", kind: "factor", label: "Factor A", category: "controllable" },
        ],
        edges: [
          { id: "e1", from: "f1", to: "g1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        ],
        version: "1.2",
        default_seed: 42,
      },
    });
    await runStagePackage(ctx);

    const resp = ctx.ceeResponse as any;
    expect(resp).toBeDefined();
    expect(resp.coaching).toBeUndefined();
  });

  it("preserves coaching with summary: null when other fields are meaningful", async () => {
    // summary missing → narrower returns null. Coaching still surfaces
    // because strengthen_items carries usable content. UI renders null as
    // "no summary" rather than dropping the entire panel.
    const ctx = makeCtx({
      coaching: {
        strengthen_items: [
          { id: "s1", label: "L", detail: "D", action_type: "add_node" },
        ],
      },
    });
    await runStagePackage(ctx);

    const coaching = (ctx.ceeResponse as any).coaching;
    expect(coaching).toBeDefined();
    expect(coaching.summary).toBeNull();
    // strengthen_items contains the user-provided s1 plus the synthetic
    // str_status_quo entry injected by Stage 5 when the graph has options
    // without a baseline.
    expect(coaching.strengthen_items.length).toBeGreaterThanOrEqual(1);
    expect(coaching.strengthen_items.find((i: any) => i.id === "s1")).toBeDefined();
  });

  it("drops coaching when nothing is meaningful (null summary, no other fields)", async () => {
    // No summary, no strengthen_items, no widening_log, no bias_signals,
    // and no synthetic injection (no options on the graph) → nothing to surface.
    const ctx = makeCtx({
      coaching: {},
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Goal" },
          { id: "f1", kind: "factor", label: "Factor A", category: "controllable" },
        ],
        edges: [
          { id: "e1", from: "f1", to: "g1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        ],
        version: "1.2",
        default_seed: 42,
      },
    });
    await runStagePackage(ctx);

    const resp = ctx.ceeResponse as any;
    expect(resp.coaching).toBeUndefined();
  });

  it("omits widening_log + bias_signals when source arrays are null", async () => {
    const ctx = makeCtx({
      coaching: {
        summary: "Coaching with no log or signals.",
        strengthen_items: [],
      },
    });
    await runStagePackage(ctx);

    const coaching = (ctx.ceeResponse as any).coaching;
    expect(coaching).toBeDefined();
    expect(coaching.summary).toBe("Coaching with no log or signals.");
    // Null arrays must be absent on the wire (V3 schema marks them optional,
    // not nullable — leaving them as null would fail safeParse).
    expect("widening_log" in coaching).toBe(false);
    expect("bias_signals" in coaching).toBe(false);
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

  it("soft-gates verification failure — no earlyReturn, warning recorded (Track 1)", async () => {
    (verificationPipeline.verify as any).mockRejectedValue(new Error("Schema validation failed"));
    const ctx = makeCtx();
    await runStagePackage(ctx);

    // Track 1: verification failure is a soft gate — no earlyReturn
    expect(ctx.earlyReturn).toBeUndefined();
    // Response is built from unverified ceeResponse
    expect(ctx.ceeResponse).toBeDefined();
    // Warning recorded on pipeline outcome
    expect(ctx.pipelineOutcome.verification_status).toBe("failed_degraded");
    const verifyWarning = ctx.pipelineOutcome.warnings.find(
      (w: any) => w.stage === "verification",
    );
    expect(verifyWarning).toBeDefined();
    expect(verifyWarning.error).toBe("Schema validation failed");
    expect(verifyWarning.degraded).toBe(true);
  });

  it("skips verification when verificationPipelineEnabled = false", async () => {
    (config.cee as any).verificationPipelineEnabled = false;
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(verificationPipeline.verify).not.toHaveBeenCalled();
    expect(ctx.ceeResponse).toBeDefined();
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("runs verification when verificationPipelineEnabled = true (default)", async () => {
    (config.cee as any).verificationPipelineEnabled = true;
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(verificationPipeline.verify).toHaveBeenCalledTimes(1);
    expect(ctx.ceeResponse).toBeDefined();
  });

  it("skips verification when verificationPipelineEnabled = false", async () => {
    (config.cee as any).verificationPipelineEnabled = false;
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(verificationPipeline.verify).not.toHaveBeenCalled();
    expect(ctx.ceeResponse).toBeDefined();
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("runs verification when verificationPipelineEnabled = true (default)", async () => {
    (config.cee as any).verificationPipelineEnabled = true;
    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(verificationPipeline.verify).toHaveBeenCalledTimes(1);
    expect(ctx.ceeResponse).toBeDefined();
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

  // ── Bias findings wiring ────────────────────────────────────────────────

  it("calls detectBiases and includes bias_findings on the V1 response", async () => {
    const fakeFinding = { id: "selection_low_option_count", category: "selection", severity: "medium", node_ids: ["o1"] };
    (detectBiases as any).mockReturnValue([fakeFinding]);

    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(detectBiases).toHaveBeenCalledWith(ctx.graph, ctx.archetype);
    expect(ctx.ceeResponse).toBeDefined();
    expect((ctx.ceeResponse as any).bias_findings).toEqual([fakeFinding]);
  });

  it("emits empty bias_findings array when no biases detected", async () => {
    (detectBiases as any).mockReturnValue([]);

    const ctx = makeCtx();
    await runStagePackage(ctx);

    expect(ctx.ceeResponse).toBeDefined();
    expect((ctx.ceeResponse as any).bias_findings).toEqual([]);
  });
});
