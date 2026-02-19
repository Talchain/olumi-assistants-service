/**
 * GOAL_THRESHOLD_POSSIBLY_INFERRED heuristic — unit tests.
 *
 * Validates that warnGoalThresholdPossiblyInferred() fires when the LLM
 * fabricates both goal_threshold and goal_threshold_raw on qualitative goals,
 * and stays silent when the threshold is clearly grounded.
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

import { warnGoalThresholdPossiblyInferred } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";

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

describe("warnGoalThresholdPossiblyInferred", () => {
  it("warns when threshold looks LLM-inferred (round raw, % unit, no digits in label)", () => {
    const graph = makeGoalGraph({
      label: "Improve UX Quality",
      goal_threshold: 0.7,
      goal_threshold_raw: 70,
      goal_threshold_unit: "%",
    });

    const repairs = warnGoalThresholdPossiblyInferred(graph);

    expect(repairs).toHaveLength(1);
    expect(repairs[0].code).toBe("GOAL_THRESHOLD_POSSIBLY_INFERRED");
    expect(repairs[0].path).toBe("nodes[goal_1].goal_threshold");
    expect(repairs[0].action).toContain("Verify or remove");

    // Values NOT stripped — warning only
    const goal = graph.nodes.find((n: any) => n.id === "goal_1");
    expect(goal.goal_threshold).toBe(0.7);
    expect(goal.goal_threshold_raw).toBe(70);
  });

  it("does not warn when threshold is grounded (non-% unit, digits in label)", () => {
    const graph = makeGoalGraph({
      label: "Reach 800 Pro Customers",
      goal_threshold: 0.8,
      goal_threshold_raw: 800,
      goal_threshold_unit: "customers",
      goal_threshold_cap: 1000,
    });

    const repairs = warnGoalThresholdPossiblyInferred(graph);

    expect(repairs).toHaveLength(0);

    // Values preserved
    const goal = graph.nodes.find((n: any) => n.id === "goal_1");
    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_raw).toBe(800);
    expect(goal.goal_threshold_unit).toBe("customers");
  });

  it("does not warn when no threshold fields are present", () => {
    const graph = makeGoalGraph({
      label: "Improve Team Morale",
    });

    const repairs = warnGoalThresholdPossiblyInferred(graph);

    expect(repairs).toHaveLength(0);
  });
});
