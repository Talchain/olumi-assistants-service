/**
 * Provider Failover Tests
 *
 * Verifies that the FailoverAdapter correctly tries multiple providers
 * in sequence when primary provider fails.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FailoverAdapter } from "../../src/adapters/llm/failover.js";
import type { LLMAdapter, CallOpts, DraftGraphArgs, DraftGraphResult } from "../../src/adapters/llm/types.js";

// Mock adapters for testing
class MockAdapter implements LLMAdapter {
  constructor(
    public readonly name: string,
    public readonly model: string,
    private shouldFail: boolean = false
  ) {}

  async draftGraph(args: DraftGraphArgs, _opts: CallOpts): Promise<DraftGraphResult> {
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
    return {
      graph: {
        version: "1",
        default_seed: args.seed,
        nodes: [{ id: "goal_1", kind: "goal", label: args.brief }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async suggestOptions(_args: any, _opts: CallOpts): Promise<any> {
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
    return {
      options: [{ id: "opt_1", title: "Option 1", pros: [], cons: [], evidence_to_gather: [] }],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async repairGraph(args: any, _opts: CallOpts): Promise<any> {
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
    return {
      graph: args.graph,
      rationales: [],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async clarifyBrief(args: any, _opts: CallOpts): Promise<any> {
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
    return {
      questions: [],
      confidence: 0.8,
      should_continue: false,
      round: args.round,
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async critiqueGraph(_args: any, _opts: CallOpts): Promise<any> {
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
    return {
      issues: [],
      suggested_fixes: [],
      overall_quality: "good",
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  async explainDiff(_args: any, _opts: CallOpts): Promise<any> {
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
    return {
      rationales: [],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }
}

describe("FailoverAdapter", () => {
  const defaultOpts: CallOpts = {
    requestId: "test-req-123",
    timeoutMs: 30000,
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should throw error if constructed with no adapters", () => {
    expect(() => new FailoverAdapter([], "test")).toThrow("requires at least one adapter");
  });

  it("should use primary adapter name and model for telemetry", () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", false),
      new MockAdapter("fallback", "model-v2", false),
    ];

    const failover = new FailoverAdapter(adapters, "test");
    expect(failover.name).toBe("primary-failover");
    expect(failover.model).toBe("model-v1");
  });

  it("should succeed with primary adapter when it works", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", false),
      new MockAdapter("fallback", "model-v2", false),
    ];

    const failover = new FailoverAdapter(adapters, "draft_graph");
    const result = await failover.draftGraph(
      { brief: "Test brief", seed: 17 },
      defaultOpts
    );

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].label).toBe("Test brief");
  });

  it("should failover to second adapter when primary fails", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true), // Will fail
      new MockAdapter("fallback", "model-v2", false), // Will succeed
    ];

    const failover = new FailoverAdapter(adapters, "draft_graph");
    const result = await failover.draftGraph(
      { brief: "Test brief", seed: 17 },
      defaultOpts
    );

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].label).toBe("Test brief");
  });

  it("should try all adapters in sequence until one succeeds", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true), // Will fail
      new MockAdapter("fallback1", "model-v2", true), // Will fail
      new MockAdapter("fallback2", "model-v3", false), // Will succeed
    ];

    const failover = new FailoverAdapter(adapters, "draft_graph");
    const result = await failover.draftGraph(
      { brief: "Test brief", seed: 17 },
      defaultOpts
    );

    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0].label).toBe("Test brief");
  });

  it("should throw AggregateError when all adapters fail", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true),
      new MockAdapter("fallback", "model-v2", true),
    ];

    const failover = new FailoverAdapter(adapters, "draft_graph");

    await expect(
      failover.draftGraph({ brief: "Test brief", seed: 17 }, defaultOpts)
    ).rejects.toThrow(AggregateError);

    // Verify error contains all provider failures
    try {
      await failover.draftGraph({ brief: "Test brief", seed: 17 }, defaultOpts);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      const aggError = error as AggregateError;
      expect(aggError.message).toContain("All 2 providers failed");
      expect(aggError.message).toContain("primary: primary failed");
      expect(aggError.message).toContain("fallback: fallback failed");
      expect(aggError.errors).toHaveLength(2);
    }
  });

  it("should work with suggestOptions method", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true), // Will fail
      new MockAdapter("fallback", "model-v2", false), // Will succeed
    ];

    const failover = new FailoverAdapter(adapters, "suggest_options");
    const result = await failover.suggestOptions(
      { goal: "Test goal" },
      defaultOpts
    );

    expect(result.options).toHaveLength(1);
    expect(result.options[0].id).toBe("opt_1");
  });

  it("should work with repairGraph method", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true),
      new MockAdapter("fallback", "model-v2", false),
    ];

    const failover = new FailoverAdapter(adapters, "repair_graph");
    const testGraph = {
      version: "1",
      default_seed: 17,
      nodes: [],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
    };

    const result = await failover.repairGraph(
      { graph: testGraph, violations: ["test"] },
      defaultOpts
    );

    expect(result.graph).toBeDefined();
  });

  it("should work with clarifyBrief method", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true),
      new MockAdapter("fallback", "model-v2", false),
    ];

    const failover = new FailoverAdapter(adapters, "clarify_brief");
    const result = await failover.clarifyBrief(
      { brief: "Test", round: 0 },
      defaultOpts
    );

    expect(result.questions).toBeDefined();
    expect(result.confidence).toBe(0.8);
  });

  it("should work with critiqueGraph method", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true),
      new MockAdapter("fallback", "model-v2", false),
    ];

    const failover = new FailoverAdapter(adapters, "critique_graph");
    const testGraph = {
      version: "1",
      default_seed: 17,
      nodes: [],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
    };

    const result = await failover.critiqueGraph(
      { graph: testGraph },
      defaultOpts
    );

    expect(result.issues).toBeDefined();
    expect(result.overall_quality).toBe("good");
  });

  it("should work with explainDiff method", async () => {
    const adapters = [
      new MockAdapter("primary", "model-v1", true),
      new MockAdapter("fallback", "model-v2", false),
    ];

    const failover = new FailoverAdapter(adapters, "explain_diff");
    const result = await failover.explainDiff(
      {
        patch: {
          adds: { nodes: [], edges: [] },
          updates: [],
          removes: [],
        },
      },
      defaultOpts
    );

    expect(result.rationales).toBeDefined();
  });

  it("should handle single adapter gracefully", async () => {
    const adapters = [new MockAdapter("only-adapter", "model-v1", false)];

    const failover = new FailoverAdapter(adapters, "draft_graph");
    const result = await failover.draftGraph(
      { brief: "Test brief", seed: 17 },
      defaultOpts
    );

    expect(result.graph.nodes).toHaveLength(1);
  });

  it("should throw AggregateError for single failing adapter", async () => {
    const adapters = [new MockAdapter("only-adapter", "model-v1", true)];

    const failover = new FailoverAdapter(adapters, "draft_graph");

    await expect(
      failover.draftGraph({ brief: "Test brief", seed: 17 }, defaultOpts)
    ).rejects.toThrow(AggregateError);

    // Verify error message contains provider name
    try {
      await failover.draftGraph({ brief: "Test brief", seed: 17 }, defaultOpts);
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      const aggError = error as AggregateError;
      expect(aggError.message).toContain("All 1 providers failed");
      expect(aggError.message).toContain("only-adapter: only-adapter failed");
    }
  });
});
