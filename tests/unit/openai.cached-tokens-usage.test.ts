/**
 * OpenAI adapter — automatic prompt-cache visibility.
 *
 * OpenAI caches repeated prompt prefixes (>=1,024 tokens) automatically and
 * reports the cached subset in usage.prompt_tokens_details.cached_tokens.
 * Before this capture the adapter read only prompt_tokens/completion_tokens,
 * leaving OpenAI cache hits invisible in telemetry (and any model benchmark
 * cache-blind on the OpenAI side). Pins:
 * 1. cached_tokens surfaces as UsageMetrics.cache_read_input_tokens.
 * 2. A reported zero stays 0 (= "reported, no hit").
 * 3. An absent prompt_tokens_details leaves the field undefined (= "unknown").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  }
  return { default: MockOpenAI };
});

function makeResponse(usage: Record<string, unknown>) {
  return {
    id: "chatcmpl-test",
    choices: [
      {
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
    model: "gpt-4.1",
    usage,
  };
}

describe("OpenAIAdapter chat() — cached_tokens → UsageMetrics", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: "sk-test-openai" };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("surfaces prompt_tokens_details.cached_tokens as cache_read_input_tokens", async () => {
    mockCreate.mockResolvedValue(
      makeResponse({
        prompt_tokens: 5000,
        completion_tokens: 200,
        total_tokens: 5200,
        prompt_tokens_details: { cached_tokens: 4096 },
      }),
    );
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4.1");

    const result = await adapter.chat(
      { system: "S".repeat(100), userMessage: "hello" },
      { requestId: "req-cache-1" },
    );

    expect(result.usage.input_tokens).toBe(5000);
    expect(result.usage.cache_read_input_tokens).toBe(4096);
  });

  it("keeps a reported zero as 0 (reported, no hit)", async () => {
    mockCreate.mockResolvedValue(
      makeResponse({
        prompt_tokens: 500,
        completion_tokens: 50,
        total_tokens: 550,
        prompt_tokens_details: { cached_tokens: 0 },
      }),
    );
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4.1");

    const result = await adapter.chat(
      { system: "S", userMessage: "hello" },
      { requestId: "req-cache-2" },
    );

    expect(result.usage.cache_read_input_tokens).toBe(0);
  });

  it("leaves the field undefined when the API omits prompt_tokens_details", async () => {
    mockCreate.mockResolvedValue(
      makeResponse({
        prompt_tokens: 500,
        completion_tokens: 50,
        total_tokens: 550,
      }),
    );
    const { OpenAIAdapter } = await import("../../src/adapters/llm/openai.js");
    const adapter = new OpenAIAdapter("gpt-4.1");

    const result = await adapter.chat(
      { system: "S", userMessage: "hello" },
      { requestId: "req-cache-3" },
    );

    expect(result.usage.cache_read_input_tokens).toBeUndefined();
  });
});
