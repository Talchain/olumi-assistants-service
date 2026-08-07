/**
 * Lane CEE-D (edit-loop reliability) — RED fixtures from the live LLM-path
 * failures two nights ago (Lane-3 Mission-D investigation), then GREEN.
 *
 * Defect cluster A — edit_graph response parsing:
 *
 *  A1. `extractJson` does greedy `/\{[\s\S]*\}/` object extraction with an
 *      UNGUARDED `JSON.parse` BEFORE the array fallback. A prose-wrapped
 *      legacy-array response with 2+ operations mis-extracts
 *      `{op1}, {op2}` (first `{` → last `}`), throws SyntaxError, and the
 *      array branch is never reached.
 *  A2. The same greedy extraction on a prose-wrapped SINGLE-operation
 *      legacy array successfully parses the first operation object, which
 *      then fails with the live error
 *      `v2 response missing required "operations" array`.
 *  A3. A bare single-operation object (no array, no envelope) fails with
 *      the same live error instead of being wrapped into
 *      `operations: [op]`.
 *  A4. `PatchOperationSchema` requires `value` for add/update ops but
 *      `normaliseOperation` never lifts inline / alternate-key payloads
 *      into `value` → live zod error `value — Required`.
 *  A5. The repair prompt embeds previous ops as a BARE ARRAY while the
 *      repair prompt mandates a `{ "operations": [...] }` object, and
 *      resets `lastRawOps` to `[]` on parse failures — priming repeat
 *      failures.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let patchPreValidationEnabledForTest = false;
let patchBudgetEnabledForTest = false;

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You edit causal decision graphs"),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
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
              if (ceeProp === "patchPreValidationEnabled") return patchPreValidationEnabledForTest;
              if (ceeProp === "patchBudgetEnabled") return patchBudgetEnabledForTest;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import {
  parseEditGraphResponse,
  handleEditGraph,
} from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter } from "../../../../src/adapters/llm/types.js";

beforeEach(() => {
  patchPreValidationEnabledForTest = false;
  patchBudgetEnabledForTest = false;
});

// ============================================================================
// Helpers (mirrors edit-graph-v2.test.ts)
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
        { id: "out_1", kind: "outcome", label: "Sales" },
      ],
      edges: [
        {
          from: "factor_1",
          to: "out_1",
          strength_mean: 0.5,
          strength_std: 0.1,
          exists_probability: 0.9,
          effect_direction: "positive",
        },
      ],
    } as unknown as ConversationContext["graph"],
    analysis_response: null,
    framing: null,
    messages: [],
    conversational_state: { active_entities: [], stated_constraints: [], current_topic: "framing", last_failed_action: null },
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeSequencedAdapter(contents: string[]): { adapter: LLMAdapter; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn();
  for (const content of contents) {
    chat.mockResolvedValueOnce({ content });
  }
  const adapter = {
    name: "test",
    model: "test-model",
    chat,
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
  return { adapter, chat };
}

const SINGLE_OP = {
  op: "update_node",
  path: "/nodes/factor_1/label",
  value: "Unit Price",
  old_value: "Price",
  impact: "low",
  rationale: "Rename for clarity",
};

const SECOND_OP = {
  op: "update_edge",
  path: "/edges/factor_1->out_1/strength.mean",
  value: 0.6,
  old_value: 0.5,
  impact: "low",
  rationale: "Stronger effect",
};

// ============================================================================
// A1 — prose-wrapped multi-op legacy array
// ============================================================================

describe("A1: prose-wrapped legacy array (multi-op)", () => {
  it("parses a legacy array wrapped in prose instead of throwing from the greedy object extraction", () => {
    const prose = [
      "Here are the operations to apply:",
      JSON.stringify([SINGLE_OP, SECOND_OP], null, 2),
      "Let me know if you need anything else.",
    ].join("\n");

    const result = parseEditGraphResponse(prose);
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]!.op).toBe("update_node");
    expect(result.operations[1]!.op).toBe("update_edge");
  });
});

// ============================================================================
// A2 — prose-wrapped single-op legacy array (live error:
//      'v2 response missing required "operations" array')
// ============================================================================

describe("A2: prose-wrapped legacy array (single op) — live 'missing operations array' repro", () => {
  it("recovers the single operation instead of failing with 'missing required \"operations\" array'", () => {
    const prose = [
      "I'll update the price factor as requested.",
      JSON.stringify([SINGLE_OP], null, 2),
      "This keeps the rest of the model unchanged.",
    ].join("\n");

    const result = parseEditGraphResponse(prose);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.op).toBe("update_node");
    // Field-level path is normalised and the scalar is wrapped for update ops.
    expect(result.operations[0]!.path).toBe("factor_1");
    expect(result.operations[0]!.value).toEqual({ label: "Unit Price" });
  });
});

// ============================================================================
// A3 — bare single-operation object
// ============================================================================

describe("A3: bare single-operation object", () => {
  it("wraps a bare single-op object into operations:[op]", () => {
    const result = parseEditGraphResponse(JSON.stringify(SINGLE_OP));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.op).toBe("update_node");
    expect(result.operations[0]!.value).toEqual({ label: "Unit Price" });
    // Safe coaching defaults (same contract as the legacy-array branch).
    expect(result.coaching).not.toBeNull();
    expect(result.coaching!.summary).toBe("Proposed graph edit.");
  });

  it("still rejects an object that is neither an envelope nor a patch operation", () => {
    expect(() => parseEditGraphResponse('{ "warnings": ["bad"] }')).toThrow("missing required");
  });
});

// ============================================================================
// A4 — alternate-key / inline payloads lifted into `value`
//      (live zod error: 'value — Required')
// ============================================================================

describe("A4: alternate-key and inline payloads lifted into value", () => {
  it("lifts a payload under new_value into value for update_node", () => {
    const response = {
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1",
          new_value: { label: "Unit Price" },
          impact: "low",
          rationale: "Rename",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Renamed the factor.", rerun_recommended: false },
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.value).toEqual({ label: "Unit Price" });
  });

  it("lifts an inline top-level payload into value for add_node", () => {
    const response = {
      operations: [
        {
          op: "add_node",
          path: "/nodes/fac_y",
          id: "fac_y",
          kind: "factor",
          label: "Yield",
          category: "external",
          impact: "moderate",
          rationale: "Adds yield factor",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Added a factor.", rerun_recommended: true },
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.value).toEqual({
      id: "fac_y",
      kind: "factor",
      label: "Yield",
      category: "external",
    });
    // impact/rationale stay op-level metadata, not payload.
    expect((result.operations[0] as { impact?: string }).impact).toBe("moderate");
  });

  it("does NOT lift when two alternate keys are present (ambiguous)", () => {
    const response = {
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1",
          new_value: { label: "A" },
          data: { label: "B" },
        },
      ],
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations[0]!.value).toBeUndefined();
  });

  it("leaves ops that legitimately omit value untouched (remove_edge)", () => {
    const response = {
      operations: [
        { op: "remove_edge", path: "/edges/factor_1->out_1", impact: "low", rationale: "Remove" },
      ],
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations[0]!.value).toBeUndefined();
  });
});

// ============================================================================
// A5 — repair message embeds {operations:[...]} and preserves raw ops on
//      parse failure
// ============================================================================

describe("A5: repair prompt embedding", () => {
  it("embeds previous ops as an { operations: [...] } object in the repair message", async () => {
    // Attempt 1: parses fine but fails Zod (update_node without value and
    // no liftable payload) → repair attempt fires.
    const invalid = JSON.stringify({
      operations: [{ op: "update_node", path: "/nodes/factor_1", impact: "low", rationale: "r" }],
    });
    // Attempt 2: clean no-op response so the run terminates successfully.
    const emptyOps = JSON.stringify({
      operations: [],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Which factor should I update?", rerun_recommended: false },
    });
    const { adapter, chat } = makeSequencedAdapter([invalid, emptyOps]);

    await handleEditGraph(makeContext(), "Set Price to 100", adapter, "req-a5", "turn-a5");

    expect(chat).toHaveBeenCalledTimes(2);
    const repairArgs = chat.mock.calls[1]![0] as { userMessage: string };
    expect(repairArgs.userMessage).toContain("## Previous (Invalid) Operations");
    // The embedded block must be the same JSON OBJECT shape the repair
    // prompt mandates for output ({ "operations": [...] }), not a bare array.
    const embedded = repairArgs.userMessage.split("## Previous (Invalid) Operations")[1]!.trim();
    expect(embedded.startsWith("{")).toBe(true);
    const parsedEmbedded = JSON.parse(embedded) as { operations: unknown[] };
    expect(Array.isArray(parsedEmbedded.operations)).toBe(true);
    expect(parsedEmbedded.operations).toHaveLength(1);
  });

  it("preserves the last parsed raw ops across a subsequent parse failure", async () => {
    // Attempt 1: parses but fails Zod (no value) → lastRawOps = [op].
    const invalid = JSON.stringify({
      operations: [{ op: "update_node", path: "/nodes/factor_1", impact: "low", rationale: "r" }],
    });
    // Attempt 2: unparseable garbage → parse failure. lastRawOps must be
    // PRESERVED (not reset to []).
    const garbage = "I could not produce the JSON you asked for.";
    // Attempt 3: clean no-op response so the run terminates successfully.
    const emptyOps = JSON.stringify({
      operations: [],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Which factor should I update?", rerun_recommended: false },
    });
    const { adapter, chat } = makeSequencedAdapter([invalid, garbage, emptyOps]);

    await handleEditGraph(makeContext(), "Set Price to 100", adapter, "req-a5b", "turn-a5b", {
      maxRetries: 2,
    });

    expect(chat).toHaveBeenCalledTimes(3);
    const thirdArgs = chat.mock.calls[2]![0] as { userMessage: string };
    const embedded = thirdArgs.userMessage.split("## Previous (Invalid) Operations")[1]!.trim();
    const parsedEmbedded = JSON.parse(embedded) as { operations: unknown[] };
    // The ops from attempt 1 are still available to the repair prompt —
    // NOT wiped to [] by the attempt-2 parse failure.
    expect(parsedEmbedded.operations).toHaveLength(1);
    expect((parsedEmbedded.operations[0] as { op: string }).op).toBe("update_node");
  });
});
