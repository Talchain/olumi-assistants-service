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
