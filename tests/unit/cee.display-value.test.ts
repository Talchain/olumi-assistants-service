/**
 * Unit tests for synthesiseDisplayValue and synthesiseRangeDisplayValue.
 *
 * Covers all formatting branches: currency, percentage, time, plain number,
 * qualitative band, missing data, and range variants for external factor priors.
 */

import { describe, it, expect } from "vitest";
import {
  synthesiseDisplayValue,
  synthesiseRangeDisplayValue,
} from "../../src/cee/factor-extraction/display-value.js";

// ============================================================================
// synthesiseDisplayValue — golden fixtures from spec
// ============================================================================

describe("synthesiseDisplayValue — spec golden fixtures", () => {
  it("percentage via raw_value + unit", () => {
    expect(
      synthesiseDisplayValue({ value: 0.03, raw_value: 3, unit: "%", factor_type: "probability" }),
    ).toBe("3%");
  });

  it("currency via raw_value + unit", () => {
    expect(
      synthesiseDisplayValue({ value: 0.5, raw_value: 500000, unit: "£", factor_type: "cost" }),
    ).toBe("£500k");
  });

  it("qualitative band when only value + factor_type", () => {
    expect(
      synthesiseDisplayValue({ value: 0.15, factor_type: "quality" }),
    ).toBe("Low (0.15)");
  });

  it("bare normalised value as last resort", () => {
    expect(synthesiseDisplayValue({ value: 0.72 })).toBe("0.72");
  });
});

// ============================================================================
// synthesiseDisplayValue — currency formatting
// ============================================================================

describe("synthesiseDisplayValue — currency", () => {
  it("formats £ thousands with k suffix", () => {
    expect(synthesiseDisplayValue({ raw_value: 40000, unit: "£" })).toBe("£40k");
  });

  it("formats £ millions with m suffix", () => {
    expect(synthesiseDisplayValue({ raw_value: 2000000, unit: "£" })).toBe("£2m");
  });

  it("formats fractional millions", () => {
    expect(synthesiseDisplayValue({ raw_value: 2100000, unit: "£" })).toBe("£2.1m");
  });

  it("formats $ currency", () => {
    expect(synthesiseDisplayValue({ raw_value: 1500, unit: "$" })).toBe("$1.5k");
  });

  it("formats € currency", () => {
    expect(synthesiseDisplayValue({ raw_value: 250000, unit: "€" })).toBe("€250k");
  });

  it("formats GBP alias", () => {
    expect(synthesiseDisplayValue({ raw_value: 500000, unit: "GBP" })).toBe("£500k");
  });

  it("formats sub-thousand currency without suffix", () => {
    expect(synthesiseDisplayValue({ raw_value: 950, unit: "£" })).toBe("£950");
  });

  it("formats exact 1000 as 1k", () => {
    expect(synthesiseDisplayValue({ raw_value: 1000, unit: "£" })).toBe("£1k");
  });
});

// ============================================================================
// synthesiseDisplayValue — percentage
// ============================================================================

describe("synthesiseDisplayValue — percentage", () => {
  it("formats raw_value percentage directly", () => {
    expect(synthesiseDisplayValue({ raw_value: 3, unit: "%" })).toBe("3%");
  });

  it("normalised value with % unit — multiplies by 100", () => {
    expect(synthesiseDisplayValue({ value: 0.03, unit: "%" })).toBe("3%");
  });

  it("normalised value already > 1 with % — no double multiply", () => {
    expect(synthesiseDisplayValue({ value: 25, unit: "%" })).toBe("25%");
  });

  it("fractional percentage", () => {
    expect(synthesiseDisplayValue({ raw_value: 7.5, unit: "%" })).toBe("7.5%");
  });
});

// ============================================================================
// synthesiseDisplayValue — time units
// ============================================================================

describe("synthesiseDisplayValue — time units", () => {
  it("formats days", () => {
    expect(synthesiseDisplayValue({ raw_value: 42, unit: "days" })).toBe("42 days");
  });

  it("formats months", () => {
    expect(synthesiseDisplayValue({ raw_value: 18, unit: "months" })).toBe("18 months");
  });

  it("formats weeks", () => {
    expect(synthesiseDisplayValue({ raw_value: 6, unit: "weeks" })).toBe("6 weeks");
  });

  it("formats fractional months", () => {
    expect(synthesiseDisplayValue({ raw_value: 3.5, unit: "months" })).toBe("3.5 months");
  });

  it("case-insensitive unit matching", () => {
    expect(synthesiseDisplayValue({ raw_value: 10, unit: "Months" })).toBe("10 months");
  });
});

// ============================================================================
// synthesiseDisplayValue — plain numbers (no unit)
// ============================================================================

describe("synthesiseDisplayValue — plain numbers", () => {
  it("formats integer with thousands separator", () => {
    const result = synthesiseDisplayValue({ raw_value: 500000 });
    expect(result).toBe("500,000");
  });

  it("formats small integer", () => {
    expect(synthesiseDisplayValue({ raw_value: 5 })).toBe("5");
  });

  it("formats number with other unit", () => {
    expect(synthesiseDisplayValue({ raw_value: 5, unit: "people" })).toBe("5 people");
  });
});

// ============================================================================
// synthesiseDisplayValue — qualitative bands
// ============================================================================

