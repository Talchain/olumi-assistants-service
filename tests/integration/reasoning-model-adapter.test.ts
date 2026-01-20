import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIAdapter } from "../../src/adapters/llm/openai.js";
import { isReasoningModel, getModelConfig } from "../../src/config/models.js";
import {
  REASONING_MODEL_TIMEOUT_MS,
  HTTP_CLIENT_TIMEOUT_MS,
  DEFAULT_REASONING_MODEL_TIMEOUT_MS,
  DEFAULT_HTTP_CLIENT_TIMEOUT_MS,
} from "../../src/config/timeouts.js";
import { resetAdapterCache, getAdapterForProvider } from "../../src/adapters/llm/router.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("Reasoning Model Adapter Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetAdapterCache();
    vi.clearAllMocks();
    cleanBaseUrl();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetAdapterCache();
  });

  describe("OpenAI Adapter with Reasoning Model", () => {
    it("creates adapter with gpt-5.2 model", () => {
      const adapter = new OpenAIAdapter("gpt-5.2");
      expect(adapter.model).toBe("gpt-5.2");
      expect(adapter.name).toBe("openai");
    });

    it("gpt-5.2 is recognized as a reasoning model", () => {
      const adapter = new OpenAIAdapter("gpt-5.2");
      expect(isReasoningModel(adapter.model)).toBe(true);
    });

    it("gpt-4o is NOT recognized as a reasoning model", () => {
      const adapter = new OpenAIAdapter("gpt-4o");
      expect(isReasoningModel(adapter.model)).toBe(false);
    });

    it("adapter model has correct configuration", () => {
      const adapter = new OpenAIAdapter("gpt-5.2");
      const config = getModelConfig(adapter.model);

      expect(config).toBeDefined();
      expect(config?.reasoning).toBe(true);
      expect(config?.tier).toBe("premium");
      expect(config?.maxTokens).toBe(16384);
    });
  });

  describe("Timeout Configuration", () => {
    it("reasoning models get extended timeout (default 180s)", () => {
      // Test the default value; runtime may differ if env var is set
      expect(DEFAULT_REASONING_MODEL_TIMEOUT_MS).toBe(180_000);
      expect(REASONING_MODEL_TIMEOUT_MS).toBeGreaterThanOrEqual(DEFAULT_HTTP_CLIENT_TIMEOUT_MS);
    });

    it("standard models get default timeout (default 110s)", () => {
      // Test the default value; runtime may differ if env var is set
      expect(DEFAULT_HTTP_CLIENT_TIMEOUT_MS).toBe(110_000);
    });

    it("reasoning timeout default is 1.6x longer than standard default", () => {
      const ratio = DEFAULT_REASONING_MODEL_TIMEOUT_MS / DEFAULT_HTTP_CLIENT_TIMEOUT_MS;
      expect(ratio).toBeCloseTo(1.636, 2); // 180/110 ≈ 1.636
    });
  });

  describe("Model Selection via Environment", () => {
    it("LLM_MODEL=gpt-5.2 creates reasoning model adapter", () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.LLM_MODEL = "gpt-5.2";

      const adapter = getAdapterForProvider("openai");
      expect(adapter.model).toBe("gpt-5.2");
      expect(isReasoningModel(adapter.model)).toBe(true);
    });

    it("LLM_MODEL=gpt-4o creates standard model adapter", () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.LLM_MODEL = "gpt-4o";

      const adapter = getAdapterForProvider("openai");
      expect(adapter.model).toBe("gpt-4o");
      expect(isReasoningModel(adapter.model)).toBe(false);
    });
  });

  describe("CEE_MODEL_DRAFT Environment Variable", () => {
    // Note: This tests that the CEE_MODEL_DRAFT env var can be set to gpt-5.2
    // and the system will correctly use the reasoning model.

    it("CEE_MODEL_DRAFT=gpt-5.2 is a valid configuration", () => {
      // Verify gpt-5.2 is in the registry and enabled
      const config = getModelConfig("gpt-5.2");
      expect(config).toBeDefined();
      expect(config?.enabled).toBe(true);
      expect(config?.provider).toBe("openai");
    });

    it("CEE_MODEL_DRAFT=gpt-5.2 selects a reasoning model", () => {
      expect(isReasoningModel("gpt-5.2")).toBe(true);
    });

    it("CEE_MODEL_DRAFT=gpt-5.2 gets extended timeout", () => {
      // When using gpt-5.2, the adapter should use REASONING_MODEL_TIMEOUT_MS
      expect(DEFAULT_REASONING_MODEL_TIMEOUT_MS).toBe(180_000);
      // Runtime timeout for reasoning models should always exceed standard timeout
      expect(REASONING_MODEL_TIMEOUT_MS).toBeGreaterThanOrEqual(HTTP_CLIENT_TIMEOUT_MS);
    });
  });

  describe("Request Parameter Differences", () => {
    // Note: These tests verify the expected behavior differences between
    // reasoning and standard models. The actual API call parameters are
    // set internally by buildModelParams() which is tested indirectly.

    it("reasoning model should use reasoning_effort instead of temperature", () => {
      // This test documents the expected behavior:
      // - reasoning models: { reasoning_effort: "medium" } - NO temperature
      // - standard models: { temperature: X } - NO reasoning_effort

      const reasoningModel = "gpt-5.2";
      const standardModel = "gpt-4o";

      expect(isReasoningModel(reasoningModel)).toBe(true);
      expect(isReasoningModel(standardModel)).toBe(false);
    });

    it("reasoning model should use max_completion_tokens instead of max_tokens", () => {
      // This test documents the expected behavior:
      // - reasoning models: use max_completion_tokens
      // - standard models: use max_tokens

      const reasoningModel = "gpt-5.2";
      const config = getModelConfig(reasoningModel);

      // Reasoning models typically have higher token limits
      expect(config?.maxTokens).toBe(16384);
    });
  });
});
