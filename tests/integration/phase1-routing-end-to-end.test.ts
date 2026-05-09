/**
 * Phase 1 — Tool-use routing end-to-end (Suite A).
 *
 * Exercises the full turn pipeline through the new seven-step flow for an
 * execute-intent turn: ContextPack → routeWithToolUse → validate →
 * handler → confirm → compose → commit. All LLM seams are mocked; no real
 * Anthropic API calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';

import { setTestSink } from '../../src/utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';

// Session store mock captures persistence calls
const appendCalls: Array<unknown> = [];
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { createRegistry } = await import('../../src/orchestrator-v5/tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

// Telemetry
type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: '11111111-1111-4111-8111-111111111111',
  scenario_id: '22222222-2222-4222-8222-222222222222',
  message: 'run the analysis on my current scenario',
  turn_class: 'decide',
  stage: 'analyse',
});

function toolUseResult(input: unknown, orientationText?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (orientationText) content.push({ type: 'text', text: orientationText });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

const RUN_ANALYSIS_PROPOSAL = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

function makePlotClient() {
  return {
    run: vi.fn(async () => ({
      meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
      results: [
        { option_id: 'opt_a', option_label: 'A', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'B', win_probability: 0.38 },
      ],
      response_hash: 'top',
      analysis_status: 'completed',
    })),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as never;
}

function makeScenarioReader() {
  return async () => ({
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  });
}

beforeEach(() => {
  appendCalls.length = 0;
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

describe('phase 1 routing end-to-end — execute turn via tool-use', () => {
  it('tool-call execute routes through the seven-step flow and persists handler_facts', async () => {
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          toolUseResult(RUN_ANALYSIS_PROPOSAL, 'Running analysis on your scenario...'),
        ),
    };
    const registry = createRegistry({
      plotClient: makePlotClient(),
      scenarioReader: makeScenarioReader(),
    });

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-e2e', {
      routingAdapter,
      handlerRegistry: registry,
    });

    OlumiResponseSchema.parse(response);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.intent_class).toBe('execute');
    expect(telemetry.commit_performed).toBe(true);

    const stages = telemetry.stages_completed;
    // v5-maintenance: 'coach' was added as a stage in V5 Group 1 Task C
    // (deterministic coaching signal detector). It sits between confirm
    // and compose.
    expect(stages).toEqual([
      'build_turn_context',
      'orient',
      'validate',
      'validate_skipped_no_graph',
      'execute',
      'confirm',
      'coach',
      'compose',
      'commit',
    ]);

    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0] as {
      handler_id: string;
      turn_class: string;
      handler_facts: Array<{ fact_type: string }>;
    };
    expect(write.handler_id).toBe('run_analysis');
    expect(write.turn_class).toBe('handler');
    expect(write.handler_facts).toHaveLength(1);
    expect(write.handler_facts[0]!.fact_type).toBe('run_analysis');

    expect(response.assistant_text).toContain('Running analysis on your scenario...');
    expect(response.assistant_text).toContain('Ran analysis on your current scenario.');

    // BI-01
    const started = events.filter((e) => e.event === 'turn_executor.started');
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.response_emitted).toBe(true);
  });

  it('ContextPack + tool definition are passed on the routing call', async () => {
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(toolUseResult(RUN_ANALYSIS_PROPOSAL)),
    };
    const registry = createRegistry({
      plotClient: makePlotClient(),
      scenarioReader: makeScenarioReader(),
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-e2e-2', {
      routingAdapter,
      handlerRegistry: registry,
    });

    expect(routingAdapter.chatWithTools).toHaveBeenCalledTimes(1);
    const args = routingAdapter.chatWithTools.mock.calls[0]![0];
    expect(args.tools[0]!.name).toBe(OLUMI_ACTION_TOOL_NAME);
    expect(args.tool_choice).toEqual({ type: 'auto' });
    // ContextPack fields are serialised into the user message
    const userMsg = args.messages[0]!.content as string;
    expect(userMsg).toContain('"version": "2.0"');
    expect(userMsg).toContain('"stage": "analyse"');
  });
});
