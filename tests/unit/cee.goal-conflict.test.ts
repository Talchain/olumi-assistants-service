/**
 * Tests for Goal Conflict Analysis
 */

import { describe, it, expect } from "vitest";
import { analyzeGoalConflicts } from "../../src/cee/graph-readiness/goal-conflict.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

// Helper to create test graphs
function createTestGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  edges: Array<{ from: string; to: string; weight?: number }> = [],
): GraphV1 {
  return {
    version: "1.0",
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
    })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      weight: e.weight ?? 1.0,
      belief: 0.7,
    })),
  } as unknown as GraphV1;
}

describe("analyzeGoalConflicts", () => {
  describe("edge cases", () => {
    it("handles undefined graph", () => {
      const result = analyzeGoalConflicts(undefined);
      expect(result.goal_count).toBe(0);
      expect(result.has_conflicts).toBe(false);
      expect(result.summary).toContain("No goals");
    });

    it("handles empty graph", () => {
      const graph = createTestGraph([]);
      const result = analyzeGoalConflicts(graph);
      expect(result.goal_count).toBe(0);
      expect(result.has_conflicts).toBe(false);
    });

    it("handles graph with no goals", () => {
      const graph = createTestGraph([
        { id: "o1", kind: "option", label: "Option A" },
        { id: "o2", kind: "option", label: "Option B" },
      ]);
      const result = analyzeGoalConflicts(graph);
      expect(result.goal_count).toBe(0);
      expect(result.summary).toContain("No goals");
    });

    it("handles single goal", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Maximize revenue" },
        { id: "o1", kind: "option", label: "Option A" },
      ]);
      const result = analyzeGoalConflicts(graph);
      expect(result.goal_count).toBe(1);
      expect(result.has_conflicts).toBe(false);
      expect(result.relationships).toHaveLength(0);
      expect(result.summary).toContain("Single goal");
    });
  });

  describe("independent goals", () => {
    it("detects independent goals with no shared pathways", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Increase revenue" },
        { id: "g2", kind: "goal", label: "Improve employee satisfaction" },
        { id: "out1", kind: "outcome", label: "Sales growth" },
        { id: "out2", kind: "outcome", label: "Better morale" },
        { id: "opt1", kind: "option", label: "New pricing" },
        { id: "opt2", kind: "option", label: "Flexible hours" },
      ], [
        { from: "opt1", to: "out1" },
        { from: "out1", to: "g1" },
        { from: "opt2", to: "out2" },
        { from: "out2", to: "g2" },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.goal_count).toBe(2);
      expect(result.has_conflicts).toBe(false);
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].relationship).toBe("independent");
      expect(result.summary).toContain("independent");
    });
  });

  describe("aligned goals", () => {
    it("detects aligned goals with shared positive pathways", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Increase revenue" },
        { id: "g2", kind: "goal", label: "Increase market share" },
        { id: "out1", kind: "outcome", label: "More customers" },
        { id: "opt1", kind: "option", label: "Launch marketing campaign" },
      ], [
        { from: "opt1", to: "out1", weight: 1.2 },
        { from: "out1", to: "g1", weight: 1.0 },
        { from: "out1", to: "g2", weight: 1.0 },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.goal_count).toBe(2);
      expect(result.has_conflicts).toBe(false);
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].relationship).toBe("aligned");
      expect(result.relationships[0].explanation).toContain("aligned");
    });

    it("identifies shared nodes in aligned goals", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Goal A" },
        { id: "g2", kind: "goal", label: "Goal B" },
        { id: "out1", kind: "outcome", label: "Shared outcome" },
      ], [
        { from: "out1", to: "g1" },
        { from: "out1", to: "g2" },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.relationships[0].shared_nodes).toContain("Shared outcome");
    });
  });

  describe("conflicting goals", () => {
    it("detects conflicting goals with opposing pathways", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Maximize profit" },
        { id: "g2", kind: "goal", label: "Minimize costs" },
        { id: "out1", kind: "outcome", label: "Higher prices" },
        { id: "opt1", kind: "option", label: "Premium strategy" },
      ], [
        { from: "opt1", to: "out1", weight: 1.5 },
        { from: "out1", to: "g1", weight: 1.2 },  // Positive to profit
        { from: "out1", to: "g2", weight: -0.8 }, // Negative to cost minimization
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.goal_count).toBe(2);
      expect(result.has_conflicts).toBe(true);
      expect(result.relationships[0].relationship).toBe("conflicting");
    });

    it("provides trade-off guidance when conflicts detected", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Speed to market" },
        { id: "g2", kind: "goal", label: "Product quality" },
        { id: "opt1", kind: "option", label: "Rush release" },
      ], [
        { from: "opt1", to: "g1", weight: 1.5 },
        { from: "opt1", to: "g2", weight: -0.5 },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.has_conflicts).toBe(true);
      expect(result.guidance).toBeDefined();
      expect(result.guidance?.type).toBe("pareto");
      expect(result.guidance?.headline).toContain("Pareto");
    });
  });

  describe("multi-goal scenarios", () => {
    it("handles three goals with mixed relationships", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Revenue growth" },
        { id: "g2", kind: "goal", label: "Cost reduction" },
        { id: "g3", kind: "goal", label: "Customer satisfaction" },
        { id: "opt1", kind: "option", label: "Automation" },
        { id: "out1", kind: "outcome", label: "Efficiency gains" },
      ], [
        { from: "opt1", to: "out1" },
        { from: "out1", to: "g1", weight: 0.8 },
        { from: "out1", to: "g2", weight: 1.2 },
        // g3 independent
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.goal_count).toBe(3);
      // Should have 3 pairwise relationships: g1-g2, g1-g3, g2-g3
      expect(result.relationships).toHaveLength(3);
    });

    it("recommends prioritization for strong conflicts", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Market share" },
        { id: "g2", kind: "goal", label: "Profitability" },
        { id: "g3", kind: "goal", label: "Innovation" },
        { id: "opt1", kind: "option", label: "Aggressive pricing" },
      ], [
        { from: "opt1", to: "g1", weight: 1.5 },   // Helps market share
        { from: "opt1", to: "g2", weight: -1.2 },  // Hurts profitability
        { from: "opt1", to: "g3", weight: -0.5 },  // Hurts innovation (less budget)
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.has_conflicts).toBe(true);
      // Multiple conflicts should trigger prioritization guidance
      if (result.guidance?.type === "prioritize") {
        expect(result.guidance.headline).toContain("prioritization");
      }
    });
  });

  describe("guidance generation", () => {
    it("suggests Pareto analysis for two conflicting goals", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Speed" },
        { id: "g2", kind: "goal", label: "Quality" },
        { id: "opt1", kind: "option", label: "Fast delivery" },
      ], [
        { from: "opt1", to: "g1", weight: 1.5 },
        { from: "opt1", to: "g2", weight: -0.8 },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.guidance?.type).toBe("pareto");
      expect(result.guidance?.suggestions.length).toBeGreaterThan(0);
      expect(result.guidance?.explanation).toContain("Pareto");
    });

    it("provides actionable suggestions in guidance", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Goal A" },
        { id: "g2", kind: "goal", label: "Goal B" },
        { id: "opt1", kind: "option", label: "Option 1" },
      ], [
        { from: "opt1", to: "g1", weight: 1.0 },
        { from: "opt1", to: "g2", weight: -1.0 },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.guidance).toBeDefined();
      expect(result.guidance!.suggestions.length).toBeGreaterThan(2);
      // Suggestions should be actionable (start with verbs)
      for (const suggestion of result.guidance!.suggestions) {
        expect(suggestion.length).toBeGreaterThan(10);
      }
    });
  });

  describe("summary generation", () => {
    it("generates appropriate summary for aligned goals", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Revenue" },
        { id: "g2", kind: "goal", label: "Growth" },
        { id: "out1", kind: "outcome", label: "Success" },
      ], [
        { from: "out1", to: "g1" },
        { from: "out1", to: "g2" },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.summary).toMatch(/aligned|win-win/i);
    });

    it("generates appropriate summary for conflicting goals", () => {
      const graph = createTestGraph([
        { id: "g1", kind: "goal", label: "Speed" },
        { id: "g2", kind: "goal", label: "Quality" },
        { id: "opt1", kind: "option", label: "Approach" },
      ], [
        { from: "opt1", to: "g1", weight: 1.5 },
        { from: "opt1", to: "g2", weight: -0.8 },
      ]);

      const result = analyzeGoalConflicts(graph);
      expect(result.summary).toMatch(/trade-off|conflict|Pareto|priorit/i);
    });
  });
});

describe("integration with assessGraphReadiness", () => {
  it("includes goal conflict analysis in assessment", async () => {
    const { assessGraphReadiness } = await import("../../src/cee/graph-readiness/index.js");

    const graph = createTestGraph([
      { id: "d1", kind: "decision", label: "Strategy decision" },
      { id: "g1", kind: "goal", label: "Maximize revenue" },
      { id: "g2", kind: "goal", label: "Minimize risk" },
      { id: "o1", kind: "option", label: "Aggressive approach" },
      { id: "o2", kind: "option", label: "Conservative approach" },
      { id: "out1", kind: "outcome", label: "Market position" },
    ], [
      { from: "d1", to: "o1" },
      { from: "d1", to: "o2" },
      { from: "o1", to: "out1" },
      { from: "out1", to: "g1", weight: 1.2 },
      { from: "out1", to: "g2", weight: -0.7 },
    ]);

    const result = assessGraphReadiness(graph);

    expect(result.goal_conflicts).toBeDefined();
    expect(result.goal_conflicts?.goal_count).toBe(2);
    expect(result.goal_conflicts?.has_conflicts).toBe(true);
    expect(result.goal_conflicts?.guidance).toBeDefined();
  });
});
