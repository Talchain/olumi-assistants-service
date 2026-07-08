import { describe, it, expect, vi } from "vitest";

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
              if (ceeProp === "patchPreValidationEnabled") return false;
              if (ceeProp === "patchBudgetEnabled") return false;
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

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
      ],
      edges: [
        { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
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
    chat: vi.fn().mockResolvedValue({ content: JSON.stringify(responseJson) }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

const VALID_ADD_NODE_OP = {
  op: "add_node",
  path: "new_factor",
  value: { id: "new_factor", kind: "factor", label: "Cost" },
};

describe("F3 repro — applied edit_graph turn narration", () => {
  it("does NOT rewrite genuine applied-language coaching text into 'Proposing to...' when the graph was actually committed", async () => {
    const v2Response = {
      operations: [VALID_ADD_NODE_OP],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Added the Cost factor to strengthen revenue drivers." },
    };
    const adapter = makeAdapter(v2Response);
    const result = await handleEditGraph(makeContext(), "Add a cost factor", adapter, "req-1", "turn-1");

    const data = result.blocks[0].data as GraphPatchBlockData;
    // Sanity: this branch did actually apply the change.
    expect(data.applied_graph).toBeDefined();

    const text = result.assistantText ?? "";
    expect(text).not.toMatch(/Proposing to add/i);
    expect(text).toMatch(/^Added/i);
  });
});
