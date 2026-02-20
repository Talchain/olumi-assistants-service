/**
 * LLM Repair Gating — Bucket-Specific End-to-End Tests
 *
 * Tests run through runDeterministicSweep() with mocked graph-validator
 * to verify that ctx.llmRepairNeeded is correctly determined based on
 * which bucket violations are present after sweep fixes.
 *
 * Separate file to avoid module-level vi.mock on graph-validator.js
 * affecting the existing deterministic-sweep.test.ts tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

// vi.hoisted runs before vi.mock hoisting, making mockValidateGraph available
const { mockValidateGraph } = vi.hoisted(() => ({
  mockValidateGraph: vi.fn(),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/validators/graph-validator.js", () => ({
  validateGraph: mockValidateGraph,
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { runDeterministicSweep } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeGraph(): any {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
      { id: "fac_price", kind: "factor", label: "Price", category: "controllable", data: { value: 0.5, factor_type: "cost", extractionType: "explicit", uncertainty_drivers: ["market"] } },
      { id: "out_revenue", kind: "outcome", label: "Revenue" },
      { id: "goal_1", kind: "goal", label: "Maximise Revenue" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "dec_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_b", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_price", to: "out_revenue", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" },
      { from: "out_revenue", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function makeCtx(graph: any): any {
  return {
    graph,
    requestId: "test-gating",
    repairTrace: {},
  };
}

function validResult() {
  return {
    valid: true,
    errors: [],
    warnings: [],
    errorCount: 0,
    warningCount: 0,
    normalized: null,
  };
}

// =============================================================================
// Bucket-Specific Gating Tests
// =============================================================================

describe("LLM repair gating — bucket-specific scenarios", () => {
  beforeEach(() => {
    mockValidateGraph.mockReset();
  });

  it("zero violations → llmRepairNeeded = false", async () => {
    mockValidateGraph.mockReturnValue(validResult());

    const ctx = makeCtx(makeGraph());
    await runDeterministicSweep(ctx);

    expect(ctx.llmRepairNeeded).toBe(false);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.bucket_summary).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("Bucket A only (NAN_VALUE) → llmRepairNeeded = false", async () => {
    // Initial: Bucket A violation
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [
        { code: "NAN_VALUE", severity: "error", message: "NaN value on edge", path: "edges[0].strength_mean" },
      ],
      warnings: [],
      errorCount: 1,
      warningCount: 0,
      normalized: null,
    });

    // Re-validation after sweep fixes NaN: clean
    mockValidateGraph.mockReturnValueOnce(validResult());

    const graph = makeGraph();
    // Inject a NaN to trigger the fix
    graph.edges[2].strength_mean = NaN;

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    expect(ctx.llmRepairNeeded).toBe(false);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.bucket_summary.a).toBe(1);
    expect(sweepTrace.bucket_summary.c).toBe(0);
  });

  it("Bucket B only (CATEGORY_MISMATCH) → llmRepairNeeded = false", async () => {
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [
        { code: "CATEGORY_MISMATCH", severity: "error", message: "Factor category mismatch", path: "nodes[fac_price].category" },
      ],
      warnings: [],
      errorCount: 1,
      warningCount: 0,
      normalized: null,
    });

    mockValidateGraph.mockReturnValueOnce(validResult());

    const ctx = makeCtx(makeGraph());
    await runDeterministicSweep(ctx);

    expect(ctx.llmRepairNeeded).toBe(false);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.bucket_summary.b).toBe(1);
    expect(sweepTrace.bucket_summary.c).toBe(0);
  });

  it("Bucket C present (NO_PATH_TO_GOAL persists) → llmRepairNeeded = true", async () => {
    const violation = {
      code: "NO_PATH_TO_GOAL",
      severity: "error",
      message: 'Node "opt_orphan" has no path to goal',
      path: "nodes[opt_orphan]",
    };

    // Initial: Bucket C violation
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [violation],
      warnings: [],
      errorCount: 1,
      warningCount: 0,
      normalized: null,
    });

    // Re-validation: still invalid (sweep can't fix semantic issues)
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [violation],
      warnings: [],
      errorCount: 1,
      warningCount: 0,
      normalized: null,
    });

    const graph = makeGraph();
    // Add an orphan option that has no path to goal
    graph.nodes.push({ id: "opt_orphan", kind: "option", label: "Orphan" });
    graph.edges.push({ from: "dec_1", to: "opt_orphan", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" });

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    expect(ctx.llmRepairNeeded).toBe(true);

    // remainingViolations should contain the persisting Bucket C violation
    expect(ctx.remainingViolations).toBeDefined();
    expect(ctx.remainingViolations.length).toBeGreaterThan(0);
    expect(ctx.remainingViolations.some((v: any) => v.code === "NO_PATH_TO_GOAL")).toBe(true);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.bucket_summary.c).toBeGreaterThan(0);
  });

  it("Mixed A + C (NAN_VALUE + NO_PATH_TO_GOAL persists) → llmRepairNeeded = true", async () => {
    const persistingViolation = {
      code: "NO_PATH_TO_GOAL",
      severity: "error",
      message: 'Node "opt_orphan" has no path to goal',
      path: "nodes[opt_orphan]",
    };

    // Initial: both Bucket A and Bucket C violations
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [
        { code: "NAN_VALUE", severity: "error", message: "NaN on edge", path: "edges[0].strength_mean" },
        persistingViolation,
      ],
      warnings: [],
      errorCount: 2,
      warningCount: 0,
      normalized: null,
    });

    // Re-validation: A fixed, C persists
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [persistingViolation],
      warnings: [],
      errorCount: 1,
      warningCount: 0,
      normalized: null,
    });

    const graph = makeGraph();
    graph.edges[2].strength_mean = NaN;
    graph.nodes.push({ id: "opt_orphan", kind: "option", label: "Orphan" });
    graph.edges.push({ from: "dec_1", to: "opt_orphan", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" });

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    expect(ctx.llmRepairNeeded).toBe(true);

    // remainingViolations should contain the persisting Bucket C violation (not the fixed Bucket A)
    expect(ctx.remainingViolations).toBeDefined();
    expect(ctx.remainingViolations.some((v: any) => v.code === "NO_PATH_TO_GOAL")).toBe(true);
    expect(ctx.remainingViolations.some((v: any) => v.code === "NAN_VALUE")).toBe(false);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.bucket_summary.a).toBeGreaterThan(0);
    expect(sweepTrace.bucket_summary.c).toBeGreaterThan(0);
  });

  it("goal threshold fields pass through deterministic sweep (stripping moved to Stage 4b)", async () => {
    mockValidateGraph.mockReturnValue(validResult());

    const graph = makeGraph();
    // Inject ungrounded goal_threshold (no goal_threshold_raw)
    const goal = graph.nodes.find((n: any) => n.kind === "goal");
    goal.goal_threshold = 0.7;
    goal.goal_threshold_unit = "%";
    goal.goal_threshold_cap = 100;

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    // Deterministic sweep no longer strips threshold fields — that's Stage 4b's job.
    // Fields should pass through unchanged.
    const outputGoal = ctx.graph.nodes.find((n: any) => n.kind === "goal");
    expect(outputGoal.goal_threshold).toBe(0.7);
    expect(outputGoal.goal_threshold_unit).toBe("%");
    expect(outputGoal.goal_threshold_cap).toBe(100);

    // No threshold repair emitted by deterministic sweep
    const thresholdRepairs = (ctx.deterministicRepairs ?? []).filter(
      (r: any) => r.code === "GOAL_THRESHOLD_STRIPPED_NO_RAW",
    );
    expect(thresholdRepairs).toHaveLength(0);

    // Trace count stays at zero
    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.goal_threshold_stripped).toBe(0);
  });

  it("goal threshold preserved via Step 4b when goal_threshold_raw present", async () => {
    mockValidateGraph.mockReturnValue(validResult());

    const graph = makeGraph();
    const goal = graph.nodes.find((n: any) => n.kind === "goal");
    goal.goal_threshold = 0.8;
    goal.goal_threshold_raw = 800;
    goal.goal_threshold_unit = "customers";
    goal.goal_threshold_cap = 1000;

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    const outputGoal = ctx.graph.nodes.find((n: any) => n.kind === "goal");
    expect(outputGoal.goal_threshold).toBe(0.8);
    expect(outputGoal.goal_threshold_raw).toBe(800);
    expect(outputGoal.goal_threshold_unit).toBe("customers");
    expect(outputGoal.goal_threshold_cap).toBe(1000);

    // No threshold repair
    expect(ctx.deterministicRepairs.some((r: any) => r.code === "GOAL_THRESHOLD_STRIPPED_NO_RAW")).toBe(false);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.goal_threshold_stripped).toBe(0);
  });

  it("Bucket C resolved by status-quo fix → llmRepairNeeded = false", async () => {
    // Initial: Bucket C violation for disconnected status quo
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [
        { code: "NO_PATH_TO_GOAL", severity: "error", message: 'Option "opt_status_quo" has no path to goal', path: "nodes[opt_status_quo]" },
        { code: "NO_EFFECT_PATH", severity: "error", message: 'Option "opt_status_quo" has no effect path', path: "nodes[opt_status_quo]" },
      ],
      warnings: [],
      errorCount: 2,
      warningCount: 0,
      normalized: null,
    });

    // Re-validation after status quo wiring: all clear
    mockValidateGraph.mockReturnValueOnce(validResult());

    const graph = makeGraph();
    // Add a disconnected status quo option
    graph.nodes.push({ id: "opt_status_quo", kind: "option", label: "Status Quo" });
    graph.edges.push({ from: "dec_1", to: "opt_status_quo", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" });

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    expect(ctx.llmRepairNeeded).toBe(false);

    // Status quo should have been wired
    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.status_quo.fixed).toBe(true);
  });
});
