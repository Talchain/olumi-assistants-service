/**
 * OpenAI Adapter: Error classification tests
 *
 * Verifies that the draftGraph catch block correctly classifies:
 * - Aborted external signal → timeoutPhase: "pre_aborted"
 * - No external signal (or non-aborted) → timeoutPhase: "body"
 * - UpstreamTimeoutError cause field serialises to JSON with name + message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class FakeAbortError extends Error {
  constructor() {
    super("The operation was aborted.");
    this.name = "AbortError";
  }
}

// Track the mock create function so individual tests can override behavior
let mockCreate = vi.fn().mockRejectedValue(new FakeAbortError());

// Mock OpenAI SDK — use a getter so mockCreate can be swapped per test
vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        get create() { return mockCreate; },
      },
    };
  }
  return { default: MockOpenAI };
});

describe("OpenAI draftGraph error classification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: "sk-test-error-class" };
    mockCreate = vi.fn().mockRejectedValue(new FakeAbortError());
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("classifies AbortError with aborted external signal as pre_aborted", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o-mini");

    try {
      await adapter.draftGraph(
        { brief: "test brief", docs: [], seed: 1 },
        { requestId: "test-pre-abort", timeoutMs: 80000, signal: AbortSignal.abort() },
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      const te = err as InstanceType<typeof UpstreamTimeoutError>;
      expect(te.timeoutPhase).toBe("pre_aborted");
      expect(te.message).toContain("aborted before LLM call started");
    }
  });

  it("classifies AbortError without external signal as body timeout", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o-mini");

    try {
      await adapter.draftGraph(
        { brief: "test brief", docs: [], seed: 1 },
        { requestId: "test-body-timeout", timeoutMs: 80000 },
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      const te = err as InstanceType<typeof UpstreamTimeoutError>;
      expect(te.timeoutPhase).toBe("body");
      expect(te.message).toContain("timed out");
    }
  });

  it("classifies AbortError with non-aborted external signal as body timeout", async () => {
    // Delay to simulate a timeout-triggered abort (not external)
    mockCreate = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new FakeAbortError();
    });

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o-mini");
    const controller = new AbortController(); // non-aborted

    try {
      await adapter.draftGraph(
        { brief: "test brief", docs: [], seed: 1 },
        { requestId: "test-non-aborted-signal", timeoutMs: 80000, signal: controller.signal },
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      const te = err as InstanceType<typeof UpstreamTimeoutError>;
      expect(te.timeoutPhase).toBe("body");
      expect(te.message).toContain("timed out");
    }
  });

  // M3 (Codex r2 pre-merge review): OpenAIAdapter.chat previously DROPPED
  // CallOpts.signal, so an abort never cancelled the in-flight request and the
  // catch could not classify it. It now wires the external signal (like
  // draftGraph/repairGraph) and classifies pre_aborted vs body.
  it("chat: external abort cancels the in-flight request and classifies pre_aborted", async () => {
    let sdkSignalAborted = false;
    mockCreate = vi.fn().mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) => {
        // RED against the pre-fix code: the signal was never wired, so this was
        // never aborted and the AbortError below classified as `body`.
        sdkSignalAborted = options.signal.aborted;
        return Promise.reject(new FakeAbortError());
      },
    );

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4.1");
    try {
      await adapter.chat(
        { system: "s", userMessage: "u" },
        { requestId: "test-chat-pre-abort", timeoutMs: 80000, signal: AbortSignal.abort() },
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      expect((err as InstanceType<typeof UpstreamTimeoutError>).timeoutPhase).toBe("pre_aborted");
    }
    // The request abort controller saw the client abort — the paid call was cancelled.
    expect(sdkSignalAborted).toBe(true);
  });

  it("chat: honours the legacy CallOpts.abortSignal alias", async () => {
    let sdkSignalAborted = false;
    mockCreate = vi.fn().mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) => {
        sdkSignalAborted = options.signal.aborted;
        return Promise.reject(new FakeAbortError());
      },
    );

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4.1");
    try {
      await adapter.chat(
        { system: "s", userMessage: "u" },
        { requestId: "test-chat-alias", timeoutMs: 80000, abortSignal: AbortSignal.abort() },
      );
      expect.unreachable("Should have thrown");
    } catch {
      /* thrown as expected */
    }
    expect(sdkSignalAborted).toBe(true);
  });

  it("chat: an AbortError without an external signal classifies as body timeout", async () => {
    mockCreate = vi.fn().mockRejectedValue(new FakeAbortError());

    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4.1");
    try {
      await adapter.chat(
        { system: "s", userMessage: "u" },
        { requestId: "test-chat-body", timeoutMs: 80000 },
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      expect((err as InstanceType<typeof UpstreamTimeoutError>).timeoutPhase).toBe("body");
    }
  });

  it("serialises cause with name and message (not empty object)", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o-mini");

    try {
      await adapter.draftGraph(
        { brief: "test brief", docs: [], seed: 1 },
        { requestId: "test-cause-serial", timeoutMs: 80000 },
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamTimeoutError);
      const te = err as InstanceType<typeof UpstreamTimeoutError>;

      // cause should be a plain object with name and message, not a raw Error
      const cause = te.cause as { name?: string; message?: string };
      expect(cause).toBeDefined();
      expect(cause.name).toBe("AbortError");
      expect(cause.message).toBe("The operation was aborted.");

      // Verify JSON serialization works (no empty object)
      const serialized = JSON.stringify(cause);
      expect(serialized).toContain("AbortError");
      expect(serialized).not.toBe("{}");
    }
  });

  it("suggest_options sends the exact preloaded snapshot as system authority", async () => {
    mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              options: [
                {
                  id: "opt_1",
                  title: "A valid option",
                  pros: ["Useful", "Distinct"],
                  cons: ["Costly", "Uncertain"],
                  evidence_to_gather: ["Conversion rate", "Retention rate"],
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4o-mini");
    const exactPrompt = "SERVED-PMS-SUGGEST-BYTES-v77";

    await adapter.suggestOptions(
      {
        goal: "Choose a launch strategy",
        constraints: { budget: "bounded" },
        existingOptions: ["Do nothing"],
      },
      {
        requestId: "suggest-prompt-authority",
        timeoutMs: 80_000,
        preloadedSystemPrompt: {
          operation: "suggest_options",
          content: exactPrompt,
          meta: {
            taskId: "suggest_options",
            source: "store",
            prompt_version: "suggest_options_default@v77 (staging)",
            prompt_hash: "exact-hash",
          },
        },
      },
    );

    const request = mockCreate.mock.calls[0]?.[0] as {
      messages?: Array<{ role: string; content: string }>;
    };
    expect(request.messages?.[0]).toEqual({
      role: "system",
      content: exactPrompt,
    });
    expect(request.messages?.[1]?.role).toBe("user");
    expect(request.messages?.[1]?.content).toContain(
      "## Goal\nChoose a launch strategy",
    );
    expect(JSON.stringify(request.messages)).not.toContain(
      "You are an expert at generating strategic options for decisions.",
    );
  });
});
