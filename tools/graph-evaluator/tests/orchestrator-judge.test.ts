import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestratorFixture, JudgeResult } from "../src/types.js";

// =============================================================================
// Mock provider before imports
// =============================================================================

const mockChat = vi.fn();

vi.mock("../src/providers/index.js", () => ({
  getProvider: () => ({ chat: mockChat }),
  OpenAIProvider: function OpenAIProvider() {},
  AnthropicProvider: function AnthropicProvider() {},
}));

// Import after mock
const { judgeOrchestratorResponse, RUBRIC_VERSION, JudgeOutputSchema } = await import(
  "../src/orchestrator-judge.js"
);

// =============================================================================
// Helpers
// =============================================================================

function makeFixture(overrides: Partial<OrchestratorFixture> = {}): OrchestratorFixture {
  return {
    id: "test-fixture",
    name: "Test",
    description: "Test fixture",
    stage: "evaluate",
    user_message: "What should I focus on?",
    expected: {
      expected_tool: null,
      expects_coaching: false,
      min_actions: 0,
      max_actions: 2,
      banned_terms_checked: true,
      expects_uncertainty_language: false,
    },
    ...overrides,
  };
}

function makeValidJudgeJSON(): string {
  return JSON.stringify({
    scores: {
      scientific_polymath: { score: 4, reason: "Good scientific framing" },
      causal_mechanism: { score: 3, reason: "Some causal language" },
      coaching_over_telling: { score: 5, reason: "Asks great questions" },
      grounded_quantification: { score: 4, reason: "Uses model numbers" },
      warm_directness: { score: 4, reason: "Warm and confident" },
      appropriate_brevity: { score: 3, reason: "Slightly verbose" },
      constructive_challenge: { score: 4, reason: "Pushes back well" },
      elicitation_quality: { score: 5, reason: "Surfaces hidden assumptions" },
      session_coherence: { score: 3, reason: "N/A for this context" },
    },
    overall_impression: "Strong coaching response with good scientific grounding.",
    weighted_average: 0.78,
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("orchestrator-judge", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  // ── Test 1: Valid judge response → parsed correctly ──────────────────────
  it("parses valid judge response into dimension scores", async () => {
    mockChat.mockResolvedValue({
      ok: true,
      text: makeValidJudgeJSON(),
      error: null,
      provider: "openai",
      model: "gpt-4o",
      latency_ms: 1500,
      input_tokens: 2000,
      output_tokens: 500,
    });

    const result = await judgeOrchestratorResponse(
      makeFixture(),
      "<diagnostics>test</diagnostics><response><assistant_text>Hello</assistant_text><blocks></blocks><suggested_actions></suggested_actions></response>",
      "gpt-4o"
    );

    expect(result.rubric_version).toBe(RUBRIC_VERSION);
    expect(result.judge_error).toBeUndefined();
    expect(result.scores.scientific_polymath.score).toBe(4);
    expect(result.scores.coaching_over_telling.score).toBe(5);
    expect(result.scores.elicitation_quality.score).toBe(5);
    // weighted_average is recomputed server-side
    const expectedAvg = (4 + 3 + 5 + 4 + 4 + 3 + 4 + 5 + 3) / (9 * 5);
    expect(result.weighted_average).toBeCloseTo(expectedAvg, 4);
    expect(result.judge_latency_ms).toBe(1500);
    expect(result.judge_cost_usd).toBeGreaterThan(0);
  });

  // ── Test 2: Malformed judge JSON → graceful error ────────────────────────
  it("returns graceful error for malformed judge JSON", async () => {
    mockChat.mockResolvedValue({
      ok: true,
      text: "I cannot evaluate this response properly because {broken json",
      error: null,
      provider: "openai",
      model: "gpt-4o",
      latency_ms: 800,
      input_tokens: 1500,
      output_tokens: 200,
    });

    const result = await judgeOrchestratorResponse(
      makeFixture(),
      "<diagnostics>test</diagnostics><response><assistant_text>Hello</assistant_text><blocks></blocks><suggested_actions></suggested_actions></response>",
      "gpt-4o"
    );

    expect(result.judge_error).toBeDefined();
    expect(result.weighted_average).toBe(0);
    expect(result.scores.scientific_polymath.score).toBe(0);
    expect(result.rubric_version).toBe(RUBRIC_VERSION);
  });

  // ── Test 3: Multi-turn fixture sends conversation history ────────────────
  it("includes conversation history in judge prompt for multi-turn", async () => {
    mockChat.mockResolvedValue({
      ok: true,
      text: makeValidJudgeJSON(),
      error: null,
      provider: "openai",
      model: "gpt-4o",
      latency_ms: 1200,
      input_tokens: 3000,
      output_tokens: 600,
    });

    const multiTurnFixture = makeFixture({
      turns: [
        { role: "user", content: "We're expanding to Europe." },
        { role: "assistant", content: "That sounds like a significant strategic move. What's driving this?" },
        { role: "user", content: "Germany specifically." },
      ],
    });

    const history = "[USER]: We're expanding to Europe.\n\n[ASSISTANT]: That sounds like a significant strategic move.\n\n[USER]: Germany specifically.";

    await judgeOrchestratorResponse(
      multiTurnFixture,
      "<diagnostics>test</diagnostics><response><assistant_text>Germany is interesting.</assistant_text><blocks></blocks><suggested_actions></suggested_actions></response>",
      "gpt-4o",
      history
    );

    // Verify the conversation history was included in the user prompt
    const callArgs = mockChat.mock.calls[0];
    const userPrompt = callArgs[1] as string;
    expect(userPrompt).toContain("CONVERSATION HISTORY:");
    expect(userPrompt).toContain("We're expanding to Europe.");
    expect(userPrompt).toContain("Germany specifically.");
  });

  // ── Test 4: Judge extracts JSON from markdown code block ─────────────────
  it("extracts judge JSON from markdown code block", async () => {
    const wrappedJSON = "Here is my evaluation:\n\n```json\n" + makeValidJudgeJSON() + "\n```";

    mockChat.mockResolvedValue({
      ok: true,
      text: wrappedJSON,
      error: null,
      provider: "openai",
      model: "gpt-4o",
      latency_ms: 1100,
      input_tokens: 2000,
      output_tokens: 500,
    });

    const result = await judgeOrchestratorResponse(
      makeFixture(),
      "<diagnostics>test</diagnostics><response><assistant_text>Hello</assistant_text><blocks></blocks><suggested_actions></suggested_actions></response>",
      "gpt-4o"
    );

    expect(result.judge_error).toBeUndefined();
    expect(result.scores.scientific_polymath.score).toBe(4);
  });

  // ── Test 5: Provider failure → graceful error ────────────────────────────
  it("returns graceful error when judge provider call fails", async () => {
    mockChat.mockResolvedValue({
      ok: false,
      text: null,
      error: "rate_limited: too many requests",
      provider: "openai",
      model: "gpt-4o",
      latency_ms: 300,
      input_tokens: 0,
      output_tokens: 0,
    });

    const result = await judgeOrchestratorResponse(
      makeFixture(),
      "<diagnostics>test</diagnostics><response><assistant_text>Hello</assistant_text><blocks></blocks><suggested_actions></suggested_actions></response>",
      "gpt-4o"
    );

    expect(result.judge_error).toContain("Judge call failed");
    expect(result.weighted_average).toBe(0);
    expect(result.judge_latency_ms).toBe(300);
  });

  // ── Zod schema validation ────────────────────────────────────────────────
  it("JudgeOutputSchema rejects scores outside 1-5 range", () => {
    const bad = {
      scores: {
        scientific_polymath: { score: 6, reason: "too high" },
        causal_mechanism: { score: 3, reason: "ok" },
        coaching_over_telling: { score: 3, reason: "ok" },
        grounded_quantification: { score: 3, reason: "ok" },
        warm_directness: { score: 3, reason: "ok" },
        appropriate_brevity: { score: 3, reason: "ok" },
        constructive_challenge: { score: 3, reason: "ok" },
        elicitation_quality: { score: 3, reason: "ok" },
        session_coherence: { score: 3, reason: "ok" },
      },
      overall_impression: "test",
      weighted_average: 0.6,
    };
    expect(JudgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("JudgeOutputSchema accepts valid scores", () => {
    const valid = JSON.parse(makeValidJudgeJSON());
    expect(JudgeOutputSchema.safeParse(valid).success).toBe(true);
  });
});
