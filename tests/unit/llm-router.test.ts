import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAdapter, getAdapterForProvider, resetAdapterCache } from "../../src/adapters/llm/router.js";
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

    it("returns input graph unchanged for repairGraph", async () => {
      const adapter = getAdapter();
      const inputGraph = {
        version: "1" as const,
        default_seed: 17,
        nodes: [{ id: "test", kind: "goal" as const, label: "Test" }],
        edges: [],
        meta: { roots: ["test"], leaves: ["test"], suggested_positions: {}, source: "assistant" as const },
      };

      const result = await adapter.repairGraph(
        { graph: inputGraph, violations: [] },
        { requestId: "test", timeoutMs: 1000 }
      );

      expect(result.graph).toEqual(inputGraph);
      expect(result.rationales).toHaveLength(1);
      expect(result.usage.input_tokens).toBe(0);
    });
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
        expect(typeof adapter.repairGraph).toBe("function");
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

    it("Fixtures adapter reports zero tokens for repairGraph", async () => {
      const adapter = getAdapterForProvider("fixtures");
      const testGraph = {
        version: "1" as const,
        default_seed: 17,
        nodes: [{ id: "test", kind: "goal" as const, label: "Test" }],
        edges: [],
        meta: { roots: ["test"], leaves: ["test"], suggested_positions: {}, source: "assistant" as const },
      };

      const result = await adapter.repairGraph(
        { graph: testGraph, violations: [] },
        { requestId: "test", timeoutMs: 1000 }
      );

      expect(result.usage.input_tokens).toBe(0);
      expect(result.usage.output_tokens).toBe(0);
    });

    it("Fixtures adapter has consistent UsageMetrics structure across all methods", async () => {
      const adapter = getAdapterForProvider("fixtures");
      const testGraph = {
        version: "1" as const,
        default_seed: 17,
        nodes: [{ id: "test", kind: "goal" as const, label: "Test" }],
        edges: [],
        meta: { roots: ["test"], leaves: ["test"], suggested_positions: {}, source: "assistant" as const },
      };

      const draftResult = await adapter.draftGraph(
        { brief: "test", docs: [], seed: 17 },
        { requestId: "test", timeoutMs: 1000 }
      );

      const suggestResult = await adapter.suggestOptions(
        { goal: "test goal" },
        { requestId: "test", timeoutMs: 1000 }
      );

      const repairResult = await adapter.repairGraph(
        { graph: testGraph, violations: [] },
        { requestId: "test", timeoutMs: 1000 }
      );

      // All methods return consistent UsageMetrics structure
      for (const result of [draftResult, suggestResult, repairResult]) {
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
    it("uses gpt-4o for draft_graph when no CEE_MODEL_DRAFT override", () => {
      delete process.env.CEE_MODEL_DRAFT;
      delete process.env.LLM_MODEL;
      process.env.LLM_PROVIDER = "openai";

      const adapter = getAdapter("draft_graph");

      expect(adapter.name).toBe("openai");
      expect(adapter.model).toBe("gpt-4o"); // Updated default (best performance in testing)
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

      // draft_graph has default gpt-4o, but override with gpt-5-mini
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
});
