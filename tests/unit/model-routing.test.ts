import { describe, it, expect } from "vitest";
import {
  MODEL_REGISTRY,
  getModelConfig,
  isModelEnabled,
  getEnabledModels,
  getEnabledModelsByTier,
  getBestModelForTier,
  isKnownModel,
  getModelProvider,
  isReasoningModel,
} from "../../src/config/models.js";
import {
  TASK_MODEL_DEFAULTS,
  QUALITY_REQUIRED_TASKS,
  getDefaultModelForTask,
  isQualityRequired,
  isValidCeeTask,
  isTierShortcut,
} from "../../src/config/model-routing.js";

describe("Model Registry", () => {
  describe("MODEL_REGISTRY", () => {
    it("contains expected models", () => {
      expect(MODEL_REGISTRY["gpt-4o-mini"]).toBeDefined();
      expect(MODEL_REGISTRY["gpt-5-mini"]).toBeDefined();
      expect(MODEL_REGISTRY["gpt-4o"]).toBeDefined();
      expect(MODEL_REGISTRY["gpt-5.2"]).toBeDefined();
      expect(MODEL_REGISTRY["claude-sonnet-4-20250514"]).toBeDefined();
    });

    it("gpt-5.2 is a reasoning model", () => {
      const model = MODEL_REGISTRY["gpt-5.2"];
      expect(model.reasoning).toBe(true);
      expect(model.provider).toBe("openai");
      expect(model.tier).toBe("premium");
      expect(model.enabled).toBe(true);
      expect(model.maxTokens).toBe(100000);
    });

    it("non-reasoning models do not have reasoning flag or have it set to false", () => {
      expect(MODEL_REGISTRY["gpt-4o"].reasoning).toBeUndefined();
      expect(MODEL_REGISTRY["gpt-4o-mini"].reasoning).toBeUndefined();
      expect(MODEL_REGISTRY["gpt-5-mini"].reasoning).toBe(false);
      expect(MODEL_REGISTRY["claude-sonnet-4-20250514"].reasoning).toBeUndefined();
    });

    it("has correct tier assignments", () => {
      expect(MODEL_REGISTRY["gpt-4o-mini"].tier).toBe("fast");
      expect(MODEL_REGISTRY["gpt-5-mini"].tier).toBe("fast");
      expect(MODEL_REGISTRY["gpt-4o"].tier).toBe("quality");
      expect(MODEL_REGISTRY["gpt-5.2"].tier).toBe("premium");
      expect(MODEL_REGISTRY["claude-sonnet-4-20250514"].tier).toBe("quality");
    });

    it("has correct provider assignments", () => {
      expect(MODEL_REGISTRY["gpt-4o-mini"].provider).toBe("openai");
      expect(MODEL_REGISTRY["gpt-5-mini"].provider).toBe("openai");
      expect(MODEL_REGISTRY["gpt-4o"].provider).toBe("openai");
      expect(MODEL_REGISTRY["gpt-5.2"].provider).toBe("openai");
      expect(MODEL_REGISTRY["claude-sonnet-4-20250514"].provider).toBe("anthropic");
    });

    it("has quality scores between 0 and 1", () => {
      for (const model of Object.values(MODEL_REGISTRY)) {
        expect(model.qualityScore).toBeGreaterThanOrEqual(0);
        expect(model.qualityScore).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("getModelConfig", () => {
    it("returns config for known models", () => {
      const config = getModelConfig("gpt-4o");
      expect(config).toBeDefined();
      expect(config?.id).toBe("gpt-4o");
    });

    it("returns undefined for unknown models", () => {
      const config = getModelConfig("gpt-5-turbo");
      expect(config).toBeUndefined();
    });
  });

  describe("isModelEnabled", () => {
    it("returns true for enabled models", () => {
      expect(isModelEnabled("gpt-4o")).toBe(true);
      expect(isModelEnabled("gpt-4o-mini")).toBe(true);
    });

    it("returns false for disabled models", () => {
      expect(isModelEnabled("test-disabled-model")).toBe(false);
    });

    it("returns false for unknown models", () => {
      expect(isModelEnabled("unknown-model")).toBe(false);
    });
  });

  describe("getEnabledModels", () => {
    it("returns only enabled models", () => {
      const models = getEnabledModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.enabled)).toBe(true);
    });
  });

  describe("getEnabledModelsByTier", () => {
    it("returns fast tier models", () => {
      const models = getEnabledModelsByTier("fast");
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.tier === "fast")).toBe(true);
    });

    it("returns quality tier models", () => {
      const models = getEnabledModelsByTier("quality");
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.tier === "quality")).toBe(true);
    });
  });

  describe("getBestModelForTier", () => {
    it("returns model with highest quality score in tier", () => {
      const best = getBestModelForTier("quality");
      expect(best).toBeDefined();
      expect(best?.tier).toBe("quality");
    });
  });

  describe("isKnownModel", () => {
    it("returns true for known models", () => {
      expect(isKnownModel("gpt-4o")).toBe(true);
    });

    it("returns false for unknown models", () => {
      expect(isKnownModel("gpt-5-turbo")).toBe(false);
    });
  });

  describe("getModelProvider", () => {
    it("returns provider for known models", () => {
      expect(getModelProvider("gpt-4o")).toBe("openai");
      expect(getModelProvider("claude-sonnet-4-20250514")).toBe("anthropic");
    });

    it("returns undefined for unknown models", () => {
      expect(getModelProvider("unknown")).toBeUndefined();
    });
  });

  describe("isReasoningModel", () => {
    it("returns true for gpt-5.2 (reasoning model)", () => {
      expect(isReasoningModel("gpt-5.2")).toBe(true);
    });

    it("returns false for standard OpenAI models", () => {
      expect(isReasoningModel("gpt-4o")).toBe(false);
      expect(isReasoningModel("gpt-4o-mini")).toBe(false);
      expect(isReasoningModel("gpt-5-mini")).toBe(false);
    });

    it("returns false for Anthropic models", () => {
      expect(isReasoningModel("claude-sonnet-4-20250514")).toBe(false);
      expect(isReasoningModel("claude-opus-4-5-20251101")).toBe(false);
    });

    it("returns false for unknown models (registry lookup, not string matching)", () => {
      // This proves we use registry lookup, not string matching like startsWith("gpt-5")
      expect(isReasoningModel("gpt-5-unknown")).toBe(false);
      expect(isReasoningModel("reasoning-model")).toBe(false);
    });
  });
});

