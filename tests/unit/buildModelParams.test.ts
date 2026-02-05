import { describe, it, expect } from "vitest";
import { buildModelParams, requiresMaxCompletionTokens } from "../../src/adapters/llm/openai.js";

describe("requiresMaxCompletionTokens", () => {
  describe("Legacy models (use max_tokens)", () => {
    it("gpt-4o → false (uses max_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-4o")).toBe(false);
    });

    it("gpt-4o-mini → false (uses max_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-4o-mini")).toBe(false);
    });

    it("gpt-4-turbo → false (uses max_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-4-turbo")).toBe(false);
    });

    it("gpt-3.5-turbo → false (uses max_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-3.5-turbo")).toBe(false);
    });
  });

  describe("Newer models (use max_completion_tokens)", () => {
    it("gpt-5-mini → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-5-mini")).toBe(true);
    });

    it("gpt-5.2 → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-5.2")).toBe(true);
    });

    it("gpt-4.1-2025-04-14 → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-4.1-2025-04-14")).toBe(true);
    });

    it("gpt-4.1-mini-2025-04-14 → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-4.1-mini-2025-04-14")).toBe(true);
    });

    it("o1 → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("o1")).toBe(true);
    });

    it("o1-mini → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("o1-mini")).toBe(true);
    });

    it("o1-preview → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("o1-preview")).toBe(true);
    });

    it("o3 → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("o3")).toBe(true);
    });

    it("o3-mini → true (uses max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("o3-mini")).toBe(true);
    });
  });

  describe("Future gpt-4.x variants (default to max_completion_tokens)", () => {
    it("gpt-4.2 → true (future variant defaults to max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-4.2")).toBe(true);
    });

    it("gpt-4.2-2026-01-01 → true (dated future variant)", () => {
      expect(requiresMaxCompletionTokens("gpt-4.2-2026-01-01")).toBe(true);
    });

    it("gpt-4.3-mini → true (future mini variant)", () => {
      expect(requiresMaxCompletionTokens("gpt-4.3-mini")).toBe(true);
    });

    it("gpt-4o-2025-03-01 → true (unlisted gpt-4o date variant defaults to new param)", () => {
      // Unlisted date variants default to max_completion_tokens for safety
      expect(requiresMaxCompletionTokens("gpt-4o-2025-03-01")).toBe(true);
    });
  });

  describe("Unknown future models (default to max_completion_tokens)", () => {
    it("gpt-6 → true (defaults to max_completion_tokens for safety)", () => {
      expect(requiresMaxCompletionTokens("gpt-6")).toBe(true);
    });

    it("gpt-7-turbo → true (defaults to max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("gpt-7-turbo")).toBe(true);
    });

    it("o4-mini → true (defaults to max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("o4-mini")).toBe(true);
    });

    it("unknown-model → true (defaults to max_completion_tokens)", () => {
      expect(requiresMaxCompletionTokens("unknown-model")).toBe(true);
    });
  });
});

