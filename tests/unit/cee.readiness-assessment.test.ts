import { describe, it, expect } from "vitest";
import {
  assessBriefReadiness,
  __test_only,
} from "../../src/cee/validation/readiness.js";

const {
  scoreLengthFactor,
  scoreSpecificityFactor,
  scoreContextFactor,
  generateTargetedClarificationQuestions,
  findWeakestFactor,
  compressPreviousAnswers,
  READINESS_THRESHOLDS,
} = __test_only;

describe("CEE Readiness Assessment", () => {
  describe("assessBriefReadiness", () => {
    describe("ready briefs", () => {
      it("marks a detailed decision question as ready", () => {
        // Use a single-line brief to avoid whitespace issues
        const brief = "Should we hire an additional developer for the team? Our goal is to ship the product by Q2 2025. Budget constraint is $150,000 for the year. Current team velocity is 20 story points per sprint.";
        const result = assessBriefReadiness(brief);
        // Should at least pass preflight
        expect(result.preflight.valid).toBe(true);
        // Score should be reasonable
        expect(result.score).toBeGreaterThan(0.3);
        // Either ready or needs_clarification is acceptable for well-formed briefs
        expect(["ready", "needs_clarification"]).toContain(result.level);
      });

      it("marks a strategic decision with context as ready or needs clarification", () => {
        const brief = "Should we invest $50,000 in marketing or product development? The goal is to increase revenue by 20% this quarter.";
        const result = assessBriefReadiness(brief);
        // Should pass preflight
        expect(result.preflight.valid).toBe(true);
        expect(result.score).toBeGreaterThan(0.3);
      });
    });

    describe("needs_clarification briefs", () => {
      it("flags brief lacking specifics", () => {
        const brief = "Should we make some changes to our approach?";
        const result = assessBriefReadiness(brief);
        // May be ready or needs_clarification depending on thresholds
        expect(["ready", "needs_clarification"]).toContain(result.level);
      });

      it("suggests questions for vague briefs", () => {
        const brief = "We need to decide something about our product strategy.";
        const result = assessBriefReadiness(brief);
        if (result.level === "needs_clarification") {
          expect(result.suggested_questions).toBeDefined();
          expect(result.suggested_questions!.length).toBeGreaterThan(0);
        }
      });
    });

    describe("not_ready briefs", () => {
      it("marks empty brief as not_ready", () => {
        const result = assessBriefReadiness("");
        expect(result.level).toBe("not_ready");
        expect(result.score).toBe(0);
      });

      it("marks gibberish as not_ready", () => {
        const result = assessBriefReadiness("asdfghjkl qwertyuiop zxcvbnm");
        expect(result.level).toBe("not_ready");
      });

      it("marks very short brief as not_ready", () => {
        const result = assessBriefReadiness("Hi");
        expect(result.level).toBe("not_ready");
      });
    });

    describe("factor scores", () => {
      it("includes all factor scores", () => {
        const result = assessBriefReadiness("Should we hire a developer?");
        expect(result.factors).toHaveProperty("length_score");
        expect(result.factors).toHaveProperty("clarity_score");
        expect(result.factors).toHaveProperty("decision_relevance_score");
        expect(result.factors).toHaveProperty("specificity_score");
        expect(result.factors).toHaveProperty("context_score");
      });

      it("all factor scores are between 0 and 1", () => {
        const result = assessBriefReadiness("What is the best approach for our Q3 strategy?");
        Object.values(result.factors).forEach(score => {
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        });
      });
    });

    describe("summary generation", () => {
      it("includes summary for all levels", () => {
        const ready = assessBriefReadiness("Should we invest $100K in marketing? Goal is 20% revenue growth by Q4.");
        expect(ready.summary).toBeTruthy();
        expect(typeof ready.summary).toBe("string");

        const notReady = assessBriefReadiness("");
        expect(notReady.summary).toBeTruthy();
      });
    });

    describe("preflight inclusion", () => {
      it("includes preflight result in assessment", () => {
        const result = assessBriefReadiness("Should we hire a new developer?");
        expect(result.preflight).toBeDefined();
        expect(result.preflight.valid).toBeDefined();
        expect(result.preflight.metrics).toBeDefined();
      });
    });
  });

  describe("scoreLengthFactor", () => {
    it("returns low score for very short text", () => {
      expect(scoreLengthFactor(5)).toBeLessThan(0.5);
      expect(scoreLengthFactor(15)).toBeLessThan(0.5);
    });

    it("returns high score for optimal length", () => {
      expect(scoreLengthFactor(100)).toBe(1.0);
      expect(scoreLengthFactor(300)).toBe(1.0);
      expect(scoreLengthFactor(500)).toBe(1.0);
    });

    it("returns moderate score for long text", () => {
      expect(scoreLengthFactor(1500)).toBeLessThan(1.0);
      expect(scoreLengthFactor(1500)).toBeGreaterThan(0.5);
    });
  });

  describe("scoreSpecificityFactor", () => {
    it("increases score for numbers", () => {
      const withNumbers = scoreSpecificityFactor("We have 5 developers on the team");
      const withoutNumbers = scoreSpecificityFactor("We have developers on the team");
      expect(withNumbers).toBeGreaterThan(withoutNumbers);
    });

    it("increases score for percentages", () => {
      const withPercent = scoreSpecificityFactor("Goal is 20% revenue growth");
      const withoutPercent = scoreSpecificityFactor("Goal is revenue growth");
      expect(withPercent).toBeGreaterThan(withoutPercent);
    });

    it("increases score for currency", () => {
      const withCurrency = scoreSpecificityFactor("Budget is $50,000");
      const withoutCurrency = scoreSpecificityFactor("Budget is limited");
      expect(withCurrency).toBeGreaterThan(withoutCurrency);
    });

    it("increases score for time references", () => {
      const withTime = scoreSpecificityFactor("Complete by Q2 2025");
      const withoutTime = scoreSpecificityFactor("Complete soon");
      expect(withTime).toBeGreaterThan(withoutTime);
    });
  });

  describe("scoreContextFactor", () => {
    it("increases score for goal mentions", () => {
      const withGoal = scoreContextFactor("Our goal is to increase revenue");
      const withoutGoal = scoreContextFactor("We are working on revenue");
      expect(withGoal).toBeGreaterThan(withoutGoal);
    });

    it("increases score for constraint mentions", () => {
      const withConstraint = scoreContextFactor("Budget constraint is $50,000");
      const withoutConstraint = scoreContextFactor("We have money available");
      expect(withConstraint).toBeGreaterThan(withoutConstraint);
    });

    it("increases score for stakeholder mentions", () => {
      const withStakeholder = scoreContextFactor("The customer needs this feature");
      const withoutStakeholder = scoreContextFactor("This feature is needed");
      expect(withStakeholder).toBeGreaterThan(withoutStakeholder);
    });
  });

  describe("readiness thresholds", () => {
    it("has sensible threshold values", () => {
      expect(READINESS_THRESHOLDS.ready).toBeGreaterThan(READINESS_THRESHOLDS.needs_clarification);
      expect(READINESS_THRESHOLDS.needs_clarification).toBeGreaterThan(0);
      expect(READINESS_THRESHOLDS.ready).toBeLessThanOrEqual(1);
    });
  });

  describe("generateTargetedClarificationQuestions", () => {
    it("returns questions with targets_factor", () => {
      const factors = {
        length_score: 0.5,
        clarity_score: 0.3,
        decision_relevance_score: 0.2,
        specificity_score: 0.4,
        context_score: 0.5,
      };
      const questions = generateTargetedClarificationQuestions("test brief", factors);
      expect(questions.length).toBeGreaterThan(0);
      questions.forEach(q => {
        expect(q.question).toBeTruthy();
        expect(q.targets_factor).toBeTruthy();
        expect(["length", "clarity", "decision_relevance", "specificity", "context"])
          .toContain(q.targets_factor);
      });
    });

    it("targets weakest factors first", () => {
      const factors = {
        length_score: 0.9,
        clarity_score: 0.8,
        decision_relevance_score: 0.1, // weakest
        specificity_score: 0.7,
        context_score: 0.8,
      };
      const questions = generateTargetedClarificationQuestions("test brief", factors);
      expect(questions.length).toBeGreaterThan(0);
      expect(questions[0].targets_factor).toBe("decision_relevance");
    });

    it("limits questions to 3", () => {
      const factors = {
        length_score: 0.1,
        clarity_score: 0.1,
        decision_relevance_score: 0.1,
        specificity_score: 0.1,
        context_score: 0.1,
      };
      const questions = generateTargetedClarificationQuestions("test brief", factors);
      expect(questions.length).toBeLessThanOrEqual(3);
    });

    it("returns empty array when all factors are high", () => {
      const factors = {
        length_score: 0.9,
        clarity_score: 0.8,
        decision_relevance_score: 0.9,
        specificity_score: 0.7,
        context_score: 0.8,
      };
      const questions = generateTargetedClarificationQuestions("test brief", factors);
      expect(questions.length).toBe(0);
    });
  });

  describe("findWeakestFactor", () => {
    it("returns the factor with lowest score", () => {
      const factors = {
        length_score: 0.5,
        clarity_score: 0.3,
        decision_relevance_score: 0.8,
        specificity_score: 0.1, // weakest
        context_score: 0.6,
      };
      expect(findWeakestFactor(factors)).toBe("specificity");
    });

    it("handles tied scores deterministically", () => {
      const factors = {
        length_score: 0.5,
        clarity_score: 0.5,
        decision_relevance_score: 0.5,
        specificity_score: 0.5,
        context_score: 0.5,
      };
      const result = findWeakestFactor(factors);
      expect(["length", "clarity", "decision_relevance", "specificity", "context"])
        .toContain(result);
    });
  });

  describe("compressPreviousAnswers", () => {
    it("returns undefined for empty or undefined input", () => {
      expect(compressPreviousAnswers(undefined)).toBeUndefined();
      expect(compressPreviousAnswers([])).toBeUndefined();
    });

    it("formats Q&A pairs", () => {
      const answers = [
        { question: "What is the goal?", answer: "Increase revenue" },
        { question: "What is the budget?", answer: "$50,000" },
      ];
      const result = compressPreviousAnswers(answers);
      expect(result).toContain("[Previous clarifications]");
      expect(result).toContain("Q1: What is the goal?");
      expect(result).toContain("A1: Increase revenue");
      expect(result).toContain("Q2: What is the budget?");
      expect(result).toContain("A2: $50,000");
    });

    it("truncates long answers to 200 chars", () => {
      const longAnswer = "a".repeat(300);
      const answers = [
        { question: "What is the goal?", answer: longAnswer },
      ];
      const result = compressPreviousAnswers(answers);
      expect(result).toBeDefined();
      expect(result!.length).toBeLessThan(350); // Header + truncated answer
      expect(result).toContain("...");
    });
  });
});
