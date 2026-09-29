import { describe, it, expect } from "vitest";
import {
  elicitRiskTolerance,
  validateRiskToleranceInput,
  PRODUCT_QUESTIONS,
  BUSINESS_QUESTIONS,
  type GetQuestionsOutput,
  type ProcessResponsesOutput,
} from "../../src/cee/risk-tolerance-elicitation/index.js";

describe("CEE Risk Tolerance Elicitation", () => {
  describe("get_questions mode", () => {
    describe("product context", () => {
      it("returns 5 product questions", () => {
        const result = elicitRiskTolerance({
          mode: "get_questions",
          context: "product",
        }) as GetQuestionsOutput;

        expect(result.questions).toHaveLength(5);
        expect(result.provenance).toBe("cee");
      });

      it("each question has 3 options", () => {
        const result = elicitRiskTolerance({
          mode: "get_questions",
          context: "product",
        }) as GetQuestionsOutput;

        for (const question of result.questions) {
          expect(question.options).toHaveLength(3);
        }
      });

      it("each option has id, label, and risk_score", () => {
        const result = elicitRiskTolerance({
          mode: "get_questions",
          context: "product",
        }) as GetQuestionsOutput;

        for (const question of result.questions) {
          for (const option of question.options) {
            expect(option.id).toBeDefined();
            expect(option.label).toBeDefined();
            expect(typeof option.risk_score).toBe("number");
            expect(option.risk_score).toBeGreaterThanOrEqual(0);
            expect(option.risk_score).toBeLessThanOrEqual(100);
          }
        }
      });

      it("questions cover all three categories", () => {
        // Check that product questions cover certainty, loss_aversion, time_preference
        const categories = new Set<string>();
        for (const q of PRODUCT_QUESTIONS) {
          categories.add(q.category);
        }
        expect(categories).toContain("certainty");
        expect(categories).toContain("loss_aversion");
        expect(categories).toContain("time_preference");
      });
    });

    describe("business context", () => {
      it("returns 5 business questions", () => {
        const result = elicitRiskTolerance({
          mode: "get_questions",
          context: "business",
        }) as GetQuestionsOutput;

        expect(result.questions).toHaveLength(5);
        expect(result.provenance).toBe("cee");
      });

      it("business questions are different from product questions", () => {
        const productResult = elicitRiskTolerance({
          mode: "get_questions",
          context: "product",
        }) as GetQuestionsOutput;

        const businessResult = elicitRiskTolerance({
          mode: "get_questions",
          context: "business",
        }) as GetQuestionsOutput;

        // Different question IDs
        const productIds = new Set(productResult.questions.map((q) => q.id));
        const businessIds = new Set(businessResult.questions.map((q) => q.id));

        for (const id of businessIds) {
          expect(productIds).not.toContain(id);
        }
      });
    });

    describe("default context", () => {
      it("defaults to product context when not specified", () => {
        const result = elicitRiskTolerance({
          mode: "get_questions",
        }) as GetQuestionsOutput;

        const productResult = elicitRiskTolerance({
          mode: "get_questions",
          context: "product",
        }) as GetQuestionsOutput;

        expect(result.questions[0].id).toBe(productResult.questions[0].id);
      });
    });
  });

  describe("process_responses mode", () => {
    describe("risk_averse profile", () => {
      it("returns risk_averse for consistently low-risk choices", () => {
        // All first options (lowest risk scores)
        const responses = PRODUCT_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[0].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.profile.type).toBe("risk_averse");
        expect(result.profile.score).toBeLessThanOrEqual(35);
        expect(result.profile.recommended_coefficient).toBe(0.8);
        expect(result.provenance).toBe("cee");
      });

      it("provides category breakdown for risk_averse", () => {
        const responses = PRODUCT_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[0].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.breakdown).toBeDefined();
        expect(result.breakdown.certainty).toBeDefined();
        expect(result.breakdown.loss_aversion).toBeDefined();
        expect(result.breakdown.time_preference).toBeDefined();
      });
    });

    describe("risk_seeking profile", () => {
      it("returns risk_seeking for consistently high-risk choices", () => {
        // All third options (highest risk scores)
        const responses = PRODUCT_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[2].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.profile.type).toBe("risk_seeking");
        expect(result.profile.score).toBeGreaterThanOrEqual(65);
        expect(result.profile.recommended_coefficient).toBe(0.2);
        expect(result.provenance).toBe("cee");
      });
    });

    describe("risk_neutral profile", () => {
      it("returns risk_neutral for moderate choices", () => {
        // All middle options
        const responses = PRODUCT_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[1].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.profile.type).toBe("risk_neutral");
        expect(result.profile.score).toBeGreaterThan(35);
        expect(result.profile.score).toBeLessThan(65);
        expect(result.profile.recommended_coefficient).toBe(0.5);
        expect(result.provenance).toBe("cee");
      });
    });

    describe("confidence levels", () => {
      it("returns high confidence when all questions answered", () => {
        const responses = PRODUCT_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[1].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.confidence).toBe("high");
      });

      it("returns medium confidence when some questions answered", () => {
        // Only 3 out of 5 questions
        const responses = PRODUCT_QUESTIONS.slice(0, 3).map((q) => ({
          question_id: q.id,
          option_id: q.options[1].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.confidence).toBe("medium");
      });

      it("returns low confidence when few questions answered", () => {
        // Only 2 out of 5 questions
        const responses = PRODUCT_QUESTIONS.slice(0, 2).map((q) => ({
          question_id: q.id,
          option_id: q.options[1].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.confidence).toBe("low");
      });

      it("returns low confidence for empty responses", () => {
        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses: [],
        }) as ProcessResponsesOutput;

        expect(result.confidence).toBe("low");
        expect(result.profile.type).toBe("risk_neutral");
        expect(result.profile.score).toBe(50);
      });
    });

    describe("reasoning generation", () => {
      it("includes reasoning in profile", () => {
        const responses = PRODUCT_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[0].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.profile.reasoning).toBeDefined();
        expect(result.profile.reasoning.length).toBeGreaterThan(0);
      });

      it("reasoning mentions certainty preference for risk_averse", () => {
        const responses = PRODUCT_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[0].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.profile.reasoning.toLowerCase()).toContain("certainty");
      });
    });

    describe("edge cases", () => {
      it("ignores invalid question IDs", () => {
        const responses = [
          { question_id: "invalid_q1", option_id: "invalid_o1" },
          { question_id: PRODUCT_QUESTIONS[0].id, option_id: PRODUCT_QUESTIONS[0].options[1].id },
        ];

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        // Should still process valid responses
        expect(result.confidence).toBe("low"); // Only 1 valid response
        expect(result.provenance).toBe("cee");
      });

      it("ignores invalid option IDs", () => {
        const responses = [
          { question_id: PRODUCT_QUESTIONS[0].id, option_id: "invalid_option" },
        ];

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.confidence).toBe("low");
        expect(result.provenance).toBe("cee");
      });

      it("handles mixed valid and invalid responses", () => {
        const responses = [
          { question_id: PRODUCT_QUESTIONS[0].id, option_id: PRODUCT_QUESTIONS[0].options[1].id },
          { question_id: "invalid", option_id: "invalid" },
          { question_id: PRODUCT_QUESTIONS[1].id, option_id: PRODUCT_QUESTIONS[1].options[1].id },
          { question_id: PRODUCT_QUESTIONS[2].id, option_id: PRODUCT_QUESTIONS[2].options[1].id },
        ];

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "product",
          responses,
        }) as ProcessResponsesOutput;

        // 3 valid responses out of 5 questions = 60% = medium
        expect(result.confidence).toBe("medium");
      });
    });

    describe("business context processing", () => {
      it("processes business context responses correctly", () => {
        const responses = BUSINESS_QUESTIONS.map((q) => ({
          question_id: q.id,
          option_id: q.options[1].id,
        }));

        const result = elicitRiskTolerance({
          mode: "process_responses",
          context: "business",
          responses,
        }) as ProcessResponsesOutput;

        expect(result.profile.type).toBe("risk_neutral");
        expect(result.confidence).toBe("high");
        expect(result.provenance).toBe("cee");
      });
    });
  });

  describe("provenance", () => {
    it("always includes provenance: cee for get_questions", () => {
      const result = elicitRiskTolerance({
        mode: "get_questions",
      }) as GetQuestionsOutput;

      expect(result.provenance).toBe("cee");
    });

    it("always includes provenance: cee for process_responses", () => {
      const result = elicitRiskTolerance({
        mode: "process_responses",
        responses: [],
      }) as ProcessResponsesOutput;

      expect(result.provenance).toBe("cee");
    });
  });

  describe("validateRiskToleranceInput", () => {
    it("validates get_questions mode", () => {
      expect(
        validateRiskToleranceInput({
          mode: "get_questions",
        })
      ).toBe(true);
    });

    it("validates get_questions with context", () => {
      expect(
        validateRiskToleranceInput({
          mode: "get_questions",
          context: "product",
        })
      ).toBe(true);

      expect(
        validateRiskToleranceInput({
          mode: "get_questions",
          context: "business",
        })
      ).toBe(true);
    });

    it("validates process_responses mode", () => {
      expect(
        validateRiskToleranceInput({
          mode: "process_responses",
          responses: [
            { question_id: "q1", option_id: "o1" },
          ],
        })
      ).toBe(true);
    });

    it("validates process_responses with empty responses", () => {
      expect(
        validateRiskToleranceInput({
          mode: "process_responses",
          responses: [],
        })
      ).toBe(true);
    });

    it("rejects null input", () => {
      expect(validateRiskToleranceInput(null)).toBe(false);
    });

    it("rejects undefined input", () => {
      expect(validateRiskToleranceInput(undefined)).toBe(false);
    });

    it("rejects invalid mode", () => {
      expect(
        validateRiskToleranceInput({
          mode: "invalid_mode",
        })
      ).toBe(false);
    });

    it("rejects invalid context", () => {
      expect(
        validateRiskToleranceInput({
          mode: "get_questions",
          context: "invalid_context",
        })
      ).toBe(false);
    });

    it("rejects non-array responses", () => {
      expect(
        validateRiskToleranceInput({
          mode: "process_responses",
          responses: "not-an-array",
        })
      ).toBe(false);
    });

    it("rejects responses with missing question_id", () => {
      expect(
        validateRiskToleranceInput({
          mode: "process_responses",
          responses: [{ option_id: "o1" }],
        })
      ).toBe(false);
    });

    it("rejects responses with missing option_id", () => {
      expect(
        validateRiskToleranceInput({
          mode: "process_responses",
          responses: [{ question_id: "q1" }],
        })
      ).toBe(false);
    });
  });

  describe("question data integrity", () => {
    it("all product questions have unique IDs", () => {
      const ids = PRODUCT_QUESTIONS.map((q) => q.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("all business questions have unique IDs", () => {
      const ids = BUSINESS_QUESTIONS.map((q) => q.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("all option IDs within a question are unique", () => {
      for (const q of [...PRODUCT_QUESTIONS, ...BUSINESS_QUESTIONS]) {
        const optionIds = q.options.map((o) => o.id);
        const uniqueOptionIds = new Set(optionIds);
        expect(uniqueOptionIds.size).toBe(optionIds.length);
      }
    });

    it("all options have risk scores in valid range", () => {
      for (const q of [...PRODUCT_QUESTIONS, ...BUSINESS_QUESTIONS]) {
        for (const o of q.options) {
          expect(o.risk_score).toBeGreaterThanOrEqual(0);
          expect(o.risk_score).toBeLessThanOrEqual(100);
        }
      }
    });
  });
});
