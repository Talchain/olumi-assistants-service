/**
 * Unit tests for CEE quality detection functions (Pre-Analysis Validation Layer).
 *
 * Tests the Phase 5 quality detection functions:
 * - STRENGTH_CLUSTERING: CV of edge strengths < 0.3
 * - SAME_LEVER_OPTIONS: Options share >60% intervention targets
 * - MISSING_BASELINE: No status quo option detected
 * - GOAL_NO_BASELINE_VALUE: Goal node has no observed_state.value
 * - Goal connectivity checks
 * - Model quality factors computation
 */

import { describe, it, expect } from "vitest";
import {
  detectStrengthClustering,
  detectSameLeverOptions,
  detectMissingBaseline,
  detectGoalNoBaselineValue,
  detectZeroExternalFactors,
  checkGoalConnectivity,
  computeModelQualityFactors,
} from "../../src/cee/structure/index.js";
import {
  severityRank,
  compareSeverity,
  type StructuralWarningSeverity,
} from "../../src/cee/validation/classifier.js";

describe("CEE Quality Detection Functions", () => {
  describe("detectStrengthClustering", () => {
    it("should return detected=false for empty graph", () => {
      const result = detectStrengthClustering(undefined);
      expect(result.detected).toBe(false);
      expect(result.edgeCount).toBe(0);
    });

    it("should return detected=false for graph with varied strengths", () => {
      const graph = {
        nodes: [
          { id: "f1", kind: "factor" },
          { id: "f2", kind: "factor" },
          { id: "f3", kind: "factor" },
        ],
        edges: [
          { id: "e1", from: "f1", to: "f2", strength_mean: 0.2 },
          { id: "e2", from: "f2", to: "f3", strength_mean: 0.8 },
          { id: "e3", from: "f1", to: "f3", strength_mean: -0.5 },
        ],
      };
      const result = detectStrengthClustering(graph as any);
      expect(result.detected).toBe(false);
      expect(result.coefficientOfVariation).toBeGreaterThan(0.3);
    });

    it("should return detected=true for graph with clustered strengths", () => {
      const graph = {
        nodes: [
          { id: "f1", kind: "factor" },
          { id: "f2", kind: "factor" },
          { id: "f3", kind: "factor" },
        ],
        edges: [
          { id: "e1", from: "f1", to: "f2", strength_mean: 0.5 },
          { id: "e2", from: "f2", to: "f3", strength_mean: 0.5 },
          { id: "e3", from: "f1", to: "f3", strength_mean: 0.51 },
        ],
      };
      const result = detectStrengthClustering(graph as any);
      expect(result.detected).toBe(true);
      expect(result.coefficientOfVariation).toBeLessThan(0.3);
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("strength_clustering");
    });

    it("should return detected=true for all zero strengths (divide by zero case)", () => {
      const graph = {
        nodes: [
          { id: "f1", kind: "factor" },
          { id: "f2", kind: "factor" },
        ],
        edges: [
          { id: "e1", from: "f1", to: "f2", strength_mean: 0 },
          { id: "e2", from: "f2", to: "f1", strength_mean: 0 },
        ],
      };
      const result = detectStrengthClustering(graph as any);
      expect(result.detected).toBe(true);
      expect(result.coefficientOfVariation).toBe(0);
    });

    it("should exclude structural edges from calculation", () => {
      const graph = {
        nodes: [
          { id: "d1", kind: "decision" },
          { id: "o1", kind: "option" },
          { id: "f1", kind: "factor" },
          { id: "f2", kind: "factor" },
        ],
        edges: [
          // Structural edges (should be excluded)
          { id: "e1", from: "d1", to: "o1", strength_mean: 1.0 },
          { id: "e2", from: "o1", to: "f1", strength_mean: 1.0 },
          // Causal edges (should be included)
          { id: "e3", from: "f1", to: "f2", strength_mean: 0.5 },
        ],
      };
      const result = detectStrengthClustering(graph as any);
      // With only one causal edge, should not detect clustering
      expect(result.edgeCount).toBe(1);
    });
  });

  describe("detectSameLeverOptions", () => {
    it("should return detected=false for empty graph", () => {
      const result = detectSameLeverOptions(undefined);
      expect(result.detected).toBe(false);
    });

    it("should return detected=false when options have different intervention targets", () => {
      const graph = {
        nodes: [
          {
            id: "opt1",
            kind: "option",
            data: {
              interventions: [
                { target_match: { node_id: "f1" } },
                { target_match: { node_id: "f2" } },
              ],
            },
          },
          {
            id: "opt2",
            kind: "option",
            data: {
              interventions: [
                { target_match: { node_id: "f3" } },
                { target_match: { node_id: "f4" } },
              ],
            },
          },
        ],
      };
      const result = detectSameLeverOptions(graph as any);
      expect(result.detected).toBe(false);
    });

    it("should return detected=true when options share >60% intervention targets", () => {
      const graph = {
        nodes: [
          {
            id: "opt1",
            kind: "option",
            data: {
              interventions: [
                { target_match: { node_id: "f1" } },
                { target_match: { node_id: "f2" } },
                { target_match: { node_id: "f3" } },
              ],
            },
          },
          {
            id: "opt2",
            kind: "option",
            data: {
              interventions: [
                { target_match: { node_id: "f1" } },
                { target_match: { node_id: "f2" } },
                { target_match: { node_id: "f3" } },
              ],
            },
          },
        ],
      };
      const result = detectSameLeverOptions(graph as any);
      expect(result.detected).toBe(true);
      expect(result.maxOverlapPercentage).toBeGreaterThan(0.6);
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("same_lever_options");
    });

    it("should return detected=false for single-option graph", () => {
      const graph = {
        nodes: [
          {
            id: "opt1",
            kind: "option",
            data: {
              interventions: [{ target_match: { node_id: "f1" } }],
            },
          },
        ],
      };
      const result = detectSameLeverOptions(graph as any);
      expect(result.detected).toBe(false);
    });
  });

  describe("detectMissingBaseline", () => {
    it("should return detected=false for empty graph", () => {
      const result = detectMissingBaseline(undefined);
      expect(result.detected).toBe(false);
    });

    it("should return detected=false when status quo option exists", () => {
      const graph = {
        nodes: [
          { id: "opt1", kind: "option", label: "Status Quo - Do nothing" },
          { id: "opt2", kind: "option", label: "Aggressive expansion" },
        ],
      };
      const result = detectMissingBaseline(graph as any);
      expect(result.detected).toBe(false);
      expect(result.hasBaseline).toBe(true);
    });

    it("should return detected=false when is_status_quo flag is set", () => {
      const graph = {
        nodes: [
          { id: "opt1", kind: "option", label: "Current state", data: { is_status_quo: true } },
          { id: "opt2", kind: "option", label: "New approach" },
        ],
      };
      const result = detectMissingBaseline(graph as any);
      expect(result.detected).toBe(false);
      expect(result.hasBaseline).toBe(true);
    });

    it("should return detected=true when no baseline option exists", () => {
      const graph = {
        nodes: [
          { id: "opt1", kind: "option", label: "Option A" },
          { id: "opt2", kind: "option", label: "Option B" },
        ],
      };
      const result = detectMissingBaseline(graph as any);
      expect(result.detected).toBe(true);
      expect(result.hasBaseline).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("missing_baseline");
    });

    it("should recognize various baseline patterns", () => {
      const patterns = [
        "Status quo",
        "Do nothing",
        "No action",
        "Baseline option",
        "Current state approach",
        "As is",
      ];

      for (const pattern of patterns) {
        const graph = {
          nodes: [
            { id: "opt1", kind: "option", label: pattern },
            { id: "opt2", kind: "option", label: "Alternative" },
          ],
        };
        const result = detectMissingBaseline(graph as any);
        expect(result.hasBaseline).toBe(true);
      }
    });
  });

  describe("detectGoalNoBaselineValue", () => {
    it("should return detected=false for empty graph", () => {
      const result = detectGoalNoBaselineValue(undefined);
      expect(result.detected).toBe(false);
    });

    it("should return detected=false when goal has observed_state.value", () => {
      const graph = {
        nodes: [
          { id: "goal1", kind: "goal", observed_state: { value: 100 } },
        ],
      };
      const result = detectGoalNoBaselineValue(graph as any);
      expect(result.detected).toBe(false);
      expect(result.goalHasValue).toBe(true);
    });

    it("should return detected=true when goal has no observed_state.value", () => {
      const graph = {
        nodes: [
          { id: "goal1", kind: "goal" },
        ],
      };
      const result = detectGoalNoBaselineValue(graph as any);
      expect(result.detected).toBe(true);
      expect(result.goalHasValue).toBe(false);
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("goal_no_baseline_value");
    });

    it("should find goal by goal_node_id reference", () => {
      const graph = {
        goal_node_id: "mygoal",
        nodes: [
          { id: "mygoal", kind: "outcome", observed_state: { value: 50 } },
        ],
      };
      const result = detectGoalNoBaselineValue(graph as any);
      expect(result.detected).toBe(false);
      expect(result.goalHasValue).toBe(true);
      expect(result.goalNodeId).toBe("mygoal");
    });
  });

  describe("detectZeroExternalFactors", () => {
    it("should return detected=false for empty graph", () => {
      const result = detectZeroExternalFactors(undefined);
      expect(result.detected).toBe(false);
      expect(result.factorCount).toBe(0);
      expect(result.externalCount).toBe(0);
    });

    it("should emit warning when all factor categories are defined and none are external", () => {
      const graph = {
        nodes: [
          { id: "f1", kind: "factor", category: "controllable" },
          { id: "f2", kind: "factor", category: "controllable" },
          { id: "f3", kind: "factor", category: "observable" },
          { id: "f4", kind: "factor", category: "observable" },
        ],
        edges: [],
      };
      const result = detectZeroExternalFactors(graph as any);
      expect(result.detected).toBe(true);
      expect(result.factorCount).toBe(4);
      expect(result.externalCount).toBe(0);
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("zero_external_factors");
      expect(result.warning?.severity).toBe("medium");
      expect(result.warning?.node_ids).toEqual(["f1", "f2", "f3", "f4"]);
      expect(result.warning?.explanation).toContain("No external (uncontrollable) factors detected");
    });

    it("should not emit warning when one or more external factors exist", () => {
      const graph = {
        nodes: [
          { id: "f1", kind: "factor", category: "controllable" },
          { id: "f2", kind: "factor", category: "observable" },
          { id: "f3", kind: "factor", category: "external" },
        ],
        edges: [],
      };
      const result = detectZeroExternalFactors(graph as any);
      expect(result.detected).toBe(false);
      expect(result.factorCount).toBe(3);
      expect(result.externalCount).toBe(1);
      expect(result.warning).toBeUndefined();
    });

    it("should emit warning when graph has no factor nodes at all", () => {
      const graph = {
        nodes: [
          { id: "d1", kind: "decision" },
          { id: "o1", kind: "option" },
          { id: "g1", kind: "goal" },
        ],
        edges: [],
      };
      const result = detectZeroExternalFactors(graph as any);
      expect(result.detected).toBe(true);
      expect(result.factorCount).toBe(0);
      expect(result.externalCount).toBe(0);
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("zero_external_factors");
    });

    it("should skip silently when any factor has undefined category", () => {
      const graph = {
        nodes: [
          { id: "f1", kind: "factor", category: "controllable" },
          { id: "f2", kind: "factor", category: "controllable" },
          { id: "f3", kind: "factor" }, // category undefined
        ],
        edges: [],
      };
      const result = detectZeroExternalFactors(graph as any);
      expect(result.detected).toBe(false);
      expect(result.factorCount).toBe(3);
      expect(result.warning).toBeUndefined();
    });

    it("should not emit warning when all factors are external", () => {
      const graph = {
        nodes: [
          { id: "f1", kind: "factor", category: "external" },
          { id: "f2", kind: "factor", category: "external" },
        ],
        edges: [],
      };
      const result = detectZeroExternalFactors(graph as any);
      expect(result.detected).toBe(false);
      expect(result.factorCount).toBe(2);
      expect(result.externalCount).toBe(2);
      expect(result.warning).toBeUndefined();
    });

    it("should ignore non-factor nodes when counting", () => {
      const graph = {
        nodes: [
          { id: "d1", kind: "decision" },
          { id: "o1", kind: "option" },
          { id: "f1", kind: "factor", category: "controllable" },
          { id: "out1", kind: "outcome" },
          { id: "g1", kind: "goal" },
        ],
        edges: [],
      };
      const result = detectZeroExternalFactors(graph as any);
      expect(result.detected).toBe(true);
      expect(result.factorCount).toBe(1);
      expect(result.warning?.node_ids).toEqual(["f1"]);
    });
  });

  describe("checkGoalConnectivity", () => {
    it("should return status=none for empty graph", () => {
      const result = checkGoalConnectivity(undefined);
      expect(result.status).toBe("none");
    });

    it("should return status=full when all options connect to goal", () => {
      const graph = {
        goal_node_id: "goal1",
        nodes: [
          { id: "goal1", kind: "goal" },
          { id: "opt1", kind: "option" },
          { id: "f1", kind: "factor" },
        ],
        edges: [
          { from: "opt1", to: "f1" },
          { from: "f1", to: "goal1" },
        ],
      };
      const result = checkGoalConnectivity(graph as any);
      expect(result.status).toBe("full");
      expect(result.disconnectedOptions).toHaveLength(0);
    });

    it("should return status=partial when some options are disconnected", () => {
      const graph = {
        goal_node_id: "goal1",
        nodes: [
          { id: "goal1", kind: "goal" },
          { id: "opt1", kind: "option" },
          { id: "opt2", kind: "option" },
          { id: "f1", kind: "factor" },
        ],
        edges: [
          { from: "opt1", to: "f1" },
          { from: "f1", to: "goal1" },
          // opt2 has no path to goal
        ],
      };
      const result = checkGoalConnectivity(graph as any);
      expect(result.status).toBe("partial");
      expect(result.disconnectedOptions).toContain("opt2");
    });

    it("should return status=none when no options connect to goal", () => {
      const graph = {
        goal_node_id: "goal1",
        nodes: [
          { id: "goal1", kind: "goal" },
          { id: "opt1", kind: "option" },
          { id: "opt2", kind: "option" },
        ],
        edges: [],
      };
      const result = checkGoalConnectivity(graph as any);
      expect(result.status).toBe("none");
      expect(result.disconnectedOptions).toContain("opt1");
      expect(result.disconnectedOptions).toContain("opt2");
      expect(result.warning).toBeDefined();
      expect(result.warning?.id).toBe("goal_connectivity_none");
      expect(result.warning?.severity).toBe("blocker");
      expect(result.warning?.fix_hint).toBe("Connect each option to the goal via at least one factor or edge");
    });

    it("should identify weak paths with low aggregate strength", () => {
      const graph = {
        goal_node_id: "goal1",
        nodes: [
          { id: "goal1", kind: "goal" },
          { id: "opt1", kind: "option" },
          { id: "f1", kind: "factor" },
          { id: "f2", kind: "factor" },
        ],
        edges: [
          { from: "opt1", to: "f1", strength_mean: 0.1 },
          { from: "f1", to: "f2", strength_mean: 0.1 },
          { from: "f2", to: "goal1", strength_mean: 0.1 },
        ],
      };
      const result = checkGoalConnectivity(graph as any);
      expect(result.status).toBe("full");
      expect(result.weakPaths.length).toBeGreaterThan(0);
      expect(result.weakPaths[0].path_strength).toBeLessThan(0.1);
    });
  });

  describe("computeModelQualityFactors", () => {
    it("should return default values for empty graph", () => {
      const result = computeModelQualityFactors(undefined);
      expect(result.estimate_confidence).toBe(0.5);
      expect(result.strength_variation).toBe(0);
      expect(result.range_confidence_coverage).toBe(0);
      expect(result.has_baseline_option).toBe(false);
    });

    it("should compute strength variation correctly", () => {
      const graph = {
        nodes: [],
        edges: [
          { strength_mean: 0.2 },
          { strength_mean: 0.4 },
          { strength_mean: 0.6 },
          { strength_mean: 0.8 },
        ],
      };
      const result = computeModelQualityFactors(graph as any);
      expect(result.strength_variation).toBeGreaterThan(0);
    });

    it("should detect baseline option", () => {
      const graph = {
        nodes: [
          { id: "opt1", kind: "option", label: "Status quo" },
        ],
        edges: [],
      };
      const result = computeModelQualityFactors(graph as any);
      expect(result.has_baseline_option).toBe(true);
    });

    it("should compute range confidence coverage for high-confidence sources", () => {
      const graph = {
        nodes: [
          {
            id: "opt1",
            kind: "option",
            data: {
              interventions: [
                { range: { min: 0, max: 100 }, range_source: "explicit" },
                { range: { min: 10, max: 20 }, range_source: "extracted" },
                { /* no range */ },
              ],
            },
          },
        ],
        edges: [],
      };
      const result = computeModelQualityFactors(graph as any);
      // 2 out of 3 interventions have high-confidence ranges
      expect(result.range_confidence_coverage).toBeCloseTo(0.67, 1);
    });

    it("should exclude inferred and default sources from range confidence coverage", () => {
      const graph = {
        nodes: [
          {
            id: "opt1",
            kind: "option",
            data: {
              interventions: [
                { range: { min: 0, max: 100 }, range_source: "explicit" }, // counts
                { range: { min: 10, max: 20 }, range_source: "inferred_spread" }, // excluded
                { range: { min: 5, max: 15 }, range_source: "default" }, // excluded
                { range: { min: 1, max: 10 }, range_source: "inferred_baseline" }, // excluded
              ],
            },
          },
        ],
        edges: [],
      };
      const result = computeModelQualityFactors(graph as any);
      // Only 1 out of 4 interventions has a high-confidence range
      expect(result.range_confidence_coverage).toBeCloseTo(0.25, 2);
    });

    it("should count brief and context as high-confidence sources", () => {
      const graph = {
        nodes: [
          {
            id: "opt1",
            kind: "option",
            data: {
              interventions: [
                { range: { min: 0, max: 100 }, range_source: "brief" }, // counts
                { range: { min: 10, max: 20 }, range_source: "context" }, // counts
                { /* no range */ },
              ],
            },
          },
        ],
        edges: [],
      };
      const result = computeModelQualityFactors(graph as any);
      // 2 out of 3 interventions have high-confidence ranges
      expect(result.range_confidence_coverage).toBeCloseTo(0.67, 1);
    });
  });
});

