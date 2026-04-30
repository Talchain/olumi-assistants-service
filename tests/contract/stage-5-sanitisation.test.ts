/**
 * Stage-5 sanitisation boundary substitute (brief test 5).
 *
 * The brief asks: "Mocked coaching containing `fac_test_id` is sanitised
 * in the response." Stage 5's chokepoint
 * (`sanitiseCoachingForDisplay` at
 * src/cee/unified-pipeline/stages/package.ts:105-135) is module-private,
 * so we cannot route-test scrubbing without booting the full unified
 * pipeline. The closest stable boundary that exercises the actual
 * production composition is the Stage 5 entry point itself —
 * `runStagePackage(ctx)` — which is what production calls when the
 * unified pipeline runs its packaging stage.
 *
 * This file drives `runStagePackage` directly with a minimal
 * `StageContext` carrying a dirty `coaching` block. The mocking pattern
 * is borrowed from `tests/unit/cee.unified-pipeline.stage-5.test.ts`
 * (where Stage 5 unit tests already live). Running through Stage 5
 * proves:
 *   (a) Production composition is intact: Stage 5 still calls
 *       narrowCoachingForResponse → sanitiseCoachingForDisplay before
 *       attaching coaching to ctx.ceeResponse.
 *   (b) User-facing strings are scrubbed end-to-end (summary,
 *       strengthen_items.{label,detail}, widening_log.{label,reason},
 *       bias_signals.detail).
 *   (c) Structural pointers (bias_signals[].target) are preserved.
 *
 * Classified `not_route_verified` because the route layer (which
 * forwards `ctx.ceeResponse` unchanged via `runUnifiedPipeline`) is
 * not exercised here. Listed in
 * Docs/v5/cross-boundary-contract-test-report.md §3.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (mirror tests/unit/cee.unified-pipeline.stage-5.test.ts) ─────────

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      draftArchetypesEnabled: true,
      draftStructuralWarningsEnabled: true,
      pipelineCheckpointsEnabled: false,
      verificationPipelineEnabled: true,
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
    archetype: { decision_type: "investment", match: "exact", confidence: 0.75 },
    issues: [],
  }),
}));

vi.mock("../../src/cee/quality/index.js", () => ({
  computeQuality: vi.fn().mockReturnValue({ overall: 7, structure: 7, coverage: 7, structural_proxy: 7, safety: 7 }),
}));

vi.mock("../../src/cee/bias/index.js", () => ({
  detectBiases: vi.fn().mockReturnValue([]),
  sortBiasFindings: vi.fn().mockImplementation((findings: unknown[]) => findings),
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
  detectOptionSimilarity: vi.fn().mockReturnValue({ detected: false, critiques: [], warnings: [], validationIssues: [] }),
  detectMissingBaseline: vi.fn().mockReturnValue({ detected: false }),
  detectMissingCounterfactual: vi.fn().mockReturnValue({ detected: false, hasCounterfactual: false }),
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
  buildCeeErrorResponse: vi.fn().mockImplementation((code: string, msg: string) => ({
    error: { code, message: msg },
  })),
}));

vi.mock("../../src/cee/pipeline-checkpoints.js", () => ({
  captureCheckpoint: vi.fn().mockReturnValue({ stage: "post_stabilisation", node_count: 3, edge_count: 2 }),
  applyCheckpointSizeGuard: vi.fn().mockImplementation((cps: any) => cps),
  assembleCeeProvenance: vi.fn().mockReturnValue({ pipelinePath: "unified" }),
}));

vi.mock("../../src/cee/llm-output-store.js", () => ({
  buildLLMRawTrace: vi.fn().mockReturnValue({ stored: true }),
}));

vi.mock("../../src/context/context-pack.js", () => ({
  assembleContextPack: vi.fn().mockReturnValue({ pipelinePath: "unified", context_hash: "test-hash" }),
}));

vi.mock("../../src/version.js", () => ({
  SERVICE_VERSION: "1.0.0-test",
}));

import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";

// ─── Test fixtures ──────────────────────────────────────────────────────────

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

function makeCtx(coaching: unknown): any {
  return {
    requestId: "test-req-stage5-sanitise",
    graph: structuredClone(baseGraph),
    input: { brief: "Test brief", seed: "abc123" },
    opts: { schemaVersion: "v3" as const, strictMode: false, includeDebug: false, unsafeCaptureEnabled: false },
    start: Date.now() - 1000,
    confidence: 0.75,
    rationales: [],
    goalConstraints: undefined,
    draftAdapter: { name: "openai", model: "gpt-4o" },
    llmMeta: {
      prompt_version: "v42", prompt_hash: "abc123", model: "gpt-4o", temperature: 0.3,
      token_usage: { input: 100, output: 200 }, finish_reason: "stop",
      provider_latency_ms: 500, raw_llm_text: undefined,
      prompt_source: "store", prompt_store_version: 42,
    },
    coaching, // ← the dirty / clean input under test
    causalClaims: undefined,
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
      graph_drafted: true,
      graph_structurally_valid: true,
      deterministic_sweep_violations: 0,
      verification_status: "skipped",
      validation_status: "skipped",
      enrichment_status: "skipped",
      coaching_status: "partial",
      warnings: [],
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Stage 5 sanitisation boundary (brief test 5, not_route_verified)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dirty coaching with fac_/opt_ leaks → ctx.ceeResponse.coaching is scrubbed", async () => {
    const dirtyCoaching = {
      summary: "The fac_test_id factor leads, with opt_test_id as runner-up.",
      strengthen_items: [
        {
          id: "strengthen_test_leak",
          label: "Address opt_test_id mapping",
          detail: "The factor fac_test_id needs a value.",
          action_type: "set_factor_value",
        },
      ],
      widening_log: [
        {
          node_id: "fac_test_id",
          label: "Consider fac_test_id alternatives",
          reason: "The factor fac_test_id has no upstream signal.",
        },
      ],
      bias_signals: [
        {
          type: "anchoring",
          detail: "The brief anchors on fac_test_id as the only driver.",
          target: "fac_test_id", // structural pointer — NOT scrubbed
        },
      ],
    };

    const ctx = makeCtx(dirtyCoaching);
    await runStagePackage(ctx);

    expect(ctx.ceeResponse).toBeDefined();
    const coaching = (ctx.ceeResponse as any).coaching;
    expect(coaching, "Stage 5 must attach coaching when input is meaningful").toBeDefined();

    // (a) Every user-facing string emitted on ctx.ceeResponse.coaching is
    // leak-free. Stage 5's sanitiseCoachingForDisplay → sanitiseUserFacingText
    // ran end-to-end.
    const userFacingStrings: string[] = [];
    if (typeof coaching.summary === "string") userFacingStrings.push(coaching.summary);
    for (const item of coaching.strengthen_items as Array<{ label: string; detail: string }>) {
      userFacingStrings.push(item.label, item.detail);
    }
    if (Array.isArray(coaching.widening_log)) {
      for (const entry of coaching.widening_log as Array<{ label: string; reason: string }>) {
        userFacingStrings.push(entry.label, entry.reason);
      }
    }
    if (Array.isArray(coaching.bias_signals)) {
      for (const signal of coaching.bias_signals as Array<{ detail: string }>) {
        userFacingStrings.push(signal.detail);
      }
    }

    for (const text of userFacingStrings) {
      expect(text, `leak survived in: ${text}`).not.toContain("fac_test_id");
      expect(text, `leak survived in: ${text}`).not.toContain("opt_test_id");
    }

    // (b) Structural pointer (bias_signals[].target) is preserved verbatim.
    // The sanitiser deliberately leaves target unscrubbed so the UI can use
    // it for canvas-node highlighting (sanitiseCoachingForDisplay at
    // src/cee/unified-pipeline/stages/package.ts:127-130).
    expect((coaching.bias_signals as Array<{ target: string }>)[0].target).toBe("fac_test_id");
  });

  it("clean coaching is preserved verbatim (no false-positive scrubbing)", async () => {
    const cleanCoaching = {
      summary: "Consider broader factor coverage and a status-quo option.",
      strengthen_items: [
        {
          id: "strengthen_clean",
          label: "Add a status-quo option",
          detail: "Without a do-nothing comparator the analysis can't show the deal beats organic growth.",
          action_type: "add_option",
          bias_category: "action_bias",
        },
      ],
      widening_log: [],
      bias_signals: [],
    };

    const ctx = makeCtx(cleanCoaching);
    await runStagePackage(ctx);

    const coaching = (ctx.ceeResponse as any).coaching;
    expect(coaching).toBeDefined();
    expect(coaching.summary).toBe(cleanCoaching.summary);
    expect(coaching.strengthen_items[0].label).toBe(cleanCoaching.strengthen_items[0].label);
    expect(coaching.strengthen_items[0].detail).toBe(cleanCoaching.strengthen_items[0].detail);
  });

  // Note: a "absent coaching → no coaching field" test is intentionally
  // omitted here. Stage 5 synthesises a status-quo strengthen_item when
  // the brief lacks a status-quo option (regardless of whether the LLM
  // emitted coaching), so `ctx.coaching === undefined` does not imply
  // `ctx.ceeResponse.coaching === undefined`. The "no coaching" wire
  // contract is exercised at the fixture level — see
  // tests/contract/fixtures-schema.test.ts ("draft-graph.no-coaching
  // omits coaching entirely") and the route-level test in
  // endpoint-feature-matrix.test.ts ("response with no coaching
  // succeeds (coaching field absent)").
});
