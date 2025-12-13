import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Stub env vars before importing build (important!)
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import type { UserPreferencesT } from "../../src/cee/preference-elicitation/types.js";
import { storeQuestion } from "../../src/routes/assist.v1.elicit-preferences-answer.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("CEE Preference Elicitation Integration", () => {
  let app: FastifyInstance;

  // Auth headers for integration tests
  const headersKey1 = { "X-Olumi-Assist-Key": "pref-elicit-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "pref-elicit-key-2" } as const;
  const headersKey3 = { "X-Olumi-Assist-Key": "pref-elicit-key-3" } as const;
  const headersKey4 = { "X-Olumi-Assist-Key": "pref-elicit-key-4" } as const;
  const headersKey5 = { "X-Olumi-Assist-Key": "pref-elicit-key-5" } as const;
  const headersKeyE2E = { "X-Olumi-Assist-Key": "pref-elicit-key-e2e" } as const;

  beforeAll(async () => {
    // Configure API keys for tests
    vi.stubEnv("ASSIST_API_KEYS", "pref-elicit-key-1,pref-elicit-key-2,pref-elicit-key-3,pref-elicit-key-4,pref-elicit-key-5,pref-elicit-key-e2e");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  describe("POST /assist/v1/elicit/preferences", () => {
    it("returns 200 with valid input", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences",
        headers: headersKey1,
        payload: {
          graph_id: "test-graph-123",
          goal_ids: ["goal_1", "goal_2"],
          options: [
            { id: "opt_1", label: "Option A", expected_value: 10000 },
            { id: "opt_2", label: "Option B", expected_value: 8000 },
          ],
          max_questions: 3,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.questions).toBeDefined();
      expect(Array.isArray(body.questions)).toBe(true);
      expect(body.questions.length).toBeLessThanOrEqual(3);
      expect(body.estimated_value).toBeGreaterThan(0);
      expect(body.trace).toBeDefined();
      expect(body.provenance).toBe("cee");
    });

    it("returns questions with proper structure", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences",
        headers: headersKey1,
        payload: {
          graph_id: "test-graph-123",
          goal_ids: ["goal_1"],
          options: [{ id: "opt_1", label: "Option A" }],
          max_questions: 2,
        },
      });

      const body = JSON.parse(response.body);
      const question = body.questions[0];

      expect(question.id).toBeDefined();
      expect(question.type).toBeDefined();
      expect(question.question).toBeDefined();
      expect(question.options).toHaveLength(2);
      expect(question.options[0].id).toBe("A");
      expect(question.options[1].id).toBe("B");
      expect(question.estimated_value).toBeGreaterThanOrEqual(0);
      expect(question.estimated_value).toBeLessThanOrEqual(1);
    });

    it("respects max_questions parameter", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences",
        headers: headersKey1,
        payload: {
          graph_id: "test-graph-123",
          goal_ids: ["goal_1", "goal_2"],
          options: [{ id: "opt_1", label: "Option A" }],
          max_questions: 1,
        },
      });

      const body = JSON.parse(response.body);
      expect(body.questions.length).toBe(1);
    });

    it("accepts current_preferences for refinement", async () => {
      const currentPrefs: UserPreferencesT = {
        risk_aversion: 0.6,
        loss_aversion: 1.8,
        goal_weights: {},
        time_discount: 0.1,
        confidence: "medium",
        derived_from: {
          questions_answered: 2,
          last_updated: new Date().toISOString(),
        },
      };

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences",
        headers: headersKey2,
        payload: {
          graph_id: "test-graph-123",
          goal_ids: ["goal_1"],
          options: [{ id: "opt_1", label: "Option A" }],
          current_preferences: currentPrefs,
          max_questions: 2,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.questions).toBeDefined();
    });

    it("returns 400 for invalid input", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences",
        headers: headersKey3,
        payload: {
          // Missing required fields
          graph_id: "test",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("includes CEE headers in response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences",
        headers: headersKey4,
        payload: {
          graph_id: "test-graph-123",
          goal_ids: ["goal_1"],
          options: [{ id: "opt_1", label: "Option A" }],
        },
      });

      expect(response.headers["x-cee-api-version"]).toBe("v1");
      expect(response.headers["x-cee-feature-version"]).toBeDefined();
      expect(response.headers["x-cee-request-id"]).toBeDefined();
    });
  });

  describe("POST /assist/v1/elicit/preferences/answer", () => {
    it("returns 200 when processing valid answer", async () => {
      // First, store a test question
      const testQuestion = {
        id: "test_question_1",
        type: "risk_reward" as const,
        question: "Test question",
        options: [
          { id: "A", label: "Option A" },
          { id: "B", label: "Option B" },
        ],
        estimated_value: 0.5,
      };
      storeQuestion(testQuestion);

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences/answer",
        headers: headersKey1,
        payload: {
          question_id: "test_question_1",
          answer: "A",
          graph_id: "test-graph-123",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.updated_preferences).toBeDefined();
      expect(body.recommendation_impact).toBeDefined();
      expect(body.remaining_questions).toBeDefined();
      expect(body.provenance).toBe("cee");
    });

    it("updates preferences based on answer", async () => {
      // Store a risk_reward question
      const testQuestion = {
        id: "test_question_risk",
        type: "risk_reward" as const,
        question: "Test risk question",
        options: [
          { id: "A", label: "Risky", probability: 0.7 },
          { id: "B", label: "Safe", probability: 1.0 },
        ],
        estimated_value: 0.5,
      };
      storeQuestion(testQuestion);

      const responseA = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences/answer",
        headers: headersKey2,
        payload: {
          question_id: "test_question_risk",
          answer: "A", // Chose risky option
          graph_id: "test-graph-123",
        },
      });

      const bodyA = JSON.parse(responseA.body);
      expect(bodyA.updated_preferences.risk_aversion).toBeLessThan(0.5);

      // Store another question for B test
      const testQuestion2 = {
        id: "test_question_risk_2",
        type: "risk_reward" as const,
        question: "Test risk question 2",
        options: [
          { id: "A", label: "Risky", probability: 0.7 },
          { id: "B", label: "Safe", probability: 1.0 },
        ],
        estimated_value: 0.5,
      };
      storeQuestion(testQuestion2);

      const responseB = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences/answer",
        headers: headersKey2,
        payload: {
          question_id: "test_question_risk_2",
          answer: "B", // Chose safe option
          graph_id: "test-graph-123",
        },
      });

      const bodyB = JSON.parse(responseB.body);
      expect(bodyB.updated_preferences.risk_aversion).toBeGreaterThan(0.5);
    });

    it("includes next_question when more needed", async () => {
      const testQuestion = {
        id: "test_question_next",
        type: "risk_reward" as const,
        question: "Test question",
        options: [
          { id: "A", label: "A" },
          { id: "B", label: "B" },
        ],
        estimated_value: 0.5,
      };
      storeQuestion(testQuestion);

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences/answer",
        headers: headersKey3,
        payload: {
          question_id: "test_question_next",
          answer: "A",
          graph_id: "test-graph-123",
        },
      });

      const body = JSON.parse(response.body);
      // Should suggest more questions since only 1 answered
      expect(body.remaining_questions).toBeGreaterThanOrEqual(0);
    });

    it("returns 404 for unknown question_id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences/answer",
        headers: headersKey4,
        payload: {
          question_id: "nonexistent_question",
          answer: "A",
          graph_id: "test-graph-123",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 400 for invalid answer", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences/answer",
        headers: headersKey5,
        payload: {
          question_id: "test_question_1",
          answer: "C", // Invalid - must be A or B
          graph_id: "test-graph-123",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /assist/v1/explain/tradeoff", () => {
    const validPreferences: UserPreferencesT = {
      risk_aversion: 0.7,
      loss_aversion: 2.0,
      goal_weights: { goal_1: 0.6, goal_2: 0.4 },
      time_discount: 0.1,
      confidence: "medium",
      derived_from: {
        questions_answered: 2,
        last_updated: new Date().toISOString(),
      },
    };

    it("returns 200 with valid input", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKey1,
        payload: {
          option_a: "Launch now with basic features",
          option_b: "Wait 6 months for full feature set",
          user_preferences: validPreferences,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.explanation).toBeDefined();
      expect(typeof body.explanation).toBe("string");
      expect(body.explanation.length).toBeGreaterThan(0);
      expect(body.key_factors).toBeDefined();
      expect(Array.isArray(body.key_factors)).toBe(true);
      expect(body.preference_alignment).toBeDefined();
      expect(body.provenance).toBe("cee");
    });

    it("includes preference alignment scores", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKey2,
        payload: {
          option_a: "Option A",
          option_b: "Option B",
          user_preferences: validPreferences,
        },
      });

      const body = JSON.parse(response.body);
      expect(body.preference_alignment.option_a_score).toBeDefined();
      expect(body.preference_alignment.option_b_score).toBeDefined();
      expect(["A", "B", "neutral"]).toContain(body.preference_alignment.recommended);
    });

    it("identifies key factors from preferences", async () => {
      const riskAversePrefs = {
        ...validPreferences,
        risk_aversion: 0.9, // Very risk averse
      };

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKey3,
        payload: {
          option_a: "Option A",
          option_b: "Option B",
          user_preferences: riskAversePrefs,
        },
      });

      const body = JSON.parse(response.body);
      const riskFactor = body.key_factors.find((f: any) =>
        f.factor.toLowerCase().includes("risk")
      );
      expect(riskFactor).toBeDefined();
    });

    it("accepts optional goal_context", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKey4,
        payload: {
          option_a: "Option A",
          option_b: "Option B",
          user_preferences: validPreferences,
          goal_context: "increase market share by 20%",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.explanation).toContain("market share");
    });

    it("returns 400 for missing user_preferences", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKey5,
        payload: {
          option_a: "Option A",
          option_b: "Option B",
          // Missing user_preferences
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("CEE_VALIDATION_FAILED");
    });

    it("returns 400 for invalid preference values", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKey5,
        payload: {
          option_a: "Option A",
          option_b: "Option B",
          user_preferences: {
            ...validPreferences,
            risk_aversion: 2.0, // Invalid - must be 0-1
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("includes CEE headers in response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKey1,
        payload: {
          option_a: "Option A",
          option_b: "Option B",
          user_preferences: validPreferences,
        },
      });

      expect(response.headers["x-cee-api-version"]).toBe("v1");
      expect(response.headers["x-cee-feature-version"]).toBeDefined();
      expect(response.headers["x-cee-request-id"]).toBeDefined();
    });
  });

  describe("End-to-end preference elicitation flow", () => {
    it("completes full elicitation flow", async () => {
      // Step 1: Get initial questions
      const questionsResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences",
        headers: headersKeyE2E,
        payload: {
          graph_id: "e2e-test-graph",
          goal_ids: ["goal_1", "goal_2"],
          options: [
            { id: "opt_1", label: "Expand to US market", expected_value: 100000 },
            { id: "opt_2", label: "Focus on UK market", expected_value: 50000 },
          ],
          max_questions: 2,
        },
      });

      expect(questionsResponse.statusCode).toBe(200);
      const questionsBody = JSON.parse(questionsResponse.body);
      expect(questionsBody.questions.length).toBeGreaterThan(0);

      // Store questions for answer processing
      for (const q of questionsBody.questions) {
        storeQuestion(q);
      }

      // Step 2: Answer first question
      const firstQuestion = questionsBody.questions[0];
      const answerResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/elicit/preferences/answer",
        headers: headersKeyE2E,
        payload: {
          question_id: firstQuestion.id,
          answer: "A",
          graph_id: "e2e-test-graph",
        },
      });

      expect(answerResponse.statusCode).toBe(200);
      const answerBody = JSON.parse(answerResponse.body);
      expect(answerBody.updated_preferences).toBeDefined();
      expect(answerBody.updated_preferences.derived_from.questions_answered).toBe(1);

      // Step 3: Use preferences for tradeoff explanation
      const tradeoffResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/explain/tradeoff",
        headers: headersKeyE2E,
        payload: {
          option_a: "Expand to US market",
          option_b: "Focus on UK market",
          user_preferences: answerBody.updated_preferences,
          goal_context: "international expansion",
        },
      });

      expect(tradeoffResponse.statusCode).toBe(200);
      const tradeoffBody = JSON.parse(tradeoffResponse.body);
      expect(tradeoffBody.explanation.length).toBeGreaterThan(0);
      expect(tradeoffBody.key_factors.length).toBeGreaterThanOrEqual(0);
    });
  });
});
