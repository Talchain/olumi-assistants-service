import { describe, it, expect } from "vitest";
import { detectArchetype } from "../../../../src/orchestrator/pipeline/phase1-enrichment/archetype-detector.js";

describe("archetype-detector", () => {
  it("detects 'pricing' with high confidence (≥2 keywords)", () => {
    const result = detectArchetype("Should I increase the price and improve our revenue?", null);
    expect(result.type).toBe("pricing");
    expect(result.confidence).toBe("high");
    expect(result.evidence).toContain("price");
    expect(result.evidence).toContain("revenue");
  });

  it("detects 'pricing' with medium confidence (1 keyword)", () => {
    const result = detectArchetype("Should I raise prices?", null);
    expect(result.type).toBe("pricing");
    expect(result.confidence).toBe("medium");
  });

  it("detects 'build_vs_buy' with high confidence", () => {
    const result = detectArchetype("Should we build or buy the solution from a vendor?", null);
    expect(result.type).toBe("build_vs_buy");
    expect(result.confidence).toBe("high");
  });

  it("detects 'hiring' with high confidence", () => {
    const result = detectArchetype("We need to hire a new candidate for the team role", null);
    expect(result.type).toBe("hiring");
    expect(result.confidence).toBe("high");
  });

  it("detects 'market_entry' with high confidence", () => {
    const result = detectArchetype("We want to expand into a new market and launch in a new region", null);
    expect(result.type).toBe("market_entry");
    expect(result.confidence).toBe("high");
  });

  it("detects 'resource_allocation' with high confidence", () => {
    const result = detectArchetype("We need to allocate more budget and invest wisely", null);
    expect(result.type).toBe("resource_allocation");
    expect(result.confidence).toBe("high");
  });

  it("returns null type with low confidence when no keywords match", () => {
    const result = detectArchetype("Hello, how are you?", null);
    expect(result.type).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.evidence).toBe("no keywords matched");
  });

  it("includes framing goal in keyword search", () => {
    const result = detectArchetype("Help me decide", {
      stage: "frame" as const,
      goal: "Determine the right pricing and revenue model",
    });
    expect(result.type).toBe("pricing");
    expect(result.confidence).toBe("high");
  });

  it("handles null framing", () => {
    const result = detectArchetype("What should I do?", null);
    expect(result.type).toBeNull();
    expect(result.confidence).toBe("low");
  });
});
