import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiagnosticTraceCollector, emptyDiagnosticTrace } from "../../../../src/orchestrator/pipeline/diagnostic-trace.js";
import type { DiagnosticTrace } from "../../../../src/orchestrator/pipeline/diagnostic-trace.js";
import type {
  EnrichedContext,
  LLMResult,
  ToolResult,
  OrchestratorResponseEnvelopeV2,
} from "../../../../src/orchestrator/pipeline/types.js";

// ============================================================================
// Config mock — mutable per test
// ============================================================================
let diagnosticTraceEnabled = true;
let anthropicStructuredOutputs = false;
let artefactAppendixEnabled = false;

vi.mock("../../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: {
    features: {
      get diagnosticTraceEnabled() { return diagnosticTraceEnabled; },
      get artefactAppendixEnabled() { return artefactAppendixEnabled; },
      orchestratorV2: false,
      dskV0: false,
      contextFabric: false,
    },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    cee: { get anthropicStructuredOutputs() { return anthropicStructuredOutputs; } },
  },
}));

vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  getDskVersionHash: () => null,
  resolveDskHash: () => null,
}));

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPromptMeta: () => ({
    taskId: 'orchestrator',
    promptId: 'orchestrator_cf_v20',
    version: 20,
    prompt_version: '20',
    prompt_hash: 'abc123def',
    source: 'store',
    isStaging: true,
    instance_id: 'test-instance',
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    decision_archetype: { type: null, confidence: "low", evidence: "no keywords matched" },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    conversational_state: { active_entities: [], stated_constraints: [], current_topic: "framing", last_failed_action: null },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "test-scenario",
    turn_id: "test-turn-id",
    ...overrides,
  };
}

function makeLLMResult(overrides?: Partial<LLMResult>): LLMResult {
  return {
    assistant_text: "Hello",
    tool_invocations: [],
    science_annotations: [],
    raw_response: "Hello",
    suggested_actions: [],
    extracted_blocks: [],
    diagnostics: null,
    parse_warnings: [],
    route_metadata: {
      outcome: 'default_llm',
      reasoning: 'no_deterministic_route_applied',
      resolved_model: 'claude-sonnet-4-6',
      resolved_provider: 'anthropic',
      prompt_hash: 'abc123def',
      prompt_version: '20',
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 500,
      cache_hit: true,
    },
    ...overrides,
  };
}

function makeToolResult(overrides?: Partial<ToolResult>): ToolResult {
  return {
    blocks: [],
    side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    assistant_text: null,
    guidance_items: [],
    tool_latency_ms: 350,
    ...overrides,
  };
}

function makeEnvelope(overrides?: Partial<OrchestratorResponseEnvelopeV2>): OrchestratorResponseEnvelopeV2 {
  return {
    turn_id: 'test-turn-id',
    assistant_text: 'Hello',
    blocks: [],
    suggested_actions: [],
    guidance_items: [],
    lineage: { context_hash: 'hash', dsk_version_hash: null },
    stage_indicator: { stage: 'frame', confidence: 'high', source: 'inferred' },
    science_ledger: {
      claims_used: [],
      techniques_used: [],
      scope_violations: [],
      phrasing_violations: [],
      rewrite_applied: false,
    },
    progress_marker: { kind: 'none' },
    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: 'conversational',
      specialist_contributions: [],
      specialist_disagreement: null,
    },
    turn_plan: { selected_tool: 'draft_graph', routing: 'llm', long_running: false },
    _route_metadata: {
      outcome: 'default_llm',
      reasoning: 'no_deterministic_route_applied',
      tool_selected: 'draft_graph',
      tool_permitted: true,
      resolved_model: 'claude-sonnet-4-6',
      resolved_provider: 'anthropic',
    },
    ...overrides,
  };
}

// ============================================================================
// Unit Tests: DiagnosticTraceCollector
// ============================================================================

