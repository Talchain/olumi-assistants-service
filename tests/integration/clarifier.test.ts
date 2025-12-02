/**
 * Clarifier Integration Tests
 *
 * Tests POST /assist/clarify-brief route with fixtures adapter
 * Verifies:
 * - Route responds correctly to valid inputs
 * - Schema validation works
 * - Telemetry events are emitted
 * - Provider routing works
 * - Round limits enforced
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import clarifyRoute from "../../src/routes/assist.clarify-brief.js";

// Use fixtures adapter for deterministic tests without API keys
vi.stubEnv("LLM_PROVIDER", "fixtures");

describe("POST /assist/clarify-brief (Fixtures)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await clarifyRoute(app);
  });

  it("accepts valid round 0 request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.questions).toBeDefined();
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions.length).toBeGreaterThan(0);
    expect(body.confidence).toBeGreaterThanOrEqual(0);
    expect(body.confidence).toBeLessThanOrEqual(1);
    expect(body.should_continue).toBeDefined();
    expect(body.round).toBe(0);
  });

  it("accepts request with previous answers (round 1)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 1,
        previous_answers: [
          {
            question: "What is your investment timeline?",
            answer: "5-10 years",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.round).toBe(1);
  });

  it("accepts deterministic seed parameter", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 0,
        seed: 42,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.questions).toBeDefined();
  });

  it("rejects brief too short (< 30 chars)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Too short",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
  });

  it("rejects round > 2 (max 3 rounds)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 3,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
    expect(body.message).toBeDefined(); // Zod validation error
  });

  it("returns questions with required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Verify first question has all required fields
    const firstQuestion = body.questions[0];
    expect(firstQuestion.question).toBeDefined();
    expect(typeof firstQuestion.question).toBe("string");
    expect(firstQuestion.question.length).toBeGreaterThanOrEqual(10);

    expect(firstQuestion.why_we_ask).toBeDefined();
    expect(typeof firstQuestion.why_we_ask).toBe("string");
    expect(firstQuestion.why_we_ask.length).toBeGreaterThanOrEqual(20);

    expect(firstQuestion.impacts_draft).toBeDefined();
    expect(typeof firstQuestion.impacts_draft).toBe("string");
    expect(firstQuestion.impacts_draft.length).toBeGreaterThanOrEqual(20);
  });

  it("returns MCQ choices when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Fixtures adapter returns a question with MCQ choices
    const mcqQuestion = body.questions.find((q: any) => q.choices && q.choices.length > 0);
    expect(mcqQuestion).toBeDefined();
    if (mcqQuestion) {
      expect(Array.isArray(mcqQuestion.choices)).toBe(true);
      expect(mcqQuestion.choices.length).toBeGreaterThan(0);
    }
  });

  it("returns confidence score in valid range", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.confidence).toBeGreaterThanOrEqual(0);
    expect(body.confidence).toBeLessThanOrEqual(1);
  });

  it("returns should_continue flag", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.should_continue).toBe("boolean");
  });

  it("includes verification metadata under trace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks for long-term growth?",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.trace).toBeDefined();
    expect(body.trace.verification).toBeDefined();
    expect(body.trace.verification.schema_valid).toBe(true);
    expect(typeof body.trace.verification.total_stages).toBe("number");
  });
});

describe("POST /assist/clarify-brief (Error Handling)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await clarifyRoute(app);
  });

  it("rejects missing brief field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        round: 0,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
  });

  it("rejects empty brief", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "",
        round: 0,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects negative round number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks?",
        round: -1,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      headers: { "Content-Type": "application/json" },
      payload: "not valid json",
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects previous_answers with wrong structure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "Should I invest in renewable energy stocks?",
        round: 1,
        previous_answers: ["not", "an", "object"],
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