describe("Severity Rank Helper", () => {
  describe("severityRank", () => {
    it("should return correct rank for each severity level", () => {
      expect(severityRank("blocker")).toBe(3);
      expect(severityRank("high")).toBe(2);
      expect(severityRank("medium")).toBe(1);
      expect(severityRank("low")).toBe(0);
    });

    it("should rank blocker > high > medium > low", () => {
      expect(severityRank("blocker")).toBeGreaterThan(severityRank("high"));
      expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
      expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));
    });
  });

  describe("compareSeverity", () => {
    it("should return positive when first severity is higher", () => {
      expect(compareSeverity("blocker", "high")).toBeGreaterThan(0);
      expect(compareSeverity("high", "medium")).toBeGreaterThan(0);
      expect(compareSeverity("medium", "low")).toBeGreaterThan(0);
    });

    it("should return negative when first severity is lower", () => {
      expect(compareSeverity("low", "medium")).toBeLessThan(0);
      expect(compareSeverity("medium", "high")).toBeLessThan(0);
      expect(compareSeverity("high", "blocker")).toBeLessThan(0);
    });

    it("should return 0 when severities are equal", () => {
      expect(compareSeverity("blocker", "blocker")).toBe(0);
      expect(compareSeverity("high", "high")).toBe(0);
      expect(compareSeverity("medium", "medium")).toBe(0);
      expect(compareSeverity("low", "low")).toBe(0);
    });

    it("should work for sorting warnings by severity (descending)", () => {
      const severities: StructuralWarningSeverity[] = ["medium", "blocker", "low", "high"];
      const sorted = [...severities].sort((a, b) => compareSeverity(b, a)); // Descending
      expect(sorted).toEqual(["blocker", "high", "medium", "low"]);
    });
  });
});
