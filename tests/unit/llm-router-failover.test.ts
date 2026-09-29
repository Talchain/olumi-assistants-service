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

  /**
   * ⛔⛔ THIS TEST'S ORIGINAL SUBJECT NO LONGER EXISTS, AND PRETENDING OTHERWISE
   * WOULD BE THE DISHONEST FIX.
   *
   * It asserted that a provider with no adapter for the task is filtered OUT of
   * the failover chain. It was written against `critique_graph`, repointed to
   * `explain_diff` when #1771 opened critique, and now BOTH are open: the
   * capability map's two entries each list all three providers, so nothing is
   * filtered for any task. Repointing a third time is impossible — there is no
   * closed entry left.
   *
   * ⚠ Rather than delete it, it now asserts the behaviour that REMAINS and that
   * a regression would still break: the chain is built in the REQUESTED ORDER,
   * every requested provider appears, and the FIRST one wins. That is the part
   * callers actually depend on. The filter is documented as inert instead of
   * being faked.
   */
  it("builds the chain in requested order, and today filters nothing out", () => {
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "openai,anthropic,fixtures");

    const { adapter, resolution } = getAdapterWithResolution("explain_diff");

    // openai is FIRST in the request and is now task-capable, so it wins.
    expect(adapter.name).toBe("openai-failover");
    expect(resolution).toMatchObject({
      provider: "openai",
      resolution_source: "llm_model_fallback",
    });
  });

  it("⛔ REORDERING THE REQUEST REORDERS THE CHAIN — the discriminating pair", () => {
    // Without this, the assertion above would pass on an implementation that
    // always chose openai, or that ignored the env var entirely. The two tests
    // differ ONLY in the order of the same three providers.
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "anthropic,openai,fixtures");

    const { adapter, resolution } = getAdapterWithResolution("explain_diff");

    expect(adapter.name).toBe("anthropic-failover");
    expect(resolution).toMatchObject({
      provider: "anthropic",
      resolution_source: "llm_model_fallback",
    });
  });

  it("does not pretend a single member is an active failover chain", () => {
    // ⚠ VEHICLE CHANGED, PROPERTY IDENTICAL. This used to reach the
    // "fewer than two usable members" state by CAPABILITY FILTERING — only
    // anthropic could serve the task. With both map entries now open, no task
    // filters, so that route to the state is gone. The router has a second,
    // still-live route to exactly the same state: `resolveFailoverAttempt`
    // returns `active: false` when fewer than two providers are REQUESTED
    // (router-resolution.ts:157-164). So the list is one provider long.
    //
    // The property under test is unchanged and is the one that matters: when a
    // chain cannot be formed, the router must fall through to the task default
    // and must NOT label the adapter "*-failover" or the source
    // "llm_model_fallback" — a caller reading provenance would otherwise be
    // told a failover happened when none did.
    vi.stubEnv("LLM_FAILOVER_PROVIDERS", "anthropic");
    vi.stubEnv("LLM_PROVIDER", "openai");

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
