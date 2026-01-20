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

    it("uses fallback headline when stability is missing", () => {
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
      // With fallbacks enabled, should get a fallback headline
      expect(result?.headline).toBe("Robustness analysis in progress");
      expect(result?.assumption_explanations).toBeDefined();
    });

    it("omits headline when stability is missing and fallbacks disabled", () => {
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

      const result = generateRobustnessSynthesis(data, { includeFallbacks: false });

      expect(result).not.toBeNull();
      expect(result?.headline).toBeUndefined();
      expect(result?.assumption_explanations).toBeDefined();
    });
  });

  describe("assumption explanations generation", () => {
    it("generates contextualised explanation with alternative winner", () => {
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
      const explanation = result?.assumption_explanations?.[0];
      expect(explanation?.edge_id).toBe("fac_price->goal_revenue");
      expect(explanation?.severity).toBe("fragile");
      // Check contextualised explanation includes key elements
      expect(explanation?.explanation).toContain("Price");
      expect(explanation?.explanation).toContain("Revenue");
      expect(explanation?.explanation).toContain("Economy Pricing");
      // Should have validation_hint for price (cost type)
      expect(explanation?.validation_hint).toBeDefined();
    });

    it("generates explanation without alternative winner", () => {
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

      const explanation = result?.assumption_explanations?.[0]?.explanation;
      expect(explanation).toContain("Market Size");
      expect(explanation).toContain("Growth");
      expect(explanation).toContain("recommendation could change");
    });

    it("generates contextualised explanation for cost factors", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [
          {
            edge_id: "e1",
            from_label: "Implementation Cost",
            to_label: "Profit",
            switch_probability: 0.45,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      const explanation = result?.assumption_explanations?.[0];
      expect(explanation?.explanation).toContain("costs may differ from estimates");
      expect(explanation?.validation_hint).toContain("quotes");
    });

    it("generates contextualised explanation for time factors", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [
          {
            edge_id: "e1",
            from_label: "Development Time",
            to_label: "Revenue",
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      const explanation = result?.assumption_explanations?.[0];
      expect(explanation?.explanation).toContain("timelines may vary");
      expect(explanation?.validation_hint).toContain("timelines");
    });

    it("includes likelihood phrase for high switch probability", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [
          {
            edge_id: "e1",
            from_label: "Factor A",
            to_label: "Goal",
            switch_probability: 0.5,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.assumption_explanations?.[0]?.explanation).toContain("realistic scenario");
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

    it("provides fallback for assumption_explanations when fragile_edges is empty", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        fragile_edges: [],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toBeDefined();
      // Should have fallback message
      expect(result?.assumption_explanations?.[0]?.explanation).toContain("No critical assumptions");
    });

    it("omits assumption_explanations when fallbacks disabled", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        fragile_edges: [],
      };

      const result = generateRobustnessSynthesis(data, { includeFallbacks: false });

      expect(result?.headline).toBeDefined();
      expect(result?.assumption_explanations).toBeUndefined();
    });

    it("provides fallback for assumption_explanations when fragile_edges is missing", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
      };

      const result = generateRobustnessSynthesis(data);

      // Should have fallback message
      expect(result?.assumption_explanations?.[0]?.explanation).toContain("No critical assumptions");
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

    it("generates contextualised suggestion with high influence for elasticity >= 0.5", () => {
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

      const suggestion = result?.investigation_suggestions?.[0];
      expect(suggestion?.suggestion).toContain("Market Size");
      expect(suggestion?.suggestion).toContain("high influence");
      expect(suggestion?.suggestion).toContain("most influential factor");
      expect(suggestion?.elasticity).toBe(0.73);
    });

    it("generates contextualised suggestion for cost factors", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_cost",
            factor_label: "Implementation Cost",
            elasticity: 0.55,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      const suggestion = result?.investigation_suggestions?.[0];
      expect(suggestion?.suggestion).toContain("quotes");
      expect(suggestion?.suggestion).toContain("Implementation Cost");
      expect(suggestion?.factor_type).toBe("cost");
      expect(suggestion?.validation_action).toContain("quotes");
    });

    it("generates contextualised suggestion for time factors", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_time",
            factor_label: "Time to Market",
            elasticity: 0.45,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      const suggestion = result?.investigation_suggestions?.[0];
      expect(suggestion?.suggestion).toContain("Time to Market");
      expect(suggestion?.suggestion).toContain("timelines");
      expect(suggestion?.factor_type).toBe("time");
    });

    it("generates suggestion with moderate influence for elasticity < 0.5", () => {
      const data: PLoTRobustnessDataT = {
        factor_sensitivity: [
          {
            factor_id: "fac_generic",
            factor_label: "Generic Factor",
            elasticity: 0.35,
          },
        ],
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain(
        "moderate influence"
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

    it("provides fallback for investigation_suggestions when factor_sensitivity is empty", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        factor_sensitivity: [],
      };

      const result = generateRobustnessSynthesis(data);

      // Should have fallback message
      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain("stable influence");
    });

    it("omits investigation_suggestions when fallbacks disabled", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.9,
        factor_sensitivity: [],
      };

      const result = generateRobustnessSynthesis(data, { includeFallbacks: false });

      expect(result?.investigation_suggestions).toBeUndefined();
    });

    it("provides fallback when no factors meet criteria", () => {
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

      // Should have fallback message since no factors meet criteria
      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain("stable influence");
    });

    it("omits investigation_suggestions when no factors meet criteria and fallbacks disabled", () => {
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

      const result = generateRobustnessSynthesis(data, { includeFallbacks: false });

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

    it("returns fallback messages when all fields are empty (default behavior)", () => {
      const data: PLoTRobustnessDataT = {
        fragile_edges: [],
        factor_sensitivity: [],
      };

      const result = generateRobustnessSynthesis(data);

      // With fallbacks enabled (default), should return synthesis with fallback messages
      expect(result).not.toBeNull();
      expect(result?.headline).toBe("Robustness analysis in progress");
      expect(result?.assumption_explanations?.[0]?.explanation).toContain("No critical assumptions");
      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain("stable influence");
    });

    it("returns null for empty object when fallbacks disabled", () => {
      const data: PLoTRobustnessDataT = {};

      const result = generateRobustnessSynthesis(data, { includeFallbacks: false });
      expect(result).toBeNull();
    });

    it("returns fallback messages for empty object (default behavior)", () => {
      const data: PLoTRobustnessDataT = {};

      const result = generateRobustnessSynthesis(data);

      expect(result).not.toBeNull();
      expect(result?.headline).toBeDefined();
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

      // Check headline
      expect(result?.headline).toBe("87% confident that Premium Pricing remains your best option");

      // Check assumption explanations - should have contextualised content
      expect(result?.assumption_explanations).toHaveLength(1);
      expect(result?.assumption_explanations?.[0]?.edge_id).toBe("fac_price->goal_revenue");
      expect(result?.assumption_explanations?.[0]?.severity).toBe("fragile");
      expect(result?.assumption_explanations?.[0]?.explanation).toContain("Price");
      expect(result?.assumption_explanations?.[0]?.explanation).toContain("Revenue");
      expect(result?.assumption_explanations?.[0]?.explanation).toContain("Economy Pricing");

      // Check investigation suggestions - should have contextualised content
      expect(result?.investigation_suggestions).toHaveLength(1);
      expect(result?.investigation_suggestions?.[0]?.factor_id).toBe("fac_market_size");
      expect(result?.investigation_suggestions?.[0]?.elasticity).toBe(0.73);
      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain("Market Size");
      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain("high influence");
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

      const result = generateRobustnessSynthesis(data, { includeFallbacks: false });

      expect(result?.headline).toBe("75% confident that Option A remains your best option");
      expect(result?.assumption_explanations).toBeUndefined();
      expect(result?.investigation_suggestions).toBeUndefined();
    });

    it("includes fallback messages when partial data with fallbacks enabled", () => {
      const data: PLoTRobustnessDataT = {
        recommendation_stability: 0.75,
        recommended_option: {
          id: "opt_a",
          label: "Option A",
        },
        // No fragile_edges or factor_sensitivity
      };

      const result = generateRobustnessSynthesis(data);

      expect(result?.headline).toBe("75% confident that Option A remains your best option");
      // Fallback messages should be included for missing sections
      expect(result?.assumption_explanations?.[0]?.explanation).toContain("No critical assumptions");
      expect(result?.investigation_suggestions?.[0]?.suggestion).toContain("stable influence");
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
