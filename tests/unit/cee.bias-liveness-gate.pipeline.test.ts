/**
 * BIAS-SURFACE LIVENESS GATE — leg 2a (§1.5(1) FRAME surface, CEE side).
 *
 * Companion to tests/unit/cee.bias-liveness-gate.test.ts (legs 1, 2b) —
 * see that file's header for the full design-record binding
 * (AI-EXPERIENCE-DESIGN-DRAFT-2026-07-14.md §1.5 +
 * BIAS-COACHING-PROPOSAL-2026-07-16.md §4).
 *
 * This file proves the deterministic engine is WIRED, not merely alive:
 *
 *   2a-i  Stage 5 Package runs the REAL detectBiases against the frozen
 *         draft graph on every draft and carries its findings onto the V1
 *         response (src/cee/unified-pipeline/stages/package.ts step 3b).
 *         Removing that call — the CEE analogue of the 30-Mar UI strip —
 *         turns this RED even though leg 1 stays green.
 *   2a-ii Stage 6 Boundary attaches the V1 findings to the
 *         analysis_ready envelope (stages/boundary.ts), so the FRAME
 *         surface's feeder field cannot be silently dropped.
 *
 * Collaborator modules are mocked exactly as in the stage-5/stage-6 unit
 * scaffolds — EXCEPT src/cee/bias/index.js, which is deliberately REAL:
 * a mocked engine here would be guarantee-theatre. If a new collaborator
 * import lands in either stage, this file fails loud at collection
 * (module-not-mocked/shape errors), never silently green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Stage 5 collaborator mocks (bias module intentionally NOT mocked) ──────
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      draftArchetypesEnabled: true,
      pipelineCheckpointsEnabled: false,
      // biasStructuralEnabled deliberately ABSENT → minimum engine
      // posture; the fixture's control detectors are flag-independent.
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
  inferArchetype: vi.fn(),
}));

vi.mock("../../src/cee/quality/index.js", () => ({
  computeQuality: vi.fn(),
}));

vi.mock("../../src/cee/transforms/response-caps.js", () => ({
  applyResponseCaps: vi.fn(),
}));

vi.mock("../../src/cee/guidance/index.js", () => ({
  ceeAnyTruncated: vi.fn(),
  buildCeeGuidance: vi.fn(),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn(),
  detectUniformStrengths: vi.fn(),
  detectStrengthClustering: vi.fn(),
  detectSameLeverOptions: vi.fn(),
  detectOptionSimilarity: vi
    .fn()
    .mockReturnValue({ detected: false, critiques: [], warnings: [], validationIssues: [] }),
  detectMissingBaseline: vi.fn(),
  detectMissingCounterfactual: vi.fn().mockReturnValue({ detected: false, hasCounterfactual: false }),
  detectGoalNoBaselineValue: vi.fn(),
  detectZeroExternalFactors: vi.fn(),
  checkGoalConnectivity: vi.fn(),
  computeModelQualityFactors: vi.fn(),
}));

vi.mock("../../src/cee/verification/index.js", () => ({
  verificationPipeline: {
    verify: vi.fn(),
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
  applyCheckpointSizeGuard: vi.fn(),
  assembleCeeProvenance: vi.fn(),
}));

vi.mock("../../src/cee/llm-output-store.js", () => ({
  buildLLMRawTrace: vi.fn(),
}));

vi.mock("../../src/context/context-pack.js", () => ({
  assembleDraftProvenanceDescriptor: vi.fn().mockReturnValue({
    pipelinePath: "unified",
    context_hash: "test-hash",
  }),
}));

vi.mock("../../src/version.js", () => ({
  SERVICE_VERSION: "1.0.0-test",
}));

// ── Stage 6 collaborator mocks (boundary leg) ──────────────────────────────
vi.mock("../../src/cee/transforms/schema-v3.js", () => ({
  transformResponseToV3: vi.fn(),
  validateStrictModeV3: vi.fn(),
}));

vi.mock("../../src/cee/transforms/schema-v2.js", () => ({
  transformResponseToV2: vi.fn(),
}));

vi.mock("../../src/cee/transforms/analysis-ready.js", () => ({
  mapMutationsToAdjustments: vi.fn().mockReturnValue([]),
  extractConstraintDropBlockers: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/schemas/cee-v3.js", () => ({
  CEEGraphResponseV3: {
    safeParse: vi.fn((input: unknown) => ({ success: true, data: input })),
  },
  warnOnUnknownV3Fields: vi.fn(),
}));

import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { detectBiases } from "../../src/cee/bias/index.js";
import { inferArchetype } from "../../src/cee/archetypes/index.js";
import { computeQuality } from "../../src/cee/quality/index.js";
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
import { captureCheckpoint, applyCheckpointSizeGuard, assembleCeeProvenance } from "../../src/cee/pipeline-checkpoints.js";
import { buildLLMRawTrace } from "../../src/cee/llm-output-store.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import {
  BIAS_LIVENESS_GRAPH,
  BIAS_LIVENESS_EXPECTED_FINDING_IDS,
} from "../fixtures/cee/bias-liveness.fixture.js";

// ─── Helpers (mirrors the stage-5/6 scaffolds; drift fails loud) ────────────

const defaultQuality = { level: "moderate", score: 0.65, factors: {} };
const defaultLimits = {
  bias_findings_max: 10,
  bias_findings_truncated: false,
  options_max: 10,
  options_truncated: false,
  evidence_suggestions_max: 10,
  evidence_suggestions_truncated: false,
  sensitivity_suggestions_max: 10,
  sensitivity_suggestions_truncated: false,
};

function makePackageCtx(overrides?: Partial<Record<string, any>>): any {
  return {
    requestId: "bias-liveness-2a",
    graph: structuredClone(BIAS_LIVENESS_GRAPH),
    input: { brief: "Bias liveness gate fixture brief", seed: "bias-liveness-seed" },
    opts: { schemaVersion: "v3" as const, strictMode: false, includeDebug: false, unsafeCaptureEnabled: false },
    start: Date.now() - 1000,
    confidence: 0.75,
    rationales: [],
    goalConstraints: undefined,
    draftAdapter: { name: "anthropic", model: "test-model" },
    llmMeta: {
      prompt_version: "v-test",
      prompt_hash: "hash-test",
      model: "test-model",
      temperature: 0.3,
      token_usage: { input: 100, output: 200 },
      finish_reason: "stop",
      provider_latency_ms: 500,
      raw_llm_text: undefined,
      prompt_source: "store",
      prompt_store_version: 1,
    },
    strpResult: undefined,
    constraintStrpResult: undefined,
    riskCoefficientCorrections: [],
    nodeRenames: new Map(),
    transforms: [],
    enrichmentTrace: undefined,
    repairTrace: undefined,
    collector: {
      hasCorrections: vi.fn().mockReturnValue(false),
      getCorrections: vi.fn(),
      getSummary: vi.fn(),
    },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    validationSummary: undefined,
    structuralMeta: undefined,
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: undefined,
    earlyReturn: undefined,
    pipelineOutcome: {
      graph_drafted: true,
      graph_structurally_valid: true,
      deterministic_sweep_violations: 0,
      verification_status: "skipped",
      validation_status: "skipped",
      enrichment_status: "skipped",
      coaching_status: "partial",
      warnings: [],
    },
    ...overrides,
  };
}

function setupPackageMocks(): void {
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
  (buildCeeGuidance as any).mockReturnValue({ recommendations: [] });
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
  (captureCheckpoint as any).mockReturnValue({ stage: "post_stabilisation", node_count: 4, edge_count: 2 });
  (applyCheckpointSizeGuard as any).mockImplementation((cps: any) => cps);
  (assembleCeeProvenance as any).mockReturnValue({ pipelinePath: "unified" });
  (buildLLMRawTrace as any).mockReturnValue({ stored: true });
}

describe("bias-surface liveness gate — leg 2a-i: engine wired into Stage 5 Package (§1.5(1))", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPackageMocks();
  });

  it("carries REAL detectBiases findings for the fixture graph onto the draft V1 response", async () => {
    const ctx = makePackageCtx();
    await runStagePackage(ctx);

    expect(ctx.ceeResponse).toBeDefined();
    const findings = (ctx.ceeResponse as any).bias_findings;
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const ids = findings.map((f: any) => f.id);
    for (const expected of BIAS_LIVENESS_EXPECTED_FINDING_IDS) {
      expect(ids).toContain(expected);
    }
  });
});

describe("bias-surface liveness gate — leg 2a-ii: findings reach analysis_ready at Stage 6 Boundary (§1.5(1))", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches the fixture's V1 bias_findings to the analysis_ready envelope", async () => {
    // Positive control first: the findings fed in are the REAL engine's
    // output for the fixture graph — non-empty by leg 1.
    const findings = detectBiases(BIAS_LIVENESS_GRAPH as never, null);
    expect(findings.length).toBeGreaterThanOrEqual(2);

    const v3Body: any = {
      nodes: [],
      edges: [],
      analysis_ready: { status: "ready" },
    };
    (transformResponseToV3 as any).mockReturnValue(v3Body);

    const ctx: any = {
      requestId: "bias-liveness-2a-ii",
      input: { brief: "Bias liveness gate fixture brief" },
      opts: { schemaVersion: "v3" as const, strictMode: false, includeDebug: false },
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        bias_findings: findings,
        trace: { strp: { mutations: [] }, corrections: [] },
      },
      deterministicRepairs: undefined,
      earlyReturn: undefined,
    };
    await runStageBoundary(ctx);

    const attached = ctx.finalResponse?.analysis_ready?.bias_findings;
    expect(Array.isArray(attached)).toBe(true);
    expect(attached).toEqual(findings);
    const ids = attached.map((f: any) => f.id);
    for (const expected of BIAS_LIVENESS_EXPECTED_FINDING_IDS) {
      expect(ids).toContain(expected);
    }
  });
});
