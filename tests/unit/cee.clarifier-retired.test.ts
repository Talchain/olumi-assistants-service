/**
 * Stage-4 clarifier retirement pin (ROADMAP 1.94, Option A — 16 Jul 2026).
 *
 * The in-pipeline draft clarifier was retired after being verified
 * triple-dead on staging:
 *   1. Its convergence gate scored round(drafter-confidence × 10) ≥ 8 and
 *      short-circuited BEFORE question generation on 100% of firings
 *      (0 questions asked in ≥7 days of logs, positive-control-verified).
 *   2. The V5 draft tool discarded the `clarifier` response block anyway.
 *   3. Nothing on the live path ever sent `clarifier_response` back, so the
 *      answer-incorporation loop was unreachable.
 *
 * This test pins the retirement: running the FULL Stage-4 repair
 * orchestrator — even with the retired CEE_CLARIFIER_ENABLED flag forced on
 * via config — must emit ZERO `cee.clarifier.*` telemetry and must not
 * attach any clarifier result to the stage context.
 *
 * MUTATION CHECK: re-adding the old `runClarifier(ctx)` invocation (with its
 * module) to runStageRepair turns BOTH assertions RED under this config —
 * the old stage emitted `cee.clarifier.session_start` + `cee.clarifier.converged`
 * and set `ctx.clarifierResult` on every enabled draft.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock every sibling substep (all exist pre- and post-retirement) ─────────
const substepMocks = vi.hoisted(() => ({
  runAutoBaselineDedup: vi.fn(),
  runDeterministicSweep: vi.fn(),
  runOptionsIdenticalBypass: vi.fn().mockReturnValue(false),
  runOrchestratorValidation: vi.fn(),
  runPlotValidation: vi.fn(),
  runEdgeStabilisation: vi.fn(),
  runGoalMerge: vi.fn(),
  runCompoundGoals: vi.fn(),
  runLateStrp: vi.fn(),
  runEdgeRestoration: vi.fn(),
  runConnectivity: vi.fn(),
  runStructuralParse: vi.fn(),
  applyDeterministicEnforcement: vi.fn(),
}));

vi.mock("../../src/cee/unified-pipeline/stages/repair/auto-baseline-dedup.js", () => ({
  runAutoBaselineDedup: substepMocks.runAutoBaselineDedup,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js", () => ({
  runDeterministicSweep: substepMocks.runDeterministicSweep,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/options-identical-bypass.js", () => ({
  runOptionsIdenticalBypass: substepMocks.runOptionsIdenticalBypass,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/orchestrator-validation.js", () => ({
  runOrchestratorValidation: substepMocks.runOrchestratorValidation,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/plot-validation.js", () => ({
  runPlotValidation: substepMocks.runPlotValidation,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/edge-stabilisation.js", () => ({
  runEdgeStabilisation: substepMocks.runEdgeStabilisation,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/goal-merge.js", () => ({
  runGoalMerge: substepMocks.runGoalMerge,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/compound-goals.js", () => ({
  runCompoundGoals: substepMocks.runCompoundGoals,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/late-strp.js", () => ({
  runLateStrp: substepMocks.runLateStrp,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/edge-restoration.js", () => ({
  runEdgeRestoration: substepMocks.runEdgeRestoration,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/connectivity.js", () => ({
  runConnectivity: substepMocks.runConnectivity,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/structural-parse.js", () => ({
  runStructuralParse: substepMocks.runStructuralParse,
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js", () => ({
  applyDeterministicEnforcement: substepMocks.applyDeterministicEnforcement,
}));

// Config: force the RETIRED flag on, with the old thresholds the live
// convergence gate used. Post-retirement these keys no longer exist in the
// real config schema — the mock supplies them so the MUTATED (pre-deletion)
// code takes exactly the staging-live path (quality 9 ≥ threshold 8).
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      clarifierEnabled: true,
      clarifierMaxRoundsDefault: 5,
      clarifierQualityThreshold: 8.0,
      clarifierStabilityThreshold: 2,
      clarifierMinImprovementThreshold: 0.5,
      clarifierQuestionCacheTtlSeconds: 3600,
      enforceSingleGoal: true,
    },
    features: {},
  },
  isProduction: vi.fn().mockReturnValue(false),
}));

// Telemetry: spy on emit, keep the real event constants.
const telemetrySpies = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...original,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: telemetrySpies.emit,
  };
});

import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";

function makeCtx(): StageContext {
  return {
    graph: {
      version: "1.2",
      nodes: [
        { id: "goal_1", kind: "goal", label: "Grow revenue" },
        { id: "dec_1", kind: "decision", label: "Pricing" },
        { id: "opt_1", kind: "option", label: "Raise prices" },
        { id: "opt_2", kind: "option", label: "Hold prices" },
      ],
      edges: [
        { from: "dec_1", to: "opt_1" },
        { from: "dec_1", to: "opt_2" },
        { from: "opt_1", to: "goal_1" },
        { from: "opt_2", to: "goal_1" },
      ],
    },
    // Drafter self-confidence 0.9 → old gate computed quality 9 ≥ 8 and
    // converged round-1 (the staging-live "never asks" configuration).
    confidence: 0.9,
    input: { brief: "Should we raise prices next quarter to grow revenue?" },
    requestId: "clarifier-retired-pin",
  } as unknown as StageContext;
}

describe("Stage-4 clarifier retirement (ROADMAP 1.94 Option A)", () => {
  beforeEach(() => {
    telemetrySpies.emit.mockClear();
  });

  it("emits zero cee.clarifier.* telemetry even with the retired flag forced on", async () => {
    const ctx = makeCtx();
    await runStageRepair(ctx);

    // Catch both the retired events by name AND emissions through a deleted
    // TelemetryEvents constant (emit(undefined, …)) — a partially restored
    // stage emits via constants that no longer exist.
    const clarifierEvents = telemetrySpies.emit.mock.calls
      .map((c) => String(c[0]))
      .filter((e) => e.startsWith("cee.clarifier.") || e === "undefined");
    expect(clarifierEvents).toEqual([]);
  });

  it("attaches no clarifier result to the stage context", async () => {
    const ctx = makeCtx();
    await runStageRepair(ctx);

    expect((ctx as unknown as Record<string, unknown>).clarifierResult).toBeUndefined();
  });
});
