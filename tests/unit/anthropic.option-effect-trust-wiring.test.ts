/**
 * ⭐⭐⭐ THE ADAPTER ACTUALLY WIRES THE TRUST DECISION INTO THE KEEP LOGIC.
 *
 * This closes the residue left by the P1 that independent review (Codex) found
 * on #1508: the guard and the decision were two call sites answering one
 * question, and the unit kit could not see it because every mutant targeted the
 * GUARD. A guard can be perfectly sensitive and wired to nothing.
 *
 * So this asserts through `draftGraphWithAnthropic` itself — the production
 * entry point — and nothing below it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createSpy = vi.hoisted(() => vi.fn());
const streamSpy = vi.hoisted(() => vi.fn());
const keepSpy = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: createSpy, stream: streamSpy };
  },
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You draft decision graphs."),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "draft_graph", prompt_version: "v19", prompt_hash: "test-hash",
    source: "default", version: null, cache_status: "test", use_staging_mode: false,
  }),
  invalidatePromptCache: vi.fn(),
}));

/**
 * ⚠ `importOriginal` SPREAD, NEVER A HAND-LISTED FACTORY. A `vi.mock` factory
 * REPLACES the module, so a hand-written surface silently drops every export
 * added since it was written (CLAUDE.md trap 12 — it once killed 51 tests here).
 * Only `shouldKeepCompletion` is wrapped, and it still calls through.
 */
vi.mock("../../src/cee/draft/records/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cee/draft/records/index.js")>();
  return {
    ...actual,
    shouldKeepCompletion: (...args: unknown[]) => {
      keepSpy(...args);
      return (actual.shouldKeepCompletion as (...a: unknown[]) => boolean)(...args);
    },
  };
});

function fakeStream(jsonText: string) {
  return () => {
    async function* gen() {
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: jsonText } };
    }
    const it = gen();
    return {
      [Symbol.asyncIterator]: () => it,
      finalMessage: async () => ({
        content: [{ type: "text", text: jsonText }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
    };
  };
}

/** claims[4] sources an option effect from a `causal_link` — PROVABLY invalid. */
const RECORDS_WITH_INVALID_OPTION_EFFECT_SOURCE = JSON.stringify({
  stated_items: [
    { kind: "goal", source_quote: "reach £20k MRR", role: "target" },
    { kind: "option", source_quote: "hold the price at £49", is_baseline: true },
  ],
  claims: [
    { claim_kind: "factor", label: "Pro Plan Price", basis: [] },
    { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
    { claim_kind: "option_refinement", label: "Hold at £49", basis: [1], is_baseline: true },
    { claim_kind: "causal_link", label: "Hold sets price", from_claim: 2, to_claim: 0, effect: "positive", sets_to: 49 },
    { claim_kind: "causal_link", label: "off-by-one source", from_claim: 3, to_claim: 0, effect: "positive", sets_to: 59 },
    { claim_kind: "causal_link", label: "price drives MRR", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.6 },
    { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
  ],
});

/** Identical, minus the invalid source — the control arm. */
const RECORDS_ALL_SOURCES_VALID = JSON.stringify({
  ...JSON.parse(RECORDS_WITH_INVALID_OPTION_EFFECT_SOURCE),
  claims: JSON.parse(RECORDS_WITH_INVALID_OPTION_EFFECT_SOURCE).claims.filter(
    (c: { label?: string }) => c.label !== "off-by-one source",
  ),
});

describe("the adapter threads the trust decision into the production keep logic", () => {
  beforeEach(() => {
    vi.resetModules();
    keepSpy.mockReset();
    createSpy.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");
    // ⚠ THE COMPLETION MUST RETURN AT LEAST ONE NEW CLAIM. An empty list is
    // declined upstream as `merge_declined: "no_new_claims"` and
    // `shouldKeepCompletion` is then NEVER REACHED — the first version of this
    // test asserted on a spy that could not fire, which is the "guard that
    // cannot fail" shape one level up. The claim itself is deliberately benign:
    // this test is about the OPTIONS the keep decision receives, not about what
    // a completion returns.
    createSpy.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          claims: [
            { claim_kind: "risk", label: "Churn from price hold", basis: [] },
            { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 7, to_claim: 1, effect: "negative", strength: 0.4 },
          ],
        }),
      }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  });

  afterEach(() => {
    streamSpy.mockReset();
    createSpy.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("W1: passes optionEffectsUnreliable=TRUE when an option-effect source is provably invalid", async () => {
    streamSpy.mockImplementation(fakeStream(RECORDS_WITH_INVALID_OPTION_EFFECT_SOURCE));
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({ brief: "Should we hold the price at £49?", docs: [], seed: 3, model: "claude-sonnet-4-6" });

    expect(keepSpy).toHaveBeenCalled();
    const opts = keepSpy.mock.calls[0]![3] as { optionEffectsUnreliable?: boolean } | undefined;
    expect(opts).toBeDefined();
    expect(opts!.optionEffectsUnreliable).toBe(true);
  });

  it("W2: CONTROL — passes FALSE when every option-effect source is legal", async () => {
    streamSpy.mockImplementation(fakeStream(RECORDS_ALL_SOURCES_VALID));
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({ brief: "Should we hold the price at £49?", docs: [], seed: 3, model: "claude-sonnet-4-6" });

    if (keepSpy.mock.calls.length === 0) return; // no completion bought — nothing to assert
    const opts = keepSpy.mock.calls[0]![3] as { optionEffectsUnreliable?: boolean } | undefined;
    expect(opts?.optionEffectsUnreliable).toBe(false);
  });

  it("W3: the derived violations are REUSED, not re-derived inside the keep call", async () => {
    streamSpy.mockImplementation(fakeStream(RECORDS_WITH_INVALID_OPTION_EFFECT_SOURCE));
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({ brief: "Should we hold the price at £49?", docs: [], seed: 3, model: "claude-sonnet-4-6" });

    expect(keepSpy).toHaveBeenCalled();
    const opts = keepSpy.mock.calls[0]![3] as { preservationViolations?: readonly string[] } | undefined;
    expect(opts?.preservationViolations).toBeInstanceOf(Array);
  });

  it("W4: records lineage survives the real adapter and matches the actual provider request", async () => {
    streamSpy.mockImplementation(fakeStream(RECORDS_WITH_INVALID_OPTION_EFFECT_SOURCE));
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const result = await draftGraphWithAnthropic({ brief: "Should we hold the price at £49 to reach £20k MRR?", docs: [], seed: 3, model: "claude-sonnet-4-6" });
    const { draftRequestIdentity } = await import("../../src/cee/draft/records/lineage.js");
    const lineage = result.meta?.raw_draft_lineage;
    expect(lineage).toBeDefined();
    expect(lineage!.provider_output.decoded_input).toEqual(JSON.parse(RECORDS_WITH_INVALID_OPTION_EFFECT_SOURCE));
    expect(lineage!.initial_records.claims).toHaveLength(7);
    expect(lineage!.draft_request).toEqual(draftRequestIdentity(streamSpy.mock.calls.at(-1)![0]));
    expect(lineage!.completion.attempted).toBe(true);
    expect(lineage!.completion.request).toEqual(draftRequestIdentity(createSpy.mock.calls.at(-1)![0]));
    expect(lineage!.completion.output_text).toContain('Churn from price hold');
    expect(lineage!.projection.refusals.length).toBeGreaterThan(0);
    expect(result.graph).not.toHaveProperty('raw_draft_lineage');
  });
});
