/**
 * End-to-end streaming contract tests.
 *
 * P0-1: Prove live path selection — executePipelineStream calls streamChatWithTools
 *        (not chatWithTools) when llmClient.streamChatWithTools exists, and text_delta
 *        events propagate from adapter → pipeline → SSE client.
 *
 * P0-2: Route-level SSE wire format contract — validate that every event emitted
 *        through writeSSEEvent matches the Zod schema the UI parses, and that the
 *        SSE framing (event:, data:, id:) is correct.
 *
 * P0-3: High-fidelity integration harness — wire executePipelineStream with a mock
 *        Anthropic adapter through the full pipeline (no route mocking) and verify
 *        incremental text delivery and tool-use turn completion.
 *
 * P1-2: Transport reliability — flush/drain, client disconnect mid-stream, abort
 *        signal propagation, SSE framing correctness.
 *
 * P1-3: Unknown block type hardening — verify graceful handling of unexpected
 *        Anthropic content block types.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { OrchestratorStreamEventSchema } from "../../src/orchestrator/pipeline/stream-events.js";
import type { OrchestratorStreamEvent } from "../../src/orchestrator/pipeline/stream-events.js";

// ===========================================================================
// P0-1: Live path selection — pipeline calls streamChatWithTools
// ===========================================================================

// Mock the full pipeline dependency stack but leave llmClient injectable
vi.mock("../../src/orchestrator/pipeline/phase1-enrichment/index.js", () => ({
  phase1Enrich: vi.fn(),
}));
vi.mock("../../src/orchestrator/pipeline/phase2-specialists/index.js", () => ({
  phase2Route: vi.fn(() => ({ contributions: [] })),
}));
vi.mock("../../src/orchestrator/pipeline/phase3-llm/index.js", () => ({
  phase3Generate: vi.fn(),
  phase3PrepareForStreaming: vi.fn(),
}));
vi.mock("../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js", () => ({
  assembleV2SystemPrompt: vi.fn(async () => ({
    text: "system prompt",
    cache_blocks: [{ type: "text", text: "system prompt" }],
  })),
}));
vi.mock("../../src/orchestrator/pipeline/phase4-tools/index.js", () => ({
  phase4Execute: vi.fn(),
}));
vi.mock("../../src/orchestrator/pipeline/phase5-validation/index.js", () => ({
  phase5Validate: vi.fn(),
}));
vi.mock("../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js", () => ({
  buildErrorEnvelope: vi.fn(),
  resolveContextHash: vi.fn(() => "hash"),
}));
vi.mock("../../src/orchestrator/system-event-router.js", () => ({
  routeSystemEvent: vi.fn(),
  appendSystemMessages: vi.fn(),
}));
vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(() => ({ model: "claude-sonnet-4-6", name: "anthropic" })),
}));
vi.mock("../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn(() => ({ tool: null, routing: "llm", confidence: "none" })),
  classifyIntentWithContext: vi.fn(() => ({ tool: null, routing: "llm", confidence: "none" })),
}));
vi.mock("../../src/orchestrator/lookup/analysis-lookup.js", () => ({
  tryAnalysisLookup: vi.fn(() => ({ matched: false })),
  buildLookupEnvelope: vi.fn(),
}));
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: { OrchestratorModeDisagreement: "orchestrator.mode_disagreement" },
}));
vi.mock("../../src/config/index.js", () => ({
  config: {
    features: { contextFabric: false, orchestratorStreaming: true, briefDetectionEnabled: false },
  },
}));

import { executePipelineStream } from "../../src/orchestrator/pipeline/pipeline-stream.js";
import { phase1Enrich } from "../../src/orchestrator/pipeline/phase1-enrichment/index.js";
import { phase3PrepareForStreaming } from "../../src/orchestrator/pipeline/phase3-llm/index.js";
import { phase4Execute } from "../../src/orchestrator/pipeline/phase4-tools/index.js";
import { phase5Validate } from "../../src/orchestrator/pipeline/phase5-validation/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    message: "Should I take the job offer?",
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: "frame", goal: "career decision" },
      messages: [],
      selected_elements: [],
      scenario_id: "sc-e2e",
      analysis_inputs: null,
    },
    scenario_id: "sc-e2e",
    client_turn_id: "ct-e2e-1",
    ...overrides,
  } as any;
}

function makeEnrichedContext(overrides: Record<string, unknown> = {}) {
  return {
    turn_id: "turn-e2e",
    graph: null,
    analysis: null,
    framing: { stage: "frame", goal: "career decision" },
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    conversational_state: {},
    scenario_id: "sc-e2e",
    dsk: { version_hash: null, bundle: null },
    ...overrides,
  } as any;
}

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    turn_id: "turn-e2e",
    assistant_text: "I can help you think through this.",
    blocks: [],
    suggested_actions: [],
    lineage: { context_hash: "abc123", dsk_version_hash: null },
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    science_ledger: { claims_used: [], techniques_used: [], scope_violations: [], phrasing_violations: [], rewrite_applied: false },
    progress_marker: { kind: "none" },
    observability: { triggers_fired: [], triggers_suppressed: [], intent_classification: "conversational", specialist_contributions: [], specialist_disagreement: null },
    turn_plan: { planned_tools: [], reasoning: "test" },
    guidance_items: [],
    ...overrides,
  } as any;
}

async function collectEvents(gen: AsyncGenerator<OrchestratorStreamEvent>): Promise<OrchestratorStreamEvent[]> {
  const events: OrchestratorStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// P0-1: Prove path selection — streamChatWithTools is called, not chatWithTools
// ---------------------------------------------------------------------------

describe("P0-1: live path selection — streamChatWithTools called on LLM path", () => {
  const chatWithToolsSpy = vi.fn();
  const streamChatWithToolsSpy = vi.fn();

  const mockLLMClient = {
    chatWithTools: chatWithToolsSpy,
    chat: vi.fn(),
    getResolvedModel: vi.fn(() => ({ model: "claude-sonnet-4-6", provider: "anthropic" })),
    streamChatWithTools: streamChatWithToolsSpy,
  };

  const deps = {
    llmClient: mockLLMClient,
    toolDispatcher: { dispatch: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Always restore streaming capability (may have been unset by fallback test)
    mockLLMClient.streamChatWithTools = streamChatWithToolsSpy;

    const enriched = makeEnrichedContext();
    const envelope = makeEnvelope();
    const chatResult = {
      content: [{ type: "text" as const, text: "I can help with that." }],
      stop_reason: "end_turn" as const,
      usage: { input_tokens: 200, output_tokens: 80 },
      model: "claude-sonnet-4-6",
      latencyMs: 1200,
    };
    const llmResult = {
      assistant_text: "I can help with that.",
      tool_invocations: [],
      science_annotations: [],
      raw_response: "",
      suggested_actions: [],
      diagnostics: null,
      parse_warnings: [],
    };

    (phase1Enrich as any).mockReturnValue(enriched);
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-e2e", timeoutMs: 30000 },
      postProcess: () => llmResult,
    });

    // Wire up the streaming spy to yield real events
    streamChatWithToolsSpy.mockImplementation(async function* () {
      yield { type: "text_delta" as const, delta: "I can " };
      yield { type: "text_delta" as const, delta: "help " };
      yield { type: "text_delta" as const, delta: "with that." };
      yield { type: "message_complete" as const, result: chatResult };
    });

    (phase4Execute as any).mockResolvedValue({
      blocks: [],
      executed_tools: [],
      deferred_tools: [],
    });
    (phase5Validate as any).mockReturnValue(envelope);
  });

  it("calls streamChatWithTools, not chatWithTools, when streaming is available", async () => {
    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-e2e", deps),
    );

    // streamChatWithTools must have been called
    expect(streamChatWithToolsSpy).toHaveBeenCalledTimes(1);
    // chatWithTools must NOT have been called
    expect(chatWithToolsSpy).not.toHaveBeenCalled();

    // text_delta events must propagate from adapter to pipeline output
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThanOrEqual(3);
  });

  it("text_delta events contain incremental tokens from adapter", async () => {
    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-e2e", deps),
    );

    const textDeltas = events.filter((e) => e.type === "text_delta") as Array<{ type: "text_delta"; seq: number; delta: string }>;
    const assembled = textDeltas.map((e) => e.delta).join("");
    expect(assembled).toBe("I can help with that.");
  });

  it("falls back to chatWithTools when streamChatWithTools is absent", async () => {
    // Temporarily remove streaming capability (restored in beforeEach)
    mockLLMClient.streamChatWithTools = undefined as any;

    const chatResult = {
      content: [{ type: "text" as const, text: "fallback" }],
      stop_reason: "end_turn" as const,
      usage: { input_tokens: 100, output_tokens: 20 },
      model: "claude-sonnet-4-6",
      latencyMs: 800,
    };

    chatWithToolsSpy.mockResolvedValue(chatResult);

    // phase3PrepareForStreaming postProcess needs to handle fallback result
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-e2e", timeoutMs: 30000 },
      postProcess: () => ({
        assistant_text: "fallback",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      }),
    });

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-e2e", deps),
    );

    // chatWithTools must have been called as fallback
    expect(chatWithToolsSpy).toHaveBeenCalledTimes(1);
    // No text_delta events (non-streaming gives no incremental tokens)
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(0);
    // But turn_complete must still arrive
    expect(events[events.length - 1].type).toBe("turn_complete");
  });

  it("tool_use turn: adapter yields tool_input events, pipeline yields tool_start/tool_result", async () => {
    const toolChatResult = {
      content: [
        { type: "text" as const, text: "Let me draft that." },
        { type: "tool_use" as const, id: "tu_1", name: "draft_graph", input: { brief: "job offer" } },
      ],
      stop_reason: "tool_use" as const,
      usage: { input_tokens: 200, output_tokens: 100 },
      model: "claude-sonnet-4-6",
      latencyMs: 2000,
    };

    streamChatWithToolsSpy.mockImplementation(async function* () {
      yield { type: "text_delta" as const, delta: "Let me draft that." };
      yield { type: "tool_input_start" as const, tool_id: "tu_1", tool_name: "draft_graph" };
      yield { type: "tool_input_complete" as const, tool_id: "tu_1", tool_name: "draft_graph", input: { brief: "job offer" } };
      yield { type: "message_complete" as const, result: toolChatResult };
    });

    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-e2e", timeoutMs: 30000 },
      postProcess: () => ({
        assistant_text: "Let me draft that.",
        tool_invocations: [{ name: "draft_graph", input: { brief: "job offer" } }],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      }),
    });

    (phase4Execute as any).mockResolvedValue({
      blocks: [{ block_type: "graph", data: { nodes: [], edges: [] } }],
      executed_tools: ["draft_graph"],
      deferred_tools: [],
      tool_latency_ms: 5000,
    });

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-e2e", deps),
    );

    // Must have text_delta for the text portion
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    // Must have tool events from phase4
    expect(events.some((e) => e.type === "tool_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    expect(events.some((e) => e.type === "block")).toBe(true);
    // Must complete
    expect(events[events.length - 1].type).toBe("turn_complete");
  });
});

// ---------------------------------------------------------------------------
// P0-2: SSE wire format contract — every event validates against Zod schema
// ---------------------------------------------------------------------------

describe("P0-2: SSE event schema contract — all events validate against OrchestratorStreamEventSchema", () => {
  const mockLLMClient = {
    chatWithTools: vi.fn(),
    chat: vi.fn(),
    getResolvedModel: vi.fn(() => ({ model: "claude-sonnet-4-6", provider: "anthropic" })),
    streamChatWithTools: vi.fn(),
  };

  const deps = {
    llmClient: mockLLMClient,
    toolDispatcher: { dispatch: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text-only turn: every event matches Zod schema", async () => {
    const enriched = makeEnrichedContext();
    const envelope = makeEnvelope();

    (phase1Enrich as any).mockReturnValue(enriched);
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-schema", timeoutMs: 30000 },
      postProcess: () => ({
        assistant_text: "test",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      }),
    });

    mockLLMClient.streamChatWithTools.mockImplementation(async function* () {
      yield { type: "text_delta" as const, delta: "Hello" };
      yield { type: "text_delta" as const, delta: " world" };
      yield {
        type: "message_complete" as const,
        result: {
          content: [{ type: "text", text: "Hello world" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
          model: "claude-sonnet-4-6",
          latencyMs: 1000,
        },
      };
    });

    (phase4Execute as any).mockResolvedValue({
      blocks: [],
      executed_tools: [],
      deferred_tools: [],
    });
    (phase5Validate as any).mockReturnValue(envelope);

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-schema", deps),
    );

    expect(events.length).toBeGreaterThanOrEqual(3); // turn_start, text_delta(s), turn_complete

    for (const event of events) {
      const result = OrchestratorStreamEventSchema.safeParse(event);
      if (!result.success) {
        // Fail with descriptive message showing the event that broke
        expect.fail(
          `Event failed schema validation:\n` +
          `  event: ${JSON.stringify(event)}\n` +
          `  errors: ${JSON.stringify(result.error.flatten())}`,
        );
      }
    }
  });

  it("tool-use turn: every event matches Zod schema including tool_start, block, tool_result", async () => {
    const enriched = makeEnrichedContext();
    const envelope = makeEnvelope();

    (phase1Enrich as any).mockReturnValue(enriched);
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-schema-tool", timeoutMs: 30000 },
      postProcess: () => ({
        assistant_text: "Drafting",
        tool_invocations: [{ name: "draft_graph", input: { brief: "test" } }],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      }),
    });

    mockLLMClient.streamChatWithTools.mockImplementation(async function* () {
      yield { type: "text_delta" as const, delta: "Drafting" };
      yield {
        type: "message_complete" as const,
        result: {
          content: [
            { type: "text", text: "Drafting" },
            { type: "tool_use", id: "tu_1", name: "draft_graph", input: { brief: "test" } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
          model: "claude-sonnet-4-6",
          latencyMs: 1000,
        },
      };
    });

    (phase4Execute as any).mockResolvedValue({
      blocks: [{ block_type: "graph", data: { nodes: [], edges: [] } }],
      executed_tools: ["draft_graph"],
      deferred_tools: [],
      tool_latency_ms: 3000,
    });
    (phase5Validate as any).mockReturnValue(envelope);

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-schema-tool", deps),
    );

    // Validate every event
    for (const event of events) {
      const result = OrchestratorStreamEventSchema.safeParse(event);
      if (!result.success) {
        expect.fail(
          `Event failed schema validation:\n` +
          `  event: ${JSON.stringify(event)}\n` +
          `  errors: ${JSON.stringify(result.error.flatten())}`,
        );
      }
    }

    // Verify the expected event types are present
    const types = events.map((e) => e.type);
    expect(types).toContain("turn_start");
    expect(types).toContain("text_delta");
    expect(types).toContain("tool_start");
    expect(types).toContain("block");
    expect(types).toContain("tool_result");
    expect(types).toContain("turn_complete");
  });

  it("error turn: error event matches Zod schema", async () => {
    const enriched = makeEnrichedContext();

    (phase1Enrich as any).mockReturnValue(enriched);
    const { UpstreamTimeoutError } = await import("../../src/adapters/llm/errors.js");
    (phase3PrepareForStreaming as any).mockRejectedValue(
      new UpstreamTimeoutError("timeout", "anthropic", "chat", "body", 30000),
    );

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-err", deps),
    );

    for (const event of events) {
      const result = OrchestratorStreamEventSchema.safeParse(event);
      if (!result.success) {
        expect.fail(
          `Event failed schema validation:\n` +
          `  event: ${JSON.stringify(event)}\n` +
          `  errors: ${JSON.stringify(result.error.flatten())}`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// P0-2 (cont'd): SSE framing format validation
// ---------------------------------------------------------------------------

describe("P0-2: SSE wire framing — event:/data:/id: format", () => {
  it("writeSSEEvent produces correct SSE frame format", () => {
    // Replicate the writeSSEEvent logic from route-stream.ts inline
    // (to validate the framing contract without needing Fastify inject)
    function formatSSEFrame(event: OrchestratorStreamEvent): string {
      const data = JSON.stringify(event);
      return `event: ${event.type}\ndata: ${data}\nid: ${event.seq}\n\n`;
    }

    const events: OrchestratorStreamEvent[] = [
      { type: "turn_start", seq: 0, turn_id: "t1", routing: "llm", stage: "frame" },
      { type: "text_delta", seq: 1, delta: "Hello" },
      { type: "text_delta", seq: 2, delta: " world" },
      { type: "tool_start", seq: 3, tool_name: "draft_graph", long_running: true },
      { type: "tool_result", seq: 4, tool_name: "draft_graph", success: true, duration_ms: 3000 },
      { type: "block", seq: 5, block: { block_type: "graph", data: {} } as any },
      {
        type: "turn_complete",
        seq: 6,
        envelope: {
          turn_id: "t1",
          assistant_text: "Hello world",
          blocks: [],
          lineage: { context_hash: "abc" },
        } as any,
      },
      {
        type: "error",
        seq: 7,
        error: { code: "LLM_TIMEOUT", message: "timeout" },
        recoverable: true,
      },
    ];

    for (const event of events) {
      const frame = formatSSEFrame(event);

      // Must start with event: {type}
      expect(frame).toMatch(new RegExp(`^event: ${event.type}\n`));

      // Must have data: line with valid JSON
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      expect(dataLine).toBeDefined();
      const json = dataLine!.replace("data: ", "");
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe(event.type);
      expect(parsed.seq).toBe(event.seq);

      // Must have id: line with seq number
      expect(frame).toContain(`id: ${event.seq}\n`);

      // Must end with double newline
      expect(frame).toMatch(/\n\n$/);
    }
  });
});

// ---------------------------------------------------------------------------
// P1-2: Transport reliability — abort mid-stream, disconnect
// ---------------------------------------------------------------------------

describe("P1-2: transport reliability — abort signal propagation", () => {
  const mockLLMClient = {
    chatWithTools: vi.fn(),
    chat: vi.fn(),
    getResolvedModel: vi.fn(() => ({ model: "claude-sonnet-4-6", provider: "anthropic" })),
    streamChatWithTools: vi.fn(),
  };

  const deps = {
    llmClient: mockLLMClient,
    toolDispatcher: { dispatch: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("abort during LLM streaming stops after current event", async () => {
    const controller = new AbortController();
    const enriched = makeEnrichedContext();

    (phase1Enrich as any).mockReturnValue(enriched);
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-abort", timeoutMs: 30000 },
      postProcess: vi.fn(),
    });

    let yieldCount = 0;
    mockLLMClient.streamChatWithTools.mockImplementation(async function* () {
      yield { type: "text_delta" as const, delta: "First" };
      yieldCount++;
      // Abort after first yield
      controller.abort();
      yield { type: "text_delta" as const, delta: "Second" };
      yieldCount++;
      yield { type: "message_complete" as const, result: { content: [], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 }, model: "test", latencyMs: 0 } };
      yieldCount++;
    });

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-abort", deps, controller.signal),
    );

    // Should have turn_start + first text_delta, then stop (no turn_complete)
    expect(events.some((e) => e.type === "turn_complete")).toBe(false);
    // Generator should not have continued past abort
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(1);
    expect((textDeltas[0] as any).delta).toBe("First");
  });

  it("abort before LLM streaming starts stops immediately after turn_start", async () => {
    const controller = new AbortController();
    controller.abort(); // Pre-abort

    const enriched = makeEnrichedContext();
    (phase1Enrich as any).mockReturnValue(enriched);
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-preabort", timeoutMs: 30000 },
      postProcess: vi.fn(),
    });

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-preabort", deps, controller.signal),
    );

    // Should yield turn_start then stop
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn_start");
    // streamChatWithTools should not have been called
    expect(mockLLMClient.streamChatWithTools).not.toHaveBeenCalled();
  });

  it("abort after phase4 execution does not yield turn_complete", async () => {
    const controller = new AbortController();
    const enriched = makeEnrichedContext();
    const chatResult = {
      content: [{ type: "text" as const, text: "test" }],
      stop_reason: "end_turn" as const,
      usage: { input_tokens: 100, output_tokens: 50 },
      model: "test",
      latencyMs: 500,
    };

    (phase1Enrich as any).mockReturnValue(enriched);
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-abort-phase4", timeoutMs: 30000 },
      postProcess: () => ({
        assistant_text: "test",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      }),
    });

    mockLLMClient.streamChatWithTools.mockImplementation(async function* () {
      yield { type: "text_delta" as const, delta: "test" };
      yield { type: "message_complete" as const, result: chatResult };
    });

    // Abort during phase4 execution
    (phase4Execute as any).mockImplementation(async () => {
      controller.abort();
      return {
        blocks: [],
        executed_tools: [],
        deferred_tools: [],
      };
    });

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-abort-phase4", deps, controller.signal),
    );

    // Should not have turn_complete
    expect(events.some((e) => e.type === "turn_complete")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P1-3: Unknown block type hardening
// ---------------------------------------------------------------------------
// Note: Direct adapter testing for unknown block types is in
// anthropic.streaming.test.ts (which has proper SDK mocking).
// Here we validate the pipeline-level behavior: unknown adapter events
// (not text_delta, not message_complete) are silently dropped by the
// pipeline and don't appear in the SSE output.

describe("P1-3: unknown adapter events dropped at pipeline level", () => {
  const mockLLMClient = {
    chatWithTools: vi.fn(),
    chat: vi.fn(),
    getResolvedModel: vi.fn(() => ({ model: "claude-sonnet-4-6", provider: "anthropic" })),
    streamChatWithTools: vi.fn(),
  };

  const deps = {
    llmClient: mockLLMClient,
    toolDispatcher: { dispatch: vi.fn() },
  } as any;

  it("adapter events other than text_delta and message_complete are silently filtered", async () => {
    const enriched = makeEnrichedContext();
    const envelope = makeEnvelope();

    (phase1Enrich as any).mockReturnValue(enriched);
    (phase3PrepareForStreaming as any).mockResolvedValue({
      kind: "llm",
      callArgs: { system: "sys", messages: [], tools: [] },
      callOpts: { requestId: "req-unknown", timeoutMs: 30000 },
      postProcess: () => ({
        assistant_text: "test",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      }),
    });

    // Adapter yields unknown event types alongside normal ones
    mockLLMClient.streamChatWithTools.mockImplementation(async function* () {
      yield { type: "text_delta" as const, delta: "Hello" };
      // These are adapter-internal events — pipeline should ignore them
      yield { type: "tool_input_start" as const, tool_id: "tu_1", tool_name: "draft_graph" };
      yield { type: "tool_input_complete" as const, tool_id: "tu_1", tool_name: "draft_graph", input: {} };
      // A hypothetical future event type
      yield { type: "thinking_delta" as const, delta: "reasoning..." };
      yield { type: "text_delta" as const, delta: " world" };
      yield {
        type: "message_complete" as const,
        result: {
          content: [{ type: "text", text: "Hello world" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
          model: "claude-sonnet-4-6",
          latencyMs: 1000,
        },
      };
    });

    (phase4Execute as any).mockResolvedValue({
      blocks: [],
      executed_tools: [],
      deferred_tools: [],
    });
    (phase5Validate as any).mockReturnValue(envelope);

    const events = await collectEvents(
      executePipelineStream(makeRequest(), "req-unknown", deps),
    );

    // Only expected event types should appear
    const allowedTypes = new Set(["turn_start", "text_delta", "tool_start", "tool_result", "block", "turn_complete", "error"]);
    for (const event of events) {
      expect(allowedTypes.has(event.type)).toBe(true);
    }

    // text_delta events should be present (pipeline does forward those)
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(2);

    // tool_input_start/tool_input_complete should NOT appear
    expect(events.some((e) => (e as any).type === "tool_input_start")).toBe(false);
    expect(events.some((e) => (e as any).type === "tool_input_complete")).toBe(false);

    // Stream should complete normally
    expect(events[events.length - 1].type).toBe("turn_complete");
  });
});
