/**
 * Route-level test for the short-confirm resume path.
 *
 * Mocks the session store to return a populated pending action and
 * asserts:
 *   - the routing LLM adapter is NEVER called when the user types "yes"
 *     after a run_analysis offer
 *   - the routing LLM adapter IS called for non-confirmation messages
 *     (proves mutual exclusion with the value-update pre-route is the
 *     regex content, not a global short-circuit)
 *   - chip-click equivalence: a chip_click ingress with
 *     action_type='run_analysis' goes through dispatchChipClickRunAnalysis
 *     (route-v2 layer), bypassing TurnExecutor entirely; verified by the
 *     route-v2 unit test elsewhere. This file pins the typed-yes path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

const SCENARIO_ID = randomUUID();

const PENDING_RUN_ANALYSIS: PendingAction = {
  id: `pa-${randomUUID()}`,
  scenario_id: SCENARIO_ID,
  chip_id: 'chip_action_run_analysis_TEST',
  action: { kind: 'run_analysis' },
  preconditions: {},
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-05-05T00:00:00.000Z',
};

const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [PENDING_RUN_ANALYSIS],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): OrchestratorTurnPayload {
  return {
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'analyse',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when short-confirm matches');
      }),
  };
}

function callingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Some Sonnet text.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

describe('Short-confirm pre-route — route-level zero-LLM assertion', () => {
  beforeEach(() => {
    appendCalls.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'yes',
    'yes please',
    'yes thanks',
    'do it',
    'do that',
    'go ahead',
    'apply it',
    'ok thanks',
    'sure',
    'confirmed',
  ])('typed "%s" after a run_analysis offer does NOT call the routing LLM', async (msg) => {
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload(msg), `req-${msg.replace(/\s+/g, '-')}`, {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
  });

  it('non-confirmation "why is this close?" DOES route to the LLM', async () => {
    const adapter = callingRoutingAdapter();
    await runTurnExecutor(payload('why is this close?'), 'req-why-not-confirm', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });

  it('non-confirmation with edit verb "yes increase budget" DOES route to the LLM (negative gate)', async () => {
    const adapter = callingRoutingAdapter();
    await runTurnExecutor(
      payload('yes increase the budget'),
      'req-edit-verb-passes-through',
      { routingAdapter: adapter },
    );
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });
});
