/**
 * TurnExecutor × deterministic value-update pre-route — wire-level test.
 *
 * Asserts that when the pre-route detects an explicit value-update phrasing,
 * the turn:
 *   - never calls the routing adapter (llm_calls_used === 0)
 *   - emits a clarify-shape direct_answer with candidate factor chips
 *   - emits the v5.deterministic_value_update telemetry event
 *
 * The pre-route lives BEFORE `routeWithToolUse` in turn-executor's lifecycle,
 * so a routing-adapter mock that throws on call is the simplest way to
 * verify the pre-route really skipped the LLM.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

// Same session-store mock pattern as turn-executor-handler.test.ts.
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
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function payload(message: string): OrchestratorTurnPayload {
  return {
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function graphWithFactor(label: string) {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'fac_1', kind: 'factor', label },
      { id: 'opt_a', kind: 'option', label: 'Opt A' },
      { id: 'opt_b', kind: 'option', label: 'Opt B' },
    ],
    edges: [],
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when pre-route matches');
      }),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  appendCalls.length = 0;
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

describe('turn-executor × deterministic value-update pre-route', () => {
  it('"Set Hiring and Staffing Cost to £300k" → clarify direct_answer with no LLM call', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Hiring and Staffing Cost to £300k'),
      'req-pre-route-exact',
      {
        routingAdapter,
        graphState: graphWithFactor('Hiring and Staffing Cost'),
      },
    );

    // Pre-route fired → adapter never called.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();

    // Response carries clarify text + at least one candidate chip.
    expect(response.assistant_text).toContain("wasn't sure");
    expect(response.suggested_actions.length).toBeGreaterThan(0);
    expect(response.suggested_actions[0].label).toBe('Hiring and Staffing Cost');

    // Telemetry: v5.deterministic_value_update with matched=true.
    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent).toBeDefined();
    expect(preRouteEvent?.data.matched).toBe(true);
    expect(preRouteEvent?.data.dispatch).toBe('clarify');

    // No llm_calls used.
    expect(telemetry?.llm_calls_used ?? 0).toBe(0);
  });

  it('"What if I set the budget to £300k?" → falls through to LLM (negative gate)', async () => {
    // The negative gate fires on "what if". The routing adapter MUST be
    // called — meaning the pre-route declined. We don't need a real
    // routing flow here; a noop response is enough to confirm the call.
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue({
          content: [{ type: 'text' as const, text: 'A clarifying response.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 } as never,
          model: 'claude-sonnet-4-6',
          latencyMs: 50,
        }),
    };

    await runTurnExecutor(
      payload('What if I set the budget to £300k?'),
      'req-pre-route-hypothetical',
      {
        routingAdapter,
        graphState: graphWithFactor('budget'),
      },
    );

    // Adapter was called → pre-route correctly declined.
    expect(routingAdapter.chatWithTools).toHaveBeenCalled();

    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent?.data.matched).toBe(false);
    expect(preRouteEvent?.data.skip_reason).toBe('hypothetical_gate');
  });
});
