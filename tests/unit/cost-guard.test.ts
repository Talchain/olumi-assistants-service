import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { estimateTokens, allowedCostUSD } from "../../src/utils/costGuard.js";

describe("Cost Guard", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Default cost cap of $1.00
    delete process.env.COST_MAX_USD;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("estimateTokens", () => {
    it("estimates tokens from character count (~4 chars per token)", () => {
      expect(estimateTokens(0)).toBe(0);
      expect(estimateTokens(4)).toBe(1);
      expect(estimateTokens(8)).toBe(2);
      expect(estimateTokens(400)).toBe(100);
      expect(estimateTokens(4000)).toBe(1000);
    });

    it("rounds up for partial tokens", () => {
      expect(estimateTokens(1)).toBe(1);
      expect(estimateTokens(5)).toBe(2);
      expect(estimateTokens(399)).toBe(100);
    });
  });

  describe("allowedCostUSD - Provider-specific pricing", () => {
    it("allows request within budget for Anthropic Claude Sonnet", () => {
      // 1000 input, 500 output tokens
      // Cost: (1000/1000 * $0.003) + (500/1000 * $0.015) = $0.003 + $0.0075 = $0.0105
      const allowed = allowedCostUSD(1000, 500, "claude-3-5-sonnet-20241022");
      expect(allowed).toBe(true);
    });

    it("allows request within budget for OpenAI gpt-4o-mini", () => {
      // 1000 input, 500 output tokens
      // Cost: (1000/1000 * $0.00015) + (500/1000 * $0.0006) = $0.00015 + $0.0003 = $0.00045
      const allowed = allowedCostUSD(1000, 500, "gpt-4o-mini");
      expect(allowed).toBe(true);
    });

    it("rejects request exceeding budget for expensive model", () => {
      // Set low budget
      process.env.COST_MAX_USD = "0.01";

      // 100K input, 50K output tokens with Claude Opus
      // Cost: (100000/1000 * $0.015) + (50000/1000 * $0.075) = $1.5 + $3.75 = $5.25
      const allowed = allowedCostUSD(100000, 50000, "claude-3-opus-20240229");
      expect(allowed).toBe(false);
    });

    it("respects custom COST_MAX_USD environment variable", () => {
      process.env.COST_MAX_USD = "0.001";

      // 1000 input, 500 output with Sonnet = $0.0105 (exceeds $0.001)
      const tooExpensive = allowedCostUSD(1000, 500, "claude-3-5-sonnet-20241022");
      expect(tooExpensive).toBe(false);

      // 100 input, 50 output with gpt-4o-mini = $0.000045 (within $0.001)
      const affordable = allowedCostUSD(100, 50, "gpt-4o-mini");
      expect(affordable).toBe(true);
    });

    it("uses correct pricing for different providers", () => {
      // Same token counts, different models, different costs
      const tokensIn = 2000;
      const tokensOut = 1000;

      // All should be allowed (under $1.00 default cap)
      expect(allowedCostUSD(tokensIn, tokensOut, "claude-3-5-sonnet-20241022")).toBe(true); // $0.021
      expect(allowedCostUSD(tokensIn, tokensOut, "claude-3-haiku-20240307")).toBe(true);    // $0.0018
      expect(allowedCostUSD(tokensIn, tokensOut, "gpt-4o")).toBe(true);                    // $0.015
      expect(allowedCostUSD(tokensIn, tokensOut, "gpt-4o-mini")).toBe(true);               // $0.00090
      expect(allowedCostUSD(tokensIn, tokensOut, "gpt-3.5-turbo")).toBe(true);             // $0.0025
    });

    it("handles unknown models gracefully (returns 0 cost, always allowed)", () => {
      // Unknown models return $0 from calculateCost
      const allowed = allowedCostUSD(1000000, 1000000, "unknown-model-xyz");
      expect(allowed).toBe(true); // $0 is always within budget
    });

    it("handles fixtures model (returns $0 cost, always allowed)", () => {
      const allowed = allowedCostUSD(1000000, 1000000, "fixture-v1");
      expect(allowed).toBe(true); // Fixtures have $0 cost
    });

    it("rejects infinite cost", () => {
      // Edge case: NaN or Infinity tokens
      const allowed = allowedCostUSD(Infinity, Infinity, "claude-3-5-sonnet-20241022");
      expect(allowed).toBe(false);
    });
  });

  describe("Real-world scenarios", () => {
    it("typical brief with attachments (4000 chars = ~1000 tokens)", () => {
      const promptChars = 4000;
      const tokensIn = estimateTokens(promptChars);
      const tokensOut = estimateTokens(1200); // Estimated output

      // Should be allowed for both providers
      expect(allowedCostUSD(tokensIn, tokensOut, "claude-3-5-sonnet-20241022")).toBe(true);
      expect(allowedCostUSD(tokensIn, tokensOut, "gpt-4o-mini")).toBe(true);
    });

    it("large brief with many attachments (exceeds budget)", () => {
      process.env.COST_MAX_USD = "0.05";

      const promptChars = 400000; // Very large prompt
      const tokensIn = estimateTokens(promptChars); // ~100K tokens
      const tokensOut = estimateTokens(12000); // ~3K output tokens

      // Should be rejected for expensive models
      expect(allowedCostUSD(tokensIn, tokensOut, "claude-3-opus-20240229")).toBe(false); // $1.50 + $0.225 = $1.725
      expect(allowedCostUSD(tokensIn, tokensOut, "gpt-4-turbo")).toBe(false);           // $1.00 + $0.09 = $1.09

      // But allowed for cheap models
      expect(allowedCostUSD(tokensIn, tokensOut, "gpt-4o-mini")).toBe(true);            // $0.015 + $0.0018 = $0.0168
      expect(allowedCostUSD(tokensIn, tokensOut, "claude-3-haiku-20240307")).toBe(true); // $0.025 + $0.00375 = $0.02875
    });
  });

  describe("Edge cases", () => {
    it("handles zero tokens", () => {
      expect(allowedCostUSD(0, 0, "claude-3-5-sonnet-20241022")).toBe(true);
    });

    it("handles very small token counts", () => {
      expect(allowedCostUSD(1, 1, "claude-3-5-sonnet-20241022")).toBe(true);
    });

    it("handles only input tokens", () => {
      expect(allowedCostUSD(1000, 0, "gpt-4o-mini")).toBe(true);
    });

    it("handles only output tokens", () => {
      expect(allowedCostUSD(0, 1000, "gpt-4o-mini")).toBe(true);
    });

    it("handles invalid COST_MAX_USD (falls back to default)", () => {
      process.env.COST_MAX_USD = "invalid";
      // NaN is not finite, so should reject
      const allowed = allowedCostUSD(1000, 1000, "claude-3-5-sonnet-20241022");
      expect(allowed).toBe(false);
    });
  });
});
