/**
 * LLM Caching Adapter Tests
 *
 * Verifies that the caching adapter correctly caches LLM responses,
 * handles cache hits/misses, and respects bypass flags.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CachingAdapter } from "../../src/adapters/llm/caching.js";
import { FailoverAdapter } from "../../src/adapters/llm/failover.js";
import type { LLMAdapter, CallOpts, DraftGraphArgs, DraftGraphResult } from "../../src/adapters/llm/types.js";

const redisEntries = vi.hoisted(() => new Map<string, string>());

vi.mock("../../src/platform/redis.js", () => ({
  getRedis: vi.fn(async () => ({
    get: vi.fn(async (key: string) => redisEntries.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      redisEntries.set(key, value);
      return "OK";
    }),
    scan: vi.fn(async () => ["0", [...redisEntries.keys()]]),
    del: vi.fn(async (...keys: string[]) => {
      for (const key of keys) redisEntries.delete(key);
      return keys.length;
    }),
  })),
}));

// Mock adapter for testing
class MockAdapter implements LLMAdapter {
  private callCount = 0;

  constructor(
    readonly name = "mock",
    readonly model = "mock-v1",
  ) {}

  async draftGraph(args: DraftGraphArgs, _opts: CallOpts): Promise<DraftGraphResult> {
    this.callCount++;
    return {
      graph: {
        version: "1",
        default_seed: args.seed,
        nodes: [{ id: "goal_1", kind: "goal", label: args.brief }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      },
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async suggestOptions(args: any, _opts: CallOpts): Promise<any> {
    this.callCount++;
    return {
      options: [{ id: "opt_1", title: args.goal, pros: [], cons: [], evidence_to_gather: [] }],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async clarifyBrief(args: any, _opts: CallOpts): Promise<any> {
    this.callCount++;
    return {
      questions: [],
      confidence: 0.8,
      should_continue: false,
      round: args.round,
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async critiqueGraph(_args: any, _opts: CallOpts): Promise<any> {
    this.callCount++;
    return {
      issues: [],
      suggested_fixes: [],
      overall_quality: "good",
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async explainDiff(_args: any, _opts: CallOpts): Promise<any> {
    this.callCount++;
    return {
      rationales: [],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async chat(_args: any, _opts: CallOpts): Promise<any> {
    this.callCount++;
    return {
      content: "Mock chat response",
      usage: { input_tokens: 10, output_tokens: 20 },
      model: this.model,
      latencyMs: 100,
    };
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetCallCount(): void {
    this.callCount = 0;
  }
}

describe("CachingAdapter", () => {
  const defaultOpts: CallOpts = {
    requestId: "test-req-123",
    timeoutMs: 30000,
  };

  type CacheableOperation = NonNullable<CallOpts["preloadedSystemPrompt"]>["operation"];

  const governedOpts = (
    operation: CacheableOperation,
    content = `${operation.toUpperCase()} SYSTEM PROMPT`,
    version = 1,
  ): CallOpts => ({
    ...defaultOpts,
    preloadedSystemPrompt: {
      operation,
      content,
      meta: {
        taskId: operation,
        source: "store",
        promptId: `${operation}_default`,
        version,
        prompt_version: `${operation}_default@v${version}`,
        prompt_hash: `sha256-${operation}-${version}-${content}`,
        modelConfig: {
          staging: "mock-v1",
          production: "mock-v1",
        },
      },
    },
  });

  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.unstubAllEnvs();
    redisEntries.clear();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should bypass cache when PROMPT_CACHE_ENABLED is not set", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "false");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const result1 = await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    const result2 = await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));

    expect(result1.graph.nodes).toHaveLength(1);
    expect(result2.graph.nodes).toHaveLength(1);
    expect(mock.getCallCount()).toBe(2); // Both calls hit adapter (no caching)
  });

  it("should cache responses when enabled", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    vi.stubEnv("PROMPT_CACHE_MAX_SIZE", "100");
    vi.stubEnv("PROMPT_CACHE_TTL_MS", "60000");

    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const result1 = await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    const result2 = await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));

    expect(result1.graph.nodes).toHaveLength(1);
    expect(result2.graph.nodes).toHaveLength(1);
    expect(mock.getCallCount()).toBe(1); // Second call from cache
  });

  it("bypasses reuse when no immutable response authority is supplied", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.explainDiff({ patch: { adds: {}, updates: [], removes: [] } }, defaultOpts);
    await caching.explainDiff({ patch: { adds: {}, updates: [], removes: [] } }, defaultOpts);

    expect(mock.getCallCount()).toBe(2);
  });

  it("should differentiate cache entries by args", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.draftGraph({ brief: "Test A", seed: 17 }, governedOpts("draft_graph"));
    await caching.draftGraph({ brief: "Test B", seed: 17 }, governedOpts("draft_graph"));

    expect(mock.getCallCount()).toBe(2); // Different briefs = different cache keys
  });

  it("binds cached output to the exact preloaded prompt authority", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);
    const args = { brief: "Same request", seed: 17 };
    const defaultModelConfig = {
      staging: "claude-sonnet-5",
      production: "claude-sonnet-5",
    };
    const snapshot = (
      content: string,
      version: number,
      modelConfig = defaultModelConfig,
    ) => ({
      operation: "draft_graph" as const,
      content,
      meta: {
        taskId: "draft_graph" as const,
        source: "store" as const,
        promptId: "draft_graph_default",
        version,
        prompt_version: `draft_graph_default@v${version} (staging)`,
        prompt_hash: `hash-${content}`,
        modelConfig,
      },
    });

    await caching.draftGraph(args, {
      ...defaultOpts,
      requestId: "prompt-a",
      preloadedSystemPrompt: snapshot("PROMPT-A", 1),
    });
    await caching.draftGraph(args, {
      ...defaultOpts,
      requestId: "prompt-b",
      preloadedSystemPrompt: snapshot("PROMPT-B", 2),
    });
    await caching.draftGraph(args, {
      ...defaultOpts,
      requestId: "prompt-b-repeat",
      preloadedSystemPrompt: snapshot("PROMPT-B", 2),
    });
    await caching.draftGraph(args, {
      ...defaultOpts,
      requestId: "prompt-b-promoted-version",
      preloadedSystemPrompt: snapshot("PROMPT-B", 3),
    });
    await caching.draftGraph(args, {
      ...defaultOpts,
      requestId: "prompt-b-new-config",
      preloadedSystemPrompt: snapshot("PROMPT-B", 3, {
        staging: "gpt-5.2",
        production: "claude-sonnet-5",
      }),
    });

    // A promotion/invalidation that changes exact bytes, stable served
    // identity or prompt configuration misses; request-only metadata does not
    // prevent a repeat of the same authority from hitting the cache.
    expect(mock.getCallCount()).toBe(4);
  });

  it("does not alias the former Aa/BB fast-hash collision", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);
    const opts = governedOpts("suggest_options");

    const aa = await caching.suggestOptions({ goal: "Aa" }, opts);
    const bb = await caching.suggestOptions({ goal: "BB" }, opts);
    const aaAgain = await caching.suggestOptions({ goal: "Aa" }, opts);

    expect(aa.options[0].title).toBe("Aa");
    expect(bb.options[0].title).toBe("BB");
    expect(aaAgain.options[0].title).toBe("Aa");
    expect(mock.getCallCount()).toBe(2);
  });

  it("misses when the exact clarify prompt version changes and hits when it does not", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);
    const args = { brief: "Same brief", round: 0 };

    await caching.clarifyBrief(args, governedOpts("clarify_brief", "CLARIFY V1", 1));
    await caching.clarifyBrief(args, governedOpts("clarify_brief", "CLARIFY V2", 2));
    await caching.clarifyBrief(args, governedOpts("clarify_brief", "CLARIFY V2", 2));

    expect(mock.getCallCount()).toBe(2);
  });

  it("binds Redis reuse to the ordered provider/model failover topology", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    vi.stubEnv("REDIS_PROMPT_CACHE_ENABLED", "true");
    vi.stubEnv("REDIS_URL", "redis://cache.test");

    const anthropicOpenAi = new MockAdapter("anthropic", "claude-sonnet-5");
    const first = new CachingAdapter(new FailoverAdapter([
      anthropicOpenAi,
      new MockAdapter("openai", "gpt-5.2"),
    ], "suggest_options"));
    const anthropicFixtures = new MockAdapter("anthropic", "claude-sonnet-5");
    const second = new CachingAdapter(new FailoverAdapter([
      anthropicFixtures,
      new MockAdapter("fixtures", "fixtures-v1"),
    ], "suggest_options"));
    const sameTopologyPrimary = new MockAdapter("anthropic", "claude-sonnet-5");
    const sameAsFirst = new CachingAdapter(new FailoverAdapter([
      sameTopologyPrimary,
      new MockAdapter("openai", "gpt-5.2"),
    ], "suggest_options"));
    const opts = governedOpts("suggest_options");

    await first.suggestOptions({ goal: "Topology" }, opts);
    await second.suggestOptions({ goal: "Topology" }, opts);
    await sameAsFirst.suggestOptions({ goal: "Topology" }, opts);

    expect(anthropicOpenAi.getCallCount()).toBe(1);
    expect(anthropicFixtures.getCallCount()).toBe(1);
    expect(sameTopologyPrimary.getCallCount()).toBe(0);
    expect([...redisEntries.keys()]).toHaveLength(2);
    expect([...redisEntries.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^pc:v2:suggest_options:[a-f0-9]{64}$/),
      ]),
    );
  });

  it("binds reuse to stable generation configuration", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);
    const args = { brief: "Same brief", seed: 17 };

    await caching.draftGraph(args, {
      ...governedOpts("draft_graph"),
      maxTokensCeiling: 1_200,
    });
    await caching.draftGraph(args, {
      ...governedOpts("draft_graph"),
      maxTokensCeiling: 800,
    });
    await caching.draftGraph(args, {
      ...governedOpts("draft_graph"),
      maxTokensCeiling: 800,
      requestId: "different-request-only-id",
      timeoutMs: 1_234,
    });

    expect(mock.getCallCount()).toBe(2);
  });

  it("should differentiate cache entries by operation", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    await caching.suggestOptions({ goal: "Test" }, governedOpts("suggest_options"));

    expect(mock.getCallCount()).toBe(2); // Different operations = different cache keys
  });

  it("should bypass cache when bypassCache flag is set", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    await caching.draftGraph(
      { brief: "Test", seed: 17 },
      { ...governedOpts("draft_graph"), bypassCache: true },
    );

    expect(mock.getCallCount()).toBe(2); // Bypass cache = both calls hit adapter
  });

  it("should support all LLM operations", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    // Draft graph
    await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));

    // Suggest options
    await caching.suggestOptions({ goal: "Test" }, governedOpts("suggest_options"));
    await caching.suggestOptions({ goal: "Test" }, governedOpts("suggest_options"));

    // (repairGraph removed — ROADMAP 2.763)
    const testGraph = {
      version: "1",
      default_seed: 17,
      nodes: [],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
    };

    // Clarify brief
    await caching.clarifyBrief({ brief: "Test", round: 0 }, governedOpts("clarify_brief"));
    await caching.clarifyBrief({ brief: "Test", round: 0 }, governedOpts("clarify_brief"));

    // Critique graph
    await caching.critiqueGraph({ graph: testGraph }, governedOpts("critique_graph"));
    await caching.critiqueGraph({ graph: testGraph }, governedOpts("critique_graph"));

    // Explain diff
    await caching.explainDiff({
      patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
    }, defaultOpts);
    await caching.explainDiff({
      patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
    }, defaultOpts);

    // Four prompt-governed operations hit; explain_diff has no immutable
    // prompt/code fingerprint at this boundary and therefore bypasses twice.
    expect(mock.getCallCount()).toBe(6);
  });

  it("should expose cache statistics", () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    vi.stubEnv("PROMPT_CACHE_MAX_SIZE", "50");
    vi.stubEnv("PROMPT_CACHE_TTL_MS", "5000");

    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const stats = caching.stats();

    expect(stats.capacity).toBe(50);
    expect(stats.ttlMs).toBe(5000);
    expect(stats.enabled).toBe(true);
    expect(stats.size).toBe(0); // Empty initially
  });

  it("should support clearCache method", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    expect(mock.getCallCount()).toBe(1);

    // Cache hit
    await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    expect(mock.getCallCount()).toBe(1); // Still 1 (cached)

    // Clear cache
    caching.clearCache();

    // Cache miss after clear
    await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    expect(mock.getCallCount()).toBe(2); // New call after clear
  });

  it("should preserve original adapter name (no suffix)", () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    // Name should be unchanged to avoid breaking downstream routing
    expect(caching.name).toBe("mock");
    expect(caching.model).toBe("mock-v1");
  });

  it("should handle complex nested args deterministically", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const args1 = { brief: "Test", seed: 17, flags: { a: 1, b: 2 } };
    const args2 = { brief: "Test", seed: 17, flags: { a: 1, b: 2 } };

    await caching.draftGraph(args1, governedOpts("draft_graph"));
    await caching.draftGraph(args2, governedOpts("draft_graph"));

    expect(mock.getCallCount()).toBe(1); // Same args = cache hit
  });

  it("should differentiate args with different nested values", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const args1 = { brief: "Test", seed: 17, flags: { a: 1 } };
    const args2 = { brief: "Test", seed: 17, flags: { a: 2 } };

    await caching.draftGraph(args1, governedOpts("draft_graph"));
    await caching.draftGraph(args2, governedOpts("draft_graph"));

    expect(mock.getCallCount()).toBe(2); // Different flags = different cache keys
  });

  it("should handle default environment values", () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    // Don't set MAX_SIZE or TTL - should use defaults

    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const stats = caching.stats();
    expect(stats.capacity).toBe(100); // Default
    expect(stats.ttlMs).toBe(3600000); // Default (1 hour)
  });

  it("should prevent mutation leakage via deep cloning", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    // First call - caches result
    const result1 = await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    expect(mock.getCallCount()).toBe(1);

    // Mutate the returned result (common in draft pipeline)
    result1.graph.nodes.push({
      id: "mutated_node",
      kind: "goal",
      label: "This should not leak into cache",
    });

    // Second call - should get clean cached result (not mutated)
    const result2 = await caching.draftGraph({ brief: "Test", seed: 17 }, governedOpts("draft_graph"));
    expect(mock.getCallCount()).toBe(1); // Still 1 (cached)

    // Verify cached result is NOT mutated
    expect(result2.graph.nodes).toHaveLength(1); // Original length
    expect(result2.graph.nodes[0].label).toBe("Test"); // Original data
    expect(result2.graph.nodes.find((n) => n.id === "mutated_node")).toBeUndefined();
  });

  it("should not emit telemetry when cache is disabled", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "false");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    // Track telemetry emissions
    const emissions: string[] = [];
    const originalEmit = (await import("../../src/utils/telemetry.js")).emit;
    vi.spyOn(await import("../../src/utils/telemetry.js"), "emit").mockImplementation((event: string) => {
      emissions.push(event);
      return originalEmit(event, {});
    });

    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);

    // Should NOT emit any cache telemetry when disabled
    expect(emissions).not.toContain("assist.llm.prompt_cache_hit");
    expect(emissions).not.toContain("assist.llm.prompt_cache_miss");
  });

  it("should not emit telemetry when bypass flag is set", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    // Track telemetry emissions
    const emissions: string[] = [];
    const originalEmit = (await import("../../src/utils/telemetry.js")).emit;
    vi.spyOn(await import("../../src/utils/telemetry.js"), "emit").mockImplementation((event: string) => {
      emissions.push(event);
      return originalEmit(event, {});
    });

    await caching.draftGraph({ brief: "Test", seed: 17 }, { ...defaultOpts, bypassCache: true });

    // Should NOT emit cache telemetry when bypassing
    expect(emissions).not.toContain("assist.llm.prompt_cache_hit");
    expect(emissions).not.toContain("assist.llm.prompt_cache_miss");
  });
});
