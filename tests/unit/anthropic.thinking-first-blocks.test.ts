/**
 * ROADMAP 1.55(a) — thinking-class completion across ALL Anthropic adapter
 * operations that consume a single text response.
 *
 * PR #385 fixed the crash class for chatWithToolsAnthropic (and
 * chatWithAnthropic already finds the first text block): when a
 * thinking-enabled model's response LEADS with a `thinking` block, code that
 * assumes `response.content[0]` is the text block throws
 * ERR_UNEXPECTED_RESPONSE_TYPE. Six sibling operations still made that
 * assumption:
 *
 *   - draftGraphWithAnthropic
 *   - suggestOptionsWithAnthropic
 *   - repairGraphWithAnthropic
 *   - clarifyBriefWithAnthropic
 *   - critiqueGraphWithAnthropic
 *   - explainDiffWithAnthropic
 *
 * Sonnet 5 runs adaptive thinking ON BY DEFAULT when the `thinking` param is
 * omitted, so a leading thinking block is a realistic production response for
 * every one of these calls — not just when thinking is explicitly enabled.
 *
 * Contract under test (mirrors #385's filter-to-text pattern):
 *   1. A response of [thinking, text] parses exactly as [text] would.
 *   2. A response with NO text block at all still throws
 *      unexpected_response_type (error path preserved).
 *   3. A well-formed [text] response is handled identically to before
 *      (find() returns content[0] when it is the text block).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphT } from "../../src/schemas/graph.js";

// ---------------------------------------------------------------------------
// SDK mock — capture the spy before vi.mock() hoists it
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
// Lane C (2026-07-23): draftGraphWithAnthropic now STREAMS. The other operations
// under test (suggest/repair/clarify/critique/explainDiff) still use create.
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
  },
}));

// Stub the prompt loader to avoid Supabase network calls in unit tests.
vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("mock system prompt"),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "test",
    prompt_hash: "abc",
    source: "default",
    version: null,
    instance_id: undefined,
    cache_age_ms: undefined,
    cache_status: "test",
    use_staging_mode: false,
  }),
  buildDraftPrompt: vi.fn().mockResolvedValue({
    system: "mock system",
    userContent: "mock user content",
  }),
  invalidatePromptCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A leading extended-thinking block, as returned by thinking-enabled models. */
const THINKING_BLOCK = {
  type: "thinking",
  thinking: "Let me reason about the best structure for this response...",
  signature: "sig_test_opaque_replay_token",
};

function makeResponse(content: object[]) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content,
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/**
 * Fake MessageStream for the streamed draft path: streams `streamedText` as a
 * text delta (thinking blocks are not text deltas, so they are not streamed),
 * then resolves finalMessage with the full `finalContent` — exercising the
 * "find the first text block" contract on finalMessage().content just as the
 * non-streaming response did.
 */
function makeDraftStream(finalContent: object[], streamedText: string) {
  return () => {
    async function* gen() {
      if (streamedText) {
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: streamedText } };
      }
    }
    const iterator = gen();
    return {
      [Symbol.asyncIterator]: () => iterator,
      finalMessage: async () => makeResponse(finalContent),
      abort: () => {},
    };
  };
}

/** Minimal valid graph JSON — passes normaliseDraftResponse + Zod for draft & repair. */
const VALID_GRAPH_JSON = JSON.stringify({
  nodes: [
    { id: "goal_1", kind: "goal", label: "Test goal" },
    { id: "dec_1", kind: "decision", label: "Test decision" },
    { id: "opt_1", kind: "option", label: "Option A" },
    { id: "out_1", kind: "outcome", label: "Revenue" },
  ],
  edges: [
    { from: "goal_1", to: "dec_1" },
    { from: "dec_1", to: "opt_1" },
    { from: "opt_1", to: "out_1", belief: 0.7, weight: 0.5 },
  ],
  rationales: [],
});

const VALID_OPTIONS_JSON = JSON.stringify({
  options: [
    {
      id: "opt_a",
      title: "Hire a contractor",
      pros: ["Faster start", "Lower fixed cost"],
      cons: ["Less continuity", "Knowledge leaves"],
      evidence_to_gather: ["Market day rates", "Contractor availability"],
    },
  ],
});

