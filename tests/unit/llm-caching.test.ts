/**
 * LLM Caching Adapter Tests
 *
 * Verifies that the caching adapter correctly caches LLM responses,
 * handles cache hits/misses, and respects bypass flags.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CachingAdapter } from "../../src/adapters/llm/caching.js";
import type { LLMAdapter, CallOpts, DraftGraphArgs, DraftGraphResult } from "../../src/adapters/llm/types.js";

// Mock adapter for testing
class MockAdapter implements LLMAdapter {
  readonly name = "mock";
  readonly model = "mock-v1";
  private callCount = 0;

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

  async suggestOptions(_args: any, _opts: CallOpts): Promise<any> {
    this.callCount++;
    return {
      options: [{ id: "opt_1", title: "Option 1", pros: [], cons: [], evidence_to_gather: [] }],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async repairGraph(args: any, _opts: CallOpts): Promise<any> {
    this.callCount++;
    return {
      graph: args.graph,
      rationales: [],
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

  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should bypass cache when PROMPT_CACHE_ENABLED is not set", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "false");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const result1 = await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    const result2 = await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);

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

    const result1 = await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    const result2 = await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);

    expect(result1.graph.nodes).toHaveLength(1);
    expect(result2.graph.nodes).toHaveLength(1);
    expect(mock.getCallCount()).toBe(1); // Second call from cache
  });

  it("should differentiate cache entries by args", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.draftGraph({ brief: "Test A", seed: 17 }, defaultOpts);
    await caching.draftGraph({ brief: "Test B", seed: 17 }, defaultOpts);

    expect(mock.getCallCount()).toBe(2); // Different briefs = different cache keys
  });

  it("should differentiate cache entries by operation", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    await caching.suggestOptions({ goal: "Test" }, defaultOpts);

    expect(mock.getCallCount()).toBe(2); // Different operations = different cache keys
  });

  it("should bypass cache when bypassCache flag is set", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    await caching.draftGraph({ brief: "Test", seed: 17 }, { ...defaultOpts, bypassCache: true });

    expect(mock.getCallCount()).toBe(2); // Bypass cache = both calls hit adapter
  });

  it("should support all LLM operations", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    // Draft graph
    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);

    // Suggest options
    await caching.suggestOptions({ goal: "Test" }, defaultOpts);
    await caching.suggestOptions({ goal: "Test" }, defaultOpts);

    // Repair graph
    const testGraph = {
      version: "1",
      default_seed: 17,
      nodes: [],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
    };
    await caching.repairGraph({ graph: testGraph, violations: ["test"] }, defaultOpts);
    await caching.repairGraph({ graph: testGraph, violations: ["test"] }, defaultOpts);

    // Clarify brief
    await caching.clarifyBrief({ brief: "Test", round: 0 }, defaultOpts);
    await caching.clarifyBrief({ brief: "Test", round: 0 }, defaultOpts);

    // Critique graph
    await caching.critiqueGraph({ graph: testGraph }, defaultOpts);
    await caching.critiqueGraph({ graph: testGraph }, defaultOpts);

    // Explain diff
    await caching.explainDiff({
      patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
    }, defaultOpts);
    await caching.explainDiff({
      patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
    }, defaultOpts);

    // Each operation called twice, but second call from cache
    expect(mock.getCallCount()).toBe(6); // 6 operations, 1 adapter call each
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

    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    expect(mock.getCallCount()).toBe(1);

    // Cache hit
    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    expect(mock.getCallCount()).toBe(1); // Still 1 (cached)

    // Clear cache
    caching.clearCache();

    // Cache miss after clear
    await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
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

    await caching.draftGraph(args1, defaultOpts);
    await caching.draftGraph(args2, defaultOpts);

    expect(mock.getCallCount()).toBe(1); // Same args = cache hit
  });

  it("should differentiate args with different nested values", async () => {
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    const mock = new MockAdapter();
    const caching = new CachingAdapter(mock);

    const args1 = { brief: "Test", seed: 17, flags: { a: 1 } };
    const args2 = { brief: "Test", seed: 17, flags: { a: 2 } };

    await caching.draftGraph(args1, defaultOpts);
    await caching.draftGraph(args2, defaultOpts);

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
    const result1 = await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
    expect(mock.getCallCount()).toBe(1);

    // Mutate the returned result (common in draft pipeline)
    result1.graph.nodes.push({
      id: "mutated_node",
      kind: "goal",
      label: "This should not leak into cache",
    });

    // Second call - should get clean cached result (not mutated)
    const result2 = await caching.draftGraph({ brief: "Test", seed: 17 }, defaultOpts);
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
