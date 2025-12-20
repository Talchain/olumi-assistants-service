import { describe, it, expect } from "vitest";
import {
  LLMFactorSchema,
  LLMFactorExtractionResponseSchema,
  LLMConstraintSchema,
  LLMConstraintExtractionResponseSchema,
  parseFactorExtractionResponse,
  parseConstraintExtractionResponse,
  flattenZodErrors,
} from "../../src/schemas/llmExtraction.js";

describe("LLM Extraction Schemas", () => {
  describe("LLMFactorSchema", () => {
    it("accepts valid factor", () => {
      const factor = {
        label: "Annual Recurring Revenue",
        value: 1000000,
        unit: "$",
        confidence: 0.9,
        source_quote: "ARR of $1M",
      };

      const result = LLMFactorSchema.safeParse(factor);
      expect(result.success).toBe(true);
    });

    it("accepts factor with optional fields", () => {
      const factor = {
        label: "Revenue Growth",
        value: 0.25,
        unit: "%",
        baseline: 0.15,
        range: { min: 0.2, max: 0.3 },
        confidence: 0.85,
        source_quote: "from 15% to 25%",
      };

      const result = LLMFactorSchema.safeParse(factor);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.baseline).toBe(0.15);
        expect(result.data.range?.min).toBe(0.2);
      }
    });

    it("rejects factor with missing required fields", () => {
      const factor = {
        label: "Revenue",
        value: 1000000,
        // missing unit, confidence, source_quote
      };

      const result = LLMFactorSchema.safeParse(factor);
      expect(result.success).toBe(false);
    });

    it("rejects factor with invalid confidence", () => {
      const factor = {
        label: "Revenue",
        value: 1000000,
        unit: "$",
        confidence: 1.5, // invalid: > 1
        source_quote: "Revenue is $1M",
      };

      const result = LLMFactorSchema.safeParse(factor);
      expect(result.success).toBe(false);
    });

    it("rejects factor with empty label", () => {
      const factor = {
        label: "",
        value: 1000000,
        unit: "$",
        confidence: 0.9,
        source_quote: "Revenue is $1M",
      };

      const result = LLMFactorSchema.safeParse(factor);
      expect(result.success).toBe(false);
    });

    it("rejects factor with unknown properties (strict mode)", () => {
      const factor = {
        label: "Revenue",
        value: 1000000,
        unit: "$",
        confidence: 0.9,
        source_quote: "Revenue is $1M",
        unknown_field: "should fail",
      };

      const result = LLMFactorSchema.safeParse(factor);
      expect(result.success).toBe(false);
    });
  });

  describe("LLMFactorExtractionResponseSchema", () => {
    it("accepts valid response", () => {
      const response = {
        factors: [
          {
            label: "Revenue",
            value: 1000000,
            unit: "$",
            confidence: 0.9,
            source_quote: "Revenue is $1M",
          },
        ],
      };

      const result = LLMFactorExtractionResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("accepts empty factors array", () => {
      const response = {
        factors: [],
      };

      const result = LLMFactorExtractionResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("rejects response without factors array", () => {
      const response = {
        data: [],
      };

      const result = LLMFactorExtractionResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });
  });

  describe("LLMConstraintSchema", () => {
    it("accepts valid max constraint", () => {
      const constraint = {
        label: "Budget",
        operator: "max",
        threshold: 500000,
        unit: "$",
        source_quote: "Budget not to exceed $500K",
      };

      const result = LLMConstraintSchema.safeParse(constraint);
      expect(result.success).toBe(true);
    });

    it("accepts valid min constraint", () => {
      const constraint = {
        label: "NPS",
        operator: "min",
        threshold: 40,
        unit: "points",
        source_quote: "NPS must be at least 40",
      };

      const result = LLMConstraintSchema.safeParse(constraint);
      expect(result.success).toBe(true);
    });

    it("rejects constraint with invalid operator", () => {
      const constraint = {
        label: "Budget",
        operator: "greater_than", // invalid
        threshold: 500000,
        unit: "$",
        source_quote: "Budget constraint",
      };

      const result = LLMConstraintSchema.safeParse(constraint);
      expect(result.success).toBe(false);
    });

    it("rejects constraint with empty label", () => {
      const constraint = {
        label: "",
        operator: "max",
        threshold: 500000,
        unit: "$",
        source_quote: "Budget constraint",
      };

      const result = LLMConstraintSchema.safeParse(constraint);
      expect(result.success).toBe(false);
    });

    it("rejects constraint with unknown properties (strict mode)", () => {
      const constraint = {
        label: "Budget",
        operator: "max",
        threshold: 500000,
        unit: "$",
        source_quote: "Budget constraint",
        extra_field: "should fail",
      };

      const result = LLMConstraintSchema.safeParse(constraint);
      expect(result.success).toBe(false);
    });
  });

  describe("LLMConstraintExtractionResponseSchema", () => {
    it("accepts valid response", () => {
      const response = {
        constraints: [
          {
            label: "Budget",
            operator: "max",
            threshold: 500000,
            unit: "$",
            source_quote: "Budget not to exceed $500K",
          },
        ],
      };

      const result = LLMConstraintExtractionResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("accepts empty constraints array", () => {
      const response = {
        constraints: [],
      };

      const result = LLMConstraintExtractionResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe("parseFactorExtractionResponse", () => {
    it("returns parsed response for valid input", () => {
      const response = {
        factors: [
          {
            label: "Revenue",
            value: 1000000,
            unit: "$",
            confidence: 0.9,
            source_quote: "Revenue is $1M",
          },
        ],
      };

      const result = parseFactorExtractionResponse(response);
      expect(result).not.toBeNull();
      expect(result?.factors).toHaveLength(1);
    });

    it("returns null for invalid input", () => {
      const response = {
        factors: [{ invalid: "data" }],
      };

      const result = parseFactorExtractionResponse(response);
      expect(result).toBeNull();
    });

    it("returns null for non-object input", () => {
      expect(parseFactorExtractionResponse(null)).toBeNull();
      expect(parseFactorExtractionResponse("string")).toBeNull();
      expect(parseFactorExtractionResponse(123)).toBeNull();
    });
  });

  describe("parseConstraintExtractionResponse", () => {
    it("returns parsed response for valid input", () => {
      const response = {
        constraints: [
          {
            label: "Budget",
            operator: "max",
            threshold: 500000,
            unit: "$",
            source_quote: "Budget not to exceed $500K",
          },
        ],
      };

      const result = parseConstraintExtractionResponse(response);
      expect(result).not.toBeNull();
      expect(result?.constraints).toHaveLength(1);
    });

    it("returns null for invalid input", () => {
      const response = {
        constraints: [{ operator: "invalid" }],
      };

      const result = parseConstraintExtractionResponse(response);
      expect(result).toBeNull();
    });
  });

  describe("flattenZodErrors", () => {
    it("flattens Zod errors to strings", () => {
      const result = LLMFactorSchema.safeParse({ label: "", value: "not a number" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = flattenZodErrors(result.error);
        expect(Array.isArray(errors)).toBe(true);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.every((e) => typeof e === "string")).toBe(true);
      }
    });

    it("includes path in error messages", () => {
      const result = LLMFactorExtractionResponseSchema.safeParse({
        factors: [{ label: "", value: 100, unit: "$", confidence: 0.9, source_quote: "test" }],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = flattenZodErrors(result.error);
        expect(errors.some((e) => e.includes("factors"))).toBe(true);
      }
    });
  });
});
