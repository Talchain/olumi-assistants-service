/**
 * LLM Router Failover Integration Tests
 *
 * Verifies that the router correctly creates failover adapters based on
 * environment configuration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAdapter,
  getAdapterWithResolution,
  resetAdapterCache,
} from "../../src/adapters/llm/router.js";
import { TASK_MODEL_DEFAULTS } from "../../src/config/model-routing.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("LLM Router - Failover Configuration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetAdapterCache();
    cleanBaseUrl(); // Prevent config validation failures
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAdapterCache();
  });

  it("should return regular adapter when LLM_FAILOVER_PROVIDERS not set", () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures");
    expect(adapter.name).not.toContain("failover");
  });

  it("should create failover adapter when LLM_FAILOVER_PROVIDERS is set", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures-failover");
  });

  it("should handle multiple failover providers", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures,fixtures");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures-failover");
  });

  it("should ignore single provider in LLM_FAILOVER_PROVIDERS", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures");
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    const adapter = getAdapter("draft_graph");

    // Should fall back to regular provider selection
    expect(adapter.name).toBe("fixtures");
    expect(adapter.name).not.toContain("failover");
  });

  it("should handle whitespace in LLM_FAILOVER_PROVIDERS", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", " fixtures , fixtures ");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures-failover");
  });

  it("should handle empty string in LLM_FAILOVER_PROVIDERS", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "");
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    const adapter = getAdapter("draft_graph");

    // Should fall back to regular provider selection
    expect(adapter.name).toBe("fixtures");
    expect(adapter.name).not.toContain("failover");
  });

  it("should handle trailing commas in LLM_FAILOVER_PROVIDERS", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures,");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures-failover");
  });

  it("should handle empty entries in LLM_FAILOVER_PROVIDERS", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,,fixtures");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures-failover");
  });

  it("should prioritize failover over regular provider config", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures");
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    const adapter = getAdapter("draft_graph");

    // Failover should take precedence
    expect(adapter.name).toBe("fixtures-failover");
  });

  it("keeps failover outside even an explicit model override", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures");
    vi.stubEnv("LLM_PROVIDER", "openai");

    const { adapter, resolution } = getAdapterWithResolution(
      "draft_graph",
      "unregistered-model-that-must-be-ignored",
    );

    expect(adapter.name).toBe("fixtures-failover");
    expect(resolution).toMatchObject({
      provider: "fixtures",
      resolved_model: "fixture-v1",
      resolution_source: "llm_model_fallback",
      modelOverride: "unregistered-model-that-must-be-ignored",
    });
  });

  it("should work with different provider combinations", () => {
    // Test anthropic -> fixtures failover (both should work in test env)
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures-failover");
  });

  // Repointed from critique_graph to explain_diff: critique_graph now
  // implements OpenAI, so OpenAI is no longer filtered out of its chain and the
  // test would assert a filter that correctly no longer happens. explain_diff's
  // adapter still throws, so it is the live example of a filtered provider.
  it("filters unsupported task providers before constructing the failover chain", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "openai,anthropic,fixtures");

    const { adapter, resolution } = getAdapterWithResolution("explain_diff");

    expect(adapter.name).toBe("anthropic-failover");
    expect(resolution).toMatchObject({
      provider: "anthropic",
      resolution_source: "llm_model_fallback",
    });
  });

  it("does not pretend one task-capable member is an active failover chain", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "openai,anthropic");
    vi.stubEnv("LLM_PROVIDER", "openai");

    // Only ONE listed provider (anthropic) can serve explain_diff, so the chain
    // must not activate: a plain "anthropic" adapter from the task default,
    // never a "*-failover" adapter and never resolution_source
    // "llm_model_fallback".
    //
    // ⚠ REPOINTED from critique_graph. That task now implements BOTH listed
    // providers, so two capable members remain and the chain legitimately DOES
    // activate for it — the old assertion was testing a filter that correctly
    // stopped happening. explain_diff still has exactly one capable member
    // among "openai,anthropic", which is the condition this test is about.
    const { adapter, resolution } = getAdapterWithResolution("explain_diff");

    expect(adapter.name).toBe("anthropic");
    expect(adapter.name).not.toContain("failover");
    expect(resolution).toMatchObject({
      provider: "anthropic",
      resolved_model: TASK_MODEL_DEFAULTS.explain_diff,
      resolution_source: "task_default",
    });
  });
});
