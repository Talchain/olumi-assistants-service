/**
 * ROADMAP 2.996 — WIRING test: the draft path actually consumes the selector.
 *
 * `json-extractor-document-selection.test.ts` proves the mechanism and
 * `draft-document-acceptance.test.ts` proves the predicate — but both would
 * stay green if `draftGraphWithAnthropic` never passed `acceptDocument`.
 * This file binds the fix to the LIVE call chain: a real captured response
 * body goes in as the model's text, and the graph that comes out of the
 * adapter is asserted.
 *
 * Structured outputs are OFF here, which is the path the defect lives on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(__dirname, "../fixtures/multi-document-draft-2026-08-09");
const capture = (n: number): string => readFileSync(join(FIXTURES, `armD-${n}.txt`), "utf8");

const streamSpy = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn(), stream: streamSpy };
  },
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are an expert at drafting decision graphs."),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "draft_graph",
    prompt_version: "v19",
    prompt_hash: "test-hash",
    source: "default",
    version: null,
    instance_id: undefined,
    cache_age_ms: undefined,
    cache_status: "test",
    use_staging_mode: false,
  }),
  invalidatePromptCache: vi.fn(),
}));

function fakeStream(text: string) {
  return () => {
    async function* gen() {
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
    }
    const iterator = gen();
    return {
      [Symbol.asyncIterator]: () => iterator,
      finalMessage: async () => ({
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        model: "claude-sonnet-4-6",
      }),
    };
  };
}

async function draft(responseText: string) {
  streamSpy.mockImplementation(fakeStream(responseText));
  const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
  return draftGraphWithAnthropic({
    brief: "Should we replace the CRM or invest in training?",
    docs: [],
    seed: 17,
    model: "claude-sonnet-4-6",
  });
}

describe("draftGraphWithAnthropic — multi-document selection is WIRED (2.996)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
  });

  afterEach(() => {
    streamSpy.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns the COMPLETE second document, not the 5-node placeholder (armD-0)", async () => {
    const result = await draft(capture(0));
    // Bound by IDENTITY: the exact node-id set of the SECOND document, derived
    // from the capture. The discarded first document holds a strict subset of
    // five ids, so no other document in this response can satisfy this.
    expect(result.graph.nodes.map((n) => n.id).sort()).toEqual([
      "dec_crm",
      "fac_current_licence_cost",
      "fac_migration_effort",
      "fac_new_crm_spend",
      "fac_team_size",
      "fac_training_investment",
      "fac_vendor_market",
      "goal_crm_value",
      "opt_hybrid",
      "opt_replace",
      "opt_status_quo",
      "opt_train",
      "out_data_quality",
      "out_productivity",
      "risk_adoption",
      "risk_budget_overrun",
      "risk_disruption",
    ]);
    expect(result.graph.edges).toHaveLength(29);
  });

  it("is unchanged for a single-document response (armD-3)", async () => {
    const result = await draft(capture(3));
    expect(result.graph.nodes).toHaveLength(15);
  });
});
