/**
 * Unit tests for Anthropic streaming chat with tools.
 *
 * Covers:
 * - Text-only response (INTERPRET mode) — tokens stream incrementally
 * - Tool use response (ACT mode) — tool call detected, tool_input events emitted
 * - Thinking blocks filtered — only text streamed, thinking never reaches client
 * - Thinking parameter passed to API when enabled
 * - Temperature forced to 1 when thinking is enabled
 * - max_tokens auto-raised for thinking budget
 * - SSE event format: text_delta, tool_input_start, tool_input_complete, message_complete
 * - XML envelope parseable from assembled stream content
 * - Unsupported model disables thinking gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Anthropic SDK — emit stream events via a fake async iterable
// ---------------------------------------------------------------------------

type StreamEvent =
  | { type: "content_block_start"; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: "content_block_delta"; index: number; delta: { type: string; text?: string; partial_json?: string; thinking?: string } }
  | { type: "content_block_stop"; index: number };

let streamEvents: StreamEvent[] = [];
let finalMessageResponse: Record<string, unknown> = {};

const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn(),
      stream: mockStream,
    };
  },
}));

// Stub prompt-loader to prevent Supabase network calls
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
// Helpers
// ---------------------------------------------------------------------------

function makeFinalMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello, I can help with that." }],
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...overrides,
  };
}

function setupMockStream(events: StreamEvent[], finalMsg: Record<string, unknown>) {
  streamEvents = events;
  finalMessageResponse = finalMsg;

  mockStream.mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      for (const event of streamEvents) {
        yield event;
      }
    },
    finalMessage: async () => finalMessageResponse,
  });
}

function makeBaseArgs() {
  return {
    system: "You are a helpful assistant.",
    messages: [{ role: "user" as const, content: "What should I do?" }],
    tools: [
      {
        name: "draft_graph",
        description: "Draft a decision graph",
        input_schema: { type: "object" as const, properties: { brief: { type: "string" } } },
      },
    ],
    model: "claude-sonnet-4-6",
  };
}

async function collectEvents(gen: AsyncIterable<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("streamChatWithToolsAnthropic", () => {
  beforeEach(() => {
    mockStream.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Text-only streaming (INTERPRET mode)
  // =========================================================================

  it("streams text_delta events for text-only response", async () => {
    setupMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", world!" } },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage(),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(streamChatWithToolsAnthropic(makeBaseArgs()));

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0].delta).toBe("Hello");
    expect(textDeltas[1].delta).toBe(", world!");

    const complete = events.find((e) => e.type === "message_complete");
    expect(complete).toBeDefined();
    expect(complete.result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
  });

  // =========================================================================
  // Tool use streaming (ACT mode)
  // =========================================================================

  it("streams tool_input events for tool_use response", async () => {
    setupMockStream(
      [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_1", name: "draft_graph" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"bri' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: 'ef":"test"}' },
        },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage({
        content: [
          { type: "tool_use", id: "tu_1", name: "draft_graph", input: { brief: "test" } },
        ],
        stop_reason: "tool_use",
      }),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(streamChatWithToolsAnthropic(makeBaseArgs()));

    const toolStart = events.find((e) => e.type === "tool_input_start");
    expect(toolStart).toBeDefined();
    expect(toolStart.tool_name).toBe("draft_graph");
    expect(toolStart.tool_id).toBe("tu_1");

    const toolComplete = events.find((e) => e.type === "tool_input_complete");
    expect(toolComplete).toBeDefined();
    expect(toolComplete.input).toEqual({ brief: "test" });

    // No text_delta events for tool-only response
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(0);

    const complete = events.find((e) => e.type === "message_complete");
    expect(complete).toBeDefined();
    expect(complete.result.stop_reason).toBe("tool_use");
  });

  // =========================================================================
  // Thinking blocks filtered
  // =========================================================================

  it("filters thinking blocks — thinking deltas never reach client", async () => {
    setupMockStream(
      [
        // Thinking block at index 0
        { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Let me reason about this..." },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "The user wants help with..." },
        },
        { type: "content_block_stop", index: 0 },
        // Text block at index 1
        { type: "content_block_start", index: 1, content_block: { type: "text" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Here is my answer." } },
        { type: "content_block_stop", index: 1 },
      ],
      makeFinalMessage({
        content: [
          { type: "thinking", thinking: "Let me reason about this... The user wants help with..." },
          { type: "text", text: "Here is my answer." },
        ],
      }),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(
      streamChatWithToolsAnthropic({
        ...makeBaseArgs(),
        thinking: { type: "enabled", budget_tokens: 8000 },
      }),
    );

    // Only one text_delta event — thinking deltas are suppressed
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0].delta).toBe("Here is my answer.");

    // message_complete should NOT contain thinking blocks
    const complete = events.find((e) => e.type === "message_complete");
    expect(complete).toBeDefined();
    const thinkingBlocks = complete.result.content.filter(
      (b: any) => b.type === "thinking",
    );
    expect(thinkingBlocks).toHaveLength(0);

    // Should contain the text block
    const textBlocks = complete.result.content.filter((b: any) => b.type === "text");
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toBe("Here is my answer.");
  });

  // =========================================================================
  // Thinking parameter passed to API
  // =========================================================================

  it("passes thinking parameter and forces temperature=1 to API when thinking is enabled", async () => {
    setupMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage(),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await collectEvents(
      streamChatWithToolsAnthropic({
        ...makeBaseArgs(),
        thinking: { type: "enabled", budget_tokens: 8000 },
      }),
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const [body] = mockStream.mock.calls[0];
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
    expect(body.temperature).toBe(1);
  });

  it("does not include thinking parameter when thinking is absent", async () => {
    setupMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage(),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await collectEvents(streamChatWithToolsAnthropic(makeBaseArgs()));

    const [body] = mockStream.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);
  });

  it("auto-raises max_tokens to budget + 1024 when thinking is enabled", async () => {
    setupMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage(),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await collectEvents(
      streamChatWithToolsAnthropic({
        ...makeBaseArgs(),
        thinking: { type: "enabled", budget_tokens: 8000 },
      }),
    );

    const [body] = mockStream.mock.calls[0];
    expect(body.max_tokens).toBeGreaterThanOrEqual(8000 + 1024);
  });

  it("disables thinking for unsupported model", async () => {
    setupMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage(),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await collectEvents(
      streamChatWithToolsAnthropic({
        ...makeBaseArgs(),
        model: "claude-3-5-sonnet-20241022",
        thinking: { type: "enabled", budget_tokens: 8000 },
      }),
    );

    const [body] = mockStream.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);
  });

  // =========================================================================
  // SSE event format — message_complete structure
  // =========================================================================

  it("message_complete contains properly ordered content (text before tool_use)", async () => {
    setupMockStream(
      [
        // Tool use first in stream
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_1", name: "draft_graph" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"brief":"test"}' },
        },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage({
        content: [
          { type: "text", text: "Let me draft that for you." },
          { type: "tool_use", id: "tu_1", name: "draft_graph", input: { brief: "test" } },
        ],
        stop_reason: "tool_use",
      }),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(streamChatWithToolsAnthropic(makeBaseArgs()));

    const complete = events.find((e) => e.type === "message_complete");
    expect(complete).toBeDefined();

    // Text blocks should come before tool_use blocks
    const content = complete.result.content;
    const firstTextIdx = content.findIndex((b: any) => b.type === "text");
    const firstToolIdx = content.findIndex((b: any) => b.type === "tool_use");
    expect(firstTextIdx).toBeLessThan(firstToolIdx);
  });

  // =========================================================================
  // XML envelope parseable from assembled stream
  // =========================================================================

  it("assembled text content is parseable as XML envelope", async () => {
    const xmlResponse = `<diagnostics>
<mode>INTERPRET</mode>
</diagnostics>
<response>
I can help you think through this decision.
</response>`;

    setupMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "<diagnostics>" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "\n<mode>INTERPRET</mode>" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "\n</diagnostics>" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "\n<response>" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "\nI can help you" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " think through this decision." } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "\n</response>" } },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage({
        content: [{ type: "text", text: xmlResponse }],
      }),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(streamChatWithToolsAnthropic(makeBaseArgs()));

    // All text deltas can be joined to reconstruct the XML
    const textDeltas = events.filter((e) => e.type === "text_delta");
    const assembled = textDeltas.map((e) => e.delta).join("");
    expect(assembled).toContain("<diagnostics>");
    expect(assembled).toContain("<mode>INTERPRET</mode>");
    expect(assembled).toContain("<response>");
    expect(assembled).toContain("I can help you think through this decision.");
    expect(assembled).toContain("</response>");

    // Final message text also parseable
    const complete = events.find((e) => e.type === "message_complete");
    const textContent = complete.result.content.find((b: any) => b.type === "text");
    expect(textContent.text).toContain("<diagnostics>");
    expect(textContent.text).toContain("</response>");
  });

  // =========================================================================
  // Mixed: text + tool_use + thinking
  // =========================================================================

  it("handles mixed response with thinking + text + tool_use", async () => {
    setupMockStream(
      [
        // Thinking
        { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reasoning..." } },
        { type: "content_block_stop", index: 0 },
        // Text
        { type: "content_block_start", index: 1, content_block: { type: "text" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "I'll draft that." } },
        { type: "content_block_stop", index: 1 },
        // Tool use
        {
          type: "content_block_start",
          index: 2,
          content_block: { type: "tool_use", id: "tu_2", name: "draft_graph" },
        },
        {
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: '{"brief":"x"}' },
        },
        { type: "content_block_stop", index: 2 },
      ],
      makeFinalMessage({
        content: [
          { type: "thinking", thinking: "reasoning..." },
          { type: "text", text: "I'll draft that." },
          { type: "tool_use", id: "tu_2", name: "draft_graph", input: { brief: "x" } },
        ],
        stop_reason: "tool_use",
      }),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(
      streamChatWithToolsAnthropic({
        ...makeBaseArgs(),
        thinking: { type: "enabled", budget_tokens: 8000 },
      }),
    );

    // Only text and tool events — no thinking
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0].delta).toBe("I'll draft that.");

    const toolStart = events.find((e) => e.type === "tool_input_start");
    expect(toolStart).toBeDefined();

    const toolComplete = events.find((e) => e.type === "tool_input_complete");
    expect(toolComplete).toBeDefined();

    // message_complete excludes thinking
    const complete = events.find((e) => e.type === "message_complete");
    const types = complete.result.content.map((b: any) => b.type);
    expect(types).not.toContain("thinking");
    expect(types).toContain("text");
    expect(types).toContain("tool_use");
  });

  // =========================================================================
  // P1-3: Unknown block types handled gracefully
  // =========================================================================

  it("unknown content block types (e.g. redacted_thinking) do not crash the stream", async () => {
    setupMockStream(
      [
        // Unknown block type (future Anthropic feature)
        { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking" } },
        { type: "content_block_delta", index: 0, delta: { type: "redacted_thinking_delta", data: "[redacted]" } },
        { type: "content_block_stop", index: 0 },
        // Normal text block
        { type: "content_block_start", index: 1, content_block: { type: "text" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Answer" } },
        { type: "content_block_stop", index: 1 },
      ],
      makeFinalMessage({
        content: [
          { type: "redacted_thinking", data: "[redacted]" },
          { type: "text", text: "Answer" },
        ],
      }),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(streamChatWithToolsAnthropic(makeBaseArgs()));

    // Should have text_delta for "Answer" only — unknown deltas are ignored
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0].delta).toBe("Answer");

    // message_complete should exist — stream completed without crash
    const complete = events.find((e) => e.type === "message_complete");
    expect(complete).toBeDefined();

    // Text blocks should be present in final content
    const textBlocks = complete.result.content.filter((b: any) => b.type === "text");
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toBe("Answer");

    // Unknown block types should NOT be in the content (only text and tool_use are collected)
    const unknownBlocks = complete.result.content.filter((b: any) => b.type === "redacted_thinking");
    expect(unknownBlocks).toHaveLength(0);
  });

  it("unknown delta types on known text blocks are silently ignored", async () => {
    setupMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Part 1" } },
        // Hypothetical unknown delta type on a text block
        { type: "content_block_delta", index: 0, delta: { type: "citation_delta", citation: { url: "example.com" } } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Part 2" } },
        { type: "content_block_stop", index: 0 },
      ],
      makeFinalMessage({ content: [{ type: "text", text: "Part 1 Part 2" }] }),
    );

    const { streamChatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const events = await collectEvents(streamChatWithToolsAnthropic(makeBaseArgs()));

    // Only text_delta events should appear (citation_delta silently ignored)
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas[0].delta).toBe("Part 1");
    expect(textDeltas[1].delta).toBe(" Part 2");

    const complete = events.find((e) => e.type === "message_complete");
    expect(complete).toBeDefined();
  });
});
