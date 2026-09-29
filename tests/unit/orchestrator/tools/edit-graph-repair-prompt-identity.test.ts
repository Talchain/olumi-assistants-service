/**
 * Repair-attempt prompt attribution for the edit lane.
 *
 * THE DEFECT (self-documented at `edit-graph.ts`, the `servedPromptHash`
 * declaration): prompt identity was captured ONCE, from the INITIAL
 * `edit_graph` resolution, before the repair-attempt loop. `repairAttempts`
 * and `lastStopReason` update PER ATTEMPT, and repair attempts are served by
 * the `repair_edit_graph` prompt — so on `repair_attempts > 0` the trace
 * paired the INITIAL call's prompt identity with the LAST attempt's stop
 * reason, and dropped the attempt count entirely.
 *
 * That is the one case in the attribution surface that reports something
 * FALSE rather than merely omitting: a reader debugging a bad edit would
 * attribute the outcome to `edit_graph` and go and change the wrong prompt.
 *
 * WHAT THESE TESTS PROVE — the PRODUCER, not the builder. The trace builder's
 * side of this lives in `orchestrator-v5/diagnostics/__tests__/
 * v5-diagnostic-trace.test.ts` ("CLEAN vs MIXED edit records"). A
 * builder-only test would ratify a producer that never captures the repair
 * identity at all (the wiring note at the top of that file exists because
 * exactly that happened once). These cases drive `handleEditGraph` and read
 * the R7 diagnostics it actually returns.
 *
 * BINDING: the two prompts are mocked to DIFFERENT hashes and the assertions
 * name which hash belongs to which slot. A fix that copied the edit prompt's
 * hash into the repair slot — the very untruth being removed — passes a
 * "both fields are populated" test and fails these.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.mock` factories are hoisted above every top-level binding, so the
// fixture constants have to be hoisted with them.
const { EDIT_PROMPT_HASH, REPAIR_PROMPT_HASH, SNAPSHOTS } = vi.hoisted(() => {
  const editHash = "a".repeat(64);
  const repairHash = "b".repeat(64);
  return {
    EDIT_PROMPT_HASH: editHash,
    REPAIR_PROMPT_HASH: repairHash,
    SNAPSHOTS: {
      edit_graph: {
        content: "EDIT PROMPT BYTES",
        meta: {
          taskId: "edit_graph",
          source: "default",
          prompt_version: "edit_graph_default@v12",
          prompt_hash: editHash,
        },
      },
      repair_edit_graph: {
        content: "REPAIR PROMPT BYTES",
        meta: {
          taskId: "repair_edit_graph",
          source: "store",
          prompt_version: "repair_edit_graph_store@v4",
          prompt_hash: repairHash,
        },
      },
    } as Record<string, { content: string; meta: Record<string, unknown> }>,
  };
});

// Operation-aware loader mock. The production code resolves BOTH prompts
// through `getSystemPromptSnapshot`, which binds content to meta in one
// resolution; the mock must model that binding rather than let the two drift
// independently, or the test would tolerate the unbound read it exists to
// forbid.
//
// `importOriginal`-spread, not a bare factory: a factory REPLACES the module,
// and `adapters/llm/anthropic.ts` also imports `invalidatePromptCache` from
// here — a hand-listed mock strands it and the suite dies at collect (trap 12).
vi.mock("../../../../src/adapters/llm/prompt-loader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/adapters/llm/prompt-loader.js")>();
  return {
    ...original,
    getSystemPrompt: vi.fn(async (operation: string) => SNAPSHOTS[operation]?.content ?? "unknown prompt"),
    getSystemPromptMeta: vi.fn((operation: string) => SNAPSHOTS[operation]?.meta ?? { source: "default", prompt_version: "v0" }),
    getSystemPromptSnapshot: vi.fn(async (operation: string) => {
      const snap = SNAPSHOTS[operation];
      if (!snap) throw new Error(`Unknown LLM operation: ${operation}. No prompt mapping defined.`);
      return snap;
    }),
  };
});

// One repair retry => two total attempts.
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

import { handleEditGraph } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";
import type { LLMAdapter } from "../../../../src/adapters/llm/types.js";

function makeContext(): ConversationContext {
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
    conversational_state: {
      active_entities: [],
      stated_constraints: [],
      current_topic: "framing",
      last_failed_action: null,
    },
    scenario_id: "test-scenario",
  } as unknown as ConversationContext;
}

const VALID_RESPONSE = JSON.stringify({
  operations: [
    { op: "update_node", path: "/nodes/factor_1/label", value: "Unit Price", impact: "low", rationale: "Rename" },
  ],
  removed_edges: [],
  warnings: [],
  coaching: { summary: "Renamed factor.", rerun_recommended: false },
});

function makeAdapter(chat: ReturnType<typeof vi.fn>): LLMAdapter {
  return {
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
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("edit_graph repair-attempt prompt attribution", () => {
  it("a CLEAN edit (first attempt succeeds) captures the edit identity and NO repair identity", async () => {
    const chat = vi.fn().mockResolvedValue({ content: VALID_RESPONSE, model: "claude-sonnet-4-6" });

    const result = await handleEditGraph(makeContext(), "Rename the price factor", makeAdapter(chat), "req-clean", "turn-clean");

    expect(chat).toHaveBeenCalledTimes(1);
    const diag = result.diagnostics!;
    expect(diag.repair_attempts).toBe(0);
    expect(diag.prompt_hash).toBe(EDIT_PROMPT_HASH);
    // The half that forbids an unconditional repair entry. Without this case a
    // producer that always stamped the repair prompt would satisfy the mixed
    // case below and silently mark every clean edit as repaired.
    expect(diag.repair_prompt_hash).toBeUndefined();
    expect(diag.repair_prompt_version).toBeUndefined();
    expect(diag.repair_prompt_source).toBeUndefined();
  });

  it("a REPAIRED edit captures the repair prompt's OWN identity alongside the edit prompt's", async () => {
    const chat = vi.fn()
      // Attempt 1: prose, not JSON — parse failure, drives the repair loop.
      .mockResolvedValueOnce({ content: "Sorry, I can't express that as JSON.", model: "claude-sonnet-4-6" })
      // Attempt 2: served by `repair_edit_graph`, succeeds.
      .mockResolvedValueOnce({ content: VALID_RESPONSE, model: "claude-sonnet-4-6" });

    const result = await handleEditGraph(makeContext(), "Rename the price factor", makeAdapter(chat), "req-mixed", "turn-mixed");

    expect(chat).toHaveBeenCalledTimes(2);
    const diag = result.diagnostics!;
    expect(diag.repair_attempts).toBe(1);
    // Both slots present AND distinct. `toBe(REPAIR_PROMPT_HASH)` is the
    // load-bearing assertion: it fails against a producer that reuses the edit
    // prompt's hash, which is precisely the misattribution being removed.
    expect(diag.prompt_hash).toBe(EDIT_PROMPT_HASH);
    expect(diag.repair_prompt_hash).toBe(REPAIR_PROMPT_HASH);
    expect(diag.repair_prompt_hash).not.toBe(diag.prompt_hash);
    expect(diag.repair_prompt_version).toBe("repair_edit_graph_store@v4");
    expect(diag.repair_prompt_source).toBe("store");
  });

  it("serves the repair attempt the bytes belonging to the identity it reports", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: "Sorry, I can't express that as JSON.", model: "claude-sonnet-4-6" })
      .mockResolvedValueOnce({ content: VALID_RESPONSE, model: "claude-sonnet-4-6" });

    const result = await handleEditGraph(makeContext(), "Rename the price factor", makeAdapter(chat), "req-bound", "turn-bound");

    // BINDING, not merely presence: the reported repair identity is only
    // truthful if the repair CALL was served the bytes from that same
    // resolution. Attempt 2's system prompt must carry the repair bytes and
    // NOT the edit bytes — otherwise the trace would attribute a repair prompt
    // that was never sent, an untruth of the same class as the one being fixed.
    const attempt2 = chat.mock.calls[1]![0] as { systemPrompt?: string; system?: string };
    const systemPrompt = attempt2.systemPrompt ?? attempt2.system ?? "";
    expect(systemPrompt).toContain("REPAIR PROMPT BYTES");
    expect(systemPrompt).not.toContain("EDIT PROMPT BYTES");
    expect(result.diagnostics!.repair_prompt_hash).toBe(REPAIR_PROMPT_HASH);
  });
});
