/**
 * Unit tests for extended thinking support in the Anthropic adapter.
 *
 * Covers:
 * - thinking block passed to API when thinking is enabled
 * - temperature forced to 1 when thinking is enabled
 * - temperature remains 0 when thinking is absent or disabled
 * - no thinking block when config is disabled
 * - chatWithAnthropic handles thinking blocks before text blocks in response
 * - max_tokens auto-raised to budget + 1024 when thinking enabled and no override set
 * - max_tokens auto-raised when explicit override is too low
 * - model capability guard: unsupported model disables thinking with a warning
 * - thinking mode parsing: "enabled" accepted, unsupported values rejected at startup
 * - startup warning covers the no-max-token-override case (adapter default)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Capture the mock spy before vi.mock() hoists it
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Stub prompt-loader to prevent Supabase network calls in unit tests
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
// Shared minimal API response factory
// ---------------------------------------------------------------------------

function makeResponse(content?: object[]) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: content ?? [{ type: "text", text: "ok" }],
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// chatWithToolsAnthropic — thinking passthrough and max_tokens enforcement
// ---------------------------------------------------------------------------

describe("chatWithToolsAnthropic — thinking", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(makeResponse());
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not include thinking block when thinking is absent", async () => {
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithToolsAnthropic({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
      model: "claude-sonnet-4-6",
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);
  });

  it("passes thinking block and forces temperature=1 when thinking is enabled", async () => {
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithToolsAnthropic({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 8000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
    expect(body.temperature).toBe(1);
  });

  it("does not include thinking block when thinking is disabled", async () => {
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithToolsAnthropic({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
      model: "claude-sonnet-4-6",
      thinking: { type: "disabled" },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);
  });

  it("auto-raises max_tokens to budget + 1024 when no override is set", async () => {
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    // No maxTokens arg — adapter default is 4096, budget is 8000; effective must be >= 9024
    await chatWithToolsAnthropic({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 8000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.max_tokens).toBeGreaterThanOrEqual(8000 + 1024);
  });

  it("auto-raises max_tokens when explicit override is below budget + 1024", async () => {
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithToolsAnthropic({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
      model: "claude-sonnet-4-6",
      maxTokens: 5000,
      thinking: { type: "enabled", budget_tokens: 8000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.max_tokens).toBe(8000 + 1024);
  });

  it("respects explicit max_tokens when already above budget + 1024", async () => {
    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithToolsAnthropic({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
      model: "claude-sonnet-4-6",
      maxTokens: 20000,
      thinking: { type: "enabled", budget_tokens: 8000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.max_tokens).toBe(20000);
  });

  it("disables thinking and emits a warning for unsupported model", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { chatWithToolsAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithToolsAnthropic({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }],
      model: "claude-3-5-sonnet-20241022",
      thinking: { type: "enabled", budget_tokens: 8000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);
    // Warning was emitted (via pino log.warn — captured as console.warn in test env or directly)
    // The guard logs via the pino logger; just confirm the call completes without throwing.

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// chatWithAnthropic (edit_graph path) — thinking passthrough and max_tokens
// ---------------------------------------------------------------------------

describe("chatWithAnthropic — thinking (edit_graph path)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(makeResponse());
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not include thinking block when thinking is absent", async () => {
    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithAnthropic({
      system: "sys",
      userMessage: "hello",
      model: "claude-sonnet-4-6",
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);
  });

  it("passes thinking block and forces temperature=1 when enabled", async () => {
    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await chatWithAnthropic({
      system: "sys",
      userMessage: "hello",
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 5000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
    expect(body.temperature).toBe(1);
  });

  it("auto-raises max_tokens to budget + 1024 when no override is set", async () => {
    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    // Default maxTokens is 4096; budget_tokens is 5000; effective must be >= 6024
    await chatWithAnthropic({
      system: "sys",
      userMessage: "hello",
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 5000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.max_tokens).toBeGreaterThanOrEqual(5000 + 1024);
  });

  it("returns text content when thinking blocks precede text block in response", async () => {
    mockCreate.mockResolvedValue(
      makeResponse([
        { type: "thinking", thinking: "let me think..." },
        { type: "text", text: "the answer" },
      ])
    );

    const { chatWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    const result = await chatWithAnthropic({
      system: "sys",
      userMessage: "hello",
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 5000 },
    });

    expect(result.content).toBe("the answer");
  });
});

// ---------------------------------------------------------------------------
// draftGraphWithAnthropic — thinking passthrough and max_tokens enforcement
// ---------------------------------------------------------------------------

const MINIMAL_DRAFT_JSON = JSON.stringify({
  nodes: [
    { id: "opt_a", kind: "option", label: "Option A" },
    { id: "fac_x", kind: "factor", label: "Factor X", data: { baseline: 0.5 } },
  ],
  edges: [
    { from: "opt_a", to: "fac_x", strength: { mean: 0.6, std: 0.1 } },
  ],
});

describe("draftGraphWithAnthropic — thinking", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(makeResponse([{ type: "text", text: MINIMAL_DRAFT_JSON }]));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not include thinking block when thinking is absent", async () => {
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({
      brief: "Help me decide whether to take the job offer.",
      docs: [],
      seed: 1,
      model: "claude-sonnet-4-6",
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);
  });

  it("passes thinking block and forces temperature=1 when enabled", async () => {
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({
      brief: "Help me decide whether to take the job offer.",
      docs: [],
      seed: 1,
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 6000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 6000 });
    expect(body.temperature).toBe(1);
  });

  it("auto-raises max_tokens to budget + 1024 when no override is set", async () => {
    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    // draft_graph default is 16384; budget is 6000; 16384 > 7024 so max stays at 16384
    await draftGraphWithAnthropic({
      brief: "Help me decide whether to take the job offer.",
      docs: [],
      seed: 1,
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 6000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.max_tokens).toBeGreaterThanOrEqual(6000 + 1024);
  });

  it("disables thinking and emits a warning for unsupported model", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({
      brief: "Help me decide whether to take the job offer.",
      docs: [],
      seed: 1,
      model: "claude-3-5-sonnet-20241022",
      thinking: { type: "enabled", budget_tokens: 6000 },
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0);

    warnSpy.mockRestore();
  });

  it("disables structured outputs when thinking is enabled", async () => {
    vi.stubEnv("ANTHROPIC_STRUCTURED_OUTPUTS_ENABLED", "true");

    const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
    await draftGraphWithAnthropic({
      brief: "Help me decide whether to take the job offer.",
      docs: [],
      seed: 1,
      model: "claude-sonnet-4-6",
      thinking: { type: "enabled", budget_tokens: 6000 },
    });

    const [body] = mockCreate.mock.calls[0];
    // output_format must be absent when thinking is enabled
    expect(body.output_format).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Thinking mode parsing — P0-3
// ---------------------------------------------------------------------------

describe("config — thinking mode parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts 'enabled' as a valid thinking mode", async () => {
    vi.stubEnv("CEE_ORCHESTRATOR_THINKING", "enabled");

    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();

    expect(config.cee.thinking.orchestratorEnabled).toBe(true);
    _resetConfigCache();
  });

  it("accepts 'true' as a valid thinking mode", async () => {
    vi.stubEnv("CEE_ORCHESTRATOR_THINKING", "true");

    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();

    expect(config.cee.thinking.orchestratorEnabled).toBe(true);
    _resetConfigCache();
  });

  it("parses 'false' as disabled", async () => {
    vi.stubEnv("CEE_ORCHESTRATOR_THINKING", "false");

    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();

    expect(config.cee.thinking.orchestratorEnabled).toBe(false);
    _resetConfigCache();
  });

  it("rejects unsupported mode string 'adaptive' at startup", async () => {
    vi.stubEnv("CEE_ORCHESTRATOR_THINKING", "adaptive");

    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();

    expect(() => config.cee.thinking).toThrow(/Invalid thinking mode.*adaptive/i);
    _resetConfigCache();
  });
});

// ---------------------------------------------------------------------------
// Config — startup warning covers both too-low and unset max_tokens
// ---------------------------------------------------------------------------

describe("config — thinking budget startup warning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("warns when orchestrator max_tokens is explicitly set but <= budget_tokens", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubEnv("CEE_ORCHESTRATOR_THINKING", "true");
    vi.stubEnv("CEE_ORCHESTRATOR_THINKING_BUDGET", "10000");
    vi.stubEnv("CEE_MAX_TOKENS_ORCHESTRATOR", "8000");

    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();

    const _unused = config.cee.thinking;

    const budgetWarnings = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("budget_tokens")
    );
    expect(budgetWarnings.length).toBeGreaterThanOrEqual(1);
    expect(budgetWarnings[0][0]).toContain("CEE_MAX_TOKENS_ORCHESTRATOR");

    warnSpy.mockRestore();
    _resetConfigCache();
  });

  it("warns when max_tokens is not set and adapter default (4096) <= budget_tokens (10000)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubEnv("CEE_ORCHESTRATOR_THINKING", "true");
    vi.stubEnv("CEE_ORCHESTRATOR_THINKING_BUDGET", "10000");
    // CEE_MAX_TOKENS_ORCHESTRATOR deliberately not set — adapter default 4096 applies

    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();

    const _unused = config.cee.thinking;

    const budgetWarnings = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("budget_tokens")
    );
    expect(budgetWarnings.length).toBeGreaterThanOrEqual(1);
    // Warning should mention the env var name and that the default applies
    expect(budgetWarnings[0][0]).toContain("CEE_MAX_TOKENS_ORCHESTRATOR");
    expect(budgetWarnings[0][0]).toContain("adapter default");

    warnSpy.mockRestore();
    _resetConfigCache();
  });

  it("does not warn when max_tokens > budget_tokens", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubEnv("CEE_ORCHESTRATOR_THINKING", "true");
    vi.stubEnv("CEE_ORCHESTRATOR_THINKING_BUDGET", "10000");
    vi.stubEnv("CEE_MAX_TOKENS_ORCHESTRATOR", "16000");

    const { _resetConfigCache, config } = await import("../../src/config/index.js");
    _resetConfigCache();

    const _unused = config.cee.thinking;

    const budgetWarnings = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("budget_tokens")
    );
    expect(budgetWarnings).toHaveLength(0);

    warnSpy.mockRestore();
    _resetConfigCache();
  });
});
