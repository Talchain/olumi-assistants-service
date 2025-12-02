import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the OpenAI SDK so we can simulate a timeout without real network calls
class FakeAbortError extends Error {
  constructor() {
    super("The operation was aborted.");
    this.name = "AbortError";
  }
}

const createClientMock = vi.fn().mockImplementation(() => {
  return {
    chat: {
      completions: {
        // Always reject with an AbortError to simulate a client-side timeout
        create: vi.fn().mockRejectedValue(new FakeAbortError()),
      },
    },
  };
});

vi.mock("openai", () => {
  return {
    default: createClientMock,
  };
});

describe("OpenAIAdapter clarifyBrief timeout handling", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Provide a fake API key so getClient() does not throw
    process.env = { ...originalEnv, OPENAI_API_KEY: "sk-test-openai" };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("throws UpstreamTimeoutError when the clarify call is aborted", async () => {
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");

    const adapter = new OpenAIAdapter("gpt-4o-mini");

    await expect(
      adapter.clarifyBrief(
        {
          brief: "Should I invest in renewable energy stocks for long-term growth?",
          round: 0,
          previous_answers: [],
        },
        {
          requestId: "test-clarify-timeout",
          // Use a very small timeout; the mock will immediately reject with AbortError
          timeoutMs: 10,
        },
      ),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});
