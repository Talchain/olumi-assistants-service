/**
 * CEE Goal-Number Validation Tests (T4)
 *
 * Tests the GOAL_NUMBER_AS_FACTOR validation rule and structural edge repair
 * to ensure goal numeric values like "£20k MRR" or "$50k revenue target"
 * do not become factor nodes, and structural edges are repaired to canonical values.
 */

import { describe, it, expect } from "vitest";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { fixNonCanonicalStructuralEdges } from "../../src/cee/structure/index.js";
import type { GraphT } from "../../src/validators/graph-validator.types.js";

/**
 * Creates a graph simulating output from a brief like:
 * "Should we hire a senior developer? Our goal is reaching £20k MRR within 12 months."
 */
function createGoalNumberBriefGraph(): GraphT {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "decision_1", kind: "decision", label: "Should we hire a senior developer?" },
      { id: "opt_yes", kind: "option", label: "Yes, hire senior dev", data: { interventions: { fac_dev_cost: 80000 } } },
      { id: "opt_no", kind: "option", label: "No, don't hire", data: { interventions: {} } },
      // Legitimate factor
      {
        id: "fac_dev_cost",
        kind: "factor",
        label: "Development Cost",
        data: { value: 80000, extractionType: "explicit" },
      },
      // GOAL-NUMBER FACTOR - This should be flagged by validation
      // Simulates LLM incorrectly extracting "£20k MRR" as a factor
      {
        id: "factor_value_0",
        kind: "factor",
        label: "£20k MRR",
        data: { value: 20000, extractionType: "explicit" },
      },
      { id: "outcome_1", kind: "outcome", label: "Revenue Growth" },
      { id: "goal_1", kind: "goal", label: "Reach £20k MRR within 12 months" },
    ],
    edges: [
      { from: "decision_1", to: "opt_yes", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "decision_1", to: "opt_no", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      // Structural edge with canonical values
      { from: "opt_yes", to: "fac_dev_cost", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      // Causal edge
      { from: "fac_dev_cost", to: "outcome_1", strength_mean: 0.7, belief_exists: 0.8 },
      // Goal-number factor edge (no option edge = observable/external)
      { from: "factor_value_0", to: "outcome_1", strength_mean: 0.5, belief_exists: 0.7 },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

describe("Goal-Number Brief Validation (T4)", () => {
  describe("GOAL_NUMBER_AS_FACTOR detection", () => {
    it("flags factor_value_0 with label '£20k MRR' as GOAL_NUMBER_AS_FACTOR", () => {
      const graph = createGoalNumberBriefGraph();

      const result = validateGraph({ graph });

      // Should have GOAL_NUMBER_AS_FACTOR error
      const goalNumError = result.errors.find((e) => e.code === "GOAL_NUMBER_AS_FACTOR");
      expect(goalNumError).toBeDefined();
      expect(goalNumError?.context?.label).toBe("£20k MRR");
      expect(goalNumError?.context?.factorId).toBe("factor_value_0");
    });

    it("does NOT flag legitimate factors like 'Development Cost'", () => {
      const graph = createGoalNumberBriefGraph();

      const result = validateGraph({ graph });

      // fac_dev_cost should not be flagged (it's a legitimate factor with option edge)
      const errors = result.errors.filter((e) => e.code === "GOAL_NUMBER_AS_FACTOR");
      const devCostError = errors.find((e) => e.context?.factorId === "fac_dev_cost");
      expect(devCostError).toBeUndefined();
    });

    it("goal node preserves goal information (not deleted)", () => {
      const graph = createGoalNumberBriefGraph();

      // Goal node should exist and contain the goal description
      const goalNode = graph.nodes.find((n) => n.kind === "goal");
      expect(goalNode).toBeDefined();
      expect(goalNode?.label).toContain("£20k MRR");
    });

    it("does NOT flag factors that REFERENCE a target value (share of £20k target)", () => {
      // This tests the exclusion pattern for reference-style labels
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Should we increase price?" },
          { id: "opt_yes", kind: "option", label: "Increase price" },
          { id: "opt_no", kind: "option", label: "Keep current price" },
          // Reference-style factor - should NOT be flagged
          {
            id: "fac_mrr",
            kind: "factor",
            label: "Current MRR (0–1, share of £20k target)",
            data: { value: 0.6, extractionType: "inferred" },
          },
          { id: "goal_1", kind: "goal", label: "Reach £20k MRR" },
        ],
        edges: [
          { from: "decision_1", to: "opt_yes", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "decision_1", to: "opt_no", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "fac_mrr", to: "goal_1", strength_mean: 0.8, belief_exists: 0.9 },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = validateGraph({ graph });

      // fac_mrr should NOT be flagged - it's a reference, not the target itself
      const goalNumErrors = result.errors.filter((e) => e.code === "GOAL_NUMBER_AS_FACTOR");
      const mrrError = goalNumErrors.find((e) => e.context?.factorId === "fac_mrr");
      expect(mrrError).toBeUndefined();
    });

    it("does NOT flag 'progress toward £X' style factors", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "opt_1", kind: "option", label: "Option" },
          {
            id: "fac_progress",
            kind: "factor",
            label: "Progress toward £20k goal",
            data: { value: 0.5 },
          },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "fac_progress", to: "goal_1", strength_mean: 0.8, belief_exists: 0.9 },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = validateGraph({ graph });

      const goalNumErrors = result.errors.filter((e) => e.code === "GOAL_NUMBER_AS_FACTOR");
      expect(goalNumErrors.find((e) => e.context?.factorId === "fac_progress")).toBeUndefined();
    });
  });

  describe("Structural edge canonical repair", () => {
    it("repairs non-canonical option->factor edges to canonical values", () => {
      // Create graph with non-canonical structural edge
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A", data: { interventions: { fac_1: 100 } } },
          { id: "fac_1", kind: "factor", label: "Factor 1", data: { value: 100 } },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          // NON-CANONICAL structural edge (mean=0.8, std=undefined, prob=0.9)
          { id: "structural_edge", from: "opt_a", to: "fac_1", strength_mean: 0.8, belief_exists: 0.9 },
          { from: "fac_1", to: "outcome_1", strength_mean: 0.5, belief_exists: 0.7 },
          { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      // Run repair
      const repairResult = fixNonCanonicalStructuralEdges(graph);

      expect(repairResult).toBeDefined();
      expect(repairResult!.fixedEdgeCount).toBe(1);

      // Verify edge was repaired to canonical values
      const repairedEdge = (repairResult!.graph.edges as any[]).find((e) => e.id === "structural_edge");
      expect(repairedEdge.strength_mean).toBe(1.0);
      expect(repairedEdge.strength_std).toBe(0.01);
      expect(repairedEdge.belief_exists).toBe(1.0);
      expect(repairedEdge.effect_direction).toBe("positive");
    });

    it("repair records are generated for each field changed", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          // All fields non-canonical
          { id: "e1", from: "opt_a", to: "fac_1", strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.8, effect_direction: "negative" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const repairResult = fixNonCanonicalStructuralEdges(graph);

      expect(repairResult).toBeDefined();
      expect(repairResult!.repairs.length).toBe(4); // mean, std, prob, direction

      // Check each repair record exists
      const fields = repairResult!.repairs.map((r) => r.field);
      expect(fields).toContain("strength.mean");
      expect(fields).toContain("strength.std");
      expect(fields).toContain("exists_probability");
      expect(fields).toContain("effect_direction");
    });
  });

  describe("Full validation + repair flow", () => {
    it("validation fails, then repair succeeds, then re-validation passes for structural edges", () => {
      // Create graph with non-canonical structural edge
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A", data: { interventions: { fac_1: 100 } } },
          { id: "fac_1", kind: "factor", label: "Factor 1", data: { value: 100 } },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          // NON-CANONICAL structural edge
          { id: "e1", from: "opt_a", to: "fac_1", strength_mean: 0.5, belief_exists: 0.9 },
          { from: "fac_1", to: "outcome_1", strength_mean: 0.5, belief_exists: 0.7 },
          { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      // Step 1: Initial validation should fail
      const initialResult = validateGraph({ graph });
      const structuralError = initialResult.errors.find((e) => e.code === "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
      expect(structuralError).toBeDefined();

      // Step 2: Run repair
      const repairResult = fixNonCanonicalStructuralEdges(graph);
      expect(repairResult).toBeDefined();
      expect(repairResult!.fixedEdgeCount).toBe(1);

      // Step 3: Re-validate repaired graph - should pass structural edge check
      const finalResult = validateGraph({ graph: repairResult!.graph });
      const finalStructuralError = finalResult.errors.find((e) => e.code === "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
      expect(finalStructuralError).toBeUndefined();
    });
  });

  describe("Regression test: factor_value_* nodes", () => {
    it("validates that factor_value_* nodes with goal-like labels are flagged", () => {
      // This is the exact regression signature mentioned in the spec
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          // factor_value_0 with goal-number label - the regression signature
          { id: "factor_value_0", kind: "factor", label: "$50k revenue target", data: { value: 50000 } },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          // No option edge to factor_value_0 (it's observable/external)
          { from: "factor_value_0", to: "outcome_1", strength_mean: 0.5 },
          { from: "outcome_1", to: "goal_1", strength_mean: 0.9 },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = validateGraph({ graph });

      // PRIMARY ASSERTION: factor_value_* nodes with goal-number labels should be flagged
      const goalNumError = result.errors.find((e) => e.code === "GOAL_NUMBER_AS_FACTOR");
      expect(goalNumError).toBeDefined();
      expect(goalNumError?.context?.factorId).toBe("factor_value_0");
      expect(goalNumError?.context?.label).toBe("$50k revenue target");
    });
  });
});
