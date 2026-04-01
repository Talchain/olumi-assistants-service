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
    expect(result!.discardedToolCalls).toEqual([]);
  });
});
