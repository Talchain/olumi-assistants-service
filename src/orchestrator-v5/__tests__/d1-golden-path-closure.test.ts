/**
 * V5 D1 golden-path closure (A3.1) — end-to-end pre-route → handler
 * dispatch tests for the canonical user phrasings.
 *
 * Pins:
 *   - "Set churn to 5%" with one matching factor → set_factor_value
 *     dispatches; mutated graph reaches commit; CQE percentage
 *     pre-normalisation is undone correctly (raw_value=5, value=0.05;
 *     NOT 0.05 / 100 = 0.0005).
 *   - "Set budget to £50,000" → currency passes through; raw_value=50000.
 *   - "Reduce churn by 1 percentage point" → operator=decrease applied
 *     to the existing raw_value.
 *
 * Each test asserts the FULL chain: telemetry shape, fact shape,
 * response.blocks.graph_patch, commit's `graph` arg. No bespoke
 * dispatch shortcut — the synthesised RoutingToolCallResult flows
 * through the same Step 2-7 lifecycle a Sonnet tool-call would.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

const appendCalls: Array<{
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
  turn_class?: unknown;
}> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: {
      graph?: unknown;
      handler_id?: unknown;
      handler_facts?: unknown;
      turn_class?: unknown;
    }) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
  });
}

/**
 * Adapter that throws if called. Pre-route dispatch must not invoke the
 * routing LLM — it synthesises its own RoutingToolCallResult.
 */
function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when pre-route matches');
      }),
  };
}

function buildChurnGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-churn',
        kind: 'factor',
        label: 'Churn',
        observed_state: { value: 0.04, raw_value: 4, unit: '%', cap: 100 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  };
}

function buildBudgetGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  };
}

beforeEach(() => {
  appendCalls.length = 0;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
});

