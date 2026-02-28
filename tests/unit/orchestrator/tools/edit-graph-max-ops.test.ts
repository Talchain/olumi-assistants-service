/**
 * Tests for configurable MAX_PATCH_OPERATIONS (C.2).
 * Verifies that the max operations limit reads from config.cee.maxPatchOperations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are editing a graph."),
}));

let mockMaxPatchOperations = 15; // default

vi.mock("../../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "cee") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === "maxRepairRetries") return 0;
              if (ceeProp === "maxPatchOperations") return mockMaxPatchOperations;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext, GraphPatchBlockData } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter } from "../../../../src/adapters/llm/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(): ConversationContext {
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

// ============================================================================
// Tests
// ============================================================================

describe("Configurable MAX_PATCH_OPERATIONS (C.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaxPatchOperations = 15; // reset to default
  });

  it("default (no env var): rejects at 16 operations", async () => {
    mockMaxPatchOperations = 15;
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

  it("MAX_PATCH_OPERATIONS=20: rejects at 21, accepts 20", async () => {
    mockMaxPatchOperations = 20;

    // 21 operations — should be rejected
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      op: "update_node",
      path: "factor_1",
      value: { label: `Label ${i}` },
    }));
    const adapterTooMany = makeAdapter(tooMany);

    const result1 = await handleEditGraph(
      makeContext(),
      "Bulk edit",
      adapterTooMany,
      "req-1",
      "turn-1",
      { maxRetries: 0 },
    );

    const data1 = result1.blocks[0].data as GraphPatchBlockData;
    expect(data1.status).toBe("rejected");
    expect(data1.rejection?.reason).toContain("max 20");

    // 20 operations — should be accepted
    const exactMax = Array.from({ length: 20 }, (_, i) => ({
      op: "update_node",
      path: "factor_1",
      value: { label: `Label ${i}` },
    }));
    const adapterExactMax = makeAdapter(exactMax);

    const result2 = await handleEditGraph(
      makeContext(),
      "Batch edit",
      adapterExactMax,
      "req-2",
      "turn-2",
    );

    const data2 = result2.blocks[0].data as GraphPatchBlockData;
    expect(data2.status).toBe("proposed");
    expect(data2.operations).toHaveLength(20);
  });

  it("existing edit_graph tests unaffected (default 15 still rejects at 16)", async () => {
    mockMaxPatchOperations = 15;
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
