import { describe, it, expect } from "vitest";
import { estimateTokens, checkBudget } from "../../../../src/orchestrator/context-fabric/token-estimator.js";
import type { TokenBudget } from "../../../../src/orchestrator/context-fabric/types.js";

// ============================================================================
// estimateTokens
// ============================================================================

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 1 for 1-4 characters", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("ab")).toBe(1);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("returns 2 for 5-8 characters", () => {
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up (ceiling)", () => {
    expect(estimateTokens("abcdefghi")).toBe(3); // 9/4 = 2.25 → 3
  });

  it("handles known lengths", () => {
    const text = "x".repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it("handles large text", () => {
    const text = "x".repeat(40000);
    expect(estimateTokens(text)).toBe(10000);
  });
});

// ============================================================================
// checkBudget
// ============================================================================

describe("checkBudget", () => {
  const budget: TokenBudget = {
    zone1: 1000,
    zone2: 500,
    zone3: 5700,
    safety_margin: 800,
    effective_total: 7200, // floor(8000 * 0.9)
  };

  it("within_budget true when estimated <= effective_total", () => {
    const result = checkBudget(7000, budget);
    expect(result.within_budget).toBe(true);
    expect(result.overage).toBe(0);
  });

  it("within_budget true when estimated equals effective_total", () => {
    const result = checkBudget(7200, budget);
    expect(result.within_budget).toBe(true);
    expect(result.overage).toBe(0);
  });

  it("within_budget false when estimated > effective_total", () => {
    const result = checkBudget(8000, budget);
    expect(result.within_budget).toBe(false);
    expect(result.overage).toBe(800);
  });

  it("zone percentages are computed correctly", () => {
    const result = checkBudget(7000, budget);
    expect(result.zone1_pct).toBeCloseTo(1000 / 7200 * 100, 5);
    expect(result.zone2_pct).toBeCloseTo(500 / 7200 * 100, 5);
    expect(result.zone3_pct).toBeCloseTo(5700 / 7200 * 100, 5);
  });

  it("zone percentages sum to approximately 100%", () => {
    const result = checkBudget(7000, budget);
    const sum = result.zone1_pct + result.zone2_pct + result.zone3_pct;
    expect(sum).toBeCloseTo(100, 1);
  });

  it("handles zero effective_total without crashing", () => {
    const zeroBudget: TokenBudget = {
      zone1: 0,
      zone2: 0,
      zone3: 0,
      safety_margin: 0,
      effective_total: 0,
    };
    const result = checkBudget(100, zeroBudget);
    expect(result.within_budget).toBe(false);
    expect(result.overage).toBe(100);
    // Should not throw on division by zero
    expect(Number.isFinite(result.zone1_pct)).toBe(true);
  });
});
