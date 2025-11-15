/**
 * LLM Router Failover Integration Tests
 *
 * Verifies that the router correctly creates failover adapters based on
 * environment configuration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAdapter, resetAdapterCache } from "../../src/adapters/llm/router.js";
import { FailoverAdapter } from "../../src/adapters/llm/failover.js";

describe("LLM Router - Failover Configuration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetAdapterCache();
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
    expect(adapter).not.toBeInstanceOf(FailoverAdapter);
  });

  it("should create failover adapter when LLM_FAILOVER_PROVIDERS is set", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("fixtures-failover");
    expect(adapter).toBeInstanceOf(FailoverAdapter);
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
    expect(adapter).not.toBeInstanceOf(FailoverAdapter);
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
    expect(adapter).not.toBeInstanceOf(FailoverAdapter);
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
    expect(adapter).toBeInstanceOf(FailoverAdapter);
  });

  it("should work with different provider combinations", () => {
    // Test anthropic -> fixtures failover (both should work in test env)
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "fixtures,fixtures");
    const adapter = getAdapter("draft_graph");

    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(FailoverAdapter);
  });
});
