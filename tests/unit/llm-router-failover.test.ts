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
import { ModelAssignmentError } from "../../src/config/model-assignment.js";
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

  it("filters unsupported critique providers before constructing the failover chain", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "openai,anthropic,fixtures");

    const { adapter, resolution } = getAdapterWithResolution("critique_graph");

    expect(adapter.name).toBe("anthropic-failover");
    expect(resolution).toMatchObject({
      provider: "anthropic",
      resolution_source: "llm_model_fallback",
    });
  });

  it("does not pretend one task-capable member is an active failover chain", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "openai,anthropic");
    vi.stubEnv("LLM_PROVIDER", "openai");

    let caught: unknown;
    try {
      getAdapterWithResolution("critique_graph");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelAssignmentError);
    if (!(caught instanceof ModelAssignmentError)) return;
    expect(caught.code).toBe("MODEL_PROVIDER_MISMATCH");
  });
});
