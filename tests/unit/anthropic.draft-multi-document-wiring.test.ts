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

  /**
   * ⭐ THE LIVE PATH IS RECORDS-SHAPED, so the wiring assertion is made with a
   * records-shaped multi-document response. The two historic graph captures
   * remain in `tests/fixtures/` and are still read below — they are a RECORD of
   * what the model emitted on 2026-08-09 and may not be rewritten — but the
   * behaviour they used to pin (adapter returns the complete document) can only
   * be pinned on the shape the adapter now accepts.
   *
   * The response text reproduces the captured PATTERN exactly: a deliberately
   * partial first document, then the model's prose about starting again, then
   * the complete one.
   */
  const PARTIAL_RECORDS = JSON.stringify({
    stated_items: [{ kind: "goal", source_quote: "get more value from the CRM" }],
    claims: [],
  });
  const COMPLETE_RECORDS = JSON.stringify({
    stated_items: [
      { kind: "goal", source_quote: "get more value from the CRM" },
      { kind: "option", source_quote: "replace the CRM" },
      { kind: "option", source_quote: "invest in training" },
    ],
    claims: [
      { claim_kind: "factor", label: "team productivity", basis: [0] },
      { claim_kind: "causal_link", label: "a new CRM lifts productivity", basis: [1], from_stated: 1, to_claim: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "training lifts productivity", basis: [2], from_stated: 2, to_claim: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "productivity drives the goal", basis: [0], from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  });
  const MULTI_DOCUMENT =
    `${PARTIAL_RECORDS}\n\nGiven the complexity here, let me actually build this out ` +
    `properly rather than leaving placeholders.\n\n${COMPLETE_RECORDS}`;

  /**
   * ⭐⭐ KNOWN GAP, PINNED EXACTLY — the multi-document defect is NOT closed on
   * the records path, and this test exists so that fact is a red line in the
   * suite rather than an assumption in someone's head.
   *
   * On the graph path the partial first document was distinguishable because it
   * was structurally INVALID. A partial RECORD SET is not: `{stated_items:[goal],
   * claims:[]}` is a legitimate record set — zero claims is a deliberate, honest
   * answer the grammar is built to permit. The selector's only remaining
   * discrimination comes from the projected graph, and projected graphs do not
   * yet clear the structural validator (acceptance criterion 3), so the predicate
   * rejects BOTH documents and the caller keeps the first.
   *
   * The assertion is written to fail if the gap CLOSES as well as if it widens:
   * whoever fixes the projection's structural yield must come here and re-pin
   * this deliberately.
   */
  it("KNOWN GAP: neither records document is selectable, so the partial one survives", async () => {
    const { isUsableDraftDocument } = await import("../../src/adapters/llm/draft-document-acceptance.js");
    expect(isUsableDraftDocument(JSON.parse(PARTIAL_RECORDS))).toBe(false);
    expect(isUsableDraftDocument(JSON.parse(COMPLETE_RECORDS))).toBe(false);

    const result = await draft(MULTI_DOCUMENT);
    // The goal's DISPLAY label is an authored objective (quality bar §8 A1);
    // the user's verbatim "get more value from the CRM" stays on the node's
    // `provenance.source_quote`, asserted below so this stays bound to the
    // user's words and not only to our rendering of them.
    expect(result.graph.nodes.map((n) => n.label).sort()).toEqual(["Get More Value from the CRM"]);
    expect(
      result.graph.nodes.map(
        (n) => (n.provenance as { source_quote?: string } | undefined)?.source_quote,
      ),
    ).toEqual(["get more value from the CRM"]);
  });

  /**
   * THE POSITIVE CONTROL, without which the assertion above proves nothing: a
   * predicate that answered `false` to everything would satisfy it perfectly.
   * The historic capture's COMPLETE document is a structurally valid graph, and
   * the predicate must still say yes to it — so `false` above is a verdict about
   * those documents, not about a broken predicate.
   */
  it("[control] the predicate still returns TRUE for a structurally valid graph document", async () => {
    const { isUsableDraftDocument } = await import("../../src/adapters/llm/draft-document-acceptance.js");
    const documents = capture(0).match(/\{[\s\S]*?\n\}/g) ?? [];
    expect(documents.length, "capture must yield at least two documents").toBeGreaterThanOrEqual(2);
    const verdicts = documents.map((d) => {
      try { return isUsableDraftDocument(JSON.parse(d)); } catch { return null; }
    });
    expect(verdicts, "the capture's complete document must still score usable").toContain(true);
  });

  it("is unchanged for a single-document response", async () => {
    const result = await draft(COMPLETE_RECORDS);
    expect(result.graph.nodes.map((n) => n.label)).toContain("team productivity");
  });

  /**
   * ⚠ THE HISTORIC CAPTURES, KEPT AND STILL ASSERTED — as evidence of what the
   * retired path emitted, and as the guard on the cutover's own honesty rule.
   * A graph-shaped response is now REFUSED rather than silently accepted; if it
   * were accepted, the old draft path would have re-entered as an undeclared
   * fallback and every provenance claim this mechanism makes would hold only on
   * the runs nobody checked.
   */
  it("REFUSES the historic graph-shaped captures rather than re-admitting the old path", async () => {
    for (const n of [0, 3]) {
      await expect(draft(capture(n))).rejects.toThrow(/draft_records_graph_shaped_response/);
    }
  });
});
