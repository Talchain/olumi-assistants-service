import { describe, it, expect } from "vitest";
import { isReasoningModel, getModelConfig, MODEL_REGISTRY } from "../../src/config/models.js";
import {
  HTTP_CLIENT_TIMEOUT_MS,
  REASONING_MODEL_TIMEOUT_MS,
  DEFAULT_HTTP_CLIENT_TIMEOUT_MS,
  DEFAULT_REASONING_MODEL_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from "../../src/config/timeouts.js";

describe("Reasoning Model Support", () => {
  describe("Model Configuration", () => {
    it("gpt-5.2 is registered with reasoning: true", () => {
      const config = getModelConfig("gpt-5.2");
      expect(config).toBeDefined();
      expect(config?.reasoning).toBe(true);
    });

    it("gpt-5.2 has expected configuration", () => {
      const config = getModelConfig("gpt-5.2");
      expect(config?.id).toBe("gpt-5.2");
      expect(config?.provider).toBe("openai");
      expect(config?.tier).toBe("premium");
      expect(config?.enabled).toBe(true);
      expect(config?.maxTokens).toBe(100000);
      expect(config?.averageLatencyMs).toBe(15000); // Reasoning takes longer
    });

    it("standard models do not have reasoning flag set", () => {
      const standardModels = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-20250514"];
      for (const modelId of standardModels) {
        const config = getModelConfig(modelId);
        expect(config?.reasoning).toBeFalsy(); // undefined or false
      }
    });
  });

  describe("isReasoningModel()", () => {
    it("returns true for gpt-5.2", () => {
      expect(isReasoningModel("gpt-5.2")).toBe(true);
    });

    it("returns false for gpt-4o (standard model)", () => {
      expect(isReasoningModel("gpt-4o")).toBe(false);
    });

    it("returns false for gpt-4o-mini (standard model)", () => {
      expect(isReasoningModel("gpt-4o-mini")).toBe(false);
    });

    it("returns false for Anthropic models", () => {
      expect(isReasoningModel("claude-sonnet-4-20250514")).toBe(false);
      expect(isReasoningModel("claude-3-5-sonnet-20241022")).toBe(false);
    });

    it("returns false for unknown models not matching reasoning patterns", () => {
      // These don't match known reasoning model patterns
      expect(isReasoningModel("gpt-5-unknown")).toBe(false);
      expect(isReasoningModel("gpt-5.3")).toBe(false); // Only gpt-5.2 is reasoning
      expect(isReasoningModel("thinking-model")).toBe(false);
      expect(isReasoningModel("reasoning-hypothetical")).toBe(false);
    });

    it("returns true for model variants matching reasoning patterns (safety fallback)", () => {
      // Pattern-based fallback for unregistered model variants
      // Better to use max_completion_tokens for potential reasoning models than to fail
      expect(isReasoningModel("o1-turbo")).toBe(true); // Matches o1 pattern
      expect(isReasoningModel("o1-2025-01")).toBe(true); // Dated variant
      expect(isReasoningModel("o3-preview")).toBe(true); // Matches o3 pattern
      expect(isReasoningModel("gpt-5.2-preview")).toBe(true); // Matches gpt-5.2 pattern
    });
  });

  describe("Timeout Configuration", () => {
    it("REASONING_MODEL_TIMEOUT_MS is longer than HTTP_CLIENT_TIMEOUT_MS", () => {
      expect(REASONING_MODEL_TIMEOUT_MS).toBeGreaterThan(HTTP_CLIENT_TIMEOUT_MS);
    });

    it("default reasoning timeout is 180 seconds", () => {
      expect(DEFAULT_REASONING_MODEL_TIMEOUT_MS).toBe(180_000);
    });

    it("default HTTP client timeout is 110 seconds", () => {
      expect(DEFAULT_HTTP_CLIENT_TIMEOUT_MS).toBe(110_000);
    });

    it("reasoning timeout is within valid bounds", () => {
      // Runtime value may differ from default due to env var override
      expect(REASONING_MODEL_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
      expect(REASONING_MODEL_TIMEOUT_MS).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
    });

    it("HTTP client timeout is within valid bounds", () => {
      // Runtime value may differ from default due to env var override
      expect(HTTP_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS);
      expect(HTTP_CLIENT_TIMEOUT_MS).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
    });

    it("reasoning timeout default is 1.6x longer than standard default", () => {
      const ratio = DEFAULT_REASONING_MODEL_TIMEOUT_MS / DEFAULT_HTTP_CLIENT_TIMEOUT_MS;
      expect(ratio).toBeCloseTo(1.636, 2); // 180/110 ≈ 1.636
    });
  });

  describe("Registry Completeness", () => {
    it("all models have required fields", () => {
      for (const [id, config] of Object.entries(MODEL_REGISTRY)) {
        expect(config.id).toBe(id);
        expect(config.provider).toMatch(/^(openai|anthropic)$/);
        expect(config.tier).toMatch(/^(fast|quality|premium)$/);
        expect(typeof config.enabled).toBe("boolean");
        expect(config.maxTokens).toBeGreaterThan(0);
        expect(config.costPer1kTokens).toBeGreaterThan(0);
        expect(config.averageLatencyMs).toBeGreaterThan(0);
        expect(config.qualityScore).toBeGreaterThanOrEqual(0);
        expect(config.qualityScore).toBeLessThanOrEqual(1);
        expect(config.description.length).toBeGreaterThan(0);
      }
    });

    it("reasoning field is optional and only set on reasoning models", () => {
      // Reasoning models are o1, o1-mini, o1-preview, o3, o3-mini, gpt-5.2
      const expectedReasoningModels = new Set([
        "gpt-5.2",
        "o1",
        "o1-mini",
        "o1-preview",
        "o3",
        "o3-mini",
      ]);
      for (const [id, config] of Object.entries(MODEL_REGISTRY)) {
        if (config.reasoning) {
          expect(config.reasoning).toBe(true);
          expect(expectedReasoningModels.has(id)).toBe(true);
        }
      }
    });
  });
});
