/**
 * Tests for enrich-factors prompt and service
 */

import { describe, it, expect } from "vitest";
import {
  EnrichFactorsInput,
  EnrichFactorsOutput,
  FactorEnrichment,
  validateConfidenceQuestionRank,
  filterByRank,
  type FactorEnrichmentT,
} from "../../src/schemas/enrichment.js";
import {
  ENRICH_FACTORS_PROMPT,
  FACTOR_TYPE_GUIDANCE,
  MAX_ENRICHMENT_RANK,
  CONFIDENCE_QUESTION_MAX_RANK,
} from "../../src/prompts/enrich-factors.js";
import {
  buildEnrichFactorsInput,
  extractGoalLabel,
  extractOutcomeLabels,
  extractRiskLabels,
  extractControllableFactors,
} from "../../src/services/review/enrichFactors.js";
import type { GraphT } from "../../src/schemas/graph.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function makeTestGraph(): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_pricing", kind: "decision", label: "Pricing Decision" },
      {
        id: "opt_increase",
        kind: "option",
        label: "Increase Price",
        data: { interventions: { fac_price: 59 } },
      },
      {
        id: "opt_maintain",
        kind: "option",
        label: "Maintain Price",
        data: { interventions: { fac_price: 49 } },
      },
      {
        id: "fac_price",
        kind: "factor",
        label: "Pro Plan Price",
        data: {
          value: 49,
          extractionType: "explicit",
          factor_type: "price",
          uncertainty_drivers: ["Competitor response unknown", "Customer elasticity unvalidated"],
        },
      },
      {
        id: "fac_dev_time",
        kind: "factor",
        label: "Development Time",
        data: {
          value: 4,
          extractionType: "inferred",
          factor_type: "time",
          uncertainty_drivers: ["Team capacity uncertain"],
        },
      },
      { id: "fac_market", kind: "factor", label: "Market Conditions" }, // uncontrollable - no data
      { id: "out_revenue", kind: "outcome", label: "Monthly Recurring Revenue" },
      { id: "out_retention", kind: "outcome", label: "Customer Retention" },
      { id: "risk_churn", kind: "risk", label: "Customer Churn" },
      { id: "goal_growth", kind: "goal", label: "Reach £20k MRR with Churn Under 4%" },
    ],
    edges: [
      { from: "dec_pricing", to: "opt_increase", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "dec_pricing", to: "opt_maintain", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "opt_increase", to: "fac_price", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "opt_increase", to: "fac_dev_time", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "opt_maintain", to: "fac_price", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "opt_maintain", to: "fac_dev_time", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "fac_price", to: "out_revenue", strength: { mean: 0.8, std: 0.15 }, exists_probability: 0.95, effect_direction: "positive" },
      { from: "fac_price", to: "risk_churn", strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.8, effect_direction: "positive" },
      { from: "fac_dev_time", to: "out_retention", strength: { mean: 0.6, std: 0.2 }, exists_probability: 0.85, effect_direction: "positive" },
      { from: "out_revenue", to: "goal_growth", strength: { mean: 0.9, std: 0.1 }, exists_probability: 0.95, effect_direction: "positive" },
      { from: "out_retention", to: "goal_growth", strength: { mean: 0.4, std: 0.15 }, exists_probability: 0.8, effect_direction: "positive" },
      { from: "risk_churn", to: "goal_growth", strength: { mean: -0.7, std: 0.15 }, exists_probability: 0.9, effect_direction: "negative" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function makeFactorSensitivity() {
  return [
    { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
    { factor_id: "fac_dev_time", elasticity: 0.35, rank: 4 },
  ];
}

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("Enrichment schemas", () => {
  describe("EnrichFactorsInput", () => {
    it("validates valid input", () => {
      const input = {
        goal_label: "Reach £20k MRR",
        outcome_labels: ["Revenue Growth"],
        controllable_factors: [
          { factor_id: "fac_price", label: "Price", factor_type: "price" },
        ],
        factor_sensitivity: [
          { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
        ],
      };

      const result = EnrichFactorsInput.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("requires goal_label", () => {
      const input = {
        outcome_labels: ["Revenue Growth"],
        controllable_factors: [],
        factor_sensitivity: [],
      };

      const result = EnrichFactorsInput.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts optional risk_labels", () => {
      const input = {
        goal_label: "Growth",
        outcome_labels: ["Revenue"],
        risk_labels: ["Churn"],
        controllable_factors: [],
        factor_sensitivity: [],
      };

      const result = EnrichFactorsInput.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("FactorEnrichment", () => {
    it("validates valid enrichment", () => {
      const enrichment = {
        factor_id: "fac_price",
        sensitivity_rank: 1,
        observations: ["Top driver of revenue"],
        perspectives: ["Competitor pricing may inform"],
        confidence_question: "What price would change your decision?",
      };

      const result = FactorEnrichment.safeParse(enrichment);
      expect(result.success).toBe(true);
    });

    it("requires at least 1 observation", () => {
      const enrichment = {
        factor_id: "fac_price",
        sensitivity_rank: 1,
        observations: [],
        perspectives: ["One perspective"],
      };

      const result = FactorEnrichment.safeParse(enrichment);
      expect(result.success).toBe(false);
    });

    it("allows max 2 observations", () => {
      const enrichment = {
        factor_id: "fac_price",
        sensitivity_rank: 1,
        observations: ["One", "Two", "Three"],
        perspectives: ["One perspective"],
      };

      const result = FactorEnrichment.safeParse(enrichment);
      expect(result.success).toBe(false);
    });

    it("allows optional confidence_question", () => {
      const enrichment = {
        factor_id: "fac_price",
        sensitivity_rank: 5,
        observations: ["One observation"],
        perspectives: ["One perspective"],
      };

      const result = FactorEnrichment.safeParse(enrichment);
      expect(result.success).toBe(true);
      expect(result.data?.confidence_question).toBeUndefined();
    });
  });

  describe("EnrichFactorsOutput", () => {
    it("validates valid output with enrichments array", () => {
      const output = {
        enrichments: [
          {
            factor_id: "fac_price",
            sensitivity_rank: 1,
            observations: ["Top driver"],
            perspectives: ["Market research may help"],
          },
        ],
      };

      const result = EnrichFactorsOutput.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Validation Helper Tests
// =============================================================================

describe("Validation helpers", () => {
  describe("validateConfidenceQuestionRank", () => {
    it("returns valid for enrichments without confidence_question", () => {
      const enrichments: FactorEnrichmentT[] = [
        {
          factor_id: "fac_price",
          sensitivity_rank: 5,
          observations: ["One"],
          perspectives: ["One"],
        },
      ];

      const result = validateConfidenceQuestionRank(enrichments);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("returns valid for rank <= 3 with confidence_question", () => {
      const enrichments: FactorEnrichmentT[] = [
        {
          factor_id: "fac_price",
          sensitivity_rank: 1,
          observations: ["One"],
          perspectives: ["One"],
          confidence_question: "What would change your estimate?",
        },
        {
          factor_id: "fac_time",
          sensitivity_rank: 3,
          observations: ["One"],
          perspectives: ["One"],
          confidence_question: "How confident are you?",
        },
      ];

      const result = validateConfidenceQuestionRank(enrichments);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("returns invalid for rank > 3 with confidence_question", () => {
      const enrichments: FactorEnrichmentT[] = [
        {
          factor_id: "fac_price",
          sensitivity_rank: 4,
          observations: ["One"],
          perspectives: ["One"],
          confidence_question: "Should not have this",
        },
      ];

      const result = validateConfidenceQuestionRank(enrichments);
      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("fac_price");
      expect(result.violations[0]).toContain("rank 4");
    });
  });

  describe("filterByRank", () => {
    it("filters out factors with rank > maxRank", () => {
      const enrichments: FactorEnrichmentT[] = [
        { factor_id: "fac_1", sensitivity_rank: 1, observations: ["O"], perspectives: ["P"] },
        { factor_id: "fac_5", sensitivity_rank: 5, observations: ["O"], perspectives: ["P"] },
        { factor_id: "fac_10", sensitivity_rank: 10, observations: ["O"], perspectives: ["P"] },
        { factor_id: "fac_11", sensitivity_rank: 11, observations: ["O"], perspectives: ["P"] },
        { factor_id: "fac_15", sensitivity_rank: 15, observations: ["O"], perspectives: ["P"] },
      ];

      const result = filterByRank(enrichments, 10);
      expect(result).toHaveLength(3);
      expect(result.map(e => e.factor_id)).toEqual(["fac_1", "fac_5", "fac_10"]);
    });

    it("returns all if all are within maxRank", () => {
      const enrichments: FactorEnrichmentT[] = [
        { factor_id: "fac_1", sensitivity_rank: 1, observations: ["O"], perspectives: ["P"] },
        { factor_id: "fac_2", sensitivity_rank: 2, observations: ["O"], perspectives: ["P"] },
      ];

      const result = filterByRank(enrichments, 10);
      expect(result).toHaveLength(2);
    });

    it("uses default maxRank of 10", () => {
      const enrichments: FactorEnrichmentT[] = [
        { factor_id: "fac_11", sensitivity_rank: 11, observations: ["O"], perspectives: ["P"] },
      ];

      const result = filterByRank(enrichments);
      expect(result).toHaveLength(0);
    });
  });
});

// =============================================================================
// Graph Extraction Tests
// =============================================================================

describe("Graph extraction helpers", () => {
  const graph = makeTestGraph();

  describe("extractGoalLabel", () => {
    it("extracts goal label from graph", () => {
      const label = extractGoalLabel(graph);
      expect(label).toBe("Reach £20k MRR with Churn Under 4%");
    });

    it("returns undefined for graph without goal", () => {
      const noGoalGraph = { ...graph, nodes: graph.nodes.filter(n => n.kind !== "goal") };
      const label = extractGoalLabel(noGoalGraph as GraphT);
      expect(label).toBeUndefined();
    });
  });

  describe("extractOutcomeLabels", () => {
    it("extracts all outcome labels from graph", () => {
      const labels = extractOutcomeLabels(graph);
      expect(labels).toHaveLength(2);
      expect(labels).toContain("Monthly Recurring Revenue");
      expect(labels).toContain("Customer Retention");
    });
  });

  describe("extractRiskLabels", () => {
    it("extracts all risk labels from graph", () => {
      const labels = extractRiskLabels(graph);
      expect(labels).toHaveLength(1);
      expect(labels).toContain("Customer Churn");
    });
  });

  describe("extractControllableFactors", () => {
    it("extracts controllable factors with metadata", () => {
      const factors = extractControllableFactors(graph);
      expect(factors).toHaveLength(2);

      const priceFactor = factors.find(f => f.factor_id === "fac_price");
      expect(priceFactor).toBeDefined();
      expect(priceFactor?.label).toBe("Pro Plan Price");
      expect(priceFactor?.factor_type).toBe("price");
      expect(priceFactor?.uncertainty_drivers).toHaveLength(2);

      const timeFactor = factors.find(f => f.factor_id === "fac_dev_time");
      expect(timeFactor).toBeDefined();
      expect(timeFactor?.factor_type).toBe("time");
    });

    it("excludes uncontrollable factors", () => {
      const factors = extractControllableFactors(graph);
      const marketFactor = factors.find(f => f.factor_id === "fac_market");
      expect(marketFactor).toBeUndefined();
    });
  });

  describe("buildEnrichFactorsInput", () => {
    it("builds complete input from graph and sensitivity data", () => {
      const sensitivity = makeFactorSensitivity();
      const input = buildEnrichFactorsInput(graph, sensitivity);

      expect(input.goal_label).toBe("Reach £20k MRR with Churn Under 4%");
      expect(input.outcome_labels).toHaveLength(2);
      expect(input.risk_labels).toHaveLength(1);
      expect(input.controllable_factors).toHaveLength(2);
      expect(input.factor_sensitivity).toEqual(sensitivity);
    });

    it("throws if graph has no goal", () => {
      const noGoalGraph = { ...graph, nodes: graph.nodes.filter(n => n.kind !== "goal") };
      const sensitivity = makeFactorSensitivity();

      expect(() => buildEnrichFactorsInput(noGoalGraph as GraphT, sensitivity)).toThrow(
        "Graph must have a goal node with a label"
      );
    });
  });
});

// =============================================================================
// Prompt Tests
// =============================================================================

describe("Enrich factors prompt", () => {
  it("exports the prompt constant", () => {
    expect(ENRICH_FACTORS_PROMPT).toBeDefined();
    expect(typeof ENRICH_FACTORS_PROMPT).toBe("string");
    expect(ENRICH_FACTORS_PROMPT.length).toBeGreaterThan(100);
  });

  it("contains key sections", () => {
    expect(ENRICH_FACTORS_PROMPT).toContain("<ROLE>");
    expect(ENRICH_FACTORS_PROMPT).toContain("<BANNED_PHRASES>");
    expect(ENRICH_FACTORS_PROMPT).toContain("<SENSITIVITY_LANGUAGE>");
    expect(ENRICH_FACTORS_PROMPT).toContain("<CONCISION_BY_RANK>");
    expect(ENRICH_FACTORS_PROMPT).toContain("<OUTPUT_SCHEMA>");
  });

  it("bans second-person directives", () => {
    expect(ENRICH_FACTORS_PROMPT).toContain("You should");
    expect(ENRICH_FACTORS_PROMPT).toContain("NEVER use second-person directives");
  });

  it("specifies rank constraints for confidence_question", () => {
    expect(ENRICH_FACTORS_PROMPT).toContain("rank <= 3");
    expect(ENRICH_FACTORS_PROMPT).toContain("Rank > 10");
  });

  it("uses elasticity terminology and warns against variance share", () => {
    expect(ENRICH_FACTORS_PROMPT).toContain("elasticity");
    // The prompt should warn AGAINST using "variance share"
    expect(ENRICH_FACTORS_PROMPT).toContain("DO NOT claim");
    expect(ENRICH_FACTORS_PROMPT).toContain("variance share");
  });
});

describe("Factor type guidance", () => {
  it("exports guidance for all factor types", () => {
    const expectedTypes = ["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"];

    for (const type of expectedTypes) {
      expect(FACTOR_TYPE_GUIDANCE[type]).toBeDefined();
      expect(FACTOR_TYPE_GUIDANCE[type].framing).toBeDefined();
      expect(FACTOR_TYPE_GUIDANCE[type].perspectives).toBeDefined();
      expect(FACTOR_TYPE_GUIDANCE[type].perspectives.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("has distinct framing for price vs cost", () => {
    expect(FACTOR_TYPE_GUIDANCE.price.framing).not.toBe(FACTOR_TYPE_GUIDANCE.cost.framing);
    expect(FACTOR_TYPE_GUIDANCE.price.framing).toContain("pricing");
    expect(FACTOR_TYPE_GUIDANCE.cost.framing).toContain("expense");
  });
});

describe("Prompt constants", () => {
  it("exports MAX_ENRICHMENT_RANK as 10", () => {
    expect(MAX_ENRICHMENT_RANK).toBe(10);
  });

  it("exports CONFIDENCE_QUESTION_MAX_RANK as 3", () => {
    expect(CONFIDENCE_QUESTION_MAX_RANK).toBe(3);
  });
});

// =============================================================================
// New tests for hardening improvements
// =============================================================================

import {
  formatElasticity,
  filterMismatchedSensitivity,
} from "../../src/services/review/enrichFactors.js";

describe("formatElasticity", () => {
  it("rounds to 2 decimal places", () => {
    expect(formatElasticity(0.6234567)).toBe("0.62");
    expect(formatElasticity(0.726)).toBe("0.73");
    expect(formatElasticity(1.999)).toBe("2.00");
  });

  it("returns null for undefined", () => {
    expect(formatElasticity(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(formatElasticity(null)).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(formatElasticity(NaN)).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(formatElasticity(Infinity)).toBeNull();
    expect(formatElasticity(-Infinity)).toBeNull();
  });

  it("handles zero", () => {
    expect(formatElasticity(0)).toBe("0.00");
  });

  it("handles negative values", () => {
    expect(formatElasticity(-0.5)).toBe("-0.50");
    expect(formatElasticity(-1.234)).toBe("-1.23");
  });

  it("handles small decimals", () => {
    expect(formatElasticity(0.001)).toBe("0.00");
    expect(formatElasticity(0.009)).toBe("0.01");
  });

  it("handles large values", () => {
    expect(formatElasticity(123.456)).toBe("123.46");
  });
});

describe("filterMismatchedSensitivity", () => {
  const controllableIds = new Set(["fac_price", "fac_time", "fac_cost"]);

  it("keeps matching factor IDs", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
      { factor_id: "fac_time", elasticity: 0.35, rank: 2 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(valid).toHaveLength(2);
    expect(dropped).toHaveLength(0);
    expect(valid.map(s => s.factor_id)).toEqual(["fac_price", "fac_time"]);
  });

  it("drops factor IDs not in controllable set", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
      { factor_id: "fac_unknown", elasticity: 0.35, rank: 2 },
      { factor_id: "fac_missing", elasticity: 0.10, rank: 3 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(valid).toHaveLength(1);
    expect(dropped).toHaveLength(2);
    expect(dropped).toContain("fac_unknown");
    expect(dropped).toContain("fac_missing");
  });

  it("drops factors with NaN elasticity", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: NaN, rank: 1 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(1);
    expect(dropped).toContain("fac_price");
  });

  it("drops factors with Infinity elasticity", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: Infinity, rank: 1 },
      { factor_id: "fac_time", elasticity: -Infinity, rank: 2 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(2);
  });

  it("rounds elasticity values to 2 decimal places", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72345, rank: 1 },
      { factor_id: "fac_time", elasticity: 0.35999, rank: 2 },
    ];

    const { valid } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(valid[0].elasticity).toBe(0.72);
    expect(valid[1].elasticity).toBe(0.36);
  });

  it("handles empty input", () => {
    const { valid, dropped } = filterMismatchedSensitivity([], controllableIds);

    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(0);
  });

  it("handles empty controllable set", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, new Set());

    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it("drops factors with rank > default maxRank (10)", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
      { factor_id: "fac_time", elasticity: 0.35, rank: 10 },
      { factor_id: "fac_cost", elasticity: 0.20, rank: 11 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(valid).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped).toContain("fac_cost");
    expect(valid.map(s => s.factor_id)).toEqual(["fac_price", "fac_time"]);
  });

  it("respects custom maxRank parameter", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
      { factor_id: "fac_time", elasticity: 0.35, rank: 5 },
      { factor_id: "fac_cost", elasticity: 0.20, rank: 6 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, controllableIds, 5);

    expect(valid).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped).toContain("fac_cost");
  });

  it("drops all factors when maxRank is 0", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
    ];

    const { valid, dropped } = filterMismatchedSensitivity(sensitivity, controllableIds, 0);

    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it("returns reason counts breakdown", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 }, // valid
      { factor_id: "fac_unknown", elasticity: 0.35, rank: 2 }, // id_mismatch
      { factor_id: "fac_time", elasticity: NaN, rank: 3 }, // invalid_elasticity
      { factor_id: "fac_cost", elasticity: 0.20, rank: 11 }, // rank_exceeded
    ];

    const { valid, dropped, reasonCounts } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(valid).toHaveLength(1);
    expect(dropped).toHaveLength(3);
    expect(reasonCounts).toEqual({
      id_mismatch: 1,
      rank_exceeded: 1,
      invalid_elasticity: 1,
    });
  });

  it("returns zero counts when no factors dropped", () => {
    const sensitivity = [
      { factor_id: "fac_price", elasticity: 0.72, rank: 1 },
    ];

    const { reasonCounts } = filterMismatchedSensitivity(sensitivity, controllableIds);

    expect(reasonCounts).toEqual({
      id_mismatch: 0,
      rank_exceeded: 0,
      invalid_elasticity: 0,
    });
  });
});
