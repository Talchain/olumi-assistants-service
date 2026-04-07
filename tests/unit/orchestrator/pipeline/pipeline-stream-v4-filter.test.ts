/**
 * Tests for the v4 pipeline streaming XML filter.
 *
 * These tests verify that pipeline-stream.ts wraps every text_delta event
 * from executePipelineV4 in a StreamingEnvelopeStripper, suppressing XML
 * envelope fragments before they reach the wire. Stripper internals are
 * already covered by streaming-xml-stripper.test.ts — this file only
 * verifies the wiring at the v4 architectural choke point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OrchestratorStreamEvent } from "../../../../src/orchestrator/pipeline/stream-events.js";

// ----------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test.
// ----------------------------------------------------------------------------

// Holder for the per-test event sequence yielded by mock executePipelineV4.
const v4EventQueue: { events: OrchestratorStreamEvent[] } = { events: [] };

vi.mock("../../../../src/orchestrator/deterministic/pipeline-v4.js", () => ({
  executePipelineV4: async function* () {
    for (const event of v4EventQueue.events) {
      yield event;
    }
  },
}));

// Stub all other pipeline phases — we only care about the v4 branch.
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
  assembleV2SystemPrompt: vi.fn(async () => ({ text: "system prompt", cache_blocks: [] })),
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
  classifyIntentWithContext: vi.fn(() => ({ tool: null, routing: "llm", confidence: "none" })),
}));
vi.mock("../../../../src/orchestrator/tools/registry.js", () => ({
  isLongRunningTool: vi.fn(() => false),
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
vi.mock("../../../../src/orchestrator/analysis-state.js", () => ({
  normalizeAnalysisEnvelope: vi.fn((x) => x),
}));
vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: {
      pipelineV4Enabled: true,
      contextFabric: false,
      diagnosticTraceEnabled: false,
      artefactAppendixEnabled: false,
      deterministicOrchestratorEnabled: false,
      legacyOrchestratorEnabled: false,
      briefDetectionEnabled: false,
      deterministicRoutingV2: false,
    },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    cee: { anthropicStructuredOutputs: false },
  },
}));

import { executePipelineStream } from "../../../../src/orchestrator/pipeline/pipeline-stream.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeRequest() {
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
  } as any;
}

function makeDeps() {
  return {
    llmClient: { streamChatWithTools: vi.fn() } as any,
    toolDispatcher: vi.fn() as any,
  } as any;
}

function makeEnvelope() {
  return {
    turn_id: "turn-123",
    assistant_text: "ok",
    blocks: [],
    response_version: 2,
  } as any;
}

async function runV4(events: OrchestratorStreamEvent[]): Promise<OrchestratorStreamEvent[]> {
  v4EventQueue.events = events;
  const collected: OrchestratorStreamEvent[] = [];
  for await (const event of executePipelineStream(makeRequest(), "req-1", makeDeps())) {
    collected.push(event);
  }
  return collected;
}

function deltas(events: OrchestratorStreamEvent[]): string[] {
  return events.filter((e) => e.type === 'text_delta').map((e) => (e as any).delta);
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("pipeline-stream v4 XML filter", () => {
  beforeEach(() => {
    v4EventQueue.events = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes plain text deltas through unchanged", async () => {
    const out = await runV4([
      { type: 'turn_start', seq: 0, turn_id: 't1', routing: 'llm', stage: 'frame' },
      { type: 'text_delta', seq: 1, delta: "Hello " },
      { type: 'text_delta', seq: 2, delta: "world." },
      { type: 'turn_complete', seq: 3, envelope: makeEnvelope() },
    ]);

    expect(deltas(out)).toEqual(["Hello ", "world."]);
  });

  it("fully suppresses <diagnostics> content", async () => {
    const out = await runV4([
      { type: 'turn_start', seq: 0, turn_id: 't1', routing: 'llm', stage: 'frame' },
      { type: 'text_delta', seq: 1, delta: "<diagnostics>Mode: ACT. Tool: explain_result.</diagnostics>" },
      { type: 'text_delta', seq: 2, delta: "Visible answer." },
      { type: 'turn_complete', seq: 3, envelope: makeEnvelope() },
    ]);

    const joined = deltas(out).join("");
    expect(joined).not.toContain("Mode:");
    expect(joined).not.toContain("explain_result");
    expect(joined).not.toContain("<diagnostics");
    expect(joined).not.toContain("</diagnostics>");
    expect(joined).toContain("Visible answer.");
  });

  it("handles a partial XML tag split across two deltas", async () => {
    const out = await runV4([
      { type: 'turn_start', seq: 0, turn_id: 't1', routing: 'llm', stage: 'frame' },
      { type: 'text_delta', seq: 1, delta: "Visible <diagn" },
      { type: 'text_delta', seq: 2, delta: "ostics>hidden</diagnostics> tail" },
      { type: 'turn_complete', seq: 3, envelope: makeEnvelope() },
    ]);

    const joined = deltas(out).join("");
    expect(joined).not.toContain("hidden");
    expect(joined).not.toContain("<diagnostics");
    expect(joined).not.toContain("<diagn");
    expect(joined).toContain("Visible ");
    expect(joined).toContain(" tail");
  });

  it("suppresses buffered content when stream ends mid-tag", async () => {
    // No flush at end-of-stream — partial `<diagnostics` fragment is dropped.
    const out = await runV4([
      { type: 'turn_start', seq: 0, turn_id: 't1', routing: 'llm', stage: 'frame' },
      { type: 'text_delta', seq: 1, delta: "Visible text <diagnostics" },
      { type: 'turn_complete', seq: 2, envelope: makeEnvelope() },
    ]);

    const joined = deltas(out).join("");
    expect(joined).not.toContain("<diagnostics");
    expect(joined).toContain("Visible text ");
  });

  it("passes non-text events through unchanged", async () => {
    const block = { block_type: 'text', data: { text: 'b' } } as any;
    const out = await runV4([
      { type: 'turn_start', seq: 0, turn_id: 't1', routing: 'llm', stage: 'frame' },
      { type: 'tool_start', seq: 1, tool_name: 'run_analysis', long_running: true },
      { type: 'progress', seq: 2, tool_name: 'run_analysis', elapsed_ms: 5000, message: 'working' },
      { type: 'block', seq: 3, block },
      { type: 'tool_result', seq: 4, tool_name: 'run_analysis', success: true, duration_ms: 1234 },
      { type: 'turn_complete', seq: 5, envelope: makeEnvelope() },
    ]);

    const types = out.map((e) => e.type);
    expect(types).toEqual([
      'turn_start',
      'tool_start',
      'progress',
      'block',
      'tool_result',
      'turn_complete',
    ]);
  });

  it("does not yield empty deltas after stripping", async () => {
    const out = await runV4([
      { type: 'turn_start', seq: 0, turn_id: 't1', routing: 'llm', stage: 'frame' },
      // Entire delta is XML envelope tags — stripper returns empty.
      { type: 'text_delta', seq: 1, delta: "<response><assistant_text>" },
      { type: 'text_delta', seq: 2, delta: "Real content." },
      { type: 'text_delta', seq: 3, delta: "</assistant_text></response>" },
      { type: 'turn_complete', seq: 4, envelope: makeEnvelope() },
    ]);

    const textEvents = out.filter((e) => e.type === 'text_delta');
    for (const e of textEvents) {
      expect((e as any).delta).not.toBe("");
    }
    const joined = textEvents.map((e) => (e as any).delta).join("");
    expect(joined).toContain("Real content.");
    expect(joined).not.toContain("<response");
    expect(joined).not.toContain("<assistant_text");
  });

  it("preserves monotonic seq numbering across mixed events", async () => {
    const out = await runV4([
      { type: 'turn_start', seq: 0, turn_id: 't1', routing: 'llm', stage: 'frame' },
      { type: 'text_delta', seq: 1, delta: "<diagnostics>x</diagnostics>" }, // suppressed
      { type: 'text_delta', seq: 2, delta: "Hello " },
      { type: 'block', seq: 3, block: { block_type: 'text', data: { text: 'b' } } as any },
      { type: 'text_delta', seq: 4, delta: "world" },
      { type: 'turn_complete', seq: 5, envelope: makeEnvelope() },
    ]);

    const seqs = out.map((e) => e.seq);
    // Seq must be strictly monotonically increasing (gaps allowed).
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    // And the assistant text comes through cleanly.
    expect(deltas(out).join("")).toBe("Hello world");
  });
});