describe("Task-to-Model Routing", () => {
  describe("TASK_MODEL_DEFAULTS", () => {
    it("has defaults for all CEE tasks", () => {
      expect(TASK_MODEL_DEFAULTS.clarification).toBeDefined();
      expect(TASK_MODEL_DEFAULTS.preflight).toBeDefined();
      expect(TASK_MODEL_DEFAULTS.draft_graph).toBeDefined();
      expect(TASK_MODEL_DEFAULTS.bias_check).toBeDefined();
      expect(TASK_MODEL_DEFAULTS.evidence_helper).toBeDefined();
      expect(TASK_MODEL_DEFAULTS.sensitivity_coach).toBeDefined();
      expect(TASK_MODEL_DEFAULTS.options).toBeDefined();
      expect(TASK_MODEL_DEFAULTS.explainer).toBeDefined();
    });

    it("assigns fast tier (gpt-5-mini) to simple tasks", () => {
      expect(TASK_MODEL_DEFAULTS.clarification).toBe("gpt-5-mini");
      expect(TASK_MODEL_DEFAULTS.preflight).toBe("gpt-5-mini");
      expect(TASK_MODEL_DEFAULTS.explainer).toBe("gpt-5-mini");
      expect(TASK_MODEL_DEFAULTS.evidence_helper).toBe("gpt-5-mini");
      expect(TASK_MODEL_DEFAULTS.sensitivity_coach).toBe("gpt-5-mini");
    });

    it("assigns optimized models to complex reasoning tasks", () => {
      // draft_graph uses gpt-4o (best performance in testing)
      expect(TASK_MODEL_DEFAULTS.draft_graph).toBe("gpt-4o");
      // bias_check uses Claude Sonnet 4 (excellent reasoning)
      expect(TASK_MODEL_DEFAULTS.bias_check).toBe("claude-sonnet-4-20250514");
      // repair_graph uses gpt-4o (quality tier for graph repair)
      expect(TASK_MODEL_DEFAULTS.repair_graph).toBe("gpt-4o");
      // Other complex tasks use premium tier (gpt-5.2)
      expect(TASK_MODEL_DEFAULTS.options).toBe("gpt-5.2");
      expect(TASK_MODEL_DEFAULTS.critique_graph).toBe("gpt-5.2");
    });

    it("tasks use appropriate provider models", () => {
      const models = Object.values(TASK_MODEL_DEFAULTS);
      // All models should be valid model IDs
      for (const model of models) {
        expect(model).toBeTruthy();
        // Should match known patterns: gpt-*, claude-*
        expect(model).toMatch(/^(gpt-|claude-)/);
      }
    });
  });

  describe("QUALITY_REQUIRED_TASKS", () => {
    // NOTE: Quality gates have been removed (2026-01-28)
    // Premium models are now protected via clientAllowed: false in MODEL_REGISTRY
    // and CLIENT_BLOCKED_MODELS env var instead of task-based gates

    it("is empty (quality gates removed)", () => {
      expect(QUALITY_REQUIRED_TASKS).toHaveLength(0);
    });

    it("does not include any tasks (quality gates disabled)", () => {
      expect(QUALITY_REQUIRED_TASKS).not.toContain("draft_graph");
      expect(QUALITY_REQUIRED_TASKS).not.toContain("bias_check");
      expect(QUALITY_REQUIRED_TASKS).not.toContain("clarification");
      expect(QUALITY_REQUIRED_TASKS).not.toContain("explainer");
    });
  });

  describe("getDefaultModelForTask", () => {
    it("returns correct default for each task", () => {
      expect(getDefaultModelForTask("clarification")).toBe("gpt-5-mini");
      expect(getDefaultModelForTask("draft_graph")).toBe("gpt-4o");
      expect(getDefaultModelForTask("bias_check")).toBe("claude-sonnet-4-20250514");
    });
  });

  describe("isQualityRequired", () => {
    // Quality gates removed - isQualityRequired always returns false

    it("returns false for all tasks (quality gates disabled)", () => {
      expect(isQualityRequired("draft_graph")).toBe(false);
      expect(isQualityRequired("bias_check")).toBe(false);
      expect(isQualityRequired("clarification")).toBe(false);
      expect(isQualityRequired("explainer")).toBe(false);
    });
  });

  describe("isValidCeeTask", () => {
    it("returns true for valid tasks", () => {
      expect(isValidCeeTask("draft_graph")).toBe(true);
      expect(isValidCeeTask("clarification")).toBe(true);
    });

    it("returns false for invalid tasks", () => {
      expect(isValidCeeTask("unknown_task")).toBe(false);
      expect(isValidCeeTask("")).toBe(false);
    });
  });

  describe("isTierShortcut", () => {
    it("recognizes tier shortcuts", () => {
      expect(isTierShortcut("_fast")).toBe(true);
      expect(isTierShortcut("_quality")).toBe(true);
      expect(isTierShortcut("_default")).toBe(true);
    });

    it("rejects non-shortcuts", () => {
      expect(isTierShortcut("gpt-4o")).toBe(false);
      expect(isTierShortcut("fast")).toBe(false);
    });
  });
});
