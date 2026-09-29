import { describe, it, expect } from "vitest";
import {
  parseNumericValue,
  resolveRelativeValue,
  extractAllNumericValues,
  formatParsedValue,
} from "../../src/cee/extraction/numeric-parser.js";

describe("CEE Numeric Parser", () => {
  describe("parseNumericValue", () => {
    describe("currency values", () => {
      it("parses GBP with pound sign", () => {
        const result = parseNumericValue("£59");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(59);
        expect(result!.unit).toBe("GBP");
        expect(result!.isRelative).toBe(false);
        expect(result!.confidence).toBe("high");
      });

      it("parses USD with dollar sign", () => {
        const result = parseNumericValue("$100");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(100);
        expect(result!.unit).toBe("USD");
      });

      it("parses EUR with euro sign", () => {
        const result = parseNumericValue("€45");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(45);
        expect(result!.unit).toBe("EUR");
      });

      it("parses currency with k multiplier", () => {
        const result = parseNumericValue("£10k");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(10000);
        expect(result!.unit).toBe("GBP");
      });

      it("parses currency with m multiplier", () => {
        const result = parseNumericValue("$2.5m");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(2500000);
        expect(result!.unit).toBe("USD");
      });

      it("parses currency with commas", () => {
        const result = parseNumericValue("£1,500");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(1500);
      });

      it("parses postfix currency format", () => {
        const result = parseNumericValue("100 GBP");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(100);
        expect(result!.unit).toBe("GBP");
      });

      it("parses postfix currency with multiplier", () => {
        const result = parseNumericValue("50k USD");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(50000);
        expect(result!.unit).toBe("USD");
      });
    });

    describe("percentage values", () => {
      it("parses simple percentage", () => {
        const result = parseNumericValue("25%");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(25);
        expect(result!.unit).toBe("percent");
        expect(result!.isRelative).toBe(false);
      });

      it("parses decimal percentage", () => {
        const result = parseNumericValue("3.5%");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(3.5);
        expect(result!.unit).toBe("percent");
      });

      it("parses negative percentage", () => {
        const result = parseNumericValue("-10%");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(-10);
      });

      it("parses word form percentage", () => {
        const result = parseNumericValue("25 percent");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(25);
        expect(result!.unit).toBe("percent");
      });
    });

    describe("relative values", () => {
      it("parses increase by percentage", () => {
        const result = parseNumericValue("increase by 20%");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(20);
        expect(result!.isRelative).toBe(true);
        expect(result!.relativeType).toBe("percent");
        expect(result!.relativeDirection).toBe("increase");
      });

      it("parses decrease by percentage", () => {
        const result = parseNumericValue("decrease by 15%");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(15);
        expect(result!.isRelative).toBe(true);
        expect(result!.relativeDirection).toBe("decrease");
      });

      it("parses reduce by percentage", () => {
        const result = parseNumericValue("reduce by 10%");
        expect(result).not.toBeNull();
        expect(result!.relativeDirection).toBe("decrease");
      });

      it("parses boost by percentage", () => {
        const result = parseNumericValue("boost 25%");
        expect(result).not.toBeNull();
        expect(result!.relativeDirection).toBe("increase");
      });

      it("parses increase by absolute amount", () => {
        const result = parseNumericValue("increase by £50");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(50);
        expect(result!.isRelative).toBe(true);
        expect(result!.relativeType).toBe("absolute");
        expect(result!.unit).toBe("GBP");
      });
    });

    describe("count values", () => {
      it("parses months", () => {
        const result = parseNumericValue("3 months");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(3);
        expect(result!.unit).toBe("month");
      });

      it("parses engineers", () => {
        const result = parseNumericValue("2 engineers");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(2);
        expect(result!.unit).toBe("engineer");
      });

      it("parses users", () => {
        const result = parseNumericValue("1000 users");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(1000);
        expect(result!.unit).toBe("user");
      });

      it("parses days", () => {
        const result = parseNumericValue("14 days");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(14);
        expect(result!.unit).toBe("day");
      });
    });

    describe("plain numbers", () => {
      it("parses simple number", () => {
        const result = parseNumericValue("100");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(100);
        expect(result!.isRelative).toBe(false);
        expect(result!.unit).toBeUndefined();
      });

      it("parses number with commas", () => {
        const result = parseNumericValue("50,000");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(50000);
      });

      it("parses number with multiplier", () => {
        const result = parseNumericValue("100k");
        expect(result).not.toBeNull();
        expect(result!.value).toBe(100000);
      });
    });

    describe("edge cases", () => {
      it("returns null for empty string", () => {
        expect(parseNumericValue("")).toBeNull();
      });

      it("returns null for null input", () => {
        expect(parseNumericValue(null as any)).toBeNull();
      });

      it("returns null for non-numeric string", () => {
        expect(parseNumericValue("hello world")).toBeNull();
      });
    });
  });

  describe("resolveRelativeValue", () => {
    it("resolves percentage increase", () => {
      const parsed = parseNumericValue("increase by 20%")!;
      const result = resolveRelativeValue(parsed, 100);
      expect(result).toBe(120);
    });

    it("resolves percentage decrease", () => {
      const parsed = parseNumericValue("decrease by 25%")!;
      const result = resolveRelativeValue(parsed, 100);
      expect(result).toBe(75);
    });

    it("resolves absolute increase", () => {
      const parsed = parseNumericValue("increase by £50")!;
      const result = resolveRelativeValue(parsed, 100);
      expect(result).toBe(150);
    });

    it("returns value unchanged for non-relative", () => {
      const parsed = parseNumericValue("£59")!;
      const result = resolveRelativeValue(parsed, 100);
      expect(result).toBe(59);
    });
  });

  describe("extractAllNumericValues", () => {
    it("extracts multiple values from text", () => {
      const text = "The price is £59 with a 10% discount";
      const results = extractAllNumericValues(text);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("extracts values separated by commas", () => {
      const text = "£59, £79, and £99";
      const results = extractAllNumericValues(text);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("formatParsedValue", () => {
    it("formats currency value", () => {
      const parsed = parseNumericValue("£59")!;
      expect(formatParsedValue(parsed)).toBe("£59");
    });

    it("formats percentage", () => {
      const parsed = parseNumericValue("25%")!;
      expect(formatParsedValue(parsed)).toBe("25%");
    });

    it("formats relative increase", () => {
      const parsed = parseNumericValue("increase by 20%")!;
      expect(formatParsedValue(parsed)).toBe("increase by 20%");
    });

    it("formats count with unit", () => {
      const parsed = parseNumericValue("3 months")!;
      expect(formatParsedValue(parsed)).toBe("3 month");
    });
  });
});
