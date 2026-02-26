/**
 * draft_graph Tool Handler Tests
 *
 * Tests for handleDraftGraph():
 * - Success: pipeline → graph_patch block with add_node/add_edge ops
 * - Warnings: validation_warnings surfaced in assistant_text
 * - Pipeline throw: OrchestratorError with TOOL_EXECUTION_FAILED
 * - Pipeline non-200: OrchestratorError with message + recoverable flag
 * - Empty graph: zero operations, no error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — vi.hoisted() ensures these are available to hoisted vi.mock factories
// ============================================================================

const { mockRunUnifiedPipeline } = vi.hoisted(() => ({
  mockRunUnifiedPipeline: vi.fn(),
}));

vi.mock("../../../../src/cee/unified-pipeline/index.js", () => ({
  runUnifiedPipeline: mockRunUnifiedPipeline,
}));

import { handleDraftGraph } from "../../../../src/orchestrator/tools/draft-graph.js";
import type { GraphPatchBlockData, OrchestratorError } from "../../../../src/orchestrator/types.js";
import type { FastifyRequest } from "fastify";

// ============================================================================
// Helpers
// ============================================================================

const mockRequest = {} as FastifyRequest;

function makePipelineSuccess(graph: Record<string, unknown>, extras?: Record<string, unknown>) {
  return {
    statusCode: 200,
    body: {
      graph,
      ...extras,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("handleDraftGraph", () => {
  beforeEach(() => {
    mockRunUnifiedPipeline.mockReset();
  });

  it("returns graph_patch block with add_node + add_edge ops on success", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "opt_1", kind: "option", label: "Raise Prices" },
          { id: "fac_1", kind: "factor", label: "Price Sensitivity" },
        ],
        edges: [
          { from: "goal_1", to: "opt_1", strength_mean: 1, strength_std: 0.01 },
          { from: "opt_1", to: "fac_1", strength_mean: 0.6, strength_std: 0.15 },
        ],
      }),
    );

    const result = await handleDraftGraph(
      "Should I raise prices to increase revenue?",
      mockRequest,
      "turn-1",
    );

    // Pipeline called with correct brief
    expect(mockRunUnifiedPipeline).toHaveBeenCalledOnce();
    const [pipeInput, pipeBody, , pipeOpts] = mockRunUnifiedPipeline.mock.calls[0];
    expect(pipeInput).toEqual({ brief: "Should I raise prices to increase revenue?" });
    expect(pipeBody).toEqual({ brief: "Should I raise prices to increase revenue?" });
    expect(pipeOpts).toEqual({ schemaVersion: "v3" });

    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0];
    expect(block.block_type).toBe("graph_patch");

    const data = block.data as GraphPatchBlockData;
    expect(data.patch_type).toBe("full_draft");
    expect(data.status).toBe("proposed");

    // 3 add_node + 2 add_edge = 5 operations
    expect(data.operations).toHaveLength(5);

    const addNodeOps = data.operations.filter(o => o.op === "add_node");
    const addEdgeOps = data.operations.filter(o => o.op === "add_edge");
    expect(addNodeOps).toHaveLength(3);
    expect(addEdgeOps).toHaveLength(2);

    // Node paths use /nodes/{id}
    expect(addNodeOps[0].path).toBe("/nodes/goal_1");
    // Edge paths use /edges/{from}->{to}
    expect(addEdgeOps[0].path).toBe("/edges/goal_1->opt_1");

    // No assistant text when no warnings
    expect(result.assistantText).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("surfaces validation_warnings in assistant_text", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess(
        { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        { validation_warnings: ["Missing factors", "Low edge coverage"] },
      ),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-2");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toEqual(["Missing factors", "Low edge coverage"]);
    expect(result.assistantText).toContain("2 validation warnings");
    expect(result.assistantText).toContain("Missing factors");
    expect(result.assistantText).toContain("Low edge coverage");
  });

  it("handles empty graph (no nodes, no edges)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({ nodes: [], edges: [] }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-3");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.operations).toHaveLength(0);
    expect(data.status).toBe("proposed");
  });

  it("throws OrchestratorError when pipeline throws", async () => {
    mockRunUnifiedPipeline.mockRejectedValueOnce(new Error("LLM timeout"));

    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-4");
      expect.unreachable("should have thrown");
    } catch (err) {
      const orchestratorError = (err as { orchestratorError: OrchestratorError }).orchestratorError;
      expect(orchestratorError).toBeDefined();
      expect(orchestratorError.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchestratorError.tool).toBe("draft_graph");
      expect(orchestratorError.recoverable).toBe(true);
      expect(orchestratorError.message).toContain("LLM timeout");
    }
  });

  it("throws OrchestratorError on pipeline non-200 (4xx → not recoverable)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 422,
      body: { error: "Brief too short" },
    });

    try {
      await handleDraftGraph("x", mockRequest, "turn-5");
      expect.unreachable("should have thrown");
    } catch (err) {
      const orchestratorError = (err as { orchestratorError: OrchestratorError }).orchestratorError;
      expect(orchestratorError).toBeDefined();
      expect(orchestratorError.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchestratorError.recoverable).toBe(false);
      expect(orchestratorError.message).toContain("Brief too short");
    }
  });

  it("throws OrchestratorError on pipeline non-200 (5xx → recoverable)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 500,
      body: { error: "Internal server error" },
    });

    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-6");
      expect.unreachable("should have thrown");
    } catch (err) {
      const orchestratorError = (err as { orchestratorError: OrchestratorError }).orchestratorError;
      expect(orchestratorError).toBeDefined();
      expect(orchestratorError.recoverable).toBe(true);
      expect(orchestratorError.suggested_retry).toBeDefined();
    }
  });

  it("block provenance references the turn ID", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        nodes: [{ id: "g", kind: "goal", label: "G" }],
        edges: [],
      }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-7");

    const block = result.blocks[0];
    expect(block.provenance.turn_id).toBe("turn-7");
    expect(block.provenance.trigger).toBe("tool:draft_graph");
  });

  it("extracts warnings from debug.warnings path", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        debug: { warnings: ["Unusual brief pattern"] },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-8");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toContain("Unusual brief pattern");
  });
});
