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
  type ImprovementGuidanceResult,
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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].source).toBe("missing_baseline");
    });

    it("treats value of 0 as present (not missing)", () => {
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Baseline", observed_state: { value: 0 } },
          ],
        },
      };

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(0);
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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(0);
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

      const result = generateImprovementGuidance(context);
      const missingBaselines = result.items.filter((g) => g.source === "missing_baseline");

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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
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

      const result = generateImprovementGuidance(context);

      expect(result.items[0].reason).toBe("Moderate influence — worth confirming your assumption");
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

      const result = generateImprovementGuidance(context);

      expect(result.items[0].action).toContain("market share");
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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(0);
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

      const result = generateImprovementGuidance(context);

      expect(result.items[0].reason).toBe("Address potential framing");
    });

    it("limits bias items to 2", () => {
      const context: ImprovementGuidanceContext = {
        biasFindings: [
          { id: "b1", category: "selection", severity: "high", micro_intervention: { steps: ["Step 1"] } },
          { id: "b2", category: "measurement", severity: "high", micro_intervention: { steps: ["Step 2"] } },
          { id: "b3", category: "framing", severity: "high", micro_intervention: { steps: ["Step 3"] } },
        ],
      };

      const result = generateImprovementGuidance(context);
      const biasItems = result.items.filter((g) => g.source === "bias");

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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
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

      const result = generateImprovementGuidance(context);

      expect(result.items[0].reason).toBe("Structural improvement recommended");
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

      const result = generateImprovementGuidance(context);

      expect(result.items[0].source).toBe("missing_baseline");
      expect(result.items[1].source).toBe("fragile_edge");
      expect(result.items[2].source).toBe("bias");
      expect(result.items[3].source).toBe("structure");
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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(5);
    });

    it("returns truncated=true when items exceed max", () => {
      // Create context with many unique items to ensure truncation
      // Note: Missing baselines dedupe if first 30 chars match, so use very different labels
      const context: ImprovementGuidanceContext = {
        graph: {
          nodes: [
            { id: "fac_1", kind: "factor", label: "Customer Acquisition Cost", observed_state: undefined },
            { id: "fac_2", kind: "factor", label: "Revenue Growth Rate Metric", observed_state: undefined },
          ],
        },
        investigationSuggestions: [
          { factor_id: "fac_3", factor_label: "Market Share Dynamics", elasticity: 0.7 },
          { factor_id: "fac_4", factor_label: "Operational Efficiency", elasticity: 0.6 },
        ],
        biasFindings: [
          { id: "b1", category: "selection", severity: "high", micro_intervention: { steps: ["Consider alternative data sources for selection"] } },
          { id: "b2", category: "measurement", severity: "high", micro_intervention: { steps: ["Review measurement methodology accuracy"] } },
        ],
        factorRecommendations: [
          { factor_id: "fac_5", recommendation: "Add supporting evidence for this claim", issues: ["Issue 1"] },
          { factor_id: "fac_6", recommendation: "Strengthen causal link documentation", issues: ["Issue 2"] },
        ],
      };

      const result = generateImprovementGuidance(context);

      // With all sources providing unique items: 2 + 2 + 2 + 2 = 8 items before truncation
      expect(result.truncated).toBe(true);
      expect(result.total_available).toBeGreaterThan(5);
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

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(1);
    });

    it("keeps actions with different first 30 chars", () => {
      const context: ImprovementGuidanceContext = {
        factorRecommendations: [
          { factor_id: "fac_1", recommendation: "Add evidence for Factor A", issues: ["Issue 1"] },
          { factor_id: "fac_2", recommendation: "Review assumptions for Factor B", issues: ["Issue 2"] },
        ],
      };

      const result = generateImprovementGuidance(context);

      expect(result.items).toHaveLength(2);
    });
  });

  describe("readiness integration", () => {
    it("injects readiness recommendations when level is not_ready", () => {
      const context: ImprovementGuidanceContext = {
        readiness: {
          level: "not_ready",
          score: 0.2,
          factors: { completeness: 0.2, structure: 0.3, evidence: 0.2, bias_risk: 0.5 },
          summary: "Model is not ready",
          recommendations: ["Add a goal node", "Add more options"],
        },
      };

      const result = generateImprovementGuidance(context);

      expect(result.items.length).toBeGreaterThan(0);
      const readinessItems = result.items.filter(g => g.source === "readiness");
      expect(readinessItems.length).toBeGreaterThan(0);
    });

    it("ensures minimum guidance when readiness is not_ready and no other sources", () => {
      const context: ImprovementGuidanceContext = {
        readiness: {
          level: "not_ready",
          score: 0.1,
          factors: { completeness: 0.1, structure: 0.1, evidence: 0.1, bias_risk: 0.8 },
          summary: "Critical issues detected",
          recommendations: [],
        },
      };

      const result = generateImprovementGuidance(context);

      // Should have at least one item due to minimum guidance rule
      expect(result.items.length).toBeGreaterThan(0);
    });

    it("does not inject readiness for level=ready", () => {
      const context: ImprovementGuidanceContext = {
        readiness: {
          level: "ready",
          score: 0.85,
          factors: { completeness: 0.9, structure: 0.9, evidence: 0.8, bias_risk: 0.1 },
          summary: "Model is ready",
          recommendations: [],
        },
      };

      const result = generateImprovementGuidance(context);

      const readinessItems = result.items.filter(g => g.source === "readiness");
      expect(readinessItems).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty items when no context provided", () => {
      const result = generateImprovementGuidance({});

      expect(result.items).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it("handles undefined graph gracefully", () => {
      const context: ImprovementGuidanceContext = {
        graph: undefined,
      };

      const result = generateImprovementGuidance(context);

      expect(result.items).toEqual([]);
    });

    it("handles graph with no nodes", () => {
      const context: ImprovementGuidanceContext = {
        graph: { nodes: [] },
      };

      const result = generateImprovementGuidance(context);

      expect(result.items).toEqual([]);
    });

    it("handles empty arrays for all inputs", () => {
      const context: ImprovementGuidanceContext = {
        graph: { nodes: [] },
        investigationSuggestions: [],
        biasFindings: [],
        factorRecommendations: [],
      };

      const result = generateImprovementGuidance(context);

      expect(result.items).toEqual([]);
    });
  });
});
