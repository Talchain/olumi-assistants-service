import { describe, it, expect } from "vitest";
import {
  matchInterventionToFactor,
  hasPathToGoal,
  batchMatchFactors,
  findFactorNodes,
  getMatchStatistics,
  type FactorMatchResult,
} from "../../src/cee/extraction/factor-matcher.js";
import type { NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";

describe("CEE Factor Matcher", () => {
  const sampleNodes: NodeV3T[] = [
    { id: "goal_revenue", kind: "goal", label: "Maximize Revenue" },
    { id: "factor_price", kind: "factor", label: "Price" },
    { id: "factor_marketing_spend", kind: "factor", label: "Marketing Spend" },
    { id: "factor_customer_count", kind: "factor", label: "Customer Count" },
    { id: "factor_profit_margin", kind: "factor", label: "Profit Margin" },
    { id: "outcome_success", kind: "outcome", label: "Business Success" },
  ];

  const sampleEdges: EdgeV3T[] = [
    {
      from: "factor_price",
      to: "goal_revenue",
      strength: { mean: 0.8, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    },
    {
      from: "factor_marketing_spend",
      to: "factor_customer_count",
      strength: { mean: 0.6, std: 0.15 },
      exists_probability: 0.8,
      effect_direction: "positive",
    },
    {
      from: "factor_customer_count",
      to: "goal_revenue",
      strength: { mean: 0.7, std: 0.12 },
      exists_probability: 0.85,
      effect_direction: "positive",
    },
    {
      from: "factor_profit_margin",
      to: "outcome_success",
      strength: { mean: 0.5, std: 0.2 },
      exists_probability: 0.7,
      effect_direction: "positive",
    },
  ];

  describe("matchInterventionToFactor", () => {
    describe("exact ID matching", () => {
      it("matches exact node ID", () => {
        const result = matchInterventionToFactor(
          "factor_price",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        expect(result.matched).toBe(true);
        expect(result.node_id).toBe("factor_price");
        expect(result.match_type).toBe("exact_id");
        expect(result.confidence).toBe("high");
      });

      it("matches ID without factor prefix", () => {
        const result = matchInterventionToFactor(
          "price",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        expect(result.matched).toBe(true);
        expect(result.node_id).toBe("factor_price");
      });
    });

    describe("exact label matching", () => {
      it("matches via factor_ prefix in ID", () => {
        // "Marketing Spend" normalizes to "marketing_spend"
        // ID check finds "factor_marketing_spend" via factor_ prefix
        const result = matchInterventionToFactor(
          "Marketing Spend",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        expect(result.matched).toBe(true);
        expect(result.node_id).toBe("factor_marketing_spend");
        // Matches via factor_ prefix in ID check, not label check
        expect(result.match_type).toBe("exact_id");
        expect(result.confidence).toBe("high");
      });

      it("matches label when no ID match exists", () => {
        // Use nodes where the label doesn't match ID pattern
        const nodes: NodeV3T[] = [
          { id: "goal_revenue", kind: "goal", label: "Maximize Revenue" },
          { id: "custom_factor_123", kind: "factor", label: "Customer Count" },
        ];
        const edges: EdgeV3T[] = [
          {
            from: "custom_factor_123",
            to: "goal_revenue",
            strength: { mean: 0.7, std: 0.1 },
            exists_probability: 0.9,
            effect_direction: "positive",
          },
        ];
        const result = matchInterventionToFactor(
          "Customer Count",
          nodes,
          edges,
          "goal_revenue"
        );
        expect(result.matched).toBe(true);
        expect(result.node_id).toBe("custom_factor_123");
        expect(result.match_type).toBe("exact_label");
      });
    });

    describe("semantic matching", () => {
      it("matches synonyms", () => {
        const result = matchInterventionToFactor(
          "advertising budget",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        // Should match "Marketing Spend" via synonym
        expect(result.matched).toBe(true);
        expect(result.match_type).toBe("semantic");
      });

      it("matches partial content", () => {
        const result = matchInterventionToFactor(
          "customer",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        expect(result.matched).toBe(true);
        expect(result.node_id).toBe("factor_customer_count");
      });
    });

    describe("path to goal checking", () => {
      it("detects direct path to goal", () => {
        const result = matchInterventionToFactor(
          "price",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        expect(result.has_path_to_goal).toBe(true);
      });

      it("detects indirect path to goal", () => {
        const result = matchInterventionToFactor(
          "marketing spend",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        // marketing_spend → customer_count → goal_revenue
        expect(result.has_path_to_goal).toBe(true);
      });

      it("detects no path to goal", () => {
        const result = matchInterventionToFactor(
          "profit margin",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        // profit_margin → outcome_success (not to goal_revenue)
        expect(result.has_path_to_goal).toBe(false);
      });
    });

    describe("non-factor rejection", () => {
      it("does not match goal nodes", () => {
        const result = matchInterventionToFactor(
          "revenue",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        // Should not match goal_revenue as it's not a factor
        expect(result.matched).toBe(false);
      });

      it("does not match outcome nodes", () => {
        const result = matchInterventionToFactor(
          "success",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        expect(result.matched).toBe(false);
      });
    });

    describe("no match scenarios", () => {
      it("returns not matched for unknown target", () => {
        const result = matchInterventionToFactor(
          "completely unknown factor",
          sampleNodes,
          sampleEdges,
          "goal_revenue"
        );
        expect(result.matched).toBe(false);
        expect(result.match_type).toBe("none");
        expect(result.confidence).toBe("low");
      });
    });
  });

  describe("hasPathToGoal", () => {
    it("returns true for direct connection", () => {
      expect(hasPathToGoal("factor_price", sampleEdges, "goal_revenue")).toBe(true);
    });

    it("returns true for indirect connection", () => {
      expect(hasPathToGoal("factor_marketing_spend", sampleEdges, "goal_revenue")).toBe(true);
    });

    it("returns true for goal node itself", () => {
      expect(hasPathToGoal("goal_revenue", sampleEdges, "goal_revenue")).toBe(true);
    });

    it("returns false for disconnected node", () => {
      expect(hasPathToGoal("factor_profit_margin", sampleEdges, "goal_revenue")).toBe(false);
    });
  });

  describe("batchMatchFactors", () => {
    it("matches multiple targets", () => {
      const targets = ["price", "marketing spend", "unknown"];
      const results = batchMatchFactors(targets, sampleNodes, sampleEdges, "goal_revenue");

      expect(results.size).toBe(3);
      expect(results.get("price")?.matched).toBe(true);
      expect(results.get("marketing spend")?.matched).toBe(true);
      expect(results.get("unknown")?.matched).toBe(false);
    });
  });

  describe("findFactorNodes", () => {
    it("returns only factor nodes", () => {
      const factors = findFactorNodes(sampleNodes);
      expect(factors.length).toBe(4);
      expect(factors.every((n) => n.kind === "factor")).toBe(true);
    });
  });

  describe("getMatchStatistics", () => {
    it("calculates correct statistics", () => {
      const results = new Map<string, FactorMatchResult>([
        ["price", { matched: true, node_id: "factor_price", match_type: "exact_id", confidence: "high", has_path_to_goal: true }],
        ["marketing", { matched: true, node_id: "factor_marketing", match_type: "semantic", confidence: "medium", has_path_to_goal: true }],
        ["unknown", { matched: false, match_type: "none", confidence: "low", has_path_to_goal: false }],
      ]);

      const stats = getMatchStatistics(results);

      expect(stats.total).toBe(3);
      expect(stats.matched).toBe(2);
      expect(stats.unmatched).toBe(1);
      expect(stats.exact_id_matches).toBe(1);
      expect(stats.semantic_matches).toBe(1);
      expect(stats.high_confidence).toBe(1);
      expect(stats.medium_confidence).toBe(1);
      expect(stats.low_confidence).toBe(1);
      expect(stats.with_goal_path).toBe(2);
    });
  });
});
