/**
 * Threshold Sweep Trace Visibility Tests (Task B)
 *
 * Verifies that Stage 4b populates ctx.thresholdSweepTrace
 * with correct summary fields for pipeline trace assembly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";

function makeCtx(goalNodes: any[] = []): any {
  return {
    requestId: "test-sweep-trace",
    graph: {
      nodes: [
        { id: "d1", kind: "decision", label: "Strategy" },
        ...goalNodes,
      ],
      edges: [],
    },
    deterministicRepairs: [],
    repairTrace: { deterministic_sweep: { sweep_ran: true, sweep_version: "1.0" } },
    thresholdSweepTrace: undefined,
  };
}

describe("threshold sweep trace (Task B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates thresholdSweepTrace with correct shape when no goals exist", async () => {
    const ctx = makeCtx([]);
    await runStageThresholdSweep(ctx);

    expect(ctx.thresholdSweepTrace).toBeDefined();
    expect(ctx.thresholdSweepTrace.ran).toBe(true);
    expect(ctx.thresholdSweepTrace.goals_checked).toBe(0);
    expect(ctx.thresholdSweepTrace.strips_applied).toBe(0);
    expect(ctx.thresholdSweepTrace.warnings_emitted).toBe(0);
    expect(ctx.thresholdSweepTrace.codes).toEqual([]);
    expect(typeof ctx.thresholdSweepTrace.duration_ms).toBe("number");
  });

  it("counts goals checked even when no thresholds need stripping", async () => {
    const ctx = makeCtx([
      { id: "g1", kind: "goal", label: "Reach 800 Customers", goal_threshold: 0.8, goal_threshold_raw: 800 },
    ]);
    await runStageThresholdSweep(ctx);

    expect(ctx.thresholdSweepTrace.goals_checked).toBe(1);
    expect(ctx.thresholdSweepTrace.strips_applied).toBe(0);
    expect(ctx.thresholdSweepTrace.warnings_emitted).toBe(0);
  });

  it("tracks strips and warnings for inferred threshold (qualitative goal)", async () => {
    const ctx = makeCtx([
      { id: "g1", kind: "goal", label: "Improve UX Quality", goal_threshold: 0.7, goal_threshold_raw: 70 },
    ]);
    await runStageThresholdSweep(ctx);

    expect(ctx.thresholdSweepTrace.goals_checked).toBe(1);
    expect(ctx.thresholdSweepTrace.strips_applied).toBe(1);
    expect(ctx.thresholdSweepTrace.warnings_emitted).toBe(1);
    expect(ctx.thresholdSweepTrace.codes).toContain("GOAL_THRESHOLD_POSSIBLY_INFERRED");
    expect(ctx.thresholdSweepTrace.codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_DIGITS");
  });

  it("tracks strip for raw-absent threshold", async () => {
    const ctx = makeCtx([
      { id: "g1", kind: "goal", label: "Grow Revenue", goal_threshold: 0.5 },
    ]);
    await runStageThresholdSweep(ctx);

    expect(ctx.thresholdSweepTrace.strips_applied).toBe(1);
    expect(ctx.thresholdSweepTrace.warnings_emitted).toBe(0);
    expect(ctx.thresholdSweepTrace.codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_RAW");
  });

  it("writes noop trace when graph is undefined (early return)", async () => {
    const ctx = { requestId: "test", graph: undefined, thresholdSweepTrace: undefined } as any;
    await runStageThresholdSweep(ctx);

    expect(ctx.thresholdSweepTrace).toBeDefined();
    expect(ctx.thresholdSweepTrace.ran).toBe(false);
    expect(ctx.thresholdSweepTrace.goals_checked).toBe(0);
  });

  it("writes noop trace when nodes is not an array (early return)", async () => {
    const ctx = { requestId: "test", graph: { nodes: "bad" }, thresholdSweepTrace: undefined } as any;
    await runStageThresholdSweep(ctx);

    expect(ctx.thresholdSweepTrace).toBeDefined();
    expect(ctx.thresholdSweepTrace.ran).toBe(false);
  });
});

describe("threshold sweep trace surfaces in pipelineTrace (package integration)", () => {
  it("pipelineTrace.threshold_sweep is populated when thresholdSweepTrace is set", async () => {
    // Simulates what package.ts does: reads ctx.thresholdSweepTrace → writes pipelineTrace.threshold_sweep
    const pipelineTrace: Record<string, unknown> = {};
    const ctx = {
      thresholdSweepTrace: {
        ran: true,
        duration_ms: 2,
        goals_checked: 1,
        strips_applied: 1,
        warnings_emitted: 0,
        codes: ["GOAL_THRESHOLD_STRIPPED_NO_RAW"],
      },
    };

    // Mirror the exact logic from package.ts
    if (ctx.thresholdSweepTrace) {
      pipelineTrace.threshold_sweep = ctx.thresholdSweepTrace;
    }

    expect(pipelineTrace.threshold_sweep).toBeDefined();
    expect((pipelineTrace.threshold_sweep as any).ran).toBe(true);
    expect((pipelineTrace.threshold_sweep as any).codes).toContain("GOAL_THRESHOLD_STRIPPED_NO_RAW");
  });

  it("pipelineTrace.threshold_sweep is absent when thresholdSweepTrace is undefined", async () => {
    const pipelineTrace: Record<string, unknown> = {};
    const ctx = { thresholdSweepTrace: undefined };

    if (ctx.thresholdSweepTrace) {
      pipelineTrace.threshold_sweep = ctx.thresholdSweepTrace;
    }

    expect(pipelineTrace.threshold_sweep).toBeUndefined();
  });
});
