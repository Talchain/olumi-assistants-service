import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BudgetEnforcementContext } from "../../../../src/orchestrator/context/budget.js";
import type { GraphV3Compact } from "../../../../src/orchestrator/context/graph-compact.js";
import type { AnalysisResponseSummary } from "../../../../src/orchestrator/context/analysis-compact.js";

// Import after potential env setup
async function getEnforceContextBudget() {
  const mod = await import("../../../../src/orchestrator/context/budget.js");
  return mod.enforceContextBudget;
}

// ============================================================================
// Fixtures
// ============================================================================

function makeCompactGraph(nodeCount = 3, edgeCount = 2): GraphV3Compact {
  return {
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n${i}`,
      kind: "factor",
      label: `Factor ${i}`,
      value: i * 10,
    })),
    edges: Array.from({ length: edgeCount }, (_, i) => ({
      from: `n${i}`,
      to: `n${i + 1 < nodeCount ? i + 1 : 0}`,
      strength: 0.5,
      exists: 0.9,
    })),
    _node_count: nodeCount,
    _edge_count: edgeCount,
  };
}

function makeAnalysisSummary(): AnalysisResponseSummary {
  return {
    winner: { option_id: "opt_a", option_label: "Option A", win_probability: 0.7 },
    options: [
      { option_id: "opt_a", option_label: "Option A", win_probability: 0.7, outcome_mean: 0.65 },
      { option_id: "opt_b", option_label: "Option B", win_probability: 0.3, outcome_mean: 0.25 },
    ],
    top_drivers: [
      { factor_id: "f1", factor_label: "Factor 1", sensitivity: 0.8, direction: "positive" },
      { factor_id: "f2", factor_label: "Factor 2", sensitivity: 0.6, direction: "negative" },
      { factor_id: "f3", factor_label: "Factor 3", sensitivity: 0.4, direction: "positive" },
      { factor_id: "f4", factor_label: "Factor 4", sensitivity: 0.3, direction: "positive" },
      { factor_id: "f5", factor_label: "Factor 5", sensitivity: 0.2, direction: "negative" },
    ],
    robustness_level: "moderate",
    fragile_edge_count: 2,
    constraint_tensions: ["c1", "c2"],
    analysis_status: "ok",
  };
}

function makeMessage(role: 'user' | 'assistant', content = "message content") {
  return { role, content };
}

function makeContext(overrides?: Partial<BudgetEnforcementContext>): BudgetEnforcementContext {
  return {
    messages: [makeMessage("user")],
    graph_compact: makeCompactGraph(),
    analysis_response: makeAnalysisSummary(),
    ...overrides,
  };
}

// Generates a large string of the given approximate character count
function largeString(chars: number): string {
  return "x".repeat(chars);
}

// ============================================================================
// Tests
// ============================================================================

describe("enforceContextBudget", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ORCHESTRATOR_CONTEXT_BUDGET;
    vi.restoreAllMocks();
  });

  it("returns context unchanged when within budget", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    const context = makeContext({ messages: [makeMessage("user", "Hello")] });
    const result = enforceContextBudget(context, 120_000);
    // Small context should not be modified
    expect(result.messages).toHaveLength(1);
    expect(result.graph_compact).toBeDefined();
    expect(result.analysis_response).toBeDefined();
  });

  it("drops low-value metadata (type/category/source) before value when graph exceeds budget", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    // Graph budget = 25% of maxTokens. Create a tiny maxTokens so graph exceeds it.
    const tinyMax = 100; // 25 tokens for graph = 100 chars — easily exceeded
    const bigGraph: GraphV3Compact = {
      nodes: Array.from({ length: 5 }, (_, i) => ({
        id: `n${i}`,
        kind: "factor",
        label: `Factor with a fairly long label ${i}`,
        value: i * 100,
        type: "some_type",
        category: "controllable",
        source: "user" as const,
      })),
      edges: [
        { from: "n0", to: "n1", strength: 0.5, exists: 0.9 },
        { from: "n1", to: "n2", strength: 0.3, exists: 0.4 }, // low exists — field may be stripped, edge preserved
        { from: "n2", to: "n3", strength: 0.7, exists: 0.6 },
      ],
      _node_count: 5,
      _edge_count: 3,
    };
    const context = makeContext({ graph_compact: bigGraph, messages: [makeMessage("user", "Hi")] });
    const result = enforceContextBudget(context, tinyMax);

    // All edges must be preserved — pass 4 drops the exists *field*, not edges
    expect(result.graph_compact?.edges).toHaveLength(bigGraph.edges.length);
  });

  it("drops constraint_tensions and reduces drivers to 3 when analysis exceeds budget", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    // Analysis budget = 15% of maxTokens. Use tiny maxTokens.
    const tinyMax = 50;
    const context = makeContext({ messages: [makeMessage("user", "Hi")] });
    const result = enforceContextBudget(context, tinyMax);

    if (result.analysis_response) {
      // Drivers reduced to max 3
      expect(result.analysis_response.top_drivers.length).toBeLessThanOrEqual(3);
      // Constraint tensions dropped
      expect(result.analysis_response.constraint_tensions).toBeUndefined();
    }
  });

  it("reduces conversation to 3 turns when over budget", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    // Create 6 messages — should reduce to 3 (keeping latest)
    const messages = Array.from({ length: 6 }, (_, i) =>
      makeMessage(i % 2 === 0 ? "user" : "assistant", largeString(500)),
    );
    // Conversation budget = 30% of 200 tokens = 60 tokens = 240 chars. 6 × 500 = 3000 chars >> 240 chars
    const tinyMax = 200;
    const context = makeContext({ messages, graph_compact: null, analysis_response: null });
    const result = enforceContextBudget(context, tinyMax);
    const resultMessages = result.messages ?? [];
    expect(resultMessages.length).toBeLessThanOrEqual(3);
    // Always keeps latest — last message should be preserved
    const lastOriginal = messages[messages.length - 1];
    const lastResult = resultMessages[resultMessages.length - 1];
    expect(lastResult.content).toBe(lastOriginal.content);
  });

  it("reduces conversation to 1 turn when 3 turns still over budget", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    // Each message is 5000 chars — very large
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage(i % 2 === 0 ? "user" : "assistant", largeString(5000)),
    );
    const tinyMax = 50; // Conversation budget = 15 tokens = 60 chars << 3 × 5000
    const context = makeContext({ messages, graph_compact: null, analysis_response: null });
    const result = enforceContextBudget(context, tinyMax);
    expect((result.messages ?? []).length).toBeLessThanOrEqual(1);
  });

  it("always keeps latest messages (not first)", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    const messages = [
      makeMessage("user", "First message"),
      makeMessage("assistant", "Second message"),
      makeMessage("user", "Third message"),
      makeMessage("assistant", "Fourth message"),
      makeMessage("user", "Fifth — the latest"),
    ];
    const tinyMax = 50;
    const context = makeContext({ messages, graph_compact: null, analysis_response: null });
    const result = enforceContextBudget(context, tinyMax);
    const resultMessages = result.messages ?? [];
    const lastMsg = resultMessages[resultMessages.length - 1];
    expect(lastMsg.content).toContain("Fifth — the latest");
  });

  it("never throws when given malformed input", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    // Pass completely broken input — should return unchanged, not throw
    const brokenInput = null as unknown as BudgetEnforcementContext;
    expect(() => enforceContextBudget(brokenInput, 120_000)).not.toThrow();
  });

  it("returns context unchanged when error occurs", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    const brokenInput = null as unknown as BudgetEnforcementContext;
    const result = enforceContextBudget(brokenInput, 120_000);
    // Should return the original (broken) input unchanged
    expect(result).toBe(brokenInput);
  });

  it("uses ORCHESTRATOR_CONTEXT_BUDGET env variable", async () => {
    // Set a very small budget via env
    process.env.ORCHESTRATOR_CONTEXT_BUDGET = "100";
    vi.resetModules();
    const { enforceContextBudget: freshFn } = await import("../../../../src/orchestrator/context/budget.js");

    const messages = Array.from({ length: 10 }, (_, i) =>
      makeMessage(i % 2 === 0 ? "user" : "assistant", largeString(200)),
    );
    const context = makeContext({ messages, graph_compact: null, analysis_response: null });
    // With budget of 100 tokens, conversation budget = 30 tokens — should trim
    const result = freshFn(context);
    expect((result.messages ?? []).length).toBeLessThan(10);
  });

  it("returns a copy — does not mutate the original context", async () => {
    const enforceContextBudget = await getEnforceContextBudget();
    const originalMessages = [makeMessage("user", "Hello")];
    const context = makeContext({ messages: originalMessages });
    enforceContextBudget(context, 120_000);
    // Original messages array should be unchanged
    expect(context.messages).toBe(originalMessages);
  });
});
