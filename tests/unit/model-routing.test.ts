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
      expect(MODEL_REGISTRY["gpt-4o"]).toBeDefined();
      expect(MODEL_REGISTRY["claude-sonnet-4-20250514"]).toBeDefined();
    });

    it("has correct tier assignments", () => {
      expect(MODEL_REGISTRY["gpt-4o-mini"].tier).toBe("fast");
      expect(MODEL_REGISTRY["gpt-4o"].tier).toBe("quality");
      expect(MODEL_REGISTRY["claude-sonnet-4-20250514"].tier).toBe("premium");
    });

    it("has correct provider assignments", () => {
      expect(MODEL_REGISTRY["gpt-4o-mini"].provider).toBe("openai");
      expect(MODEL_REGISTRY["gpt-4o"].provider).toBe("openai");
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
      expect(isModelEnabled("claude-sonnet-4-20250514")).toBe(false);
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
      expect(getModelProvider("claude-3-5-sonnet-20241022")).toBe("anthropic");
    });

    it("returns undefined for unknown models", () => {
      expect(getModelProvider("unknown")).toBeUndefined();
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

    it("assigns fast tier to simple tasks", () => {
      expect(TASK_MODEL_DEFAULTS.clarification).toBe("gpt-4o-mini");
      expect(TASK_MODEL_DEFAULTS.preflight).toBe("gpt-4o-mini");
      expect(TASK_MODEL_DEFAULTS.evidence_helper).toBe("gpt-4o-mini");
      expect(TASK_MODEL_DEFAULTS.explainer).toBe("gpt-4o-mini");
    });

    it("assigns quality tier to complex tasks", () => {
      expect(TASK_MODEL_DEFAULTS.draft_graph).toBe("gpt-4o");
      expect(TASK_MODEL_DEFAULTS.bias_check).toBe("gpt-4o");
      expect(TASK_MODEL_DEFAULTS.sensitivity_coach).toBe("gpt-4o");
      expect(TASK_MODEL_DEFAULTS.options).toBe("gpt-4o");
    });
  });

  describe("QUALITY_REQUIRED_TASKS", () => {
    it("includes critical tasks", () => {
      expect(QUALITY_REQUIRED_TASKS).toContain("draft_graph");
      expect(QUALITY_REQUIRED_TASKS).toContain("bias_check");
    });

    it("does not include simple tasks", () => {
      expect(QUALITY_REQUIRED_TASKS).not.toContain("clarification");
      expect(QUALITY_REQUIRED_TASKS).not.toContain("explainer");
    });
  });

  describe("getDefaultModelForTask", () => {
    it("returns correct default for each task", () => {
      expect(getDefaultModelForTask("clarification")).toBe("gpt-4o-mini");
      expect(getDefaultModelForTask("draft_graph")).toBe("gpt-4o");
    });
  });

  describe("isQualityRequired", () => {
    it("returns true for quality-required tasks", () => {
      expect(isQualityRequired("draft_graph")).toBe(true);
      expect(isQualityRequired("bias_check")).toBe(true);
    });

    it("returns false for non-critical tasks", () => {
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
