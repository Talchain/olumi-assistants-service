import { describe, it, expect } from "vitest";
import {
  generateRiskRewardQuestion,
  generateGoalTradeoffQuestion,
  generateLossAversionQuestion,
  generateTimePreferenceQuestion,
  generateAllQuestions,
  selectQuestions,
  selectNextQuestion,
  calculateTotalEstimatedValue,
  getRemainingQuestionsCount,
  frameQuestionInContext,
  buildQuestionContext,
  estimateDecisionScale,
  processAnswer,
  generateRecommendationImpact,
  createDefaultPreferences,
  mapToISLContract,
  createDefaultISLContract,
  explainTradeoff,
  generateTradeoffSummary,
  DEFAULT_PREFERENCES,
} from "../../src/cee/preference-elicitation/index.js";
import type {
  QuestionContext,
  SelectionContext,
  UserPreferencesT,
  PreferenceQuestionT,
} from "../../src/cee/preference-elicitation/types.js";

describe("CEE Preference Elicitation", () => {
  describe("Question Generation", () => {
    const defaultContext: QuestionContext = {
      goalLabels: new Map([
        ["goal_1", "Increase Revenue"],
        ["goal_2", "Reduce Costs"],
      ]),
      optionLabels: new Map([
        ["opt_1", "Option A"],
        ["opt_2", "Option B"],
      ]),
      decisionScale: 10000,
    };

    it("generates risk/reward question with correct structure", () => {
      const question = generateRiskRewardQuestion(defaultContext);

      expect(question.type).toBe("risk_reward");
      expect(question.options).toHaveLength(2);
      expect(question.options[0].id).toBe("A");
      expect(question.options[1].id).toBe("B");
      expect(question.options[0].probability).toBe(0.7);
      expect(question.options[1].probability).toBe(1.0);
      expect(question.estimated_value).toBeGreaterThan(0);
      expect(question.id).toMatch(/^pref_risk_reward_/);
    });

    it("scales risk/reward amounts based on decision scale", () => {
      const smallContext = { ...defaultContext, decisionScale: 1000 };
      const largeContext = { ...defaultContext, decisionScale: 100000 };

      const smallQuestion = generateRiskRewardQuestion(smallContext);
      const largeQuestion = generateRiskRewardQuestion(largeContext);

      const smallHighValue = smallQuestion.options[0].outcome_value!;
      const largeHighValue = largeQuestion.options[0].outcome_value!;

      expect(largeHighValue).toBeGreaterThan(smallHighValue);
    });

    it("generates goal trade-off question with two goals", () => {
      const question = generateGoalTradeoffQuestion(defaultContext, ["goal_1", "goal_2"]);

      expect(question).not.toBeNull();
      expect(question!.type).toBe("goal_tradeoff");
      expect(question!.options).toHaveLength(2);
      expect(question!.context_node_ids).toEqual(["goal_1", "goal_2"]);
    });

    it("returns null for goal trade-off with single goal", () => {
      const question = generateGoalTradeoffQuestion(defaultContext, ["goal_1"]);

      expect(question).toBeNull();
    });

    it("generates loss aversion question", () => {
      const question = generateLossAversionQuestion(defaultContext);

      expect(question.type).toBe("loss_aversion");
      expect(question.options).toHaveLength(2);
      expect(question.question).toContain("concerns");
    });

    it("generates time preference question", () => {
      const question = generateTimePreferenceQuestion(defaultContext);

      expect(question.type).toBe("time_preference");
      expect(question.options).toHaveLength(2);
      expect(question.options[0].timeframe).toBe("immediate");
      expect(question.options[1].timeframe).toBe("12_months");
    });

    it("generates all question types", () => {
      const questions = generateAllQuestions(defaultContext, ["goal_1", "goal_2"]);

      const types = questions.map((q) => q.type);
      expect(types).toContain("risk_reward");
      expect(types).toContain("loss_aversion");
      expect(types).toContain("goal_tradeoff");
      expect(types).toContain("time_preference");
    });
  });

  describe("Question Selection", () => {
    const defaultSelectionContext: SelectionContext = {
      graphGoals: ["goal_1", "goal_2"],
      graphOptions: ["opt_1", "opt_2"],
      decisionScale: 10000,
    };

    it("selects questions up to max limit", () => {
      const questions = selectQuestions(defaultSelectionContext, 2);

      expect(questions.length).toBeLessThanOrEqual(2);
      expect(questions.length).toBeGreaterThan(0);
    });

    it("prioritises questions by information gain", () => {
      const questions = selectQuestions(defaultSelectionContext, 4);

      // First question should have highest estimated value
      const values = questions.map((q) => q.estimated_value);
      for (let i = 1; i < values.length; i++) {
        expect(values[i - 1]).toBeGreaterThanOrEqual(values[i]);
      }
    });

    it("adjusts selection based on current preferences", () => {
      const withPrefs: SelectionContext = {
        ...defaultSelectionContext,
        currentPreferences: {
          ...DEFAULT_PREFERENCES,
          risk_aversion: 0.8, // Strong risk aversion already known
          derived_from: {
            questions_answered: 2,
            last_updated: new Date().toISOString(),
          },
        },
      };

      const questions = selectQuestions(withPrefs, 3);

      // Should still return questions but may prioritise different types
      expect(questions.length).toBeGreaterThan(0);
    });

    it("selectNextQuestion returns single best question", () => {
      const question = selectNextQuestion(defaultSelectionContext);

      expect(question).not.toBeNull();
      expect(question!.estimated_value).toBeGreaterThan(0);
    });

    it("calculates total estimated value", () => {
      const questions = selectQuestions(defaultSelectionContext, 3);
      const totalValue = calculateTotalEstimatedValue(questions);

      expect(totalValue).toBeGreaterThan(0);
      expect(totalValue).toBeLessThanOrEqual(1);
    });

    it("returns remaining questions count based on confidence target", () => {
      const lowConfPrefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        confidence: "low",
        derived_from: { questions_answered: 0, last_updated: "" },
      };
      const highConfPrefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        confidence: "high",
        derived_from: { questions_answered: 5, last_updated: "" },
      };

      expect(getRemainingQuestionsCount(lowConfPrefs, "high")).toBeGreaterThan(0);
      expect(getRemainingQuestionsCount(highConfPrefs, "high")).toBe(0);
    });
  });

  describe("Contextual Framing", () => {
    it("frames question with decision label", () => {
      const question: PreferenceQuestionT = {
        id: "test_1",
        type: "risk_reward",
        question: "Which would you prefer?",
        options: [
          { id: "A", label: "Option A" },
          { id: "B", label: "Option B" },
        ],
        estimated_value: 0.5,
      };

      const context: QuestionContext = {
        goalLabels: new Map(),
        optionLabels: new Map(),
        decisionScale: 10000,
        decisionLabel: "vendor selection",
      };

      const framed = frameQuestionInContext(question, context);

      expect(framed.question).toContain("vendor selection");
    });

    it("frames goal trade-off with actual goal labels", () => {
      const question: PreferenceQuestionT = {
        id: "test_1",
        type: "goal_tradeoff",
        question: "Which do you prioritise?",
        options: [
          { id: "A", label: "Optimise for: [Goal A]" },
          { id: "B", label: "Optimise for: [Goal B]" },
        ],
        estimated_value: 0.5,
        context_node_ids: ["g1", "g2"],
      };

      const context: QuestionContext = {
        goalLabels: new Map([
          ["g1", "Revenue Growth"],
          ["g2", "Cost Reduction"],
        ]),
        optionLabels: new Map(),
        decisionScale: 10000,
      };

      const framed = frameQuestionInContext(question, context);

      expect(framed.options[0].label).toContain("Revenue Growth");
      expect(framed.options[1].label).toContain("Cost Reduction");
    });

    it("builds question context from arrays", () => {
      const context = buildQuestionContext(
        ["g1", "g2"],
        ["Goal 1", "Goal 2"],
        ["o1", "o2"],
        ["Option 1", "Option 2"],
        50000,
        "Marketing Budget"
      );

      expect(context.goalLabels.get("g1")).toBe("Goal 1");
      expect(context.optionLabels.get("o1")).toBe("Option 1");
      expect(context.decisionScale).toBe(50000);
      expect(context.decisionLabel).toBe("Marketing Budget");
    });

    it("estimates decision scale from option values", () => {
      const options = [
        { expected_value: 10000 },
        { expected_value: 15000 },
        { expected_value: 8000 },
      ];

      const scale = estimateDecisionScale(options);

      expect(scale).toBe(15000); // Max value
    });

    it("returns default scale when no values provided", () => {
      const scale = estimateDecisionScale([{}, {}]);

      expect(scale).toBe(10000);
    });
  });

  describe("Answer Processing", () => {
    it("processes risk/reward answer A (risky choice)", () => {
      const question: PreferenceQuestionT = {
        id: "test",
        type: "risk_reward",
        question: "Test",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
      };

      const result = processAnswer(question, "A");

      expect(result.updated.risk_aversion).toBeLessThan(0.5);
      expect(result.impact).toContain("higher potential");
    });

    it("processes risk/reward answer B (safe choice)", () => {
      const question: PreferenceQuestionT = {
        id: "test",
        type: "risk_reward",
        question: "Test",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
      };

      const result = processAnswer(question, "B");

      expect(result.updated.risk_aversion).toBeGreaterThan(0.5);
      expect(result.impact).toContain("certainty");
    });

    it("processes loss aversion answer", () => {
      const question: PreferenceQuestionT = {
        id: "test",
        type: "loss_aversion",
        question: "Test",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
      };

      const resultA = processAnswer(question, "A");
      const resultB = processAnswer(question, "B");

      expect(resultA.updated.loss_aversion).toBeLessThan(resultB.updated.loss_aversion);
    });

    it("processes goal trade-off answer", () => {
      const question: PreferenceQuestionT = {
        id: "test",
        type: "goal_tradeoff",
        question: "Test",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
        context_node_ids: ["g1", "g2"],
      };

      const result = processAnswer(question, "A");

      expect(result.updated.goal_weights["g1"]).toBeGreaterThan(
        result.updated.goal_weights["g2"]
      );
    });

    it("processes time preference answer", () => {
      const question: PreferenceQuestionT = {
        id: "test",
        type: "time_preference",
        question: "Test",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
      };

      const resultA = processAnswer(question, "A"); // Prefer now
      const resultB = processAnswer(question, "B"); // Prefer later

      expect(resultA.updated.time_discount).toBeGreaterThan(resultB.updated.time_discount);
    });

    it("increments questions_answered", () => {
      const question: PreferenceQuestionT = {
        id: "test",
        type: "risk_reward",
        question: "Test",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
      };

      const result = processAnswer(question, "A");

      expect(result.updated.derived_from.questions_answered).toBe(1);
    });

    it("updates confidence level based on questions answered", () => {
      const question: PreferenceQuestionT = {
        id: "test",
        type: "risk_reward",
        question: "Test",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
      };

      // First answer -> medium confidence
      const result1 = processAnswer(question, "A");
      expect(result1.updated.confidence).toBe("medium");

      // Second answer
      const result2 = processAnswer(question, "A", result1.updated);
      expect(result2.updated.confidence).toBe("medium");

      // Third answer -> high confidence
      const result3 = processAnswer(question, "A", result2.updated);
      expect(result3.updated.confidence).toBe("high");
    });

    it("generates recommendation impact statement", () => {
      const newPrefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        risk_aversion: 0.7,
      };

      const impact = generateRecommendationImpact(
        DEFAULT_PREFERENCES,
        newPrefs,
        "risk_reward"
      );

      expect(impact.length).toBeGreaterThan(0);
    });

    it("creates default preferences", () => {
      const prefs = createDefaultPreferences();

      expect(prefs.risk_aversion).toBe(0.5);
      expect(prefs.loss_aversion).toBe(1.5);
      expect(prefs.confidence).toBe("low");
      expect(prefs.derived_from.questions_answered).toBe(0);
    });
  });

  describe("ISL Mapping", () => {
    it("maps preferences to ISL contract", () => {
      const prefs: UserPreferencesT = {
        risk_aversion: 0.6,
        loss_aversion: 1.8,
        goal_weights: { g1: 0.6, g2: 0.4 },
        time_discount: 0.1,
        confidence: "medium",
        derived_from: { questions_answered: 2, last_updated: "" },
      };

      const contract = mapToISLContract(prefs);

      expect(contract.risk_parameters.risk_aversion).toBe(0.6);
      expect(contract.risk_parameters.loss_aversion).toBe(1.8);
      expect(contract.goal_parameters.discount_rate).toBe(0.1);
    });

    it("selects prospect_theory for high loss aversion", () => {
      const prefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        loss_aversion: 2.5, // High loss aversion
      };

      const contract = mapToISLContract(prefs);

      expect(contract.aggregation_method).toBe("prospect_theory");
    });

    it("selects cvar for high risk aversion", () => {
      const prefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        risk_aversion: 0.8, // High risk aversion
        loss_aversion: 1.3, // Low loss aversion (below threshold)
      };

      const contract = mapToISLContract(prefs);

      expect(contract.aggregation_method).toBe("cvar");
    });

    it("selects weighted_sum for multiple goals", () => {
      const prefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        risk_aversion: 0.5, // Moderate
        loss_aversion: 1.3, // Below threshold
        goal_weights: { g1: 0.5, g2: 0.5 },
      };

      const contract = mapToISLContract(prefs);

      expect(contract.aggregation_method).toBe("weighted_sum");
    });

    it("normalises goal weights to sum to 1", () => {
      const prefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        goal_weights: { g1: 3, g2: 1 }, // Not normalised
      };

      const contract = mapToISLContract(prefs);
      const weights = contract.goal_parameters.weights;
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);

      expect(sum).toBeCloseTo(1, 5);
      expect(weights["g1"]).toBeCloseTo(0.75, 5);
      expect(weights["g2"]).toBeCloseTo(0.25, 5);
    });

    it("creates default ISL contract", () => {
      const contract = createDefaultISLContract();

      expect(contract.aggregation_method).toBe("expected_value");
      expect(contract.risk_parameters.risk_aversion).toBe(0.5);
    });
  });

  describe("Trade-off Explanation", () => {
    it("generates explanation with key factors", () => {
      const prefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        risk_aversion: 0.8, // Risk averse
      };

      const result = explainTradeoff("Option A", "Option B", prefs);

      expect(result.explanation.length).toBeGreaterThan(0);
      expect(result.key_factors.length).toBeGreaterThan(0);
    });

    it("identifies risk preference factor", () => {
      const riskAversePrefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        risk_aversion: 0.8,
      };

      const result = explainTradeoff("Option A", "Option B", riskAversePrefs);

      const riskFactor = result.key_factors.find((f) =>
        f.factor.toLowerCase().includes("risk")
      );
      expect(riskFactor).toBeDefined();
    });

    it("identifies loss sensitivity factor", () => {
      const lossAversePrefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        loss_aversion: 2.5,
      };

      const result = explainTradeoff("Option A", "Option B", lossAversePrefs);

      const lossFactor = result.key_factors.find((f) =>
        f.factor.toLowerCase().includes("loss")
      );
      expect(lossFactor).toBeDefined();
    });

    it("includes goal context in explanation", () => {
      const result = explainTradeoff(
        "Option A",
        "Option B",
        DEFAULT_PREFERENCES,
        "increase market share"
      );

      expect(result.explanation).toContain("increase market share");
    });

    it("calculates preference alignment scores", () => {
      const result = explainTradeoff("Option A", "Option B", DEFAULT_PREFERENCES);

      expect(result.preference_alignment.option_a_score).toBeGreaterThanOrEqual(0);
      expect(result.preference_alignment.option_b_score).toBeGreaterThanOrEqual(0);
      expect(["A", "B", "neutral"]).toContain(result.preference_alignment.recommended);
    });

    it("adds low confidence caveat", () => {
      const lowConfPrefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        confidence: "low",
      };

      const result = explainTradeoff("Option A", "Option B", lowConfPrefs);

      expect(result.explanation).toContain("limited preference data");
    });

    it("generates trade-off summary", () => {
      const prefs: UserPreferencesT = {
        ...DEFAULT_PREFERENCES,
        risk_aversion: 0.8,
        loss_aversion: 2.2,
      };

      const summary = generateTradeoffSummary(prefs);

      expect(summary.length).toBeGreaterThan(0);
      expect(summary).toContain("risk-averse");
      expect(summary).toContain("loss-sensitive");
    });
  });
});
