/**
 * Price Extraction Regression Tests
 *
 * Tests for the P0 pricing brief scenario:
 * "Should we increase Pro plan price from £49 to £59?"
 *
 * Root cause: LLM sometimes omits factor_price node, causing needs_user_mapping status.
 * Fix: Strengthen prompt + retry detection when price-related targets are unresolved.
 */

import { describe, it, expect } from "vitest";
import {
  extractRawInterventions,
  extractInterventionsForOption,
  hasPriceRelatedUnresolvedTargets,
  generatePriceFactorHint,
  type ExtractedOption,
} from "../../src/cee/extraction/intervention-extractor.js";
import { matchInterventionToFactor } from "../../src/cee/extraction/factor-matcher.js";
import type { NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";

// ============================================================================
// Test Fixtures
// ============================================================================

function createFactorNode(id: string, label: string): NodeV3T {
  return { id, kind: "factor", label };
}

function createGoalNode(id: string, label: string): NodeV3T {
  return { id, kind: "goal", label };
}

function createEdge(from: string, to: string): EdgeV3T {
  return {
    from,
    to,
    strength: { mean: 0.7, std: 0.1 },
    exists_probability: 0.8,
    effect_direction: "positive",
  };
}

// ============================================================================
// Pricing Option Extraction Tests
// ============================================================================

describe("CEE Price Extraction - Raw Intervention Extraction", () => {
  describe("Pricing option patterns", () => {
    it("should extract 'Price at £49' as target=Price, value=49", () => {
      const raw = extractRawInterventions("Price at £49");

      expect(raw.length).toBeGreaterThan(0);
      expect(raw[0].target_text.toLowerCase()).toBe("price");
      expect(raw[0].value?.value).toBe(49);
    });

    it("should extract 'Price at £59' as target=Price, value=59", () => {
      const raw = extractRawInterventions("Price at £59");

      expect(raw.length).toBeGreaterThan(0);
      expect(raw[0].target_text.toLowerCase()).toBe("price");
      expect(raw[0].value?.value).toBe(59);
    });

    it("should extract 'Set price to £49' as target=price, value=49", () => {
      const raw = extractRawInterventions("Set price to £49");

      expect(raw.length).toBeGreaterThan(0);
      expect(raw[0].target_text.toLowerCase()).toBe("price");
      expect(raw[0].value?.value).toBe(49);
    });

    it("should extract 'Set price to £59' as target=price, value=59", () => {
      const raw = extractRawInterventions("Set price to £59");

      expect(raw.length).toBeGreaterThan(0);
      expect(raw[0].target_text.toLowerCase()).toBe("price");
      expect(raw[0].value?.value).toBe(59);
    });

    it("should extract various currency symbols", () => {
      const dollarRaw = extractRawInterventions("Price at $49");
      const euroRaw = extractRawInterventions("Price at €49");

      expect(dollarRaw[0].value?.value).toBe(49);
      expect(euroRaw[0].value?.value).toBe(49);
    });
  });
});

// ============================================================================
// Factor Matching Tests
// ============================================================================

describe("CEE Price Extraction - Factor Matching", () => {
  const testNodes: NodeV3T[] = [
    createGoalNode("goal_mrr", "MRR"),
    createFactorNode("factor_price", "Price"),
    createFactorNode("factor_churn", "Customer Churn"),
  ];

  const testEdges: EdgeV3T[] = [
    createEdge("factor_price", "goal_mrr"),
    createEdge("factor_churn", "goal_mrr"),
  ];

  describe("Exact matching", () => {
    it("should match 'price' to factor_price with exact_id", () => {
      const result = matchInterventionToFactor("price", testNodes, testEdges, "goal_mrr");

      expect(result.matched).toBe(true);
      expect(result.node_id).toBe("factor_price");
      expect(result.match_type).toBe("exact_id");
      expect(result.confidence).toBe("high");
    });

    it("should match 'Price' (capitalized) to factor_price", () => {
      const result = matchInterventionToFactor("Price", testNodes, testEdges, "goal_mrr");

      expect(result.matched).toBe(true);
      expect(result.node_id).toBe("factor_price");
    });
  });

  describe("Semantic matching via synonyms", () => {
    it("should match 'cost' to factor_price via synonym", () => {
      const result = matchInterventionToFactor("cost", testNodes, testEdges, "goal_mrr");

      expect(result.matched).toBe(true);
      expect(result.node_id).toBe("factor_price");
      expect(result.match_type).toBe("semantic");
    });

    it("should match 'pricing' to factor_price via synonym", () => {
      const result = matchInterventionToFactor("pricing", testNodes, testEdges, "goal_mrr");

      expect(result.matched).toBe(true);
      expect(result.node_id).toBe("factor_price");
    });

    it("should match 'subscription price' to factor_price", () => {
      const result = matchInterventionToFactor("subscription price", testNodes, testEdges, "goal_mrr");

      expect(result.matched).toBe(true);
      expect(result.node_id).toBe("factor_price");
    });
  });
});

// ============================================================================
// Full Intervention Extraction Tests
// ============================================================================

describe("CEE Price Extraction - Full Option Extraction", () => {
  describe("With factor_price node present (happy path)", () => {
    const nodesWithPrice: NodeV3T[] = [
      createGoalNode("goal_mrr", "MRR"),
      createFactorNode("factor_price", "Price"),
    ];

    const edges: EdgeV3T[] = [createEdge("factor_price", "goal_mrr")];

    it("should produce status='ready' for 'Price at £49'", () => {
      const result = extractInterventionsForOption(
        "Price at £49",
        undefined,
        nodesWithPrice,
        edges,
        "goal_mrr"
      );

      expect(result.status).toBe("ready");
      expect(Object.keys(result.interventions).length).toBe(1);
      expect(result.interventions["factor_price"]?.value).toBe(49);
    });

    it("should produce status='ready' for 'Price at £59'", () => {
      const result = extractInterventionsForOption(
        "Price at £59",
        undefined,
        nodesWithPrice,
        edges,
        "goal_mrr"
      );

      expect(result.status).toBe("ready");
      expect(result.interventions["factor_price"]?.value).toBe(59);
    });

    it("should produce status='ready' for 'Set price to £59'", () => {
      const result = extractInterventionsForOption(
        "Set price to £59",
        undefined,
        nodesWithPrice,
        edges,
        "goal_mrr"
      );

      expect(result.status).toBe("ready");
      expect(result.interventions["factor_price"]?.value).toBe(59);
    });
  });

  describe("WITHOUT factor_price node (root cause scenario)", () => {
    const nodesWithoutPrice: NodeV3T[] = [
      createGoalNode("goal_mrr", "MRR"),
      createFactorNode("factor_churn", "Customer Churn"),
    ];

    const edges: EdgeV3T[] = [createEdge("factor_churn", "goal_mrr")];

    it("should produce status='needs_user_mapping' for 'Price at £49'", () => {
      const result = extractInterventionsForOption(
        "Price at £49",
        undefined,
        nodesWithoutPrice,
        edges,
        "goal_mrr"
      );

      expect(result.status).toBe("needs_user_mapping");
      expect(Object.keys(result.interventions).length).toBe(0);
      expect(result.unresolved_targets).toContain("Price");
    });

    it("should produce user_questions asking for factor mapping", () => {
      const result = extractInterventionsForOption(
        "Price at £59",
        undefined,
        nodesWithoutPrice,
        edges,
        "goal_mrr"
      );

      expect(result.user_questions).toBeDefined();
      expect(result.user_questions!.length).toBeGreaterThan(0);
      expect(result.user_questions!.some((q) => q.includes("Price"))).toBe(true);
    });
  });
});

// ============================================================================
// Price-Related Unresolved Target Detection Tests
// ============================================================================

describe("CEE Price Extraction - Retry Detection", () => {
  describe("hasPriceRelatedUnresolvedTargets", () => {
    it("should detect 'Price' as price-related", () => {
      const options: ExtractedOption[] = [
        {
          id: "opt1",
          label: "Option 1",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["Price"],
        },
      ];

      const result = hasPriceRelatedUnresolvedTargets(options);

      expect(result.detected).toBe(true);
      expect(result.terms).toContain("Price");
    });

    it("should detect 'cost' as price-related", () => {
      const options: ExtractedOption[] = [
        {
          id: "opt1",
          label: "Option 1",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["cost"],
        },
      ];

      const result = hasPriceRelatedUnresolvedTargets(options);

      expect(result.detected).toBe(true);
      expect(result.terms).toContain("cost");
    });

    it("should detect 'subscription price' as price-related", () => {
      const options: ExtractedOption[] = [
        {
          id: "opt1",
          label: "Option 1",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["subscription price"],
        },
      ];

      const result = hasPriceRelatedUnresolvedTargets(options);

      expect(result.detected).toBe(true);
    });

    it("should NOT detect unrelated terms", () => {
      const options: ExtractedOption[] = [
        {
          id: "opt1",
          label: "Option 1",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["team size", "location"],
        },
      ];

      const result = hasPriceRelatedUnresolvedTargets(options);

      expect(result.detected).toBe(false);
      expect(result.terms).toHaveLength(0);
    });

    it("should return empty when no unresolved targets", () => {
      const options: ExtractedOption[] = [
        {
          id: "opt1",
          label: "Option 1",
          status: "ready",
          interventions: { factor_price: { value: 49, source: "brief_extraction", target_match: { node_id: "factor_price", match_type: "exact_id", confidence: "high" } } },
        },
      ];

      const result = hasPriceRelatedUnresolvedTargets(options);

      expect(result.detected).toBe(false);
    });

    it("should deduplicate terms across multiple options", () => {
      const options: ExtractedOption[] = [
        {
          id: "opt1",
          label: "Option 1",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["Price"],
        },
        {
          id: "opt2",
          label: "Option 2",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["Price"],
        },
      ];

      const result = hasPriceRelatedUnresolvedTargets(options);

      expect(result.detected).toBe(true);
      expect(result.terms).toHaveLength(1); // Deduplicated
      expect(result.terms[0]).toBe("Price");
    });
  });

  describe("generatePriceFactorHint", () => {
    it("should generate hint for single term", () => {
      const hint = generatePriceFactorHint(["Price"]);

      expect(hint).toContain("Price");
      expect(hint).toContain("factor node");
      expect(hint).toContain("MUST create");
    });

    it("should generate hint for multiple terms", () => {
      const hint = generatePriceFactorHint(["Price", "subscription"]);

      expect(hint).toContain("Price");
      expect(hint).toContain("subscription");
    });
  });
});

// ============================================================================
// Regression: Complete Pricing Scenario
// ============================================================================

describe("CEE Price Extraction - Pricing Scenario Regression", () => {
  describe("Scenario: 'Should we increase Pro plan price from £49 to £59?'", () => {
    it("should extract both options with ready status when factor_price exists", () => {
      // Setup: Graph with price factor
      const graphWithPriceFactor: NodeV3T[] = [
        createGoalNode("goal_mrr", "MRR Growth"),
        createFactorNode("factor_price", "Pro Plan Price"),
        createFactorNode("factor_churn", "Churn Rate"),
      ];

      const edges: EdgeV3T[] = [
        createEdge("factor_price", "goal_mrr"),
        createEdge("factor_churn", "goal_mrr"),
      ];

      // Use option labels that match the extraction patterns
      const opt49 = extractInterventionsForOption(
        "Price at £49",
        undefined,
        graphWithPriceFactor,
        edges,
        "goal_mrr"
      );

      const opt59 = extractInterventionsForOption(
        "Set price to £59",
        undefined,
        graphWithPriceFactor,
        edges,
        "goal_mrr"
      );

      // Both options should be ready
      expect(opt49.status).toBe("ready");
      expect(opt59.status).toBe("ready");

      // Both should have factor_price intervention
      expect(opt49.interventions["factor_price"]?.value).toBe(49);
      expect(opt59.interventions["factor_price"]?.value).toBe(59);
    });

    it("should produce needs_user_mapping with questions when factor_price is missing", () => {
      // Setup: Graph WITHOUT price factor (simulates LLM omission)
      const graphWithoutPriceFactor: NodeV3T[] = [
        createGoalNode("goal_mrr", "MRR Growth"),
        createFactorNode("factor_churn", "Churn Rate"),
      ];

      // Use option labels that match the extraction patterns
      const opt49 = extractInterventionsForOption(
        "Price at £49",
        undefined,
        graphWithoutPriceFactor,
        [],
        "goal_mrr"
      );

      const opt59 = extractInterventionsForOption(
        "Set price to £59",
        undefined,
        graphWithoutPriceFactor,
        [],
        "goal_mrr"
      );

      // Both should be needs_user_mapping
      expect(opt49.status).toBe("needs_user_mapping");
      expect(opt59.status).toBe("needs_user_mapping");

      // Should have user questions (fallback when factor not matched)
      expect(opt49.user_questions).toBeDefined();
      expect(opt49.user_questions!.length).toBeGreaterThan(0);
    });

    it("should detect price-related unresolved targets for retry logic", () => {
      // Test hasPriceRelatedUnresolvedTargets with explicit mock data
      const optionsWithPriceUnresolved: ExtractedOption[] = [
        {
          id: "opt_49",
          label: "Price at £49",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["Price"],
        },
        {
          id: "opt_59",
          label: "Set price to £59",
          status: "needs_user_mapping",
          interventions: {},
          unresolved_targets: ["price"],
        },
      ];

      const priceCheck = hasPriceRelatedUnresolvedTargets(optionsWithPriceUnresolved);

      expect(priceCheck.detected).toBe(true);
      expect(priceCheck.terms.length).toBeGreaterThan(0);
    });
  });
});
