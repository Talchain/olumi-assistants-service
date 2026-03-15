/**
 * Currency signal — unit tests for currency detection and prompt injection.
 *
 * Verifies `detectCurrency()` correctly extracts currency from brief text
 * and `buildCurrencyInstruction()` formats the LLM prompt addition.
 */
import { describe, it, expect } from "vitest";
import {
  detectCurrency,
  buildCurrencyInstruction,
  type CurrencySignal,
} from "../../src/cee/signals/currency-signal.js";

// ============================================================================
// detectCurrency — explicit symbols
// ============================================================================

describe("detectCurrency — explicit symbols", () => {
  it("detects £ symbol → GBP", () => {
    const result = detectCurrency("We have a £50k budget for this project");
    expect(result).toEqual({ symbol: "£", code: "GBP" });
  });

  it("detects $ symbol → USD", () => {
    const result = detectCurrency("The product costs $100k ARR");
    expect(result).toEqual({ symbol: "$", code: "USD" });
  });

  it("detects € symbol → EUR", () => {
    const result = detectCurrency("Budget is €200k for the European launch");
    expect(result).toEqual({ symbol: "€", code: "EUR" });
  });
});

// ============================================================================
// detectCurrency — explicit codes
// ============================================================================

describe("detectCurrency — explicit codes", () => {
  it("detects GBP code", () => {
    const result = detectCurrency("The total cost is 50,000 GBP");
    expect(result).toEqual({ symbol: "£", code: "GBP" });
  });

  it("detects USD code", () => {
    const result = detectCurrency("Revenue target: 1M USD");
    expect(result).toEqual({ symbol: "$", code: "USD" });
  });

  it("detects EUR code", () => {
    const result = detectCurrency("Operating cost: 500k EUR annually");
    expect(result).toEqual({ symbol: "€", code: "EUR" });
  });

  it("detects AUD code", () => {
    const result = detectCurrency("Budget: 200k AUD for Melbourne office");
    expect(result).toEqual({ symbol: "A$", code: "AUD" });
  });

  it("detects CAD code", () => {
    const result = detectCurrency("Costs in CAD for Toronto expansion");
    expect(result).toEqual({ symbol: "C$", code: "CAD" });
  });

  it("detects A$ notation", () => {
    const result = detectCurrency("The cost is A$50,000");
    expect(result).toEqual({ symbol: "A$", code: "AUD" });
  });

  it("detects lowercase a$ notation", () => {
    const result = detectCurrency("Budget is a$200k");
    expect(result).toEqual({ symbol: "A$", code: "AUD" });
  });

  it("detects C$ notation", () => {
    const result = detectCurrency("Budget of C$100k");
    expect(result).toEqual({ symbol: "C$", code: "CAD" });
  });

  it("detects lowercase c$ notation", () => {
    const result = detectCurrency("Total: c$50k");
    expect(result).toEqual({ symbol: "C$", code: "CAD" });
  });
});

// ============================================================================
// detectCurrency — contextual inference
// ============================================================================

describe("detectCurrency — contextual inference", () => {
  it("'UK startup' with no symbol → GBP", () => {
    const result = detectCurrency("We are a UK startup considering our hiring strategy");
    expect(result).toEqual({ symbol: "£", code: "GBP" });
  });

  it("'United Kingdom' → GBP", () => {
    const result = detectCurrency("Expanding into the United Kingdom market");
    expect(result).toEqual({ symbol: "£", code: "GBP" });
  });

  it("'British' → GBP", () => {
    const result = detectCurrency("Targeting British consumers with a new product");
    expect(result).toEqual({ symbol: "£", code: "GBP" });
  });

  it("'.co.uk' → GBP", () => {
    const result = detectCurrency("Our website shop.co.uk needs an upgrade");
    expect(result).toEqual({ symbol: "£", code: "GBP" });
  });

  it("'United States' → USD", () => {
    const result = detectCurrency("Launching in the United States next quarter");
    expect(result).toEqual({ symbol: "$", code: "USD" });
  });

  it("'American' → USD", () => {
    const result = detectCurrency("Targeting American enterprise customers");
    expect(result).toEqual({ symbol: "$", code: "USD" });
  });

  it("'U.S.' with periods → USD", () => {
    const result = detectCurrency("Our U.S. operations need restructuring");
    expect(result).toEqual({ symbol: "$", code: "USD" });
  });

  it("'European market' → EUR", () => {
    const result = detectCurrency("We want to enter the European market");
    expect(result).toEqual({ symbol: "€", code: "EUR" });
  });

  it("'EU' → EUR", () => {
    const result = detectCurrency("Our EU expansion plan needs evaluation");
    expect(result).toEqual({ symbol: "€", code: "EUR" });
  });

  it("'Australian' → AUD", () => {
    const result = detectCurrency("Growing our Australian customer base");
    expect(result).toEqual({ symbol: "A$", code: "AUD" });
  });

  it("'Canadian' → CAD", () => {
    const result = detectCurrency("Opening a Canadian office in Toronto");
    expect(result).toEqual({ symbol: "C$", code: "CAD" });
  });
});

