import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are editing a graph."),
}));

vi.mock("../../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "cee") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === "maxRepairRetries") return 1;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph, type EditGraphResult } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext, PatchOperation, GraphPatchBlockData } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter } from "../../../../src/adapters/llm/types.js";
import type { PLoTClient } from "../../../../src/orchestrator/plot-client.js";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
      ],
      edges: [
        {
          from: "factor_1",
          to: "goal_1",
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: "positive",
        },
      ],
    } as unknown as ConversationContext["graph"],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: "test",
    model: "test-model",
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
    }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

function makePlotClient(overrides?: Partial<Record<string, unknown>>): PLoTClient {
  return {
    run: vi.fn().mockResolvedValue({}),
    validatePatch: vi.fn().mockResolvedValue({
      verdict: "accepted",
      ...overrides,
    }),
  };
}

const VALID_ADD_NODE_OP = {
  op: "add_node",
  path: "nodes/new_factor",
  value: { id: "new_factor", kind: "factor", label: "Cost" },
};

const VALID_UPDATE_OP = {
  op: "update_node",
  path: "factor_1",
  value: { label: "Updated Price" },
};

// ============================================================================
// Tests
// ============================================================================

describe("handleEditGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // Basic success
  // ------------------------------------------------------------------

  it("returns a GraphPatchBlock on valid operations", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Add a cost factor",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe("graph_patch");
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.patch_type).toBe("edit");
    expect(data.status).toBe("proposed");
    expect(data.operations).toHaveLength(1);
  });

  it("includes base_graph_hash in the block data", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Add a cost factor",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.base_graph_hash).toBeDefined();
    expect(data.base_graph_hash!.length).toBe(16);
  });

  it("returns null assistantText on clean success (no repairs)", async () => {
    const adapter = makeAdapter([VALID_UPDATE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Update price label",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.assistantText).toBeNull();
  });

  it("reports latencyMs", async () => {
    const adapter = makeAdapter([VALID_UPDATE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Update label",
      adapter,
      "req-1",
      "turn-1",
    );

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // ------------------------------------------------------------------
  // No graph
  // ------------------------------------------------------------------

  it("throws TOOL_EXECUTION_FAILED when graph is null", async () => {
    const adapter = makeAdapter([]);

    await expect(
      handleEditGraph(
        makeContext({ graph: null }),
        "Add factor",
        adapter,
        "req-1",
        "turn-1",
      ),
    ).rejects.toThrow("no graph in context");
  });

  // ------------------------------------------------------------------
  // Legacy field sanitisation
  // ------------------------------------------------------------------

  it("removes legacy fields (belief, belief_exists, confidence) from operations", async () => {
    const adapter = makeAdapter([
      {
        op: "add_node",
        path: "nodes/new",
        value: { id: "new", kind: "factor", label: "X", belief: 0.8, confidence: "high" },
      },
    ]);

    const result = await handleEditGraph(
      makeContext(),
      "Add node",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    const value = data.operations[0].value as Record<string, unknown>;
    expect(value.belief).toBeUndefined();
    expect(value.confidence).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Structural validation → rejection
  // ------------------------------------------------------------------

  it("returns rejection block when all attempts produce invalid ops", async () => {
    // Consistently return an op with an unknown op type (will fail Zod)
    const adapter = makeAdapter([{ op: "bad_op", path: "x" }]);

    const result = await handleEditGraph(
      makeContext(),
      "Do something",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection).toBeDefined();
    expect(data.rejection?.code).toBe("STRUCTURAL_VALIDATION_FAILED");
    expect(result.assistantText).toContain("wasn't able");
  });

  it("returns rejection on referential integrity failure (remove non-existent node)", async () => {
    const adapter = makeAdapter([
      { op: "remove_node", path: "ghost_node" },
    ]);

    const result = await handleEditGraph(
      makeContext(),
      "Remove ghost",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.code).toBe("STRUCTURAL_VALIDATION_FAILED");
  });

  // ------------------------------------------------------------------
  // Repair loop
  // ------------------------------------------------------------------

  it("retries on structural failure and succeeds on second attempt", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    // First call: bad ops, second call: good ops
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([{ op: "bad_op", path: "x" }]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_ADD_NODE_OP]) });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  it("includes error details in repair attempt user message", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([{ op: "remove_node", path: "ghost" }]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    await handleEditGraph(
      makeContext(),
      "Fix something",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    const secondCall = chatMock.mock.calls[1];
    const userMessage = secondCall[0].userMessage as string;
    expect(userMessage).toContain("Validation Errors");
    expect(userMessage).toContain("Original Edit Request");
    expect(userMessage).toContain("Fix something");
  });

  // ------------------------------------------------------------------
  // PLoT integration
  // ------------------------------------------------------------------

  it("calls PLoT validatePatch when plotClient is provided", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    expect(plotClient.validatePatch).toHaveBeenCalledOnce();
    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.graph).toBeDefined();
    expect(payload.operations).toBeDefined();
    expect(payload.scenario_id).toBe("test-scenario");
  });

  it("returns rejection when PLoT rejects and no retries left", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({ verdict: "rejected", reason: "Semantic error: self-loop" });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.reason).toContain("Semantic error");
    expect(data.rejection?.code).toBe("PLOT_SEMANTIC_REJECTED");
  });

  it("passes through PLoT rejection code and violations", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "rejected",
      reason: "Cycle detected between nodes",
      code: "CYCLE_DETECTED",
      violations: [
        { code: "CYCLE", path: "factor_1::goal_1", message: "Creates cycle" },
      ],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.rejection?.code).toBe("PLOT_SEMANTIC_REJECTED");
    expect(data.rejection?.plot_code).toBe("CYCLE_DETECTED");
    expect(data.rejection?.plot_violations).toHaveLength(1);
    expect((data.rejection!.plot_violations![0] as Record<string, unknown>).code).toBe("CYCLE");
  });

  it("omits plot_code and plot_violations when PLoT rejects without them", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({ verdict: "rejected", reason: "Bad patch" });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.rejection?.code).toBe("PLOT_SEMANTIC_REJECTED");
    expect(data.rejection?.plot_code).toBeUndefined();
    expect(data.rejection?.plot_violations).toBeUndefined();
  });

  it("retries on PLoT rejection and succeeds on second attempt", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_ADD_NODE_OP]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const plotClient = makePlotClient();
    const validateMock = plotClient.validatePatch as ReturnType<typeof vi.fn>;
    validateMock
      .mockResolvedValueOnce({ verdict: "rejected", reason: "Bad" })
      .mockResolvedValueOnce({ verdict: "accepted" });

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 1 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces repairs_applied in block data when PLoT returns them", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      repairs_applied: [
        { code: "STRENGTH_CLAMPED", message: "Clamped strength to [-1,1]" },
      ],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.repairs_applied).toHaveLength(1);
    expect(data.repairs_applied![0].code).toBe("STRENGTH_CLAMPED");
    // Should narrate repairs in assistant text
    expect(result.assistantText).toContain("PLoT applied 1 repair");
  });

  it("proceeds without PLoT when plotClient is null and adds PLOT_VALIDATION_SKIPPED warning", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient: null },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(data.validation_warnings).toBeDefined();
    expect(data.validation_warnings!.some(w => w.includes("PLOT_VALIDATION_SKIPPED"))).toBe(true);
  });

  it("rejects patch when PLoT is configured but call throws (hard reject)", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn().mockRejectedValue(new Error("PLoT timeout")),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 0 },
    );

    // PLoT configured but failed — must hard reject, not silently pass through
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.reason).toContain("PLoT semantic validation unavailable");
    expect(data.rejection?.code).toBe("PLOT_UNAVAILABLE");
  });

  // ------------------------------------------------------------------
  // LLM parse failures
  // ------------------------------------------------------------------

  it("throws on unparseable LLM response with no retries", async () => {
    const adapter = makeAdapter("not json at all");
    // Override mock to return raw string
    (adapter.chat as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "not json at all" });

    await expect(
      handleEditGraph(
        makeContext(),
        "Edit",
        adapter,
        "req-1",
        "turn-1",
        { maxRetries: 0 },
      ),
    ).rejects.toThrow("No JSON array found");
  });

  it("retries on parse failure and succeeds on second attempt", async () => {
    const chatMock = vi.fn()
      .mockResolvedValueOnce({ content: "garbage response" })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const adapter = { chat: chatMock } as unknown as LLMAdapter;

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  // ------------------------------------------------------------------
  // LLM call failures
  // ------------------------------------------------------------------

  it("throws on LLM error with no retries", async () => {
    const chatMock = vi.fn().mockRejectedValue(new Error("LLM timeout"));
    const adapter = { chat: chatMock } as unknown as LLMAdapter;

    await expect(
      handleEditGraph(
        makeContext(),
        "Edit",
        adapter,
        "req-1",
        "turn-1",
        { maxRetries: 0 },
      ),
    ).rejects.toThrow("LLM timeout");
  });

  it("retries on LLM error and succeeds on second attempt", async () => {
    const chatMock = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const adapter = { chat: chatMock } as unknown as LLMAdapter;

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 1 },
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: canonical convergence fields
  // ------------------------------------------------------------------

  it("populates applied_graph and applied_graph_hash from PLoT response", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const appliedGraph = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
        { id: "new_factor", kind: "factor", label: "Cost" },
      ],
      edges: [
        { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
      ],
    };
    const plotClient = makePlotClient({
      verdict: "accepted",
      applied_graph: appliedGraph,
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph).toEqual(appliedGraph);
    expect(data.applied_graph_hash).toBeDefined();
    expect(data.applied_graph_hash!.length).toBe(16);
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: base_graph_hash in PLoT payload
  // ------------------------------------------------------------------

  it("sends base_graph_hash in PLoT validate-patch payload", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.base_graph_hash).toBeDefined();
    expect(payload.base_graph_hash.length).toBe(16);
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: no silent operation rewrite
  // ------------------------------------------------------------------

  it("does NOT rewrite operations from PLoT response (no silent semantics)", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const differentOps = [{ op: "update_node", path: "factor_1", value: { label: "PLoT-modified" } }];
    const plotClient = makePlotClient({
      verdict: "accepted",
      // PLoT returns different operations — these must NOT overwrite the original
      operations: differentOps,
      repairs_applied: [{ code: "LABEL_FIXED", message: "Fixed label" }],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    // Operations should be the original CEE-validated ones, not PLoT's rewritten version
    expect(data.operations[0].op).toBe("add_node");
    expect(data.operations[0].path).toBe("nodes/new_factor");
    // Repairs should be surfaced as repairs_applied, not merged into operations
    expect(data.repairs_applied).toHaveLength(1);
    expect(data.repairs_applied![0].code).toBe("LABEL_FIXED");
  });

  // ------------------------------------------------------------------
  // Acceptance criteria: PLoT failure retries before hard reject
  // ------------------------------------------------------------------

  it("retries on PLoT failure and succeeds when PLoT recovers", async () => {
    const adapter = makeAdapter([]);
    const chatMock = adapter.chat as ReturnType<typeof vi.fn>;
    chatMock
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_ADD_NODE_OP]) })
      .mockResolvedValueOnce({ content: JSON.stringify([VALID_UPDATE_OP]) });

    const plotClient: PLoTClient = {
      run: vi.fn(),
      validatePatch: vi.fn()
        .mockRejectedValueOnce(new Error("PLoT transient failure"))
        .mockResolvedValueOnce({ verdict: "accepted" }),
    };

    const result = await handleEditGraph(
      makeContext(),
      "Edit",
      adapter,
      "req-1",
      "turn-1",
      { plotClient, maxRetries: 1 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  // ------------------------------------------------------------------
  // Addendum: old_value → previous mapping for PLoT
  // ------------------------------------------------------------------

  it("maps old_value to previous in PLoT payload", async () => {
    const opWithOldValue = {
      op: "update_node",
      path: "factor_1",
      value: { label: "New Label" },
      old_value: { label: "Old Label" },
    };
    const adapter = makeAdapter([opWithOldValue]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Update label",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    const plotOp = payload.operations[0];
    expect(plotOp.previous).toEqual({ label: "Old Label" });
    expect(plotOp.old_value).toBeUndefined();
  });

  it("omits previous from PLoT payload when old_value is not set", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient();

    await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const [payload] = (plotClient.validatePatch as ReturnType<typeof vi.fn>).mock.calls[0];
    const plotOp = payload.operations[0];
    expect(plotOp.previous).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Addendum: PLoT graph_hash consumed
  // ------------------------------------------------------------------

  it("uses PLoT graph_hash when returned instead of local computation", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      applied_graph: { nodes: [], edges: [] },
      graph_hash: "plot_canonical_hash",
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph_hash).toBe("plot_canonical_hash");
  });

  it("falls back to local hash when PLoT omits graph_hash", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const appliedGraph = { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] };
    const plotClient = makePlotClient({
      verdict: "accepted",
      applied_graph: appliedGraph,
      // No graph_hash field
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph_hash).toBeDefined();
    expect(data.applied_graph_hash!.length).toBe(16); // SHA-256 hex truncated to 16
  });

  // ------------------------------------------------------------------
  // Addendum: PLoT warnings surfaced
  // ------------------------------------------------------------------

  it("surfaces PLoT warnings in validation_warnings", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      warnings: [
        { code: "STRENGTH_CLAMPED", message: "Clamped strength_mean to [-1,1]", field_path: "edges[0].strength_mean" },
      ],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toBeDefined();
    expect(data.validation_warnings!.some(w => w.includes("Clamped strength_mean"))).toBe(true);
  });

  it("handles PLoT string warnings", async () => {
    const adapter = makeAdapter([VALID_ADD_NODE_OP]);
    const plotClient = makePlotClient({
      verdict: "accepted",
      warnings: ["Edge has low confidence"],
    });

    const result = await handleEditGraph(
      makeContext(),
      "Add factor",
      adapter,
      "req-1",
      "turn-1",
      { plotClient },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toContain("Edge has low confidence");
  });

  // ------------------------------------------------------------------
  // Addendum: MAX_PATCH_OPERATIONS cap
  // ------------------------------------------------------------------

  it("rejects patch with more than 15 operations", async () => {
    const ops = Array.from({ length: 16 }, (_, i) => ({
      op: "update_node",
      path: "factor_1",
      value: { label: `Label ${i}` },
    }));
    const adapter = makeAdapter(ops);

    const result = await handleEditGraph(
      makeContext(),
      "Bulk edit",
      adapter,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("rejected");
    expect(data.rejection?.reason).toContain("max 15");
    expect(data.rejection?.code).toBe("MAX_OPERATIONS_EXCEEDED");
  });

  it("accepts patch with exactly 15 operations", async () => {
    // 15 update_node ops targeting factor_1 (all valid against the graph)
    const ops = Array.from({ length: 15 }, (_, i) => ({
      op: "update_node",
      path: "factor_1",
      value: { label: `Label ${i}` },
    }));
    const adapter = makeAdapter(ops);

    const result = await handleEditGraph(
      makeContext(),
      "Batch edit",
      adapter,
      "req-1",
      "turn-1",
    );

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
    expect(data.operations).toHaveLength(15);
  });
});
