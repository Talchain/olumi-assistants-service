import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OrchestratorStreamEvent } from "../../../../src/orchestrator/pipeline/stream-events.js";
import { OrchestratorStreamEventSchema } from "../../../../src/orchestrator/pipeline/stream-events.js";

// Mock dependencies before imports
vi.mock("../../../../src/orchestrator/pipeline/phase1-enrichment/index.js", () => ({
  phase1Enrich: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/pipeline/phase2-specialists/index.js", () => ({
  phase2Route: vi.fn(() => ({ contributions: [] })),
}));
vi.mock("../../../../src/orchestrator/pipeline/phase3-llm/index.js", () => ({
  phase3Generate: vi.fn(),
  phase3PrepareForStreaming: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js", () => ({
  assembleV2SystemPrompt: vi.fn(async () => ({ text: "system prompt", cache_blocks: [{ type: 'text', text: 'system prompt' }] })),
}));
vi.mock("../../../../src/orchestrator/pipeline/phase4-tools/index.js", () => ({
  phase4Execute: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/pipeline/phase5-validation/index.js", () => ({
  phase5Validate: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js", () => ({
  buildErrorEnvelope: vi.fn(),
  resolveContextHash: vi.fn(() => "hash"),
}));
vi.mock("../../../../src/orchestrator/system-event-router.js", () => ({
  routeSystemEvent: vi.fn(),
  appendSystemMessages: vi.fn(),
}));
vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(() => ({ model: "test", name: "test" })),
}));
vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn(() => ({ tool: null, routing: "llm", confidence: "none" })),
}));
vi.mock("../../../../src/orchestrator/tools/registry.js", () => ({
  isLongRunningTool: vi.fn((name: string) => ['run_analysis', 'draft_graph'].includes(name)),
}));
vi.mock("../../../../src/orchestrator/lookup/analysis-lookup.js", () => ({
  tryAnalysisLookup: vi.fn(() => ({ matched: false })),
  buildLookupEnvelope: vi.fn(),
}));
vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));
vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: { contextFabric: false, diagnosticTraceEnabled: false, artefactAppendixEnabled: false },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    cee: { anthropicStructuredOutputs: false },
  },
}));

import { executePipelineStream } from "../../../../src/orchestrator/pipeline/pipeline-stream.js";
import { phase1Enrich } from "../../../../src/orchestrator/pipeline/phase1-enrichment/index.js";
import { phase3PrepareForStreaming } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import { phase4Execute } from "../../../../src/orchestrator/pipeline/phase4-tools/index.js";
import { phase5Validate } from "../../../../src/orchestrator/pipeline/phase5-validation/index.js";

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    message: "What should I do?",
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: "frame", goal: "test" },
      messages: [],
      selected_elements: [],
      scenario_id: "test-scenario",
      analysis_inputs: null,
    },
    scenario_id: "test-scenario",
    client_turn_id: "turn-1",
    ...overrides,
  } as any;
}

function makeEnrichedContext(overrides: Record<string, unknown> = {}) {
  return {
    turn_id: "turn-123",
    graph: null,
    analysis: null,
    framing: { stage: "frame", goal: "test" },
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    conversational_state: {},
    scenario_id: "test-scenario",
    dsk: { version_hash: null, bundle: null },
    ...overrides,
  } as any;
}

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    turn_id: "turn-123",
    assistant_text: "Test response",
    blocks: [],
    suggested_actions: [],
    lineage: { context_hash: "abc", dsk_version_hash: null },
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

// ============================================================================
// Tests
// ============================================================================

