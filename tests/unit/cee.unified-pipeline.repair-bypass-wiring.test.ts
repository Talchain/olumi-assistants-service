/**
 * Wiring test for the OPTIONS_IDENTICAL bypass inside runStageRepair.
 *
 * Proves the substep ordering invariant:
 *
 *   1. runDeterministicSweep populates ctx.remainingViolations
 *   1.5. runOptionsIdenticalBypass detects OPTIONS_IDENTICAL → sets earlyReturn
 *   ★ runPlotValidation MUST NOT be called when the bypass fires.
 *
 * This is the load-bearing assertion for the user-stated requirement
 * "OPTIONS_IDENTICAL is never allowed to reach an 86s failed repair path."
 *
 * Other Bucket C codes (NO_PATH_TO_GOAL, NO_EFFECT_PATH) must still flow
 * through to LLM repair — that's verified by the negative case below.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the deterministic sweep to populate ctx.remainingViolations with a
// controlled violation set; mock all downstream substeps as spies so we
// can assert which ones were called.
// vi.hoisted() lets the vi.mock factories (also hoisted) reference these.
const {
  runDeterministicSweepMock,
  runOrchestratorValidationMock,
  runPlotValidationMock,
  runEdgeStabilisationMock,
  runGoalMergeMock,
  runCompoundGoalsMock,
  runLateStrpMock,
  runEdgeRestorationMock,
  runConnectivityMock,
  runClarifierMock,
  runStructuralParseMock,
  applyDeterministicEnforcementMock,
} = vi.hoisted(() => ({
  runDeterministicSweepMock: vi.fn(),
  runOrchestratorValidationMock: vi.fn(),
  runPlotValidationMock: vi.fn(),
  runEdgeStabilisationMock: vi.fn(),
  runGoalMergeMock: vi.fn(),
  runCompoundGoalsMock: vi.fn(),
  runLateStrpMock: vi.fn(),
  runEdgeRestorationMock: vi.fn(),
  runConnectivityMock: vi.fn(),
  runClarifierMock: vi.fn(),
  runStructuralParseMock: vi.fn(),
  applyDeterministicEnforcementMock: vi.fn(),
}));

vi.mock("../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js", () => ({
  runDeterministicSweep: runDeterministicSweepMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/orchestrator-validation.js", () => ({
  runOrchestratorValidation: runOrchestratorValidationMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/plot-validation.js", () => ({
  runPlotValidation: runPlotValidationMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/edge-stabilisation.js", () => ({
  runEdgeStabilisation: runEdgeStabilisationMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/goal-merge.js", () => ({
  runGoalMerge: runGoalMergeMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/compound-goals.js", () => ({
  runCompoundGoals: runCompoundGoalsMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/late-strp.js", () => ({
  runLateStrp: runLateStrpMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/edge-restoration.js", () => ({
  runEdgeRestoration: runEdgeRestorationMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/connectivity.js", () => ({
  runConnectivity: runConnectivityMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/clarifier.js", () => ({
  runClarifier: runClarifierMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/structural-parse.js", () => ({
  runStructuralParse: runStructuralParseMock,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js", () => ({
  applyDeterministicEnforcement: applyDeterministicEnforcementMock,
}));

vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...original,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";

function makeOutcome(): PipelineOutcome {
  return {
    graph_drafted: false,
    graph_structurally_valid: false,
    deterministic_sweep_violations: 0,
    verification_status: "pass",
    validation_status: "pass",
    enrichment_status: "complete",
    coaching_status: "complete",
    warnings: [],
    llm_repair: { applied: false, cost: 0, duration_ms: 0 },
    repair_provenance: [],
  } as unknown as PipelineOutcome;
}

function makeCtx(): StageContext {
  return {
    requestId: "req-wiring-test",
    graph: { nodes: [{ id: "n", kind: "goal", label: "g" }], edges: [], version: "1.2" } as any,
    pipelineOutcome: makeOutcome(),
    remainingViolations: undefined,
  } as StageContext;
}

describe("runStageRepair — OPTIONS_IDENTICAL bypass wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("OPTIONS_IDENTICAL detected → bypass fires, runPlotValidation NOT called (no 86s LLM repair)", async () => {
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      ctx.remainingViolations = [
        {
          code: "OPTIONS_IDENTICAL",
          context: { optionIds: ["opt_a", "opt_b"], signature: "fac_x:1.0000" },
        },
      ];
      ctx.llmRepairNeeded = true;
    });

    const ctx = makeCtx();
    await runStageRepair(ctx);

    // Bypass fired
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    expect((ctx.earlyReturn?.body as Record<string, unknown>).code).toBe("CEE_GRAPH_INVALID");

    // Deterministic sweep ran (substep 1)
    expect(runDeterministicSweepMock).toHaveBeenCalledTimes(1);

    // CRITICAL: LLM repair (PLoT validation substep 2) was NOT called.
    // This is the assertion that proves we are no longer paying the
    // ~30s repair-then-fail cost for OPTIONS_IDENTICAL.
    expect(runPlotValidationMock).not.toHaveBeenCalled();

    // Downstream substeps also NOT called (early return).
    expect(runOrchestratorValidationMock).not.toHaveBeenCalled();
    expect(runEdgeStabilisationMock).not.toHaveBeenCalled();
    expect(runGoalMergeMock).not.toHaveBeenCalled();
    expect(runCompoundGoalsMock).not.toHaveBeenCalled();
    expect(runLateStrpMock).not.toHaveBeenCalled();
    expect(runEdgeRestorationMock).not.toHaveBeenCalled();
    expect(runConnectivityMock).not.toHaveBeenCalled();
    expect(runClarifierMock).not.toHaveBeenCalled();
    expect(applyDeterministicEnforcementMock).not.toHaveBeenCalled();
    expect(runStructuralParseMock).not.toHaveBeenCalled();
  });

  it("NO_PATH_TO_GOAL alone (no OPTIONS_IDENTICAL) → bypass does NOT fire, LLM repair still runs", async () => {
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      ctx.remainingViolations = [
        { code: "NO_PATH_TO_GOAL", path: "nodes[opt_a]" },
      ];
      ctx.llmRepairNeeded = true;
    });

    const ctx = makeCtx();
    await runStageRepair(ctx);

    // Bypass did NOT fire — earlyReturn is unset (unless a downstream
    // substep set it, but the mocks are no-op).
    expect(ctx.earlyReturn).toBeUndefined();

    // CRITICAL: LLM repair (PLoT validation) MUST have been called.
    // Other Bucket C codes are still LLM-repaired — only OPTIONS_IDENTICAL
    // is gated.
    expect(runPlotValidationMock).toHaveBeenCalledTimes(1);

    // Downstream substeps run as normal.
    expect(runEdgeStabilisationMock).toHaveBeenCalledTimes(1);
    expect(runGoalMergeMock).toHaveBeenCalledTimes(1);
  });

  it("OPTIONS_IDENTICAL mixed with other Bucket C codes → bypass STILL fires (fail-fast wins)", async () => {
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      ctx.remainingViolations = [
        { code: "NO_PATH_TO_GOAL", path: "nodes[opt_a]" },
        {
          code: "OPTIONS_IDENTICAL",
          context: { optionIds: ["opt_a", "opt_b"] },
        },
        { code: "NO_EFFECT_PATH", path: "nodes[opt_b]" },
      ];
      ctx.llmRepairNeeded = true;
    });

    const ctx = makeCtx();
    await runStageRepair(ctx);

    // Bypass fires regardless of other Bucket C codes — the user-actionable
    // recovery copy is more useful than a generic LLM-repair-failed message.
    expect(ctx.earlyReturn).toBeDefined();
    expect(runPlotValidationMock).not.toHaveBeenCalled();
  });

  it("empty remainingViolations → bypass does NOT fire, normal pipeline continues", async () => {
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      ctx.remainingViolations = [];
      ctx.llmRepairNeeded = false;
    });

    const ctx = makeCtx();
    await runStageRepair(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(runPlotValidationMock).toHaveBeenCalledTimes(1);
    expect(runOrchestratorValidationMock).toHaveBeenCalledTimes(1);
  });
});

// PR #203 round-2 review test #1: prove auto-baseline dedup occurs
// BEFORE the deterministic sweep AND prevents the PR #202 OPTIONS_IDENTICAL
// bypass for the auto-baseline-only case (not for other Bucket C codes
// or non-baseline duplicates).
//
// This test does NOT mock runAutoBaselineDedup — it lets the real
// function run against a controlled graph. The deterministic sweep mock
// observes the post-dedup graph and reports what OPTIONS_IDENTICAL it
// would detect.
describe("runStageRepair — auto-baseline dedup ordering (PR #203)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explicit-baseline duplicate → dedup mutates ctx.graph before sweep; sweep sees clean graph; PR #202 bypass does NOT fire", async () => {
    // Sweep mock records what graph it saw. It also reports
    // remainingViolations as empty (because the dedup already cleaned
    // the auto-baseline duplicate before sweep ran).
    let nodesSeenBySweep: number | null = null;
    let optionsSeenBySweep: number | null = null;
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      const nodes = (ctx.graph as { nodes?: Array<{ kind?: string }> } | undefined)?.nodes ?? [];
      nodesSeenBySweep = nodes.length;
      optionsSeenBySweep = nodes.filter((n) => n.kind === "option").length;
      ctx.remainingViolations = []; // No OPTIONS_IDENTICAL after dedup.
      ctx.llmRepairNeeded = false;
    });

    const ctx = {
      requestId: "req-dedup-wiring",
      graph: {
        nodes: [
          { id: "dec", kind: "decision" },
          {
            id: "opt_explicit",
            kind: "option",
            label: "Explicit option",
            data: { interventions: { fac_x: 0.5 } },
          },
          {
            id: "opt_status_quo",
            kind: "option",
            label: "Status Quo",
            // EXPLICIT is_baseline=true: dedup will fire.
            data: { is_baseline: true, interventions: { fac_x: 0.5 } },
          },
        ],
        edges: [
          { from: "dec", to: "opt_explicit" },
          { from: "dec", to: "opt_status_quo" },
        ],
        version: "1.2",
      },
      pipelineOutcome: makeOutcome(),
      remainingViolations: undefined,
    } as unknown as StageContext;

    await runStageRepair(ctx);

    // The dedup ran (substep 0.9). The sweep saw the post-dedup graph:
    // one fewer option node, one fewer edge.
    expect(optionsSeenBySweep).toBe(1);
    expect(nodesSeenBySweep).toBe(2); // decision + 1 option (status quo dropped)

    // The PR #202 bypass did NOT fire (no OPTIONS_IDENTICAL detected
    // after dedup, no earlyReturn set).
    expect(ctx.earlyReturn).toBeUndefined();
    // Downstream substeps proceed normally — graph is valid.
    expect(runPlotValidationMock).toHaveBeenCalledTimes(1);
  });

  it("heuristic-only duplicate (no explicit flag) → dedup declines; PR #202 bypass STILL fires for OPTIONS_IDENTICAL", async () => {
    // The duplicate is heuristic-only (label "Status Quo" but no
    // is_baseline=true). Dedup must NOT delete it. The sweep should
    // still see both options, raise OPTIONS_IDENTICAL, and the
    // PR #202 bypass should fire.
    let optionsSeenBySweep: number | null = null;
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      const nodes = (ctx.graph as { nodes?: Array<{ kind?: string }> } | undefined)?.nodes ?? [];
      optionsSeenBySweep = nodes.filter((n) => n.kind === "option").length;
      ctx.remainingViolations = [
        {
          code: "OPTIONS_IDENTICAL",
          context: { optionIds: ["opt_a", "opt_heuristic"], signature: "fac_x:0.5000" },
        },
      ];
      ctx.llmRepairNeeded = true;
    });

    const ctx = {
      requestId: "req-dedup-heuristic",
      graph: {
        nodes: [
          { id: "dec", kind: "decision" },
          {
            id: "opt_a",
            kind: "option",
            label: "Active option",
            data: { interventions: { fac_x: 0.5 } },
          },
          {
            id: "opt_heuristic",
            kind: "option",
            label: "Status Quo", // heuristic match, NO explicit flag
            data: { interventions: { fac_x: 0.5 } },
          },
        ],
        edges: [],
        version: "1.2",
      },
      pipelineOutcome: makeOutcome(),
      remainingViolations: undefined,
    } as unknown as StageContext;

    await runStageRepair(ctx);

    // Both options preserved (dedup did NOT delete the heuristic-only
    // baseline-shaped option).
    expect(optionsSeenBySweep).toBe(2);

    // The PR #202 bypass DID fire because OPTIONS_IDENTICAL survived.
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(400);

    // The LLM repair (PLoT validation substep) was NOT invoked — the
    // PR #202 bypass returned earlyReturn before plot-validation.
    expect(runPlotValidationMock).not.toHaveBeenCalled();
  });

  it("no duplicate signatures → dedup is a no-op; normal pipeline flow", async () => {
    let optionsSeenBySweep: number | null = null;
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      const nodes = (ctx.graph as { nodes?: Array<{ kind?: string }> } | undefined)?.nodes ?? [];
      optionsSeenBySweep = nodes.filter((n) => n.kind === "option").length;
      ctx.remainingViolations = [];
      ctx.llmRepairNeeded = false;
    });

    const ctx = {
      requestId: "req-no-dedup",
      graph: {
        nodes: [
          { id: "dec", kind: "decision" },
          { id: "opt_a", kind: "option", data: { interventions: { fac_x: 0.5 } } },
          { id: "opt_b", kind: "option", data: { interventions: { fac_x: 0.7 } } },
          {
            id: "opt_status_quo",
            kind: "option",
            data: { is_baseline: true, interventions: { fac_x: 0 } }, // distinct
          },
        ],
        edges: [],
        version: "1.2",
      },
      pipelineOutcome: makeOutcome(),
      remainingViolations: undefined,
    } as unknown as StageContext;

    await runStageRepair(ctx);

    // All 3 options preserved — no duplicates exist.
    expect(optionsSeenBySweep).toBe(3);
    expect(ctx.earlyReturn).toBeUndefined();
    expect(runPlotValidationMock).toHaveBeenCalledTimes(1);
  });
});

// ROADMAP 2.53 mitigation rung 1: when the OPTIONS_IDENTICAL collision that
// reaches the substep-1.5 bypass consists entirely of AI-inferred options
// (no is_baseline flag, no baseline-shaped label — the exact observed
// 2026-07-14 staging failure shape), the bypass drops the duplicate and the
// pipeline CONTINUES instead of early-returning. This wiring test lets the
// real bypass + graceful dedup run (only the sweep and downstream substeps
// are mocked) and proves the draft proceeds to substep 2+.
describe("runStageRepair — OPTIONS_IDENTICAL graceful dedup continuation (ROADMAP 2.53)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AI-inferred duplicate pair + third distinct option → duplicate dropped, earlyReturn NOT set, pipeline continues", async () => {
    runDeterministicSweepMock.mockImplementation(async (ctx: StageContext) => {
      ctx.remainingViolations = [
        {
          code: "OPTIONS_IDENTICAL",
          context: {
            optionIds: ["opt_smb", "opt_hybrid"],
            signature: "fac_enterprise_focus:0.0000|fac_smb_focus:1.0000",
          },
        },
      ];
      ctx.llmRepairNeeded = true;
    });

    const ctx = {
      requestId: "req-graceful-dedup-wiring",
      graph: {
        nodes: [
          { id: "decision_1", kind: "decision", label: "Enterprise vs SMB?" },
          {
            id: "opt_enterprise",
            kind: "option",
            label: "Focus on enterprise",
            data: { interventions: { fac_enterprise_focus: 1, fac_smb_focus: 0 } },
          },
          {
            id: "opt_smb",
            kind: "option",
            label: "Focus on SMB",
            data: { interventions: { fac_enterprise_focus: 0, fac_smb_focus: 1 } },
          },
          {
            id: "opt_hybrid",
            kind: "option",
            label: "Hybrid approach",
            data: { interventions: { fac_enterprise_focus: 0, fac_smb_focus: 1 } },
          },
          {
            id: "fac_enterprise_focus",
            kind: "factor",
            label: "Enterprise focus",
            category: "controllable",
            data: { value: 0.5, extractionType: "explicit", factor_type: "other", uncertainty_drivers: ["market"] },
          },
          {
            id: "fac_smb_focus",
            kind: "factor",
            label: "SMB focus",
            category: "controllable",
            data: { value: 0.5, extractionType: "explicit", factor_type: "other", uncertainty_drivers: ["market"] },
          },
          { id: "outcome_1", kind: "outcome", label: "Revenue" },
          { id: "goal_1", kind: "goal", label: "Grow revenue" },
        ],
        edges: [
          { from: "decision_1", to: "opt_enterprise", strength_mean: 1, belief_exists: 1 },
          { from: "decision_1", to: "opt_smb", strength_mean: 1, belief_exists: 1 },
          { from: "decision_1", to: "opt_hybrid", strength_mean: 1, belief_exists: 1 },
          { from: "opt_enterprise", to: "fac_enterprise_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_smb", to: "fac_smb_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_hybrid", to: "fac_smb_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "fac_enterprise_focus", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
          { from: "fac_smb_focus", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
          { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
        ],
        version: "1.2",
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
      pipelineOutcome: makeOutcome(),
      remainingViolations: undefined,
    } as unknown as StageContext;

    await runStageRepair(ctx);

    // The bypass did NOT early-return — the duplicate was dropped instead.
    expect(ctx.earlyReturn).toBeUndefined();
    const nodes = (ctx.graph as { nodes?: Array<{ id?: string; kind?: string }> }).nodes ?? [];
    const optionIds = nodes.filter((n) => n.kind === "option").map((n) => n.id);
    expect(optionIds).toEqual(["opt_enterprise", "opt_smb"]);
    const edges = (ctx.graph as { edges?: Array<{ from?: string; to?: string }> }).edges ?? [];
    expect(edges.some((e) => e.from === "opt_hybrid" || e.to === "opt_hybrid")).toBe(false);

    // Pipeline CONTINUED: substeps after 1.5 all ran.
    expect(runOrchestratorValidationMock).toHaveBeenCalledTimes(1);
    expect(runPlotValidationMock).toHaveBeenCalledTimes(1);
    expect(runEdgeStabilisationMock).toHaveBeenCalledTimes(1);
    expect(runGoalMergeMock).toHaveBeenCalledTimes(1);
    expect(runStructuralParseMock).toHaveBeenCalledTimes(1);

    // Post-drop state was re-derived: no stale OPTIONS_IDENTICAL, and this
    // fully-valid fixture needs no LLM repair.
    expect((ctx.remainingViolations ?? []).map((v) => v.code)).not.toContain("OPTIONS_IDENTICAL");
    expect(ctx.llmRepairNeeded).toBe(false);
  });
});