// ============================================================================
// detectCurrency — ambiguous / absent
// ============================================================================

describe("detectCurrency — ambiguous and absent", () => {
  it("returns null when both £ and $ are present", () => {
    const result = detectCurrency("Budget is £50k but US costs are $30k");
    expect(result).toBeNull();
  });

  it("returns null when £ and € are both present", () => {
    const result = detectCurrency("London office: £100k, Berlin office: €80k");
    expect(result).toBeNull();
  });

  it("returns null when no currency indicators at all", () => {
    const result = detectCurrency("Should we hire a new developer for the team?");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = detectCurrency("");
    expect(result).toBeNull();
  });

  it("returns null when multiple contextual locales are present", () => {
    const result = detectCurrency("We operate in both the UK and the United States");
    expect(result).toBeNull();
  });

  it("explicit symbol wins over conflicting contextual", () => {
    // Brief says "UK" but uses $ — explicit wins
    const result = detectCurrency("Our UK subsidiary has a $500k budget");
    // £ from contextual UK, $ from explicit — both in explicit pass for $, contextual for £
    // $ is explicit (pass 1), UK triggers contextual GBP (pass 3)
    // Since explicit has exactly 1, return it
    expect(result).toEqual({ symbol: "$", code: "USD" });
  });
});

// ============================================================================
// detectCurrency — edge cases
// ============================================================================

describe("detectCurrency — edge cases", () => {
  it("handles brief with only numbers, no currency", () => {
    const result = detectCurrency("We need to decide between 3 options for 2026");
    expect(result).toBeNull();
  });

  it("'US' as word boundary — does not match 'focus'", () => {
    const result = detectCurrency("We must focus on customer retention");
    expect(result).toBeNull();
  });

  it("'us' pronoun does not trigger USD detection", () => {
    const result = detectCurrency("Let us decide what to do next");
    expect(result).toBeNull();
  });

  it("single $ in brief is enough", () => {
    const result = detectCurrency("Total: $5M");
    expect(result).toEqual({ symbol: "$", code: "USD" });
  });

  it("case-insensitive code matching", () => {
    const result = detectCurrency("Budget in gbp: 50k");
    expect(result).toEqual({ symbol: "£", code: "GBP" });
  });
});

// ============================================================================
// buildCurrencyInstruction
// ============================================================================

describe("buildCurrencyInstruction", () => {
  it("includes detected symbol and code when signal present", () => {
    const instruction = buildCurrencyInstruction({ symbol: "£", code: "GBP" });
    expect(instruction).toContain("[CURRENCY_CONTEXT]");
    expect(instruction).toContain("£");
    expect(instruction).toContain("GBP");
    expect(instruction).toContain("Use £ for all cost, revenue, price, and budget factors");
  });

  it("includes USD when dollar detected", () => {
    const instruction = buildCurrencyInstruction({ symbol: "$", code: "USD" });
    expect(instruction).toContain("$");
    expect(instruction).toContain("USD");
  });

  it("uses £ default when no signal detected", () => {
    const instruction = buildCurrencyInstruction(null);
    expect(instruction).toContain("[CURRENCY_CONTEXT]");
    expect(instruction).toContain("No specific currency was detected");
    expect(instruction).toContain("£ (GBP)");
  });

  it("starts with newlines for clean prompt concatenation", () => {
    const instruction = buildCurrencyInstruction({ symbol: "€", code: "EUR" });
    expect(instruction.startsWith("\n\n")).toBe(true);
  });
});
