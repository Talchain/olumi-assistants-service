/**
 * Unit tests for robustness synthesis generator
 *
 * Tests template-based generation of natural language explanations
 * from PLoT robustness data.
 */

import { describe, it, expect } from "vitest";
import { generateRobustnessSynthesis } from "../../src/services/review/robustnessSynthesis.js";
import type { PLoTRobustnessDataT } from "../../src/schemas/review.js";

describe("generateRobustnessSynthesis", () => {
  describe("headline generation", () => {
    it("generates headline with stability and recommended option", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.87,
        recommended_option: {
          id: "opt_premium",
          label: "Premium Pricing",
        },
      };

      const result = generateRobustnessSynthesis(data);

      expect(result).not.toBeNull();
      expect(result?.headline).toBe(
        "87% confident that Premium Pricing remains your best option"
      );
    });

    it("rounds stability to nearest integer", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.8749,
        recommended_option: {
          id: "opt_a",
          label: "Option A",
        },
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toBe(
        "87% confident that Option A remains your best option"
      );
    });

    it("generates fallback headline without recommended option", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.65,
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toBe(
        "65% confidence in the current recommendation"
      );
    });

    it("omits headline when stability is missing", () => {
      const data: PLoTRobustnessDataT = {
        recommended_option: {
          id: "opt_a",
          label: "Option A",
        },
        fragile_edges: [
          {
            edge_id: "e1",
            from_label: "Price",
            to_label: "Revenue",
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result).not.toBeNull();
      expect(result?.headline).toBeUndefined();
      expect(result?.assumption_explanations).toBeDefined();
    });
  });

  describe("assumption explanations generation", () => {
    it("generates explanation with alternative winner", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [
          {
            edge_id: "fac_price->goal_revenue",
            from_label: "Price",
            to_label: "Revenue",
            alternative_winner_id: "opt_economy",
            alternative_winner_label: "Economy Pricing",
            switch_probability: 0.34,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.assumption_explanations).toHaveLength(1);
      expect(result?.assumption_explanations?.[0]).toEqual({
        edge_id: "fac_price->goal_revenue",
        explanation:
          "If the effect of Price on Revenue is weaker than modelled, Economy Pricing may become preferred",
        severity: "fragile",
      });
    });

    it("generates fallback explanation without alternative winner", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [
          {
            edge_id: "e1",
            from_label: "Market Size",
            to_label: "Growth",
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.assumption_explanations?.[0]?.explanation).toBe(
        "If the effect of Market Size on Growth is weaker than modelled, your recommendation may change"
      );
    });

    it("handles multiple fragile edges", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [
          {
            edge_id: "e1",
            from_label: "Price",
            to_label: "Revenue",
            alternative_winner_label: "Option B",
          },
          {
            edge_id: "e2",
            from_label: "Cost",
            to_label: "Profit",
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.assumption_explanations).toHaveLength(2);
      expect(result?.assumption_explanations?.[0]?.edge_id).toBe("e1");
      expect(result?.assumption_explanations?.[1]?.edge_id).toBe("e2");
    });

    it("omits assumption_explanations when fragile_edges is empty", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        fragile_edges: [],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toBeDefined();
      expect(result?.assumption_explanations).toBeUndefined();
    });

    it("omits assumption_explanations when fragile_edges is missing", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.assumption_explanations).toBeUndefined();
    });
  });

  describe("investigation suggestions generation", () => {
    it("includes factors with importance_rank <= 3", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_market_size",
            factor_label: "Market Size",
            elasticity: 0.73,
            importance_rank: 1,
          },
          {
            factor_id: "fac_cost",
            factor_label: "Cost",
            elasticity: 0.15,
            importance_rank: 2,
          },
          {
            factor_id: "fac_time",
            factor_label: "Time to Market",
            elasticity: 0.1,
            importance_rank: 4,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions).toHaveLength(2);
      expect(result?.investigation_suggestions?.[0]?.factor_id).toBe(
        "fac_market_size"
      );
      expect(result?.investigation_suggestions?.[1]?.factor_id).toBe("fac_cost");
    });

    it("includes factors with elasticity >= 0.3", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_a",
            factor_label: "Factor A",
            elasticity: 0.35,
          },
          {
            factor_id: "fac_b",
            factor_label: "Factor B",
            elasticity: 0.2,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions).toHaveLength(1);
      expect(result?.investigation_suggestions?.[0]?.factor_id).toBe("fac_a");
    });

    it("generates suggestion with high influence for elasticity >= 0.5", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_market_size",
            factor_label: "Market Size",
            elasticity: 0.73,
            importance_rank: 1,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions?.[0]?.suggestion).toBe(
        "Validate your Market Size estimate — this factor has high influence on the outcome"
      );
      expect(result?.investigation_suggestions?.[0]?.elasticity).toBe(0.73);
    });

    it("generates suggestion with moderate influence for elasticity < 0.5", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_cost",
            factor_label: "Cost",
            elasticity: 0.35,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions?.[0]?.suggestion).toBe(
        "Validate your Cost estimate — this factor has moderate influence on the outcome"
      );
    });

    it("sorts by importance_rank then by elasticity", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_low_rank",
            factor_label: "Low Rank",
            elasticity: 0.9,
            importance_rank: 3,
          },
          {
            factor_id: "fac_high_rank",
            factor_label: "High Rank",
            elasticity: 0.1,
            importance_rank: 1,
          },
          {
            factor_id: "fac_no_rank_high_elasticity",
            factor_label: "No Rank High Elasticity",
            elasticity: 0.8,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions?.map((s) => s.factor_id)).toEqual([
        "fac_high_rank",
        "fac_low_rank",
        "fac_no_rank_high_elasticity",
      ]);
    });

    it("omits investigation_suggestions when factor_sensitivity is empty", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        factor_sensitivity: [],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions).toBeUndefined();
    });

    it("omits investigation_suggestions when no factors meet criteria", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        factor_sensitivity: [
          {
            factor_id: "fac_a",
            factor_label: "Factor A",
            elasticity: 0.1,
            importance_rank: 5,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions).toBeUndefined();
    });
  });

  describe("missing data handling", () => {
    it("returns null when robustness_data is undefined", () => {
      const result = generateRobustnessSynthesis(undefined);
      expect(result).toBeNull();
    });

    it("returns null when robustness_data is null", () => {
      const result = generateRobustnessSynthesis(null);
      expect(result).toBeNull();
    });

    it("returns null when all fields are empty", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [],
        factor_sensitivity: [],
      };

      const result = generateRobustnessSynthesis(data);
      expect(result).toBeNull();
    });

    it("returns null for empty object", () => {
      const data: PLoTRobustnessDataT = {};

      const result = generateRobustnessSynthesis(data);
      expect(result).toBeNull();
    });
  });

  describe("full synthesis generation", () => {
    it("generates complete synthesis with all fields", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.87,
        recommended_option: {
          id: "opt_premium",
          label: "Premium Pricing",
        },
        fragile_edges: [
          {
            edge_id: "fac_price->goal_revenue",
            from_label: "Price",
            to_label: "Revenue",
            alternative_winner_id: "opt_economy",
            alternative_winner_label: "Economy Pricing",
            switch_probability: 0.34,
          },
        ],
        robust_edges: [
          {
            edge_id: "fac_market_size->goal_revenue",
            from_label: "Market Size",
            to_label: "Revenue",
          },
        ],
        factor_sensitivity: [
          {
            factor_id: "fac_market_size",
            factor_label: "Market Size",
            elasticity: 0.73,
            importance_rank: 1,
            interpretation: "Decision is highly sensitive to Market Size",
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result).toEqual({
        headline: "87% confident that Premium Pricing remains your best option",
        assumption_explanations: [
          {
            edge_id: "fac_price->goal_revenue",
            explanation:
              "If the effect of Price on Revenue is weaker than modelled, Economy Pricing may become preferred",
            severity: "fragile",
          },
        ],
        investigation_suggestions: [
          {
            factor_id: "fac_market_size",
            suggestion:
              "Validate your Market Size estimate — this factor has high influence on the outcome",
            elasticity: 0.73,
          },
        ],
      });
    });

    it("generates partial synthesis when only some data available", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.75,
        recommended_option: {
          id: "opt_a",
          label: "Option A",
        },
        // No fragile_edges or factor_sensitivity
      };

      const result = generateRobustnessSynthesis(data);

      expect(result).toEqual({
        headline: "75% confident that Option A remains your best option",
      });
      expect(result?.assumption_explanations).toBeUndefined();
      expect(result?.investigation_suggestions).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("handles 0% stability", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0,
        recommended_option: { id: "opt", label: "Test" },
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toBe(
        "0% confident that Test remains your best option"
      );
    });

    it("handles 100% stability", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 1.0,
        recommended_option: { id: "opt", label: "Best Option" },
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toBe(
        "100% confident that Best Option remains your best option"
      );
    });

    it("handles special characters in labels", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        recommended_option: {
          id: "opt",
          label: 'Option with "quotes" & ampersand',
        },
        fragile_edges: [
          {
            edge_id: "e1",
            from_label: "Factor <A>",
            to_label: "Goal (Primary)",
            alternative_winner_label: "Alt's Choice",
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toContain('Option with "quotes" & ampersand');
      expect(result?.assumption_explanations?.[0]?.explanation).toContain(
        "Factor <A>"
      );
    });

    it("handles elasticity at boundary values", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          { factor_id: "f1", factor_label: "F1", elasticity: 0.3 },
          { factor_id: "f2", factor_label: "F2", elasticity: 0.5 },
          { factor_id: "f3", factor_label: "F3", elasticity: 0.29 },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      // f1 (0.3) and f2 (0.5) should be included, f3 (0.29) should not
      expect(result?.investigation_suggestions).toHaveLength(2);
      expect(result?.investigation_suggestions?.map((s) => s.factor_id)).toEqual([
        "f2",
        "f1",
      ]);
      // f2 should have "high" (>= 0.5), f1 should have "moderate"
      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain(
        "high influence"
      );
      expect(result?.investigation_suggestions?.[1]?.suggestion).toContain(
        "moderate influence"
      );
    });
  });
});
