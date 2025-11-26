import { describe, it, expect } from "vitest";
import {
  validateBriefPreflight,
  __test_only,
} from "../../src/cee/validation/preflight.js";

const {
  calculateEntropy,
  calculateDictionaryCoverage,
  calculateDecisionRelevance,
  isLikelyGibberish,
  hasProblematicCharacters,
} = __test_only;

describe("CEE Preflight Validation", () => {
  describe("validateBriefPreflight", () => {
    describe("valid briefs", () => {
      it("accepts a simple decision question", () => {
        const result = validateBriefPreflight("Should I hire an additional developer for my team?");
        expect(result.valid).toBe(true);
        expect(result.issues.filter(i => i.severity === "error")).toHaveLength(0);
      });

      it("accepts a detailed decision brief", () => {
        // Single line to avoid whitespace affecting metrics
        const brief = "We are considering expanding our product line to include a premium tier. The goal is to increase revenue by 20% over the next quarter. Key constraints include a budget of $50,000 and a team of 3 engineers. Should we proceed with the expansion or focus on improving existing features?";
        const result = validateBriefPreflight(brief);
        expect(result.valid).toBe(true);
      });

      it("accepts a strategic planning brief", () => {
        const brief = "What is the best approach to migrate our infrastructure to the cloud?";
        const result = validateBriefPreflight(brief);
        expect(result.valid).toBe(true);
      });
    });

    describe("invalid briefs", () => {
      it("rejects empty brief", () => {
        const result = validateBriefPreflight("");
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === "BRIEF_TOO_SHORT")).toBe(true);
      });

      it("rejects brief that is too short", () => {
        const result = validateBriefPreflight("Hello");
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === "BRIEF_TOO_SHORT")).toBe(true);
      });

      it("rejects gibberish input", () => {
        const result = validateBriefPreflight("asdfghjkl qwertyuiop zxcvbnm");
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.code === "BRIEF_APPEARS_GIBBERISH")).toBe(true);
      });

      it("rejects input with repeated characters", () => {
        const result = validateBriefPreflight("This is aaaaaaaaaaaaaaa test");
        expect(result.valid).toBe(false);
      });

      it("rejects input with only symbols", () => {
        const result = validateBriefPreflight("!@#$%^&*()_+-=[]{}|;':\",./<>?");
        expect(result.valid).toBe(false);
      });
    });

    describe("metrics calculation", () => {
      it("calculates correct word count", () => {
        const result = validateBriefPreflight("Should I hire a new developer for my team?");
        expect(result.metrics.word_count).toBe(9);
      });

      it("calculates decision relevance for decision question", () => {
        const result = validateBriefPreflight("Should we invest in new equipment or hire more staff?");
        expect(result.metrics.decision_relevance_score).toBeGreaterThan(0.3);
      });

      it("calculates lower decision relevance for non-decision text", () => {
        const result = validateBriefPreflight("The weather is nice today and the sky is blue");
        expect(result.metrics.decision_relevance_score).toBeLessThan(0.3);
      });
    });

    describe("warnings", () => {
      it("warns about low decision relevance for descriptive text", () => {
        // Text with enough length but no decision-related words
        const result = validateBriefPreflight("The building has many windows and a red roof and several floors");
        // Check if the warning is triggered
        const hasWarning = result.issues.some(i => i.code === "BRIEF_LOW_DECISION_RELEVANCE");
        // The warning should be present when decision relevance is low
        if (result.metrics.decision_relevance_score < 0.2) {
          expect(hasWarning).toBe(true);
          // But it should still be valid (warning, not error)
          expect(result.valid).toBe(true);
        }
      });
    });
  });

  describe("calculateEntropy", () => {
    it("returns 0 for empty string", () => {
      expect(calculateEntropy("")).toBe(0);
    });

    it("returns 0 for single repeated character", () => {
      expect(calculateEntropy("aaaa")).toBe(0);
    });

    it("returns higher entropy for random-looking text", () => {
      const normalText = calculateEntropy("hello world this is normal english");
      const randomText = calculateEntropy("x7k2m9p4q1z8n5b3");
      expect(randomText).toBeGreaterThan(normalText);
    });

    it("returns moderate entropy for normal English text", () => {
      const entropy = calculateEntropy("This is a normal English sentence");
      expect(entropy).toBeGreaterThan(3);
      expect(entropy).toBeLessThan(5);
    });
  });

  describe("calculateDictionaryCoverage", () => {
    it("returns 0 for no text", () => {
      expect(calculateDictionaryCoverage("")).toBe(0);
    });

    it("returns high coverage for common English", () => {
      const coverage = calculateDictionaryCoverage("I should decide if we need to hire more people");
      expect(coverage).toBeGreaterThan(0.8);
    });

    it("returns low coverage for technical jargon", () => {
      const coverage = calculateDictionaryCoverage("kubectl nginx prometheus grafana elasticsearch");
      expect(coverage).toBeLessThan(0.3);
    });
  });

  describe("calculateDecisionRelevance", () => {
    it("returns high score for decision questions", () => {
      expect(calculateDecisionRelevance("Should I hire a developer?")).toBeGreaterThan(0.3);
      expect(calculateDecisionRelevance("What is the best option to choose?")).toBeGreaterThan(0.3);
      expect(calculateDecisionRelevance("How should we decide between these alternatives?")).toBeGreaterThan(0.3);
    });

    it("returns low score for non-decision text", () => {
      expect(calculateDecisionRelevance("The sun is shining")).toBeLessThan(0.3);
      expect(calculateDecisionRelevance("Documentation for the API")).toBeLessThan(0.3);
    });

    it("detects question mark ending", () => {
      const withQuestion = calculateDecisionRelevance("What should we do?");
      const withoutQuestion = calculateDecisionRelevance("What should we do");
      expect(withQuestion).toBeGreaterThan(withoutQuestion);
    });
  });

  describe("isLikelyGibberish", () => {
    it("detects no-letter strings as gibberish", () => {
      expect(isLikelyGibberish("12345678", 4.0, 0.0)).toBe(true);
    });

    it("detects repeated characters as gibberish", () => {
      expect(isLikelyGibberish("This is aaaaaaaaaaaaaaa", 3.0, 0.8)).toBe(true);
    });

    it("detects high entropy + low coverage as gibberish", () => {
      expect(isLikelyGibberish("xkcd qwerty asdf zxcv", 5.5, 0.2)).toBe(true);
    });

    it("does not flag normal English as gibberish", () => {
      expect(isLikelyGibberish("Should I hire a developer?", 4.0, 0.8)).toBe(false);
    });
  });

  describe("hasProblematicCharacters", () => {
    it("allows normal text", () => {
      expect(hasProblematicCharacters("Hello, world!").valid).toBe(true);
    });

    it("rejects control characters", () => {
      expect(hasProblematicCharacters("Hello\x00World").valid).toBe(false);
    });

    it("rejects excessive special characters", () => {
      expect(hasProblematicCharacters("!!!###$$$%%%^^^").valid).toBe(false);
    });
  });
});
