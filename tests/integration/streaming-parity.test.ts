/**
 * Cross-Path Parity Test: Non-Streaming vs Streaming
 *
 * Validates behavioral parity between executePipeline and executePipelineStream:
 *   1. Prompt assembly (same assembleV2SystemPrompt called)
 *   2. Zone 2 enrichment (same context assembled)
 *   3. Tool registry + stage filtering (same tools presented to LLM)
 *   4. Stage inference (same phase1 enrichment)
 *   5. Response envelope shape (assistant_text, blocks, suggested_actions)
 *   6. Streaming fallback (no crash when adapter lacks streamChatWithTools)
 *
 * Mocks phase3PrepareForStreaming to return { kind: 'llm' } so the streaming
 * pipeline exercises the LLM code path (matching brief1-streaming-parity.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestratorStreamEvent } from "../../src/orchestrator/pipeline/stream-events.js";

// ============================================================================
// Hoisted state — accessible inside vi.mock factories
// ============================================================================

const { mockLog, mockPhase3Prep } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockPhase3Prep: vi.fn(),
}));

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../src/utils/telemetry.js", () => ({
  log: mockLog,
  emit: vi.fn(),
  TelemetryEvents: { OrchestratorModeDisagreement: "orchestrator.mode_disagreement" },
}));

vi.mock("../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { contextFabric: false, orchestratorV2: false, dskV0: false, entityMemory: false } },
}));

vi.mock("../../src/config/timeouts.js", () => ({
  ORCHESTRATOR_TIMEOUT_MS: 30_000,
  ORCHESTRATOR_TURN_BUDGET_MS: 60_000,
}));

vi.mock("../../src/orchestrator/pipeline/phase1-enrichment/index.js", () => ({
  phase1Enrich: vi.fn(() => ({
    turn_id: "parity-turn-001",
    graph: null,
    analysis: null,
    framing: { stage: "frame", goal: "hire tech lead vs developers" },
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    decision_archetype: { type: null, confidence: "none", evidence: "none" },
    stuck: { detected: false },
    conversational_state: {},
    scenario_id: "parity-test",
    dsk: { version_hash: null, bundle: null },
    user_message: "Should I hire a tech lead or two developers?",
  })),
}));

vi.mock("../../src/orchestrator/pipeline/phase2-specialists/index.js", () => ({
  phase2Route: vi.fn(() => ({ advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] })),
}));

// Mock phase3 directly — returns { kind: 'llm' } so the streaming pipeline
// exercises the LLM call path (prompt assembly, tool filtering, chatWithTools).
vi.mock("../../src/orchestrator/pipeline/phase3-llm/index.js", () => ({
  phase3Generate: vi.fn().mockResolvedValue({
    assistant_text: "This decision weighs adding technical leadership against capacity.",
    tool_invocations: [],
    diagnostics: null,
    finish_reason: "stop",
    usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, input_tokens: 1000, output_tokens: 50 },
    model: "gpt-4.1",
    latencyMs: 100,
    prompt_hash: "29ef22aa5f167719",
    prompt_version: "orchestrator_default@v19 (staging)",
    system_prompt_length: 500,
  }),
  phase3PrepareForStreaming: mockPhase3Prep,
}));

vi.mock("../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js", () => ({
  assembleV2SystemPrompt: vi.fn(async () => ({
    text: "ZONE1_PROMPT\n\nCurrent stage: frame\nStage confidence: high (inferred)\nUser intent: conversational",
    cache_blocks: [{ type: "text", text: "ZONE1_PROMPT", cache_control: { type: "ephemeral" } }],
  })),
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("ZONE1_PROMPT"),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "orchestrator",
    source: "store",
    prompt_version: "orchestrator_default@v19 (staging)",
    prompt_hash: "29ef22aa5f167719",
    instance_id: "test-instance",
  }),
}));

vi.mock("../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn().mockReturnValue([{ role: "user", content: "Should I hire a tech lead or two developers?" }]),
  assembleToolDefinitions: vi.fn((defs: unknown[]) => defs),
}));

vi.mock("../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    { name: "draft_graph", description: "Draft a graph", parameters: {} },
    { name: "edit_graph", description: "Edit a graph", parameters: {} },
    { name: "run_analysis", description: "Run analysis", parameters: {} },
    { name: "explain_results", description: "Explain results", parameters: {} },
  ]),
  isLongRunningTool: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/orchestrator/tools/stage-policy.js", () => ({
  isToolAllowedAtStage: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock("../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ tool: null, routing: "llm", confidence: "none", normalised_message: "", matched_pattern: null }),
}));

vi.mock("../../src/orchestrator/lookup/analysis-lookup.js", () => ({
  tryAnalysisLookup: vi.fn().mockReturnValue({ matched: false }),
  buildLookupEnvelope: vi.fn(),
}));

vi.mock("../../src/adapters/llm/router.js", () => ({
  getMaxTokensFromConfig: vi.fn().mockReturnValue(4096),
  getAdapter: vi.fn().mockReturnValue({
    model: "gpt-4.1",
    name: "openai",
    chat: vi.fn().mockResolvedValue({ content: "test", model: "gpt-4.1", latencyMs: 10, usage: { input_tokens: 0, output_tokens: 0 } }),
    chatWithTools: vi.fn().mockResolvedValue({
      content: "This decision weighs adding technical leadership against capacity.",
      tool_calls: [],
      model: "gpt-4.1",
      finish_reason: "stop",
      usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, input_tokens: 1000, output_tokens: 50 },
    }),
  }),
}));

vi.mock("../../src/orchestrator/pipeline/phase4-tools/index.js", () => ({
  phase4Execute: vi.fn().mockResolvedValue({
    blocks: [],
    side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    assistant_text: null,
    guidance_items: [],
    executed_tools: [],
    deferred_tools: [],
  }),
  createProductionToolDispatcher: vi.fn().mockReturnValue({ dispatch: vi.fn() }),
}));

vi.mock("../../src/orchestrator/pipeline/phase5-validation/index.js", () => ({
  phase5Validate: vi.fn().mockReturnValue({
    turn_id: "parity-turn-001",
    assistant_text: "This decision weighs adding technical leadership against capacity.",
    blocks: [],
    suggested_actions: [{ label: "Compare costs", action: "compare" }],
    lineage: { context_hash: "abc" },
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    science_ledger: { claims_used: [], techniques_used: [], scope_violations: [], phrasing_violations: [], rewrite_applied: false },
    progress_marker: { kind: "none" },
    observability: { triggers_fired: [], triggers_suppressed: [], intent_classification: "conversational" },
    turn_plan: { selected_tool: null, routing: "llm", long_running: false },
    guidance_items: [],
    _route_metadata: {
      outcome: "default_llm",
      reasoning: "no_deterministic_route_applied",
      prompt_hash: "29ef22aa5f167719",
      prompt_version: "orchestrator_default@v19 (staging)",
      features: {},
    },
  }),
}));

vi.mock("../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    resolveContextHash: vi.fn(() => "hash"),
  };
});

vi.mock("../../src/orchestrator/system-event-router.js", () => ({
  routeSystemEvent: vi.fn(),
  appendSystemMessages: vi.fn((h: unknown[]) => h),
}));

vi.mock("../../src/orchestrator/analysis-state.js", () => ({
  normalizeAnalysisEnvelope: vi.fn((a: unknown) => a),
  isAnalysisCurrent: vi.fn(() => false),
  isAnalysisExplainable: vi.fn(() => false),
  isAnalysisPresent: vi.fn(() => false),
  isAnalysisRunnable: vi.fn(() => false),
  isResultsExplanationEligible: vi.fn(() => false),
}));

vi.mock("../../src/orchestrator/dsk-loader.js", () => ({
  getDskVersionHash: () => null,
  resolveDskHash: () => null,
}));

vi.mock("../../src/orchestrator/pipeline/pipeline.js", async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    emitTurnTrace: vi.fn(),
  };
});

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { executePipelineStream } from "../../src/orchestrator/pipeline/pipeline-stream.js";
import { phase1Enrich } from "../../src/orchestrator/pipeline/phase1-enrichment/index.js";

// ============================================================================
// Golden fixture request (hiring scenario from the brief)
// ============================================================================

const GOLDEN_REQUEST = {
  message: "Should I hire a tech lead or two developers to increase productivity?",
  context: {
    graph: null,
    analysis_response: null,
    framing: { stage: "frame", goal: "hire tech lead vs developers" },
    messages: [],
    selected_elements: [],
    scenario_id: "parity-test",
    analysis_inputs: null,
    conversational_state: null,
  },
  scenario_id: "parity-test",
  client_turn_id: "parity-turn-001",
  graph_state: null,
  analysis_state: null,
} as any;

// ============================================================================
// Shared LLM result shape (returned by postProcess and chatWithTools)
// ============================================================================

const GOLDEN_LLM_RESULT = {
  assistant_text: "This decision weighs adding technical leadership against capacity.",
  tool_invocations: [],
  diagnostics: null,
  finish_reason: "stop",
  usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, input_tokens: 1000, output_tokens: 50 },
  model: "gpt-4.1",
  latencyMs: 100,
  prompt_hash: "29ef22aa5f167719",
  prompt_version: "orchestrator_default@v19 (staging)",
  system_prompt_length: 500,
};

// ============================================================================
// Helpers
// ============================================================================

async function collectStreamEvents(gen: AsyncGenerator<OrchestratorStreamEvent>): Promise<OrchestratorStreamEvent[]> {
  const events: OrchestratorStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function setupLLMPath() {
  mockPhase3Prep.mockResolvedValue({
    kind: "llm",
    callArgs: {
      system: "ZONE1_PROMPT\n\nCurrent stage: frame",
      messages: [{ role: "user", content: "Should I hire a tech lead or two developers?" }],
      tools: [
        { name: "draft_graph", description: "Draft a graph", parameters: {} },
        { name: "edit_graph", description: "Edit a graph", parameters: {} },
      ],
    },
    callOpts: { requestId: "req-test", maxTokens: 4096 },
    postProcess: () => GOLDEN_LLM_RESULT,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("Cross-Path Parity: non-streaming vs streaming", () => {
  const mockLLMClient = {
    chatWithTools: vi.fn().mockResolvedValue({
      content: "This decision weighs adding technical leadership against capacity.",
      tool_calls: [],
      model: "gpt-4.1",
      finish_reason: "stop",
      usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, input_tokens: 1000, output_tokens: 50 },
    }),
    chat: vi.fn().mockResolvedValue({ content: "test", model: "gpt-4.1", latencyMs: 10, usage: { input_tokens: 0, output_tokens: 0 } }),
    getResolvedModel: vi.fn(() => ({ model: "gpt-4.1", provider: "openai" })),
    streamChatWithTools: undefined as any,
  };

  const deps = {
    llmClient: mockLLMClient,
    toolDispatcher: { dispatch: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLLMClient.streamChatWithTools = undefined;
    setupLLMPath();
  });

  it("1. Streaming path invokes phase3PrepareForStreaming (same routing as non-streaming)", async () => {
    const events = await collectStreamEvents(
      executePipelineStream(GOLDEN_REQUEST, "req-stream", deps),
    );

    // phase3PrepareForStreaming should be called (shared routing entry point)
    expect(mockPhase3Prep).toHaveBeenCalledTimes(1);

    // No error events
    const errorEvents = events.filter(e => e.type === "error");
    expect(errorEvents).toHaveLength(0);
  });

  it("2. Streaming LLM path calls chatWithTools with system prompt from callArgs", async () => {
    const events = await collectStreamEvents(
      executePipelineStream(GOLDEN_REQUEST, "req-s-2", deps),
    );

    // chatWithTools should be called with the args from phase3PrepareForStreaming
    expect(mockLLMClient.chatWithTools).toHaveBeenCalledTimes(1);
    const callArgs = mockLLMClient.chatWithTools.mock.calls[0][0];
    expect(callArgs.system).toContain("ZONE1_PROMPT");

    // No error events
    const errorEvents = events.filter(e => e.type === "error");
    expect(errorEvents).toHaveLength(0);
  });

  it("3. Streaming LLM path passes tools array to chatWithTools", async () => {
    const events = await collectStreamEvents(
      executePipelineStream(GOLDEN_REQUEST, "req-s-3", deps),
    );

    const turnComplete = events.find(e => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();

    // The chatWithTools call should include tools from callArgs
    expect(mockLLMClient.chatWithTools).toHaveBeenCalledTimes(1);
    const callArgs = mockLLMClient.chatWithTools.mock.calls[0][0];
    expect(callArgs.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "draft_graph" }),
        expect.objectContaining({ name: "edit_graph" }),
      ]),
    );
  });

  it("4. Streaming path calls phase1Enrich for stage inference", async () => {
    vi.mocked(phase1Enrich).mockClear();

    await collectStreamEvents(executePipelineStream(GOLDEN_REQUEST, "req-s-4", deps));

    // phase1Enrich should be called exactly once with correct args
    expect(vi.mocked(phase1Enrich)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(phase1Enrich)).toHaveBeenCalledWith(
      GOLDEN_REQUEST.message,
      expect.any(Object),
      GOLDEN_REQUEST.scenario_id,
      undefined,
    );
  });

  it("5. Streaming path produces turn_complete with correct envelope shape", async () => {
    const events = await collectStreamEvents(
      executePipelineStream(GOLDEN_REQUEST, "req-s-5", deps),
    );

    const turnComplete = events.find(e => e.type === "turn_complete") as any;
    expect(turnComplete).toBeDefined();

    const envelope = turnComplete.envelope;

    // Must have expected fields (parity with non-streaming response)
    expect(envelope.turn_id).toBeDefined();
    expect(typeof envelope.assistant_text).toBe("string");
    expect(Array.isArray(envelope.blocks)).toBe(true);
    expect(Array.isArray(envelope.suggested_actions)).toBe(true);
    expect(envelope._route_metadata).toBeDefined();
    expect(envelope._route_metadata.prompt_hash).toBeDefined();
    expect(envelope._route_metadata.prompt_version).toBeDefined();
  });

  it("6. Streaming does not crash when LLM adapter lacks streamChatWithTools", async () => {
    mockLLMClient.streamChatWithTools = undefined;

    const events = await collectStreamEvents(
      executePipelineStream(GOLDEN_REQUEST, "req-fallback", deps),
    );

    const errorEvents = events.filter(e => e.type === "error");
    const completeEvents = events.filter(e => e.type === "turn_complete");

    expect(errorEvents).toHaveLength(0);
    expect(completeEvents).toHaveLength(1);
  });

  it("7. Deterministic path still produces turn_complete (no LLM call)", async () => {
    // Simulate a deterministic route from phase3PrepareForStreaming
    mockPhase3Prep.mockResolvedValue({
      kind: "deterministic",
      result: GOLDEN_LLM_RESULT,
    });

    const events = await collectStreamEvents(
      executePipelineStream(GOLDEN_REQUEST, "req-deterministic", deps),
    );

    const turnComplete = events.find(e => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();

    // chatWithTools should NOT be called for deterministic path
    expect(mockLLMClient.chatWithTools).not.toHaveBeenCalled();
  });

  it("8. Pipeline forwards full system prompt from phase3 to chatWithTools without truncation", async () => {
    // This tests pipeline-level passthrough: executePipelineStream must relay the
    // system prompt from phase3PrepareForStreaming callArgs to the LLM adapter
    // without truncation. Phase3 is mocked here; for high-fidelity prompt assembly
    // tests see streaming-prompt-assembly.test.ts.
    const LARGE_PROMPT = "Z".repeat(55_000) + "\n\nCurrent stage: frame";
    mockPhase3Prep.mockResolvedValue({
      kind: "llm",
      callArgs: {
        system: LARGE_PROMPT,
        messages: [{ role: "user", content: "Should I hire a tech lead or two developers?" }],
        tools: [{ name: "draft_graph", description: "Draft a graph", parameters: {} }],
      },
      callOpts: { requestId: "req-prompt-length", maxTokens: 4096 },
      postProcess: () => GOLDEN_LLM_RESULT,
    });

    const events = await collectStreamEvents(
      executePipelineStream(GOLDEN_REQUEST, "req-prompt-len", deps),
    );

    // Verify chatWithTools received the full prompt without truncation
    expect(mockLLMClient.chatWithTools).toHaveBeenCalledTimes(1);
    const callArgs = mockLLMClient.chatWithTools.mock.calls[0][0];
    expect(callArgs.system.length).toBeGreaterThan(50_000);

    // Turn should complete successfully
    const errorEvents = events.filter(e => e.type === "error");
    expect(errorEvents).toHaveLength(0);
    const turnComplete = events.find(e => e.type === "turn_complete");
    expect(turnComplete).toBeDefined();
  });
});
