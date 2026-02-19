/**
 * STATUS_QUO_ABSENT coaching injection — unit tests.
 *
 * Validates that Stage 5 (Package) injects a coaching strengthen_item
 * when no option has a status-quo-like label, and skips injection when
 * a status quo option exists or str_status_quo is already present.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (same set as cee.unified-pipeline.stage-5.test.ts) ──────────────

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      draftArchetypesEnabled: false,
      draftStructuralWarningsEnabled: false,
      pipelineCheckpointsEnabled: false,
    },
  },
  isProduction: vi.fn().mockReturnValue(true),
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

vi.mock("../../src/cee/bias/index.js", () => ({
  sortBiasFindings: vi.fn(),
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
  detectMissingBaseline: vi.fn(),
  detectGoalNoBaselineValue: vi.fn(),
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

vi.mock("../../src/version.js", () => ({
  SERVICE_VERSION: "1.0.0-test",
}));

// ── Imports ───────────────────────────────────────────────────────────────

import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { computeQuality } from "../../src/cee/quality/index.js";
import { applyResponseCaps } from "../../src/cee/transforms/response-caps.js";
import { ceeAnyTruncated, buildCeeGuidance } from "../../src/cee/guidance/index.js";
import {
  detectUniformStrengths,
  detectStrengthClustering,
  detectSameLeverOptions,
  detectMissingBaseline,
  detectGoalNoBaselineValue,
  checkGoalConnectivity,
  computeModelQualityFactors,
} from "../../src/cee/structure/index.js";
import { verificationPipeline } from "../../src/cee/verification/index.js";
import { assembleCeeProvenance } from "../../src/cee/pipeline-checkpoints.js";
import { buildLLMRawTrace } from "../../src/cee/llm-output-store.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeGraph(optionOverrides?: Array<{ id: string; kind: string; label: string; data?: any }>) {
  const options = optionOverrides ?? [
    { id: "opt_a", kind: "option", label: "Option A" },
    { id: "opt_b", kind: "option", label: "Option B" },
    { id: "opt_c", kind: "option", label: "Option C" },
  ];
  return {
    nodes: [
      { id: "g1", kind: "goal", label: "Goal" },
      ...options,
      { id: "f1", kind: "factor", label: "Factor", category: "controllable" },
    ],
    edges: [
      { id: "e1", from: "opt_a", to: "g1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
    ],
    version: "1.2",
    default_seed: 42,
  };
}

function makeCtx(graphOverride?: any, coachingOverride?: any): any {
  return {
    requestId: "test-coaching",
    graph: graphOverride ?? makeGraph(),
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
    coaching: coachingOverride,
  };
}

function setupMocks() {
  (computeQuality as any).mockReturnValue({ level: "moderate", score: 0.65, factors: {} });
  (applyResponseCaps as any).mockImplementation((payload: any) => ({
    cappedPayload: { ...payload },
    limits: {
      bias_findings_max: 10, bias_findings_truncated: false,
      options_max: 10, options_truncated: false,
      evidence_suggestions_max: 10, evidence_suggestions_truncated: false,
      sensitivity_suggestions_max: 10, sensitivity_suggestions_truncated: false,
    },
  }));
  (ceeAnyTruncated as any).mockReturnValue(false);
  (buildCeeGuidance as any).mockReturnValue({ recommendations: [] });
  (detectUniformStrengths as any).mockReturnValue({ detected: false });
  (detectStrengthClustering as any).mockReturnValue({ detected: false });
  (detectSameLeverOptions as any).mockReturnValue({ detected: false });
  (detectMissingBaseline as any).mockReturnValue({ detected: false });
  (detectGoalNoBaselineValue as any).mockReturnValue({ detected: false });
  (checkGoalConnectivity as any).mockReturnValue({ status: "connected", disconnectedOptions: [], weakPaths: [] });
  (computeModelQualityFactors as any).mockReturnValue({});
  (verificationPipeline.verify as any).mockImplementation((resp: any) => ({ response: { ...resp } }));
  (assembleCeeProvenance as any).mockReturnValue({ pipelinePath: "unified" });
  (buildLLMRawTrace as any).mockReturnValue({ stored: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("STATUS_QUO_ABSENT coaching injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it("injects str_status_quo when no option has a status-quo-like label", async () => {
    const ctx = makeCtx(
      makeGraph([
        { id: "opt_a", kind: "option", label: "Invest in Marketing" },
        { id: "opt_b", kind: "option", label: "Launch New Product" },
        { id: "opt_c", kind: "option", label: "Hire Sales Team" },
      ]),
    );

    await runStagePackage(ctx);

    expect(ctx.coaching).toBeDefined();
    const items = ctx.coaching.strengthen_items;
    expect(items).toBeDefined();
    const sqItem = items.find((i: any) => i.id === "str_status_quo");
    expect(sqItem).toBeDefined();
    expect(sqItem.label).toBe("Add baseline option");
    expect(sqItem.action_type).toBe("add_option");
    expect(sqItem.bias_category).toBe("framing");
  });

  it("does not inject when an option has status-quo-like label", async () => {
    const ctx = makeCtx(
      makeGraph([
        { id: "opt_a", kind: "option", label: "Invest in Marketing" },
        { id: "opt_b", kind: "option", label: "Continue Current Approach" },
        { id: "opt_c", kind: "option", label: "Hire Sales Team" },
      ]),
    );

    await runStagePackage(ctx);

    // coaching may or may not be defined, but should not contain str_status_quo
    const items = ctx.coaching?.strengthen_items ?? [];
    const sqItem = items.find((i: any) => i.id === "str_status_quo");
    expect(sqItem).toBeUndefined();
  });

  it("does not duplicate when LLM already generated str_status_quo", async () => {
    const existingCoaching = {
      summary: "Coaching from LLM",
      strengthen_items: [
        {
          id: "str_status_quo",
          label: "Consider adding a baseline",
          detail: "LLM-generated coaching item",
          action_type: "add_option",
        },
      ],
    };

    const ctx = makeCtx(
      makeGraph([
        { id: "opt_a", kind: "option", label: "Invest in Marketing" },
        { id: "opt_b", kind: "option", label: "Launch New Product" },
      ]),
      existingCoaching,
    );

    await runStagePackage(ctx);

    // Should still have exactly 1 str_status_quo (the original LLM one)
    const items = ctx.coaching.strengthen_items;
    const sqItems = items.filter((i: any) => i.id === "str_status_quo");
    expect(sqItems).toHaveLength(1);
    // Verify it's the original, not the injected one
    expect(sqItems[0].label).toBe("Consider adding a baseline");
  });

  it("does not inject when option label contains 'As Is' (aligned with detectMissingBaseline)", async () => {
    const ctx = makeCtx(
      makeGraph([
        { id: "opt_a", kind: "option", label: "Invest in Marketing" },
        { id: "opt_b", kind: "option", label: "Keep As Is" },
      ]),
    );

    await runStagePackage(ctx);

    const items = ctx.coaching?.strengthen_items ?? [];
    const sqItem = items.find((i: any) => i.id === "str_status_quo");
    expect(sqItem).toBeUndefined();
  });

  it("does not inject when option has data.is_status_quo = true", async () => {
    const ctx = makeCtx(
      makeGraph([
        { id: "opt_a", kind: "option", label: "Invest in Marketing" },
        { id: "opt_b", kind: "option", label: "Plan B", data: { is_status_quo: true } },
      ]),
    );

    await runStagePackage(ctx);

    const items = ctx.coaching?.strengthen_items ?? [];
    const sqItem = items.find((i: any) => i.id === "str_status_quo");
    expect(sqItem).toBeUndefined();
  });
});
