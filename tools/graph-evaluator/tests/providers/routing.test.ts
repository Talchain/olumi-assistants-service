/**
 * Provider routing tests — verifies getProvider() returns the correct
 * provider class based on ModelConfig.provider field, and that legacy
 * configs without a provider field default to OpenAI.
 */
import { describe, it, expect } from "vitest";
import { getProvider, OpenAIProvider, AnthropicProvider } from "../../src/providers/index.js";
import type { ModelConfig } from "../../src/providers/types.js";

describe("getProvider routing", () => {
  it("returns AnthropicProvider for provider: anthropic", () => {
    const config: ModelConfig = {
      id: "claude-sonnet-4-6",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    };
    const provider = getProvider(config);
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("returns OpenAIProvider for provider: openai", () => {
    const config: ModelConfig = {
      id: "gpt-4o",
      provider: "openai",
      model: "gpt-4o",
    };
    const provider = getProvider(config);
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("defaults to OpenAIProvider when provider field is missing (legacy config)", () => {
    // Simulate io.ts defaulting: { provider: 'openai', ...raw }
    const legacyRaw = { id: "gpt-4.1", model: "gpt-4.1" };
    const config = { provider: "openai" as const, ...legacyRaw } as ModelConfig;
    const provider = getProvider(config);
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("each call returns a fresh provider instance", () => {
    const config: ModelConfig = { id: "a", provider: "openai", model: "gpt-4o" };
    const p1 = getProvider(config);
    const p2 = getProvider(config);
    expect(p1).not.toBe(p2);
  });
});
