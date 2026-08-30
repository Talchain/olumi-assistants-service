/**
 * Lane CEE-D (edit-loop reliability) — Defect cluster B: tool-call
 * relative-delta rejection.
 *
 * Live trace (this morning, request_id baca4f1c): user "increase it
 * slightly by 5%" → handler_proposed set_factor_value with a
 * percent-relative value on a £ factor → CEE V5 validator
 * PARAMETER_INVALID parameter:"value" → recovered template. An ABSOLUTE
 * set_factor_value succeeded in the same session (turn 91a45b0a).
 *
 * Fix under test: when the proposal carries a relative percent
 * expression (structured { value, unit:'%' } with an increase/decrease
 * operator, or a string "+5%"/"-10%"), the dispatch seam resolves it
 * into dimensionless multiplication BEFORE validation. The validator and
 * handler must select a usable canonical starting point; fallback/ambiguous
 * quantities receive clarification, never an apparent absolute user value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult, ToolResponseBlock } from '../../adapters/llm/types.js';
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
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
  });
}

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
    latencyMs: 50,
  };
}

function mockRoutingAdapter(input: unknown) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => mkToolUseResult(input)),
  };
}

/** £ factor with a resolved current value: raw £40,000 (value 0.4, cap 100k). */
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

/** Factor with NO recorded value — a delta has no LHS; must clarify, never guess. */
function buildNoValueGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'f-budget', kind: 'factor', label: 'Budget' },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  };
}

/** % factor — percent-on-percent stays on today's pp-addition semantics. */
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

function setFactorValueProposal(valueParam: unknown, operator?: string) {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-budget',
        kind: 'node',
        label: 'Budget',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [
        {
          name: 'value',
          value: valueParam,
          ...(operator ? { operator } : {}),
          source: 'user_explicit',
        },
      ],
      cited_context_fields: [],
    },
  };
}

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

