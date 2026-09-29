import { describe, it, expect } from "vitest";
import {
  elicitBelief,
  validateElicitBeliefInput,
  type ElicitBeliefInput,
} from "../../src/cee/belief-elicitation/index.js";

describe("CEE Belief Elicitation", () => {
  const baseInput: Omit<ElicitBeliefInput, "user_expression"> = {
    node_id: "n1",
    node_label: "Market expansion succeeds",
    target_type: "prior",
  };

  describe("elicitBelief", () => {
    describe("percentage parsing", () => {
      it("parses simple percentages", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "70%" });
        expect(result.suggested_value).toBe(0.7);
        expect(result.confidence).toBe("high");
        expect(result.needs_clarification).toBe(false);
        expect(result.provenance).toBe("cee");
      });

      it("parses percentages with 'percent' word", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "70 percent" });
        expect(result.suggested_value).toBe(0.7);
        expect(result.confidence).toBe("high");
      });

      it("parses percentages with 'about' prefix", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "about 70%" });
        expect(result.suggested_value).toBe(0.7);
        expect(result.confidence).toBe("high");
      });

      it("parses percentages with 'roughly' prefix", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "roughly 80%" });
        expect(result.suggested_value).toBe(0.8);
        expect(result.confidence).toBe("high");
      });

      it("parses percentages with 'approximately' prefix", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "approximately 65%" });
        expect(result.suggested_value).toBe(0.65);
        expect(result.confidence).toBe("high");
      });

      it("parses percentage with tilde", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "~75%" });
        expect(result.suggested_value).toBe(0.75);
        expect(result.confidence).toBe("high");
      });

      it("parses decimal percentages", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "72.5%" });
        expect(result.suggested_value).toBe(0.725);
        expect(result.confidence).toBe("high");
      });

      it("handles 0% edge case", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "0%" });
        expect(result.suggested_value).toBe(0);
        expect(result.confidence).toBe("high");
      });

      it("handles 100% edge case", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "100%" });
        expect(result.suggested_value).toBe(1);
        expect(result.confidence).toBe("high");
      });
    });

    describe("fraction parsing", () => {
      it("parses 'X in Y' fractions", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "3 in 4" });
        expect(result.suggested_value).toBe(0.75);
        expect(result.confidence).toBe("high");
      });

      it("parses 'X out of Y' fractions", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "3 out of 4" });
        expect(result.suggested_value).toBe(0.75);
        expect(result.confidence).toBe("high");
      });

      it("parses '1 in 10' fractions", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "1 in 10" });
        expect(result.suggested_value).toBe(0.1);
        expect(result.confidence).toBe("high");
      });

      it("parses slash fractions", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "3/4" });
        expect(result.suggested_value).toBe(0.75);
        expect(result.confidence).toBe("high");
      });

      it("parses '1/2' as 0.5", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "1/2" });
        expect(result.suggested_value).toBe(0.5);
        expect(result.confidence).toBe("high");
      });

      it("parses word fractions - half", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "half" });
        expect(result.suggested_value).toBe(0.5);
        expect(result.confidence).toBe("high");
      });

      it("parses word fractions - one half", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "one half" });
        expect(result.suggested_value).toBe(0.5);
        expect(result.confidence).toBe("high");
      });

      it("parses word fractions - three quarters", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "three quarters" });
        expect(result.suggested_value).toBe(0.75);
        expect(result.confidence).toBe("high");
      });

      it("parses word fractions - two thirds", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "two thirds" });
        expect(result.suggested_value).toBeCloseTo(0.667, 2);
        expect(result.confidence).toBe("high");
      });

      it("parses word fractions - one tenth", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "one tenth" });
        expect(result.suggested_value).toBe(0.1);
        expect(result.confidence).toBe("high");
      });
    });

    describe("decimal parsing", () => {
      it("parses simple decimals", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "0.7" });
        expect(result.suggested_value).toBe(0.7);
        expect(result.confidence).toBe("high");
      });

      it("parses decimals without leading zero", () => {
        const result = elicitBelief({ ...baseInput, user_expression: ".75" });
        expect(result.suggested_value).toBe(0.75);
        expect(result.confidence).toBe("high");
      });

      it("parses decimals with 'about' prefix", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "about 0.8" });
        expect(result.suggested_value).toBe(0.8);
        expect(result.confidence).toBe("high");
      });

      it("parses word decimals - point seven", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "point seven" });
        expect(result.suggested_value).toBe(0.7);
        expect(result.confidence).toBe("high");
      });
    });

    describe("qualitative term parsing - certainty terms", () => {
      it("parses 'certain' as ~0.99", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "certain" });
        expect(result.suggested_value).toBe(0.99);
        expect(result.needs_clarification).toBe(false);
      });

      it("parses 'definitely' as ~0.95", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "definitely" });
        expect(result.suggested_value).toBe(0.95);
      });

      it("parses 'very likely' as ~0.85", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "very likely" });
        expect(result.suggested_value).toBe(0.85);
      });

      it("parses 'likely' as ~0.70", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "likely" });
        expect(result.suggested_value).toBe(0.70);
      });

      it("parses 'pretty likely' as ~0.70", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "pretty likely" });
        expect(result.suggested_value).toBe(0.70);
      });

      it("parses 'probable' as ~0.75", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "probable" });
        expect(result.suggested_value).toBe(0.75);
      });

      it("parses 'possible' as ~0.50", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "possible" });
        expect(result.suggested_value).toBe(0.50);
      });

      it("parses 'fifty-fifty' as ~0.50", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "fifty-fifty" });
        expect(result.suggested_value).toBe(0.50);
      });

      it("parses 'unlikely' as ~0.30", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "unlikely" });
        expect(result.suggested_value).toBe(0.30);
      });

      it("parses 'very unlikely' as ~0.15", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "very unlikely" });
        expect(result.suggested_value).toBe(0.15);
      });

      it("parses 'impossible' as ~0.01", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "impossible" });
        expect(result.suggested_value).toBe(0.01);
      });

      it("parses 'never' as ~0.01", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "never" });
        expect(result.suggested_value).toBe(0.01);
      });
    });

    describe("qualitative term parsing - casual terms", () => {
      it("parses 'pretty sure' as ~0.80", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "pretty sure" });
        expect(result.suggested_value).toBe(0.80);
      });

      it("parses 'confident' as ~0.80", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "confident" });
        expect(result.suggested_value).toBe(0.80);
      });

      it("parses 'I doubt' as ~0.30", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "doubt" });
        expect(result.suggested_value).toBe(0.30);
      });

      it("parses 'skeptical' as ~0.30", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "skeptical" });
        expect(result.suggested_value).toBe(0.30);
      });

      it("parses 'hopeful' as ~0.60", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "hopeful" });
        expect(result.suggested_value).toBe(0.60);
      });

      it("parses 'leaning towards' as ~0.60", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "leaning towards" });
        expect(result.suggested_value).toBe(0.60);
      });
    });

    describe("qualitative term parsing - frequency terms", () => {
      it("parses 'always' as ~0.95", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "always" });
        expect(result.suggested_value).toBe(0.95);
      });

      it("parses 'usually' as ~0.80", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "usually" });
        expect(result.suggested_value).toBe(0.80);
      });

      it("parses 'sometimes' as ~0.50", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "sometimes" });
        expect(result.suggested_value).toBe(0.50);
      });

      it("parses 'rarely' as ~0.15", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "rarely" });
        expect(result.suggested_value).toBe(0.15);
      });
    });

    describe("hedged expressions", () => {
      it("parses 'I would say likely'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "i would say likely" });
        expect(result.suggested_value).toBe(0.70);
        expect(result.confidence).toBe("medium");
      });

      it("parses 'I think about 70%' - percentage takes precedence", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "i think about 70%" });
        expect(result.suggested_value).toBe(0.70);
        // Explicit percentage values get high confidence even with hedging
        expect(result.confidence).toBe("high");
      });

      it("parses 'I guess likely'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "i guess likely" });
        expect(result.suggested_value).toBe(0.70);
        expect(result.confidence).toBe("medium");
      });

      it("parses 'maybe around 60%' - percentage takes precedence", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "maybe around 60%" });
        expect(result.suggested_value).toBe(0.60);
        // Explicit percentage values get high confidence even with hedging
        expect(result.confidence).toBe("high");
      });
    });

    describe("ambiguous terms requiring clarification", () => {
      it("flags 'good' as ambiguous", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "good" });
        expect(result.needs_clarification).toBe(true);
        expect(result.clarifying_question).toBeDefined();
        expect(result.options).toBeDefined();
        expect(result.options!.length).toBeGreaterThan(0);
      });

      it("flags 'high' as ambiguous", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "high" });
        expect(result.needs_clarification).toBe(true);
        expect(result.options).toBeDefined();
      });

      it("flags 'low' as ambiguous", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "low" });
        expect(result.needs_clarification).toBe(true);
        expect(result.options).toBeDefined();
      });

      it("flags 'significant' as ambiguous", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "significant" });
        expect(result.needs_clarification).toBe(true);
        expect(result.options).toBeDefined();
      });

      it("provides positive-leaning options for 'good'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "good" });
        expect(result.options).toBeDefined();
        // Options should lean positive for "good"
        const avgValue = result.options!.reduce((sum, o) => sum + o.value, 0) / result.options!.length;
        expect(avgValue).toBeGreaterThan(0.5);
      });

      it("provides negative-leaning options for 'low'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "low" });
        expect(result.options).toBeDefined();
        // Options should lean negative for "low"
        const avgValue = result.options!.reduce((sum, o) => sum + o.value, 0) / result.options!.length;
        expect(avgValue).toBeLessThan(0.5);
      });
    });

    describe("edge cases", () => {
      it("handles empty expression", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "" });
        expect(result.needs_clarification).toBe(true);
        expect(result.suggested_value).toBe(0.5);
        expect(result.confidence).toBe("low");
      });

      it("handles whitespace-only expression", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "   " });
        expect(result.needs_clarification).toBe(true);
        expect(result.suggested_value).toBe(0.5);
      });

      it("handles unrecognized expression", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "asdfasdf" });
        expect(result.needs_clarification).toBe(true);
        expect(result.suggested_value).toBe(0.5);
        expect(result.confidence).toBe("low");
      });

      it("is case insensitive", () => {
        const lower = elicitBelief({ ...baseInput, user_expression: "likely" });
        const upper = elicitBelief({ ...baseInput, user_expression: "LIKELY" });
        const mixed = elicitBelief({ ...baseInput, user_expression: "LiKeLy" });

        expect(lower.suggested_value).toBe(upper.suggested_value);
        expect(lower.suggested_value).toBe(mixed.suggested_value);
      });

      it("handles leading/trailing whitespace", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "  70%  " });
        expect(result.suggested_value).toBe(0.7);
      });

      it("always returns provenance: cee", () => {
        const result1 = elicitBelief({ ...baseInput, user_expression: "70%" });
        const result2 = elicitBelief({ ...baseInput, user_expression: "likely" });
        const result3 = elicitBelief({ ...baseInput, user_expression: "good" });

        expect(result1.provenance).toBe("cee");
        expect(result2.provenance).toBe("cee");
        expect(result3.provenance).toBe("cee");
      });
    });

    describe("target type: edge_weight", () => {
      it("generates appropriate question for edge weights", () => {
        const result = elicitBelief({
          ...baseInput,
          target_type: "edge_weight",
          user_expression: "good",
        });

        expect(result.needs_clarification).toBe(true);
        expect(result.clarifying_question).toContain("strong");
      });
    });

    describe("real-world scenarios", () => {
      it("handles 'I think it's about a 70% chance'", () => {
        const result = elicitBelief({
          ...baseInput,
          user_expression: "i think it's about a 70% chance"
        });
        expect(result.suggested_value).toBe(0.7);
      });

      it("handles 'coin flip'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "coin flip" });
        expect(result.suggested_value).toBe(0.50);
      });

      it("handles 'toss-up'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "toss-up" });
        expect(result.suggested_value).toBe(0.50);
      });

      it("handles 'slim chance'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "slim chance" });
        expect(result.suggested_value).toBe(0.20);
      });

      it("handles 'long shot'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "long shot" });
        expect(result.suggested_value).toBe(0.15);
      });

      it("handles 'strong chance'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "strong chance" });
        expect(result.suggested_value).toBe(0.80);
      });

      it("handles 'good chance'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "good chance" });
        expect(result.suggested_value).toBe(0.70);
      });

      it("handles 'almost certain'", () => {
        const result = elicitBelief({ ...baseInput, user_expression: "almost certain" });
        // Should match "certain" at 0.99
        expect(result.suggested_value).toBe(0.99);
      });
    });
  });

  describe("validateElicitBeliefInput", () => {
    it("validates correct input", () => {
      const input: ElicitBeliefInput = {
        node_id: "n1",
        node_label: "Test node",
        user_expression: "likely",
        target_type: "prior",
      };
      expect(validateElicitBeliefInput(input)).toBe(true);
    });

    it("rejects null input", () => {
      expect(validateElicitBeliefInput(null)).toBe(false);
    });

    it("rejects undefined input", () => {
      expect(validateElicitBeliefInput(undefined)).toBe(false);
    });

    it("rejects input without node_id", () => {
      expect(validateElicitBeliefInput({
        node_label: "Test",
        user_expression: "likely",
        target_type: "prior",
      })).toBe(false);
    });

    it("rejects input with empty node_id", () => {
      expect(validateElicitBeliefInput({
        node_id: "",
        node_label: "Test",
        user_expression: "likely",
        target_type: "prior",
      })).toBe(false);
    });

    it("rejects input without node_label", () => {
      expect(validateElicitBeliefInput({
        node_id: "n1",
        user_expression: "likely",
        target_type: "prior",
      })).toBe(false);
    });

    it("rejects input without target_type", () => {
      expect(validateElicitBeliefInput({
        node_id: "n1",
        node_label: "Test",
        user_expression: "likely",
      })).toBe(false);
    });

    it("rejects invalid target_type", () => {
      expect(validateElicitBeliefInput({
        node_id: "n1",
        node_label: "Test",
        user_expression: "likely",
        target_type: "invalid",
      })).toBe(false);
    });

    it("accepts edge_weight target_type", () => {
      expect(validateElicitBeliefInput({
        node_id: "n1",
        node_label: "Test",
        user_expression: "likely",
        target_type: "edge_weight",
      })).toBe(true);
    });

    it("accepts empty user_expression", () => {
      expect(validateElicitBeliefInput({
        node_id: "n1",
        node_label: "Test",
        user_expression: "",
        target_type: "prior",
      })).toBe(true);
    });
  });

  describe("response structure", () => {
    it("returns all required fields for successful parse", () => {
      const result = elicitBelief({ ...baseInput, user_expression: "likely" });

      expect(result).toHaveProperty("suggested_value");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("reasoning");
      expect(result).toHaveProperty("needs_clarification");
      expect(result).toHaveProperty("provenance");

      expect(typeof result.suggested_value).toBe("number");
      expect(["high", "medium", "low"]).toContain(result.confidence);
      expect(typeof result.reasoning).toBe("string");
      expect(typeof result.needs_clarification).toBe("boolean");
      expect(result.provenance).toBe("cee");
    });

    it("includes clarifying_question and options when needs_clarification", () => {
      const result = elicitBelief({ ...baseInput, user_expression: "good" });

      expect(result.needs_clarification).toBe(true);
      expect(result.clarifying_question).toBeDefined();
      expect(typeof result.clarifying_question).toBe("string");
      expect(result.options).toBeDefined();
      expect(Array.isArray(result.options)).toBe(true);

      for (const option of result.options!) {
        expect(option).toHaveProperty("label");
        expect(option).toHaveProperty("value");
        expect(typeof option.label).toBe("string");
        expect(typeof option.value).toBe("number");
        expect(option.value).toBeGreaterThanOrEqual(0);
        expect(option.value).toBeLessThanOrEqual(1);
      }
    });

    it("does not include clarifying_question when not needed", () => {
      const result = elicitBelief({ ...baseInput, user_expression: "likely" });

      expect(result.needs_clarification).toBe(false);
      expect(result.clarifying_question).toBeUndefined();
      expect(result.options).toBeUndefined();
    });

    it("reasoning explains the interpretation", () => {
      const result = elicitBelief({ ...baseInput, user_expression: "70%" });

      expect(result.reasoning).toContain("70%");
      expect(result.reasoning.toLowerCase()).toContain("parsed");
    });
  });
});
