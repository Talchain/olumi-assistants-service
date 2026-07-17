/**
 * Environment Variable Cleanup Tests
 *
 * Tests for:
 * - Dead env var warnings (checkDeadEnvVars)
 * - Deprecated env var warnings (checkDeprecatedEnvVars)
 * - CEE_UNIFIED_PIPELINE_ENABLED removal
 * - Startup health log fields
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("checkDeadEnvVars", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return warnings for known dead env vars", async () => {
    process.env = {
      ...originalEnv,
      CEE_LEGACY_PIPELINE_ENABLED: "true",
      CEE_BIAS_LLM_DETECTION_ENABLED: "true",
      CAUSAL_CLAIMS_ENABLED: "1",
      ORCHESTRATOR_ENABLED: "true",
      VITE_ENABLE_ORCHESTRATOR_V2: "1",
      CEE_UNIFIED_PIPELINE_ENABLED: "true",
      CEE_MODEL_REPAIR_GRAPH: "gpt-4.1",
      // Stage-4 clarifier retirement (ROADMAP 1.94 Option A, #486): the
      // readers were deleted; a deployment still setting these should be
      // told they are inert.
      CEE_CLARIFIER_ENABLED: "true",
      CEE_CLARIFIER_MAX_ROUNDS_DEFAULT: "5",
      CEE_CLARIFIER_QUALITY_THRESHOLD: "8.0",
      CEE_CLARIFIER_STABILITY_THRESHOLD: "2",
      CEE_CLARIFIER_MIN_IMPROVEMENT_THRESHOLD: "0.5",
      CEE_CLARIFIER_QUESTION_CACHE_TTL_SECONDS: "3600",
    };

    const { checkDeadEnvVars } = await import("../../src/config/index.js");
    const warnings = checkDeadEnvVars();

    expect(warnings).toHaveLength(13);
    const keys = warnings.map(w => w.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "CEE_LEGACY_PIPELINE_ENABLED",
        "CEE_BIAS_LLM_DETECTION_ENABLED",
        "CAUSAL_CLAIMS_ENABLED",
        "ORCHESTRATOR_ENABLED",
        "VITE_ENABLE_ORCHESTRATOR_V2",
        "CEE_UNIFIED_PIPELINE_ENABLED",
        "CEE_MODEL_REPAIR_GRAPH",
        "CEE_CLARIFIER_ENABLED",
        "CEE_CLARIFIER_MAX_ROUNDS_DEFAULT",
        "CEE_CLARIFIER_QUALITY_THRESHOLD",
        "CEE_CLARIFIER_STABILITY_THRESHOLD",
        "CEE_CLARIFIER_MIN_IMPROVEMENT_THRESHOLD",
        "CEE_CLARIFIER_QUESTION_CACHE_TTL_SECONDS",
      ]),
    );
    for (const w of warnings) {
      expect(w.message).toContain("has no effect");
      expect(w.key).toBeTruthy();
    }
  });

  it("should return empty array when no dead vars are set", async () => {
    process.env = { ...originalEnv };
    // Ensure none of the dead vars are set
    delete process.env.CEE_LEGACY_PIPELINE_ENABLED;
    delete process.env.CEE_BIAS_LLM_DETECTION_ENABLED;
    delete process.env.CAUSAL_CLAIMS_ENABLED;
    delete process.env.ORCHESTRATOR_ENABLED;
    delete process.env.VITE_ENABLE_ORCHESTRATOR_V2;
    delete process.env.CEE_UNIFIED_PIPELINE_ENABLED;
    delete process.env.CEE_MODEL_REPAIR_GRAPH;
    delete process.env.CEE_CLARIFIER_ENABLED;
    delete process.env.CEE_CLARIFIER_MAX_ROUNDS_DEFAULT;
    delete process.env.CEE_CLARIFIER_QUALITY_THRESHOLD;
    delete process.env.CEE_CLARIFIER_STABILITY_THRESHOLD;
    delete process.env.CEE_CLARIFIER_MIN_IMPROVEMENT_THRESHOLD;
    delete process.env.CEE_CLARIFIER_QUESTION_CACHE_TTL_SECONDS;

    const { checkDeadEnvVars } = await import("../../src/config/index.js");
    const warnings = checkDeadEnvVars();

    expect(warnings).toHaveLength(0);
  });
});

describe("checkDeprecatedEnvVars", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should warn when deprecated HMAC_SECRET is used without CEE_HMAC_SECRET", async () => {
    process.env = { ...originalEnv, HMAC_SECRET: "secret123" };
    delete process.env.CEE_HMAC_SECRET;

    const { checkDeprecatedEnvVars } = await import("../../src/config/index.js");
    const warnings = checkDeprecatedEnvVars();

    const hmacWarning = warnings.find(w => w.key === "HMAC_SECRET");
    expect(hmacWarning).toBeDefined();
    expect(hmacWarning!.replacement).toBe("CEE_HMAC_SECRET");
    expect(hmacWarning!.message).toContain("HMAC_SECRET");
  });

  it("should warn when CEE_MODEL_DRAFT_GRAPH is used without CEE_MODEL_DRAFT", async () => {
    process.env = { ...originalEnv, CEE_MODEL_DRAFT_GRAPH: "gpt-4.1" };
    delete process.env.CEE_MODEL_DRAFT;

    const { checkDeprecatedEnvVars } = await import("../../src/config/index.js");
    const warnings = checkDeprecatedEnvVars();

    const w = warnings.find(w => w.key === "CEE_MODEL_DRAFT_GRAPH");
    expect(w).toBeDefined();
    expect(w!.replacement).toBe("CEE_MODEL_DRAFT");
  });

  it("should warn for ENABLE_LEGACY_SSE", async () => {
    process.env = { ...originalEnv, ENABLE_LEGACY_SSE: "true" };

    const { checkDeprecatedEnvVars } = await import("../../src/config/index.js");
    const warnings = checkDeprecatedEnvVars();

    const w = warnings.find(w => w.key === "ENABLE_LEGACY_SSE");
    expect(w).toBeDefined();
    expect(w!.replacement).toBeUndefined(); // no replacement — remove entirely
    expect(w!.message).toContain("no replacement");
  });

  it("should NOT warn when canonical name is set", async () => {
    process.env = {
      ...originalEnv,
      CEE_HMAC_SECRET: "secret123",
      HMAC_SECRET: "old-secret",
    };

    const { checkDeprecatedEnvVars } = await import("../../src/config/index.js");
    const warnings = checkDeprecatedEnvVars();

    // Should not include HMAC_SECRET warning because CEE_HMAC_SECRET is set
    const hmacWarning = warnings.find(w => w.key === "HMAC_SECRET");
    expect(hmacWarning).toBeUndefined();
  });
});

describe("CEE_UNIFIED_PIPELINE_ENABLED removal", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should load config successfully without CEE_UNIFIED_PIPELINE_ENABLED", async () => {
    process.env = {
      NODE_ENV: "test",
      LLM_PROVIDER: "fixtures",
    };
    delete process.env.CEE_UNIFIED_PIPELINE_ENABLED;

    const { config } = await import("../../src/config/index.js");
    // Config should load without error — unified pipeline field removed
    expect(config).toBeDefined();
    expect(config.server.nodeEnv).toBe("test");
  });

  it("should report CEE_UNIFIED_PIPELINE_ENABLED as dead if still set", async () => {
    process.env = {
      ...originalEnv,
      CEE_UNIFIED_PIPELINE_ENABLED: "true",
    };

    const { checkDeadEnvVars } = await import("../../src/config/index.js");
    const warnings = checkDeadEnvVars();

    const w = warnings.find(w => w.key === "CEE_UNIFIED_PIPELINE_ENABLED");
    expect(w).toBeDefined();
    expect(w!.message).toContain("has no effect");
  });
});
