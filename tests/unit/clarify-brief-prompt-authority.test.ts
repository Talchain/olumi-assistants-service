import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const harness = vi.hoisted(() => {
  const clarifyBrief = vi.fn(async () => ({
    questions: [{
      question: "Which outcome matters most to the team?",
      choices: ["Growth", "Resilience"],
      why_we_ask: "This identifies the outcome the shared model should prioritise.",
      impacts_draft: "The answer determines the primary goal and evaluation criteria.",
    }],
    confidence: 0.7,
    should_continue: true,
    round: 0,
    usage: { input_tokens: 10, output_tokens: 20 },
  }));
  const getAdapter = vi.fn(() => ({
    name: "anthropic",
    model: "claude-sonnet-5",
    clarifyBrief,
  }));
  const getSystemPromptSnapshot = vi.fn(async () => ({
    content: "EXACT CLARIFY SNAPSHOT V2",
    meta: {
      taskId: "clarify_brief",
      source: "store",
      promptId: "clarify_brief_default",
      version: 2,
      prompt_version: "clarify_brief_default@v2",
      prompt_hash: "sha256-clarify-v2",
    },
  }));

  return { clarifyBrief, getAdapter, getSystemPromptSnapshot };
});

vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: harness.getAdapter,
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPromptSnapshot: harness.getSystemPromptSnapshot,
}));

import clarifyRoute from "../../src/routes/assist.clarify-brief.js";

describe("clarify brief prompt authority", () => {
  beforeEach(() => {
    vi.stubEnv("CEE_CLARIFIER_ENABLED", "true");
    harness.clarifyBrief.mockClear();
    harness.getAdapter.mockClear();
    harness.getSystemPromptSnapshot.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves and carries the exact snapshot before the caching adapter boundary", async () => {
    const app = Fastify();
    await clarifyRoute(app);

    const response = await app.inject({
      method: "POST",
      url: "/assist/clarify-brief",
      payload: {
        brief: "How should our team choose a resilient growth strategy this year?",
        round: 0,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.getSystemPromptSnapshot).toHaveBeenCalledWith("clarify_brief");
    expect(harness.getSystemPromptSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      harness.getAdapter.mock.invocationCallOrder[0],
    );
    expect(harness.clarifyBrief).toHaveBeenCalledTimes(1);
    expect(harness.clarifyBrief.mock.calls[0][1]).toMatchObject({
      preloadedSystemPrompt: {
        operation: "clarify_brief",
        content: "EXACT CLARIFY SNAPSHOT V2",
        meta: {
          version: 2,
          prompt_hash: "sha256-clarify-v2",
        },
      },
    });

    await app.close();
  });
});