describe('A3.1 golden-path closure — pre-route dispatches set_factor_value via shared lifecycle', () => {
  it('"Set churn to 5%" → set_factor_value handler dispatches, raw_value=5 / value=0.05 (CQE percentage NOT double-normalised)', async () => {
    // Phase 0 evidence: CQE returns { value: 0.05, unit: 'percentage' }
    // for "5%". The pre-route's mapCqeQuantityToProposalValue must
    // multiply back to user units (5) and emit unit='%' so the handler
    // computes 5 / 100 = 0.05. Without the multiply-back, the handler
    // would store 0.05 / 100 = 0.0005 — silent double-normalisation.
    const routingAdapter = throwingRoutingAdapter();
    const ingressGraph = buildChurnGraph();

    const { response, telemetry } = await runTurnExecutor(
      payload('Set churn to 5%'),
      'req-a31-churn',
      { routingAdapter, graphState: ingressGraph },
    );

    // Adapter not called → pre-route synthesised the routing result.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.failure_type).toBeNull();

    // Telemetry shape identical to a Sonnet-routed tool call.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.intent_class).toBe('execute');
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.stages_completed).toContain('execute');
    expect(telemetry.stages_completed).toContain('commit');
    expect(telemetry.llm_calls_used).toBe(0);

    // Response carries the graph_patch block compose emits for any
    // set_factor_value fact (same shape as Sonnet route).
    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'f-churn',
      status: 'applied',
    });

    // Confirmation in decision language, no raw model decimals.
    expect(response.assistant_text).toContain('Churn');
    expect(response.assistant_text).toContain('5%');
    expect(response.assistant_text).not.toContain('0.05');

    // Commit captured the MUTATED graph (not the ingress).
    expect(appendCalls).toHaveLength(1);
    const committedGraph = appendCalls[0].graph as GraphV3T;
    const churn = committedGraph.nodes.find((n) => n.id === 'f-churn');
    expect(churn?.observed_state?.raw_value).toBe(5);
    expect(churn?.observed_state?.value).toBe(0.05);
    // Ingress unchanged — handler returned a fresh object.
    expect(ingressGraph.nodes.find((n) => n.id === 'f-churn')?.observed_state?.raw_value).toBe(4);

    // handler_id stamped on commit.
    expect(appendCalls[0].handler_id).toBe('set_factor_value');
    expect(appendCalls[0].turn_class).toBe('handler');
  });

  it('"Set budget to £50,000" → currency passes through, raw_value=50000 / value=0.5', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const ingressGraph = buildBudgetGraph();

    const { response, telemetry } = await runTurnExecutor(
      payload('Set budget to £50,000'),
      'req-a31-budget',
      { routingAdapter, graphState: ingressGraph },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.llm_calls_used).toBe(0);

    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'f-budget',
      status: 'applied',
    });

    const committedGraph = appendCalls[0].graph as GraphV3T;
    const budget = committedGraph.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(50000);
    expect(budget?.observed_state?.value).toBe(0.5);

    // Currency formatting in confirmation: prefix unit, thousands
    // separator. No raw decimals.
    expect(response.assistant_text).toContain('£50,000');
    expect(response.assistant_text).not.toContain('0.5');
  });

  it('"Increase budget to £50,000" → operator=set (NOT increase by 50k), raw_value=50000 not 90000 (P0 directional-to fix)', async () => {
    // Regression pin: CQE returns
    //   { value: 50000, unit: 'GBP', direction: 'up', operator: 'set' }
    // for "Increase budget to £50,000". The verb-flavoured `direction:
    // 'up'` would otherwise pick `operator: 'increase'` and apply
    // 40000 + 50000 = 90000 — the user asked to SET to £50,000, not
    // ADD £50k. CQE's `operator: 'set'` is the truth; deriveOperator
    // must prefer it over direction.
    const routingAdapter = throwingRoutingAdapter();
    const ingressGraph = buildBudgetGraph();

    const { telemetry } = await runTurnExecutor(
      payload('Increase budget to £50,000'),
      'req-a31-increase-to',
      { routingAdapter, graphState: ingressGraph },
    );

    expect(telemetry.turn_class).toBe('handler');
    const committedGraph = appendCalls[0].graph as GraphV3T;
    const budget = committedGraph.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(50000); // SET, not 90000
    expect(budget?.observed_state?.value).toBe(0.5);
  });

  it('"Reduce churn to 5%" → operator=set (NOT decrease by 5pp), raw_value=5 not -1 (P0 directional-to fix)', async () => {
    // Mirror of the above for "down". CQE returns
    //   { value: 0.05, unit: 'percentage', direction: 'down', operator: 'set' }
    // Pre-fix the handler applied 4% - 5pp = -1% (and the percentage
    // double-normalisation worsened it further). Post-fix `operator:
    // 'set'` wins, percentage user-units recovered, raw_value: 5.
    const routingAdapter = throwingRoutingAdapter();
    const ingressGraph = buildChurnGraph();

    const { telemetry } = await runTurnExecutor(
      payload('Reduce churn to 5%'),
      'req-a31-reduce-to',
      { routingAdapter, graphState: ingressGraph },
    );

    expect(telemetry.turn_class).toBe('handler');
    const committedGraph = appendCalls[0].graph as GraphV3T;
    const churn = committedGraph.nodes.find((n) => n.id === 'f-churn');
    expect(churn?.observed_state?.raw_value).toBe(5); // SET, not -1
    expect(churn?.observed_state?.value).toBe(0.05);
  });

  it('"Reduce churn by 1 percentage point" → operator=decrease, raw_value=3 / value=0.03', async () => {
    // CQE returns { value: 1, unit: 'percentage_points', direction: null }
    // for "1 percentage point". The pre-route maps unit → '%', value
    // passes through; operator falls back to the verb ("reduce" → decrease).
    // Handler applies decrement to raw_value: 4 - 1 = 3.
    const routingAdapter = throwingRoutingAdapter();
    const ingressGraph = buildChurnGraph();

    const { response } = await runTurnExecutor(
      payload('Reduce Churn by 1 percentage point'),
      'req-a31-pp',
      { routingAdapter, graphState: ingressGraph },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();

    const patchBlock = response.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toMatchObject({
      operation: 'set_factor_value',
      target_id: 'f-churn',
    });

    const committedGraph = appendCalls[0].graph as GraphV3T;
    const churn = committedGraph.nodes.find((n) => n.id === 'f-churn');
    expect(churn?.observed_state?.raw_value).toBe(3);
    expect(churn?.observed_state?.value).toBe(0.03);
  });
});