describe("executePipelineStream", () => {
  const mockLLMClient = {
    chatWithTools: vi.fn(),
    chat: vi.fn(),
    getResolvedModel: vi.fn(() => ({ model: "test-model", provider: "test" })),
    streamChatWithTools: undefined as any,
  };

  const mockToolDispatcher = {
    dispatch: vi.fn(),
  };

  const deps = {
    llmClient: mockLLMClient,
    toolDispatcher: mockToolDispatcher,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLLMClient.streamChatWithTools = undefined;
  });

  describe("deterministic path", () => {
    it("yields turn_start → turn_complete for deterministic result", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const llmResult = {
        assistant_text: "deterministic answer",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      };

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "deterministic",
        result: llmResult,
      });
      (phase4Execute as any).mockResolvedValue({
        blocks: [],
        executed_tools: [],
        deferred_tools: [],
      });
      (phase5Validate as any).mockReturnValue(envelope);

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      expect(events[0].type).toBe("turn_start");
      expect(events[0]).toMatchObject({
        type: "turn_start",
        seq: 0,
        turn_id: "turn-123",
        routing: "deterministic",
        stage: "frame",
      });
      expect(events[events.length - 1].type).toBe("turn_complete");
    });

    it("overrides intent gate to draft_graph when generate_model is true", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const llmResult = {
        assistant_text: "drafting",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      };

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "deterministic",
        result: llmResult,
      });
      (phase4Execute as any).mockResolvedValue({
        blocks: [],
        executed_tools: ["draft_graph"],
        deferred_tools: [],
      });
      (phase5Validate as any).mockReturnValue(envelope);

      const events = await collectEvents(
        executePipelineStream(makeRequest({ generate_model: true }), "req-1", deps),
      );

      expect(events[0]).toMatchObject({ type: "turn_start", routing: "deterministic" });
      expect(events[events.length - 1].type).toBe("turn_complete");

      // phase3PrepareForStreaming should have been called with intent gate overridden to draft_graph
      const prepCall = (phase3PrepareForStreaming as any).mock.calls[0];
      const intentGateArg = prepCall[5]; // 6th arg: initialIntentGate
      expect(intentGateArg.tool).toBe("draft_graph");
      expect(intentGateArg.matched_pattern).toBe("generate_model");
    });
  });

  describe("LLM path with streaming", () => {
    it("yields turn_start → text_delta* → turn_complete", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const chatResult = {
        content: [{ type: "text" as const, text: "Hello world" }],
        stop_reason: "end_turn" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "test",
        latencyMs: 500,
      };
      const llmResult = {
        assistant_text: "Hello world",
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
        callOpts: { requestId: "req-1", timeoutMs: 30000 },
        postProcess: () => llmResult,
      });

      // Set up streaming LLM client
      mockLLMClient.streamChatWithTools = async function* () {
        yield { type: "text_delta" as const, delta: "Hello " };
        yield { type: "text_delta" as const, delta: "world" };
        yield { type: "message_complete" as const, result: chatResult };
      };

      (phase4Execute as any).mockResolvedValue({
        blocks: [],
        executed_tools: [],
        deferred_tools: [],
      });
      (phase5Validate as any).mockReturnValue(envelope);

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      expect(events[0]).toMatchObject({ type: "turn_start", routing: "llm" });
      expect(events[1]).toMatchObject({ type: "text_delta", delta: "Hello " });
      expect(events[2]).toMatchObject({ type: "text_delta", delta: "world" });
      expect(events[events.length - 1].type).toBe("turn_complete");
    });
  });

  describe("LLM path with tool execution", () => {
    it("yields tool_start → block → tool_result events", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const chatResult = {
        content: [
          { type: "text" as const, text: "Running analysis" },
          { type: "tool_use" as const, id: "t1", name: "run_analysis", input: {} },
        ],
        stop_reason: "tool_use" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "test",
        latencyMs: 500,
      };
      const llmResult = {
        assistant_text: "Running analysis",
        tool_invocations: [{ name: "run_analysis", input: {} }],
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
        callOpts: { requestId: "req-1", timeoutMs: 30000 },
        postProcess: () => llmResult,
      });

      mockLLMClient.streamChatWithTools = async function* () {
        yield { type: "text_delta" as const, delta: "Running analysis" };
        yield { type: "message_complete" as const, result: chatResult };
      };

      const testBlock = { block_type: "analysis_summary", data: { status: "done" } };
      (phase4Execute as any).mockResolvedValue({
        blocks: [testBlock],
        executed_tools: ["run_analysis"],
        deferred_tools: [],
        tool_latency_ms: 3000,
      });
      (phase5Validate as any).mockReturnValue(envelope);

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      const types = events.map((e) => e.type);
      expect(types).toContain("tool_start");
      expect(types).toContain("block");
      expect(types).toContain("tool_result");

      const toolStart = events.find((e) => e.type === "tool_start") as any;
      expect(toolStart.tool_name).toBe("run_analysis");
      expect(toolStart.long_running).toBe(true);

      const toolResult = events.find((e) => e.type === "tool_result") as any;
      expect(toolResult.tool_name).toBe("run_analysis");
      expect(toolResult.success).toBe(true);
    });
  });

  describe("seq numbers", () => {
    it("are monotonically increasing", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "deterministic",
        result: {
          assistant_text: "test",
          tool_invocations: [],
          science_annotations: [],
          raw_response: "",
          suggested_actions: [],
          diagnostics: null,
          parse_warnings: [],
        },
      });
      (phase4Execute as any).mockResolvedValue({
        blocks: [],
        executed_tools: [],
        deferred_tools: [],
      });
      (phase5Validate as any).mockReturnValue(envelope);

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
      }
    });
  });

  describe("abort signal", () => {
    it("stops iteration when signal is aborted", async () => {
      const enriched = makeEnrichedContext();
      const controller = new AbortController();

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "llm",
        callArgs: { system: "sys", messages: [], tools: [] },
        callOpts: { requestId: "req-1", timeoutMs: 30000 },
        postProcess: vi.fn(),
      });

      mockLLMClient.streamChatWithTools = async function* () {
        yield { type: "text_delta" as const, delta: "Hello " };
        controller.abort();
        yield { type: "text_delta" as const, delta: "world" };
        yield { type: "message_complete" as const, result: {} as any };
      };

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps, controller.signal),
      );

      // Should have turn_start + first text_delta, then stop
      expect(events.length).toBeLessThanOrEqual(3);
      expect(events.some((e) => e.type === "turn_complete")).toBe(false);
    });
  });

  describe("block deduplication", () => {
    it("emits each block exactly once even with multiple executed tools", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const chatResult = {
        content: [{ type: "text" as const, text: "test" }],
        stop_reason: "end_turn" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "test",
        latencyMs: 500,
      };
      const llmResult = {
        assistant_text: "test",
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
        callOpts: { requestId: "req-1", timeoutMs: 30000 },
        postProcess: () => llmResult,
      });

      mockLLMClient.streamChatWithTools = async function* () {
        yield { type: "text_delta" as const, delta: "test" };
        yield { type: "message_complete" as const, result: chatResult };
      };

      const blockA = { block_type: "analysis_summary", data: { id: "a" } };
      const blockB = { block_type: "commentary", data: { id: "b" } };
      (phase4Execute as any).mockResolvedValue({
        blocks: [blockA, blockB],
        executed_tools: ["run_analysis", "explain_results"],
        deferred_tools: [],
        tool_latency_ms: 5000,
      });
      (phase5Validate as any).mockReturnValue(envelope);

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      const blockEvents = events.filter((e) => e.type === "block");
      expect(blockEvents).toHaveLength(2); // Not 4 (2 blocks × 2 tools)

      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts).toHaveLength(2);

      const toolResults = events.filter((e) => e.type === "tool_result");
      expect(toolResults).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("yields error event on LLM timeout", async () => {
      const enriched = makeEnrichedContext();

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockRejectedValue(
        new (await import("../../../../src/adapters/llm/errors.js")).UpstreamTimeoutError(
          "timed out", "anthropic", "chat_with_tools", "body", 30000,
        ),
      );

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      const errorEvent = events.find((e) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.code).toBe("LLM_TIMEOUT");
      expect(errorEvent.recoverable).toBe(true);
    });

    it("yields TOOL_ERROR on phase4 dispatch failure", async () => {
      const enriched = makeEnrichedContext();
      const chatResult = {
        content: [{ type: "text" as const, text: "test" }],
        stop_reason: "end_turn" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "test",
        latencyMs: 500,
      };
      const llmResult = {
        assistant_text: "test",
        tool_invocations: [{ name: "run_analysis", input: {} }],
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
        callOpts: { requestId: "req-1", timeoutMs: 30000 },
        postProcess: () => llmResult,
      });

      mockLLMClient.streamChatWithTools = async function* () {
        yield { type: "text_delta" as const, delta: "test" };
        yield { type: "message_complete" as const, result: chatResult };
      };

      (phase4Execute as any).mockRejectedValue(new Error("Tool dispatch failed: connection refused"));

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      const errorEvent = events.find((e) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.code).toBe("TOOL_ERROR");
      expect(errorEvent.recoverable).toBe(false);
    });

    it("yields TURN_BUDGET_EXCEEDED on AbortError", async () => {
      const enriched = makeEnrichedContext();

      (phase1Enrich as any).mockReturnValue(enriched);
      const abortError = new DOMException("signal is aborted", "AbortError");
      (phase3PrepareForStreaming as any).mockRejectedValue(abortError);

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      const errorEvent = events.find((e) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.code).toBe("TURN_BUDGET_EXCEEDED");
      expect(errorEvent.recoverable).toBe(true);
    });

    it("yields LLM_ERROR on UpstreamHTTPError", async () => {
      const enriched = makeEnrichedContext();

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockRejectedValue(
        new (await import("../../../../src/adapters/llm/errors.js")).UpstreamHTTPError(
          "API error", "anthropic", 500, undefined, undefined, 1000,
        ),
      );

      const events = await collectEvents(
        executePipelineStream(makeRequest(), "req-1", deps),
      );

      const errorEvent = events.find((e) => e.type === "error") as any;
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.code).toBe("LLM_ERROR");
      expect(errorEvent.recoverable).toBe(false);
    });
  });

  describe("state normalization", () => {
    it("folds analysis_state into context before calling phase1Enrich", async () => {
      const enriched = makeEnrichedContext({ stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" } });
      const envelope = makeEnvelope({ stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" } });
      const llmResult = {
        assistant_text: "Analysis explanation",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      };

      (phase1Enrich as ReturnType<typeof vi.fn>).mockReturnValue(enriched);
      (phase3PrepareForStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(llmResult);
      (phase5Validate as ReturnType<typeof vi.fn>).mockReturnValue(envelope);

      const freshAnalysis = {
        analysis_status: "completed",
        meta: { response_hash: "fresh", seed_used: 1, n_samples: 100 },
        results: [{ option_label: "A", win_probability: 0.7 }],
      };

      const request = makeRequest({
        context: {
          graph: { nodes: [{ id: "d1" }], edges: [] },
          analysis_response: null, // stale: null
          framing: null,
          messages: [],
          scenario_id: "test-scenario",
        },
        analysis_state: freshAnalysis,
      });

      await collectEvents(executePipelineStream(request, "req-norm", deps));

      // phase1Enrich should receive context with analysis_response set to freshAnalysis
      const enrichCall = (phase1Enrich as ReturnType<typeof vi.fn>).mock.calls[0];
      const passedContext = enrichCall[1];
      expect(passedContext.analysis_response).toBe(freshAnalysis);
    });

    it("analysis_state overrides stale context.analysis_response (freshness wins)", async () => {
      const enriched = makeEnrichedContext({ stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" } });
      const envelope = makeEnvelope();
      const llmResult = {
        assistant_text: "test",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      };

      (phase1Enrich as ReturnType<typeof vi.fn>).mockReturnValue(enriched);
      (phase3PrepareForStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(llmResult);
      (phase5Validate as ReturnType<typeof vi.fn>).mockReturnValue(envelope);

      const staleAnalysis = { analysis_status: "completed", meta: { response_hash: "stale" }, results: [] };
      const freshAnalysis = { analysis_status: "completed", meta: { response_hash: "fresh" }, results: [] };

      const request = makeRequest({
        context: {
          graph: { nodes: [{ id: "d1" }], edges: [] },
          analysis_response: staleAnalysis,
          framing: null,
          messages: [],
          scenario_id: "test-scenario",
        },
        analysis_state: freshAnalysis,
      });

      await collectEvents(executePipelineStream(request, "req-freshness", deps));

      const passedContext = (phase1Enrich as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(passedContext.analysis_response).toBe(freshAnalysis);
    });

    it("graph_state is folded into context before calling phase1Enrich", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const llmResult = {
        assistant_text: "test",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      };

      (phase1Enrich as ReturnType<typeof vi.fn>).mockReturnValue(enriched);
      (phase3PrepareForStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(llmResult);
      (phase5Validate as ReturnType<typeof vi.fn>).mockReturnValue(envelope);

      const freshGraph = { nodes: [{ id: "d1", kind: "decision" }], edges: [] };

      const request = makeRequest({
        context: {
          graph: null,
          analysis_response: null,
          framing: null,
          messages: [],
          scenario_id: "test-scenario",
        },
        graph_state: freshGraph,
      });

      await collectEvents(executePipelineStream(request, "req-graph-norm", deps));

      const passedContext = (phase1Enrich as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(passedContext.graph).toBe(freshGraph);
    });

    it("normalizes context.analysis_response when no top-level analysis_state is present", async () => {
      const enriched = makeEnrichedContext({ stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" } });
      const envelope = makeEnvelope({ stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" } });
      const llmResult = {
        assistant_text: "test",
        tool_invocations: [],
        science_annotations: [],
        raw_response: "",
        suggested_actions: [],
        diagnostics: null,
        parse_warnings: [],
      };

      (phase1Enrich as ReturnType<typeof vi.fn>).mockReturnValue(enriched);
      (phase3PrepareForStreaming as ReturnType<typeof vi.fn>).mockResolvedValue(llmResult);
      (phase5Validate as ReturnType<typeof vi.fn>).mockReturnValue(envelope);

      // Analysis without analysis_status but with valid results + meta
      const contextAnalysis = {
        meta: { response_hash: "ctx-hash", seed_used: 1, n_samples: 100 },
        results: [{ option_label: "A", win_probability: 0.7 }],
      };

      const request = makeRequest({
        context: {
          graph: { nodes: [{ id: "d1" }], edges: [] },
          analysis_response: contextAnalysis,
          framing: null,
          messages: [],
          scenario_id: "test-scenario",
        },
        // No top-level analysis_state
      });

      await collectEvents(executePipelineStream(request, "req-ctx-analysis", deps));

      const passedContext = (phase1Enrich as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Should be normalized with inferred analysis_status
      expect(passedContext.analysis_response).not.toBe(contextAnalysis); // new object via spread
      expect(passedContext.analysis_response.analysis_status).toBe("completed");
      expect(passedContext.analysis_response.meta.response_hash).toBe("ctx-hash");
    });
  });

  describe("progress events during tool execution", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function setupLLMPathWithTool(toolName: string) {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const chatResult = {
        content: [
          { type: "text" as const, text: "Working on it" },
          { type: "tool_use" as const, id: "t1", name: toolName, input: {} },
        ],
        stop_reason: "tool_use" as const,
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "test",
        latencyMs: 500,
      };
      const llmResult = {
        assistant_text: "Working on it",
        tool_invocations: [{ name: toolName, input: {} }],
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
        callOpts: { requestId: "req-1", timeoutMs: 30000 },
        postProcess: () => llmResult,
      });

      mockLLMClient.streamChatWithTools = async function* () {
        yield { type: "text_delta" as const, delta: "Working on it" };
        yield { type: "message_complete" as const, result: chatResult };
      };

      (phase5Validate as any).mockReturnValue(envelope);
      return { enriched, envelope };
    }

    it("emits progress events every 5s during long-running tool execution", async () => {
      setupLLMPathWithTool("draft_graph");

      // phase4Execute takes 12 seconds to complete
      let resolvePhase4!: (v: any) => void;
      (phase4Execute as any).mockReturnValue(new Promise(resolve => { resolvePhase4 = resolve; }));

      const events: OrchestratorStreamEvent[] = [];
      const gen = executePipelineStream(makeRequest(), "req-1", deps);

      // Start consuming the generator
      const done = (async () => {
        for await (const event of gen) {
          events.push(event);
        }
      })();

      // Let microtasks flush so we reach the phase4 await
      await vi.advanceTimersByTimeAsync(100);

      // Advance 5s — should get first progress event
      await vi.advanceTimersByTimeAsync(5000);
      const progressAfter5s = events.filter(e => e.type === 'progress');
      expect(progressAfter5s.length).toBeGreaterThanOrEqual(1);

      // Advance another 5s — should get second progress event
      await vi.advanceTimersByTimeAsync(5000);
      const progressAfter10s = events.filter(e => e.type === 'progress');
      expect(progressAfter10s.length).toBeGreaterThanOrEqual(2);

      // Resolve phase4
      resolvePhase4({
        blocks: [{ block_type: "graph_patch", data: {} }],
        executed_tools: ["draft_graph"],
        deferred_tools: [],
        tool_latency_ms: 12000,
      });

      await vi.advanceTimersByTimeAsync(100);
      await done;

      // Verify progress event shape
      const firstProgress = events.find(e => e.type === 'progress') as any;
      expect(firstProgress.tool_name).toBe("draft_graph");
      expect(firstProgress.elapsed_ms).toBeGreaterThanOrEqual(5000);
      expect(firstProgress.message).toBe("Building decision model\u2026");
    });

    it("no progress events for fast tool execution", async () => {
      setupLLMPathWithTool("draft_graph");

      // phase4Execute resolves immediately
      (phase4Execute as any).mockResolvedValue({
        blocks: [],
        executed_tools: ["draft_graph"],
        deferred_tools: [],
        tool_latency_ms: 50,
      });

      const events: OrchestratorStreamEvent[] = [];
      const gen = executePipelineStream(makeRequest(), "req-1", deps);
      const done = (async () => {
        for await (const event of gen) {
          events.push(event);
        }
      })();

      await vi.advanceTimersByTimeAsync(200);
      await done;

      const progressEvents = events.filter(e => e.type === 'progress');
      expect(progressEvents).toHaveLength(0);
    });

    it("full event ordering: tool_start → progress* → tool_result → block → turn_complete", async () => {
      setupLLMPathWithTool("draft_graph");

      let resolvePhase4!: (v: any) => void;
      (phase4Execute as any).mockReturnValue(new Promise(resolve => { resolvePhase4 = resolve; }));

      const events: OrchestratorStreamEvent[] = [];
      const gen = executePipelineStream(makeRequest(), "req-1", deps);
      const done = (async () => {
        for await (const event of gen) {
          events.push(event);
        }
      })();

      // Advance to get progress events
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      // Resolve phase4
      resolvePhase4({
        blocks: [{ block_type: "graph_patch", data: {} }],
        executed_tools: ["draft_graph"],
        deferred_tools: [],
        tool_latency_ms: 10500,
      });

      await vi.advanceTimersByTimeAsync(100);
      await done;

      const types = events.map(e => e.type);

      // Find indices for ordering verification
      const turnStartIdx = types.indexOf("turn_start");
      const firstTextDeltaIdx = types.indexOf("text_delta");
      const toolStartIdx = types.indexOf("tool_start");
      const firstProgressIdx = types.indexOf("progress");
      const lastProgressIdx = types.lastIndexOf("progress");
      const toolResultIdx = types.indexOf("tool_result");
      const blockIdx = types.indexOf("block");
      const turnCompleteIdx = types.indexOf("turn_complete");

      expect(turnStartIdx).toBeLessThan(firstTextDeltaIdx);
      expect(firstTextDeltaIdx).toBeLessThan(toolStartIdx);
      expect(toolStartIdx).toBeLessThan(firstProgressIdx);
      expect(lastProgressIdx).toBeLessThan(toolResultIdx);
      expect(toolResultIdx).toBeLessThan(blockIdx);
      expect(blockIdx).toBeLessThan(turnCompleteIdx);
    });

    it("abort during tool execution stops progress emission", async () => {
      setupLLMPathWithTool("draft_graph");

      const controller = new AbortController();

      (phase4Execute as any).mockReturnValue(new Promise(() => {})); // never resolves

      const events: OrchestratorStreamEvent[] = [];
      const gen = executePipelineStream(makeRequest(), "req-1", deps, controller.signal);
      const done = (async () => {
        for await (const event of gen) {
          events.push(event);
        }
      })();

      // Let it get to the phase4 call
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(5000);

      // Abort
      controller.abort();
      await vi.advanceTimersByTimeAsync(5100);
      await done;

      // Should NOT have turn_complete
      expect(events.some(e => e.type === "turn_complete")).toBe(false);
      // Should NOT have tool_result
      expect(events.some(e => e.type === "tool_result")).toBe(false);
    });

    it("progress events share the same seq counter as other events", async () => {
      setupLLMPathWithTool("draft_graph");

      let resolvePhase4!: (v: any) => void;
      (phase4Execute as any).mockReturnValue(new Promise(resolve => { resolvePhase4 = resolve; }));

      const events: OrchestratorStreamEvent[] = [];
      const gen = executePipelineStream(makeRequest(), "req-1", deps);
      const done = (async () => {
        for await (const event of gen) {
          events.push(event);
        }
      })();

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(5000);

      resolvePhase4({
        blocks: [],
        executed_tools: ["draft_graph"],
        deferred_tools: [],
        tool_latency_ms: 5500,
      });

      await vi.advanceTimersByTimeAsync(100);
      await done;

      // All seq numbers must be monotonically increasing
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
      }
    });

    it("turn_complete envelope is unchanged by progress events", async () => {
      const { envelope } = setupLLMPathWithTool("draft_graph");

      let resolvePhase4!: (v: any) => void;
      (phase4Execute as any).mockReturnValue(new Promise(resolve => { resolvePhase4 = resolve; }));

      const events: OrchestratorStreamEvent[] = [];
      const gen = executePipelineStream(makeRequest(), "req-1", deps);
      const done = (async () => {
        for await (const event of gen) {
          events.push(event);
        }
      })();

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(5000);

      resolvePhase4({
        blocks: [],
        executed_tools: ["draft_graph"],
        deferred_tools: [],
        tool_latency_ms: 5500,
      });

      await vi.advanceTimersByTimeAsync(100);
      await done;

      const turnComplete = events.find(e => e.type === "turn_complete") as any;
      expect(turnComplete).toBeDefined();
      expect(turnComplete.envelope.turn_id).toBe(envelope.turn_id);
      expect(turnComplete.envelope.assistant_text).toBe(envelope.assistant_text);
      expect(turnComplete.envelope.lineage).toEqual(envelope.lineage);
    });
  });

  describe("progress event Zod schema", () => {
    it("validates a well-formed progress event", () => {
      const result = OrchestratorStreamEventSchema.safeParse({
        type: "progress",
        seq: 5,
        tool_name: "draft_graph",
        elapsed_ms: 5000,
        message: "Building decision model\u2026",
      });
      expect(result.success).toBe(true);
    });

    it("rejects progress event with missing fields", () => {
      const result = OrchestratorStreamEventSchema.safeParse({
        type: "progress",
        seq: 5,
        // missing tool_name, elapsed_ms, message
      });
      expect(result.success).toBe(false);
    });
  });
});
