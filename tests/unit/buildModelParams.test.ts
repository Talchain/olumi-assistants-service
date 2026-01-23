import { describe, it, expect } from "vitest";
import { buildModelParams } from "../../src/adapters/llm/openai.js";

describe("buildModelParams", () => {
  describe("Reasoning models (gpt-5.2)", () => {
    const reasoningModel = "gpt-5.2";

    it("includes reasoning_effort for reasoning models", () => {
      const params = buildModelParams(reasoningModel, 0);
      expect(params.reasoning_effort).toBe("medium");
    });

    it("omits temperature for reasoning models", () => {
      const params = buildModelParams(reasoningModel, 0);
      expect(params.temperature).toBeUndefined();
    });

    it("uses max_completion_tokens instead of max_tokens", () => {
      const params = buildModelParams(reasoningModel, 0, { maxTokens: 16384 });
      expect(params.max_completion_tokens).toBe(16384);
      expect(params.max_tokens).toBeUndefined();
    });

    it("omits max_completion_tokens when not specified", () => {
      const params = buildModelParams(reasoningModel, 0);
      expect(params.max_completion_tokens).toBeUndefined();
    });

    it("ignores temperature value for reasoning models", () => {
      // Even if a high temperature is passed, it should be ignored
      const params = buildModelParams(reasoningModel, 0.9, { maxTokens: 16384 });
      expect(params.temperature).toBeUndefined();
      expect(params.reasoning_effort).toBe("medium");
    });

    it("uses custom reasoning_effort when provided", () => {
      const paramsLow = buildModelParams(reasoningModel, 0, { reasoningEffort: "low" });
      expect(paramsLow.reasoning_effort).toBe("low");

      const paramsHigh = buildModelParams(reasoningModel, 0, { reasoningEffort: "high" });
      expect(paramsHigh.reasoning_effort).toBe("high");
    });

    it("defaults reasoning_effort to medium when not specified", () => {
      const params = buildModelParams(reasoningModel, 0, { maxTokens: 8192 });
      expect(params.reasoning_effort).toBe("medium");
    });
  });

  describe("Standard models (gpt-4o, gpt-4o-mini)", () => {
    it("includes temperature for standard models", () => {
      const params = buildModelParams("gpt-4o", 0);
      expect(params.temperature).toBe(0);
    });

    it("omits reasoning_effort for standard models", () => {
      const params = buildModelParams("gpt-4o", 0.5);
      expect(params.reasoning_effort).toBeUndefined();
    });

    it("uses max_tokens instead of max_completion_tokens", () => {
      const params = buildModelParams("gpt-4o-mini", 0, { maxTokens: 4096 });
      expect(params.max_tokens).toBe(4096);
      expect(params.max_completion_tokens).toBeUndefined();
    });

    it("omits max_tokens when not specified", () => {
      const params = buildModelParams("gpt-4o", 0);
      expect(params.max_tokens).toBeUndefined();
    });

    it("preserves temperature value for standard models", () => {
      expect(buildModelParams("gpt-4o", 0).temperature).toBe(0);
      expect(buildModelParams("gpt-4o", 0.5).temperature).toBe(0.5);
      expect(buildModelParams("gpt-4o-mini", 0.7).temperature).toBe(0.7);
    });

    it("ignores reasoning_effort option for standard models", () => {
      // reasoningEffort option is ignored for non-reasoning models
      const params = buildModelParams("gpt-4o", 0.5, { reasoningEffort: "high" });
      expect(params.reasoning_effort).toBeUndefined();
      expect(params.temperature).toBe(0.5);
    });
  });

  describe("Unknown models", () => {
    it("treats unknown models as standard models", () => {
      const params = buildModelParams("unknown-model", 0.3, { maxTokens: 2048 });
      expect(params.temperature).toBe(0.3);
      expect(params.max_tokens).toBe(2048);
      expect(params.reasoning_effort).toBeUndefined();
      expect(params.max_completion_tokens).toBeUndefined();
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

    it("standard model output has only expected keys", () => {
      const params = buildModelParams("gpt-4o", 0.5, { maxTokens: 4096 });
      const keys = Object.keys(params);
      expect(keys).toContain("temperature");
      expect(keys).toContain("max_tokens");
      expect(keys).not.toContain("reasoning_effort");
      expect(keys).not.toContain("max_completion_tokens");
    });

    it("minimal output when no maxTokens provided", () => {
      // Reasoning model: just reasoning_effort
      const reasoningParams = buildModelParams("gpt-5.2", 0);
      expect(Object.keys(reasoningParams)).toEqual(["reasoning_effort"]);

      // Standard model: just temperature
      const standardParams = buildModelParams("gpt-4o", 0);
      expect(Object.keys(standardParams)).toEqual(["temperature"]);
    });
  });
});
