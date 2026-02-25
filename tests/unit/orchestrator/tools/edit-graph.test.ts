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

  it("proceeds without PLoT when plotClient is null", async () => {
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
  });

  it("proceeds with CEE-validated ops when PLoT call throws", async () => {
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
      { plotClient },
    );

    // Should still succeed — PLoT failure is non-fatal
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe("proposed");
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
});
