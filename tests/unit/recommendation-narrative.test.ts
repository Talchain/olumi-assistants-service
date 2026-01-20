/**
 * Unit tests for recommendation narrative templates
 *
 * Tests template-based generation of recommendation narratives
 * with contextualised headlines and "why" explanations.
 */

import { describe, it, expect } from "vitest";
import {
  generateRecommendation,
} from "../../src/cee/recommendation-narrative/index.js";
import {
  extractGoalContext,
  generateWhyExplanation,
} from "../../src/cee/recommendation-narrative/templates.js";
import type { RankedAction } from "../../src/cee/recommendation-narrative/types.js";

describe("extractGoalContext", () => {
  it("returns goal_label when provided (sanitised)", () => {
    const result = extractGoalContext("some brief", "Maximize Revenue");
    // sanitiseLabel converts to lowercase
    expect(result?.toLowerCase()).toBe("maximize revenue");
  });

  it("extracts goal from 'to achieve X' pattern", () => {
    const result = extractGoalContext(
      "We need to decide on pricing to achieve maximum quarterly revenue",
      undefined
    );
    expect(result?.toLowerCase()).toBe("maximum quarterly revenue");
  });

  it("extracts goal from 'to maximize X' pattern", () => {
    const result = extractGoalContext(
      "Deciding strategy to maximize customer satisfaction",
      undefined
    );
    expect(result?.toLowerCase()).toBe("customer satisfaction");
  });

  it("extracts goal from 'goal is X' pattern", () => {
    const result = extractGoalContext(
      "Our goal is reducing costs by 20%",
      undefined
    );
    expect(result?.toLowerCase()).toContain("costs by 20%");
  });

  it("extracts goal from 'objective is X' pattern", () => {
    const result = extractGoalContext(
      "The objective is improving team productivity",
      undefined
    );
    expect(result?.toLowerCase()).toContain("improving team productivity");
  });

  it("extracts goal from 'for X' pattern", () => {
    const result = extractGoalContext(
      "Choosing a vendor for better service quality",
      undefined
    );
    expect(result).toBe("better service quality");
  });

  it("truncates long goal context", () => {
    const result = extractGoalContext(
      "To achieve maximum revenue growth across all product lines in the enterprise segment while maintaining quality",
      undefined
    );
    expect(result?.length).toBeLessThanOrEqual(50);
    expect(result).toContain("...");
  });

  it("returns undefined when no goal pattern found", () => {
    const result = extractGoalContext(
      "This is a random decision brief without clear goal markers",
      undefined
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty brief", () => {
    const result = extractGoalContext("", undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined for undefined brief", () => {
    const result = extractGoalContext(undefined, undefined);
    expect(result).toBeUndefined();
  });
});

describe("generateWhyExplanation", () => {
  const winner: RankedAction = {
    node_id: "opt1",
    label: "Premium Pricing",
    score: 85,
    rank: 1,
  };

  it("generates why with driver and goal", () => {
    const drivers = [
      { id: "d1", label: "Market Size", impact_pct: 65, direction: "positive" as const },
    ];
    const result = generateWhyExplanation(winner, drivers, "Maximize Revenue");

    // Labels are sanitised to lowercase
    expect(result?.toLowerCase()).toContain("premium pricing");
    expect(result?.toLowerCase()).toContain("market size");
    expect(result).toContain("65%");
    expect(result?.toLowerCase()).toContain("maximize revenue");
  });

  it("generates why with driver without goal", () => {
    const drivers = [
      { id: "d1", label: "Customer Demand", impact_pct: 45 },
    ];
    const result = generateWhyExplanation(winner, drivers, undefined);

    // Labels are sanitised to lowercase
    expect(result?.toLowerCase()).toContain("premium pricing");
    expect(result?.toLowerCase()).toContain("customer demand");
    expect(result).toContain("45%");
    expect(result).toContain("most influential factor");
  });

  it("returns undefined when no drivers", () => {
    const result = generateWhyExplanation(winner, [], undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined when drivers is undefined", () => {
    const result = generateWhyExplanation(winner, undefined, undefined);
    expect(result).toBeUndefined();
  });

  it("handles negative direction", () => {
    const drivers = [
      { id: "d1", label: "Implementation Risk", impact_pct: 30, direction: "negative" as const },
    ];
    const result = generateWhyExplanation(winner, drivers, undefined);

    expect(result).toContain("significantly affects");
  });
});

describe("generateRecommendation", () => {
  describe("headline generation with context", () => {
    it("includes goal context in headline", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Raise Prices", score: 85, rank: 1 },
          { node_id: "o2", label: "Lower Prices", score: 60, rank: 2 },
        ],
        goal_label: "maximizing Q4 revenue",
      });

      // Labels are sanitised to lowercase
      expect(result.headline.toLowerCase()).toContain("raise prices");
      expect(result.headline.toLowerCase()).toContain("maximizing q4 revenue");
    });

    it("extracts goal context from brief", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1 },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
        ],
        brief: "We need to decide on strategy to achieve better customer retention",
      });

      expect(result.headline.toLowerCase()).toContain("customer retention");
    });

    it("includes confidence level in headline", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 90, rank: 1 },
          { node_id: "o2", label: "Option B", score: 50, rank: 2 },
        ],
      });

      expect(result.headline).toContain("high confidence");
    });

    it("handles formal tone", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1 },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
        ],
        tone: "formal",
      });

      expect(result.headline).toContain("recommended");
    });

    it("handles conversational tone", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1 },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
        ],
        tone: "conversational",
      });

      expect(result.headline).toContain("best bet");
    });
  });

  describe("why generation with drivers", () => {
    it("generates why explanation with drivers", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Premium Pricing", score: 85, rank: 1 },
          { node_id: "o2", label: "Economy Pricing", score: 60, rank: 2 },
        ],
        goal_label: "Maximize Revenue",
        drivers: [
          { id: "d1", label: "Market Size", impact_pct: 65, direction: "positive" },
        ],
      });

      expect(result.why).toBeDefined();
      // Labels are sanitised to lowercase
      expect(result.why?.toLowerCase()).toContain("premium pricing");
      expect(result.why?.toLowerCase()).toContain("market size");
      expect(result.why).toContain("65%");
    });

    it("returns undefined why when no drivers", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1 },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
        ],
      });

      expect(result.why).toBeUndefined();
    });
  });

  describe("complete output structure", () => {
    it("returns all required fields", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1 },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
        ],
      });

      expect(result.headline).toBeDefined();
      expect(result.recommendation_narrative).toBeDefined();
      expect(result.confidence_statement).toBeDefined();
      expect(result.provenance).toBe("cee");
    });

    it("includes alternatives_summary for multiple options", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1 },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
          { node_id: "o3", label: "Option C", score: 55, rank: 3 },
        ],
      });

      expect(result.alternatives_summary).toBeDefined();
      // Labels are sanitised to lowercase
      expect(result.alternatives_summary?.toLowerCase()).toContain("option b");
      expect(result.alternatives_summary?.toLowerCase()).toContain("option c");
    });

    it("includes caveat for close scores", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 55, rank: 1 },
          { node_id: "o2", label: "Option B", score: 53, rank: 2 },
        ],
      });

      expect(result.caveat).toBeDefined();
      // Labels are sanitised to lowercase
      expect(result.caveat?.toLowerCase()).toContain("option b");
    });
  });

  describe("baseline option handling", () => {
    it("reframes 'do nothing' option", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Do nothing", score: 85, rank: 1 },
          { node_id: "o2", label: "Take action", score: 60, rank: 2 },
        ],
      });

      expect(result.headline).toContain("current state");
    });

    it("reframes 'status quo' option", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Status quo", score: 85, rank: 1 },
          { node_id: "o2", label: "New strategy", score: 60, rank: 2 },
        ],
      });

      expect(result.headline).not.toContain("Status quo");
    });
  });

  describe("outcome quality handling", () => {
    it("uses cautious headline for negative outcomes", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1, outcome_quality: "negative" },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
        ],
      });

      // Should use risk/impact language for negative outcomes
      expect(
        result.headline.toLowerCase().includes("risk") ||
        result.headline.toLowerCase().includes("impact") ||
        result.headline.toLowerCase().includes("minimises")
      ).toBe(true);
    });

    it("uses cautious headline for mixed outcomes", () => {
      const result = generateRecommendation({
        ranked_actions: [
          { node_id: "o1", label: "Option A", score: 85, rank: 1, outcome_quality: "mixed" },
          { node_id: "o2", label: "Option B", score: 60, rank: 2 },
        ],
      });

      expect(result.headline.toLowerCase()).toContain("less predictable");
    });
  });
});
