/**
 * Unit tests for insights aggregator
 *
 * Tests the mapping from CEE analysis results (robustness, bias, domain completeness)
 * to unified insights for the Results Panel.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateInsights,
  type InsightsContext,
} from "../../src/services/review/insights.js";

describe("aggregateInsights", () => {
  describe("fragile assumptions", () => {
    it("maps fragile assumptions from robustness synthesis", () => {
      const context: InsightsContext = {
        assumptionExplanations: [
          {
            edge_id: "edge_1",
            explanation: "The price elasticity assumption is fragile",
            severity: "fragile",
          },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(1);
      expect(insights[0]).toEqual({
        type: "fragile_assumption",
        content: "The price elasticity assumption is fragile",
        severity: "high",
      });
    });

    it("maps moderate assumptions with medium severity", () => {
      const context: InsightsContext = {
        assumptionExplanations: [
          {
            edge_id: "edge_1",
            explanation: "Moderate assumption about market size",
            severity: "moderate",
          },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights[0].severity).toBe("medium");
    });

    it("maps robust assumptions with low severity", () => {
      const context: InsightsContext = {
        assumptionExplanations: [
          {
            edge_id: "edge_1",
            explanation: "Robust assumption based on historical data",
            severity: "robust",
          },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights[0].severity).toBe("low");
    });
  });

  describe("potential biases", () => {
    it("maps high severity bias findings", () => {
      const context: InsightsContext = {
        biasFindings: [
          {
            id: "confirmation_bias",
            category: "other",
            severity: "high",
            explanation: "Evidence appears to confirm pre-existing beliefs",
          },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(1);
      expect(insights[0]).toEqual({
        type: "potential_bias",
        content: "Evidence appears to confirm pre-existing beliefs",
        severity: "high",
      });
    });

    it("maps medium severity bias findings", () => {
      const context: InsightsContext = {
        biasFindings: [
          {
            id: "anchoring_bias",
            category: "other",
            severity: "medium",
            explanation: "Initial estimates may be anchoring subsequent judgments",
          },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights[0].type).toBe("potential_bias");
      expect(insights[0].severity).toBe("medium");
    });

    it("filters out low severity bias findings", () => {
      const context: InsightsContext = {
        biasFindings: [
          {
            id: "availability_bias",
            category: "other",
            severity: "low",
            explanation: "Minor availability bias detected",
          },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(0);
    });

    it("limits bias insights to max 2", () => {
      const context: InsightsContext = {
        biasFindings: [
          { id: "confirmation_bias", category: "other", severity: "high", explanation: "Bias 1" },
          { id: "anchoring_bias", category: "other", severity: "high", explanation: "Bias 2" },
          { id: "framing_bias", category: "other", severity: "high", explanation: "Bias 3" },
        ],
      };

      const insights = aggregateInsights(context);
      const biasInsights = insights.filter((i) => i.type === "potential_bias");

      expect(biasInsights).toHaveLength(2);
    });

    it("skips bias findings without explanation", () => {
      const context: InsightsContext = {
        biasFindings: [
          { id: "confirmation_bias", category: "other", severity: "high" }, // No explanation
          { id: "anchoring_bias", category: "other", severity: "high", explanation: "Has explanation" },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(1);
      expect(insights[0].content).toBe("Has explanation");
    });
  });

  describe("information gaps", () => {
    it("maps critical missing domain factors", () => {
      const context: InsightsContext = {
        domainCompleteness: {
          detected_domain: "pricing",
          detection_confidence: 0.8,
          factors_found: ["cost"],
          completeness_score: 60,
          summary: "Pricing domain completeness assessment",
          missing_factors: [
            {
              name: "competitor pricing",
              importance: "critical",
              rationale: "Essential for market positioning",
              suggestion: "Add a factor node for competitor pricing and connect it to relevant options/outcomes.",
            },
          ],
        },
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(1);
      expect(insights[0]).toEqual({
        type: "information_gap",
        content: "Missing factor: competitor pricing — Essential for market positioning",
        severity: "medium",
      });
    });

    it("ignores non-critical missing factors", () => {
      const context: InsightsContext = {
        domainCompleteness: {
          detected_domain: "pricing",
          detection_confidence: 0.8,
          factors_found: [],
          completeness_score: 80,
          summary: "Pricing domain completeness assessment",
          missing_factors: [
            {
              name: "brand perception",
              importance: "recommended",
              rationale: "Would improve analysis",
              suggestion: "Add a factor node for brand perception and connect it to outcomes.",
            },
          ],
        },
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(0);
    });

    it("adds weak evidence coverage insight when mostly weak evidence", () => {
      const context: InsightsContext = {
        evidenceQuality: {
          strong: 1,
          moderate: 1,
          weak: 3,
          none: 2,
          summary: "Mostly weak or missing evidence",
        },
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(1);
      expect(insights[0]).toEqual({
        type: "information_gap",
        content: "Most relationships lack strong evidence backing",
        severity: "low",
      });
    });

    it("does not add weak evidence insight when strong/moderate evidence dominates", () => {
      const context: InsightsContext = {
        evidenceQuality: {
          strong: 3,
          moderate: 2,
          weak: 1,
          none: 1,
          summary: "Evidence is mostly strong/moderate",
        },
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(0);
    });
  });

  describe("prioritization", () => {
    it("prioritizes high severity insights first", () => {
      const context: InsightsContext = {
        assumptionExplanations: [
          { edge_id: "e1", explanation: "Robust assumption", severity: "robust" },
          { edge_id: "e2", explanation: "Fragile assumption", severity: "fragile" },
        ],
      };

      const insights = aggregateInsights(context);

      expect(insights[0].severity).toBe("high");
      expect(insights[0].content).toBe("Fragile assumption");
    });

    it("prioritizes by type within same severity", () => {
      const context: InsightsContext = {
        assumptionExplanations: [
          { edge_id: "e1", explanation: "Fragile assumption", severity: "fragile" },
        ],
        biasFindings: [
          { id: "confirmation_bias", category: "other", severity: "high", explanation: "Bias finding" },
        ],
      };

      const insights = aggregateInsights(context);

      // Both are high severity, but fragile_assumption comes before potential_bias
      expect(insights[0].type).toBe("fragile_assumption");
      expect(insights[1].type).toBe("potential_bias");
    });

    it("limits total insights to 5", () => {
      const context: InsightsContext = {
        assumptionExplanations: [
          { edge_id: "e1", explanation: "Assumption 1", severity: "fragile" },
          { edge_id: "e2", explanation: "Assumption 2", severity: "fragile" },
          { edge_id: "e3", explanation: "Assumption 3", severity: "fragile" },
        ],
        biasFindings: [
          { id: "bias1", category: "other", severity: "high", explanation: "Bias 1" },
          { id: "bias2", category: "other", severity: "high", explanation: "Bias 2" },
        ],
        domainCompleteness: {
          detected_domain: "general",
          detection_confidence: 0.5,
          factors_found: [],
          completeness_score: 50,
          summary: "Domain completeness assessment",
          missing_factors: [
            { name: "factor1", importance: "critical", rationale: "Missing 1", suggestion: "Add factor1" },
            { name: "factor2", importance: "critical", rationale: "Missing 2", suggestion: "Add factor2" },
          ],
        },
      };

      const insights = aggregateInsights(context);

      expect(insights).toHaveLength(5);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when no context provided", () => {
      const insights = aggregateInsights({});

      expect(insights).toEqual([]);
    });

    it("returns empty array when all arrays are empty", () => {
      const context: InsightsContext = {
        assumptionExplanations: [],
        biasFindings: [],
        domainCompleteness: undefined,
        evidenceQuality: undefined,
      };

      const insights = aggregateInsights(context);

      expect(insights).toEqual([]);
    });

    it("handles undefined individual fields gracefully", () => {
      const context: InsightsContext = {
        assumptionExplanations: undefined,
        biasFindings: undefined,
      };

      const insights = aggregateInsights(context);

      expect(insights).toEqual([]);
    });
  });
});
