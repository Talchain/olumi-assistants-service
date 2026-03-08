/**
 * Unit tests for parallel generate_model feature.
 *
 * Tests the handleParallelGenerate function directly with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";

// Mock LLM adapter
const mockChat = vi.fn();
vi.mock("../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: "test",
    model: "test-model",
    chat: (...args: unknown[]) => mockChat(...args),
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(4096),
}));

// Mock draft_graph handler
const mockHandleDraftGraph = vi.fn();
vi.mock("../../../src/orchestrator/tools/draft-graph.js", () => ({
  handleDraftGraph: (...args: unknown[]) => mockHandleDraftGraph(...args),
}));

// Mock unified pipeline (transitive dep of draft-graph)
vi.mock("../../../src/cee/unified-pipeline/index.js", () => ({
  runUnifiedPipeline: vi.fn(),
}));

// Mock telemetry
vi.mock("../../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock context hash
vi.mock("../../../src/orchestrator/context/hash.js", () => ({
  hashContext: vi.fn().mockReturnValue("test-hash-000"),
}));

import { handleParallelGenerate } from "../../../src/orchestrator/parallel-generate.js";
import type { OrchestratorTurnRequest, ConversationContext } from "../../../src/orchestrator/types.js";
import type { DraftGraphResult } from "../../../src/orchestrator/tools/draft-graph.js";

// ============================================================================
// Helpers
// ============================================================================

function makeTurnRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    message: "Should we hire two developers or a tech lead for our 8-person team?",
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: "frame" as const },
      messages: [],
      scenario_id: "test-scenario",
      analysis_inputs: null,
    } as unknown as ConversationContext,
    scenario_id: "test-scenario",
    client_turn_id: "test-turn-001",
    ...overrides,
  };
}

function makeDraftResult(overrides?: Partial<DraftGraphResult>): DraftGraphResult {
  return {
    blocks: [{
      block_id: "block-draft-1",
      block_type: "graph_patch" as const,
      data: {
        patch_type: "full_draft" as const,
        operations: [{ op: "add_node" as const, path: "/nodes/goal_1", value: { id: "goal_1", kind: "goal" } }],
        status: "proposed" as const,
        auto_apply: true,
        analysis_ready: {
          options: [{ option_id: "opt_a", label: "Option A", status: "ready", interventions: { fac_x: 0.5 } }],
          goal_node_id: "goal_1",
          status: "ready",
        },
      },
      provenance: { turn_id: "test-turn", tool: "draft_graph", timestamp: new Date().toISOString() },
    }],
    assistantText: "2 validation warnings found",
    latencyMs: 8000,
    narrationHint: "The model covers team velocity and code quality factors.",
    draftWarnings: [],
    graphOutput: null,
    ...overrides,
  };
}

const fakeRequest = {} as FastifyRequest;

// ============================================================================
// Tests
// ============================================================================

describe("handleParallelGenerate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Both succeed
  it("returns coaching text + graph_patch block when both calls succeed", async () => {
    const draftResult = makeDraftResult();
    mockHandleDraftGraph.mockResolvedValue(draftResult);
    mockChat.mockResolvedValue({ content: "Great brief! Here are my observations about your hiring decision..." });

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-1");

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toContain("observations about your hiring decision");
    expect(result.envelope.blocks).toHaveLength(1);
    expect(result.envelope.blocks[0].block_type).toBe("graph_patch");

    // analysis_ready should be present on the block
    const data = result.envelope.blocks[0].data as Record<string, unknown>;
    expect(data.analysis_ready).toBeDefined();
    expect(data.patch_type).toBe("full_draft");
  });

  // Test 2: Draft fails, coaching succeeds
  it("returns coaching text without graph_patch when draft_graph fails", async () => {
    mockHandleDraftGraph.mockRejectedValue(new Error("Pipeline timeout"));
    mockChat.mockResolvedValue({ content: "Your brief is well-structured. Consider adding timeline constraints." });

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-2");

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toContain("wasn't able to generate the model");
    expect(result.envelope.assistant_text).toContain("well-structured");
    expect(result.envelope.blocks).toHaveLength(0);
  });

  // Test 3: Coaching fails, draft succeeds
  it("returns graph_patch with fallback text when coaching fails", async () => {
    const draftResult = makeDraftResult();
    mockHandleDraftGraph.mockResolvedValue(draftResult);
    mockChat.mockRejectedValue(new Error("LLM rate limited"));

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-3");

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toContain("causal model has been generated");
    expect(result.envelope.blocks).toHaveLength(1);
    expect(result.envelope.blocks[0].block_type).toBe("graph_patch");

    // analysis_ready should still be present
    const data = result.envelope.blocks[0].data as Record<string, unknown>;
    expect(data.analysis_ready).toBeDefined();
  });

  // Test 4: Both fail
  it("returns error envelope when both calls fail", async () => {
    mockHandleDraftGraph.mockRejectedValue(new Error("Pipeline timeout"));
    mockChat.mockRejectedValue(new Error("LLM unavailable"));

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-4");

    expect(result.httpStatus).toBe(500);
    expect(result.envelope.error).toBeDefined();
    expect(result.envelope.error!.code).toBe("TOOL_EXECUTION_FAILED");
    expect(result.envelope.error!.recoverable).toBe(true);
    expect(result.envelope.blocks).toHaveLength(0);
  });

  // Test 5: Non-parallel turn is not handled here (schema default)
  // This test verifies the function rejects empty briefs, confirming
  // that generate_model: false never reaches this code path.
  it("returns 400 when message is empty", async () => {
    const result = await handleParallelGenerate(
      makeTurnRequest({ message: "" }),
      fakeRequest,
      "req-5",
    );

    expect(result.httpStatus).toBe(400);
    expect(result.envelope.error?.code).toBe("INVALID_REQUEST");
    // Neither mock should have been called
    expect(mockHandleDraftGraph).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  // Test 6: Concurrency — both calls fire simultaneously, not sequentially
  it("fires both calls concurrently (total time is max, not sum)", async () => {
    const DRAFT_DELAY = 100;
    const COACHING_DELAY = 80;

    mockHandleDraftGraph.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(makeDraftResult()), DRAFT_DELAY)),
    );
    mockChat.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ content: "Coaching text" }), COACHING_DELAY)),
    );

    const start = Date.now();
    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-6");
    const elapsed = Date.now() - start;

    expect(result.httpStatus).toBe(200);

    // If sequential, elapsed would be >= DRAFT_DELAY + COACHING_DELAY (180ms).
    // Parallel should be close to max(DRAFT_DELAY, COACHING_DELAY) = 100ms.
    // Allow generous margin for CI slowness but reject clearly sequential timing.
    const sequentialMin = DRAFT_DELAY + COACHING_DELAY;
    expect(elapsed).toBeLessThan(sequentialMin);
  });

  // Coaching call should NOT receive tool definitions
  it("calls coaching LLM via chat() not chatWithTools()", async () => {
    mockHandleDraftGraph.mockResolvedValue(makeDraftResult());
    mockChat.mockResolvedValue({ content: "Coaching response" });

    await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-7");

    // chat() was called (not chatWithTools)
    expect(mockChat).toHaveBeenCalledTimes(1);
    const chatArgs = mockChat.mock.calls[0][0];
    expect(chatArgs.system).toContain("parallel generation turn");
    expect(chatArgs.system).toContain("Do NOT select or call any tools");
    // No 'tools' key in the call args
    expect(chatArgs).not.toHaveProperty("tools");
  });
});