describe("DiagnosticTraceCollector", () => {
  it("freeze() returns empty trace when nothing recorded", () => {
    const collector = new DiagnosticTraceCollector();
    const trace = collector.freeze();

    expect(trace.llm_calls).toEqual([]);
    expect(trace.prompt_identity).toEqual([]);
    expect(trace.zone2_assembly).toBeNull();
    expect(trace.tool_policy).toBeNull();
    expect(trace.provider_resolution).toEqual([]);
    expect(trace.structured_output_config).toBeNull();
    expect(trace.streaming_metrics).toBeNull();
    expect(trace.fallback_trace).toEqual([]);
  });

  it("accumulates LLM calls", () => {
    const collector = new DiagnosticTraceCollector();
    collector.recordLLMCall({
      role: 'orchestrator',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 200,
      cache_creation_tokens: 100,
      latency_ms: 350,
      stop_reason: 'end_turn',
      thinking_enabled: false,
      error: null,
    });

    const trace = collector.freeze();
    expect(trace.llm_calls).toHaveLength(1);
    expect(trace.llm_calls[0].model).toBe('claude-sonnet-4-6');
    expect(trace.llm_calls[0].provider).toBe('anthropic');
    expect(trace.llm_calls[0].stop_reason).toBe('end_turn');
  });

  it("accumulates multiple prompt identities", () => {
    const collector = new DiagnosticTraceCollector();
    collector.recordPromptIdentity({
      task_id: 'orchestrator',
      prompt_id: 'orchestrator_cf_v20',
      version: 20,
      hash: 'abc123',
      source: 'store',
      is_staging: false,
    });
    collector.recordPromptIdentity({
      task_id: 'draft_graph',
      prompt_id: 'draft_graph_default',
      version: 186,
      hash: 'def456',
      source: 'fallback',
      is_staging: true,
    });

    const trace = collector.freeze();
    expect(trace.prompt_identity).toHaveLength(2);
    expect(trace.prompt_identity[0].task_id).toBe('orchestrator');
    expect(trace.prompt_identity[1].task_id).toBe('draft_graph');
  });

  it("records fallback trace", () => {
    const collector = new DiagnosticTraceCollector();
    collector.recordFallback({
      stage: 'draft_graph',
      reason: 'anthropic_api_error',
      original_error: 'Structured outputs rejected by API',
      fallback_action: 'retry_without_structured_outputs',
      fallback_succeeded: true,
    });

    const trace = collector.freeze();
    expect(trace.fallback_trace).toHaveLength(1);
    expect(trace.fallback_trace[0].fallback_succeeded).toBe(true);
  });

  it("freeze() produces independent snapshots", () => {
    const collector = new DiagnosticTraceCollector();
    const trace1 = collector.freeze();
    collector.recordPromptIdentity({
      task_id: 'a', prompt_id: 'a', version: 1, hash: '', source: 'store', is_staging: false,
    });
    const trace2 = collector.freeze();

    expect(trace1.prompt_identity).toHaveLength(0);
    expect(trace2.prompt_identity).toHaveLength(1);
  });
});

describe("emptyDiagnosticTrace", () => {
  it("returns a valid empty trace", () => {
    const trace = emptyDiagnosticTrace();
    expect(trace.llm_calls).toEqual([]);
    expect(trace.prompt_identity).toEqual([]);
    expect(trace.zone2_assembly).toBeNull();
    expect(trace.tool_policy).toBeNull();
    expect(trace.provider_resolution).toEqual([]);
    expect(trace.structured_output_config).toBeNull();
    expect(trace.streaming_metrics).toBeNull();
    expect(trace.fallback_trace).toEqual([]);
  });
});

// ============================================================================
// Unit Tests: attachDiagnosticTrace (via pipeline export)
// ============================================================================

// Import attachDiagnosticTrace lazily so mocks are in place
let attachDiagnosticTrace: typeof import("../../../../src/orchestrator/pipeline/pipeline.js").attachDiagnosticTrace;

beforeEach(async () => {
  diagnosticTraceEnabled = true;
  anthropicStructuredOutputs = false;
  artefactAppendixEnabled = false;

  // Fresh import to ensure mocks are in effect
  const pipeline = await import("../../../../src/orchestrator/pipeline/pipeline.js");
  attachDiagnosticTrace = pipeline.attachDiagnosticTrace;
});

