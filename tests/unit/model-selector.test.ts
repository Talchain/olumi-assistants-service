import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  selectModel,
  validateModelRequest,
  getModelResponseHeaders,
  checkLatencyAnomaly,
  trackQuality,
  type ModelSelectionConfig,
} from "../../src/services/model-selector.js";

beforeAll(() => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-anthropic-key";
});

afterAll(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

/**
 * Test config with feature enabled
 */
const enabledConfig: ModelSelectionConfig = {
  enabled: true,
  overrideAllowed: true,
  fallbackEnabled: true,
  qualityGateEnabled: true,
  latencyAnomalyThresholdMs: 10000,
  taskModels: {},
};

/**
 * Test config with feature disabled (legacy mode)
 */
const disabledConfig: ModelSelectionConfig = {
  enabled: false,
  overrideAllowed: true,
  fallbackEnabled: true,
  qualityGateEnabled: true,
  latencyAnomalyThresholdMs: 10000,
  taskModels: {},
};

/**
 * Test config with overrides disabled
 */
const noOverrideConfig: ModelSelectionConfig = {
  enabled: true,
  overrideAllowed: false,
  fallbackEnabled: true,
  qualityGateEnabled: true,
  latencyAnomalyThresholdMs: 10000,
  taskModels: {},
};

/**
 * Test config with quality gate disabled
 */
const noQualityGateConfig: ModelSelectionConfig = {
  enabled: true,
  overrideAllowed: true,
  fallbackEnabled: true,
  qualityGateEnabled: false,
  latencyAnomalyThresholdMs: 10000,
  taskModels: {},
};

/**
 * Test config with env task overrides
 */
const envOverrideConfig: ModelSelectionConfig = {
  enabled: true,
  overrideAllowed: true,
  fallbackEnabled: true,
  qualityGateEnabled: true,
  latencyAnomalyThresholdMs: 10000,
  taskModels: {
    clarification: "gpt-4o", // Override fast default with quality
    draftGraph: "gpt-4o",
  },
};

describe("selectModel", () => {
  describe("default selection", () => {
    it("returns quality tier for clarification task (gpt-4.1)", () => {
      const result = selectModel({ task: "clarification" }, enabledConfig);
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns quality tier for draft_graph task (optimized default)", () => {
      const result = selectModel({ task: "draft_graph" }, enabledConfig);
      expect(result.modelId).toBe("gpt-4o"); // Updated default (best performance)
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns quality tier for bias_check task (Claude Sonnet)", () => {
      const result = selectModel({ task: "bias_check" }, enabledConfig);
      expect(result.modelId).toBe("claude-sonnet-4-20250514"); // Updated default (excellent reasoning)
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns quality tier for evidence_helper task (gpt-4.1)", () => {
      const result = selectModel({ task: "evidence_helper" }, enabledConfig);
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns quality tier for explainer task (gpt-4.1)", () => {
      const result = selectModel({ task: "explainer" }, enabledConfig);
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns quality tier for preflight task (gpt-4.1)", () => {
      const result = selectModel({ task: "preflight" }, enabledConfig);
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns quality tier for sensitivity_coach task (gpt-4.1)", () => {
      const result = selectModel({ task: "sensitivity_coach" }, enabledConfig);
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns premium tier for options task (reasoning model)", () => {
      const result = selectModel({ task: "options" }, enabledConfig);
      expect(result.modelId).toBe("gpt-5.2");
      expect(result.tier).toBe("premium");
      expect(result.source).toBe("default");
    });

    it("returns quality tier for repair_graph task (GPT-4o)", () => {
      const result = selectModel({ task: "repair_graph" }, enabledConfig);
      expect(result.modelId).toBe("gpt-4o");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("default");
    });

    it("returns premium tier for critique_graph task (reasoning model)", () => {
      const result = selectModel({ task: "critique_graph" }, enabledConfig);
      expect(result.modelId).toBe("gpt-5.2");
      expect(result.tier).toBe("premium");
      expect(result.source).toBe("default");
    });
  });

  describe("user override", () => {
    it("accepts valid override to gpt-4o", () => {
      const result = selectModel(
        { task: "clarification", override: "gpt-4o" },
        enabledConfig
      );
      expect(result.modelId).toBe("gpt-4o");
      expect(result.source).toBe("override");
    });

    it("accepts valid override to gpt-4o-mini", () => {
      const result = selectModel(
        { task: "evidence_helper", override: "gpt-4o-mini" },
        enabledConfig
      );
      expect(result.modelId).toBe("gpt-4o-mini");
      expect(result.source).toBe("override");
    });

    it("rejects unknown model and uses default", () => {
      const result = selectModel(
        { task: "clarification", override: "gpt-5-turbo" },
        enabledConfig
      );
      expect(result.modelId).toBe("gpt-4.1-2025-04-14"); // Falls back to default
      expect(result.warnings).toContainEqual(
        expect.stringContaining("Unknown model")
      );
    });

    it("rejects disabled model and uses default", () => {
      const result = selectModel(
        { task: "clarification", override: "test-disabled-model" },
        enabledConfig
      );
      expect(result.modelId).toBe("gpt-4.1-2025-04-14"); // Falls back to default
      expect(result.source).toBe("default");
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("rejects override when overrideAllowed is false", () => {
      const result = selectModel(
        { task: "clarification", override: "gpt-4o" },
        noOverrideConfig
      );
      expect(result.modelId).toBe("gpt-4.1-2025-04-14"); // Uses default
      expect(result.source).toBe("default");
      expect(result.warnings).toContainEqual(
        expect.stringContaining("override is disabled")
      );
    });
  });

  describe("quality gate (disabled)", () => {
    // NOTE: Quality gates have been removed (2026-01-28)
    // Premium models are now protected via clientAllowed: false in MODEL_REGISTRY
    // and CLIENT_BLOCKED_MODELS env var instead of task-based gates

    it("allows model override for draft_graph task", () => {
      const result = selectModel(
        { task: "draft_graph", override: "gpt-4o-mini" },
        enabledConfig
      );
      // Quality gates removed - override is allowed
      expect(result.modelId).toBe("gpt-4o-mini");
      expect(result.source).toBe("override");
    });

    it("allows model override for bias_check task", () => {
      const result = selectModel(
        { task: "bias_check", override: "gpt-4o-mini" },
        enabledConfig
      );
      // Quality gates removed - override is allowed
      expect(result.modelId).toBe("gpt-4o-mini");
      expect(result.source).toBe("override");
    });

    it("allows _fast override for all tasks (quality gates removed)", () => {
      const result = selectModel(
        { task: "bias_check", override: "_fast" },
        enabledConfig
      );
      // Quality gates removed - _fast is allowed for all tasks
      // gpt-4.1-2025-04-14 is quality tier in registry (upgraded from gpt-5-mini/fast)
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("override");
    });

    it("allows downgrade for non-critical tasks", () => {
      const result = selectModel(
        { task: "clarification", override: "gpt-4o-mini" },
        enabledConfig
      );
      expect(result.modelId).toBe("gpt-4o-mini");
      expect(result.source).toBe("override");
    });

    it("allows downgrade when quality gate disabled", () => {
      const result = selectModel(
        { task: "draft_graph", override: "gpt-4o-mini" },
        noQualityGateConfig
      );
      expect(result.modelId).toBe("gpt-4o-mini");
      expect(result.source).toBe("override");
    });
  });

  describe("tier shortcuts", () => {
    it("handles _fast shortcut for eligible tasks", () => {
      const result = selectModel(
        { task: "evidence_helper", override: "_fast" },
        enabledConfig
      );
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.source).toBe("override");
    });

    it("handles _quality shortcut", () => {
      const result = selectModel(
        { task: "clarification", override: "_quality" },
        enabledConfig
      );
      expect(result.modelId).toBe("gpt-4o");
      expect(result.source).toBe("override");
    });

    it("handles _default shortcut", () => {
      const result = selectModel(
        { task: "clarification", override: "_default" },
        enabledConfig
      );
      expect(result.source).toBe("default");
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
    });

    it("_fast allowed for draft_graph (quality gates removed)", () => {
      const result = selectModel(
        { task: "draft_graph", override: "_fast" },
        enabledConfig
      );
      // Quality gates removed - _fast is allowed for all tasks
      // gpt-4.1-2025-04-14 is quality tier in registry (upgraded from gpt-5-mini/fast)
      expect(result.modelId).toBe("gpt-4.1-2025-04-14");
      expect(result.tier).toBe("quality");
      expect(result.source).toBe("override");
    });
  });

  describe("env task overrides", () => {
    it("uses env model override for task", () => {
      const result = selectModel({ task: "clarification" }, envOverrideConfig);
      expect(result.modelId).toBe("gpt-4o"); // Overridden from gpt-4o-mini
      expect(result.source).toBe("env");
    });

    it("env override still respects user override", () => {
      const result = selectModel(
        { task: "clarification", override: "gpt-4o-mini" },
        envOverrideConfig
      );
      expect(result.modelId).toBe("gpt-4o-mini"); // User override wins
      expect(result.source).toBe("override");
    });
  });

  describe("feature flag disabled", () => {
    it("uses legacy behaviour when disabled", () => {
      const result = selectModel({ task: "clarification" }, disabledConfig);
      expect(result.modelId).toBe("gpt-4o"); // Always quality when disabled
      expect(result.source).toBe("legacy");
    });

    it("ignores overrides when disabled", () => {
      const result = selectModel(
        { task: "clarification", override: "gpt-4o-mini" },
        disabledConfig
      );
      expect(result.modelId).toBe("gpt-4o"); // Legacy ignores override
      expect(result.source).toBe("legacy");
    });
  });

  describe("correlation tracking", () => {
    it("passes correlation ID through selection", () => {
      const result = selectModel(
        { task: "clarification", correlationId: "test-123" },
        enabledConfig
      );
      // The result doesn't directly include correlationId, but the function accepts it
      expect(result.modelId).toBeDefined();
    });
  });
});

describe("validateModelRequest", () => {
  it("validates known enabled models", () => {
    const result = validateModelRequest("gpt-4o");
    expect(result.valid).toBe(true);
  });

  it("validates gpt-4o-mini", () => {
    const result = validateModelRequest("gpt-4o-mini");
    expect(result.valid).toBe(true);
  });

  it("validates tier shortcuts", () => {
    expect(validateModelRequest("_fast").valid).toBe(true);
    expect(validateModelRequest("_quality").valid).toBe(true);
    expect(validateModelRequest("_default").valid).toBe(true);
  });

  it("rejects unknown models", () => {
    const result = validateModelRequest("gpt-5-turbo");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("unknown_model");
  });

  it("rejects disabled models", () => {
    const result = validateModelRequest("test-disabled-model");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("model_disabled");
  });

  it("rejects empty string", () => {
    const result = validateModelRequest("");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("unknown_model");
  });
});

describe("getModelResponseHeaders", () => {
  it("includes all required headers", () => {
    const headers = getModelResponseHeaders({
      modelId: "gpt-4o",
      provider: "openai",
      tier: "quality",
      source: "default",
      warnings: [],
    });

    expect(headers["X-CEE-Model-Used"]).toBe("gpt-4o");
    expect(headers["X-CEE-Model-Tier"]).toBe("quality");
    expect(headers["X-CEE-Model-Source"]).toBe("default");
  });

  it("includes warnings header when present", () => {
    const headers = getModelResponseHeaders({
      modelId: "gpt-4o",
      provider: "openai",
      tier: "quality",
      source: "default",
      warnings: ["Warning 1", "Warning 2"],
    });

    expect(headers["X-CEE-Model-Warnings"]).toBe("Warning 1; Warning 2");
  });

  it("omits warnings header when empty", () => {
    const headers = getModelResponseHeaders({
      modelId: "gpt-4o",
      provider: "openai",
      tier: "quality",
      source: "default",
      warnings: [],
    });

    expect(headers["X-CEE-Model-Warnings"]).toBeUndefined();
  });

  it("includes original request header when fallback occurred", () => {
    const headers = getModelResponseHeaders({
      modelId: "gpt-4o",
      provider: "openai",
      tier: "quality",
      source: "fallback",
      originalRequest: "gpt-5-turbo",
      warnings: [],
    });

    expect(headers["X-CEE-Model-Original-Request"]).toBe("gpt-5-turbo");
  });

  it("handles all source types", () => {
    const sources = ["default", "override", "fallback", "env", "legacy"] as const;

    for (const source of sources) {
      const headers = getModelResponseHeaders({
        modelId: "gpt-4o",
        provider: "openai",
        tier: "quality",
        source,
        warnings: [],
      });
      expect(headers["X-CEE-Model-Source"]).toBe(source);
    }
  });

  it("handles fast tier", () => {
    const headers = getModelResponseHeaders({
      modelId: "gpt-4o-mini",
      provider: "openai",
      tier: "fast",
      source: "default",
      warnings: [],
    });

    expect(headers["X-CEE-Model-Tier"]).toBe("fast");
  });

  it("handles premium tier", () => {
    const headers = getModelResponseHeaders({
      modelId: "claude-sonnet-4-20250514",
      provider: "anthropic",
      tier: "premium",
      source: "default",
      warnings: [],
    });

    expect(headers["X-CEE-Model-Tier"]).toBe("premium");
  });
});

describe("checkLatencyAnomaly", () => {
  it("does not throw for normal latency", () => {
    // gpt-4o-mini has averageLatencyMs of 800
    // Normal latency should not trigger anomaly
    expect(() =>
      checkLatencyAnomaly("gpt-4o-mini", 1000, "clarification")
    ).not.toThrow();
  });

  it("handles unknown model gracefully", () => {
    expect(() =>
      checkLatencyAnomaly("unknown-model", 5000, "clarification")
    ).not.toThrow();
  });

  it("handles high latency without throwing", () => {
    // Should log warning but not throw
    expect(() =>
      checkLatencyAnomaly("gpt-4o-mini", 50000, "clarification")
    ).not.toThrow();
  });

  it("handles correlation ID", () => {
    expect(() =>
      checkLatencyAnomaly("gpt-4o", 2000, "draft_graph", "corr-123")
    ).not.toThrow();
  });
});

describe("trackQuality", () => {
  it("handles successful events", () => {
    expect(() =>
      trackQuality({
        modelId: "gpt-4o",
        task: "draft_graph",
        success: true,
      })
    ).not.toThrow();
  });

  it("handles failure events with timeout issue", () => {
    expect(() =>
      trackQuality({
        modelId: "gpt-4o",
        task: "draft_graph",
        success: false,
        issue: "timeout",
      })
    ).not.toThrow();
  });

  it("handles failure events with empty_response issue", () => {
    expect(() =>
      trackQuality({
        modelId: "gpt-4o-mini",
        task: "clarification",
        success: false,
        issue: "empty_response",
      })
    ).not.toThrow();
  });

  it("handles failure events with parse_failure issue", () => {
    expect(() =>
      trackQuality({
        modelId: "gpt-4o",
        task: "bias_check",
        success: false,
        issue: "parse_failure",
      })
    ).not.toThrow();
  });

  it("handles failure events with validation_failed issue", () => {
    expect(() =>
      trackQuality({
        modelId: "gpt-4o",
        task: "draft_graph",
        success: false,
        issue: "validation_failed",
      })
    ).not.toThrow();
  });

  it("handles correlation ID", () => {
    expect(() =>
      trackQuality({
        modelId: "gpt-4o",
        task: "draft_graph",
        success: false,
        issue: "timeout",
        correlationId: "corr-456",
      })
    ).not.toThrow();
  });
});
