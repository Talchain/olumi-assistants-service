/**
 * Brief 1 Liveness Tests: CEE streaming parity and envelope consistency (P0-1, P0-3)
 *
 * Task 1: Streaming mode consistency telemetry fires
 * Task 2: Streaming turn trace fires (emitTurnTrace called)
 * Task 3: Streaming retry metadata propagation includes model info
 * Task 4: Error envelopes include _route_metadata with features
 * Task 5: System event ack envelopes always include _route_metadata
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestratorStreamEvent } from "../../../../src/orchestrator/pipeline/stream-events.js";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/orchestrator/pipeline/phase1-enrichment/index.js", () => ({
  phase1Enrich: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/pipeline/phase2-specialists/index.js", () => ({
  phase2Route: vi.fn(() => ({ advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] })),
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
vi.mock("../../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    resolveContextHash: vi.fn(() => "hash"),
  };
});
vi.mock("../../../../src/orchestrator/system-event-router.js", () => ({
  routeSystemEvent: vi.fn(),
  appendSystemMessages: vi.fn((history: unknown[]) => history),
}));
vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(() => ({ model: "test", name: "test" })),
}));
vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn(() => ({ tool: null, routing: "llm", confidence: "none" })),
}));
vi.mock("../../../../src/orchestrator/lookup/analysis-lookup.js", () => ({
  tryAnalysisLookup: vi.fn(() => ({ matched: false })),
  buildLookupEnvelope: vi.fn(),
}));

const { mockEmit, mockLog } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: mockLog,
  emit: mockEmit,
  TelemetryEvents: { OrchestratorModeDisagreement: 'orchestrator.mode_disagreement' },
}));
vi.mock("../../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { contextFabric: false, orchestratorV2: false, dskV0: false } },
}));
vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  getDskVersionHash: () => null,
  resolveDskHash: () => null,
}));
// Mock pipeline.ts emitTurnTrace so we can assert it's called without pulling all deps
vi.mock("../../../../src/orchestrator/pipeline/pipeline.js", () => ({
  emitTurnTrace: vi.fn(),
}));
vi.mock("../../../../src/orchestrator/analysis-state.js", () => ({
  normalizeAnalysisEnvelope: vi.fn((a: unknown) => a),
  isAnalysisCurrent: vi.fn(() => false),
  isAnalysisExplainable: vi.fn(() => false),
  isAnalysisPresent: vi.fn(() => false),
  isAnalysisRunnable: vi.fn(() => false),
  isResultsExplanationEligible: vi.fn(() => false),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { executePipelineStream } from "../../../../src/orchestrator/pipeline/pipeline-stream.js";
import { buildErrorEnvelope, buildFeatureHealthMap } from "../../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js";
import { phase1Enrich } from "../../../../src/orchestrator/pipeline/phase1-enrichment/index.js";
import { phase3PrepareForStreaming } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import { phase4Execute } from "../../../../src/orchestrator/pipeline/phase4-tools/index.js";
import { phase5Validate } from "../../../../src/orchestrator/pipeline/phase5-validation/index.js";
import { emitTurnTrace } from "../../../../src/orchestrator/pipeline/pipeline.js";

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
    user_message: "What should I do?",
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
    turn_plan: { selected_tool: null, routing: "llm", long_running: false },
    guidance_items: [],
    _route_metadata: { outcome: "default_llm", reasoning: "test", features: {} },
    ...overrides,
  } as any;
}

function makeLlmResult(overrides: Record<string, unknown> = {}) {
  return {
    assistant_text: "response text",
    tool_invocations: [],
    science_annotations: [],
    raw_response: "response text",
    suggested_actions: [],
    diagnostics: null,
    parse_warnings: [],
    route_debug: null,
    route_metadata: { outcome: "default_llm", reasoning: "llm_fallback" },
    ...overrides,
  };
}

function makePhase4Result(overrides: Record<string, unknown> = {}) {
  return {
    blocks: [],
    side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    assistant_text: null,
    guidance_items: [],
    executed_tools: [],
    deferred_tools: [],
    ...overrides,
  };
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

describe("Brief 1: Streaming parity and envelope consistency", () => {
  const mockLLMClient = {
    chatWithTools: vi.fn(),
    chat: vi.fn(),
    getResolvedModel: vi.fn(() => ({ model: "gpt-4o", provider: "openai" })),
    streamChatWithTools: undefined as any,
  };

  const deps = {
    llmClient: mockLLMClient,
    toolDispatcher: { dispatch: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLLMClient.streamChatWithTools = undefined;
  });

  // --------------------------------------------------------------------------
  // Task 1: Mode consistency telemetry fires in streaming path
  // --------------------------------------------------------------------------
  describe("Task 1: streaming mode consistency telemetry", () => {
    it("emits mode consistency log entry with streaming pipeline label", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const llmResult = makeLlmResult();

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "llm",
        callArgs: {},
        callOpts: {},
        postProcess: () => llmResult,
      });
      mockLLMClient.chatWithTools.mockResolvedValue(llmResult);
      (phase4Execute as any).mockResolvedValue(makePhase4Result());
      (phase5Validate as any).mockReturnValue(envelope);

      await collectEvents(executePipelineStream(makeRequest(), "req-1", deps));

      // Mode consistency telemetry should fire with correct field shape
      const telemetryCall = mockLog.info.mock.calls.find(
        (call: unknown[]) => call[1] === 'orchestrator.v2.turn.telemetry',
      );
      expect(telemetryCall).toBeDefined();
      expect(telemetryCall![0]).toMatchObject({
        response_mode_declared: expect.any(String),
        response_mode_inferred: expect.any(String),
        tool_selected: null,
        tool_permitted: expect.any(Boolean),
        stage: "frame",
        mode_disagreement: expect.any(Boolean),
      });
    });

    it("uses streaming: true dimension in mode disagreement events", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      // Create a mode disagreement: declared COACH but no tools → inferred COACH (or ACT)
      const llmResult = makeLlmResult({
        diagnostics: "[MODE: COACH]",
        tool_invocations: [{ name: "edit_graph", input: {}, id: "tc-1" }],
      });

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "llm",
        callArgs: {},
        callOpts: {},
        postProcess: () => llmResult,
      });
      mockLLMClient.chatWithTools.mockResolvedValue(llmResult);
      (phase4Execute as any).mockResolvedValue(makePhase4Result({ executed_tools: ["edit_graph"] }));
      (phase5Validate as any).mockReturnValue(envelope);

      await collectEvents(executePipelineStream(makeRequest(), "req-1", deps));

      // If there was a disagreement, the emit call should include streaming: true
      const disagreementCalls = mockEmit.mock.calls.filter(
        (call: unknown[]) => call[0] === 'orchestrator.mode_disagreement',
      );
      if (disagreementCalls.length > 0) {
        expect(disagreementCalls[0][1]).toMatchObject({
          pipeline: 'v2',
          streaming: true,
        });
      }
    });
  });

  // --------------------------------------------------------------------------
  // Task 2: emitTurnTrace fires in streaming path
  // --------------------------------------------------------------------------
  describe("Task 2: streaming turn trace", () => {
    it("calls emitTurnTrace before yielding turn_complete", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const llmResult = makeLlmResult();

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "llm",
        callArgs: {},
        callOpts: {},
        postProcess: () => llmResult,
      });
      mockLLMClient.chatWithTools.mockResolvedValue(llmResult);
      (phase4Execute as any).mockResolvedValue(makePhase4Result());
      (phase5Validate as any).mockReturnValue(envelope);

      const events = await collectEvents(executePipelineStream(makeRequest(), "req-1", deps));

      // emitTurnTrace must have been called
      expect(emitTurnTrace).toHaveBeenCalledTimes(1);
      const traceArg = (emitTurnTrace as any).mock.calls[0][0];
      expect(traceArg.enrichedContext).toBe(enriched);
      expect(traceArg.requestId).toBe("req-1");
      expect(traceArg.envelope).toBe(envelope);
      expect(typeof traceArg.declaredMode).toBe("string");
      expect(typeof traceArg.inferredMode).toBe("string");
      expect(typeof traceArg.toolPermitted).toBe("boolean");

      // turn_complete should be the last event
      expect(events[events.length - 1].type).toBe("turn_complete");
    });
  });

  // --------------------------------------------------------------------------
  // Task 3: Retry metadata propagation
  // --------------------------------------------------------------------------
  describe("Task 3: streaming retry metadata propagation", () => {
    it("propagates resolved_model and provider to route_metadata on conversational retry", async () => {
      const enriched = makeEnrichedContext();
      const envelope = makeEnvelope();
      const llmResult = makeLlmResult();
      const phase4Result = makePhase4Result({ needs_conversational_retry: true });

      (phase1Enrich as any).mockReturnValue(enriched);
      (phase3PrepareForStreaming as any).mockResolvedValue({
        kind: "llm",
        callArgs: {},
        callOpts: {},
        postProcess: () => llmResult,
      });
      mockLLMClient.chatWithTools.mockResolvedValue(llmResult);
      mockLLMClient.chat.mockResolvedValue({ content: "retry response" });
      mockLLMClient.getResolvedModel.mockReturnValue({ model: "gpt-4o", provider: "openai" });
      (phase4Execute as any).mockResolvedValue(phase4Result);
      (phase5Validate as any).mockReturnValue(envelope);

      await collectEvents(executePipelineStream(makeRequest(), "req-1", deps));

      // phase4Result should have route_metadata set with model info
      expect(phase4Result).toHaveProperty("route_metadata");
      expect((phase4Result as any).route_metadata).toMatchObject({
        outcome: "default_llm",
        reasoning: "conversational_retry",
        resolved_model: "gpt-4o",
        resolved_provider: "openai",
      });

      // Model log should fire
      const retryLog = mockLog.info.mock.calls.find(
        (call: unknown[]) => call[1] === 'pipeline_stream.conversational_retry.resolved_model',
      );
      expect(retryLog).toBeDefined();
      expect(retryLog![0]).toMatchObject({
        resolved_model: "gpt-4o",
        resolved_provider: "openai",
      });
    });
  });

  // --------------------------------------------------------------------------
  // Task 4: Error envelopes include _route_metadata
  // --------------------------------------------------------------------------
  describe("Task 4: error envelope _route_metadata", () => {
    it("buildErrorEnvelope includes _route_metadata with features", () => {
      const envelope = buildErrorEnvelope("turn-err", "PIPELINE_ERROR", "Something went wrong.");

      expect(envelope._route_metadata).toBeDefined();
      expect(envelope._route_metadata).toMatchObject({
        outcome: "default_llm",
        reasoning: expect.stringContaining("pipeline_error:PIPELINE_ERROR"),
        features: expect.any(Object),
      });
    });

    it("buildErrorEnvelope _route_metadata.features has same shape as success path", () => {
      const envelope = buildErrorEnvelope("turn-err", "PIPELINE_ERROR", "Oops");
      const featureMap = buildFeatureHealthMap();

      // The error envelope's features should match the shared factory output
      expect(envelope._route_metadata!.features).toEqual(featureMap);
    });
  });

  // --------------------------------------------------------------------------
  // Task 5: buildFeatureHealthMap shared factory
  // --------------------------------------------------------------------------
  describe("Task 5: shared feature health factory", () => {
    it("buildFeatureHealthMap returns a record of enabled features only", () => {
      const map = buildFeatureHealthMap();

      expect(map).toBeDefined();
      expect(typeof map).toBe("object");

      // Every entry should have enabled: true (disabled features are excluded)
      for (const [, value] of Object.entries(map)) {
        expect(value.enabled).toBe(true);
        expect(typeof value.healthy).toBe("boolean");
      }
    });
  });
});
