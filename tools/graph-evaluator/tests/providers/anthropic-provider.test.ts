/**
 * Anthropic provider unit tests.
 * Uses module-level mocking to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelConfig } from "../../src/providers/types.js";

const mockCreate = vi.fn();

// Mock the @anthropic-ai/sdk module before importing the provider.
// Use a plain function (not arrow) so `new Anthropic(...)` works.
vi.mock("@anthropic-ai/sdk", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockAnthropic(this: any) {
    this.messages = { create: mockCreate };
  }
  MockAnthropic.APIError = class APIError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  };
  return { default: MockAnthropic };
});

const { AnthropicProvider } = await import("../../src/providers/anthropic-provider.js");

const BASE_CONFIG: ModelConfig = {
  id: "claude-sonnet-4-6",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  timeout_ms: 5000,
};

function setKey(val: string | undefined) {
  if (val === undefined) delete process.env["ANTHROPIC_API_KEY"];
  else process.env["ANTHROPIC_API_KEY"] = val;
}

beforeEach(() => {
  vi.clearAllMocks();
  setKey("test-anthropic-key");
});

// =============================================================================
// Success paths
// =============================================================================

describe("AnthropicProvider — success path", () => {
  it("returns ok:true with extracted text", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "  The result is 42.  " }],
      usage: { input_tokens: 15, output_tokens: 8 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.chat("system", "user msg", BASE_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.text).toBe("The result is 42.");
    expect(result.error).toBeNull();
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.input_tokens).toBe(15);
    expect(result.output_tokens).toBe(8);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("skips thinking blocks — extracts only text blocks", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "thinking", thinking: "Let me reason through this..." },
        { type: "text", text: "Final answer here." },
      ],
      usage: { input_tokens: 30, output_tokens: 20 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.chat("system", "user", BASE_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Final answer here.");
    // Must not contain thinking block content
    expect(result.text).not.toContain("reason through");
  });

  it("joins multiple text blocks", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Part one. " },
        { type: "text", text: "Part two." },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.chat("system", "user", BASE_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Part one. Part two.");
  });
});

// =============================================================================
// Failure paths
// =============================================================================

describe("AnthropicProvider — failure paths", () => {
  it("returns ok:false when API key is missing", async () => {
    setKey(undefined);
    const provider = new AnthropicProvider();
    const result = await provider.chat("system", "user", BASE_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.error).toContain("ANTHROPIC_API_KEY");
    expect(result.latency_ms).toBe(0);
  });

  it("returns ok:false on API error — does not throw", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network failure"));

    const provider = new AnthropicProvider();
    const result = await provider.chat("system", "user", BASE_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.error).toContain("Network failure");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns ok:false with 'No text content' when content is empty array", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.chat("system", "user", BASE_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.error).toBe("No text content in response");
  });

  it("returns ok:false when content has only thinking blocks (no text)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "thinking", thinking: "Internal reasoning only." },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const provider = new AnthropicProvider();
    const result = await provider.chat("system", "user", BASE_CONFIG);

    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.error).toBe("No text content in response");
  });

  it("does not throw on any failure — always returns LLMResult", async () => {
    mockCreate.mockRejectedValueOnce(new TypeError("Unexpected error"));
    const provider = new AnthropicProvider();
    await expect(provider.chat("system", "user", BASE_CONFIG)).resolves.toBeDefined();
  });
});