const VALID_CLARIFY_JSON = JSON.stringify({
  questions: [
    {
      question: "Who is the primary decision-maker?",
      choices: ["CEO", "Board", "Product team"],
      why_we_ask: "Determines which stakeholder perspectives to prioritise",
      impacts_draft: "Shapes the goal node and outcome evaluation criteria",
    },
  ],
  confidence: 0.65,
  should_continue: true,
});

const VALID_CRITIQUE_JSON = JSON.stringify({
  issues: [
    {
      level: "OBSERVATION",
      note: "Edge goal_1::dec_1 lacks a provenance source",
      target: "goal_1::dec_1::0",
    },
  ],
  suggested_fixes: ["Add provenance to edges with belief values"],
  overall_quality: "fair",
});

const VALID_EXPLAIN_DIFF_JSON = JSON.stringify({
  rationales: [
    {
      target: "opt_1",
      why: "Added because the brief mentions contracting as an alternative",
      provenance_source: "user_brief",
    },
  ],
});

const MINIMAL_GRAPH = {
  nodes: [
    { id: "goal_1", kind: "goal", label: "Test goal" },
    { id: "dec_1", kind: "decision", label: "Test decision" },
  ],
  edges: [{ from: "goal_1", to: "dec_1" }],
} as unknown as GraphT;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Anthropic adapter — thinking-first response handling (ROADMAP 1.55a)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    mockStream.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    // Force the prompt-only (robust-extractor) draft path so the fixture text
    // is parsed the same way in every environment.
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // draftGraphWithAnthropic
  // -------------------------------------------------------------------------

  it("draftGraphWithAnthropic parses a [thinking, text] response", async () => {
    mockStream.mockImplementation(
      makeDraftStream([THINKING_BLOCK, { type: "text", text: VALID_GRAPH_JSON }], VALID_GRAPH_JSON),
    );
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await draftGraphWithAnthropic({
      brief: "Should I hire a contractor or a full-time employee?",
      docs: [],
      seed: 17,
      model: "claude-sonnet-4-6",
    });

    expect(result.graph.nodes.map((n) => n.id)).toContain("goal_1");
    expect(result.graph.nodes).toHaveLength(4);
  });

  it("draftGraphWithAnthropic still rejects a response with no text block", async () => {
    mockStream.mockImplementation(makeDraftStream([THINKING_BLOCK], ""));
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await expect(
      draftGraphWithAnthropic({
        brief: "Should I hire a contractor or a full-time employee?",
        docs: [],
        seed: 17,
        model: "claude-sonnet-4-6",
      }),
    ).rejects.toThrow("unexpected_response_type");
  });

  // -------------------------------------------------------------------------
  // suggestOptionsWithAnthropic
  // -------------------------------------------------------------------------

  it("suggestOptionsWithAnthropic parses a [thinking, text] response", async () => {
    mockCreate.mockResolvedValue(
      makeResponse([THINKING_BLOCK, { type: "text", text: VALID_OPTIONS_JSON }]),
    );
    const { suggestOptionsWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await suggestOptionsWithAnthropic({
      goal: "Grow revenue 20% in 12 months",
      model: "claude-sonnet-4-6",
    });

    expect(result.options).toHaveLength(1);
    expect(result.options[0]!.id).toBe("opt_a");
  });

  it("suggestOptionsWithAnthropic handles a well-formed [text] response identically", async () => {
    mockCreate.mockResolvedValue(makeResponse([{ type: "text", text: VALID_OPTIONS_JSON }]));
    const { suggestOptionsWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await suggestOptionsWithAnthropic({
      goal: "Grow revenue 20% in 12 months",
      model: "claude-sonnet-4-6",
    });

    expect(result.options[0]!.id).toBe("opt_a");
  });

  it("suggestOptionsWithAnthropic still rejects a response with no text block", async () => {
    mockCreate.mockResolvedValue(makeResponse([THINKING_BLOCK]));
    const { suggestOptionsWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await expect(
      suggestOptionsWithAnthropic({
        goal: "Grow revenue 20% in 12 months",
        model: "claude-sonnet-4-6",
      }),
    ).rejects.toThrow("unexpected_response_type");
  });

  // -------------------------------------------------------------------------
  // repairGraphWithAnthropic
  // -------------------------------------------------------------------------

  it("repairGraphWithAnthropic parses a [thinking, text] response", async () => {
    mockCreate.mockResolvedValue(
      makeResponse([THINKING_BLOCK, { type: "text", text: VALID_GRAPH_JSON }]),
    );
    const { repairGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await repairGraphWithAnthropic({
      graph: MINIMAL_GRAPH,
      violations: ["isolated node opt_1"],
      model: "claude-sonnet-4-6",
    });

    expect(result.graph.nodes.map((n) => n.id)).toContain("goal_1");
  });

  it("repairGraphWithAnthropic still rejects a response with no text block", async () => {
    mockCreate.mockResolvedValue(makeResponse([THINKING_BLOCK]));
    const { repairGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await expect(
      repairGraphWithAnthropic({
        graph: MINIMAL_GRAPH,
        violations: ["isolated node opt_1"],
        model: "claude-sonnet-4-6",
      }),
    ).rejects.toThrow("unexpected_response_type");
  });

  // -------------------------------------------------------------------------
  // clarifyBriefWithAnthropic
  // -------------------------------------------------------------------------

  it("clarifyBriefWithAnthropic parses a [thinking, text] response", async () => {
    mockCreate.mockResolvedValue(
      makeResponse([THINKING_BLOCK, { type: "text", text: VALID_CLARIFY_JSON }]),
    );
    const { clarifyBriefWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await clarifyBriefWithAnthropic({
      brief: "Should I hire a contractor or a full-time employee?",
      round: 1,
      model: "claude-sonnet-4-6",
    });

    expect(result.questions).toHaveLength(1);
    expect(result.confidence).toBe(0.65);
  });

  it("clarifyBriefWithAnthropic still rejects a response with no text block", async () => {
    mockCreate.mockResolvedValue(makeResponse([THINKING_BLOCK]));
    const { clarifyBriefWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await expect(
      clarifyBriefWithAnthropic({
        brief: "Should I hire a contractor or a full-time employee?",
        round: 1,
        model: "claude-sonnet-4-6",
      }),
    ).rejects.toThrow("unexpected_response_type");
  });

  // -------------------------------------------------------------------------
  // critiqueGraphWithAnthropic
  // -------------------------------------------------------------------------

  it("critiqueGraphWithAnthropic parses a [thinking, text] response", async () => {
    mockCreate.mockResolvedValue(
      makeResponse([THINKING_BLOCK, { type: "text", text: VALID_CRITIQUE_JSON }]),
    );
    const { critiqueGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await critiqueGraphWithAnthropic({
      graph: MINIMAL_GRAPH,
      model: "claude-sonnet-4-6",
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.level).toBe("OBSERVATION");
  });

  it("critiqueGraphWithAnthropic still rejects a response with no text block", async () => {
    mockCreate.mockResolvedValue(makeResponse([THINKING_BLOCK]));
    const { critiqueGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await expect(
      critiqueGraphWithAnthropic({
        graph: MINIMAL_GRAPH,
        model: "claude-sonnet-4-6",
      }),
    ).rejects.toThrow("unexpected_response_type");
  });

  // -------------------------------------------------------------------------
  // explainDiffWithAnthropic
  // -------------------------------------------------------------------------

  it("explainDiffWithAnthropic parses a [thinking, text] response", async () => {
    mockCreate.mockResolvedValue(
      makeResponse([THINKING_BLOCK, { type: "text", text: VALID_EXPLAIN_DIFF_JSON }]),
    );
    const { explainDiffWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await explainDiffWithAnthropic({
      patch: { ops: [{ op: "add_node", node: { id: "opt_1" } }] },
      model: "claude-sonnet-4-6",
    });

    expect(result.rationales).toHaveLength(1);
    expect(result.rationales[0]!.target).toBe("opt_1");
  });

  it("explainDiffWithAnthropic still rejects a response with no text block", async () => {
    mockCreate.mockResolvedValue(makeResponse([THINKING_BLOCK]));
    const { explainDiffWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    await expect(
      explainDiffWithAnthropic({
        patch: { ops: [] },
        model: "claude-sonnet-4-6",
      }),
    ).rejects.toThrow("unexpected_response_type");
  });
});
