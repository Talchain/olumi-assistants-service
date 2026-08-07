import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAdapter, getAdapterForProvider, getAdapterWithResolution, resetAdapterCache } from "../../src/adapters/llm/router.js";
import { TASK_MODEL_DEFAULTS, type CeeTask } from "../../src/config/model-routing.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("LLM Router", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetAdapterCache();
    vi.clearAllMocks();
    cleanBaseUrl(); // Prevent config validation failures
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetAdapterCache();
  });

  describe("Environment-driven provider selection", () => {
    it("defaults to openai provider when no env var set", () => {
      delete process.env.LLM_PROVIDER;
      const adapter = getAdapter();

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toBe("gpt-4o-mini");
    });

    it("uses anthropic provider when LLM_PROVIDER=anthropic", () => {
      process.env.LLM_PROVIDER = "anthropic";
      const adapter = getAdapter();

      expect(adapter.name).toBe("anthropic");
      expect(adapter.model).toContain("claude");
    });

    it("uses openai provider when LLM_PROVIDER=openai", () => {
      process.env.LLM_PROVIDER = "openai";
      const adapter = getAdapter();

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toContain("gpt");
    });

    it("respects LLM_MODEL env var for model selection", () => {
      process.env.LLM_PROVIDER = "anthropic";
      process.env.LLM_MODEL = "claude-3-opus-20240229";
      const adapter = getAdapter();

      expect(adapter.model).toBe("claude-3-opus-20240229");
    });

    it("uses default model when LLM_MODEL is not set", () => {
      process.env.LLM_PROVIDER = "anthropic";
      delete process.env.LLM_MODEL;
      const adapter = getAdapter();

      // Should use adapter's default model
      expect(adapter.model).toContain("claude");
    });
  });

  describe("Adapter caching", () => {
    it("returns same adapter instance for same provider/model", () => {
      process.env.LLM_PROVIDER = "anthropic";
      const adapter1 = getAdapter();
      const adapter2 = getAdapter();

      expect(adapter1).toBe(adapter2);
    });

    it("returns different adapters for different providers", () => {
      const anthropic = getAdapterForProvider("anthropic");
      const openai = getAdapterForProvider("openai");

      expect(anthropic).not.toBe(openai);
      expect(anthropic.name).toBe("anthropic");
      expect(openai.name).toBe("openai");
    });

    it("clears cache when resetAdapterCache() is called", () => {
      process.env.LLM_PROVIDER = "anthropic";
      const adapter1 = getAdapter();

      resetAdapterCache();

      const adapter2 = getAdapter();
      expect(adapter1).not.toBe(adapter2); // Different instances
      expect(adapter1.name).toBe(adapter2.name); // Same provider
    });
  });

  describe("FixturesAdapter", () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = "fixtures";
    });

    it("returns fixture graph with zero tokens", async () => {
      const adapter = getAdapter();
      const result = await adapter.draftGraph(
        { brief: "test", docs: [], seed: 17 },
        { requestId: "test", timeoutMs: 1000 }
      );

      expect(result.graph).toBeDefined();
      expect(result.graph.nodes).toHaveLength(6); // V4 fixture graph has 6 nodes (with factor)
      expect(result.usage.input_tokens).toBe(0);
      expect(result.usage.output_tokens).toBe(0);
    });

    it("returns fixture options for suggestOptions", async () => {
      const adapter = getAdapter();
      const result = await adapter.suggestOptions(
        { goal: "test goal" },
        { requestId: "test", timeoutMs: 1000 }
      );

      expect(result.options).toHaveLength(3);
      expect(result.options[0].id).toBe("opt_a");
      expect(result.options[1].id).toBe("opt_b");
      expect(result.options[2].id).toBe("opt_c");
      expect(result.usage.input_tokens).toBe(0);
    });

    // "returns input graph unchanged for repairGraph" REMOVED — ROADMAP 2.763
    // retired the capability; the Fixtures adapter has no repairGraph limb.
    // The RUNTIME guard that it stays gone lives in the compliance test below
    // and in tests/unit/llm-repair-graph-retired.test.ts.
  });

  describe("Adapter interface compliance", () => {
    it("all adapters implement required methods", () => {
      const providers: Array<"anthropic" | "openai" | "fixtures"> = ["anthropic", "openai", "fixtures"];

      for (const provider of providers) {
        const adapter = getAdapterForProvider(provider);

        expect(adapter).toHaveProperty("name");
        expect(adapter).toHaveProperty("model");
        expect(typeof adapter.draftGraph).toBe("function");
        expect(typeof adapter.suggestOptions).toBe("function");
        // ROADMAP 2.763 — INVERTED. `repairGraph` was a required member of the
        // adapter contract; the LLM graph-repair capability is retired, so its
        // ABSENCE is now the contract. This REDs if any adapter re-grows it.
        expect(
          (adapter as unknown as Record<string, unknown>).repairGraph,
          `${provider} adapter must NOT expose repairGraph (ROADMAP 2.763)`,
        ).toBeUndefined();
      }
    });

    it("adapter names match provider types", () => {
      expect(getAdapterForProvider("anthropic").name).toBe("anthropic");
      expect(getAdapterForProvider("openai").name).toBe("openai");
      expect(getAdapterForProvider("fixtures").name).toBe("fixtures");
    });
  });

  describe("Task-specific routing", () => {
    it("uses LLM_PROVIDER unless task model matches that provider", () => {
      process.env.LLM_PROVIDER = "anthropic";

      const draftAdapter = getAdapter("draft_graph");
      const suggestAdapter = getAdapter("suggest_options");
      const repairAdapter = getAdapter("repair_graph");

      // LLM_PROVIDER takes precedence; task defaults only used if compatible
      // draft_graph default is gpt-4o (OpenAI), but LLM_PROVIDER=anthropic → Anthropic
      // suggest_options default is gpt-5.2 (OpenAI), but LLM_PROVIDER=anthropic → Anthropic
      // repair_graph default is claude-sonnet-4 (Anthropic), matches LLM_PROVIDER → Anthropic
      expect(draftAdapter.name).toBe("anthropic");
      expect(suggestAdapter.name).toBe("anthropic");
      expect(repairAdapter.name).toBe("anthropic");
    });
  });

  describe("Error handling", () => {
    it("throws error for unknown provider", () => {
      expect(() => {
        getAdapterForProvider("unknown" as any);
      }).toThrow("Unknown provider");
    });
  });

  describe("UsageMetrics cache hit reporting (Fixtures only)", () => {
    it("Fixtures adapter reports zero tokens for draftGraph", async () => {
      const adapter = getAdapterForProvider("fixtures");
      const result = await adapter.draftGraph(
        { brief: "test", docs: [], seed: 17 },
        { requestId: "test", timeoutMs: 1000 }
      );

      expect(result.usage.input_tokens).toBe(0);
      expect(result.usage.output_tokens).toBe(0);
      expect(result.usage.cache_read_input_tokens).toBeUndefined();
    });

    it("Fixtures adapter reports zero tokens for suggestOptions", async () => {
      const adapter = getAdapterForProvider("fixtures");
      const result = await adapter.suggestOptions(
        { goal: "test goal" },
        { requestId: "test", timeoutMs: 1000 }
      );

      expect(result.usage.input_tokens).toBe(0);
      expect(result.usage.output_tokens).toBe(0);
    });

    it("Fixtures adapter has consistent UsageMetrics structure across all methods", async () => {
      const adapter = getAdapterForProvider("fixtures");
      const draftResult = await adapter.draftGraph(
        { brief: "test", docs: [], seed: 17 },
        { requestId: "test", timeoutMs: 1000 }
      );

      const suggestResult = await adapter.suggestOptions(
        { goal: "test goal" },
        { requestId: "test", timeoutMs: 1000 }
      );

      // All methods return consistent UsageMetrics structure
      // (repairGraph removed — ROADMAP 2.763)
      for (const result of [draftResult, suggestResult]) {
        expect(result.usage).toHaveProperty("input_tokens");
        expect(result.usage).toHaveProperty("output_tokens");
        expect(typeof result.usage.input_tokens).toBe("number");
        expect(typeof result.usage.output_tokens).toBe("number");
      }
    });

    // Note: Real Anthropic/OpenAI adapter tests require API keys and are tested in integration tests
    // Expected behavior:
    // - Anthropic: cache_read_input_tokens populated when prompt caching is used
    // - OpenAI: cache_read_input_tokens always 0 or undefined (no prompt caching support)
  });

  describe("TASK_MODEL_DEFAULTS integration", () => {
    it("uses claude-sonnet-4-6 for draft_graph when no CEE_MODEL_DRAFT override", () => {
      // Default reconciled to live staging (2026-07-19). The anthropic default
      // only serves when LLM_PROVIDER matches; under openai it is skipped
      // (provider-mismatch) — see the startup WARN in model-resolution-logger.
      delete process.env.CEE_MODEL_DRAFT;
      delete process.env.CEE_MODEL_DRAFT_GRAPH;
      delete process.env.LLM_MODEL;
      process.env.LLM_PROVIDER = "anthropic";

      const adapter = getAdapter("draft_graph");

      expect(adapter.name).toBe("anthropic");
      expect(adapter.model).toBe("claude-sonnet-4-6");
    });

    it("uses gpt-4.1 for clarification when no CEE_MODEL_CLARIFICATION override", () => {
      delete process.env.CEE_MODEL_CLARIFICATION;
      delete process.env.LLM_MODEL;
      process.env.LLM_PROVIDER = "openai";

      const adapter = getAdapter("clarification");

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toBe("gpt-4.1-2025-04-14");
    });

    it("uses claude-sonnet-4 for bias_check when no CEE_MODEL_* override", () => {
      delete process.env.LLM_MODEL;
      process.env.LLM_PROVIDER = "anthropic"; // Claude model requires anthropic provider

      const adapter = getAdapter("bias_check");

      expect(adapter.name).toBe("anthropic");
      expect(adapter.model).toBe("claude-sonnet-4-20250514"); // Updated default (excellent reasoning)
    });

    it("CEE_MODEL_DRAFT env var overrides TASK_MODEL_DEFAULTS", () => {
      process.env.CEE_MODEL_DRAFT = "gpt-5.2";
      process.env.LLM_PROVIDER = "openai";

      const adapter = getAdapter("draft_graph");

      expect(adapter.model).toBe("gpt-5.2");
    });

    it("uses claude-sonnet-5 for orchestrator when no CEE_MODEL_ORCHESTRATOR override", () => {
      // Default reconciled to live staging (2026-07-19); serves under matching provider.
      delete process.env.CEE_MODEL_ORCHESTRATOR;
      delete process.env.LLM_MODEL;
      process.env.LLM_PROVIDER = "anthropic";

      const adapter = getAdapter("orchestrator");

      expect(adapter.name).toBe("anthropic");
      expect(adapter.model).toBe("claude-sonnet-5");
    });

    it("uses claude-sonnet-4-6 for edit_graph when no CEE_MODEL_EDIT_GRAPH override", () => {
      // Default reconciled to live staging (2026-07-19); serves under matching provider.
      delete process.env.CEE_MODEL_EDIT_GRAPH;
      delete process.env.LLM_MODEL;
      process.env.LLM_PROVIDER = "anthropic";

      const adapter = getAdapter("edit_graph");

      expect(adapter.name).toBe("anthropic");
      expect(adapter.model).toBe("claude-sonnet-4-6");
    });

    it("CEE_MODEL_ORCHESTRATOR env var overrides TASK_MODEL_DEFAULTS", () => {
      process.env.CEE_MODEL_ORCHESTRATOR = "claude-sonnet-4-20250514";
      process.env.LLM_PROVIDER = "openai";

      const adapter = getAdapter("orchestrator");

      expect(adapter.name).toBe("anthropic");
      expect(adapter.model).toBe("claude-sonnet-4-20250514");
    });

    it("CEE_MODEL_EDIT_GRAPH env var overrides TASK_MODEL_DEFAULTS", () => {
      process.env.CEE_MODEL_EDIT_GRAPH = "gpt-5.2";
      process.env.LLM_PROVIDER = "openai";

      const adapter = getAdapter("edit_graph");

      expect(adapter.model).toBe("gpt-5.2");
    });

    it("non-CEE tasks fall back to LLM_MODEL or adapter default", () => {
      delete process.env.LLM_MODEL;
      process.env.LLM_PROVIDER = "openai";

      // "unknown_task" is not a valid CEE task, so no TASK_MODEL_DEFAULTS applies
      const adapter = getAdapter("unknown_task");

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toBe("gpt-4o-mini"); // adapter default
    });

    it("LLM_MODEL takes precedence over TASK_MODEL_DEFAULTS for non-CEE tasks", () => {
      process.env.LLM_MODEL = "gpt-4o";
      process.env.LLM_PROVIDER = "openai";

      const adapter = getAdapter("unknown_task");

      expect(adapter.model).toBe("gpt-4o");
    });
  });

  describe("Model override with provider switching", () => {
    it("switches to anthropic provider when requesting Claude model with openai default", () => {
      process.env.LLM_PROVIDER = "openai";
      delete process.env.LLM_MODEL;

      // Request a Claude model - should switch to anthropic provider
      const adapter = getAdapter("draft_graph", "claude-sonnet-4-20250514");

      expect(adapter.name).toBe("anthropic");
      expect(adapter.model).toBe("claude-sonnet-4-20250514");
    });

    it("switches to openai provider when requesting OpenAI model with anthropic default", () => {
      process.env.LLM_PROVIDER = "anthropic";
      delete process.env.LLM_MODEL;

      // Request an OpenAI model - should switch to openai provider
      const adapter = getAdapter("draft_graph", "gpt-4o");

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toBe("gpt-4o");
    });

    it("model override takes precedence over task defaults", () => {
      process.env.LLM_PROVIDER = "openai";
      delete process.env.LLM_MODEL;

      // draft_graph has default gpt-4.1, but override with gpt-5-mini
      const adapter = getAdapter("draft_graph", "gpt-5-mini");

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toBe("gpt-5-mini");
    });

    it("model override takes precedence over CEE_MODEL_* env vars", () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.CEE_MODEL_DRAFT = "gpt-5.2";

      // CEE_MODEL_DRAFT says gpt-5.2, but override with gpt-4o-mini
      const adapter = getAdapter("draft_graph", "gpt-4o-mini");

      expect(adapter.model).toBe("gpt-4o-mini");
    });

    it("keeps same provider when model matches current provider", () => {
      process.env.LLM_PROVIDER = "openai";
      delete process.env.LLM_MODEL;

      // Request an OpenAI model when already on openai - should stay on openai
      const adapter = getAdapter("draft_graph", "gpt-4-turbo");

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toBe("gpt-4-turbo");
    });
  });

  describe("getAdapterWithResolution resolution_source", () => {
    beforeEach(() => {
      // Ensure every resolution test starts from a clean env/config.
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("CEE_MODEL_")) delete process.env[key];
      }
      delete process.env.LLM_PROVIDER;
      delete process.env.LLM_MODEL;
      _resetConfigCache();
      resetAdapterCache();
    });

    it("reports resolution_source=task_default when only TASK_MODEL_DEFAULTS applies", () => {
      // Use a task whose default provider matches LLM_PROVIDER so the task
      // default is actually applied (not skipped on provider-mismatch).
      // clarification defaults to gpt-4.1-2025-04-14 (openai).
      delete process.env.CEE_MODEL_CLARIFICATION;
      process.env.LLM_PROVIDER = "openai";
      _resetConfigCache();
      const { resolution } = getAdapterWithResolution("clarification");
      expect(resolution.resolution_source).toBe("task_default");
      expect(resolution.resolved_model).toBe(TASK_MODEL_DEFAULTS.clarification);
    });

    it("reports resolution_source=env_var when CEE_MODEL_DRAFT is set", () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.CEE_MODEL_DRAFT = "gpt-4.1-2025-04-14";
      _resetConfigCache();
      const { resolution } = getAdapterWithResolution("draft_graph");
      expect(resolution.resolution_source).toBe("env_var");
      expect(resolution.resolved_model).toBe("gpt-4.1-2025-04-14");
    });

    it("reports resolution_source=per_call when modelOverride is passed without origin", () => {
      process.env.LLM_PROVIDER = "openai";
      _resetConfigCache();
      const { resolution } = getAdapterWithResolution("draft_graph", "gpt-4o");
      expect(resolution.resolution_source).toBe("per_call");
      expect(resolution.resolved_model).toBe("gpt-4o");
    });

    it("reports resolution_source=store_model_config when origin is supplied", () => {
      process.env.LLM_PROVIDER = "openai";
      _resetConfigCache();
      const { resolution } = getAdapterWithResolution(
        "draft_graph",
        "gpt-4o",
        "store_model_config",
      );
      expect(resolution.resolution_source).toBe("store_model_config");
      expect(resolution.resolved_model).toBe("gpt-4o");
    });

    it("never labels a client-body override as store_model_config (negative test)", () => {
      // Client-body override = modelOverride passed without an origin flag.
      // Even after repeated invocations with different overrides, the router
      // must never upgrade a per_call classification to store_model_config.
      process.env.LLM_PROVIDER = "openai";
      _resetConfigCache();
      for (const model of ["gpt-4o", "gpt-4.1-2025-04-14", "gpt-4-turbo"]) {
        const { resolution } = getAdapterWithResolution("draft_graph", model);
        expect(resolution.resolution_source).toBe("per_call");
        expect(resolution.resolution_source).not.toBe("store_model_config");
      }
    });

    it("reports resolution_source=llm_model_fallback when only LLM_MODEL applies (non-CeeTask)", () => {
      process.env.LLM_PROVIDER = "openai";
      process.env.LLM_MODEL = "gpt-4o-mini";
      _resetConfigCache();
      // A non-CeeTask name means no TASK_MODEL_DEFAULTS entry applies; the
      // resolution stays at the initial LLM_MODEL assignment.
      const { resolution } = getAdapterWithResolution("unmapped_task_name");
      expect(resolution.resolution_source).toBe("llm_model_fallback");
      expect(resolution.resolved_model).toBe("gpt-4o-mini");
    });
  });

  describe("getAdapter behavioural no-op across TASK_MODEL_DEFAULTS", () => {
    beforeEach(() => {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("CEE_MODEL_")) delete process.env[key];
      }
      delete process.env.LLM_MODEL;
      // Use fixtures provider so no real API keys are needed; assert on
      // resolution.resolved_model (which reflects the router's selectedModel
      // before the fixtures adapter overrides .model to "fixture-v1").
      process.env.LLM_PROVIDER = "fixtures";
      _resetConfigCache();
      resetAdapterCache();
    });

    // Behavioural-no-op matrix: after the precedence-tracking refactor,
    // every CeeTask must still resolve to its TASK_MODEL_DEFAULTS entry
    // when no env / store / per-call override is in effect. This is the
    // guard against accidental runtime drift.
    for (const task of Object.keys(TASK_MODEL_DEFAULTS) as CeeTask[]) {
      it(`resolves ${task} to TASK_MODEL_DEFAULTS.${task}`, () => {
        const { resolution } = getAdapterWithResolution(task);
        expect(resolution.resolved_model).toBe(TASK_MODEL_DEFAULTS[task]);
        expect(resolution.resolution_source).toBe("task_default");
      });
    }

    it("store-override case: orchestrator with store_model_config resolves to the store model", () => {
      process.env.LLM_PROVIDER = "fixtures";
      _resetConfigCache();
      const { resolution } = getAdapterWithResolution(
        "orchestrator",
        "claude-sonnet-4-6",
        "store_model_config",
      );
      expect(resolution.resolved_model).toBe("claude-sonnet-4-6");
      expect(resolution.resolution_source).toBe("store_model_config");
    });

    it("env-var case: edit_graph with CEE_MODEL_EDIT_GRAPH resolves to the env model", () => {
      process.env.LLM_PROVIDER = "fixtures";
      process.env.CEE_MODEL_EDIT_GRAPH = "claude-sonnet-4-6";
      _resetConfigCache();
      const { resolution } = getAdapterWithResolution("edit_graph");
      expect(resolution.resolved_model).toBe("claude-sonnet-4-6");
      expect(resolution.resolution_source).toBe("env_var");
    });
  });
});
