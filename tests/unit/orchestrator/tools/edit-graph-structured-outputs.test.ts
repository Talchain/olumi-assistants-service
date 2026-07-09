/**
 * Tier A #1 (edit-reliability, 2026-07-09) — FIX 1: structured-output
 * enforcement for edit_graph.
 *
 * Live-reproduced defect (4x, 9 Jul, acceptance-evidence/edit-lane-conversation/):
 * the free-form edit LLM returns PROSE instead of a JSON operations array on
 * ~50% of live attempts. edit_graph had structured outputs (Anthropic
 * grammar enforcement) DISABLED entirely (commit 24ddf9d8f) because
 * operations[].value carries arbitrary patch payloads that cannot be
 * represented as a closed schema — with additionalProperties:false and no
 * declared slot for `value`/`old_value`, the LLM was structurally forbidden
 * from ever emitting them.
 *
 * FIX: apply Lane 26's (PR #367) verified v8 stringified-aux-field trick —
 * declare `value`/`old_value` as `{ type: "string" }` JSON-encoded fields.
 * The grammar can now enforce the FULL envelope shape (eliminating the
 * prose failure mode structurally, not by out-parsing prose after the
 * fact), while `parseStringifiedOperationPayload()` unwraps the JSON string
 * back into its real shape before Zod/PLoT ever see it.
 *
 * RED (pre-fix): `editGraphOutputSchema` was hardcoded to `undefined` —
 * `adapter.chat` never received `outputSchema`, so the model had no
 * grammar-level guarantee against a prose response. These tests fail
 * against the pre-fix code (asserting outputSchema is undefined) and pass
 * post-fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You edit causal decision graphs"),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
}));

let patchPreValidationEnabledForTest = false;
let patchBudgetEnabledForTest = false;

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
  handleEditGraph,
  parseStringifiedOperationPayload,
} from "../../../../src/orchestrator/tools/edit-graph.js";
import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "../../../../src/orchestrator/tools/anthropic-edit-graph-schema.js";
import type { ConversationContext, GraphPatchBlockData } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter, ChatArgs } from "../../../../src/adapters/llm/types.js";

beforeEach(() => {
  patchPreValidationEnabledForTest = false;
  patchBudgetEnabledForTest = false;
});

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

function makeCapturingAdapter(responseContent: string | object): { adapter: LLMAdapter; chat: ReturnType<typeof vi.fn> } {
  const content = typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent);
  const chat = vi.fn().mockResolvedValue({ content });
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

// ============================================================================
// Enforcement wiring — adapter.chat receives the schema + reminder
// ============================================================================

describe("FIX 1: structured-output enforcement wired into the edit_graph LLM call", () => {
  it("passes outputSchema=ANTHROPIC_EDIT_GRAPH_SCHEMA to adapter.chat on the first attempt", async () => {
    const goodResponse = {
      operations: [
        { op: "update_node", path: "/nodes/factor_1/label", value: JSON.stringify("Unit Price"), impact: "low", rationale: "Rename" },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Renamed factor.", rerun_recommended: false },
    };
    const { adapter, chat } = makeCapturingAdapter(goodResponse);

    await handleEditGraph(makeContext(), "Rename the price factor", adapter, "req-1", "turn-1");

    expect(chat).toHaveBeenCalledTimes(1);
    const args = chat.mock.calls[0]![0] as ChatArgs;
    expect(args.outputSchema).toBe(ANTHROPIC_EDIT_GRAPH_SCHEMA);
    expect(typeof args.structuredOutputsUserReminder).toBe("string");
    expect(args.structuredOutputsUserReminder).toContain("JSON-encoded STRINGS");
  });

  it("also passes outputSchema on a repair attempt (same call site)", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: "Sorry, I can't help with that request in JSON form." }) // prose → parse failure
      .mockResolvedValueOnce({
        content: JSON.stringify({
          operations: [{ op: "update_node", path: "/nodes/factor_1/label", value: "Unit Price" }],
          removed_edges: [],
          warnings: [],
          coaching: { summary: "Renamed.", rerun_recommended: false },
        }),
      });
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

    await handleEditGraph(makeContext(), "Rename the price factor", adapter, "req-1", "turn-1");

    expect(chat).toHaveBeenCalledTimes(2);
    for (const call of chat.mock.calls) {
      const args = call[0] as ChatArgs;
      expect(args.outputSchema).toBe(ANTHROPIC_EDIT_GRAPH_SCHEMA);
    }
  });
});

// ============================================================================
// Stringified value/old_value round-trip — the shape the grammar forces
// ============================================================================

describe("FIX 1: stringified value/old_value payloads (v2 schema) resolve to valid operations", () => {
  it("parses a structured-outputs response where add_node's value is a JSON-encoded string", async () => {
    const response = {
      operations: [
        {
          op: "add_node",
          path: "/nodes/fac_competitor",
          // The v2 grammar forces this to be a STRING — the model
          // JSON-encodes the node payload into it.
          value: JSON.stringify({
            id: "fac_competitor",
            kind: "factor",
            label: "Competitor Response",
            category: "external",
          }),
          impact: "moderate",
          rationale: "Adds competitive risk path",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Added a competitor factor.", rerun_recommended: true },
    };
    const { adapter } = makeCapturingAdapter(response);

    const result = await handleEditGraph(makeContext(), "Add a competitor factor", adapter, "req-1", "turn-1");

    expect(result.wasRejected).toBe(false);
    const data = result.blocks[0]!.data as GraphPatchBlockData;
    expect(data.operations).toHaveLength(1);
    const op = data.operations[0]!;
    expect(op.op).toBe("add_node");
    expect(op.value).toEqual({
      id: "fac_competitor",
      kind: "factor",
      label: "Competitor Response",
      category: "external",
    });
  });

  it("parses a bare JSON scalar string for a path-suffixed field update", async () => {
    const response = {
      operations: [
        { op: "update_node", path: "/nodes/factor_1/label", value: JSON.stringify("Unit Price"), old_value: JSON.stringify("Price") },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Renamed.", rerun_recommended: false },
    };
    const { adapter } = makeCapturingAdapter(response);

    const result = await handleEditGraph(makeContext(), "Rename Price to Unit Price", adapter, "req-1", "turn-1");

    expect(result.wasRejected).toBe(false);
    const data = result.blocks[0]!.data as GraphPatchBlockData;
    expect(data.operations[0]!.value).toEqual({ label: "Unit Price" });
  });
});

// ============================================================================
// parseStringifiedOperationPayload — unit coverage
// ============================================================================

describe("parseStringifiedOperationPayload", () => {
  it("parses a JSON-encoded object string into a real object", () => {
    const raw = { op: "add_node", path: "/nodes/x", value: JSON.stringify({ id: "x", kind: "factor", label: "X" }) };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toEqual({ id: "x", kind: "factor", label: "X" });
  });

  it("parses a JSON-encoded scalar string into the real scalar", () => {
    const raw = { op: "update_node", path: "/nodes/x/label", value: JSON.stringify(0.8) };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toBe(0.8);
  });

  it("does NOT re-parse a legitimate string scalar end-value (no double-unwrap)", () => {
    // A single JSON-encoding pass of the string "Unit Price" parses to the
    // plain string "Unit Price" — this must NOT be treated as evidence of
    // double-encoding and re-parsed (that would throw on ordinary text).
    const raw = { op: "update_node", path: "/nodes/x/label", value: JSON.stringify("Unit Price") };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toBe("Unit Price");
  });

  it("leaves a malformed object-looking JSON string untouched (does not crash, does not drop)", () => {
    const raw = { op: "add_node", path: "/nodes/x", value: "{not valid json" };
    const result = parseStringifiedOperationPayload(raw);
    // Left exactly as received — Zod rejects the wrong-shaped string
    // downstream (add_node needs an object) and drives the repair loop,
    // same as today's behaviour for any malformed value.
    expect(result.value).toBe("{not valid json");
  });

  it("leaves a bare (non-JSON) scalar string untouched — the prompt-only path's convention", () => {
    // This is the DOMINANT existing case: on the prompt-only fallback path
    // the LLM emits the real scalar directly (e.g. renaming a label to
    // "New"), never JSON-encoded. `JSON.parse("New")` throws — the field
    // MUST be preserved unchanged, or every ordinary label/value update on
    // the prompt-only path would silently lose its value.
    const raw = { op: "update_node", path: "/nodes/x/label", value: "New", old_value: "Old" };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toBe("New");
    expect(result.old_value).toBe("Old");
  });

  it("leaves an already-object value untouched (prompt-only fallback path)", () => {
    const raw = { op: "add_node", path: "/nodes/x", value: { id: "x", kind: "factor", label: "X" } };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toEqual({ id: "x", kind: "factor", label: "X" });
  });

  it("is a no-op when neither value nor old_value is a string", () => {
    const raw = { op: "remove_node", path: "/nodes/x" };
    const result = parseStringifiedOperationPayload(raw);
    expect(result).toEqual(raw);
  });
});
