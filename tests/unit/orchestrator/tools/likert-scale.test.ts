import { describe, it, expect } from "vitest";
import {
  LIKERT_FREQUENCY_SCALE,
  parseLikertResponse,
  isProbabilityLikeFactor,
} from "../../../../src/orchestrator/tools/likert-scale.js";

// ============================================================================
// LIKERT_FREQUENCY_SCALE
// ============================================================================

describe("LIKERT_FREQUENCY_SCALE", () => {
  it("has exactly 7 entries", () => {
    expect(LIKERT_FREQUENCY_SCALE).toHaveLength(7);
  });

  it("maps each label to the correct normalised value", () => {
    const expected = [
      { label: "hardly ever", value: 0.01 },
      { label: "rarely", value: 0.10 },
      { label: "occasionally", value: 0.25 },
      { label: "sometimes", value: 0.40 },
      { label: "often", value: 0.60 },
      { label: "usually", value: 0.75 },
      { label: "almost always", value: 0.90 },
    ];
    for (let i = 0; i < expected.length; i++) {
      expect(LIKERT_FREQUENCY_SCALE[i].label).toBe(expected[i].label);
      expect(LIKERT_FREQUENCY_SCALE[i].value).toBe(expected[i].value);
    }
  });

  it("values are in ascending order", () => {
    for (let i = 1; i < LIKERT_FREQUENCY_SCALE.length; i++) {
      expect(LIKERT_FREQUENCY_SCALE[i].value).toBeGreaterThan(LIKERT_FREQUENCY_SCALE[i - 1].value);
    }
  });
});

// ============================================================================
// parseLikertResponse
// ============================================================================

describe("parseLikertResponse", () => {
  it("matches each label exactly", () => {
    expect(parseLikertResponse("hardly ever")).toBe(0.01);
    expect(parseLikertResponse("rarely")).toBe(0.10);
    expect(parseLikertResponse("occasionally")).toBe(0.25);
    expect(parseLikertResponse("sometimes")).toBe(0.40);
    expect(parseLikertResponse("often")).toBe(0.60);
    expect(parseLikertResponse("usually")).toBe(0.75);
    expect(parseLikertResponse("almost always")).toBe(0.90);
  });

  it("matches case-insensitively", () => {
    expect(parseLikertResponse("RARELY")).toBe(0.10);
    expect(parseLikertResponse("Sometimes")).toBe(0.40);
    expect(parseLikertResponse("ALMOST ALWAYS")).toBe(0.90);
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseLikertResponse("  often  ")).toBe(0.60);
    expect(parseLikertResponse("\tbarely ever\n")).toBeUndefined(); // "barely ever" not "hardly ever"
  });

  it("matches label embedded in a sentence", () => {
    expect(parseLikertResponse("I'd say it happens rarely")).toBe(0.10);
    expect(parseLikertResponse("this is almost always the case")).toBe(0.90);
  });

  it("returns undefined for unrecognized input", () => {
    expect(parseLikertResponse("banana")).toBeUndefined();
    expect(parseLikertResponse("50%")).toBeUndefined();
    expect(parseLikertResponse("")).toBeUndefined();
    expect(parseLikertResponse("never")).toBeUndefined();
  });

  it("matches 'hardly ever' before 'often' in 'hardly ever'", () => {
    expect(parseLikertResponse("hardly ever")).toBe(0.01);
  });

  it("does NOT match 'often' inside 'soften' (word boundary)", () => {
    expect(parseLikertResponse("soften the blow")).toBeUndefined();
  });

  it("does NOT match 'rarely' inside 'barely' (word boundary)", () => {
    expect(parseLikertResponse("barely visible")).toBeUndefined();
  });
});

// ============================================================================
// isProbabilityLikeFactor
// ============================================================================

describe("isProbabilityLikeFactor", () => {
  it("returns true for undefined factor_type (default)", () => {
    expect(isProbabilityLikeFactor(undefined)).toBe(true);
  });

  it("returns true for 'probability'", () => {
    expect(isProbabilityLikeFactor("probability")).toBe(true);
  });

  it("returns true for 'rate'", () => {
    expect(isProbabilityLikeFactor("rate")).toBe(true);
  });

  it("returns false for cost/revenue/quantity factor types", () => {
    expect(isProbabilityLikeFactor("cost")).toBe(false);
    expect(isProbabilityLikeFactor("price")).toBe(false);
    expect(isProbabilityLikeFactor("revenue")).toBe(false);
    expect(isProbabilityLikeFactor("demand")).toBe(false);
    expect(isProbabilityLikeFactor("time")).toBe(false);
    expect(isProbabilityLikeFactor("quality")).toBe(false);
    expect(isProbabilityLikeFactor("other")).toBe(false);
  });
});
