/**
 * Unit tests for improvement guidance generator
 *
 * Tests the aggregation of actionable recommendations from
 * missing baselines, fragile edges, bias mitigations, and structural improvements.
 */

import { describe, it, expect } from "vitest";
import {
  generateImprovementGuidance,
  type ImprovementGuidanceContext,
  type ImprovementGuidanceItem,
} from "../../src/services/review/improvementGuidance.js";

describe("generateImprovementGuidance", () => {
  describe("missing baselines", () => {
    it("detects factor nodes without baseline values", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Price Elasticity", observed_state: undefined },
            { id: "fac_2", kind: "factor", label: "Market Size", observed_state: { value: 1000 } },
          ],
        },
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(1);
      expect(guidance[0]).toEqual({
        priority: 1,
        action: 'Add baseline value for "Price Elasticity"',
        reason: "Factor has no current estimate — analysis assumes default",
        source: "missing_baseline",
      });
    });

    it("detects factors with null values", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Revenue", observed_state: { value: null as unknown as number } },
          ],
        },
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(1);
      expect(guidance[0].source).toBe("missing_baseline");
    });

    it("treats value of 0 as present (not missing)", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Baseline", observed_state: { value: 0 } },
          ],
        },
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(0);
    });

    it("ignores non-factor nodes", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "goal_1", kind: "goal", label: "Maximize Profit", observed_state: undefined },
            { id: "opt_1", kind: "option", label: "Option A", observed_state: undefined },
          ],
        },
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(0);
    });

    it("limits missing baseline items to 2", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Price Elasticity", observed_state: undefined },
            { id: "fac_2", kind: "factor", label: "Market Share", observed_state: undefined },
            { id: "fac_3", kind: "factor", label: "Customer Satisfaction", observed_state: undefined },
          ],
        },
      };

      const guidance = generateImprovementGuidance(context);
      const missingBaselines = guidance.filter((g) => g.source === "missing_baseline");

      // Only 2 items due to MAX_MISSING_BASELINE_ITEMS limit
      expect(missingBaselines).toHaveLength(2);
    });
  });

  describe("investigation suggestions (fragile edges)", () => {
    it("maps investigation suggestions from robustness data", () => {
      const context: ImprovementGuidanceContext = {
        investigationSuggestions: [
          {
            factor_id: "fac_elasticity",
            factor_label: "Price Elasticity",
            elasticity: 0.7,
            rationale: "High sensitivity to changes",
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(1);
      expect(guidance[0]).toEqual({
        priority: 2,
        action: 'Validate your "Price Elasticity" estimate',
        reason: "High influence factor — small changes significantly affect outcome",
        source: "fragile_edge",
      });
    });

    it("uses moderate influence message for lower elasticity", () => {
      const context: ImprovementGuidanceContext = {
        investigationSuggestions: [
          {
            factor_id: "fac_cost",
            factor_label: "Operating Cost",
            elasticity: 0.3,
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance[0].reason).toBe("Moderate influence — worth confirming your assumption");
    });

    it("derives factor name from ID when label is missing", () => {
      const context: ImprovementGuidanceContext = {
        investigationSuggestions: [
          {
            factor_id: "fac_market_share",
            elasticity: 0.5,
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance[0].action).toContain("market share");
    });
  });

  describe("bias mitigations", () => {
    it("maps bias findings with micro-interventions", () => {
      const context: ImprovementGuidanceContext = {
        biasFindings: [
          {
            id: "bias_1",
            category: "selection",
            severity: "high",
            explanation: "Confirmation bias detected",
            micro_intervention: {
              steps: ["Consider counter-evidence", "Seek opposing views"],
            },
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(1);
      expect(guidance[0]).toEqual({
        priority: 3,
        action: "Consider counter-evidence",
        reason: "Confirmation bias detected",
        source: "bias",
      });
    });

    it("skips bias findings without micro-intervention", () => {
      const context: ImprovementGuidanceContext = {
        biasFindings: [
          {
            id: "bias_1",
            category: "selection",
            severity: "high",
            explanation: "Bias detected but no intervention",
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(0);
    });

    it("uses category in reason when explanation is missing", () => {
      const context: ImprovementGuidanceContext = {
        biasFindings: [
          {
            id: "bias_1",
            category: "framing",
            severity: "medium",
            micro_intervention: {
              steps: ["Reframe the problem"],
            },
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance[0].reason).toBe("Address potential framing");
    });

    it("limits bias items to 2", () => {
      const context: ImprovementGuidanceContext = {
        biasFindings: [
          { id: "b1", category: "selection", severity: "high", micro_intervention: { steps: ["Step 1"] } },
          { id: "b2", category: "measurement", severity: "high", micro_intervention: { steps: ["Step 2"] } },
          { id: "b3", category: "framing", severity: "high", micro_intervention: { steps: ["Step 3"] } },
        ],
      };

      const guidance = generateImprovementGuidance(context);
      const biasItems = guidance.filter((g) => g.source === "bias");

      expect(biasItems).toHaveLength(2);
    });
  });

  describe("factor recommendations (structural)", () => {
    it("maps factor recommendations to guidance items", () => {
      const context: ImprovementGuidanceContext = {
        factorRecommendations: [
          {
            factor_id: "fac_1",
            recommendation: "Add evidence for this factor",
            issues: ["No supporting evidence", "Low confidence"],
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(1);
      expect(guidance[0]).toEqual({
        priority: 4,
        action: "Add evidence for this factor",
        reason: "No supporting evidence; Low confidence",
        source: "structure",
      });
    });

    it("uses default reason when issues array is empty", () => {
      const context: ImprovementGuidanceContext = {
        factorRecommendations: [
          {
            factor_id: "fac_1",
            recommendation: "Review this factor",
            issues: [],
          },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance[0].reason).toBe("Structural improvement recommended");
    });
  });

  describe("prioritization", () => {
    it("orders by priority (lower number = higher priority)", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Missing Baseline", observed_state: undefined },
          ],
        },
        investigationSuggestions: [
          { factor_id: "fac_2", factor_label: "Fragile Edge", elasticity: 0.6 },
        ],
        biasFindings: [
          { id: "b1", category: "selection", severity: "high", micro_intervention: { steps: ["Bias fix"] } },
        ],
        factorRecommendations: [
          { factor_id: "fac_3", recommendation: "Structural fix", issues: ["Issue"] },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance[0].source).toBe("missing_baseline");
      expect(guidance[1].source).toBe("fragile_edge");
      expect(guidance[2].source).toBe("bias");
      expect(guidance[3].source).toBe("structure");
    });

    it("limits total guidance items to 5", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Factor 1", observed_state: undefined },
            { id: "fac_2", kind: "factor", label: "Factor 2", observed_state: undefined },
          ],
        },
        investigationSuggestions: [
          { factor_id: "fac_3", factor_label: "Suggestion 1", elasticity: 0.7 },
          { factor_id: "fac_4", factor_label: "Suggestion 2", elasticity: 0.6 },
        ],
        biasFindings: [
          { id: "b1", category: "selection", severity: "high", micro_intervention: { steps: ["Fix 1"] } },
          { id: "b2", category: "measurement", severity: "high", micro_intervention: { steps: ["Fix 2"] } },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(5);
    });
  });

  describe("deduplication", () => {
    it("removes duplicate actions based on first 30 chars", () => {
      const context: ImprovementGuidanceContext = {
        factorRecommendations: [
          { factor_id: "fac_1", recommendation: "Add evidence for this specific factor", issues: ["Issue 1"] },
          { factor_id: "fac_2", recommendation: "Add evidence for this specific factor but different ending", issues: ["Issue 2"] },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(1);
    });

    it("keeps actions with different first 30 chars", () => {
      const context: ImprovementGuidanceContext = {
        factorRecommendations: [
          { factor_id: "fac_1", recommendation: "Add evidence for Factor A", issues: ["Issue 1"] },
          { factor_id: "fac_2", recommendation: "Review assumptions for Factor B", issues: ["Issue 2"] },
        ],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when no context provided", () => {
      const guidance = generateImprovementGuidance({});

      expect(guidance).toEqual([]);
    });

    it("handles undefined graph gracefully", () => {
      const context: ImprovementGuidanceContext = {
        graph: undefined,
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toEqual([]);
    });

    it("handles graph with no nodes", () => {
      const context: ImprovementGuidanceContext = {
        graph: { nodes: [] },
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toEqual([]);
    });

    it("handles empty arrays for all inputs", () => {
      const context: ImprovementGuidanceContext = {
        graph: { nodes: [] },
        investigationSuggestions: [],
        biasFindings: [],
        factorRecommendations: [],
      };

      const guidance = generateImprovementGuidance(context);

      expect(guidance).toEqual([]);
    });
  });
});