describe('B: relative-delta resolution at the set_factor_value dispatch seam', () => {
  it('LIVE-TRACE REPRO (baca4f1c): "increase it slightly by 5%" with a structured percent delta on a £ factor applies £40,000 → £42,000', async () => {
    const routingAdapter = mockRoutingAdapter(
      setFactorValueProposal({ value: 5, unit: '%' }, 'increase'),
    );
    const ingressGraph = buildBudgetGraph();

    const { response, telemetry } = await runTurnExecutor(
      payload('increase it slightly by 5%'),
      'req-rel-live',
      { routingAdapter, graphState: ingressGraph },
    );

    // Relative semantics survive routing; the handler computes the result.
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.stages_completed).toContain('execute');

    // Graph mutated: £40,000 + 5% = £42,000.
    expect(appendCalls).toHaveLength(1);
    const committedGraph = appendCalls[0]!.graph as GraphV3T;
    const budget = committedGraph.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(42000);
    expect(budget?.observed_state?.value).toBeCloseTo(0.42, 10);

    // Structural honesty: the receipt states the resolved ABSOLUTE change.
    expect(response.assistant_text).toContain('£40,000');
    expect(response.assistant_text).toContain('£42,000');

    // Telemetry: one resolution event fired.
    const resolutionEvents = events.filter(
      (e) => e.event === 'v5.turn_executor.relative_delta_resolved',
    );
    expect(resolutionEvents).toHaveLength(1);
    expect(resolutionEvents[0]!.data).toMatchObject({
      target_id: 'f-budget',
      direction: 'increase',
      source_shape: 'structured_percent',
    });
  });

  it('resolves a string "-10%" relative expression to an absolute decrease (£40,000 → £36,000)', async () => {
    const routingAdapter = mockRoutingAdapter(setFactorValueProposal('-10%'));
    const ingressGraph = buildBudgetGraph();

    const { telemetry, response } = await runTurnExecutor(
      payload('reduce it by 10%'),
      'req-rel-string',
      { routingAdapter, graphState: ingressGraph },
    );

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    expect(appendCalls).toHaveLength(1);
    const committedGraph = appendCalls[0]!.graph as GraphV3T;
    const budget = committedGraph.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(36000);
    expect(response.assistant_text).toContain('£36,000');

    const resolutionEvents = events.filter(
      (e) => e.event === 'v5.turn_executor.relative_delta_resolved',
    );
    expect(resolutionEvents).toHaveLength(1);
    expect(resolutionEvents[0]!.data).toMatchObject({
      direction: 'decrease',
      source_shape: 'string_percent',
    });
  });

  it.each(['increase it slightly by 5%', 'increase Budget by 5%'])(
    'asks for a complete value without promoting a fallback: %s',
    async (message) => {
      const ingressGraph = buildBudgetGraph();
      const budget = ingressGraph.nodes.find((n) => n.id === 'f-budget')!;
      budget.observed_state = {
        ...budget.observed_state!, source: 'cee_inference', value_tier: 'fallback_default',
      };
      const original = JSON.stringify(ingressGraph);
      const { response, telemetry } = await runTurnExecutor(payload(message), 'req-relative-fallback', {
        routingAdapter: mockRoutingAdapter(setFactorValueProposal({ value: 5, unit: '%' }, 'increase')),
        graphState: ingressGraph,
      });
      expect(telemetry.turn_class).toBe('direct_answer');
      expect(telemetry.validation_error_code).toBe('PARAMETER_INVALID');
      expect(response.assistant_text).toContain('fallback starting value');
      expect(response.assistant_text).toContain('complete value');
      expect(response.assistant_text).not.toContain("doesn't have a recorded value");
      expect(appendCalls.filter((w) => w.graph != null)).toHaveLength(0);
      expect(JSON.stringify(ingressGraph)).toBe(original);
    },
  );

  it.each([13200, 13199])('relative decimal result respects the actual cap %s', async (cap) => {
    const ingressGraph = buildBudgetGraph();
    ingressGraph.nodes[1]!.observed_state = {
      value: 12000 / cap, raw_value: 12000, unit: '£', cap, source: 'user_override',
    };
    const { telemetry, response } = await runTurnExecutor(payload('increase it by 10%'), 'req-relative-cap', {
      routingAdapter: mockRoutingAdapter(setFactorValueProposal({ value: 10, unit: '%' }, 'increase')),
      graphState: ingressGraph,
    });
    const writes = appendCalls.filter((w) => w.graph != null);
    if (cap === 13200) {
      expect(telemetry.turn_class).toBe('handler');
      expect(writes).toHaveLength(1);
      const graph = writes[0]!.graph as GraphV3T;
      expect(graph.nodes[1]!.observed_state).toMatchObject({
        value: 1, raw_value: 13200, cap, source: 'user_override',
      });
      expect(response.assistant_text).toContain('£13,200');
    } else {
      expect(telemetry.validation_error_code).toBe('PARAMETER_INVALID');
      expect(writes).toHaveLength(0);
    }
  });

  it('CONTROL (91a45b0a shape): an absolute set_factor_value still succeeds unchanged', async () => {
    const routingAdapter = mockRoutingAdapter(
      setFactorValueProposal({ value: 45000, unit: '£' }, 'set'),
    );
    const ingressGraph = buildBudgetGraph();

    const { telemetry } = await runTurnExecutor(payload('set the budget to £45,000'), 'req-abs', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    const committedGraph = appendCalls[0]!.graph as GraphV3T;
    const budget = committedGraph.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(45000);

    // No resolution event on the absolute path.
    expect(
      events.filter((e) => e.event === 'v5.turn_executor.relative_delta_resolved'),
    ).toHaveLength(0);
  });

  it('NEVER GUESS: a percent delta against a factor with no recorded value keeps the clarify/recovery path', async () => {
    const routingAdapter = mockRoutingAdapter(
      setFactorValueProposal({ value: 5, unit: '%' }, 'increase'),
    );
    const ingressGraph = buildNoValueGraph();

    const { telemetry } = await runTurnExecutor(
      payload('increase it slightly by 5%'),
      'req-rel-noval',
      { routingAdapter, graphState: ingressGraph },
    );

    // Recovered direct_answer, graph unchanged, no resolution event.
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(telemetry.validation_error_code).toBe('PARAMETER_INVALID');
    expect(
      events.filter((e) => e.event === 'v5.turn_executor.relative_delta_resolved'),
    ).toHaveLength(0);
    const mutationWrites = appendCalls.filter((w) => w.graph != null);
    expect(mutationWrites).toHaveLength(0);
  });

  it('PERCENT-ON-PERCENT UNCHANGED: increase-by-5% on a % factor keeps today\'s percentage-point semantics (4% → 9%)', async () => {
    const routingAdapter = mockRoutingAdapter({
      intent_class: 'execute',
      action: {
        handler_id: 'set_factor_value',
        entity: {
          id: 'f-churn',
          kind: 'node',
          label: 'Churn',
          resolution_status: 'resolved',
          resolution_method: 'context_inference',
        },
        parameters: [
          {
            name: 'value',
            value: { value: 5, unit: '%' },
            operator: 'increase',
            source: 'user_explicit',
          },
        ],
        cited_context_fields: [],
      },
    });
    const ingressGraph = buildChurnGraph();

    const { telemetry } = await runTurnExecutor(
      payload('increase churn by 5%'),
      'req-rel-pp',
      { routingAdapter, graphState: ingressGraph },
    );

    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.failure_type).toBeNull();
    const committedGraph = appendCalls[0]!.graph as GraphV3T;
    const churn = committedGraph.nodes.find((n) => n.id === 'f-churn');
    // Today's pp-addition semantics preserved — NOT 4 * 1.05 = 4.2.
    expect(churn?.observed_state?.raw_value).toBe(9);

    // No relative resolution fired — the factor's own unit is %.
    expect(
      events.filter((e) => e.event === 'v5.turn_executor.relative_delta_resolved'),
    ).toHaveLength(0);
  });
});
