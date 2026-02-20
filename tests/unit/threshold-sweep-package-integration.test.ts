/**
 * Stage 4b → Stage 5 integration assertion.
 *
 * Verifies that threshold sweep repairs emitted to ctx.deterministicRepairs
 * appear in the packaged output at trace.repair_summary.deterministic_repairs.
 *
 * This protects against future refactors that accidentally stop folding
 * deterministic repairs into the response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (match cee.unified-pipeline.stage-5.test.ts surface) ──────────────

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      draftArchetypesEnabled: false,
      draftStructuralWarningsEnabled: false,
      pipelineCheckpointsEnabled: false,
    },
  },
  isProduction: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../src/cee/archetypes/index.js", () => ({
  inferArchetype: vi.fn().mockReturnValue({
    archetype: { decision_type: "generic", match: "generic", confidence: 0.7 },
    issues: [],
  }),
}));

vi.mock("../../src/cee/quality/index.js", () => ({
  computeQuality: vi.fn().mockReturnValue({ level: "moderate", score: 0.65, factors: {} }),
}));

vi.mock("../../src/cee/bias/index.js", () => ({
  sortBiasFindings: vi.fn(),
}));

vi.mock("../../src/cee/transforms/response-caps.js", () => ({
  applyResponseCaps: vi.fn().mockImplementation((payload: any) => ({
    cappedPayload: { ...payload },
    limits: {
      bias_findings_max: 10, bias_findings_truncated: false,
      options_max: 10, options_truncated: false,
      evidence_suggestions_max: 10, evidence_suggestions_truncated: false,
      sensitivity_suggestions_max: 10, sensitivity_suggestions_truncated: false,
    },
  })),
}));

vi.mock("../../src/cee/guidance/index.js", () => ({
  ceeAnyTruncated: vi.fn().mockReturnValue(false),
  buildCeeGuidance: vi.fn().mockReturnValue({ recommendations: [] }),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn().mockReturnValue({ warnings: [], uncertainNodeIds: [] }),
  detectUniformStrengths: vi.fn().mockReturnValue({ detected: false }),
  detectStrengthClustering: vi.fn().mockReturnValue({ detected: false }),
  detectSameLeverOptions: vi.fn().mockReturnValue({ detected: false }),
  detectMissingBaseline: vi.fn().mockReturnValue({ detected: false }),
  detectGoalNoBaselineValue: vi.fn().mockReturnValue({ detected: false }),
  detectZeroExternalFactors: vi.fn().mockReturnValue({ detected: false, factorCount: 0, externalCount: 0 }),
  checkGoalConnectivity: vi.fn().mockReturnValue({ status: "connected", disconnectedOptions: [], weakPaths: [] }),
  computeModelQualityFactors: vi.fn().mockReturnValue({}),
}));

vi.mock("../../src/cee/verification/index.js", () => ({
  verificationPipeline: {
    verify: vi.fn().mockImplementation((resp: any) => ({ response: { ...resp } })),
  },
}));

vi.mock("../../src/schemas/ceeResponses.js", () => ({
  CEEDraftGraphResponseV1Schema: {},
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: vi.fn(),
}));

vi.mock("../../src/cee/pipeline-checkpoints.js", () => ({
  captureCheckpoint: vi.fn(),
  applyCheckpointSizeGuard: vi.fn().mockImplementation((cps: any) => cps),
  assembleCeeProvenance: vi.fn().mockReturnValue({ pipelinePath: "unified" }),
}));

vi.mock("../../src/cee/llm-output-store.js", () => ({
  buildLLMRawTrace: vi.fn().mockReturnValue({ stored: true }),
}));

vi.mock("../../src/version.js", () => ({
  SERVICE_VERSION: "1.0.0-test",
}));

import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph() {
  return {
    version: "1.0",
    default_seed: 42,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Which strategy?" },
      { id: "opt_a", kind: "option", label: "Option A" },
      {
        id: "goal_1",
        kind: "goal",
        label: "Improve UX Quality",  // no digits → qualitative
        goal_threshold: 0.7,
        goal_threshold_raw: 70,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
      },
      { id: "fac_1", kind: "factor", label: "Cost Factor", category: "controllable", data: { value: 100 } },
      { id: "out_1", kind: "outcome", label: "Customer Satisfaction" },
    ],
    edges: [
      { id: "e1", from: "dec_1", to: "opt_a", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { id: "e2", from: "opt_a", to: "fac_1", strength_mean: 0.6, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { id: "e3", from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { id: "e4", from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
    ],
  };
}

function makeCtx() {
  return {
    requestId: "sweep-package-integration",
    graph: makeGraph(),
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
    deterministicRepairs: [] as any[],
    repairTrace: {
      deterministic_sweep: {
        sweep_ran: true,
        goal_threshold_stripped: 0,
        goal_threshold_possibly_inferred: 0,
      },
    },
    strpResult: undefined,
    constraintStrpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentTrace: undefined,
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
  } as any;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Stage 4b → Stage 5 integration: sweep repairs in packaged output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GOAL_THRESHOLD_STRIPPED_NO_DIGITS appears in trace.repair_summary.deterministic_repairs", async () => {
    const ctx = makeCtx();

    // Stage 4b: threshold sweep strips the fabricated threshold
    await runStageThresholdSweep(ctx);

    // Sanity: sweep emitted repairs to ctx.deterministicRepairs
    expect(ctx.deterministicRepairs.length).toBeGreaterThan(0);
    const sweepCodes = ctx.deterministicRepairs.map((r: any) => r.code);
    expect(sweepCodes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");

    // Stage 5: package folds ctx.deterministicRepairs into response trace
    await runStagePackage(ctx);

    // Assert the packaged response contains the sweep repair
    expect(ctx.ceeResponse).toBeDefined();
    const repairSummary = ctx.ceeResponse.trace?.repair_summary;
    expect(repairSummary).toBeDefined();
    expect(repairSummary.deterministic_repairs).toBeDefined();
    expect(Array.isArray(repairSummary.deterministic_repairs)).toBe(true);

    const packagedCodes = repairSummary.deterministic_repairs.map((r: any) => r.code);
    expect(packagedCodes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");
    expect(repairSummary.deterministic_repairs_count).toBeGreaterThan(0);
  });
});
