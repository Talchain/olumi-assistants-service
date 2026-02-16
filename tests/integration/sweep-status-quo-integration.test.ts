/**
 * Integration Test: Status Quo with Zero Outgoing Edges
 *
 * Constructs a graph where opt_status_quo has zero option→factor edges,
 * runs through the deterministic sweep, and verifies:
 * 1. Sweep ran and produced proof trace fields
 * 2. Status quo was handled (wired or marked droppable)
 * 3. LLM repair was NOT called (llmRepairNeeded = false)
 *
 * Includes both:
 * - Mocked validator test (fast, isolated)
 * - Real validator test (catches validator drift)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must come before imports that use them) ──────────────────────────

// vi.hoisted runs before vi.mock hoisting, making mockValidateGraph available
const { mockValidateGraph } = vi.hoisted(() => ({
  mockValidateGraph: vi.fn().mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
    errorCount: 0,
    warningCount: 0,
    normalized: null,
  }),
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

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { runDeterministicSweep } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { DETERMINISTIC_SWEEP_VERSION } from "../../src/cee/constants/versions.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeStatusQuoGraph(): any {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Expand into mid-market?" },
      { id: "opt_expand", kind: "option", label: "Expand to mid-market", data: { interventions: { fac_price: 149, fac_features: 0.8 } } },
      { id: "opt_upmarket", kind: "option", label: "Go upmarket", data: { interventions: { fac_price: 299, fac_features: 0.9 } } },
      { id: "opt_status_quo", kind: "option", label: "Stay in current segment" },
      // ↑ opt_status_quo has ZERO outgoing edges — this is the failure mode
      { id: "fac_price", kind: "factor", label: "Pricing", category: "controllable", data: { value: 99, extractionType: "explicit", factor_type: "price", uncertainty_drivers: ["Competitor response"] } },
      { id: "fac_features", kind: "factor", label: "Feature Completeness", category: "controllable", data: { value: 0.6, extractionType: "inferred", factor_type: "quality", uncertainty_drivers: ["Dev capacity"] } },
      { id: "out_revenue", kind: "outcome", label: "Revenue Growth" },
      { id: "goal_1", kind: "goal", label: "Maximize sustainable growth" },
    ],
    edges: [
      // Decision → options
      { from: "dec_1", to: "opt_expand", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "dec_1", to: "opt_upmarket", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "dec_1", to: "opt_status_quo", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      // Options → factors (only for expand + upmarket — NOT status quo)
      { from: "opt_expand", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_expand", to: "fac_features", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_upmarket", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_upmarket", to: "fac_features", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      // Factors → outcome → goal
      { from: "fac_price", to: "out_revenue", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { from: "fac_features", to: "out_revenue", strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.85, effect_direction: "positive" },
      { from: "out_revenue", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function makeCtx(graph: any): any {
  return {
    graph,
    requestId: "test-status-quo-integration",
    repairTrace: {},
  };
}

// =============================================================================
// Test Suite 1: Mocked validator — fast, isolated
// =============================================================================

describe("Sweep status quo integration — mocked validator", () => {
  beforeEach(() => {
    mockValidateGraph.mockReset();
  });

  it("wires opt_status_quo and sets sweep trace fields (zero-edge failure mode)", async () => {
    // First call (initial validation): report the violations
    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [
        { code: "NO_PATH_TO_GOAL", severity: "error", message: 'Node "opt_status_quo" has no path to goal', path: "nodes[opt_status_quo]" },
        { code: "NO_EFFECT_PATH", severity: "error", message: 'Option "opt_status_quo" has no controllable factors', path: "nodes[opt_status_quo]" },
      ],
      warnings: [],
      errorCount: 2,
      warningCount: 0,
      normalized: null,
    });

    // Second call (re-validation after sweep fixes): all clear
    mockValidateGraph.mockReturnValueOnce({
      valid: true,
      errors: [],
      warnings: [],
      errorCount: 0,
      warningCount: 0,
      normalized: null,
    });

    const graph = makeStatusQuoGraph();
    const ctx = makeCtx(graph);

    await runDeterministicSweep(ctx);

    // 1. Sweep ran and produced proof trace
    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace).toBeDefined();
    expect(sweepTrace.sweep_ran).toBe(true);
    expect(sweepTrace.sweep_version).toBe(DETERMINISTIC_SWEEP_VERSION);
    expect(sweepTrace.bucket_summary).toBeDefined();
    expect(typeof sweepTrace.bucket_summary.a).toBe("number");
    expect(typeof sweepTrace.bucket_summary.b).toBe("number");
    expect(typeof sweepTrace.bucket_summary.c).toBe("number");

    // 2. Status quo was handled — wired with edges
    expect(sweepTrace.status_quo.fixed).toBe(true);

    // 3. LLM repair NOT needed
    expect(ctx.llmRepairNeeded).toBe(false);

    // 4. Graph now has edges from opt_status_quo to factors
    const statusQuoEdges = graph.edges.filter((e: any) => e.from === "opt_status_quo" && e.to.startsWith("fac_"));
    expect(statusQuoEdges.length).toBeGreaterThan(0);

    // 5. Repairs include STATUS_QUO_WIRED
    const repairCodes = ctx.deterministicRepairs.map((r: any) => r.code);
    expect(repairCodes).toContain("STATUS_QUO_WIRED");
  });

  it("marks status quo as droppable when no connected options have intervention targets", async () => {
    // Build a graph where ALL options are disconnected — nothing to copy from
    const graph = {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_status_quo", kind: "option", label: "Status Quo" },
        { id: "out_1", kind: "outcome", label: "Outcome" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_status_quo", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    };

    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [
        { code: "NO_PATH_TO_GOAL", severity: "error", message: 'Option "opt_status_quo" has no path to goal', path: "nodes[opt_status_quo]" },
      ],
      warnings: [],
      errorCount: 1,
      warningCount: 0,
      normalized: null,
    });

    mockValidateGraph.mockReturnValueOnce({
      valid: false,
      errors: [
        { code: "NO_PATH_TO_GOAL", severity: "error", message: 'Option "opt_status_quo" has no path to goal', path: "nodes[opt_status_quo]" },
      ],
      warnings: [],
      errorCount: 1,
      warningCount: 0,
      normalized: null,
    });

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace.sweep_ran).toBe(true);
    expect(sweepTrace.status_quo.marked_droppable).toBe(true);
  });

  it("emits sweep_ran: true even with zero violations", async () => {
    // Valid graph, no violations at all
    mockValidateGraph.mockReturnValueOnce({
      valid: true,
      errors: [],
      warnings: [],
      errorCount: 0,
      warningCount: 0,
      normalized: null,
    });

    // Re-validation call
    mockValidateGraph.mockReturnValueOnce({
      valid: true,
      errors: [],
      warnings: [],
      errorCount: 0,
      warningCount: 0,
      normalized: null,
    });

    const graph = makeStatusQuoGraph();
    // Add edges for status quo so it has a path to goal
    graph.edges.push(
      { from: "opt_status_quo", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    );

    const ctx = makeCtx(graph);
    await runDeterministicSweep(ctx);

    const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
    expect(sweepTrace).toBeDefined();
    expect(sweepTrace.sweep_ran).toBe(true);
    expect(sweepTrace.sweep_version).toBe(DETERMINISTIC_SWEEP_VERSION);
    expect(sweepTrace.bucket_summary).toEqual({ a: 0, b: 0, c: 0 });
    expect(ctx.llmRepairNeeded).toBe(false);
  });
});

// =============================================================================
// Test Suite 2: Real validator — catches validator drift
// =============================================================================

describe("Sweep status quo integration — real validator (no mock)", () => {
  it("wires opt_status_quo using real validateGraph", async () => {
    // Import the real module, bypassing the vi.mock
    const { validateGraph: realValidateGraph } = await vi.importActual<
      typeof import("../../src/validators/graph-validator.js")
    >("../../src/validators/graph-validator.js");

    // Temporarily replace the mock with the real validator
    mockValidateGraph.mockImplementation(realValidateGraph as any);

    try {
      const graph = makeStatusQuoGraph();
      const ctx = makeCtx(graph);

      await runDeterministicSweep(ctx);

      const sweepTrace = ctx.repairTrace?.deterministic_sweep as any;
      expect(sweepTrace).toBeDefined();
      expect(sweepTrace.sweep_ran).toBe(true);
      expect(sweepTrace.sweep_version).toBe(DETERMINISTIC_SWEEP_VERSION);

      // Status quo should be handled — either wired or droppable
      const statusQuoHandled = sweepTrace.status_quo.fixed || sweepTrace.status_quo.marked_droppable;
      expect(statusQuoHandled).toBe(true);

      // Graph should pass validation after sweep (no remaining Bucket C violations)
      // OR if violations remain, they should NOT include NO_PATH_TO_GOAL for opt_status_quo
      // since the sweep should have either wired it or marked it droppable
      const statusQuoEdges = graph.edges.filter((e: any) => e.from === "opt_status_quo");
      if (sweepTrace.status_quo.fixed) {
        // If wired, opt_status_quo should have outgoing edges now
        expect(statusQuoEdges.length).toBeGreaterThan(1); // at least the dec→opt edge + new factor edges
      }

      // Verify the sweep produced real bucket counts
      expect(sweepTrace.bucket_summary).toBeDefined();
    } finally {
      // Restore mock for subsequent tests
      mockValidateGraph.mockReset();
      mockValidateGraph.mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
        errorCount: 0,
        warningCount: 0,
        normalized: null,
      });
    }
  });
});
