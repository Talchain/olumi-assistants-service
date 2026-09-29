/**
 * ROADMAP 1.55(b) — adapter-side capture of verbatim thinking blocks for
 * API-BOUND REPLAY ONLY.
 *
 * Anthropic's extended-thinking + tool-use protocol requires the COMPLETE,
 * UNMODIFIED thinking block to be echoed back with the assistant message
 * that contains the tool_use when tool_results are returned ("If thinking
 * blocks are modified [or dropped], the API returns a 400
 * invalid_request_error" — platform.claude.com/docs/en/build-with-claude/
 * extended-thinking, Preserving thinking blocks). The REPAIR_ONCE path in
 * route-with-tool-use.ts replays `ChatWithToolsResult.content`, which
 * excludes thinking blocks (the #385 user-facing filter). Without a
 * replay-only capture, repair could never rescue a thinking-bearing failure.
 *
 * Contract under test:
 *   1. `replay_thinking_blocks` carries thinking blocks VERBATIM (including
 *      the opaque `signature` — required for a valid replay).
 *   2. `redacted_thinking` blocks are captured with their opaque `data`.
 *   3. `content` remains text/tool_use only — the #385 user-facing filter is
 *      NOT loosened.
 *   4. `reasoning` stays flag-gated and NEVER contains the signature.
 *   5. No thinking blocks in the response → the field is absent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

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

const THINKING_TEXT = "I should call olumi_action with intent_class execute...";
const SIGNATURE = "sig_opaque_replay_token_9f3a";

function makeToolResponse(content: object[]) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content,
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

const TOOL_USE_BLOCK = {
  type: "tool_use",
  id: "tu_1",
  name: "olumi_action",
  input: { intent_class: "execute" },
};

const BASE_ARGS = {
  system: "sys",
  messages: [{ role: "user" as const, content: "run analysis" }],
  tools: [{ name: "olumi_action", description: "d", input_schema: { type: "object", properties: {} } }],
  model: "claude-sonnet-5",
};

describe("chatWithToolsAnthropic — replay_thinking_blocks capture (ROADMAP 1.55b)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captures a leading thinking block VERBATIM (including signature) for replay", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse([
        { type: "thinking", thinking: THINKING_TEXT, signature: SIGNATURE },
        TOOL_USE_BLOCK,
      ]),
    );
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await chatWithToolsAnthropic(BASE_ARGS);

    expect(result.replay_thinking_blocks).toEqual([
      { type: "thinking", thinking: THINKING_TEXT, signature: SIGNATURE },
    ]);
  });

  it("captures redacted_thinking blocks with their opaque data", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse([
        { type: "redacted_thinking", data: "enc_opaque_payload" },
        TOOL_USE_BLOCK,
      ]),
    );
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await chatWithToolsAnthropic(BASE_ARGS);

    expect(result.replay_thinking_blocks).toEqual([
      { type: "redacted_thinking", data: "enc_opaque_payload" },
    ]);
  });

  it("does NOT loosen the user-facing filter: content stays text/tool_use only", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse([
        { type: "thinking", thinking: THINKING_TEXT, signature: SIGNATURE },
        { type: "text", text: "Working on it..." },
        TOOL_USE_BLOCK,
      ]),
    );
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await chatWithToolsAnthropic(BASE_ARGS);

    expect(result.content.map((b) => b.type)).toEqual(["text", "tool_use"]);
    // Neither the thinking text nor the signature may appear anywhere in the
    // user-facing content blocks.
    const serialised = JSON.stringify(result.content);
    expect(serialised).not.toContain(THINKING_TEXT);
    expect(serialised).not.toContain(SIGNATURE);
  });

  it("reasoning stays flag-gated (off by default) even though replay capture is unconditional", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse([
        { type: "thinking", thinking: THINKING_TEXT, signature: SIGNATURE },
        TOOL_USE_BLOCK,
      ]),
    );
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await chatWithToolsAnthropic(BASE_ARGS);

    expect(result.reasoning).toBeUndefined();
    expect(result.replay_thinking_blocks).toBeDefined();
  });

  it("signature never leaks into reasoning when CEE_REASONING_CAPTURE_ENABLED is on", async () => {
    vi.stubEnv("CEE_REASONING_CAPTURE_ENABLED", "true");
    mockCreate.mockResolvedValue(
      makeToolResponse([
        { type: "thinking", thinking: THINKING_TEXT, signature: SIGNATURE },
        TOOL_USE_BLOCK,
      ]),
    );
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await chatWithToolsAnthropic(BASE_ARGS);

    expect(result.reasoning).toBe(THINKING_TEXT);
    expect(result.reasoning).not.toContain(SIGNATURE);
  });

  it("omits replay_thinking_blocks entirely when the response has no thinking blocks", async () => {
    mockCreate.mockResolvedValue(
      makeToolResponse([{ type: "text", text: "plain" }, TOOL_USE_BLOCK]),
    );
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");

    const result = await chatWithToolsAnthropic(BASE_ARGS);

    expect(result.replay_thinking_blocks).toBeUndefined();
  });
});
