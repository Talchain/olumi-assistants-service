/**
 * Native document attachment — draft message-assembly pins (D-59-7).
 *
 * Mocks `@anthropic-ai/sdk` (draft STREAMS) and inspects the request `body` sent
 * to messages.stream, proving:
 *   - NO-DOCUMENT BYTE-IDENTICAL: with no attachment, messages[0].content is the
 *     plain STRING (byte-for-byte the same as buildDraftPrompt.userContent).
 *   - ENVELOPE IN THE USER MESSAGE, NOT SYSTEM: with a document, content is an
 *     array with the document block bracketed between the untrusted markers, and
 *     the document never appears in `system`.
 *   - CACHE-SAFE: `system` (which carries the sole cache_control breakpoint) is
 *     byte-identical with and without the document — attaching a doc cannot bust
 *     the cached system prefix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

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

function makeFakeStream(jsonText: string) {
  return (_body: unknown) => {
    async function* gen() {
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: jsonText } };
    }
    const iterator = gen();
    return {
      [Symbol.asyncIterator]: () => iterator,
      finalMessage: async () => ({
        content: [{ type: "text", text: jsonText }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
      abort: () => {},
    };
  };
}

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

const BRIEF = "Should I extend the free trial to lift conversion?";
const b64 = (s: string): string => Buffer.from(s, "utf-8").toString("base64");

describe("draft message assembly — native document attachment (D-59-7)", () => {
  beforeEach(() => {
    vi.resetModules();
    streamSpy.mockImplementation(makeFakeStream(VALID_GRAPH_JSON));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
  });
  afterEach(() => {
    streamSpy.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("NO attachment → messages[0].content is the plain STRING, byte-identical to buildDraftPrompt.userContent", async () => {
    const { draftGraphWithAnthropic, __test_only } = await import("../../src/adapters/llm/anthropic.js");

    await draftGraphWithAnthropic({ brief: BRIEF, docs: [], seed: 17, model: "claude-sonnet-4-6" });

    const [body] = streamSpy.mock.calls[0];
    const content = body.messages[0].content;
    expect(typeof content).toBe("string"); // NOT an array — the byte-identical invariant
    expect(content).toContain(BRIEF);
    expect(content).toContain("[BEGIN_UNTRUSTED_USER_CONTENT]");

    // Byte-identical to the prompt the builder produced (no document → no blocks).
    const prompt = await __test_only.buildDraftPrompt({ brief: BRIEF, docs: [], seed: 17 });
    expect(prompt.attachmentBlocks).toBeUndefined();
    expect(content).toBe(prompt.userContent);
  });

  it("WITH a document → content is an array with the doc bracketed between the untrusted markers; doc is NOT in system", async () => {
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const { buildDraftDocumentBlock } = await import("../../src/adapters/llm/draft-attachment.js");

    const attachment = buildDraftDocumentBlock({
      kind: "txt",
      name: "facts.txt",
      base64: b64("The 14-day trial converts at 23% vs 8% baseline."),
    });

    await draftGraphWithAnthropic({ brief: BRIEF, docs: [], seed: 17, model: "claude-sonnet-4-6", attachment });

    const [body] = streamSpy.mock.calls[0];
    const content = body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);

    // First block is the brief text; then the untrusted-bracketed document.
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain(BRIEF);

    const beginIdx = content.findIndex(
      (b: { type: string; text?: string }) => b.type === "text" && b.text?.includes("[BEGIN_UNTRUSTED_USER_CONTENT]") && b.text?.includes("Attached Document"),
    );
    const docIdx = content.findIndex((b: { type: string }) => b.type === "document");
    const endIdx = content.findIndex(
      (b: { type: string; text?: string }) => b.type === "text" && b.text === "[END_UNTRUSTED_USER_CONTENT]",
    );
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeGreaterThan(beginIdx); // document AFTER the BEGIN marker
    expect(endIdx).toBeGreaterThan(docIdx); //   and BEFORE the END marker

    // The document must NOT leak into the system prefix (envelope authority).
    const systemBlocks = body.system as Array<{ type: string; text?: string }>;
    expect(systemBlocks.some((b) => b.type === "document")).toBe(false);
    const systemText = systemBlocks.map((b) => b.text ?? "").join("");
    expect(systemText).not.toContain("23% vs 8%");
  });

  it("CACHE-SAFE: `system` is byte-identical with and without the document (doc never busts the cached prefix)", async () => {
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const { buildDraftDocumentBlock } = await import("../../src/adapters/llm/draft-attachment.js");

    // Call 1: no document.
    await draftGraphWithAnthropic({ brief: BRIEF, docs: [], seed: 17, model: "claude-sonnet-4-6" });
    const [bodyWithout] = streamSpy.mock.calls[0];

    // Call 2: with a document.
    const attachment = buildDraftDocumentBlock({ kind: "txt", name: "facts.txt", base64: b64("Attach me.") });
    await draftGraphWithAnthropic({ brief: BRIEF, docs: [], seed: 17, model: "claude-sonnet-4-6", attachment });
    const [bodyWith] = streamSpy.mock.calls[1];

    // The cached system prefix (buildSystemBlocks holds the only cache_control) is
    // identical → attaching a document cannot invalidate the system cache.
    expect(bodyWith.system).toEqual(bodyWithout.system);
  });
});
