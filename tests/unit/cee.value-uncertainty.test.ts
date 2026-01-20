/**
 * Unit tests for CEE value uncertainty derivation
 *
 * Tests the factor value uncertainty pipeline:
 * - Value uncertainty derivation formula
 * - Factor extraction with confidence/type
 * - Schema v2 transformation with value_std
 * - parameter_uncertainties in graph output
 */
import { describe, it, expect } from "vitest";
import {
  deriveValueUncertainty,
  deriveValueUncertaintyBatch,
  type ValueUncertaintyInput,
} from "../../src/cee/transforms/value-uncertainty-derivation.js";
import { extractFactors } from "../../src/cee/factor-extraction/index.js";
import {
  transformNodeToV2,
  transformGraphToV2,
  transformResponseToV2,
  type V1Node,
  type V1Graph,
  type V1DraftGraphResponse,
} from "../../src/cee/transforms/schema-v2.js";

// =============================================================================
// Test Case A: Explicit extraction derives low uncertainty
// =============================================================================

describe("Value Uncertainty Derivation - Explicit Extractions", () => {
  it("derives low uncertainty for high-confidence explicit extraction", () => {
    const input: ValueUncertaintyInput = {
      value: 59,
      extractionType: "explicit",
      confidence: 0.95, // High confidence
    };

    const result = deriveValueUncertainty(input);

    // High confidence → low CV → low std
    // CV = 0.2 * (1 - 0.95) + 0.05 = 0.06
    // std = 0.06 * 59 * 1.0 = 3.54
    expect(result.value).toBe(59);
    expect(result.valueStd).toBeGreaterThan(0);
    expect(result.valueStd).toBeLessThan(10); // Should be relatively low
    expect(result.distribution).toBe("normal");
  });

  it("derives reasonable uncertainty for explicit 'price is £59'", () => {
    // Simulating extraction from "price is £59"
    const input: ValueUncertaintyInput = {
      value: 59,
      extractionType: "explicit",
      confidence: 0.90,
    };

    const result = deriveValueUncertainty(input);

    // CV = 0.2 * (1 - 0.90) + 0.05 = 0.07
    // std = 0.07 * 59 * 1.0 = 4.13
    expect(result.valueStd).toBeCloseTo(4.13, 1);
  });
});

// =============================================================================
// Test Case B: Inferred extraction derives higher uncertainty
// =============================================================================

describe("Value Uncertainty Derivation - Inferred Extractions", () => {
  it("derives higher uncertainty for inferred extraction", () => {
    const explicitInput: ValueUncertaintyInput = {
      value: 60,
      extractionType: "explicit",
      confidence: 0.90,
    };

    const inferredInput: ValueUncertaintyInput = {
      value: 60,
      extractionType: "inferred",
      confidence: 0.70, // Lower confidence for inferred
    };

    const explicitResult = deriveValueUncertainty(explicitInput);
    const inferredResult = deriveValueUncertainty(inferredInput);

    // Inferred should have higher std due to lower confidence AND type multiplier
    expect(inferredResult.valueStd).toBeGreaterThan(explicitResult.valueStd);
  });

  it("applies type multiplier for inferred extractions", () => {
    // Same confidence, different types
    const explicitInput: ValueUncertaintyInput = {
      value: 100,
      extractionType: "explicit",
      confidence: 0.80,
    };

    const inferredInput: ValueUncertaintyInput = {
      value: 100,
      extractionType: "inferred",
      confidence: 0.80, // Same confidence
    };

    const explicitResult = deriveValueUncertainty(explicitInput);
    const inferredResult = deriveValueUncertainty(inferredInput);

    // Inferred has 1.5x multiplier
    expect(inferredResult.valueStd).toBeCloseTo(explicitResult.valueStd * 1.5, 2);
  });

  it("derives uncertainty for 'around £60'", () => {
    const input: ValueUncertaintyInput = {
      value: 60,
      extractionType: "inferred",
      confidence: 0.70,
    };

    const result = deriveValueUncertainty(input);

    // CV = 0.2 * (1 - 0.70) + 0.05 = 0.11
    // std = 0.11 * 60 * 1.5 = 9.9
    expect(result.valueStd).toBeCloseTo(9.9, 1);
  });
});

