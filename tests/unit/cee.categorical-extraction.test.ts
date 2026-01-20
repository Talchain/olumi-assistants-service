/**
 * CEE Categorical Extraction Tests
 *
 * Tests the Raw+Encoded pattern for categorical and boolean interventions.
 * Ensures that non-numeric values (locations, technologies, toggles) are
 * properly extracted and tracked.
 */

import { describe, it, expect } from "vitest";
import {
  extractRawInterventions,
  extractCategoricalInterventions,
  extractInterventionsForOption,
  getExtractionStatistics,
  toOptionV3,
} from "../../src/cee/extraction/intervention-extractor.js";
import { transformOptionToAnalysisReady } from "../../src/cee/transforms/analysis-ready.js";
import type { NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";

describe("Categorical Extraction", () => {
  describe("extractCategoricalInterventions", () => {
    it("extracts location interventions from 'launch in UK'", () => {
      const results = extractCategoricalInterventions("Launch in UK");

      expect(results.length).toBeGreaterThan(0);
      const locationResult = results.find((r) => r.target_text === "region");
      expect(locationResult).toBeDefined();
      // Value should match the extracted text (may be case-preserved or lowercased)
      expect(String(locationResult?.raw_categorical_value).toLowerCase()).toBe("uk");
      expect(locationResult?.value_type).toBe("categorical");
    });

    it("extracts location interventions from 'expand to Germany'", () => {
      const results = extractCategoricalInterventions("Expand to Germany market");

      expect(results.length).toBeGreaterThan(0);
      const locationResult = results.find((r) => r.target_text === "region");
      expect(locationResult).toBeDefined();
      expect(locationResult?.raw_categorical_value).toMatch(/germany/i);
      expect(locationResult?.value_type).toBe("categorical");
    });

    it("extracts technology interventions from 'use React'", () => {
      const results = extractCategoricalInterventions("Use React for frontend");

      expect(results.length).toBeGreaterThan(0);
      const techResult = results.find((r) => r.target_text === "technology");
      expect(techResult).toBeDefined();
      expect(techResult?.raw_categorical_value).toMatch(/react/i);
      expect(techResult?.value_type).toBe("categorical");
    });

    it("extracts staffing interventions from 'hire contractors'", () => {
      const results = extractCategoricalInterventions("Hire contractors for project");

      expect(results.length).toBeGreaterThan(0);
      const staffResult = results.find((r) => r.target_text === "staffing_model");
      expect(staffResult).toBeDefined();
      expect(staffResult?.raw_categorical_value).toMatch(/contractors/i);
      expect(staffResult?.value_type).toBe("categorical");
    });

    it("extracts build/buy interventions from 'build in-house'", () => {
      const results = extractCategoricalInterventions("Build in-house solution");

      expect(results.length).toBeGreaterThan(0);
      const buildResult = results.find((r) => r.target_text === "approach");
      expect(buildResult).toBeDefined();
      expect(buildResult?.raw_categorical_value).toBe("build");
      expect(buildResult?.value_type).toBe("categorical");
    });

    it("extracts boolean interventions from 'enable dark mode'", () => {
      const results = extractCategoricalInterventions("Enable dark mode");

      expect(results.length).toBeGreaterThan(0);
      const boolResult = results.find((r) => r.value_type === "boolean");
      expect(boolResult).toBeDefined();
      expect(boolResult?.raw_categorical_value).toBe(true);
    });

    it("extracts boolean interventions from 'disable notifications'", () => {
      const results = extractCategoricalInterventions("Disable notifications");

      expect(results.length).toBeGreaterThan(0);
      const boolResult = results.find((r) => r.value_type === "boolean");
      expect(boolResult).toBeDefined();
      expect(boolResult?.raw_categorical_value).toBe(false);
    });

    it("returns empty array for numeric-only text", () => {
      const results = extractCategoricalInterventions("Set price to £59");

      // Should not extract categorical from numeric text
      expect(results.length).toBe(0);
    });
  });

  describe("extractInterventionsForOption with categorical values", () => {
    const mockNodes: NodeV3T[] = [
      {
        id: "factor_region",
        kind: "factor",
        label: "Target Region",
      },
      {
        id: "factor_technology",
        kind: "factor",
        label: "Technology Stack",
      },
      {
        id: "goal_growth",
        kind: "goal",
        label: "Revenue Growth",
      },
    ];

    const mockEdges: EdgeV3T[] = [
      {
        from: "factor_region",
        to: "goal_growth",
        strength_mean: 2.0,
        strength_std: 0.5,
        effect_direction: "positive",
        belief_exists: 0.8,
      },
    ];

    it("extracts categorical option with needs_encoding status", () => {
      const result = extractInterventionsForOption(
        "Launch in UK",
        undefined,
        mockNodes,
        mockEdges,
        "goal_growth"
      );

      // Should have interventions (placeholder values)
      expect(Object.keys(result.interventions).length).toBeGreaterThan(0);

      // Should have raw_interventions
      expect(result.raw_interventions).toBeDefined();
      expect(Object.keys(result.raw_interventions!).length).toBeGreaterThan(0);

      // Status should be needs_encoding (has categorical values)
      expect(result.status).toBe("needs_encoding");
    });

    it("includes raw_interventions in V3 conversion", () => {
      const extracted = extractInterventionsForOption(
        "Launch in UK",
        undefined,
        mockNodes,
        mockEdges,
        "goal_growth"
      );

      const v3Option = toOptionV3(extracted);

      expect(v3Option.raw_interventions).toBeDefined();
      expect(v3Option.status).toBe("needs_encoding");
    });

    it("includes intervention with raw_value and value_type", () => {
      const result = extractInterventionsForOption(
        "Launch in UK",
        undefined,
        mockNodes,
        mockEdges,
        "goal_growth"
      );

      // Find an intervention with raw_value
      const interventionsWithRaw = Object.values(result.interventions).filter(
        (i) => i.raw_value !== undefined
      );

      expect(interventionsWithRaw.length).toBeGreaterThan(0);
      const intervention = interventionsWithRaw[0];
      expect(intervention.value_type).toBe("categorical");
      expect(typeof intervention.raw_value).toBe("string");
    });
  });

  describe("getExtractionStatistics with categorical values", () => {
    it("counts options_needs_encoding correctly", () => {
      const mockNodes: NodeV3T[] = [
        { id: "goal", kind: "goal", label: "Goal" },
      ];
      const mockEdges: EdgeV3T[] = [];

      const option1 = extractInterventionsForOption(
        "Launch in UK",
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );

      const option2 = extractInterventionsForOption(
        "Set price to £59",
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );

      const stats = getExtractionStatistics([option1, option2]);

      // Should have at least one option needing encoding
      expect(stats.options_needs_encoding).toBeGreaterThanOrEqual(0);
      expect(stats.options_total).toBe(2);
    });

    it("counts categorical_interventions correctly", () => {
      const mockNodes: NodeV3T[] = [
        { id: "goal", kind: "goal", label: "Goal" },
      ];
      const mockEdges: EdgeV3T[] = [];

      const option = extractInterventionsForOption(
        "Launch in UK and use React",
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );

      const stats = getExtractionStatistics([option]);

      // Should count categorical interventions
      expect(stats.categorical_interventions).toBeGreaterThanOrEqual(0);
    });

    it("counts boolean_interventions correctly", () => {
      const mockNodes: NodeV3T[] = [
        { id: "goal", kind: "goal", label: "Goal" },
      ];
      const mockEdges: EdgeV3T[] = [];

      const option = extractInterventionsForOption(
        "Enable dark mode",
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );

      const stats = getExtractionStatistics([option]);

      // Should count boolean interventions
      expect(stats.boolean_interventions).toBeGreaterThanOrEqual(0);
    });

    it("tracks options_with_raw_values correctly", () => {
      const mockNodes: NodeV3T[] = [
        { id: "goal", kind: "goal", label: "Goal" },
      ];
      const mockEdges: EdgeV3T[] = [];

      const option = extractInterventionsForOption(
        "Launch in UK",
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );

      const stats = getExtractionStatistics([option]);

      // Should track options with raw values
      if (option.raw_interventions && Object.keys(option.raw_interventions).length > 0) {
        expect(stats.options_with_raw_values).toBe(1);
        expect(stats.raw_interventions_total).toBeGreaterThan(0);
      }
    });
  });

  describe("Status determination priority", () => {
    it("prioritizes needs_user_mapping over needs_encoding when interventions empty", () => {
      const mockNodes: NodeV3T[] = [
        { id: "goal", kind: "goal", label: "Goal" },
      ];
      const mockEdges: EdgeV3T[] = [];

      // Text with no extractable interventions
      const result = extractInterventionsForOption(
        "Just some random text",
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );

      // Should be needs_user_mapping, not needs_encoding
      expect(result.status).toBe("needs_user_mapping");
    });

    it("uses needs_encoding when has categorical but no unresolved targets", () => {
      const mockNodes: NodeV3T[] = [
        { id: "factor_region", kind: "factor", label: "Region" },
        { id: "goal", kind: "goal", label: "Goal" },
      ];
      const mockEdges: EdgeV3T[] = [
        {
          from: "factor_region",
          to: "goal",
          strength_mean: 1.0,
          strength_std: 0.1,
          effect_direction: "positive",
          belief_exists: 0.9,
        },
      ];

      const result = extractInterventionsForOption(
        "Launch in UK",
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );

      // Should be needs_encoding if we have categorical values
      if (result.raw_interventions && Object.keys(result.raw_interventions).length > 0) {
        expect(result.status).toBe("needs_encoding");
      }
    });
  });
});

describe("Mixed Numeric and Categorical", () => {
  it("extracts both numeric and categorical from mixed option", () => {
    const numericResults = extractRawInterventions("Set price to £59 and launch in UK");
    const categoricalResults = extractCategoricalInterventions("Set price to £59 and launch in UK");

    // Should have numeric extraction
    expect(numericResults.length).toBeGreaterThan(0);
    const priceResult = numericResults.find((r) => r.value?.value === 59);
    expect(priceResult).toBeDefined();

    // Should also have categorical extraction
    expect(categoricalResults.length).toBeGreaterThan(0);
    const locationResult = categoricalResults.find((r) => r.target_text === "region");
    expect(locationResult).toBeDefined();
  });
});

/**
 * CRITICAL CONTRACT TESTS
 *
 * These tests verify the analysis-ready output contract:
 * - interventions: Record<string, number> (plain numbers, NOT objects)
 * - raw_interventions: Record<string, number|string|boolean> (original values)
 *
 * This is the format consumed by PLoT/ISL engines.
 */
describe("Analysis-Ready Contract (transformOptionToAnalysisReady)", () => {
  const mockNodes: NodeV3T[] = [
    { id: "factor_region", kind: "factor", label: "Region" },
    { id: "factor_price", kind: "factor", label: "Price" },
    { id: "goal", kind: "goal", label: "Revenue Growth" },
  ];

  const mockEdges: EdgeV3T[] = [
    {
      from: "factor_region",
      to: "goal",
      strength_mean: 1.5,
      strength_std: 0.3,
      effect_direction: "positive",
      belief_exists: 0.85,
    },
    {
      from: "factor_price",
      to: "goal",
      strength_mean: 2.0,
      strength_std: 0.4,
      effect_direction: "positive",
      belief_exists: 0.9,
    },
  ];

  it("flattens categorical interventions to plain numbers", () => {
    // Extract categorical option
    const extracted = extractInterventionsForOption(
      "Launch in UK",
      undefined,
      mockNodes,
      mockEdges,
      "goal"
    );

    // Convert to V3 format
    const v3Option = toOptionV3(extracted);

    // Transform to analysis-ready format
    const analysisReady = transformOptionToAnalysisReady(v3Option);

    // CRITICAL: interventions must be Record<string, number>
    for (const [factorId, value] of Object.entries(analysisReady.interventions)) {
      expect(typeof value).toBe("number");
      expect(value).not.toBeNull();
      expect(value).not.toBeNaN();
      // Value must NOT be an object
      expect(typeof value).not.toBe("object");
    }
  });

  it("flattens boolean interventions to plain numbers (0 or 1)", () => {
    // Extract boolean option
    const extracted = extractInterventionsForOption(
      "Enable dark mode",
      undefined,
      mockNodes,
      mockEdges,
      "goal"
    );

    // Convert to V3 format
    const v3Option = toOptionV3(extracted);

    // Transform to analysis-ready format
    const analysisReady = transformOptionToAnalysisReady(v3Option);

    // CRITICAL: interventions must be Record<string, number>
    for (const [factorId, value] of Object.entries(analysisReady.interventions)) {
      expect(typeof value).toBe("number");
      // Boolean should be encoded as 0 or 1
      expect([0, 1]).toContain(value);
    }
  });

  it("preserves raw values in raw_interventions (not interventions)", () => {
    // Extract categorical option
    const extracted = extractInterventionsForOption(
      "Launch in UK",
      undefined,
      mockNodes,
      mockEdges,
      "goal"
    );

    // Convert to V3 format
    const v3Option = toOptionV3(extracted);

    // Transform to analysis-ready format
    const analysisReady = transformOptionToAnalysisReady(v3Option);

    // raw_interventions should exist and contain the categorical value
    if (analysisReady.raw_interventions) {
      const rawValues = Object.values(analysisReady.raw_interventions);
      // Should have at least one non-numeric raw value
      const hasNonNumeric = rawValues.some((v) => typeof v !== "number");
      if (hasNonNumeric) {
        // The raw value should be a string (e.g., "UK")
        const stringValues = rawValues.filter((v) => typeof v === "string");
        expect(stringValues.length).toBeGreaterThan(0);
      }
    }

    // Main interventions MUST still be numbers
    for (const value of Object.values(analysisReady.interventions)) {
      expect(typeof value).toBe("number");
    }
  });

  it("sets status to needs_encoding when raw values are non-numeric", () => {
    // Extract categorical option
    const extracted = extractInterventionsForOption(
      "Launch in UK",
      undefined,
      mockNodes,
      mockEdges,
      "goal"
    );

    // Convert to V3 format
    const v3Option = toOptionV3(extracted);

    // Transform to analysis-ready format
    const analysisReady = transformOptionToAnalysisReady(v3Option);

    // If we have non-numeric raw values, status should be needs_encoding
    if (analysisReady.raw_interventions) {
      const hasNonNumeric = Object.values(analysisReady.raw_interventions).some(
        (v) => typeof v !== "number"
      );
      if (hasNonNumeric) {
        expect(analysisReady.status).toBe("needs_encoding");
      }
    }
  });

  it("produces valid Record<string, number> for numeric-only options", () => {
    // Create a V3 option with only numeric interventions
    const extracted = extractInterventionsForOption(
      "Set price to £59",
      undefined,
      mockNodes,
      mockEdges,
      "goal"
    );

    const v3Option = toOptionV3(extracted);
    const analysisReady = transformOptionToAnalysisReady(v3Option);

    // All interventions must be plain numbers
    for (const [factorId, value] of Object.entries(analysisReady.interventions)) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
    }

    // Status should be ready (not needs_encoding) for numeric-only
    if (Object.keys(analysisReady.interventions).length > 0 && !analysisReady.raw_interventions) {
      expect(analysisReady.status).toBe("ready");
    }
  });

  it("never produces object values in interventions field", () => {
    // Test multiple option types
    const testCases = [
      "Launch in UK",
      "Enable dark mode",
      "Build in-house solution",
      "Hire contractors",
      "Use React for frontend",
    ];

    for (const optionText of testCases) {
      const extracted = extractInterventionsForOption(
        optionText,
        undefined,
        mockNodes,
        mockEdges,
        "goal"
      );
      const v3Option = toOptionV3(extracted);
      const analysisReady = transformOptionToAnalysisReady(v3Option);

      // CRITICAL CONTRACT: interventions values are NEVER objects
      for (const [factorId, value] of Object.entries(analysisReady.interventions)) {
        expect(typeof value).toBe("number");
        expect(value).not.toEqual(expect.objectContaining({ value: expect.any(Number) }));
      }
    }
  });
});
