/**
 * Tests for the v4 stream handler.
 * Maps Anthropic ChatWithToolsStreamEvent → OrchestratorStreamEvent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/deterministic/actions/registry.js", () => {
  const mockExecute = vi.fn().mockResolvedValue({
    blocks: [{ block_type: 'commentary', data: { narrative: 'Test result' }, block_id: 'b-1', provenance: { turn_id: 't-1' } }],
    assistantText: 'Action completed.',
    guidance_items: [],
  });
  return {
    ACTION_CATALOGUE: new Map([
      ['set_factor_value', {
        action_type: 'set_factor_value',
        execute: mockExecute,
      }],
    ]),
  };
});

import { processAdapterStream } from "../../../../src/orchestrator/deterministic/stream-handler-v4.js";
import type { ChatWithToolsStreamEvent } from "../../../../src/adapters/llm/types.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";

function makeTurnContext(): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 3, edge_count: 2, option_count: 2, option_labels: [], goal_label: null, missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: false, can_explain_results: false, can_edit_graph: false, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
    disambiguation_hints: [],
    graph: null,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'turn-1',
    analysis_inputs: null,
  };
}

async function* mockStream(events: ChatWithToolsStreamEvent[]): AsyncGenerator<ChatWithToolsStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("processAdapterStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards text_delta events", async () => {
    const stream = mockStream([
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world' },
      { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'test', latencyMs: 100, usage: {} } },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    const events = [];
    let result;

    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      events.push(value);
    }

    expect(events.length).toBe(2);
    expect(events[0].type).toBe('text_delta');
    expect(events[1].type).toBe('text_delta');
    expect(result!.assistantText).toBe('Hello world');
  });

  it("emits tool_start on tool_input_start", async () => {
    const stream = mockStream([
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
      { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'test', latencyMs: 100, usage: {} } },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    const events = [];
    let result;

    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      events.push(value);
    }

    // tool_start + block (from execution result) + tool_result
    expect(events[0].type).toBe('tool_start');
    expect((events[0] as { tool_name: string }).tool_name).toBe('set_factor_value');

    const blockEvents = events.filter((e) => e.type === 'block');
    expect(blockEvents.length).toBe(1);

    const resultEvents = events.filter((e) => e.type === 'tool_result');
    expect(resultEvents.length).toBe(1);
    expect((resultEvents[0] as { success: boolean }).success).toBe(true);

    expect(result!.toolExecution).toBeDefined();
    expect(result!.toolExecution!.toolName).toBe('set_factor_value');
  });

  it("discards extra tool calls with warning", async () => {
    const stream = mockStream([
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
      { type: 'tool_input_start', tool_id: 'toolu_2', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_2', tool_name: 'set_factor_value', input: { target_id: 'fac_2', value: 99 } },
      { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'test', latencyMs: 100, usage: {} } },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    let result;

    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
    }

    // First tool executed, second discarded
    expect(result!.toolExecution!.toolName).toBe('set_factor_value');
    expect(result!.discardedToolCalls.length).toBe(1);
    expect(result!.discardedToolCalls[0].name).toBe('set_factor_value');
  });

  it("returns assistantText with no tool execution when no tools called", async () => {
    const stream = mockStream([
      { type: 'text_delta', delta: 'Just a conversation.' },
      { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'test', latencyMs: 100, usage: {} } },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    let result;

    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
    }

    expect(result!.assistantText).toBe('Just a conversation.');
    expect(result!.toolExecution).toBeNull();
    expect(result!.failedToolCall).toBeNull();
    expect(result!.pendingLongRunningTool).toBeNull();
    expect(result!.discardedToolCalls).toEqual([]);
  });

  it("defers long-running tools to pipeline (returns pendingLongRunningTool)", async () => {
    // Mock a long-running tool in the catalogue
    const { ACTION_CATALOGUE } = await import("../../../../src/orchestrator/deterministic/actions/registry.js");
    const originalHas = ACTION_CATALOGUE.has.bind(ACTION_CATALOGUE);
    const originalGet = ACTION_CATALOGUE.get.bind(ACTION_CATALOGUE);

    // run_analysis is in LONG_RUNNING_ACTIONS
    const stream = mockStream([
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'run_analysis' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'run_analysis', input: {} },
      { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'test', latencyMs: 100, usage: {} } },
    ]);

    // Need run_analysis in the catalogue for the unknown check
    (ACTION_CATALOGUE as Map<string, unknown>).set('run_analysis', {
      action_type: 'run_analysis',
      execute: vi.fn(),
    });

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    const events = [];
    let result;

    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      events.push(value);
    }

    // Should yield tool_start but NOT execute (no block/tool_result events)
    expect(events[0].type).toBe('tool_start');
    expect((events[0] as { long_running: boolean }).long_running).toBe(true);
    expect(events.filter(e => e.type === 'block').length).toBe(0);
    expect(events.filter(e => e.type === 'tool_result').length).toBe(0);

    // Tool is deferred
    expect(result!.toolExecution).toBeNull();
    expect(result!.pendingLongRunningTool).toEqual({ name: 'run_analysis', input: {} });

    // Clean up
    (ACTION_CATALOGUE as Map<string, unknown>).delete('run_analysis');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Regression: chip-driven forced tool choice (Sonnet 4.6 behaviour)
  //
  // When a chip click forces tool_choice: { type: 'tool', name }, Sonnet 4.6
  // frequently emits zero text_delta events during streaming and surfaces
  // the headline text only inside the final message_complete.content payload
  // alongside the tool_use block. The pre-Fix-1 stream handler's
  // `!toolExecution` guard discarded this text entirely, producing
  // response_text_chars: 0 and no text_delta events reaching the UI.
  //
  // Post-fix contract:
  //   1. Headline text from finalMessage.content must be extracted and
  //      yielded as a text_delta event.
  //   2. Event ordering must be: text_delta → block → tool_result.
  //   3. assistantText on the returned result must be non-empty.
  // ─────────────────────────────────────────────────────────────────────
  it("regression: chip-forced tool call with text only in message_complete.content yields text_delta before block/tool_result", async () => {
    // Simulates Sonnet-4.6 native tool use under forced tool_choice:
    // - NO text_delta events during streaming
    // - tool_input_start + tool_input_complete for the forced tool
    // - message_complete carries BOTH the headline text block AND the
    //   tool_use block in content[]
    const stream = mockStream([
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
      {
        type: 'message_complete',
        result: {
          content: [
            { type: 'text', text: 'Updating the runway factor so we can see the downstream impact.' },
            { type: 'tool_use', id: 'toolu_1', name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
          ],
          stop_reason: 'tool_use',
          model: 'test',
          latencyMs: 100,
          usage: {},
        },
      },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    const events: Array<{ type: string; delta?: string; tool_name?: string }> = [];
    let result;

    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      events.push(value as { type: string; delta?: string; tool_name?: string });
    }

    // Contract 1: text_delta was yielded at least once for the extracted headline
    const textDeltas = events.filter((e) => e.type === 'text_delta');
    expect(textDeltas.length).toBeGreaterThan(0);
    const headlineText = textDeltas.map((e) => e.delta).join('');
    expect(headlineText).toContain('runway');

    // Contract 2: assistantText on returned result is non-empty
    expect(result!.assistantText.length).toBeGreaterThan(0);
    expect(result!.assistantText).toBe('Updating the runway factor so we can see the downstream impact.');

    // Contract 3: hard event ordering text_delta → block → tool_result.
    // tool_start may precede text_delta (it fires on tool_input_start, which
    // arrives before message_complete in the streaming path); what matters
    // is that text_delta comes BEFORE block and tool_result.
    const firstTextDeltaIdx = events.findIndex((e) => e.type === 'text_delta');
    const firstBlockIdx = events.findIndex((e) => e.type === 'block');
    const firstToolResultIdx = events.findIndex((e) => e.type === 'tool_result');

    expect(firstTextDeltaIdx).toBeGreaterThanOrEqual(0);
    expect(firstBlockIdx).toBeGreaterThanOrEqual(0);
    expect(firstToolResultIdx).toBeGreaterThanOrEqual(0);
    expect(firstTextDeltaIdx).toBeLessThan(firstBlockIdx);
    expect(firstBlockIdx).toBeLessThan(firstToolResultIdx);

    // Sanity: the tool still executed
    expect(result!.toolExecution).toBeDefined();
    expect(result!.toolExecution!.toolName).toBe('set_factor_value');
    expect(result!.failedToolCall).toBeNull();
    expect(result!.discardedToolCalls).toEqual([]);
  });

  it("regression: chip-forced tool call with ONLY text (no text block repeated in content) still extracts text", async () => {
    // Variant: streaming yields no text_deltas, but the headline text arrives
    // solely via message_complete.content (no preceding text_delta events).
    // This is the pure forced-tool-choice case.
    const stream = mockStream([
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
      {
        type: 'message_complete',
        result: {
          content: [
            { type: 'text', text: 'Here is the headline.' },
            { type: 'tool_use', id: 'toolu_1', name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
          ],
          stop_reason: 'tool_use',
          model: 'test',
          latencyMs: 100,
          usage: {},
        },
      },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    let result;
    const events: Array<{ type: string }> = [];

    while (true) {
      const { value, done } = await gen.next();
      if (done) { result = value; break; }
      events.push(value as { type: string });
    }

    expect(result!.assistantText).toBe('Here is the headline.');
    // Exactly one text_delta was yielded (for the extracted block)
    expect(events.filter((e) => e.type === 'text_delta').length).toBe(1);
  });

  it("regression: whitespace-only streaming deltas do not block message_complete text extraction", async () => {
    // Defensive hardening: if the model happens to stream a stray whitespace
    // delta (e.g. " " or "\n") before the tool_use block, the phase-1 guard
    // must still extract the headline text from finalMessage.content.
    // Pre-fix the guard was `textChunks.length === 0` which treated the
    // whitespace as a non-empty stream and dropped the headline. The
    // tightened guard uses `textChunks.join('').trim() === ''`.
    const stream = mockStream([
      { type: 'text_delta', delta: ' ' },
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
      {
        type: 'message_complete',
        result: {
          content: [
            { type: 'text', text: 'Updating the runway factor.' },
            { type: 'tool_use', id: 'toolu_1', name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
          ],
          stop_reason: 'tool_use',
          model: 'test',
          latencyMs: 100,
          usage: {},
        },
      },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    const events: Array<{ type: string; delta?: string }> = [];
    let result;
    while (true) {
      const { value, done } = await gen.next();
      if (done) { result = value; break; }
      events.push(value as { type: string; delta?: string });
    }

    // assistantText is the whitespace delta PLUS the extracted headline
    expect(result!.assistantText).toContain('Updating the runway factor.');
    // At least one text_delta carried the headline content
    const headlineDeltas = events.filter((e) => e.type === 'text_delta' && (e.delta ?? '').includes('Updating'));
    expect(headlineDeltas.length).toBeGreaterThan(0);
    // Ordering: headline text_delta arrives before the block event
    const firstHeadlineIdx = events.findIndex((e) => e.type === 'text_delta' && (e.delta ?? '').includes('Updating'));
    const firstBlockIdx = events.findIndex((e) => e.type === 'block');
    expect(firstHeadlineIdx).toBeLessThan(firstBlockIdx);
  });

  it("regression: whitespace-only delta + empty content falls back to tool handler assistantText", async () => {
    // Pathological case: model streams a stray whitespace delta, tool_use
    // is deferred (per the tightened guard), message_complete has NO text
    // blocks in content, so phase-1 extraction finds nothing. The tool
    // handler's own assistantText must then be used as the headline —
    // otherwise the block emits with no preceding text_delta at all.
    // This regression pins that the handler-fallback emission inside
    // executeShortTool uses the same trim()==='' semantics as the outer
    // guards.
    const stream = mockStream([
      { type: 'text_delta', delta: '\n' },
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
      {
        type: 'message_complete',
        result: {
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
          ],
          stop_reason: 'tool_use',
          model: 'test',
          latencyMs: 100,
          usage: {},
        },
      },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    const events: Array<{ type: string; delta?: string }> = [];
    let result;
    while (true) {
      const { value, done } = await gen.next();
      if (done) { result = value; break; }
      events.push(value as { type: string; delta?: string });
    }

    // The mocked action returns assistantText: 'Action completed.'
    expect(result!.assistantText).toContain('Action completed.');
    // A non-whitespace text_delta was yielded before the block
    const substantiveDeltaIdx = events.findIndex(
      (e) => e.type === 'text_delta' && (e.delta ?? '').trim().length > 0,
    );
    const firstBlockIdx = events.findIndex((e) => e.type === 'block');
    expect(substantiveDeltaIdx).toBeGreaterThanOrEqual(0);
    expect(substantiveDeltaIdx).toBeLessThan(firstBlockIdx);
  });

  it("regression: does not double-emit text when streaming deltas arrived AND message_complete repeats the text block", async () => {
    // Normal streaming path: text_deltas arrive first, then the tool call,
    // then message_complete (which may redundantly include the assembled text
    // block in content[]). The handler must NOT extract text from
    // message_complete.content in this case — textChunks is non-empty, so
    // the phase-1 extraction is skipped to avoid double-emission.
    const stream = mockStream([
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world.' },
      { type: 'tool_input_start', tool_id: 'toolu_1', tool_name: 'set_factor_value' },
      { type: 'tool_input_complete', tool_id: 'toolu_1', tool_name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
      {
        type: 'message_complete',
        result: {
          content: [
            { type: 'text', text: 'Hello world.' },
            { type: 'tool_use', id: 'toolu_1', name: 'set_factor_value', input: { target_id: 'fac_1', value: 42 } },
          ],
          stop_reason: 'tool_use',
          model: 'test',
          latencyMs: 100,
          usage: {},
        },
      },
    ]);

    const gen = processAdapterStream(stream, makeTurnContext(), 'req-1');
    const events: Array<{ type: string; delta?: string }> = [];
    let result;
    while (true) {
      const { value, done } = await gen.next();
      if (done) { result = value; break; }
      events.push(value as { type: string; delta?: string });
    }

    // Only the two streaming deltas — no extra delta from message_complete
    expect(events.filter((e) => e.type === 'text_delta').length).toBe(2);
    expect(result!.assistantText).toBe('Hello world.');
    expect(result!.toolExecution).toBeDefined();
  });
});
