/**
 * V5 alpha hardening Phase 2.5 — observability integration tests.
 *
 * Asserts:
 *  1. Every primary lifecycle event carries the FULL obs field set:
 *     v5_journey_id, prompt_version, prompt_hash, system_chars,
 *     context_pack_chars, handler_proposed, validator_outcome, response_type.
 *  2. v5_journey_id threads across every primary event in a single turn
 *     so a log query on one journey_id reveals the whole story.
 *  3. No user decision text lands in any primary event payload.
 *
 * Primary events (correction 12):
 *   - turn_executor.started
 *   - v5.context_pack.assembled
 *   - v5.validator_outcome
 *   - v5.recovery_response (fires on recoverable validator outcomes)
 *   - v5.handler_invocation (fires on successful handler calls)
 *   - turn_executor.completed
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

const appendCalls: Array<unknown> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const {
  ROUTING_PROMPT_VERSION,
  ROUTING_PROMPT_HASH,
  ROUTING_PROMPT_SYSTEM_CHARS,
} = await import('../routing/route-with-tool-use.js');

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 42,
  };
}

function mockRoutingAdapter(input: unknown) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkToolUseResult(input)),
  };
}

const RECOVERABLE_VALIDATOR_INPUT = {
  intent_class: 'execute',
  action: {
    handler_id: 'not_a_real_handler',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const GRAPH_WITH_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'Plan A' },
    { id: 'opt_b', kind: 'option', label: 'Plan B' },
  ],
  edges: [],
} as GraphStateIngress;

const FULL_OBS_KEYS: readonly string[] = [
  'v5_journey_id',
  'prompt_version',
  'prompt_hash',
  'system_chars',
  'context_pack_chars',
  'handler_proposed',
  'validator_outcome',
  'response_type',
] as const;

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

function primaryEvent(name: string): SinkEvent | undefined {
  return events.find((e) => e.event === name);
}

function assertFullObs(data: Record<string, unknown>): void {
  for (const k of FULL_OBS_KEYS) {
    expect(data, `expected obs key "${k}" on primary event`).toHaveProperty(k);
  }
  expect(data.v5_journey_id).toBe(SCENARIO_ID);
  expect(data.prompt_version).toBe(ROUTING_PROMPT_VERSION);
  expect(data.prompt_hash).toBe(ROUTING_PROMPT_HASH);
  expect(data.system_chars).toBe(ROUTING_PROMPT_SYSTEM_CHARS);
}

describe('TurnExecutor observability (Phase 2.5)', () => {
  it('recoverable validator path: every primary event carries the full obs field set', async () => {
    const routingAdapter = mockRoutingAdapter(RECOVERABLE_VALIDATOR_INPUT);

    await runTurnExecutor(BASE_PAYLOAD, 'req-obs-1', {
      routingAdapter,
      graphState: GRAPH_WITH_OPTIONS,
    });

    // turn_executor.started — full obs set (most late-bound fields null).
    const started = primaryEvent('turn_executor.started');
    expect(started).toBeDefined();
    assertFullObs(started!.data);
    expect(started!.data.handler_proposed).toBeNull();
    expect(started!.data.validator_outcome).toBeNull();

    // v5.context_pack.assembled — context_pack_chars populated after this.
    const assembled = primaryEvent('v5.context_pack.assembled');
    expect(assembled).toBeDefined();
    assertFullObs(assembled!.data);
    expect(assembled!.data.context_pack_chars as number).toBeGreaterThan(0);

    // v5.validator_outcome — validator_outcome populated (the error code).
    const validatorOutcome = primaryEvent('v5.validator_outcome');
    expect(validatorOutcome).toBeDefined();
    assertFullObs(validatorOutcome!.data);
    expect(validatorOutcome!.data.validator_outcome).toBe('HANDLER_NOT_FOUND');
    expect(validatorOutcome!.data.handler_proposed).toBe('not_a_real_handler');

    // v5.recovery_response — fires on recoverable validator outcome.
    const recovery = primaryEvent('v5.recovery_response');
    expect(recovery).toBeDefined();
    assertFullObs(recovery!.data);
    expect(recovery!.data.validation_error_code).toBe('HANDLER_NOT_FOUND');

    // turn_executor.completed — response_type populated at bookend.
    const completed = primaryEvent('turn_executor.completed');
    expect(completed).toBeDefined();
    assertFullObs(completed!.data);
    expect(completed!.data.response_type).toBe('direct_answer');
    expect(completed!.data.commit_performed).toBe(true);
  });

  it('v5_journey_id is identical across every primary event in a single turn', async () => {
    const routingAdapter = mockRoutingAdapter(RECOVERABLE_VALIDATOR_INPUT);

    await runTurnExecutor(BASE_PAYLOAD, 'req-obs-2', {
      routingAdapter,
      graphState: GRAPH_WITH_OPTIONS,
    });

    const primaryNames = [
      'turn_executor.started',
      'v5.context_pack.assembled',
      'v5.validator_outcome',
      'v5.recovery_response',
      'turn_executor.completed',
    ];
    const journeyIds = new Set<unknown>();
    for (const name of primaryNames) {
      const ev = primaryEvent(name);
      expect(ev, `missing primary event ${name}`).toBeDefined();
      journeyIds.add(ev!.data.v5_journey_id);
    }
    // All the same id.
    expect(journeyIds.size).toBe(1);
    expect(journeyIds.has(SCENARIO_ID)).toBe(true);
  });

  it('no user decision text lands in any primary event payload', async () => {
    const routingAdapter = mockRoutingAdapter(RECOVERABLE_VALIDATOR_INPUT);

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'I need to decide whether to fire my business partner' },
      'req-obs-3',
      {
        routingAdapter,
        graphState: GRAPH_WITH_OPTIONS,
      },
    );

    for (const ev of events) {
      const serialised = JSON.stringify(ev.data);
      // The user's decision text must never reach the telemetry sink.
      expect(serialised, `user text leaked in ${ev.event}`).not.toContain(
        'fire my business partner',
      );
    }
  });
});
