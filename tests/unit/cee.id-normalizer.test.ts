import { describe, it, expect } from "vitest";
import {
  normalizeToId,
  normalizeLabelsToIds,
  isValidId,
  extractIdPrefix,
  CANONICAL_ID_REGEX,
} from "../../src/cee/utils/id-normalizer.js";

describe("CEE ID Normalizer", () => {
  describe("CANONICAL_ID_REGEX", () => {
    it("matches canonical IDs", () => {
      expect(CANONICAL_ID_REGEX.test("marketing_spend")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("factor:price")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("0_factor")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("abc123")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("option_a__2")).toBe(true);
    });

    it("rejects non-canonical IDs", () => {
      expect(CANONICAL_ID_REGEX.test("Marketing")).toBe(false);
      expect(CANONICAL_ID_REGEX.test("PRICE")).toBe(false);
      expect(CANONICAL_ID_REGEX.test("Opt_Premium-1")).toBe(false);
      expect(CANONICAL_ID_REGEX.test("has space")).toBe(false);
      expect(CANONICAL_ID_REGEX.test("price@100")).toBe(false);
    });

    it("accepts hyphens (aligned with prompt pattern ^[a-z0-9_:-]+$)", () => {
      expect(CANONICAL_ID_REGEX.test("my-id")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("goal-node")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("option-1")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("fac_cost-benefit")).toBe(true);
    });

    it("accepts leading underscore and colon", () => {
      expect(CANONICAL_ID_REGEX.test("_id")).toBe(true);
      expect(CANONICAL_ID_REGEX.test(":id")).toBe(true);
    });

    it("accepts numeric start", () => {
      expect(CANONICAL_ID_REGEX.test("0_id")).toBe(true);
      expect(CANONICAL_ID_REGEX.test("123")).toBe(true);
    });
  });

  describe("normalizeToId", () => {
    it("lowercases IDs that were previously preserved", () => {
      expect(normalizeToId("Marketing")).toBe("marketing");
      expect(normalizeToId("PRICE")).toBe("price");
      expect(normalizeToId("Opt_Premium")).toBe("opt_premium");
    });

    it("preserves IDs already matching canonical pattern", () => {
      expect(normalizeToId("marketing_spend")).toBe("marketing_spend");
      expect(normalizeToId("factor:price")).toBe("factor:price");
      expect(normalizeToId("0_factor")).toBe("0_factor");
    });

    it("replaces spaces with underscores", () => {
      expect(normalizeToId("Marketing Spend")).toBe("marketing_spend");
      expect(normalizeToId("monthly cost")).toBe("monthly_cost");
    });

    it("preserves IDs that already contain hyphens (canonical pattern)", () => {
      // Hyphenated IDs that match the canonical pattern pass through as-is
      expect(normalizeToId("my-id")).toBe("my-id");
      expect(normalizeToId("goal-node")).toBe("goal-node");
    });

    it("replaces hyphens with underscores when normalising non-canonical labels", () => {
      // Labels with mixed case + hyphens get normalised (hyphens → underscores)
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
      expect(normalizeToId("marketing  spend")).toBe("marketing_spend");
    });

    it("preserves leading/trailing underscores in canonical IDs", () => {
      // _marketing_ matches canonical pattern — preserved as-is
      expect(normalizeToId("_marketing_")).toBe("_marketing_");
    });

    it("trims leading and trailing underscores during normalization", () => {
      expect(normalizeToId(" _price_ ")).toBe("price");
      expect(normalizeToId("Price__")).toBe("price");
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

    it("preserves colons in canonical IDs", () => {
      expect(normalizeToId("factor:price")).toBe("factor:price");
    });

    it("allows numeric start", () => {
      const result = normalizeToId("0_factor");
      expect(result).toBe("0_factor");
      expect(isValidId(result)).toBe(true);
    });

    it("output always matches canonical pattern", () => {
      const inputs = [
        "Marketing Spend", "PRICE", "Opt_Premium-1",
        "Price (GBP)", "factor:price", "0_factor",
        "cost#1", "Option A", "my-id", "goal-node",
      ];
      for (const input of inputs) {
        const id = normalizeToId(input);
        expect(isValidId(id)).toBe(true);
      }
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
    it("returns true for canonical IDs", () => {
      expect(isValidId("marketing_spend")).toBe(true);
      expect(isValidId("abc123")).toBe(true);
      expect(isValidId("factor:price")).toBe(true);
      expect(isValidId("0_factor")).toBe(true);
      expect(isValidId("option_a__2")).toBe(true);
    });

    it("returns false for non-canonical IDs", () => {
      expect(isValidId("Marketing Spend")).toBe(false);
      expect(isValidId("price@100")).toBe(false);
      expect(isValidId("has space")).toBe(false);
      expect(isValidId("UPPERCASE")).toBe(false);
    });

    it("accepts hyphens (aligned with prompt pattern)", () => {
      expect(isValidId("my-id")).toBe(true);
      expect(isValidId("option-1")).toBe(true);
      expect(isValidId("goal-node")).toBe(true);
    });

    it("accepts leading underscore and colon", () => {
      expect(isValidId("_id")).toBe(true);
      expect(isValidId(":id")).toBe(true);
    });

    it("accepts numeric start", () => {
      expect(isValidId("0_id")).toBe(true);
      expect(isValidId("123")).toBe(true);
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

    it("extracts prefix before hyphen (legacy IDs)", () => {
      expect(extractIdPrefix("goal-node")).toBe("goal");
    });

    it("extracts numeric prefix", () => {
      expect(extractIdPrefix("0_factor")).toBe("0");
    });

    it("returns full ID if no separator", () => {
      expect(extractIdPrefix("marketing")).toBe("marketing");
    });
  });
});
