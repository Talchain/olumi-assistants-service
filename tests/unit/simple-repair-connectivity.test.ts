/**
 * Simple Repair Connectivity Tests
 *
 * Tests for the connectivity repair logic in simpleRepair:
 * - Wiring orphaned outcomes/risks to goal
 * - Pruning nodes unreachable from decision
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { simpleRepair } from "../../src/services/repair.js";
import type { GraphT } from "../../src/schemas/graph.js";

/**
 * Helper to create test graphs without requiring all optional fields.
 * Zod applies defaults at runtime, but TypeScript type requires them.
 */
function createTestGraph(partial: {
  version?: string;
  default_seed?: number;
  nodes: GraphT["nodes"];
  edges: GraphT["edges"];
}): GraphT {
  return {
    version: partial.version ?? "1",
    default_seed: partial.default_seed ?? 42,
    nodes: partial.nodes,
    edges: partial.edges,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
  };
}

// Mock telemetry to prevent actual logging during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("simpleRepair connectivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("wireOrphansToGoal", () => {
    it("wires orphaned outcome to goal with positive strength", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" }, // Orphaned - no edge to goal
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "out_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          // Note: No edge from out_1 to goal_1
        ],
      });

      const result = simpleRepair(graph);

      // Should have added edge from out_1 to goal_1
      const outcomeToGoalEdge = result.edges.find(
        (e) => e.from === "out_1" && e.to === "goal_1"
      );
      expect(outcomeToGoalEdge).toBeDefined();
      expect(outcomeToGoalEdge?.strength_mean).toBe(0.7); // Outcome canonical value
      expect(outcomeToGoalEdge?.strength_std).toBe(0.15);
      expect(outcomeToGoalEdge?.belief_exists).toBe(0.9);
    });

    it("wires orphaned risk to goal with negative strength", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "risk_1", kind: "risk", label: "Risk 1" }, // Orphaned - no edge to goal
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "risk_1",
            strength_mean: 0.6,
            strength_std: 0.2,
            belief_exists: 0.8,
            effect_direction: "positive",
          },
          // Note: No edge from risk_1 to goal_1
        ],
      });

      const result = simpleRepair(graph);

      // Should have added edge from risk_1 to goal_1
      const riskToGoalEdge = result.edges.find(
        (e) => e.from === "risk_1" && e.to === "goal_1"
      );
      expect(riskToGoalEdge).toBeDefined();
      expect(riskToGoalEdge?.strength_mean).toBe(-0.5); // Risk canonical value (negative)
      expect(riskToGoalEdge?.strength_std).toBe(0.15);
      expect(riskToGoalEdge?.belief_exists).toBe(0.9);
      expect(riskToGoalEdge?.effect_direction).toBe("negative"); // Risk direction matches sign
    });

    it("does not modify already-wired outcomes", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "out_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          // Already wired to goal with custom values
          {
            from: "out_1",
            to: "goal_1",
            strength_mean: 0.9,
            strength_std: 0.1,
            belief_exists: 0.95,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Should not add duplicate edge
      const outToGoalEdges = result.edges.filter(
        (e) => e.from === "out_1" && e.to === "goal_1"
      );
      expect(outToGoalEdges.length).toBe(1);

      // Original values preserved
      expect(outToGoalEdges[0].strength_mean).toBe(0.9);
      expect(outToGoalEdges[0].belief_exists).toBe(0.95);
    });

    it("wires multiple orphaned outcomes and risks", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "out_2", kind: "outcome", label: "Outcome 2" },
          { id: "risk_1", kind: "risk", label: "Risk 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "out_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "out_2",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "risk_1",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // All three should be wired to goal
      const out1ToGoal = result.edges.find(
        (e) => e.from === "out_1" && e.to === "goal_1"
      );
      const out2ToGoal = result.edges.find(
        (e) => e.from === "out_2" && e.to === "goal_1"
      );
      const risk1ToGoal = result.edges.find(
        (e) => e.from === "risk_1" && e.to === "goal_1"
      );

      expect(out1ToGoal).toBeDefined();
      expect(out2ToGoal).toBeDefined();
      expect(risk1ToGoal).toBeDefined();

      // Outcomes positive, risk negative
      expect(out1ToGoal?.strength_mean).toBe(0.7);
      expect(out2ToGoal?.strength_mean).toBe(0.7);
      expect(risk1ToGoal?.strength_mean).toBe(-0.5);
    });

    it("skips wiring when no goal node present", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          // No goal node
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "out_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // No new edges added (no goal to wire to)
      expect(result.edges.length).toBe(2);
    });
  });

  describe("pruneUnreachable", () => {
    it("prunes factor nodes unreachable from decision (but preserves protected kinds)", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "orphan_fac", kind: "factor", label: "Orphan Factor" }, // Not connected to decision
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          // orphan_fac has no incoming edges from decision path
        ],
      });

      const result = simpleRepair(graph);

      // orphan_fac (factor - unprotected) should be pruned
      expect(result.nodes.find((n) => n.id === "orphan_fac")).toBeUndefined();

      // Protected kinds preserved even if unreachable
      expect(result.nodes.find((n) => n.id === "dec_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "opt_a")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "fac_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "goal_1")).toBeDefined();
    });

    it("does not prune protected kinds even when unreachable", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "orphan_outcome", kind: "outcome", label: "Orphan Outcome" }, // Unreachable but protected
          { id: "orphan_risk", kind: "risk", label: "Orphan Risk" }, // Unreachable but protected
          { id: "goal_1", kind: "goal", label: "Goal" }, // Unreachable but protected
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // No edges connecting outcome, risk, or goal to decision path
        ],
      });

      const result = simpleRepair(graph);

      // All protected kinds should be preserved even when unreachable
      expect(result.nodes.find((n) => n.id === "orphan_outcome")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "orphan_risk")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "goal_1")).toBeDefined();
      expect(result.nodes.length).toBe(5); // All original nodes preserved
    });

    it("preserves nodes reachable through wiring", () => {
      // Scenario: outcome is unreachable before wiring but becomes reachable after
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "out_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          // No edge from out_1 to goal_1 - wiring will add this
        ],
      });

      const result = simpleRepair(graph);

      // All nodes should be preserved (out_1 wired to goal, goal reachable through out_1)
      expect(result.nodes.length).toBe(5);
      expect(result.nodes.find((n) => n.id === "out_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "goal_1")).toBeDefined();

      // Wiring edge should exist
      const wiringEdge = result.edges.find(
        (e) => e.from === "out_1" && e.to === "goal_1"
      );
      expect(wiringEdge).toBeDefined();
    });

    it("removes edges to pruned nodes", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "orphan_fac", kind: "factor", label: "Orphan Factor" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          // Edge FROM orphan_fac (should be removed when orphan_fac is pruned)
          {
            from: "orphan_fac",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Edge from orphan should be removed
      const orphanEdge = result.edges.find((e) => e.from === "orphan_fac");
      expect(orphanEdge).toBeUndefined();

      // Other edges preserved
      expect(result.edges.filter((e) => e.to === "goal_1").length).toBe(1);
    });

    it("handles multiple unreachable factor nodes", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "orphan_1", kind: "factor", label: "Orphan Factor 1" },
          { id: "orphan_2", kind: "factor", label: "Orphan Factor 2" },
          { id: "orphan_3", kind: "factor", label: "Orphan Factor 3" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "goal_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          // orphan_1 -> orphan_2 -> orphan_3 chain (all unreachable factors from dec_1)
          {
            from: "orphan_1",
            to: "orphan_2",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
          {
            from: "orphan_2",
            to: "orphan_3",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // All orphan factors pruned (factors are not protected)
      expect(result.nodes.find((n) => n.id === "orphan_1")).toBeUndefined();
      expect(result.nodes.find((n) => n.id === "orphan_2")).toBeUndefined();
      expect(result.nodes.find((n) => n.id === "orphan_3")).toBeUndefined();

      // Protected kinds preserved (dec_1, opt_a, goal_1)
      expect(result.nodes.length).toBe(3);

      // Orphan edges removed
      expect(result.edges.length).toBe(2); // dec->opt, opt->goal
    });
  });

  describe("combined wiring and pruning", () => {
    it("wires outcomes before pruning to maximize connectivity", () => {
      // Scenario: goal would be unreachable without wiring
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor" },
          { id: "out_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "out_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          // No edge to goal - without wiring, goal would be unreachable
        ],
      });

      const result = simpleRepair(graph);

      // Goal should be preserved (wiring makes it reachable)
      expect(result.nodes.find((n) => n.id === "goal_1")).toBeDefined();

      // Wiring edge present
      const wiringEdge = result.edges.find(
        (e) => e.from === "out_1" && e.to === "goal_1"
      );
      expect(wiringEdge).toBeDefined();

      // All 5 nodes preserved
      expect(result.nodes.length).toBe(5);
    });

    it("handles real-world orphaned profit_margin scenario", () => {
      // This is the scenario that caused the original 422 errors
      const graph = createTestGraph({
        nodes: [
          { id: "dec_hiring", kind: "decision", label: "Hiring Decision" },
          { id: "opt_employees", kind: "option", label: "Hire Employees" },
          { id: "opt_contractors", kind: "option", label: "Use Contractors" },
          { id: "fac_cost", kind: "factor", label: "Operating Cost" },
          { id: "fac_flexibility", kind: "factor", label: "Workforce Flexibility" },
          { id: "out_profit_margin", kind: "outcome", label: "Profit Margin" }, // This was orphaned
          { id: "out_scalability", kind: "outcome", label: "Business Scalability" },
          { id: "risk_turnover", kind: "risk", label: "Employee Turnover" },
          { id: "goal_growth", kind: "goal", label: "Sustainable Growth" },
        ],
        edges: [
          {
            from: "dec_hiring",
            to: "opt_employees",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "dec_hiring",
            to: "opt_contractors",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_employees",
            to: "fac_cost",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_contractors",
            to: "fac_flexibility",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_cost",
            to: "out_profit_margin",
            strength_mean: -0.6,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "negative",
          },
          {
            from: "fac_flexibility",
            to: "out_scalability",
            strength_mean: 0.7,
            strength_std: 0.12,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "fac_cost",
            to: "risk_turnover",
            strength_mean: 0.4,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
          // Missing: out_profit_margin -> goal_growth
          // Missing: out_scalability -> goal_growth
          // Missing: risk_turnover -> goal_growth
        ],
      });

      const result = simpleRepair(graph);

      // All outcomes and risks should now be wired to goal
      const profitToGoal = result.edges.find(
        (e) => e.from === "out_profit_margin" && e.to === "goal_growth"
      );
      const scalabilityToGoal = result.edges.find(
        (e) => e.from === "out_scalability" && e.to === "goal_growth"
      );
      const turnoverToGoal = result.edges.find(
        (e) => e.from === "risk_turnover" && e.to === "goal_growth"
      );

      expect(profitToGoal).toBeDefined();
      expect(profitToGoal?.strength_mean).toBe(0.7); // Outcome canonical
      expect(scalabilityToGoal).toBeDefined();
      expect(scalabilityToGoal?.strength_mean).toBe(0.7); // Outcome canonical
      expect(turnoverToGoal).toBeDefined();
      expect(turnoverToGoal?.strength_mean).toBe(-0.5); // Risk canonical (negative)

      // All nodes preserved
      expect(result.nodes.length).toBe(9);

      // Goal is reachable
      expect(result.nodes.find((n) => n.id === "goal_growth")).toBeDefined();
    });
  });

  describe("wireOrphansFromCausalChain", () => {
    it("wires orphaned risk with no inbound edges from controllable factor", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1", category: "controllable" },
          { id: "risk_1", kind: "risk", label: "Risk 1" }, // No inbound edge from factor
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // Note: No edge from fac_1 to risk_1 (orphaned risk)
          {
            from: "risk_1",
            to: "goal_1",
            strength_mean: -0.5,
            strength_std: 0.15,
            belief_exists: 0.9,
            effect_direction: "negative",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Should have added edge from fac_1 to risk_1
      const factorToRiskEdge = result.edges.find(
        (e) => e.from === "fac_1" && e.to === "risk_1"
      );
      expect(factorToRiskEdge).toBeDefined();
      expect(factorToRiskEdge?.strength_mean).toBe(0.3); // Risk canonical inbound value
      expect(factorToRiskEdge?.strength_std).toBe(0.2);
      expect(factorToRiskEdge?.belief_exists).toBe(0.75);
      expect(factorToRiskEdge?.effect_direction).toBe("positive");
    });

    it("wires orphaned outcome with no inbound edges from factor", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" }, // No inbound edge from factor
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // Note: No edge from fac_1 to out_1 (orphaned outcome)
          {
            from: "out_1",
            to: "goal_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Should have added edge from fac_1 to out_1
      const factorToOutcomeEdge = result.edges.find(
        (e) => e.from === "fac_1" && e.to === "out_1"
      );
      expect(factorToOutcomeEdge).toBeDefined();
      expect(factorToOutcomeEdge?.strength_mean).toBe(0.5); // Outcome canonical inbound value
      expect(factorToOutcomeEdge?.strength_std).toBe(0.2);
      expect(factorToOutcomeEdge?.belief_exists).toBe(0.75);
      expect(factorToOutcomeEdge?.effect_direction).toBe("positive");
    });

    it("wires multiple orphaned nodes from same source factor", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1", category: "controllable" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "out_2", kind: "outcome", label: "Outcome 2" },
          { id: "risk_1", kind: "risk", label: "Risk 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // All outcome/risk nodes have no inbound edges from factor
        ],
      });

      const result = simpleRepair(graph);

      // All three should be wired from fac_1
      const facToOut1 = result.edges.find(
        (e) => e.from === "fac_1" && e.to === "out_1"
      );
      const facToOut2 = result.edges.find(
        (e) => e.from === "fac_1" && e.to === "out_2"
      );
      const facToRisk1 = result.edges.find(
        (e) => e.from === "fac_1" && e.to === "risk_1"
      );

      expect(facToOut1).toBeDefined();
      expect(facToOut2).toBeDefined();
      expect(facToRisk1).toBeDefined();

      // Outcomes get 0.5, risks get 0.3
      expect(facToOut1?.strength_mean).toBe(0.5);
      expect(facToOut2?.strength_mean).toBe(0.5);
      expect(facToRisk1?.strength_mean).toBe(0.3);
    });

    it("skips wiring when no factors in graph", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "out_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // No factor->outcome edges added (no factors exist)
      const factorEdges = result.edges.filter((e) => {
        const fromNode = result.nodes.find((n) => n.id === e.from);
        return fromNode?.kind === "factor";
      });
      expect(factorEdges.length).toBe(0);
    });

    it("prefers controllable factor over external factor", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_ext", kind: "factor", label: "External Factor", category: "external" },
          { id: "fac_ctrl", kind: "factor", label: "Controllable Factor", category: "controllable" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_ext",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_ctrl",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Should wire from controllable factor, not external
      const factorToOutcomeEdge = result.edges.find((e) => e.to === "out_1");
      expect(factorToOutcomeEdge).toBeDefined();
      expect(factorToOutcomeEdge?.from).toBe("fac_ctrl"); // Prefers controllable
    });

    it("does not re-wire nodes that already have inbound from factor", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "fac_2", kind: "factor", label: "Factor 2" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_2",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // Already has inbound from fac_1
          {
            from: "fac_1",
            to: "out_1",
            strength_mean: 0.9,
            strength_std: 0.05,
            belief_exists: 0.95,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Should not add duplicate edge from fac_2 to out_1
      const factorToOutcomeEdges = result.edges.filter((e) => e.to === "out_1");
      expect(factorToOutcomeEdges.length).toBe(1);

      // Original values preserved
      expect(factorToOutcomeEdges[0].from).toBe("fac_1");
      expect(factorToOutcomeEdges[0].strength_mean).toBe(0.9);
    });

    it("wires orphaned risk making it reachable from decision", () => {
      // This is the key scenario: risk node with outbound edge to goal
      // but no inbound edge from factor, making it unreachable
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1", category: "controllable" },
          { id: "risk_currency", kind: "risk", label: "Currency Fluctuations" },
          { id: "goal_1", kind: "goal", label: "Maximize Profit" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // Risk has outbound to goal (via wireOrphansToGoal) but no inbound
          {
            from: "risk_currency",
            to: "goal_1",
            strength_mean: -0.5,
            strength_std: 0.15,
            belief_exists: 0.9,
            effect_direction: "negative",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Risk should now have inbound edge from factor
      const factorToRiskEdge = result.edges.find(
        (e) => e.from === "fac_1" && e.to === "risk_currency"
      );
      expect(factorToRiskEdge).toBeDefined();

      // Risk is now reachable: dec_1 → opt_a → fac_1 → risk_currency → goal_1
      // All nodes should be preserved
      expect(result.nodes.length).toBe(5);
      expect(result.nodes.find((n) => n.id === "risk_currency")).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles empty graph", () => {
      const graph = createTestGraph({
        nodes: [],
        edges: [],
      });

      const result = simpleRepair(graph);

      expect(result.nodes.length).toBe(0);
      expect(result.edges.length).toBe(0);
    });

    it("handles graph with only decision", () => {
      const graph = createTestGraph({
        nodes: [{ id: "dec_1", kind: "decision", label: "Decision" }],
        edges: [],
      });

      const result = simpleRepair(graph);

      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0].id).toBe("dec_1");
    });

    it("skips pruning when no decision nodes exist", () => {
      // Malformed graph without decision - should skip pruning to avoid over-deletion
      const graph = createTestGraph({
        nodes: [
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "fac_2", kind: "factor", label: "Factor 2" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "fac_2",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // All nodes preserved (pruning skipped due to no decision)
      expect(result.nodes.length).toBe(3);
      expect(result.nodes.find((n) => n.id === "fac_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "fac_2")).toBeDefined();
    });

    it("preserves graph metadata through repair", () => {
      const graph = createTestGraph({
        default_seed: 123,
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      expect(result.version).toBe("1");
      expect(result.default_seed).toBe(123);
    });
  });
});
