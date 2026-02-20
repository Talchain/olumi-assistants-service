/**
 * Behavior tests for Stage 4b (Threshold Sweep).
 *
 * All tests feed fixture graphs directly into the stage function.
 * No LLM calls, no external services.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(goalOverrides: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    default_seed: 42,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Which strategy?" },
      { id: "opt_a", kind: "option", label: "Option A" },
      {
        id: "goal_1",
        kind: "goal",
        label: "Improve UX Quality",
        ...goalOverrides,
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

function makeCtx(goalOverrides: Record<string, unknown> = {}) {
  return {
    requestId: "sweep-test-req",
    graph: makeGraph(goalOverrides),
    deterministicRepairs: [] as Array<{ code: string; path: string; action: string }>,
    repairTrace: {
      deterministic_sweep: {
        sweep_ran: true,
        goal_threshold_stripped: 0,
        goal_threshold_possibly_inferred: 0,
      },
    },
  } as any;
}

function snapshot(obj: unknown): any {
  return structuredClone(obj);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runStageThresholdSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: qualitative goal, fabricated threshold ──────────────────────
  describe("qualitative goal with fabricated threshold", () => {
    it("strips threshold and emits GOAL_THRESHOLD_STRIPPED_NO_DIGITS + GOAL_THRESHOLD_POSSIBLY_INFERRED", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: 70,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
      });

      await runStageThresholdSweep(ctx);

      const goalNode = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_1");
      expect(goalNode.goal_threshold).toBeUndefined();
      expect(goalNode.goal_threshold_raw).toBeUndefined();
      expect(goalNode.goal_threshold_unit).toBeUndefined();
      expect(goalNode.goal_threshold_cap).toBeUndefined();

      const codes = ctx.deterministicRepairs.map((r: any) => r.code);
      expect(codes).toContain("GOAL_THRESHOLD_POSSIBLY_INFERRED");
      expect(codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");
    });
  });

  // ── Test 2: quantitative goal, legitimate threshold ────────────────────
  describe("quantitative goal with legitimate threshold", () => {
    it("preserves threshold when label has digits", async () => {
      const ctx = makeCtx({
        label: "Reach 800 Customers",
        goal_threshold: 0.8,
        goal_threshold_raw: 800,
        goal_threshold_unit: "customers",
        goal_threshold_cap: 1000,
      });

      await runStageThresholdSweep(ctx);

      const goalNode = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_1");
      expect(goalNode.goal_threshold).toBe(0.8);
      expect(goalNode.goal_threshold_raw).toBe(800);
      expect(ctx.deterministicRepairs).toHaveLength(0);
    });
  });

  // ── Test 3: no threshold on goal ───────────────────────────────────────
  describe("goal with no threshold fields", () => {
    it("is a no-op with no repairs", async () => {
      const ctx = makeCtx();

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(0);
    });
  });

  // ── Test 4: threshold present but raw absent ───────────────────────────
  describe("threshold present but raw absent", () => {
    it("strips with GOAL_THRESHOLD_STRIPPED_NO_RAW", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
        // goal_threshold_raw intentionally absent
      });

      await runStageThresholdSweep(ctx);

      const goalNode = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_1");
      expect(goalNode.goal_threshold).toBeUndefined();
      expect(goalNode.goal_threshold_raw).toBeUndefined();
      expect(goalNode.goal_threshold_unit).toBeUndefined();
      expect(goalNode.goal_threshold_cap).toBeUndefined();

      expect(ctx.deterministicRepairs).toHaveLength(1);
      expect(ctx.deterministicRepairs[0].code).toBe("GOAL_THRESHOLD_STRIPPED_NO_RAW");
      expect(ctx.deterministicRepairs[0].path).toBe("nodes[goal_1].goal_threshold");
    });

    it("strips when goal_threshold_raw is null", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: null,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
      });

      await runStageThresholdSweep(ctx);

      const goalNode = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_1");
      expect(goalNode.goal_threshold).toBeUndefined();
      expect(ctx.deterministicRepairs[0].code).toBe("GOAL_THRESHOLD_STRIPPED_NO_RAW");
    });
  });

  // ── Test 5: post-repair ordering ───────────────────────────────────────
  describe("sweep runs after repair (evaluates post-repair labels)", () => {
    it("evaluates the post-repair label, not the original", async () => {
      // Scenario: repair's goal-merge combined "Grow to 100 customers" (has digits)
      // with another goal into "Achieve Growth" (no digits).
      // If the sweep saw the pre-merge label, it would preserve the threshold.
      // Since it sees the post-merge label, it should strip.
      const ctx = makeCtx({
        label: "Achieve Growth", // post-repair label — no digits
        goal_threshold: 0.7,
        goal_threshold_raw: 70,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
      });

      // Simulate that the graph was already processed by repair (goal merge changed label)
      // The original brief had "Grow to 100 customers" but goal merge renamed it.
      await runStageThresholdSweep(ctx);

      // The sweep should evaluate "Achieve Growth" (no digits) and fire 4b-ii/iii
      const codes = ctx.deterministicRepairs.map((r: any) => r.code);
      expect(codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");

      const goalNode = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_1");
      expect(goalNode.goal_threshold).toBeUndefined();
    });
  });

  // ── Test 6: no double-processing ───────────────────────────────────────
  describe("Step 4b before 4b-ii/iii", () => {
    it("node stripped by 4b is skipped by 4b-ii/iii (no double-processing)", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        // raw absent → 4b fires. Even though label has no digits (which would
        // trigger 4b-ii/iii if raw were present), only one repair is emitted.
      });

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(1);
      expect(ctx.deterministicRepairs[0].code).toBe("GOAL_THRESHOLD_STRIPPED_NO_RAW");
    });
  });

  // ── Test 7: no collateral damage ───────────────────────────────────────
  describe("no collateral damage", () => {
    it("non-goal nodes are unchanged; goal nodes only lose threshold fields", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: 70,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
        extra_field: "preserve_me",
      });

      const before = snapshot(ctx.graph);
      await runStageThresholdSweep(ctx);
      const after = ctx.graph as any;

      // Deep-compare all non-goal nodes
      const nonGoalBefore = before.nodes.filter((n: any) => n.kind !== "goal");
      const nonGoalAfter = after.nodes.filter((n: any) => n.kind !== "goal");
      expect(nonGoalAfter).toEqual(nonGoalBefore);

      // For goal nodes, assert only the 4 threshold fields are affected
      const goalBefore = before.nodes.find((n: any) => n.kind === "goal");
      const goalAfter = after.nodes.find((n: any) => n.kind === "goal");

      // Threshold fields should be gone
      expect(goalAfter.goal_threshold).toBeUndefined();
      expect(goalAfter.goal_threshold_raw).toBeUndefined();
      expect(goalAfter.goal_threshold_unit).toBeUndefined();
      expect(goalAfter.goal_threshold_cap).toBeUndefined();

      // All other fields identical
      const { goal_threshold, goal_threshold_raw, goal_threshold_unit, goal_threshold_cap, ...goalBeforeRest } = goalBefore;
      const { goal_threshold: _a, goal_threshold_raw: _b, goal_threshold_unit: _c, goal_threshold_cap: _d, ...goalAfterRest } = goalAfter;
      expect(goalAfterRest).toEqual(goalBeforeRest);

      // Edges unchanged
      expect(after.edges).toEqual(before.edges);

      // Top-level fields unchanged
      expect(after.version).toBe(before.version);
      expect(after.default_seed).toBe(before.default_seed);
    });
  });

  // ── Repair path convention ─────────────────────────────────────────────
  describe("repair paths", () => {
    it("uses id-based format nodes[<id>].goal_threshold", async () => {
      const ctx = makeCtx({ goal_threshold: 0.7 });

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs[0].path).toBe("nodes[goal_1].goal_threshold");
    });
  });

  // ── Finite number guard ────────────────────────────────────────────────
  describe("finite number guard", () => {
    it("skips inferred heuristic when raw is NaN", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: NaN,
      });

      await runStageThresholdSweep(ctx);

      // NaN is not null/undefined, so 4b doesn't fire.
      // NaN is not finite, so 4b-ii/iii is skipped.
      expect(ctx.deterministicRepairs).toHaveLength(0);
    });

    it("skips inferred heuristic when raw is Infinity", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: Infinity,
      });

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(0);
    });

    it("skips inferred heuristic when raw is a string", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: "seventy",
      });

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(0);
    });
  });

  // ── Trace continuity ──────────────────────────────────────────────────
  describe("trace continuity", () => {
    it("updates ctx.repairTrace.deterministic_sweep counts", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: 70,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
      });

      await runStageThresholdSweep(ctx);

      const sweepTrace = (ctx.repairTrace as any).deterministic_sweep;
      expect(sweepTrace.goal_threshold_stripped).toBe(1);
      expect(sweepTrace.goal_threshold_possibly_inferred).toBe(1);
    });

    it("creates deterministicRepairs array if absent", async () => {
      const ctx = makeCtx({ goal_threshold: 0.7 });
      delete ctx.deterministicRepairs;

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(1);
    });
  });

  // ── Null graph guard ──────────────────────────────────────────────────
  describe("null graph guard", () => {
    it("is a no-op when ctx.graph is undefined", async () => {
      const ctx = makeCtx();
      ctx.graph = undefined;

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(0);
    });
  });

  // ── Malformed input resilience (B6 regression) ────────────────────────
  describe("malformed input resilience", () => {
    it("is a no-op when ctx.graph has no nodes array", async () => {
      const ctx = makeCtx();
      ctx.graph = { version: "1.0" }; // no nodes property

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(0);
    });

    it("is a no-op when ctx.graph.nodes is a string", async () => {
      const ctx = makeCtx();
      (ctx.graph as any).nodes = "not an array";

      await runStageThresholdSweep(ctx);

      expect(ctx.deterministicRepairs).toHaveLength(0);
    });

    it("strips when goal_threshold is a string (truthy non-nullish enters strip path)", async () => {
      const ctx = makeCtx({
        goal_threshold: "high",
        goal_threshold_raw: 70,
      });

      await runStageThresholdSweep(ctx);

      // "high" is truthy (not null/undefined), raw 70 is finite + round,
      // label "Improve UX Quality" has no digits → inferred-strip fires.
      // Stripping a string-typed threshold is correct — it would fail
      // downstream validation anyway.
      const goalNode = (ctx.graph as any).nodes.find((n: any) => n.id === "goal_1");
      expect(goalNode.goal_threshold).toBeUndefined();
      expect(goalNode.goal_threshold_raw).toBeUndefined();

      const codes = ctx.deterministicRepairs.map((r: any) => r.code);
      expect(codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");
    });

    it("skips gracefully when label is undefined", async () => {
      const ctx = makeCtx({
        label: undefined,
        goal_threshold: 0.7,
        goal_threshold_raw: 70,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
      });

      await runStageThresholdSweep(ctx);

      // label ?? "" fallback prevents crash; undefined label → no digits → strip fires
      const codes = ctx.deterministicRepairs.map((r: any) => r.code);
      expect(codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");
    });

    it("skips gracefully when goal_threshold_raw is a nested object", async () => {
      const ctx = makeCtx({
        goal_threshold: 0.7,
        goal_threshold_raw: { nested: "object" },
      });

      await runStageThresholdSweep(ctx);

      // typeof raw !== "number" → finite guard skips, raw is not null → 4b skips
      expect(ctx.deterministicRepairs).toHaveLength(0);
    });

    it("skips null entries in nodes array without crashing", async () => {
      const ctx = makeCtx();
      (ctx.graph as any).nodes.push(null, undefined, 42, "string");

      await runStageThresholdSweep(ctx);

      // Should process valid nodes and skip junk entries
      expect(ctx.deterministicRepairs).toHaveLength(0);
    });
  });
});