describe("synthesiseDisplayValue — qualitative bands", () => {
  it("0.1 → Low", () => {
    expect(synthesiseDisplayValue({ value: 0.1, factor_type: "quality" })).toBe("Low (0.1)");
  });

  it("0.25 boundary → Low", () => {
    expect(synthesiseDisplayValue({ value: 0.25, factor_type: "quality" })).toBe("Low (0.25)");
  });

  it("0.3 → Moderate", () => {
    expect(synthesiseDisplayValue({ value: 0.3, factor_type: "quality" })).toBe("Moderate (0.3)");
  });

  it("0.5 boundary → Moderate", () => {
    expect(synthesiseDisplayValue({ value: 0.5, factor_type: "quality" })).toBe("Moderate (0.5)");
  });

  it("0.6 → High", () => {
    expect(synthesiseDisplayValue({ value: 0.6, factor_type: "quality" })).toBe("High (0.6)");
  });

  it("0.75 boundary → High", () => {
    expect(synthesiseDisplayValue({ value: 0.75, factor_type: "quality" })).toBe("High (0.75)");
  });

  it("0.9 → Very high", () => {
    expect(synthesiseDisplayValue({ value: 0.9, factor_type: "quality" })).toBe("Very high (0.9)");
  });
});

// ============================================================================
// synthesiseDisplayValue — edge cases
// ============================================================================

describe("synthesiseDisplayValue — edge cases", () => {
  it("returns undefined when no data", () => {
    expect(synthesiseDisplayValue({})).toBeUndefined();
  });

  it("returns undefined when value is NaN", () => {
    expect(synthesiseDisplayValue({ value: NaN })).toBeUndefined();
  });

  it("caps output at 50 characters", () => {
    const result = synthesiseDisplayValue({ raw_value: 123456789012345, unit: "£" });
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(50);
  });

  it("does not overwrite non-NaN zero value", () => {
    const result = synthesiseDisplayValue({ value: 0, factor_type: "probability" });
    expect(result).toBe("Low (0)");
  });
});

// ============================================================================
// synthesiseRangeDisplayValue — spec golden fixtures
// ============================================================================

describe("synthesiseRangeDisplayValue — spec golden fixtures", () => {
  it("currency range", () => {
    expect(
      synthesiseRangeDisplayValue(
        { range_min: 200000, range_max: 500000 },
        "£",
        "cost",
      ),
    ).toBe("£200k to £500k");
  });

  it("percentage range", () => {
    expect(
      synthesiseRangeDisplayValue(
        { range_min: 0.1, range_max: 0.25 },
        "%",
        "probability",
      ),
    ).toBe("10% to 25%");
  });

  it("max-only bound", () => {
    expect(
      synthesiseRangeDisplayValue({ range_max: 500000 }, "£"),
    ).toBe("Up to £500k");
  });
});

// ============================================================================
// synthesiseRangeDisplayValue — one-bound variants
// ============================================================================

describe("synthesiseRangeDisplayValue — one-bound", () => {
  it("min-only bound currency", () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 200000 }, "£"),
    ).toBe("At least £200k");
  });

  it("min-only percentage", () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0.1 }, "%"),
    ).toBe("At least 10%");
  });

  it("max-only time range", () => {
    expect(
      synthesiseRangeDisplayValue({ range_max: 8 }, "months"),
    ).toBe("Up to 8 months");
  });
});

// ============================================================================
// synthesiseRangeDisplayValue — no data
// ============================================================================

describe("synthesiseRangeDisplayValue — no data", () => {
  it("returns undefined when no bounds and no distribution", () => {
    expect(synthesiseRangeDisplayValue({})).toBeUndefined();
  });

  it("returns Estimated (uncertain) when only distribution present", () => {
    expect(
      synthesiseRangeDisplayValue({ distribution: "normal" }),
    ).toBe("Estimated (uncertain)");
  });
});

// ============================================================================
// synthesiseRangeDisplayValue — range with months
// ============================================================================

describe("synthesiseRangeDisplayValue — time range", () => {
  it("formats months range", () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 3, range_max: 8 }, "months"),
    ).toBe("3 to 8 months");
  });
});

// ============================================================================
// Negative value handling (Finding 2 regression)
// ============================================================================

describe("synthesiseDisplayValue — negative currency values", () => {
  it("formats negative thousands with sign before amount", () => {
    expect(synthesiseDisplayValue({ raw_value: -500000, unit: "£" })).toBe("£-500k");
  });

  it("formats negative millions", () => {
    expect(synthesiseDisplayValue({ raw_value: -2000000, unit: "£" })).toBe("£-2m");
  });

  it("formats negative sub-thousand", () => {
    expect(synthesiseDisplayValue({ raw_value: -500, unit: "£" })).toBe("£-500");
  });

  it("formats negative fractional millions", () => {
    expect(synthesiseDisplayValue({ raw_value: -1500000, unit: "$" })).toBe("$-1.5m");
  });
});

// ============================================================================
// synthesiseRangeDisplayValue — negative percentage bound (Finding 4 regression)
// ============================================================================

describe("synthesiseRangeDisplayValue — percentage edge cases", () => {
  it("does not multiply values outside 0-1 range by 100", () => {
    // range_min/max already in display-percentage form (25 = 25%)
    expect(
      synthesiseRangeDisplayValue({ range_min: 25, range_max: 75 }, "%"),
    ).toBe("25% to 75%");
  });

  it("normalised values in 0-1 range are multiplied by 100", () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0.1, range_max: 0.25 }, "%"),
    ).toBe("10% to 25%");
  });
});
