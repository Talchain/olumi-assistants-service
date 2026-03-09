/**
 * Runner integration tests — verifies that when a provider returns ok:false,
 * the runner sets failure_code and the result is not scored as model output.
 *
 * Tests the contract: result.ok === false → failure_code set, no parsed_graph.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock chat fn — declared before vi.mock so the factory closure captures it.
const mockChat = vi.fn();

// Mock both providers to control results.
// getProvider returns a plain object with a chat method (no constructor needed).
vi.mock("../../src/providers/index.js", () => {
  return {
    getProvider: vi.fn(() => ({ chat: mockChat })),
    OpenAIProvider: function OpenAIProvider() { return { chat: mockChat }; },
    AnthropicProvider: function AnthropicProvider() { return { chat: mockChat }; },
  };
});

// Import runner after mock is set up
const { run } = await import("../../src/runner.js");

import type { ModelConfig, Brief } from "../../src/types.js";

const MODEL: ModelConfig = {
  id: "test-model",
  provider: "openai",
  model: "gpt-4o",
};

const BRIEF: Brief = {
  id: "brief-1",
  meta: { expect_status_quo: false, has_numeric_target: false, complexity: "simple" },
  body: "Test brief body.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runner: result.ok === false → not scored as model output", () => {
  it("maps provider ok:false to failure_code, no parsed_graph", async () => {
    mockChat.mockResolvedValueOnce({
      ok: false,
      text: null,
      error: "auth_failed: Invalid API key",
      provider: "openai",
      model: "gpt-4o",
      latency_ms: 50,
    });

    const results = await run({
      models: [MODEL],
      briefs: [BRIEF],
      promptContent: "system prompt",
      promptFile: "test.txt",
      runId: "test-run",
      resultsDir: "/tmp",
      force: true,
      resume: false,
      dryRun: false,
    });

    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.status).toBe("auth_failed");
    expect(r.failure_code).toBe("auth_failed");
    expect(r.parsed_graph).toBeUndefined();
    expect(r.raw_text).toBeUndefined();
    expect(r.error_message).toContain("auth_failed");
  });

  it("maps provider ok:true to success result with raw_text", async () => {
    mockChat.mockResolvedValueOnce({
      ok: true,
      text: '{"nodes":[],"edges":[]}',
      error: null,
      provider: "openai",
      model: "gpt-4o",
      latency_ms: 200,
      input_tokens: 50,
      output_tokens: 20,
    });

    const results = await run({
      models: [MODEL],
      briefs: [BRIEF],
      promptContent: "system prompt",
      promptFile: "test.txt",
      runId: "test-run",
      resultsDir: "/tmp",
      force: true,
      resume: false,
      dryRun: false,
    });

    expect(results).toHaveLength(1);
    const r = results[0];
    // JSON was parseable so status is success
    expect(r.status).toBe("success");
    expect(r.raw_text).toBe('{"nodes":[],"edges":[]}');
    expect(r.failure_code).toBeUndefined();
  });
});
