/**
 * ROADMAP 2.146 — contested-edge slice 1, CEE condition 2: the Pass-2 reviewer
 * model is PINNED, so an unset `CEE_MODEL_VALIDATION` can no longer hand the
 * "independent reviewer" role to whatever the global `LLM_MODEL` happens to be.
 *
 * The claim being pinned is narrow and worth stating precisely, because a looser
 * version of it would be false: this does NOT assert that Pass 2 runs on o4-mini
 * on staging (Render's `CEE_MODEL_VALIDATION`, if set, still wins — that is the
 * documented precedence and this lane does not change it). It asserts that when
 * NO env override is present, resolution lands on a CHECKED-IN, CROSS-PROVIDER
 * default instead of falling through to the global model.
 *
 * Independence is the only reason the second pass exists, so the negative form is
 * the important one: whatever the reviewer resolves to must not be the drafting
 * model. That is asserted directly, derived from TASK_MODEL_DEFAULTS rather than
 * from a hand-typed model string.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getAdapterWithResolution, resetAdapterCache, TASK_TO_CONFIG_KEY, ROUTER_ENV_ONLY_TASKS } from "../../src/adapters/llm/router.js";
import { TASK_MODEL_DEFAULTS } from "../../src/config/model-routing.js";
import { MODEL_REGISTRY } from "../../src/config/models.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

/** The task name the validation pipeline actually calls (validate-graph.ts:55). */
const REVIEWER_TASK = "validate_graph";
/** The task name Pass 1 (the drafter) resolves under. */
const DRAFTER_TASK = "draft_graph";

describe("Pass-2 reviewer model pin (ROADMAP 2.146)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CEE_MODEL_")) delete process.env[key];
    }
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    cleanBaseUrl();
    _resetConfigCache();
    resetAdapterCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetConfigCache();
    resetAdapterCache();
  });

  it("resolves from the checked-in default when CEE_MODEL_VALIDATION is unset", () => {
    // Staging's posture: LLM_PROVIDER unset/openai, no per-task override set.
    process.env.LLM_PROVIDER = "openai";
    _resetConfigCache();

    const { resolution } = getAdapterWithResolution(REVIEWER_TASK);

    // THE PIN. Before 2.146 this was `llm_model_fallback` — `validate_graph` was
    // declared env-only, so `isValidCeeTask` was false and the router's
    // task_default branch never ran.
    expect(resolution.resolution_source).toBe("task_default");
    expect(resolution.resolved_model).toBe(TASK_MODEL_DEFAULTS.validate_graph);
  });

  it("the pinned reviewer is a DIFFERENT PROVIDER from the drafter (independence)", () => {
    const reviewer = TASK_MODEL_DEFAULTS.validate_graph;
    const drafter = TASK_MODEL_DEFAULTS[DRAFTER_TASK];

    expect(reviewer).not.toBe(drafter);
    // Derived from the registry, not asserted as a literal: the property that
    // matters is cross-provider, and the registry is where provider lives.
    const reviewerProvider = MODEL_REGISTRY[reviewer]?.provider;
    const drafterProvider = MODEL_REGISTRY[drafter]?.provider;
    expect(reviewerProvider, `reviewer model ${reviewer} is not in MODEL_REGISTRY`).toBeDefined();
    expect(drafterProvider, `drafter model ${drafter} is not in MODEL_REGISTRY`).toBeDefined();
    expect(reviewerProvider).not.toBe(drafterProvider);
  });

  it("the pinned reviewer model is registered and enabled (it can actually be served)", () => {
    // A pin to a model the service cannot instantiate is decoration. The registry
    // entry is also what makes the router's provider-switch land on openai rather
    // than skipping the default on provider-mismatch.
    const entry = MODEL_REGISTRY[TASK_MODEL_DEFAULTS.validate_graph];
    expect(entry).toBeDefined();
    expect(entry.enabled).toBe(true);
    expect(entry.provider).toBe("openai");
  });

  it("an explicit CEE_MODEL_VALIDATION still wins over the default (precedence unchanged)", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.CEE_MODEL_VALIDATION = "gpt-4.1-2025-04-14";
    _resetConfigCache();

    const { resolution } = getAdapterWithResolution(REVIEWER_TASK);
    expect(resolution.resolution_source).toBe("env_var");
    expect(resolution.resolved_model).toBe("gpt-4.1-2025-04-14");
  });

  it("the reviewer no longer falls through to the global LLM_MODEL", () => {
    // The failure this row closes, stated as its own test: a global model set for
    // everything else must not silently become the independent reviewer.
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o-mini";
    _resetConfigCache();

    const { resolution } = getAdapterWithResolution(REVIEWER_TASK);
    expect(resolution.resolved_model).not.toBe("gpt-4o-mini");
    expect(resolution.resolution_source).not.toBe("llm_model_fallback");
  });

  it("the callerless 'validate' alias stays declared env-only, and stays routed", () => {
    // Documented in router.ts: the alias has zero call sites, so it gets no
    // default — but it must remain in TASK_TO_CONFIG_KEY or the drift tripwire's
    // stale-declaration assertion fires. Both halves pinned here so the
    // asymmetry is deliberate rather than an oversight someone later "tidies".
    expect(ROUTER_ENV_ONLY_TASKS).toContain("validate");
    expect(ROUTER_ENV_ONLY_TASKS).not.toContain(REVIEWER_TASK);
    expect(TASK_TO_CONFIG_KEY).toHaveProperty("validate");
    expect(TASK_TO_CONFIG_KEY[REVIEWER_TASK]).toBe("validation");
  });
});
