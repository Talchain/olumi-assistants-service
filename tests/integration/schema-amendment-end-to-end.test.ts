/**
 * End-to-end production-path replay for the v0.11.0 schema amendment.
 *
 * Exercises the REAL Stage 5 (`runStagePackage`) and Stage 6 V1 → V3
 * transform (`transformResponseToV3`) starting from a StageContext
 * populated like `runStageParse` output. This catches the
 * adapter-to-parse and parse-to-package drops a hand-built V1 fixture
 * could miss.
 *
 * Stage 1 Parse populates `ctx.coaching`, `ctx.causalClaims`,
 * `ctx.topologyPlan` from the adapter's `DraftGraphResult` (verified at
 * `src/cee/unified-pipeline/stages/parse.ts:421-426`). This test starts
 * from that exact post-parse state and runs Stage 5 → Stage 6.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";

function buildPostParseContext(overrides: Record<string, unknown> = {}): any {
  // Shape mirrors the StageContext produced by runStageParse — graph
  // populated, rationales empty, and (per v0.11.0) coaching /
  // causalClaims / topologyPlan stashed from the adapter result.
  const baseGraph = {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_1", kind: "decision", label: "decision" },
      { id: "opt_a", kind: "option", label: "option a", data: { is_baseline: false, interventions: { fac_a: 1 } } },
      { id: "opt_b", kind: "option", label: "status quo", data: { is_baseline: true, is_status_quo: true, interventions: {} } },
      { id: "fac_a", kind: "factor", label: "factor a", category: "controllable", data: { value: 0, extractionType: "explicit", factor_type: "other", uncertainty_drivers: [] } },
      { id: "out_x", kind: "outcome", label: "outcome x" },
      { id: "goal_g", kind: "goal", label: "goal", goal_threshold: 0.8 },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "dec_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_a", to: "out_x", strength_mean: 0.6, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
      { from: "out_x", to: "goal_g", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
    ],
    meta: { schema_version: "1" },
  };
  return {
    requestId: "e2e-req-1",
    graph: baseGraph,
    input: { brief: "Mid-market expansion strategy", seed: "abc" },
    opts: { schemaVersion: "v3" as const, strictMode: false, includeDebug: false, unsafeCaptureEnabled: false },
    start: Date.now() - 1000,
    confidence: 0.75,
    rationales: [],
    goalConstraints: undefined,
    draftAdapter: { name: "anthropic", model: "claude-sonnet-4" },
    llmMeta: {
      prompt_version: "v0.11.0",
      prompt_hash: "abc",
      model: "claude-sonnet-4",
      temperature: 0.3,
      token_usage: { input: 100, output: 200 },
      finish_reason: "stop",
      provider_latency_ms: 500,
      prompt_source: "store",
      prompt_store_version: 42,
    },
    strpResult: undefined,
    constraintStrpResult: undefined,
    riskCoefficientCorrections: [],
    nodeRenames: new Map(),
    structureWarnings: [],
    promptVersion: "v0.11.0",
    archetype: undefined,
    effectiveBrief: "Mid-market expansion strategy",
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 30000,
    draftDurationMs: 500,
    transforms: [],
    enrichmentTrace: undefined,
    repairTrace: undefined,
    collector: {
      hasCorrections: () => false,
      getCorrections: () => [],
      getSummary: () => ({ total: 0, by_type: {}, by_layer: {} }),
      addByStage: () => {},
      recordValidationAttempt: () => {},
    },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    validationSummary: undefined,
    structuralMeta: undefined,
    clarifierResult: undefined,
    quality: undefined,
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

describe("v0.11.0 end-to-end production path: runStagePackage → V3 transform", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = buildPostParseContext({
      // ctx.coaching, ctx.causalClaims, ctx.topologyPlan as runStageParse
      // would have stashed them from the adapter's DraftGraphResult.
      coaching: {
        summary: "Acquisition trades faster customer growth for higher runway risk.",
        strengthen_items: [
          {
            id: "s1",
            label: "Stress synergy",
            detail: "Recast the synergy estimate as a range.",
            action_type: "add_constraint",
            bias_category: "anchoring",
          },
        ],
        widening_log: {
          elements_added: ["fac_a"],
          elements_considered_but_excluded: ["regulatory pause unlikely"],
          brief_completeness: "partial",
        },
        bias_signals: [
          { type: "narrow_framing", detail: "Decision framed as binary." },
        ],
      },
      causalClaims: [
        { type: "direct_effect", from: "fac_a", to: "out_x", stated_strength: "strong" },
        { type: "no_direct_effect", from: "opt_a", to: "goal_g" },
      ],
      topologyPlan: ["fac_a -> out_x", "out_x -> goal_g"],
    });
  });

  it("Stage 5 packages all three fields onto ctx.ceeResponse", async () => {
    await runStagePackage(ctx);
    const v1 = ctx.ceeResponse as V1DraftGraphResponse;
    expect(v1.coaching).toBeDefined();
    expect((v1 as { causal_claims?: unknown }).causal_claims).toBeDefined();
    expect((v1 as { topology_plan?: unknown[] }).topology_plan).toEqual([
      "fac_a -> out_x",
      "out_x -> goal_g",
    ]);
  });

  it("Stage 6 V3 transform preserves coaching, causal_claims, topology_plan from Stage 5 output", async () => {
    await runStagePackage(ctx);
    const v1 = ctx.ceeResponse as V1DraftGraphResponse;
    const v3 = transformResponseToV3(v1);
    const v3any = v3 as unknown as Record<string, unknown>;
    expect(v3any.coaching).toBeDefined();
    expect(v3any.causal_claims).toEqual(ctx.causalClaims);
    expect(v3any.topology_plan).toEqual(ctx.topologyPlan);
  });

  it("V3 boundary parse (CEEGraphResponseV3) accepts the production-path output", async () => {
    await runStagePackage(ctx);
    const v1 = ctx.ceeResponse as V1DraftGraphResponse;
    const v3 = transformResponseToV3(v1);
    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `V3 boundary parse failed: ${first?.path.join(".")} — ${first?.message}`,
      );
    }
    const parsed = result.data as unknown as Record<string, unknown>;
    expect(parsed.coaching).toBeDefined();
    expect(parsed.causal_claims).toEqual(ctx.causalClaims);
    expect(parsed.topology_plan).toEqual(ctx.topologyPlan);
  });

  it("legacy ctx.coaching ABSENT path → V3 emits canonical empty coaching block (required-with-default)", async () => {
    const ctxAbsent = buildPostParseContext({
      coaching: undefined,
      causalClaims: undefined,
      topologyPlan: undefined,
    });
    await runStagePackage(ctxAbsent);
    const v1 = ctxAbsent.ceeResponse as V1DraftGraphResponse;
    const v3 = transformResponseToV3(v1);
    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `V3 boundary parse failed (legacy path): ${first?.path.join(".")} — ${first?.message}`,
      );
    }
    // Coaching is REQUIRED at V3; legacy absence is normalised to canonical empty.
    const v3any = result.data as unknown as Record<string, unknown>;
    expect(v3any.coaching).toBeDefined();
    expect((v3any.coaching as { summary: unknown }).summary).toBeNull();
    // causal_claims defaults to [] at V3 boundary.
    expect(v3any.causal_claims).toEqual([]);
    // topology_plan defaults to [] at V3 boundary.
    expect(v3any.topology_plan).toEqual([]);
  });
});
