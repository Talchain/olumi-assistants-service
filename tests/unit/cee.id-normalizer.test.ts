import { describe, it, expect } from "vitest";
import {
  normalizeToId,
  normalizeLabelsToIds,
  isValidId,
  extractIdPrefix,
} from "../../src/cee/utils/id-normalizer.js";

describe("CEE ID Normalizer", () => {
  describe("normalizeToId", () => {
    it("preserves valid IDs without normalization", () => {
      expect(normalizeToId("Marketing")).toBe("Marketing");
      expect(normalizeToId("PRICE")).toBe("PRICE");
      expect(normalizeToId("Opt_Premium-1")).toBe("Opt_Premium-1");
    });

    it("replaces spaces with underscores", () => {
      expect(normalizeToId("Marketing Spend")).toBe("marketing_spend");
      expect(normalizeToId("monthly cost")).toBe("monthly_cost");
    });

    it("normalizes hyphens when normalization is required", () => {
      expect(normalizeToId("Marketing Spend-2024")).toBe("marketing_spend_2024");
    });

    it("removes parentheses and keeps content", () => {
      expect(normalizeToId("Price (GBP)")).toBe("price_gbp");
    });

    it("removes invalid characters", () => {
      expect(normalizeToId("price@100")).toBe("price100");
      expect(normalizeToId("cost#1")).toBe("cost1");
    });

    it("collapses multiple underscores during normalization", () => {
      // Multiple spaces -> underscores -> collapsed
      expect(normalizeToId("marketing  spend")).toBe("marketing_spend");
      // Already valid ID per PRESERVED_ID_REGEX, so preserved as-is
      expect(normalizeToId("marketing___spend")).toBe("marketing___spend");
    });

    it("trims leading and trailing underscores", () => {
      expect(normalizeToId("_marketing_")).toBe("marketing");
      expect(normalizeToId("__price__")).toBe("price");
    });

    it("handles empty string", () => {
      expect(normalizeToId("")).toBe("node");
    });

    it("handles null/undefined", () => {
      expect(normalizeToId(null as any)).toBe("unknown");
      expect(normalizeToId(undefined as any)).toBe("unknown");
    });

    it("handles duplicates by appending double underscore suffix", () => {
      const existingIds = new Set(["option_a"]);
      expect(normalizeToId("Option A", existingIds)).toBe("option_a__2");
    });

    it("increments suffix for multiple duplicates", () => {
      const existingIds = new Set(["option_a", "option_a__2", "option_a__3"]);
      expect(normalizeToId("Option A", existingIds)).toBe("option_a__4");
    });

    it("normalizes colons to underscores", () => {
      expect(normalizeToId("factor:price")).toBe("factor_price");
    });

    it("allows hyphens in output", () => {
      const result = normalizeToId("my-id");
      expect(result).toBe("my-id");
      expect(isValidId(result)).toBe(true);
    });
  });

  describe("normalizeLabelsToIds", () => {
    it("normalizes multiple labels", () => {
      const labels = ["Option A", "Option B", "Option C"];
      const ids = normalizeLabelsToIds(labels);
      expect(ids).toEqual(["option_a", "option_b", "option_c"]);
    });

    it("handles duplicates across batch with double underscore", () => {
      const labels = ["Option A", "Option B", "Option A"];
      const ids = normalizeLabelsToIds(labels);
      expect(ids).toEqual(["option_a", "option_b", "option_a__2"]);
    });

    it("respects existing IDs with double underscore suffix", () => {
      const labels = ["Option A", "Option B"];
      const existingIds = new Set(["option_a"]);
      const ids = normalizeLabelsToIds(labels, existingIds);
      expect(ids).toEqual(["option_a__2", "option_b"]);
    });

    it("returns empty array for empty input", () => {
      expect(normalizeLabelsToIds([])).toEqual([]);
    });
  });

  describe("isValidId", () => {
    it("returns true for valid IDs", () => {
      expect(isValidId("marketing_spend")).toBe(true);
      expect(isValidId("option-1")).toBe(true);
      expect(isValidId("abc123")).toBe(true);
      expect(isValidId("UPPERCASE")).toBe(true);
    });

    it("returns false for invalid IDs", () => {
      expect(isValidId("Marketing Spend")).toBe(false);
      expect(isValidId("price@100")).toBe(false);
      expect(isValidId("has space")).toBe(false);
      expect(isValidId("factor:price")).toBe(false);
      expect(isValidId("1option")).toBe(false);
    });
  });

  describe("extractIdPrefix", () => {
    it("extracts prefix before underscore", () => {
      expect(extractIdPrefix("option_price_low")).toBe("option");
      expect(extractIdPrefix("factor_marketing")).toBe("factor");
    });

    it("extracts prefix before colon", () => {
      expect(extractIdPrefix("factor:marketing")).toBe("factor");
    });

    it("returns full ID if no separator", () => {
      expect(extractIdPrefix("marketing")).toBe("marketing");
    });
  });
});
