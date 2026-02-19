/**
 * Goal threshold stripping — GOAL_THRESHOLD_STRIPPED_NO_RAW
 *
 * Validates that fixGoalThresholdNoRaw() strips all four threshold fields
 * from goal nodes when goal_threshold is present but goal_threshold_raw is
 * absent, null, or undefined. Preserves thresholds when goal_threshold_raw
 * is grounded.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks (deterministic sweep reads config + telemetry) ──────────────────

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

// ── Import under test ─────────────────────────────────────────────────────

import { fixGoalThresholdNoRaw } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeGoalGraph(goalOverrides: Record<string, unknown> = {}): any {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      {
        id: "goal_1",
        kind: "goal",
        label: "Test goal",
        ...goalOverrides,
      },
    ],
    edges: [
      {
        from: "dec_1",
        to: "goal_1",
        strength_mean: 0.5,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("fixGoalThresholdNoRaw", () => {
  it("strips all four threshold fields when goal_threshold present but no goal_threshold_raw", () => {
    const graph = makeGoalGraph({
      goal_threshold: 0.7,
      goal_threshold_unit: "%",
      goal_threshold_cap: 100,
    });

    const repairs = fixGoalThresholdNoRaw(graph);

    const goal = graph.nodes.find((n: any) => n.id === "goal_1");
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold_unit).toBeUndefined();
    expect(goal.goal_threshold_cap).toBeUndefined();

    expect(repairs).toHaveLength(1);
    expect(repairs[0].code).toBe("GOAL_THRESHOLD_STRIPPED_NO_RAW");
    expect(repairs[0].path).toBe("nodes[goal_1].goal_threshold");
    expect(repairs[0].action).toBe(
      "Goal threshold removed: no raw target value extracted from brief",
    );
  });

  it("preserves threshold when goal_threshold_raw is present", () => {
    const graph = makeGoalGraph({
      goal_threshold: 0.8,
      goal_threshold_raw: 800,
      goal_threshold_unit: "customers",
      goal_threshold_cap: 1000,
    });

    const repairs = fixGoalThresholdNoRaw(graph);

    const goal = graph.nodes.find((n: any) => n.id === "goal_1");
    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_raw).toBe(800);
    expect(goal.goal_threshold_unit).toBe("customers");
    expect(goal.goal_threshold_cap).toBe(1000);

    expect(repairs).toHaveLength(0);
  });

  it("does not change goal node when goal_threshold is absent", () => {
    const graph = makeGoalGraph({});
    const goalBefore = { ...graph.nodes.find((n: any) => n.id === "goal_1") };

    const repairs = fixGoalThresholdNoRaw(graph);

    const goal = graph.nodes.find((n: any) => n.id === "goal_1");
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.id).toBe(goalBefore.id);
    expect(goal.label).toBe(goalBefore.label);

    expect(repairs).toHaveLength(0);
  });

  it("strips threshold when goal_threshold_raw is null (treated as absent)", () => {
    const graph = makeGoalGraph({
      goal_threshold: 0.7,
      goal_threshold_raw: null,
      goal_threshold_unit: "units",
      goal_threshold_cap: 500,
    });

    const repairs = fixGoalThresholdNoRaw(graph);

    const goal = graph.nodes.find((n: any) => n.id === "goal_1");
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold_unit).toBeUndefined();
    expect(goal.goal_threshold_cap).toBeUndefined();

    expect(repairs).toHaveLength(1);
    expect(repairs[0].code).toBe("GOAL_THRESHOLD_STRIPPED_NO_RAW");
  });

  it("does not strip from non-goal nodes", () => {
    const graph = makeGoalGraph({});
    // Add goal_threshold to the decision node (shouldn't be touched)
    graph.nodes[0].goal_threshold = 0.9;

    const repairs = fixGoalThresholdNoRaw(graph);

    expect(graph.nodes[0].goal_threshold).toBe(0.9);
    expect(repairs).toHaveLength(0);
  });
});