describe("buildModelParams", () => {
  describe("Reasoning models (gpt-5.2, o1, o3)", () => {
    const reasoningModels = ["gpt-5.2", "o1", "o1-mini", "o3", "o3-mini"];

    it.each(reasoningModels)("%s includes reasoning_effort", (model) => {
      const params = buildModelParams(model, 0);
      expect(params.reasoning_effort).toBe("medium");
    });

    it.each(reasoningModels)("%s omits temperature", (model) => {
      const params = buildModelParams(model, 0.5);
      expect(params.temperature).toBeUndefined();
    });

    it.each(reasoningModels)("%s uses max_completion_tokens", (model) => {
      const params = buildModelParams(model, 0, { maxTokens: 16384 });
      expect(params.max_completion_tokens).toBe(16384);
      expect(params.max_tokens).toBeUndefined();
    });

    it("uses custom reasoning_effort when provided", () => {
      const paramsLow = buildModelParams("gpt-5.2", 0, { reasoningEffort: "low" });
      expect(paramsLow.reasoning_effort).toBe("low");

      const paramsHigh = buildModelParams("o1", 0, { reasoningEffort: "high" });
      expect(paramsHigh.reasoning_effort).toBe("high");
    });
  });

  describe("Newer non-reasoning models (gpt-5-mini, gpt-4.1)", () => {
    it("gpt-5-mini omits temperature (rejects temperature=0)", () => {
      const params = buildModelParams("gpt-5-mini", 0.7, { maxTokens: 8192 });
      expect(params.temperature).toBeUndefined();
      expect(params.max_completion_tokens).toBe(8192);
      expect(params.max_tokens).toBeUndefined();
      expect(params.reasoning_effort).toBeUndefined();
    });

    it("gpt-5-mini with temperature=0 still omits temperature", () => {
      const params = buildModelParams("gpt-5-mini", 0, { maxTokens: 4096 });
      expect(params.temperature).toBeUndefined();
      expect(params.max_completion_tokens).toBe(4096);
    });

    it("gpt-4.1-2025-04-14 omits temperature", () => {
      const params = buildModelParams("gpt-4.1-2025-04-14", 0.5, { maxTokens: 4096 });
      expect(params.temperature).toBeUndefined();
      expect(params.max_completion_tokens).toBe(4096);
      expect(params.max_tokens).toBeUndefined();
      expect(params.reasoning_effort).toBeUndefined();
    });

    it("gpt-4.1-mini-2025-04-14 omits temperature", () => {
      const params = buildModelParams("gpt-4.1-mini-2025-04-14", 0.3, { maxTokens: 2048 });
      expect(params.temperature).toBeUndefined();
      expect(params.max_completion_tokens).toBe(2048);
      expect(params.max_tokens).toBeUndefined();
    });
  });

  describe("Legacy models (gpt-4o, gpt-4o-mini, gpt-3.5-turbo)", () => {
    it("gpt-4o uses temperature + max_tokens", () => {
      const params = buildModelParams("gpt-4o", 0.5, { maxTokens: 4096 });
      expect(params.temperature).toBe(0.5);
      expect(params.max_tokens).toBe(4096);
      expect(params.max_completion_tokens).toBeUndefined();
      expect(params.reasoning_effort).toBeUndefined();
    });

    it("gpt-4o-mini uses temperature + max_tokens", () => {
      const params = buildModelParams("gpt-4o-mini", 0, { maxTokens: 4096 });
      expect(params.temperature).toBe(0);
      expect(params.max_tokens).toBe(4096);
      expect(params.max_completion_tokens).toBeUndefined();
    });

    it("gpt-4-turbo uses temperature + max_tokens", () => {
      const params = buildModelParams("gpt-4-turbo", 0.7, { maxTokens: 8192 });
      expect(params.temperature).toBe(0.7);
      expect(params.max_tokens).toBe(8192);
      expect(params.max_completion_tokens).toBeUndefined();
    });

    it("gpt-3.5-turbo uses temperature + max_tokens", () => {
      const params = buildModelParams("gpt-3.5-turbo", 0.9, { maxTokens: 2048 });
      expect(params.temperature).toBe(0.9);
      expect(params.max_tokens).toBe(2048);
      expect(params.max_completion_tokens).toBeUndefined();
    });
  });

  describe("Unknown future models (default to max_completion_tokens, no temperature)", () => {
    it("gpt-6 defaults to max_completion_tokens and omits temperature", () => {
      const params = buildModelParams("gpt-6", 0.5, { maxTokens: 8192 });
      expect(params.temperature).toBeUndefined();
      expect(params.max_completion_tokens).toBe(8192);
      expect(params.max_tokens).toBeUndefined();
      expect(params.reasoning_effort).toBeUndefined();
    });

    it("unknown-model defaults to max_completion_tokens and omits temperature", () => {
      const params = buildModelParams("unknown-model", 0.3, { maxTokens: 2048 });
      expect(params.temperature).toBeUndefined();
      expect(params.max_completion_tokens).toBe(2048);
      expect(params.max_tokens).toBeUndefined();
    });
  });

  describe("Output structure", () => {
    it("reasoning model output has only expected keys", () => {
      const params = buildModelParams("gpt-5.2", 0, { maxTokens: 16384 });
      const keys = Object.keys(params);
      expect(keys).toContain("reasoning_effort");
      expect(keys).toContain("max_completion_tokens");
      expect(keys).not.toContain("temperature");
      expect(keys).not.toContain("max_tokens");
    });

    it("legacy model output has only expected keys", () => {
      const params = buildModelParams("gpt-4o", 0.5, { maxTokens: 4096 });
      const keys = Object.keys(params);
      expect(keys).toContain("temperature");
      expect(keys).toContain("max_tokens");
      expect(keys).not.toContain("reasoning_effort");
      expect(keys).not.toContain("max_completion_tokens");
    });

    it("newer non-reasoning model output has only max_completion_tokens (no temperature)", () => {
      const params = buildModelParams("gpt-5-mini", 0.5, { maxTokens: 4096 });
      const keys = Object.keys(params);
      expect(keys).toContain("max_completion_tokens");
      expect(keys).not.toContain("temperature");
      expect(keys).not.toContain("reasoning_effort");
      expect(keys).not.toContain("max_tokens");
    });

    it("minimal output when no maxTokens provided", () => {
      // Reasoning model: just reasoning_effort
      const reasoningParams = buildModelParams("gpt-5.2", 0);
      expect(Object.keys(reasoningParams)).toEqual(["reasoning_effort"]);

      // Legacy model: just temperature
      const legacyParams = buildModelParams("gpt-4o", 0);
      expect(Object.keys(legacyParams)).toEqual(["temperature"]);

      // Newer non-reasoning model: empty object (temperature omitted for these models)
      const newerParams = buildModelParams("gpt-5-mini", 0);
      expect(Object.keys(newerParams)).toEqual([]);
    });
  });
});