// =============================================================================
// Test Case C: Range extraction uses range-based std
// =============================================================================

describe("Value Uncertainty Derivation - Range Extractions", () => {
  it("uses range-based std derivation for 'between £50-70'", () => {
    const input: ValueUncertaintyInput = {
      value: 60, // Midpoint
      extractionType: "range",
      confidence: 0.80,
      rangeMin: 50,
      rangeMax: 70,
    };

    const result = deriveValueUncertainty(input);

    // Range-based: std = (max - min) / 4 = (70 - 50) / 4 = 5
    expect(result.value).toBe(60);
    expect(result.valueStd).toBeCloseTo(5, 2);
    expect(result.distribution).toBe("normal");
    expect(result.rangeMin).toBe(50);
    expect(result.rangeMax).toBe(70);
  });

  it("preserves original range bounds in result", () => {
    const input: ValueUncertaintyInput = {
      value: 7.5, // Midpoint of 5-10%
      extractionType: "range",
      confidence: 0.80,
      rangeMin: 5,
      rangeMax: 10,
    };

    const result = deriveValueUncertainty(input);

    expect(result.rangeMin).toBe(5);
    expect(result.rangeMax).toBe(10);
    expect(result.valueStd).toBeCloseTo(1.25, 2); // (10-5)/4 = 1.25
  });

  it("handles narrow ranges with floor", () => {
    const input: ValueUncertaintyInput = {
      value: 100,
      extractionType: "range",
      confidence: 0.80,
      rangeMin: 99,
      rangeMax: 101, // Very narrow range
    };

    const result = deriveValueUncertainty(input);

    // Range std = (101-99)/4 = 0.5
    // But floor is max(0.01, 0.01*100) = 1
    expect(result.valueStd).toBeGreaterThanOrEqual(0.5);
  });
});

// =============================================================================
// Test Case D: Zero value handled
// =============================================================================

describe("Value Uncertainty Derivation - Zero Value", () => {
  it("handles zero value with absolute floor", () => {
    const input: ValueUncertaintyInput = {
      value: 0,
      extractionType: "explicit",
      confidence: 0.90,
    };

    const result = deriveValueUncertainty(input);

    // CV-based std = 0.07 * 0 * 1.0 = 0
    // But absolute floor is 0.01
    expect(result.value).toBe(0);
    expect(result.valueStd).toBe(0.01);
    expect(result.distribution).toBe("normal");
  });

  it("handles cost is $0 scenario", () => {
    const input: ValueUncertaintyInput = {
      value: 0,
      extractionType: "explicit",
      confidence: 0.85,
    };

    const result = deriveValueUncertainty(input);

    // Should not throw, should have reasonable floor
    expect(result.valueStd).toBeGreaterThan(0);
    expect(result.valueStd).toBe(0.01);
  });
});

// =============================================================================
// Test Case E: Negative value handled
// =============================================================================

describe("Value Uncertainty Derivation - Negative Values", () => {
  it("handles negative value using absolute value for CV", () => {
    const input: ValueUncertaintyInput = {
      value: -5,
      extractionType: "explicit",
      confidence: 0.90,
    };

    const result = deriveValueUncertainty(input);

    // std = CV * |value| * multiplier
    // CV = 0.2 * (1 - 0.90) + 0.05 = 0.07
    // std = 0.07 * |-5| * 1.0 = 0.35
    expect(result.value).toBe(-5);
    expect(result.valueStd).toBeCloseTo(0.35, 2);
  });

  it("handles temperature dropped to -5°C", () => {
    const input: ValueUncertaintyInput = {
      value: -5,
      extractionType: "explicit",
      confidence: 0.85,
    };

    const result = deriveValueUncertainty(input);

    // Should use |value| for CV calculation
    expect(result.valueStd).toBeGreaterThan(0);
    // CV = 0.2 * (1 - 0.85) + 0.05 = 0.08
    // std = 0.08 * 5 * 1.0 = 0.4
    expect(result.valueStd).toBeCloseTo(0.4, 1);
  });

  it("handles negative range", () => {
    const input: ValueUncertaintyInput = {
      value: -7.5,
      extractionType: "range",
      confidence: 0.80,
      rangeMin: -10,
      rangeMax: -5,
    };

    const result = deriveValueUncertainty(input);

    // std = |(-5) - (-10)| / 4 = 5/4 = 1.25
    expect(result.valueStd).toBeCloseTo(1.25, 2);
  });
});

