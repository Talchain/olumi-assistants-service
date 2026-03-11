/**
 * Dispatch Chaining Tests
 *
 * Tests for:
 * - run_analysis + explain_results auto-chaining when intent is 'explain' or 'recommend'
 * - No chaining when intent is 'act' (pure action)
 * - Unknown tool → warning logged, no crash, error handled by caller
 * - Registry startup validation: missing tool → throws at init
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — hoisted for vi.mock factories
// ============================================================================

const {
  mockRunAnalysis,
  mockExplainResults,
  mockGetAdapter,
  mockHandleEditGraph,
} = vi.hoisted(() => ({
  mockRunAnalysis: vi.fn(),
  mockExplainResults: vi.fn(),
  mockGetAdapter: vi.fn(),
  mockHandleEditGraph: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/run-analysis.js", () => ({
  handleRunAnalysis: mockRunAnalysis,
}));

vi.mock("../../../../src/orchestrator/tools/explain-results.js", () => ({
  handleExplainResults: mockExplainResults,
}));

vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: mockGetAdapter,
  getMaxTokensFromConfig: () => undefined,
}));

// Shallow mock for other handlers to prevent side effects
vi.mock("../../../../src/orchestrator/tools/draft-graph.js", () => ({
  handleDraftGraph: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/tools/generate-brief.js", () => ({
  handleGenerateBrief: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/tools/edit-graph.js", () => ({
  handleEditGraph: mockHandleEditGraph,
}));
vi.mock("../../../../src/orchestrator/tools/undo-patch.js", () => ({
  handleUndoPatch: vi.fn(),
}));
// Return a non-null mock PLoT client so the run_analysis guard passes.
// handleRunAnalysis itself is mocked so the actual client is never called.
vi.mock("../../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: vi.fn().mockReturnValue({
    run: vi.fn(),
    validatePatch: vi.fn(),
  }),
  PLoTError: class PLoTError extends Error {},
  PLoTTimeoutError: class PLoTTimeoutError extends Error {},
}));

import { dispatchToolHandler, _resetDispatchPlotClient } from "../../../../src/orchestrator/tools/dispatch.js";
import { createPLoTClient } from "../../../../src/orchestrator/plot-client.js";
import { validateGatePatternsAgainstRegistry } from "../../../../src/orchestrator/tools/registry.js";
import type { ConversationContext, V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: { nodes: [], edges: [], version: "3.0" } as unknown as ConversationContext["graph"],
    analysis_response: null,
    framing: { stage: "evaluate" },
    messages: [],
    scenario_id: "test-scenario",
    analysis_inputs: {
      options: [{ option_id: "opt_a", label: "Option A", interventions: {} }],
    },
    ...overrides,
  };
}

function makeAnalysisResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-1" },
    results: [{ option_label: "Option A", win_probability: 0.6 }],
    response_hash: "top-hash",
  };
}

function makeAnalysisBlock() {
  return {
    block_id: "blk_fact_abc123",
    block_type: "fact" as const,
    data: { fact_type: "option_comparison", facts: [] },
    provenance: { trigger: "tool:run_analysis", turn_id: "turn-1", timestamp: new Date().toISOString() },
  };
}

function makeCommentaryBlock() {
  return {
    block_id: "blk_commentary_def456",
    block_type: "commentary" as const,
    data: { narrative: "Option A wins due to...", supporting_refs: [] },
    provenance: { trigger: "tool:explain_results", turn_id: "turn-1", timestamp: new Date().toISOString() },
  };
}

// ============================================================================
// Tests: run_analysis → explain_results chaining
// ============================================================================

describe("dispatch chaining: run_analysis + explain_results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton so fresh mock client is used
    _resetDispatchPlotClient();

    // Default run_analysis mock
    mockRunAnalysis.mockResolvedValue({
      blocks: [makeAnalysisBlock()],
      analysisResponse: makeAnalysisResponse(),
      responseHash: "top-hash",
      seedUsed: 42,
      nSamples: 1000,
      latencyMs: 100,
    });

    // Default explain_results mock
    mockExplainResults.mockResolvedValue({
      blocks: [makeCommentaryBlock()],
      assistantText: null,
      latencyMs: 50,
    });

    // Adapter mock
    mockGetAdapter.mockReturnValue({ chat: vi.fn() });
  });

  it("chains explain_results when intent is 'explain'", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
      { intentClassification: "explain" },
    );

    expect(mockRunAnalysis).toHaveBeenCalledOnce();
    expect(mockExplainResults).toHaveBeenCalledOnce();

    // Both analysis blocks and commentary blocks included
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].block_type).toBe("fact");
    expect(result.blocks[1].block_type).toBe("commentary");
  });

  it("chains explain_results when intent is 'recommend'", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
      { intentClassification: "recommend" },
    );

    expect(mockExplainResults).toHaveBeenCalledOnce();
    expect(result.blocks).toHaveLength(2);
  });

  it("does NOT chain explain_results when intent is 'act'", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
      { intentClassification: "act" },
    );

    expect(mockExplainResults).not.toHaveBeenCalled();
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("fact");
  });

  it("does NOT chain when no intentClassification provided", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
    );

    expect(mockExplainResults).not.toHaveBeenCalled();
    expect(result.blocks).toHaveLength(1);
  });

  it("does NOT chain when intent is 'conversational'", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
      { intentClassification: "conversational" },
    );

    expect(mockExplainResults).not.toHaveBeenCalled();
    expect(result.blocks).toHaveLength(1);
  });

  it("run_analysis failure rejects dispatch — explain_results is not called", async () => {
    mockRunAnalysis.mockRejectedValue(new Error("PLoT timeout"));

    await expect(
      dispatchToolHandler(
        "run_analysis",
        {},
        makeContext(),
        "turn-1",
        "req-1",
        { intentClassification: "explain" },
      ),
    ).rejects.toThrow("PLoT timeout");

    expect(mockExplainResults).not.toHaveBeenCalled();
  });

  it("explain_results failure is non-fatal — analysis blocks still returned", async () => {
    mockExplainResults.mockRejectedValue(new Error("LLM timeout"));

    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
      { intentClassification: "explain" },
    );

    // Should not throw — explanation failure is absorbed
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("fact");
  });

  it("explain_results receives updated analysis_response in context", async () => {
    await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext({ analysis_response: null }),
      "turn-1",
      "req-1",
      { intentClassification: "explain" },
    );

    // The context passed to explain_results should have the fresh analysis_response
    const explainContext = mockExplainResults.mock.calls[0][0] as ConversationContext;
    expect(explainContext.analysis_response).toBeDefined();
    expect(explainContext.analysis_response?.response_hash).toBe("top-hash");
  });

  it("analysisResponse is always returned in dispatch result", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
      { intentClassification: "act" },
    );

    expect(result.analysisResponse).toBeDefined();
    expect(result.analysisResponse?.response_hash).toBe("top-hash");
  });
});

describe("dispatchToolHandler — edit_graph PLoT handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDispatchPlotClient();
    mockGetAdapter.mockReturnValue({ chat: vi.fn() });
    mockHandleEditGraph.mockResolvedValue({
      blocks: [],
      assistantText: null,
      latencyMs: 10,
      appliedGraph: null,
      wasRejected: false,
    });
  });

  it("passes the shared PLoT client into handleEditGraph when configured", async () => {
    const plotClient = {
      run: vi.fn().mockResolvedValue({}),
      validatePatch: vi.fn().mockResolvedValue({ kind: "success", data: { verdict: "accepted" } }),
    };
    vi.mocked(createPLoTClient).mockReturnValue(plotClient as never);

    await dispatchToolHandler(
      "edit_graph",
      { edit_description: "Rename Price" },
      makeContext(),
      "turn-1",
      "req-1",
    );

    expect(mockHandleEditGraph).toHaveBeenCalledOnce();
    expect(mockHandleEditGraph.mock.calls[0][5]).toEqual({
      plotClient,
      plotOpts: undefined,
    });
  });
});

// ============================================================================
// Tests: Registry startup validation
// ============================================================================

describe("validateGatePatternsAgainstRegistry", () => {
  it("passes when all tool names are in the registry", () => {
    expect(() => validateGatePatternsAgainstRegistry([
      "draft_graph",
      "edit_graph",
      "run_analysis",
      "explain_results",
      "generate_brief",
    ])).not.toThrow();
  });

  it("throws when a tool name is missing from the registry", () => {
    expect(() => validateGatePatternsAgainstRegistry(["draft_graph", "nonexistent_tool"]))
      .toThrow("Intent gate startup validation failed");
  });

  it("throws with the missing tool name in the error message", () => {
    expect(() => validateGatePatternsAgainstRegistry(["fake_tool_x"]))
      .toThrow("fake_tool_x");
  });

  it("passes for empty array (no gate patterns)", () => {
    expect(() => validateGatePatternsAgainstRegistry([])).not.toThrow();
  });

  it("passes for single valid tool name", () => {
    expect(() => validateGatePatternsAgainstRegistry(["run_analysis"])).not.toThrow();
  });
});
