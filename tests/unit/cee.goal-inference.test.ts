import { describe, it, expect } from "vitest";
import {
  inferGoalFromBrief,
  ensureGoalNode,
  hasGoalNode,
  createGoalNode,
  wireOutcomesToGoal,
  DEFAULT_GOAL_LABEL,
} from "../../src/cee/structure/goal-inference.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

describe("Goal Inference Utility", () => {
  describe("inferGoalFromBrief", () => {
    it("extracts goal from 'to achieve' pattern", () => {
      const result = inferGoalFromBrief(
        "Should I hire a personal assistant to achieve better work-life balance?"
      );
      expect(result.found).toBe(true);
      expect(result.source).toBe("brief");
      expect(result.label.toLowerCase()).toContain("better work-life balance");
    });

    it("extracts goal from 'to enable me to focus on' pattern", () => {
      const result = inferGoalFromBrief(
        "Should I hire a personal assistant to enable me to focus on more high-value tasks?"
      );
      expect(result.found).toBe(true);
      expect(result.source).toBe("brief");
      expect(result.label.toLowerCase()).toContain("focus on more high-value tasks");
    });

    it("extracts goal from 'goal is' pattern", () => {
      const result = inferGoalFromBrief(
        "We need to decide on a pricing strategy. Our goal is to maximize revenue while maintaining customer satisfaction."
      );
      expect(result.found).toBe(true);
      expect(result.source).toBe("brief");
      expect(result.label.toLowerCase()).toContain("maximize revenue");
    });

    it("extracts goal from 'to improve' pattern", () => {
      const result = inferGoalFromBrief(
        "Should we refactor our codebase to improve maintainability?"
      );
      expect(result.found).toBe(true);
      expect(result.source).toBe("brief");
      expect(result.label.toLowerCase()).toContain("maintainability");
    });

    it("extracts goal from 'to reduce' pattern", () => {
      const result = inferGoalFromBrief(
        "We want to reduce customer churn by implementing a loyalty program."
      );
      expect(result.found).toBe(true);
      expect(result.source).toBe("brief");
      expect(result.label.toLowerCase()).toContain("customer churn");
    });

    it("extracts goal from 'I want to' pattern", () => {
      const result = inferGoalFromBrief(
        "I want to grow the business internationally within 2 years."
      );
      expect(result.found).toBe(true);
      expect(result.source).toBe("brief");
      expect(result.label.toLowerCase()).toContain("grow the business");
    });

    it("returns placeholder when no pattern matches", () => {
      const result = inferGoalFromBrief(
        "Should we use React or Vue for our frontend?"
      );
      expect(result.found).toBe(false);
      expect(result.source).toBe("placeholder");
      expect(result.label).toBe(DEFAULT_GOAL_LABEL);
    });

    it("returns placeholder for empty brief", () => {
      const result = inferGoalFromBrief("");
      expect(result.found).toBe(false);
      expect(result.source).toBe("placeholder");
    });

    it("returns placeholder for null/undefined brief", () => {
      const result = inferGoalFromBrief(null as any);
      expect(result.found).toBe(false);
      expect(result.source).toBe("placeholder");
    });

    it("handles very short extracted goals by falling back to placeholder", () => {
      // "to X" where X is less than 5 chars should not be extracted
      const result = inferGoalFromBrief("We want to go.");
      // Should either not match or fallback to placeholder
      if (result.found) {
        expect(result.label.length).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe("hasGoalNode", () => {
    it("returns true when graph has a goal node", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [],
      } as any;
      expect(hasGoalNode(graph)).toBe(true);
    });

    it("returns false when graph has no goal node", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_1", kind: "option", label: "Option" },
        ],
        edges: [],
      } as any;
      expect(hasGoalNode(graph)).toBe(false);
    });

    it("returns false for undefined graph", () => {
      expect(hasGoalNode(undefined)).toBe(false);
    });

    it("returns false for graph with empty nodes", () => {
      const graph: GraphV1 = {
        nodes: [],
        edges: [],
      } as any;
      expect(hasGoalNode(graph)).toBe(false);
    });
  });

  describe("createGoalNode", () => {
    it("creates a goal node with provided label and default id", () => {
      const node = createGoalNode("Maximize ROI");
      expect(node.kind).toBe("goal");
      expect(node.label).toBe("Maximize ROI");
      expect(node.id).toBe("goal_inferred");
    });

    it("creates a goal node with custom id", () => {
      const node = createGoalNode("Reduce costs", "goal_custom");
      expect(node.id).toBe("goal_custom");
      expect(node.label).toBe("Reduce costs");
    });
  });

  describe("wireOutcomesToGoal", () => {
    it("wires outcomes to goal node", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "out_1", kind: "outcome", label: "Revenue" },
          { id: "out_2", kind: "outcome", label: "Growth" },
          { id: "goal_1", kind: "goal", label: "Success" },
        ],
        edges: [],
      } as any;

      const result = wireOutcomesToGoal(graph, "goal_1");
      expect(result.edges).toHaveLength(2);
      expect(result.edges.some((e: any) => e.from === "out_1" && e.to === "goal_1")).toBe(true);
      expect(result.edges.some((e: any) => e.from === "out_2" && e.to === "goal_1")).toBe(true);
    });

    it("wires risks to goal node with negative strength", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "risk_1", kind: "risk", label: "Churn" },
          { id: "goal_1", kind: "goal", label: "Success" },
        ],
        edges: [],
      } as any;

      const result = wireOutcomesToGoal(graph, "goal_1");
      expect(result.edges).toHaveLength(1);
      const riskEdge = result.edges[0] as any;
      expect(riskEdge.from).toBe("risk_1");
      expect(riskEdge.to).toBe("goal_1");
      expect(riskEdge.strength.mean).toBeLessThan(0);
    });

    it("does not duplicate existing edges", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "out_1", kind: "outcome", label: "Revenue" },
          { id: "goal_1", kind: "goal", label: "Success" },
        ],
        edges: [
          { from: "out_1", to: "goal_1", strength: { mean: 0.8, std: 0.1 }, exists_probability: 1.0 },
        ],
      } as any;

      const result = wireOutcomesToGoal(graph, "goal_1");
      expect(result.edges).toHaveLength(1); // No duplicate added
    });
  });

  describe("ensureGoalNode", () => {
    it("adds inferred goal when graph has no goal", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Pricing Decision" },
          { id: "opt_1", kind: "option", label: "Increase Price" },
          { id: "out_1", kind: "outcome", label: "Revenue" },
        ],
        edges: [],
      } as any;

      const result = ensureGoalNode(
        graph,
        "Should we increase prices to improve revenue?"
      );

      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("brief");
      expect(result.goalNodeId).toBeDefined();
      expect(hasGoalNode(result.graph)).toBe(true);
      // Check edges were wired
      expect(result.graph.edges.length).toBeGreaterThan(0);
    });

    it("uses explicit goal from context.goals when provided", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "out_1", kind: "outcome", label: "Revenue" },
        ],
        edges: [],
      } as any;

      const result = ensureGoalNode(
        graph,
        "Some brief",
        "Maximize shareholder value"
      );

      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("explicit");
      expect(result.goalNodeId).toBe("goal_explicit");
      // Find the goal node and check its label
      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect(goalNode).toBeDefined();
      expect((goalNode as any).label).toBe("Maximize shareholder value");
    });

    it("does not add goal if one already exists", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "goal_existing", kind: "goal", label: "Existing Goal" },
        ],
        edges: [],
      } as any;

      const result = ensureGoalNode(graph, "Some brief");

      expect(result.goalAdded).toBe(false);
      expect(result.graph).toBe(graph); // Same reference, not modified
    });

    it("falls back to placeholder goal when inference fails", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
        ],
        edges: [],
      } as any;

      const result = ensureGoalNode(
        graph,
        "React or Vue?" // No extractable goal
      );

      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("placeholder");
      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect((goalNode as any).label).toBe(DEFAULT_GOAL_LABEL);
    });

    it("handles undefined/empty graph gracefully", () => {
      const result = ensureGoalNode(undefined as any, "brief");
      expect(result.goalAdded).toBe(false);
    });
  });

  describe("Integration: Graph repair scenario", () => {
    it("repairs graph missing goal from PA hiring brief", () => {
      // This simulates the actual failure case from production
      const graphWithoutGoal: GraphV1 = {
        nodes: [
          { id: "dec_hire_pa", kind: "decision", label: "Hire Personal Assistant" },
          { id: "opt_hire", kind: "option", label: "Hire PA", data: { interventions: { fac_has_pa: 1 } } },
          { id: "opt_no_hire", kind: "option", label: "Do Not Hire", data: { interventions: { fac_has_pa: 0 } } },
          { id: "fac_has_pa", kind: "factor", label: "Has Personal Assistant", data: { value: 0 } },
          { id: "fac_time", kind: "factor", label: "Available Time" },
          { id: "fac_cost", kind: "factor", label: "Cost" },
          { id: "out_productivity", kind: "outcome", label: "Productivity" },
          { id: "out_focus", kind: "outcome", label: "Focus on High-Value Tasks" },
          { id: "risk_cost", kind: "risk", label: "Financial Cost" },
          { id: "risk_dependency", kind: "risk", label: "Dependency on PA" },
        ],
        edges: [
          { from: "dec_hire_pa", to: "opt_hire", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "dec_hire_pa", to: "opt_no_hire", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "opt_hire", to: "fac_has_pa", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "opt_no_hire", to: "fac_has_pa", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "fac_has_pa", to: "fac_time", strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.85 },
          { from: "fac_time", to: "out_productivity", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9 },
          { from: "fac_time", to: "out_focus", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.8 },
          { from: "fac_has_pa", to: "risk_cost", strength: { mean: 0.9, std: 0.1 }, exists_probability: 0.95 },
        ],
      } as any;

      const brief = "Should I hire a personal assistant to enable me to focus on more high-value tasks?";

      // Verify graph doesn't have a goal
      expect(hasGoalNode(graphWithoutGoal)).toBe(false);

      // Apply repair
      const result = ensureGoalNode(graphWithoutGoal, brief);

      // Verify repair succeeded
      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("brief");
      expect(hasGoalNode(result.graph)).toBe(true);

      // Verify goal label is sensible
      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect(goalNode).toBeDefined();
      expect((goalNode as any).label.toLowerCase()).toContain("focus");

      // Verify outcomes are wired to goal
      const goalEdges = result.graph.edges.filter((e: any) => e.to === result.goalNodeId);
      expect(goalEdges.length).toBeGreaterThan(0);
    });
  });
});