// =============================================================================
// Test Case F: parameter_uncertainties in graph output
// =============================================================================

describe("parameter_uncertainties in Graph Output", () => {
  it("includes parameter_uncertainties for factors with value_std", () => {
    const v1Graph: V1Graph = {
      nodes: [
        {
          id: "factor_price",
          kind: "factor",
          label: "Price",
          data: {
            value: 59,
            baseline: 49,
            unit: "£",
            extractionType: "explicit",
            confidence: 0.95,
          },
        },
        {
          id: "goal_revenue",
          kind: "goal",
          label: "Maximize Revenue",
        },
      ],
      edges: [
        { from: "factor_price", to: "goal_revenue", weight: 0.8, belief: 0.9 },
      ],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    expect(v2Graph.parameter_uncertainties).toBeDefined();
    expect(v2Graph.parameter_uncertainties).toHaveLength(1);
    expect(v2Graph.parameter_uncertainties![0].node_id).toBe("factor_price");
    expect(v2Graph.parameter_uncertainties![0].std).toBeGreaterThan(0);
    expect(v2Graph.parameter_uncertainties![0].distribution).toBe("normal");
  });

  it("excludes non-factor nodes from parameter_uncertainties", () => {
    const v1Graph: V1Graph = {
      nodes: [
        {
          id: "goal_revenue",
          kind: "goal",
          label: "Maximize Revenue",
        },
        {
          id: "outcome_sales",
          kind: "outcome",
          label: "Sales",
        },
      ],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    // No factors with observed_state → no parameter_uncertainties
    expect(v2Graph.parameter_uncertainties).toBeUndefined();
  });

  it("handles multiple factors with uncertainties", () => {
    const v1Graph: V1Graph = {
      nodes: [
        {
          id: "factor_price",
          kind: "factor",
          label: "Price",
          data: {
            value: 59,
            extractionType: "explicit",
            confidence: 0.95,
          },
        },
        {
          id: "factor_discount",
          kind: "factor",
          label: "Discount",
          data: {
            value: 10,
            extractionType: "range",
            confidence: 0.80,
            rangeMin: 5,
            rangeMax: 15,
          },
        },
        {
          id: "factor_no_meta",
          kind: "factor",
          label: "Factor Without Meta",
          data: {
            value: 100,
            // No extractionType or confidence → no value_std
          },
        },
      ],
      edges: [],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    // Should have 2 entries (factor_price and factor_discount)
    // factor_no_meta has no extraction metadata
    expect(v2Graph.parameter_uncertainties).toBeDefined();
    expect(v2Graph.parameter_uncertainties).toHaveLength(2);

    const priceUncertainty = v2Graph.parameter_uncertainties!.find(
      (p) => p.node_id === "factor_price"
    );
    const discountUncertainty = v2Graph.parameter_uncertainties!.find(
      (p) => p.node_id === "factor_discount"
    );

    expect(priceUncertainty).toBeDefined();
    expect(discountUncertainty).toBeDefined();
    // Range-based std for discount: (15-5)/4 = 2.5
    expect(discountUncertainty!.std).toBeCloseTo(2.5, 1);
  });

  it("includes parameter_uncertainties in full response transformation", () => {
    const v1Response: V1DraftGraphResponse = {
      graph: {
        nodes: [
          {
            id: "factor_price",
            kind: "factor",
            label: "Price",
            data: {
              value: 100,
              extractionType: "explicit",
              confidence: 0.90,
            },
          },
        ],
        edges: [],
      },
      quality: { overall: 0.85 },
    };

    const v2Response = transformResponseToV2(v1Response);

    expect(v2Response.schema_version).toBe("2.2");
    expect(v2Response.graph.parameter_uncertainties).toBeDefined();
    expect(v2Response.graph.parameter_uncertainties).toHaveLength(1);
  });
});

// =============================================================================
// Test Case G: Backward compatibility
// =============================================================================

describe("Backward Compatibility", () => {
  it("v1 nodes without extraction metadata still work", () => {
    const v1Node: V1Node = {
      id: "factor_old",
      kind: "factor",
      label: "Old Factor",
      data: {
        value: 50,
        unit: "£",
        // No extractionType or confidence
      },
    };

    const v2Node = transformNodeToV2(v1Node);

    expect(v2Node.observed_state).toBeDefined();
    expect(v2Node.observed_state!.value).toBe(50);
    expect(v2Node.observed_state!.unit).toBe("£");
    // value_std should be undefined (no extraction metadata)
    expect(v2Node.observed_state!.value_std).toBeUndefined();
  });

  it("existing schema v2 tests still pass structure", () => {
    const v1Graph: V1Graph = {
      version: "1.0",
      nodes: [
        { id: "goal_1", kind: "goal", label: "Success" },
        { id: "factor_1", kind: "factor", label: "Factor", data: { value: 10 } },
      ],
      edges: [{ from: "factor_1", to: "goal_1" }],
    };

    const v2Graph = transformGraphToV2(v1Graph);

    // Basic structure unchanged
    expect(v2Graph.version).toBe("1.0");
    expect(v2Graph.nodes).toHaveLength(2);
    expect(v2Graph.edges).toHaveLength(1);

    // Factor should have observed_state
    const factor = v2Graph.nodes.find((n) => n.id === "factor_1");
    expect(factor?.observed_state?.value).toBe(10);
    expect(factor?.observed_state?.source).toBe("brief_extraction");
  });

  it("v1 schema response transformation preserves all fields", () => {
    const v1Response: V1DraftGraphResponse = {
      graph: {
        nodes: [{ id: "n1", kind: "goal", label: "Goal" }],
        edges: [],
      },
      quality: { overall: 0.9, structure: 0.85 },
      trace: { request_id: "req-123" },
      draft_warnings: [{ type: "TEST", message: "Test warning" }],
    };

    const v2Response = transformResponseToV2(v1Response);

    expect(v2Response.schema_version).toBe("2.2");
    expect(v2Response.quality?.overall).toBe(0.9);
    expect(v2Response.trace?.request_id).toBe("req-123");
    expect(v2Response.draft_warnings).toHaveLength(1);
  });
});

// =============================================================================
// Factor Extraction Tests
// =============================================================================

describe("Factor Extraction with Confidence and Type", () => {
  it("extracts explicit currency from-to with high confidence", () => {
    const factors = extractFactors("The price will increase from £49 to £59");

    const priceFactor = factors.find((f) => f.value === 59);
    expect(priceFactor).toBeDefined();
    expect(priceFactor!.extractionType).toBe("explicit");
    expect(priceFactor!.confidence).toBeGreaterThanOrEqual(0.90);
    expect(priceFactor!.baseline).toBe(49);
  });

  it("extracts approximate values as inferred", () => {
    const factors = extractFactors("We expect around £60 in revenue");

    const factor = factors.find((f) => f.value === 60);
    expect(factor).toBeDefined();
    expect(factor!.extractionType).toBe("inferred");
    expect(factor!.confidence).toBeLessThanOrEqual(0.75);
  });

  it("extracts range with bounds", () => {
    const factors = extractFactors("The cost is between £50-70");

    // Should extract midpoint with range info
    const factor = factors.find((f) => f.rangeMin !== undefined);
    expect(factor).toBeDefined();
    expect(factor!.extractionType).toBe("range");
    expect(factor!.rangeMin).toBe(50);
    expect(factor!.rangeMax).toBe(70);
    expect(factor!.value).toBe(60); // Midpoint
  });

  it("extracts contextual numbers as explicit", () => {
    const factors = extractFactors("The price is £59");

    const factor = factors.find((f) => f.value === 59);
    expect(factor).toBeDefined();
    expect(factor!.extractionType).toBe("explicit");
    expect(factor!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("extracts standalone currency as inferred", () => {
    const factors = extractFactors("We budgeted £100");

    // Standalone currency without context words is inferred
    const factor = factors.find((f) => f.value === 100);
    expect(factor).toBeDefined();
    expect(factor!.extractionType).toBe("inferred");
  });
});

// =============================================================================
// Batch Processing
// =============================================================================

describe("Batch Value Uncertainty Derivation", () => {
  it("processes multiple inputs in batch", () => {
    const inputs: ValueUncertaintyInput[] = [
      { value: 100, extractionType: "explicit", confidence: 0.95 },
      { value: 50, extractionType: "inferred", confidence: 0.70 },
      { value: 75, extractionType: "range", confidence: 0.80, rangeMin: 50, rangeMax: 100 },
    ];

    const results = deriveValueUncertaintyBatch(inputs);

    expect(results).toHaveLength(3);
    expect(results[0].value).toBe(100);
    expect(results[1].value).toBe(50);
    expect(results[2].value).toBe(75);

    // Range should have range-based std = (100-50)/4 = 12.5
    expect(results[2].valueStd).toBeCloseTo(12.5, 1);
    expect(results[2].rangeMin).toBe(50);
    expect(results[2].rangeMax).toBe(100);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  it("clamps confidence to valid range", () => {
    const input: ValueUncertaintyInput = {
      value: 100,
      extractionType: "explicit",
      confidence: 1.5, // Invalid - should be clamped to 1
    };

    const result = deriveValueUncertainty(input);

    // With confidence=1, CV = 0.2*(1-1)+0.05 = 0.05
    // std = 0.05 * 100 * 1.0 = 5
    expect(result.valueStd).toBeCloseTo(5, 1);
  });

  it("handles very small values", () => {
    const input: ValueUncertaintyInput = {
      value: 0.001,
      extractionType: "explicit",
      confidence: 0.90,
    };

    const result = deriveValueUncertainty(input);

    // CV-based std would be tiny, but floor should apply
    expect(result.valueStd).toBe(0.01);
  });

  it("handles very large values", () => {
    const input: ValueUncertaintyInput = {
      value: 1_000_000_000, // $1 billion
      extractionType: "explicit",
      confidence: 0.85,
    };

    const result = deriveValueUncertainty(input);

    // CV = 0.2*(1-0.85)+0.05 = 0.08
    // std = 0.08 * 1B = 80M
    expect(result.valueStd).toBeCloseTo(80_000_000, -5);
  });
});

// =============================================================================
// Test Case H: End-to-End Integration - Enrichment → V2 Transform
// =============================================================================

import { enrichGraphWithFactors } from "../../src/cee/factor-extraction/enricher.js";
import type { GraphT, FactorDataT } from "../../src/schemas/graph.js";

describe("End-to-End Integration: Enrichment → V2 Transform", () => {
  it("enriched factors include value_std in v2 output", () => {
    const brief = "Our price is £59, up from £49 last quarter.";

    // Start with a simple graph that has no factor data
    const baseGraph: GraphT = {
      version: "1",
      default_seed: 17,
      nodes: [
        {
          id: "goal_revenue",
          kind: "goal",
          label: "Maximize Revenue",
        },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    };

    // Enrich the graph with factors extracted from brief
    const { graph: enrichedGraph, factorsAdded } = enrichGraphWithFactors(
      baseGraph,
      brief,
      { minConfidence: 0.5 }
    );

    // Should have added at least one factor
    expect(factorsAdded).toBeGreaterThan(0);

    // Find the enriched factor node
    const factorNode = enrichedGraph.nodes.find((n) => n.kind === "factor");
    expect(factorNode).toBeDefined();
    expect(factorNode!.data).toBeDefined();

    // Verify extraction metadata was propagated
    const factorData = factorNode!.data as FactorDataT;
    expect(factorData.extractionType).toBeDefined();
    expect(factorData.confidence).toBeDefined();
    expect(factorData.confidence).toBeGreaterThan(0);

    // Transform to v2 schema
    const v2Graph = transformGraphToV2(enrichedGraph);

    // Find the v2 factor node
    const v2FactorNode = v2Graph.nodes.find((n) => n.type === "factor");
    expect(v2FactorNode).toBeDefined();
    expect(v2FactorNode!.observed_state).toBeDefined();

    // CRITICAL: value_std should be derived from extraction metadata
    expect(v2FactorNode!.observed_state!.value_std).toBeDefined();
    expect(v2FactorNode!.observed_state!.value_std).toBeGreaterThan(0);

    // CRITICAL: parameter_uncertainties should be populated
    expect(v2Graph.parameter_uncertainties).toBeDefined();
    expect(v2Graph.parameter_uncertainties!.length).toBeGreaterThan(0);

    // Verify the parameter_uncertainty entry matches the factor
    const paramUncertainty = v2Graph.parameter_uncertainties!.find(
      (p) => p.node_id === v2FactorNode!.id
    );
    expect(paramUncertainty).toBeDefined();
    expect(paramUncertainty!.std).toBe(v2FactorNode!.observed_state!.value_std);
    expect(paramUncertainty!.distribution).toBe("normal");
  });

  it("enriched range extractions get range-based value_std", () => {
    const brief = "Budget is between £50k and £70k for this quarter.";

    const baseGraph: GraphT = {
      version: "1",
      default_seed: 17,
      nodes: [
        {
          id: "decision_budget",
          kind: "decision",
          label: "Budget Decision",
        },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    };

    const { graph: enrichedGraph, factorsAdded } = enrichGraphWithFactors(
      baseGraph,
      brief,
      { minConfidence: 0.5 }
    );

    // Should have extracted the budget range
    expect(factorsAdded).toBeGreaterThan(0);

    const factorNode = enrichedGraph.nodes.find((n) => n.kind === "factor");
    expect(factorNode).toBeDefined();

    // If it's a range extraction, should have range bounds
    const factorData = factorNode!.data as FactorDataT;
    if (factorData.extractionType === "range") {
      expect(factorData.rangeMin).toBeDefined();
      expect(factorData.rangeMax).toBeDefined();
    }

    // Transform and verify
    const v2Graph = transformGraphToV2(enrichedGraph);
    const v2FactorNode = v2Graph.nodes.find((n) => n.type === "factor");

    expect(v2FactorNode!.observed_state!.value_std).toBeDefined();
    expect(v2Graph.parameter_uncertainties).toBeDefined();
  });

  it("factors without extraction metadata have no value_std in v2 output", () => {
    // Create a graph with a factor that has value but no extraction metadata
    const graphWithPlainFactor: V1Graph = {
      nodes: [
        {
          id: "factor_manual",
          kind: "factor",
          label: "Manual Factor",
          data: {
            value: 100,
            // No extractionType or confidence
          },
        },
      ],
      edges: [],
    };

    const v2Graph = transformGraphToV2(graphWithPlainFactor);
    const v2FactorNode = v2Graph.nodes.find((n) => n.type === "factor");

    expect(v2FactorNode).toBeDefined();
    expect(v2FactorNode!.observed_state).toBeDefined();
    expect(v2FactorNode!.observed_state!.value).toBe(100);

    // Without extraction metadata, no value_std should be derived
    expect(v2FactorNode!.observed_state!.value_std).toBeUndefined();

    // No parameter_uncertainties when no factors have value_std
    expect(v2Graph.parameter_uncertainties).toBeUndefined();
  });
});
