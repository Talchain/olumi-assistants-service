import { describe, it, expect } from "vitest";
import {
  ensureGoalNode,
  hasGoalNode,
  DEFAULT_GOAL_LABEL,
} from "../../src/cee/structure/goal-inference.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

/**
 * Deterministic Goal Repair Tests
 *
 * These tests verify the goal repair pipeline behavior WITHOUT relying on LLM output.
 * They simulate scenarios where the LLM fails to generate a goal node and verify
 * that the deterministic repair correctly handles each case.
 */
describe("Goal Repair Pipeline (Deterministic)", () => {
  describe("Graph validation and repair flow", () => {
    it("detects graph missing goal node", () => {
      const graphWithoutGoal: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_1", kind: "option", label: "Option A" },
          { id: "opt_2", kind: "option", label: "Option B" },
          { id: "out_1", kind: "outcome", label: "Revenue" },
        ],
        edges: [
          { from: "dec_1", to: "opt_1", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "dec_1", to: "opt_2", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
        ],
      } as any;

      expect(hasGoalNode(graphWithoutGoal)).toBe(false);
    });

    it("repairs graph missing goal with inferred goal from brief", () => {
      const graphWithoutGoal: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_1", kind: "option", label: "Hire PA" },
          { id: "opt_2", kind: "option", label: "Don't Hire" },
          { id: "out_productivity", kind: "outcome", label: "Productivity" },
          { id: "risk_cost", kind: "risk", label: "Cost" },
        ],
        edges: [],
      } as any;

      const brief = "Should I hire a personal assistant to enable me to focus on more high-value tasks?";

      // Before repair
      expect(hasGoalNode(graphWithoutGoal)).toBe(false);

      // Apply repair
      const result = ensureGoalNode(graphWithoutGoal, brief);

      // After repair
      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("brief");
      expect(hasGoalNode(result.graph)).toBe(true);
      expect(result.goalNodeId).toBeDefined();

      // Verify goal label is extracted from brief
      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect(goalNode).toBeDefined();
      expect((goalNode as any).label.toLowerCase()).toContain("focus");

      // Verify outcomes/risks are wired to goal
      const goalEdges = result.graph.edges.filter((e: any) => e.to === result.goalNodeId);
      expect(goalEdges.length).toBeGreaterThan(0);

      // Verify risk edge has negative strength_mean (flat field, not nested)
      const riskEdge = goalEdges.find((e: any) => e.from === "risk_cost");
      if (riskEdge) {
        expect((riskEdge as any).strength_mean).toBeLessThan(0);
      }
    });

    it("uses placeholder goal when no pattern matches in brief", () => {
      const graphWithoutGoal: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Tech Choice" },
          { id: "opt_1", kind: "option", label: "React" },
          { id: "opt_2", kind: "option", label: "Vue" },
        ],
        edges: [],
      } as any;

      const brief = "React or Vue for our frontend?"; // No extractable goal pattern

      const result = ensureGoalNode(graphWithoutGoal, brief);

      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("placeholder");

      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect((goalNode as any).label).toBe(DEFAULT_GOAL_LABEL);
    });

    it("uses explicit goal from context.goals when provided", () => {
      const graphWithoutGoal: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_1", kind: "option", label: "Option A" },
        ],
        edges: [],
      } as any;

      const explicitGoal = "Maximize shareholder value";
      const result = ensureGoalNode(graphWithoutGoal, "Some brief", explicitGoal);

      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("explicit");

      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect((goalNode as any).label).toBe("Maximize shareholder value");
    });

    it("does not add duplicate goal if one already exists", () => {
      const graphWithGoal: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_1", kind: "option", label: "Option A" },
          { id: "goal_existing", kind: "goal", label: "Existing Goal" },
        ],
        edges: [],
      } as any;

      const result = ensureGoalNode(graphWithGoal, "Some brief");

      expect(result.goalAdded).toBe(false);
      expect(result.graph).toBe(graphWithGoal); // Same reference

      // Still only one goal
      const goals = result.graph.nodes.filter((n: any) => n.kind === "goal");
      expect(goals.length).toBe(1);
    });
  });

  describe("Goal source tracking", () => {
    it("returns 'brief' source when goal extracted from patterns", () => {
      const graph: GraphV1 = {
        nodes: [{ id: "dec_1", kind: "decision", label: "D" }],
        edges: [],
      } as any;

      const testCases = [
        { brief: "We want to achieve higher revenue", expectedPattern: "revenue" },
        { brief: "Goal is to reduce costs significantly", expectedPattern: "reduce costs" },
        { brief: "I want to grow the business internationally", expectedPattern: "grow" },
        { brief: "To improve customer satisfaction", expectedPattern: "customer satisfaction" },
      ];

      for (const { brief, expectedPattern } of testCases) {
        const result = ensureGoalNode({ ...graph, nodes: [...graph.nodes] } as any, brief);
        expect(result.goalAdded).toBe(true);
        expect(result.inferredFrom).toBe("brief");

        const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
        expect((goalNode as any).label.toLowerCase()).toContain(expectedPattern.toLowerCase());
      }
    });

    it("returns 'placeholder' source when no pattern matches", () => {
      const graph: GraphV1 = {
        nodes: [{ id: "dec_1", kind: "decision", label: "D" }],
        edges: [],
      } as any;

      const briefsWithNoPattern = [
        "React or Vue?",
        "Which database should we use?",
        "Pick between option A and option B",
        "Microservices vs monolith debate",
      ];

      for (const brief of briefsWithNoPattern) {
        const result = ensureGoalNode({ ...graph, nodes: [...graph.nodes] } as any, brief);
        expect(result.goalAdded).toBe(true);
        expect(result.inferredFrom).toBe("placeholder");

        const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
        expect((goalNode as any).label).toBe(DEFAULT_GOAL_LABEL);
      }
    });

    it("returns 'explicit' source when context.goals provided", () => {
      const graph: GraphV1 = {
        nodes: [{ id: "dec_1", kind: "decision", label: "D" }],
        edges: [],
      } as any;

      const result = ensureGoalNode(graph, "brief", "Custom Goal Text");

      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("explicit");
    });
  });

  describe("Edge wiring correctness", () => {
    it("wires all outcomes to goal with positive strength", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "D" },
          { id: "out_1", kind: "outcome", label: "Revenue" },
          { id: "out_2", kind: "outcome", label: "Growth" },
          { id: "out_3", kind: "outcome", label: "Satisfaction" },
        ],
        edges: [],
      } as any;

      const result = ensureGoalNode(graph, "Goal is to maximize success");

      const goalEdges = result.graph.edges.filter((e: any) => e.to === result.goalNodeId);
      expect(goalEdges.length).toBe(3); // All 3 outcomes

      for (const edge of goalEdges) {
        // Verify flat field names (wireOutcomesToGoal uses strength_mean, belief_exists)
        expect((edge as any).strength_mean).toBeGreaterThan(0);
        expect((edge as any).belief_exists).toBeGreaterThan(0);
      }
    });

    it("wires all risks to goal with negative strength", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "D" },
          { id: "risk_1", kind: "risk", label: "Churn" },
          { id: "risk_2", kind: "risk", label: "Cost overrun" },
        ],
        edges: [],
      } as any;

      const result = ensureGoalNode(graph, "Goal is to minimize risk");

      const goalEdges = result.graph.edges.filter((e: any) => e.to === result.goalNodeId);
      expect(goalEdges.length).toBe(2); // Both risks

      for (const edge of goalEdges) {
        // Verify flat field names with negative coefficient for risks
        expect((edge as any).strength_mean).toBeLessThan(0);
      }
    });

    it("preserves existing edges when adding goal", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "D" },
          { id: "opt_1", kind: "option", label: "O" },
          { id: "fac_1", kind: "factor", label: "F" },
          { id: "out_1", kind: "outcome", label: "Revenue" },
        ],
        edges: [
          { from: "dec_1", to: "opt_1", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "opt_1", to: "fac_1", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9 },
          { from: "fac_1", to: "out_1", strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.85 },
        ],
      } as any;

      const result = ensureGoalNode(graph, "Goal is to increase revenue");

      // Original edges preserved
      expect(result.graph.edges.some((e: any) => e.from === "dec_1" && e.to === "opt_1")).toBe(true);
      expect(result.graph.edges.some((e: any) => e.from === "opt_1" && e.to === "fac_1")).toBe(true);
      expect(result.graph.edges.some((e: any) => e.from === "fac_1" && e.to === "out_1")).toBe(true);

      // New goal edge added
      expect(result.graph.edges.some((e: any) => e.from === "out_1" && e.to === result.goalNodeId)).toBe(true);
    });
  });

  describe("Simulated LLM failure scenarios", () => {
    /**
     * Simulates a scenario where the LLM returns a graph without a goal node.
     * The repair pipeline should automatically add an inferred goal.
     */
    it("handles LLM output missing goal (PA hiring scenario)", () => {
      // Simulate LLM response that's missing a goal
      const llmResponse: GraphV1 = {
        nodes: [
          { id: "dec_hire_pa", kind: "decision", label: "Hire Personal Assistant" },
          { id: "opt_hire", kind: "option", label: "Hire PA", data: { interventions: { fac_has_pa: 1 } } },
          { id: "opt_no_hire", kind: "option", label: "Do Not Hire", data: { interventions: { fac_has_pa: 0 } } },
          { id: "fac_has_pa", kind: "factor", label: "Has Personal Assistant", data: { value: 0 } },
          { id: "fac_time_available", kind: "factor", label: "Time Available for High-Value Tasks" },
          { id: "fac_admin_burden", kind: "factor", label: "Administrative Burden" },
          { id: "out_productivity", kind: "outcome", label: "Personal Productivity" },
          { id: "out_focus", kind: "outcome", label: "Focus on Strategic Work" },
          { id: "risk_cost", kind: "risk", label: "Salary and Onboarding Cost" },
          { id: "risk_dependency", kind: "risk", label: "Dependency on PA" },
          // NOTE: No goal node! This is the LLM failure case
        ],
        edges: [
          { from: "dec_hire_pa", to: "opt_hire", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "dec_hire_pa", to: "opt_no_hire", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "opt_hire", to: "fac_has_pa", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "opt_no_hire", to: "fac_has_pa", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "fac_has_pa", to: "fac_time_available", strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.85 },
          { from: "fac_has_pa", to: "fac_admin_burden", strength: { mean: -0.8, std: 0.1 }, exists_probability: 0.9 },
          { from: "fac_time_available", to: "out_productivity", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9 },
          { from: "fac_time_available", to: "out_focus", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.8 },
          { from: "fac_admin_burden", to: "out_productivity", strength: { mean: -0.5, std: 0.15 }, exists_probability: 0.75 },
          { from: "fac_has_pa", to: "risk_cost", strength: { mean: 0.9, std: 0.1 }, exists_probability: 0.95 },
          { from: "fac_has_pa", to: "risk_dependency", strength: { mean: 0.4, std: 0.2 }, exists_probability: 0.6 },
        ],
      } as any;

      const brief = "Should I hire a personal assistant to enable me to focus on more high-value tasks?";

      // Verify LLM didn't include goal
      expect(hasGoalNode(llmResponse)).toBe(false);

      // Apply repair
      const result = ensureGoalNode(llmResponse, brief);

      // Verify repair succeeded
      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("brief");
      expect(hasGoalNode(result.graph)).toBe(true);

      // Verify goal label is sensible
      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect((goalNode as any).label.toLowerCase()).toContain("focus");

      // Verify all outcomes and risks are now wired to goal
      const goalEdges = result.graph.edges.filter((e: any) => e.to === result.goalNodeId);
      expect(goalEdges.length).toBe(4); // 2 outcomes + 2 risks

      // Verify correct sign constraints
      const outcomeEdges = goalEdges.filter((e: any) =>
        e.from === "out_productivity" || e.from === "out_focus"
      );
      const riskEdges = goalEdges.filter((e: any) =>
        e.from === "risk_cost" || e.from === "risk_dependency"
      );

      for (const e of outcomeEdges) {
        // Flat field names: outcomes have positive strength_mean
        expect((e as any).strength_mean).toBeGreaterThan(0);
      }
      for (const e of riskEdges) {
        // Flat field names: risks have negative strength_mean
        expect((e as any).strength_mean).toBeLessThan(0);
      }
    });

    /**
     * Simulates a scenario where brief has no extractable goal pattern.
     * The repair pipeline should use a placeholder goal.
     */
    it("uses placeholder goal when brief has no extractable goal", () => {
      const llmResponse: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "Tech Stack Choice" },
          { id: "opt_react", kind: "option", label: "Use React" },
          { id: "opt_vue", kind: "option", label: "Use Vue" },
          { id: "fac_bundle", kind: "factor", label: "Bundle Size" },
          { id: "out_perf", kind: "outcome", label: "Performance" },
          // No goal
        ],
        edges: [],
      } as any;

      const brief = "React vs Vue - which is better for our project?"; // No goal pattern

      const result = ensureGoalNode(llmResponse, brief);

      expect(result.goalAdded).toBe(true);
      expect(result.inferredFrom).toBe("placeholder");

      const goalNode = result.graph.nodes.find((n: any) => n.kind === "goal");
      expect((goalNode as any).label).toBe(DEFAULT_GOAL_LABEL);
    });
  });

  describe("DAG and connectedness constraints", () => {
    it("maintains DAG structure after goal insertion", () => {
      const graph: GraphV1 = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "D" },
          { id: "opt_1", kind: "option", label: "O1" },
          { id: "opt_2", kind: "option", label: "O2" },
          { id: "fac_1", kind: "factor", label: "F1" },
          { id: "out_1", kind: "outcome", label: "Revenue" },
          { id: "risk_1", kind: "risk", label: "Cost" },
        ],
        edges: [
          { from: "dec_1", to: "opt_1", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "dec_1", to: "opt_2", strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
          { from: "opt_1", to: "fac_1", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9 },
          { from: "fac_1", to: "out_1", strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.85 },
          { from: "fac_1", to: "risk_1", strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.7 },
        ],
      } as any;

      const result = ensureGoalNode(graph, "Goal is to maximize revenue");

      // Check no cycles exist (goal only has incoming edges, no outgoing)
      const goalOutEdges = result.graph.edges.filter((e: any) => e.from === result.goalNodeId);
      expect(goalOutEdges.length).toBe(0);

      // Goal only receives edges from outcomes/risks
      const goalInEdges = result.graph.edges.filter((e: any) => e.to === result.goalNodeId);
      for (const edge of goalInEdges) {
        const sourceNode = result.graph.nodes.find((n: any) => n.id === (edge as any).from);
        expect(["outcome", "risk"]).toContain((sourceNode as any).kind);
      }
    });
  });
});
