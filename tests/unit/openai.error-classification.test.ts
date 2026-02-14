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
});
