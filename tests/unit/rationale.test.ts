/**
 * Unit tests for rationale generator
 *
 * Tests the template-based generation of plain English explanations
 * for recommendation rationale.
 */

import { describe, it, expect } from "vitest";
import {
  generateRationale,
  type RationaleContext,
} from "../../src/services/review/rationale.js";

describe("generateRationale", () => {
  describe("basic functionality", () => {
    it("returns null when no recommended option provided", () => {
      const context: RationaleContext = {
        recommendedOption: undefined,
        goal: { id: "goal_1", label: "Maximize Revenue" },
      };

      const result = generateRationale(context);

      expect(result).toBeNull();
    });

    it("returns null when recommended option has no label", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "" },
      };

      const result = generateRationale(context);

      expect(result).toBeNull();
    });

    it("returns rationale with summary when option provided", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Premium Plan" },
      };

      const result = generateRationale(context);

      expect(result).not.toBeNull();
      expect(result?.summary).toContain("Premium Plan");
    });
  });

  describe("summary templates", () => {
    it("uses driver and goal template when both available", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Premium Plan" },
        goal: { id: "goal_1", label: "Maximize Revenue" },
        drivers: [
          { id: "fac_1", label: "Customer Lifetime Value", sensitivity: 0.8 },
        ],
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("Premium Plan");
      expect(result?.summary).toContain("Customer Lifetime Value");
      expect(result?.summary).toContain("Maximize Revenue");
      expect(result?.summary).toContain("strongest positive effect");
    });

    it("uses driver and stability template when stability is high", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Option A" },
        drivers: [{ id: "fac_1", label: "Market Share", sensitivity: 0.7 }],
        stability: 0.85,
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("Option A");
      expect(result?.summary).toContain("Market Share");
      expect(result?.summary).toContain("85%");
    });

    it("uses driver only template when no goal or stability", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Standard Package" },
        drivers: [{ id: "fac_1", label: "Price Competitiveness" }],
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("Standard Package");
      expect(result?.summary).toContain("Price Competitiveness");
      expect(result?.summary).toContain("favorable impact");
    });

    it("uses stability template when stability is high and no driver", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Enterprise" },
        stability: 0.92,
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("Enterprise");
      expect(result?.summary).toContain("92%");
      expect(result?.summary).toContain("best choice");
    });

    it("uses goal only template when only goal available", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Growth Plan" },
        goal: { id: "goal_1", label: "Increase Market Share" },
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("Growth Plan");
      expect(result?.summary).toContain("Increase Market Share");
      expect(result?.summary).toContain("best achieves");
    });

    it("uses minimal template as fallback", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Basic Option" },
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("Basic Option");
      expect(result?.summary).toContain("highest expected outcome");
    });
  });

  describe("stability threshold", () => {
    it("does not use stability template when stability is below 70%", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Test Option" },
        stability: 0.65,
      };

      const result = generateRationale(context);

      expect(result?.summary).not.toContain("65%");
      expect(result?.summary).toContain("highest expected outcome");
    });

    it("uses stability template when stability is exactly 70%", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Test Option" },
        stability: 0.70,
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("70%");
    });

    it("does not use driver+stability template when stability is low", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Test Option" },
        drivers: [{ label: "Factor A" }],
        stability: 0.45,
      };

      const result = generateRationale(context);

      expect(result?.summary).not.toContain("45%");
      expect(result?.summary).toContain("Factor A");
    });
  });

  describe("key driver", () => {
    it("sets key_driver to first driver label", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Option X" },
        drivers: [
          { label: "Primary Driver" },
          { label: "Secondary Driver" },
        ],
      };

      const result = generateRationale(context);

      expect(result?.key_driver).toBe("Primary Driver");
    });

    it("key_driver is undefined when no drivers", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Option Y" },
      };

      const result = generateRationale(context);

      expect(result?.key_driver).toBeUndefined();
    });

    it("key_driver is undefined when drivers array is empty", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Option Z" },
        drivers: [],
      };

      const result = generateRationale(context);

      expect(result?.key_driver).toBeUndefined();
    });
  });

  describe("goal alignment", () => {
    it("generates goal alignment when goal is provided", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Selected Option" },
        goal: { id: "goal_1", label: "Increase Profitability" },
      };

      const result = generateRationale(context);

      expect(result?.goal_alignment).toContain("Selected Option");
      expect(result?.goal_alignment).toContain("Increase Profitability");
      expect(result?.goal_alignment).toContain("supports achieving");
    });

    it("goal_alignment is undefined when no goal", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Some Option" },
      };

      const result = generateRationale(context);

      expect(result?.goal_alignment).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("handles empty context gracefully", () => {
      const result = generateRationale({});

      expect(result).toBeNull();
    });

    it("rounds stability percentage correctly", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Test" },
        stability: 0.876,
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("88%");
    });

    it("handles stability of 100%", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Perfect Option" },
        stability: 1.0,
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("100%");
    });

    it("handles option label with special characters", () => {
      const context: RationaleContext = {
        recommendedOption: { id: "opt_1", label: "Plan A (Premium)" },
        goal: { id: "goal_1", label: "Goal & Objective" },
      };

      const result = generateRationale(context);

      expect(result?.summary).toContain("Plan A (Premium)");
      expect(result?.goal_alignment).toContain("Goal & Objective");
    });
  });
});