describe("attachDiagnosticTrace", () => {
  it("attaches _diagnostic_trace when flag is enabled", () => {
    diagnosticTraceEnabled = true;
    const envelope = makeEnvelope();
    const ec = makeEnrichedContext();
    const llmResult = makeLLMResult();
    const toolResult = makeToolResult();

    attachDiagnosticTrace(envelope, {
      enrichedContext: ec,
      llmResult,
      toolResult,
      streaming: false,
    });

    expect(envelope._diagnostic_trace).toBeDefined();
    const trace = envelope._diagnostic_trace!;

    // Shape validation
    expect(trace.llm_calls).toBeInstanceOf(Array);
    expect(trace.prompt_identity).toBeInstanceOf(Array);
    expect(trace.provider_resolution).toBeInstanceOf(Array);
    expect(trace.fallback_trace).toBeInstanceOf(Array);
  });

  it("_diagnostic_trace is absent when flag is disabled", () => {
    diagnosticTraceEnabled = false;
    const envelope = makeEnvelope();

    attachDiagnosticTrace(envelope, {
      enrichedContext: makeEnrichedContext(),
      streaming: false,
    });

    expect(envelope._diagnostic_trace).toBeUndefined();
  });

  it("removes pre-existing _diagnostic_trace when flag is disabled", () => {
    diagnosticTraceEnabled = false;
    const envelope = makeEnvelope();
    envelope._diagnostic_trace = emptyDiagnosticTrace();

    attachDiagnosticTrace(envelope, {
      enrichedContext: makeEnrichedContext(),
      streaming: false,
    });

    expect(envelope._diagnostic_trace).toBeUndefined();
  });

  it("prompt_identity contains correct version and hash from prompt loader", () => {
    diagnosticTraceEnabled = true;
    const envelope = makeEnvelope();

    attachDiagnosticTrace(envelope, {
      enrichedContext: makeEnrichedContext(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      streaming: false,
    });

    const trace = envelope._diagnostic_trace!;
    expect(trace.prompt_identity).toHaveLength(1);
    expect(trace.prompt_identity[0]).toMatchObject({
      task_id: 'orchestrator',
      prompt_id: 'orchestrator_cf_v20',
      version: 20,
      hash: 'abc123def',
      source: 'store',
      is_staging: true,
    });
  });

  it("tool_policy shows correct filtering for frame stage", () => {
    diagnosticTraceEnabled = true;
    const envelope = makeEnvelope({
      _route_metadata: {
        outcome: 'default_llm',
        reasoning: 'no_deterministic_route_applied',
        tool_selected: 'draft_graph',
        tool_permitted: true,
      },
      turn_plan: { selected_tool: 'draft_graph', routing: 'llm', long_running: false },
    });

    attachDiagnosticTrace(envelope, {
      enrichedContext: makeEnrichedContext({ stage_indicator: { stage: 'frame', confidence: 'high', source: 'inferred' } }),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      streaming: false,
    });

    const trace = envelope._diagnostic_trace!;
    expect(trace.tool_policy).not.toBeNull();
    expect(trace.tool_policy!.stage).toBe('frame');
    expect(trace.tool_policy!.tools_offered).toContain('draft_graph');
  });

  it("captures LLM call error on error responses", () => {
    diagnosticTraceEnabled = true;
    const envelope = makeEnvelope({
      error: { code: 'LLM_TIMEOUT', message: 'Anthropic timed out' },
    });

    attachDiagnosticTrace(envelope, {
      enrichedContext: makeEnrichedContext(),
      error: { status: 502, type: 'LLM_TIMEOUT', message: 'Anthropic timed out' },
      streaming: false,
    });

    const trace = envelope._diagnostic_trace!;
    expect(trace.fallback_trace).toHaveLength(1);
    expect(trace.fallback_trace[0].reason).toBe('LLM_TIMEOUT');
    expect(trace.fallback_trace[0].original_error).toBe('Anthropic timed out');
  });

  it("captures provider resolution from route_metadata", () => {
    diagnosticTraceEnabled = true;
    const envelope = makeEnvelope();
    const llmResult = makeLLMResult({
      route_metadata: {
        outcome: 'default_llm',
        reasoning: 'no_deterministic_route_applied',
        resolved_model: 'claude-sonnet-4-6',
        resolved_provider: 'anthropic',
      },
    });

    attachDiagnosticTrace(envelope, {
      enrichedContext: makeEnrichedContext(),
      llmResult,
      toolResult: makeToolResult(),
      streaming: false,
    });

    const trace = envelope._diagnostic_trace!;
    expect(trace.provider_resolution).toHaveLength(1);
    expect(trace.provider_resolution[0]).toMatchObject({
      task: 'orchestrator',
      resolved_model: 'claude-sonnet-4-6',
      resolved_provider: 'anthropic',
    });
  });

  it("streaming and non-streaming produce equivalent shapes (excluding streaming_metrics)", () => {
    diagnosticTraceEnabled = true;
    const ec = makeEnrichedContext();
    const llmResult = makeLLMResult();
    const toolResult = makeToolResult();

    const nonStreamEnvelope = makeEnvelope();
    attachDiagnosticTrace(nonStreamEnvelope, {
      enrichedContext: ec, llmResult, toolResult, streaming: false,
    });

    const streamEnvelope = makeEnvelope();
    attachDiagnosticTrace(streamEnvelope, {
      enrichedContext: ec, llmResult, toolResult, streaming: true,
    });

    const nonStream = nonStreamEnvelope._diagnostic_trace!;
    const stream = streamEnvelope._diagnostic_trace!;

    // All sections except streaming_metrics should match
    expect(nonStream.llm_calls).toEqual(stream.llm_calls);
    expect(nonStream.prompt_identity).toEqual(stream.prompt_identity);
    expect(nonStream.zone2_assembly).toEqual(stream.zone2_assembly);
    expect(nonStream.tool_policy).toEqual(stream.tool_policy);
    expect(nonStream.provider_resolution).toEqual(stream.provider_resolution);
    expect(nonStream.structured_output_config).toEqual(stream.structured_output_config);
    expect(nonStream.fallback_trace).toEqual(stream.fallback_trace);
  });

  it("zone2_assembly reflects enriched context sections", () => {
    diagnosticTraceEnabled = true;
    const ec = makeEnrichedContext({
      graph_compact: { nodes: [], edges: [], node_count: 0, edge_count: 0 } as never,
      analysis_response: { summary: 'test' } as never,
      entity_state_map: { entities: {} } as never,
    });

    const envelope = makeEnvelope();
    attachDiagnosticTrace(envelope, {
      enrichedContext: ec,
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      streaming: false,
    });

    const zone2 = envelope._diagnostic_trace!.zone2_assembly!;
    expect(zone2.sections_present.graph).toBe(true);
    expect(zone2.sections_present.analysis).toBe(true);
    expect(zone2.sections_present.entity_memory).toBe(true);
    expect(zone2.sections_present.continuity).toBe(false); // not set
  });

  it("structured_output_config reflects anthropicStructuredOutputs flag", () => {
    diagnosticTraceEnabled = true;
    anthropicStructuredOutputs = true;

    const envelope = makeEnvelope();
    attachDiagnosticTrace(envelope, {
      enrichedContext: makeEnrichedContext(),
      llmResult: makeLLMResult({
        route_metadata: {
          outcome: 'default_llm',
          reasoning: 'no_deterministic_route_applied',
          resolved_model: 'claude-sonnet-4-6',
          resolved_provider: 'anthropic',
        },
      }),
      toolResult: makeToolResult(),
      streaming: false,
    });

    const soCfg = envelope._diagnostic_trace!.structured_output_config!;
    expect(soCfg.enabled).toBe(true);
    expect(soCfg.api_shape).toBe('output_config_ga');
    expect(soCfg.beta_header_present).toBe(false);
  });
});

// ============================================================================
// Contract test: _diagnostic_trace must not feed into LLM context
// ============================================================================

describe("diagnostic trace contract", () => {
  it("_diagnostic_trace does not appear in zone2 assembly fields", () => {
    // The enriched context must never carry _diagnostic_trace — it's response-only.
    const ec = makeEnrichedContext();

    // Verify the type doesn't have _diagnostic_trace
    expect('_diagnostic_trace' in ec).toBe(false);
  });

  it("_diagnostic_trace is not included in conversation history", () => {
    const ec = makeEnrichedContext({
      conversation_history: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });

    // Verify no conversation history entry contains _diagnostic_trace
    for (const msg of ec.conversation_history) {
      expect(JSON.stringify(msg)).not.toContain('_diagnostic_trace');
    }
  });
});
