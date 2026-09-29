import { describe, it, expect } from "vitest";
import {
  mergeFactors,
  normalizeLabel,
  labelSimilarity,
  deduplicateFactors,
  unitsAreCompatible,
} from "../../src/cee/factor-extraction/merge.js";
import type { ExtractedFactor } from "../../src/cee/factor-extraction/index.js";
import { resolveContext } from "../../src/context/resolver.js";

describe("Factor Merge Logic", () => {
  const createFactor = (
    label: string,
    value: number,
    confidence: number,
    unit?: string
  ): ExtractedFactor => ({
    label,
    value,
    confidence,
    unit,
    matchedText: `matched: ${label}`,
    extractionType: "explicit",
  });

  describe("normalizeLabel", () => {
    it("converts to lowercase and trims", () => {
      expect(normalizeLabel("  Annual Revenue  ")).toBe("annual revenue");
      expect(normalizeLabel("BUDGET")).toBe("budget");
    });

    it("removes common suffixes", () => {
      expect(normalizeLabel("Churn Rate")).toBe("churn");
      expect(normalizeLabel("Total Value")).toBe("total");
      expect(normalizeLabel("Subscription Price")).toBe("subscription");
    });

    it("normalizes abbreviations to canonical terms with context", () => {
      const context = resolveContext("Test", "core");
      expect(normalizeLabel("ARR", context)).toBe("annual recurring revenue");
      expect(normalizeLabel("MRR", context)).toBe("monthly recurring revenue");
    });

    it("returns original if no alias match", () => {
      const context = resolveContext("Test", "core");
      expect(normalizeLabel("Custom Metric", context)).toBe("custom metric");
    });
  });

  describe("labelSimilarity", () => {
    it("returns 1.0 for exact matches after normalization", () => {
      expect(labelSimilarity("Budget", "budget")).toBe(1.0);
      expect(labelSimilarity("Churn Rate", "churn")).toBe(1.0);
    });

    it("returns high score for containment", () => {
      const score = labelSimilarity("Annual Revenue", "Revenue");
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    it("returns score based on word overlap", () => {
      const score = labelSimilarity("Customer Acquisition Cost", "Acquisition Cost");
      expect(score).toBeGreaterThan(0.5);
    });

    it("returns 0 for completely different labels", () => {
      const score = labelSimilarity("Budget", "Timeline");
      expect(score).toBe(0);
    });
  });

  describe("mergeFactors", () => {
    it("merges matching factors with LLM precedence when confident", () => {
      // Use same label for better matching - this is realistic as LLM and regex
      // often extract the same metric with same/similar labels
      const llmFactors = [createFactor("Budget", 500000, 0.9, "$")];
      const regexFactors = [createFactor("Budget", 500000, 0.8, "$")];

      const result = mergeFactors(llmFactors, regexFactors);

      expect(result.factors).toHaveLength(1);
      expect(result.factors[0].label).toBe("Budget"); // LLM label
      expect(result.factors[0].mergeSource).toBe("merged");
      expect(result.stats.merged).toBe(1);
      expect(result.stats.llmPrecedence).toBe(1);
    });

    it("gives regex precedence when LLM confidence is low", () => {
      // Use same label for better matching
      const llmFactors = [createFactor("Churn Rate", 0.05, 0.5, "%")];
      const regexFactors = [createFactor("Churn", 0.05, 0.8, "%")];

      const result = mergeFactors(llmFactors, regexFactors);

      expect(result.factors).toHaveLength(1);
      expect(result.factors[0].label).toBe("Churn Rate"); // Uses LLM label (expanded)
      expect(result.factors[0].value).toBe(0.05);
      expect(result.stats.regexPrecedence).toBe(1);
    });

    it("includes unmatched LLM factors", () => {
      const llmFactors = [createFactor("Customer Acquisition Cost", 500, 0.85, "$")];
      const regexFactors = [createFactor("Budget", 10000, 0.7, "$")];

      const result = mergeFactors(llmFactors, regexFactors);

      expect(result.factors).toHaveLength(2);
      expect(result.stats.llmOnly).toBe(1);
      expect(result.stats.regexOnly).toBe(1);
    });

    it("includes unmatched regex factors", () => {
      const llmFactors: ExtractedFactor[] = [];
      const regexFactors = [createFactor("Budget", 10000, 0.7, "$")];

      const result = mergeFactors(llmFactors, regexFactors);

      expect(result.factors).toHaveLength(1);
      expect(result.factors[0].mergeSource).toBe("regex");
      expect(result.stats.regexOnly).toBe(1);
    });

    it("handles empty inputs", () => {
      const result = mergeFactors([], []);
      expect(result.factors).toHaveLength(0);
      expect(result.stats.total).toBe(0);
    });

    it("respects custom confidence threshold", () => {
      const llmFactors = [createFactor("Revenue", 1000000, 0.65, "$")];
      const regexFactors = [createFactor("Revenue", 1000000, 0.8, "$")];

      // With lower threshold, LLM should take precedence
      const result = mergeFactors(llmFactors, regexFactors, {
        llmConfidenceThreshold: 0.6,
      });

      expect(result.stats.llmPrecedence).toBe(1);
    });

    it("tracks merge statistics correctly", () => {
      const llmFactors = [
        createFactor("Revenue", 1000000, 0.9, "$"),
        createFactor("CAC", 500, 0.85, "$"),
      ];
      const regexFactors = [
        createFactor("Revenue", 1000000, 0.7, "$"),
        createFactor("Budget", 50000, 0.8, "$"),
      ];

      const result = mergeFactors(llmFactors, regexFactors);

      expect(result.stats.total).toBe(3);
      expect(result.stats.merged).toBe(1); // Revenue
      expect(result.stats.llmOnly).toBe(1); // CAC
      expect(result.stats.regexOnly).toBe(1); // Budget
    });

    it("preserves original factors in merge result", () => {
      // Use same label for reliable matching
      const llmFactor = createFactor("Budget", 500000, 0.9, "$");
      const regexFactor = createFactor("Budget", 500000, 0.8, "$");

      const result = mergeFactors([llmFactor], [regexFactor]);

      // Find the merged factor
      const mergedFactor = result.factors.find(f => f.mergeSource === "merged");
      expect(mergedFactor).toBeDefined();
      expect(mergedFactor?.llmOriginal).toBeDefined();
      expect(mergedFactor?.regexOriginal).toBeDefined();
      expect(mergedFactor?.llmOriginal?.label).toBe("Budget");
      expect(mergedFactor?.regexOriginal?.label).toBe("Budget");
    });
  });

  describe("deduplicateFactors", () => {
    it("keeps factor with highest confidence", () => {
      const factors = [
        createFactor("Revenue", 1000000, 0.6, "$"),
        createFactor("Revenue", 1000000, 0.9, "$"),
        createFactor("Revenue", 1000000, 0.7, "$"),
      ];

      const result = deduplicateFactors(factors);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe(0.9);
    });

    it("handles different labels", () => {
      const factors = [
        createFactor("Revenue", 1000000, 0.9, "$"),
        createFactor("Budget", 50000, 0.8, "$"),
      ];

      const result = deduplicateFactors(factors);

      expect(result).toHaveLength(2);
    });

    it("normalizes labels for deduplication", () => {
      const factors = [
        createFactor("Revenue Rate", 1000000, 0.6, "$"),
        createFactor("REVENUE", 1000000, 0.9, "$"),
      ];

      const result = deduplicateFactors(factors);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe(0.9);
    });
  });

  describe("unitsAreCompatible", () => {
    it("returns true for exact matches", () => {
      expect(unitsAreCompatible("$", "$")).toBe(true);
      expect(unitsAreCompatible("%", "%")).toBe(true);
      expect(unitsAreCompatible("users", "users")).toBe(true);
    });

    it("returns true for undefined/empty units", () => {
      expect(unitsAreCompatible(undefined, undefined)).toBe(true);
      expect(unitsAreCompatible("", "")).toBe(true);
      expect(unitsAreCompatible(undefined, "")).toBe(true);
    });

    it("returns true for singular/plural pairs", () => {
      expect(unitsAreCompatible("user", "users")).toBe(true);
      expect(unitsAreCompatible("customers", "customer")).toBe(true);
      expect(unitsAreCompatible("month", "months")).toBe(true);
      expect(unitsAreCompatible("seats", "seat")).toBe(true);
    });

    it("returns true for units in same compatibility group", () => {
      // Currency
      expect(unitsAreCompatible("$", "USD")).toBe(true);
      expect(unitsAreCompatible("dollar", "dollars")).toBe(true);
      // Percentage
      expect(unitsAreCompatible("%", "percent")).toBe(true);
      expect(unitsAreCompatible("percent", "percentage")).toBe(true);
      // Count
      expect(unitsAreCompatible("users", "customers")).toBe(true);
      expect(unitsAreCompatible("people", "person")).toBe(true);
      // Time
      expect(unitsAreCompatible("months", "years")).toBe(true);
    });

    it("returns false for incompatible units", () => {
      expect(unitsAreCompatible("$", "%")).toBe(false);
      expect(unitsAreCompatible("users", "months")).toBe(false);
      expect(unitsAreCompatible("USD", "percent")).toBe(false);
    });

    it("handles case insensitivity", () => {
      expect(unitsAreCompatible("USERS", "users")).toBe(true);
      expect(unitsAreCompatible("USD", "usd")).toBe(true);
      expect(unitsAreCompatible("Months", "YEARS")).toBe(true);
    });
  });
});
