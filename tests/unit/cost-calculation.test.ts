import { describe, it, expect } from "vitest";
import { calculateCost, TelemetryEvents } from "../../src/utils/telemetry.js";
import { TelemetrySink } from "../utils/telemetry-sink.js";

describe("Cost Calculation", () => {
  describe("Anthropic pricing", () => {
    it("calculates cost for claude-3-5-sonnet-20241022", () => {
      // 1000 input tokens, 500 output tokens
      const cost = calculateCost("claude-3-5-sonnet-20241022", 1000, 500);

      // $3 per 1M input = $0.003 per 1K → 1K * $0.003 = $0.003
      // $15 per 1M output = $0.015 per 1K → 0.5K * $0.015 = $0.0075
      // Total: $0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it("calculates cost for claude-3-opus-20240229", () => {
      // 1000 input tokens, 1000 output tokens
      const cost = calculateCost("claude-3-opus-20240229", 1000, 1000);

      // $15 per 1M input = $0.015 per 1K → 1K * $0.015 = $0.015
      // $75 per 1M output = $0.075 per 1K → 1K * $0.075 = $0.075
      // Total: $0.09
      expect(cost).toBeCloseTo(0.09, 6);
    });

    it("calculates cost for claude-3-haiku-20240307", () => {
      // 1000 input tokens, 1000 output tokens
      const cost = calculateCost("claude-3-haiku-20240307", 1000, 1000);

      // $0.25 per 1M input = $0.00025 per 1K → 1K * $0.00025 = $0.00025
      // $1.25 per 1M output = $0.00125 per 1K → 1K * $0.00125 = $0.00125
      // Total: $0.0015
      expect(cost).toBeCloseTo(0.0015, 6);
    });
  });

  describe("OpenAI pricing", () => {
    it("calculates cost for gpt-4o-mini", () => {
      // 1000 input tokens, 500 output tokens
      const cost = calculateCost("gpt-4o-mini", 1000, 500);

      // $0.15 per 1M input = $0.00015 per 1K → 1K * $0.00015 = $0.00015
      // $0.60 per 1M output = $0.0006 per 1K → 0.5K * $0.0006 = $0.0003
      // Total: $0.00045
      expect(cost).toBeCloseTo(0.00045, 6);
    });

    it("calculates cost for gpt-4o", () => {
      // 1000 input tokens, 1000 output tokens
      const cost = calculateCost("gpt-4o", 1000, 1000);

      // $2.50 per 1M input = $0.0025 per 1K → 1K * $0.0025 = $0.0025
      // $10 per 1M output = $0.01 per 1K → 1K * $0.01 = $0.01
      // Total: $0.0125
      expect(cost).toBeCloseTo(0.0125, 6);
    });

    it("calculates cost for gpt-4-turbo", () => {
      // 1000 input tokens, 1000 output tokens
      const cost = calculateCost("gpt-4-turbo", 1000, 1000);

      // $10 per 1M input = $0.01 per 1K → 1K * $0.01 = $0.01
      // $30 per 1M output = $0.03 per 1K → 1K * $0.03 = $0.03
      // Total: $0.04
      expect(cost).toBeCloseTo(0.04, 6);
    });

    it("calculates cost for gpt-3.5-turbo", () => {
      // 1000 input tokens, 1000 output tokens
      const cost = calculateCost("gpt-3.5-turbo", 1000, 1000);

      // $0.50 per 1M input = $0.0005 per 1K → 1K * $0.0005 = $0.0005
      // $1.50 per 1M output = $0.0015 per 1K → 1K * $0.0015 = $0.0015
      // Total: $0.002
      expect(cost).toBeCloseTo(0.002, 6);
    });
  });

  describe("Fixtures and unknown models", () => {
    it("returns 0 for fixture-v1 without emitting unknown-model telemetry", async () => {
      const sink = new TelemetrySink();
      await sink.install();
      try {
        const cost = calculateCost("fixture-v1", 1000, 1000);
        expect(cost).toBe(0);
        expect(sink.hasEvent(TelemetryEvents.CostCalculationUnknownModel)).toBe(false);
      } finally {
        sink.uninstall();
      }
    });

    it("returns 0 for unknown models and emits CostCalculationUnknownModel telemetry", async () => {
      const sink = new TelemetrySink();
      await sink.install();
      try {
        const cost = calculateCost("unknown-model-123", 1000, 1000);
        expect(cost).toBe(0);
        expect(
          sink.hasEventWithTags(TelemetryEvents.CostCalculationUnknownModel, {
            model: "unknown-model-123",
          }),
        ).toBe(true);
      } finally {
        sink.uninstall();
      }
    });
  });

  describe("Real-world scenarios", () => {
    it("calculates realistic draft graph cost with Anthropic", () => {
      // Typical draft: 2000 input tokens, 1200 output tokens
      const cost = calculateCost("claude-3-5-sonnet-20241022", 2000, 1200);

      // Input: 2K * $0.003 = $0.006
      // Output: 1.2K * $0.015 = $0.018
      // Total: $0.024
      expect(cost).toBeCloseTo(0.024, 6);
    });

    it("calculates realistic draft graph cost with OpenAI", () => {
      // Typical draft: 2000 input tokens, 1200 output tokens
      const cost = calculateCost("gpt-4o-mini", 2000, 1200);

      // Input: 2K * $0.00015 = $0.0003
      // Output: 1.2K * $0.0006 = $0.00072
      // Total: $0.00102
      expect(cost).toBeCloseTo(0.00102, 6);
    });

    it("shows OpenAI is ~23x cheaper than Anthropic for typical request", () => {
      const anthropicCost = calculateCost("claude-3-5-sonnet-20241022", 2000, 1200);
      const openaiCost = calculateCost("gpt-4o-mini", 2000, 1200);

      const ratio = anthropicCost / openaiCost;
      expect(ratio).toBeGreaterThan(20);
      expect(ratio).toBeLessThan(25);
    });
  });

  describe("Mixed-provider cost scenarios", () => {
    it("calculates separate costs when draft and repair use different providers", () => {
      // Scenario: Draft with OpenAI, repair with Anthropic
      const draftTokensIn = 2000;
      const draftTokensOut = 1200;
      const repairTokensIn = 500;
      const repairTokensOut = 300;

      // Calculate costs separately (correct approach)
      const draftCost = calculateCost("gpt-4o-mini", draftTokensIn, draftTokensOut);
      const repairCost = calculateCost("claude-3-5-sonnet-20241022", repairTokensIn, repairTokensOut);
      const totalCost = draftCost + repairCost;

      // Draft: 2K * $0.00015 + 1.2K * $0.0006 = $0.0003 + $0.00072 = $0.00102
      expect(draftCost).toBeCloseTo(0.00102, 6);
      // Repair: 0.5K * $0.003 + 0.3K * $0.015 = $0.0015 + $0.0045 = $0.006
      expect(repairCost).toBeCloseTo(0.006, 6);
      // Total: $0.00102 + $0.006 = $0.00702
      expect(totalCost).toBeCloseTo(0.00702, 6);
    });

    it("shows incorrect cost when using single provider pricing for mixed providers", () => {
      // Scenario: Draft with Anthropic, repair with OpenAI
      const draftTokensIn = 1000;
      const draftTokensOut = 800;
      const repairTokensIn = 500;
      const repairTokensOut = 200;

      // Correct approach: separate calculations
      const draftCost = calculateCost("claude-3-5-sonnet-20241022", draftTokensIn, draftTokensOut);
      const repairCost = calculateCost("gpt-4o-mini", repairTokensIn, repairTokensOut);
      const correctTotal = draftCost + repairCost;

      // Draft: 1K * $0.003 + 0.8K * $0.015 = $0.003 + $0.012 = $0.015
      // Repair: 0.5K * $0.00015 + 0.2K * $0.0006 = $0.000075 + $0.00012 = $0.000195
      // Correct total: $0.015195
      expect(correctTotal).toBeCloseTo(0.015195, 6);

      // WRONG approach: sum all tokens then price with draft model only
      const totalTokensIn = draftTokensIn + repairTokensIn;
      const totalTokensOut = draftTokensOut + repairTokensOut;
      const wrongTotal = calculateCost("claude-3-5-sonnet-20241022", totalTokensIn, totalTokensOut);

      // Wrong: 1.5K * $0.003 + 1K * $0.015 = $0.0045 + $0.015 = $0.0195
      expect(wrongTotal).toBeCloseTo(0.0195, 6);

      // The wrong approach overstates cost by ~28% in this case
      expect(wrongTotal).toBeGreaterThan(correctTotal);
      const overstatementPercent = ((wrongTotal - correctTotal) / correctTotal) * 100;
      expect(overstatementPercent).toBeGreaterThan(25);
    });

    it("tracks hybrid strategy cost savings (Anthropic draft, OpenAI repair)", () => {
      // Common pattern: Use high-quality provider for initial draft,
      // cheaper provider for repairs/suggestions
      const draftTokensIn = 2000;
      const draftTokensOut = 1500;
      const repairTokensIn = 800;
      const repairTokensOut = 400;

      // Strategy 1: All Anthropic Claude Sonnet
      const allAnthropicCost =
        calculateCost("claude-3-5-sonnet-20241022", draftTokensIn, draftTokensOut) +
        calculateCost("claude-3-5-sonnet-20241022", repairTokensIn, repairTokensOut);

      // All Anthropic: (2K * $0.003 + 1.5K * $0.015) + (0.8K * $0.003 + 0.4K * $0.015)
      //              = ($0.006 + $0.0225) + ($0.0024 + $0.006)
      //              = $0.0285 + $0.0084 = $0.0369
      expect(allAnthropicCost).toBeCloseTo(0.0369, 6);

      // Strategy 2: Hybrid (Anthropic draft, OpenAI repair)
      const hybridCost =
        calculateCost("claude-3-5-sonnet-20241022", draftTokensIn, draftTokensOut) +
        calculateCost("gpt-4o-mini", repairTokensIn, repairTokensOut);

      // Hybrid: ($0.006 + $0.0225) + (0.8K * $0.00015 + 0.4K * $0.0006)
      //       = $0.0285 + ($0.00012 + $0.00024)
      //       = $0.0285 + $0.00036 = $0.02886
      expect(hybridCost).toBeCloseTo(0.02886, 6);

      // Savings: ~22% cost reduction
      const savings = ((allAnthropicCost - hybridCost) / allAnthropicCost) * 100;
      expect(savings).toBeGreaterThan(20);
      expect(savings).toBeLessThan(23);
    });

    it("tracks extreme cost difference when OpenAI draft, Anthropic Opus repair", () => {
      // Worst case: Cheap draft, expensive repair (unusual but possible)
      const draftTokensIn = 1000;
      const draftTokensOut = 500;
      const repairTokensIn = 1000;
      const repairTokensOut = 500;

      const draftCost = calculateCost("gpt-4o-mini", draftTokensIn, draftTokensOut);
      const repairCost = calculateCost("claude-3-opus-20240229", repairTokensIn, repairTokensOut);

      // Draft: 1K * $0.00015 + 0.5K * $0.0006 = $0.00015 + $0.0003 = $0.00045
      // Repair: 1K * $0.015 + 0.5K * $0.075 = $0.015 + $0.0375 = $0.0525
      // Repair is ~117x more expensive than draft!
      expect(draftCost).toBeCloseTo(0.00045, 6);
      expect(repairCost).toBeCloseTo(0.0525, 6);

      const ratio = repairCost / draftCost;
      expect(ratio).toBeGreaterThan(115);
      expect(ratio).toBeLessThan(120);
    });

    it("verifies fixtures provider never contributes to cost", () => {
      // Mixed scenario: Real provider + fixtures (should only count real provider)
      const realTokensIn = 1000;
      const realTokensOut = 500;
      const fixtureTokensIn = 1000000; // Large but should be $0
      const fixtureTokensOut = 1000000;

      const realCost = calculateCost("gpt-4o-mini", realTokensIn, realTokensOut);
      const fixtureCost = calculateCost("fixture-v1", fixtureTokensIn, fixtureTokensOut);
      const totalCost = realCost + fixtureCost;

      // Total cost should equal only the real provider cost
      expect(fixtureCost).toBe(0);
      expect(totalCost).toBeCloseTo(realCost, 6);
    });
  });
});
