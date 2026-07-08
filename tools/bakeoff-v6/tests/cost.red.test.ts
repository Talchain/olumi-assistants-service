/**
 * RED-first: arm-D cost mis-attribution. Cost MUST come from
 * usage.iterations[] (executor + advisor priced at their OWN models); the
 * top-level token counts under-report and would make D look artificially
 * cheap. Also: unknown models are never priced silently, and the pricing
 * table carries staleness provenance.
 */
import { describe, expect, it } from "vitest";
import { computeCallCost, normalizeModelId } from "../src/compute/cost.ts";
import { costUsd, pricingStaleness, PRICING_TABLE, usdToOutputTokens } from "../src/llm/pricing.ts";

describe("cost attribution", () => {
  it("RED: iterations-based cost exceeds the misleading top-level cost and is attributed per model", () => {
    const result = {
      usage: { input_tokens: 900, output_tokens: 700 }, // top-level: final executor pass only
      iterations: [
        { type: "message", model: "claude-sonnet-4-6", input_tokens: 900, output_tokens: 700 },
        { type: "advisor_message", input_tokens: 400_000, output_tokens: 300_000 }, // no model field => advisor attribution
      ],
    };
    const withIterations = computeCallCost(result, "claude-sonnet-4-6", "claude-opus-4-8");
    const topLevelOnly = computeCallCost({ usage: result.usage, iterations: null }, "claude-sonnet-4-6");

    expect(withIterations.from_iterations).toBe(true);
    expect(topLevelOnly.from_iterations).toBe(false);
    expect(withIterations.cost_usd).toBeGreaterThan(topLevelOnly.cost_usd);

    // advisor slice priced at OPUS rates: 0.4M * $5 + 0.3M * $25 = $9.50
    const executor = costUsd("claude-sonnet-4-6", { input_tokens: 900, output_tokens: 700 });
    expect(withIterations.cost_usd).toBeCloseTo(executor + 9.5, 6);
  });

  it("supports nested usage objects inside iteration entries", () => {
    const result = {
      usage: { input_tokens: 1, output_tokens: 1 },
      iterations: [{ type: "message", model: "claude-opus-4-8", usage: { input_tokens: 1_000_000, output_tokens: 0 } }],
    };
    expect(computeCallCost(result, "claude-sonnet-4-6").cost_usd).toBeCloseTo(5.0, 6);
  });

  it("refuses to price an unknown model silently", () => {
    expect(() => costUsd("claude-mystery-9", { input_tokens: 10 })).toThrow(/refusing to price silently/);
  });

  it("normalizes date-suffixed served ids onto pinned aliases", () => {
    expect(normalizeModelId("claude-sonnet-4-6-20251114")).toBe("claude-sonnet-4-6");
    expect(normalizeModelId("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(normalizeModelId("gpt-5.1")).toBe("gpt-5.1"); // unknown family passes through and will throw at pricing
  });

  it("cache tokens are priced (reads 0.1x input, 5m writes 1.25x input)", () => {
    const cost = costUsd("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3 + 3.75, 6);
  });

  it("usd -> output-token budget uses B's own output price", () => {
    expect(usdToOutputTokens(25, "claude-opus-4-8")).toBe(1_000_000);
  });

  it("pricing table carries provenance and a stale warning past 30 days", () => {
    expect(PRICING_TABLE.source).toContain("platform.claude.com");
    expect(PRICING_TABLE.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRICING_TABLE.entered).toBe("manual");
    expect(PRICING_TABLE.currency).toBe("USD");

    const asOf = new Date(PRICING_TABLE.as_of + "T00:00:00Z");
    const fresh = pricingStaleness(new Date(asOf.getTime() + 10 * 86_400_000));
    const stale = pricingStaleness(new Date(asOf.getTime() + 40 * 86_400_000));
    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.age_days).toBe(40);
  });
});
