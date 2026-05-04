/**
 * End-to-end integration test — V5 A4 bare add_risk clarification through
 * `dispatchEditGraph`.
 *
 * Pins the corrective behavior: high-confidence bare add-risk requests are
 * handled deterministically with zero LLM calls, but do not mutate or persist
 * the graph until the user specifies what drives the risk.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You edit causal decision graphs'),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
}));

const { llmChatMock } = vi.hoisted(() => ({ llmChatMock: vi.fn() }));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'test',
    model: 'test-model',
    chat: llmChatMock,
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../src/orchestrator-v5/commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

const { priorFactsOverrideRef } = vi.hoisted(() => ({
  priorFactsOverrideRef: { current: null as unknown[] | null },
}));
vi.mock('../../../src/orchestrator-v5/build-turn-context.js', () => ({
  buildTurnContext: vi.fn(async () => ({
    goal_node_id: 'goal_growth',
    prior_facts: priorFactsOverrideRef.current ?? [],
    framing: { stage: 'analyse' },
    analysis_inputs: null,
    handler_row_ids: [],
    request_id: 'req-stub',
    scenario_id: 'sc-stub',
    turn_id: 'turn-stub',
    user_id: null,
    handler_id: null,
    received_at: new Date().toISOString(),
  })),
}));

// ────────────────────────────────────────────────────────────────────
// Imports after mocks
// ────────────────────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../../src/orchestrator-v5/commit.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { setTestSink, TelemetryEvents } from '../../../src/utils/telemetry.js';

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUB_REQUEST = {} as FastifyRequest;

const PRICING_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Reach 1000 customers' },
    { id: 'dec_pricing', kind: 'decision', label: 'Pricing model' },
    { id: 'opt_subscription', kind: 'option', label: 'Subscription' },
    { id: 'opt_oneoff', kind: 'option', label: 'One-off' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  edges: [
    { from: 'dec_pricing', to: 'opt_subscription', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_pricing', to: 'opt_oneoff', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_subscription', to: 'fac_price', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'opt_oneoff', to: 'fac_price', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'fac_price', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  ],
} as unknown as GraphStateIngress;

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Add team dynamics as a risk',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-add-risk',
    graphPersisted: false,
  };
}

beforeEach(() => {
  llmChatMock.mockReset();
  priorFactsOverrideRef.current = null;
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('dispatchEditGraph e2e — bare add_risk clarification path', () => {
  it('"Add team dynamics as a risk" → deterministic clarification, 0 LLM calls, no graph mutation or persistence', async () => {
    const originalGraph = JSON.parse(JSON.stringify(PRICING_GRAPH)) as GraphStateIngress;

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-add-risk-clarify',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    expect(llmChatMock).not.toHaveBeenCalled();
    expect(result.response.blocks).toEqual([]);
    expect(result.response.suggested_actions).toEqual([]);
    expect(result.response.assistant_text).toBe(
      'I can add ‘Team dynamics’ as a risk. What factor drives it most — for example team size, hiring pace, or onboarding complexity?',
    );

    expect(result.response.assistant_text).not.toMatch(/risk_team_dynamics/);
    expect(result.response.assistant_text).not.toMatch(/\b(?:decision|node|edge|topology|graph mechanics)\b/i);
    expect(result.response.assistant_text).not.toMatch(/\boperation\b/i);
    expect(result.response.assistant_text).not.toMatch(/\bpatch\b/i);
    expect(result.response.assistant_text).not.toMatch(/\bschema\b/i);
    expect(result.response.assistant_text).not.toMatch(/\bzod\b/i);
    expect(result.response.assistant_text).not.toMatch(/\b\d+\s+(?:operation|edge|node)/i);

    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    expect(calls).toHaveLength(1);
    const [, metadata] = calls[0]!;
    expect(metadata.llm_calls_used).toBe(0);
    expect(metadata.graph).toBeUndefined();

    expect(result.graph).toBeNull();
    expect(result.analysisReady).toBeUndefined();
    expect(PRICING_GRAPH).toEqual(originalGraph);
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('produces no decision-to-risk edge, no risk node, and no synthetic factor', async () => {
    const result = await dispatchEditGraph({
      payload: makePayload({ turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      requestId: 'req-add-risk-no-synthetic-graph',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    expect(llmChatMock).not.toHaveBeenCalled();
    expect(result.graph).toBeNull();

    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    const [, metadata] = calls[0]!;
    expect(metadata.graph).toBeUndefined();

    expect(PRICING_GRAPH.nodes.some((n) => n.id === 'risk_team_dynamics' || n.label === 'team dynamics')).toBe(false);
    expect(PRICING_GRAPH.nodes.some((n) => n.kind === 'factor' && /team dynamics|hiring pace|onboarding complexity/i.test(n.label ?? ''))).toBe(false);
    expect(PRICING_GRAPH.edges.some((e) => e.from === 'dec_pricing' && e.to === 'risk_team_dynamics')).toBe(false);
  });

  it('with matching prior analysis fact → freshness remains fresh because the graph is unchanged', async () => {
    const originalGraph = JSON.parse(JSON.stringify(PRICING_GRAPH)) as GraphStateIngress;
    const currentGraphHash = computeAnalysisAffectingGraphHash(PRICING_GRAPH);
    priorFactsOverrideRef.current = [
      {
        fact_type: 'run_analysis',
        noop: false,
        result: {
          graph_hash_at_run: currentGraphHash,
          computed_at: '2025-01-01T00:00:00.000Z',
          enrichment: { analysis_status: 'computed' },
        },
      },
    ];

    const result = await dispatchEditGraph({
      payload: makePayload({ turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
      requestId: 'req-add-risk-freshness',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    expect(llmChatMock).not.toHaveBeenCalled();
    expect(result.freshness).toBeDefined();
    expect(result.freshness!.freshness).toBe('fresh');
    expect(result.freshness!.graph_hash_at_run).toBe(currentGraphHash);
    expect(result.freshness!.current_graph_hash).toBe(currentGraphHash);

    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    const [, metadata] = calls[0]!;
    expect(metadata.graph).toBeUndefined();
    expect(PRICING_GRAPH).toEqual(originalGraph);
  });

  it('non-canonical ingress edges → deterministic add-risk path does NOT fire', async () => {
    llmChatMock.mockResolvedValue({
      content: JSON.stringify({ operations: [], removed_edges: [], warnings: [], coaching: { summary: 'No-op.' } }),
    });

    const nonCanonical: GraphStateIngress = {
      nodes: [
        { id: 'goal_growth', kind: 'goal', label: 'G' },
        { id: 'dec_pricing', kind: 'decision', label: 'D' },
        { id: 'opt_a', kind: 'option', label: 'A' },
        { id: 'opt_b', kind: 'option', label: 'B' },
      ],
      edges: [
        { from: 'dec_pricing', to: 'opt_a' },
        { from: 'dec_pricing', to: 'opt_b' },
      ],
    } as unknown as GraphStateIngress;

    await dispatchEditGraph({
      payload: makePayload({ turn_id: '11111111-2222-4333-8444-555555555555' }),
      requestId: 'req-add-risk-non-canonical',
      request: STUB_REQUEST,
      graphState: nonCanonical,
      analysisState: null,
    });

    expect(llmChatMock).toHaveBeenCalled();
  });

  it('compound request "Add team dynamics as a risk and connect it to churn" → falls through to LLM', async () => {
    llmChatMock.mockResolvedValue({
      content: JSON.stringify({ operations: [], removed_edges: [], warnings: [], coaching: { summary: 'No-op.' } }),
    });

    await dispatchEditGraph({
      payload: makePayload({ message: 'Add team dynamics as a risk and connect it to churn' }),
      requestId: 'req-add-risk-compound',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    expect(llmChatMock).toHaveBeenCalled();
  });

  it('emits V5EditGraphAddRiskClarified telemetry exactly once with privacy-safe payload', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => {
      events.push({ name, data });
    });
    try {
      await dispatchEditGraph({
        payload: makePayload({ turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
        requestId: 'req-add-risk-telemetry',
        request: STUB_REQUEST,
        graphState: PRICING_GRAPH,
        analysisState: null,
      });
    } finally {
      setTestSink(null);
    }

    const clarifiedEvents = events.filter((e) => e.name === TelemetryEvents.V5EditGraphAddRiskClarified);
    expect(clarifiedEvents).toHaveLength(1);
    const payload = clarifiedEvents[0]!.data;
    // Privacy-safe payload — required keys present, no label content leak.
    expect(payload.request_id).toBe('req-add-risk-telemetry');
    expect(payload.scenario_id).toBe(SCENARIO_ID);
    expect(typeof payload.latency_ms).toBe('number');
    expect(payload.latency_ms).toBeGreaterThanOrEqual(0);
    expect(payload.label_length).toBe('team dynamics'.length);
    // No raw label content in the payload.
    expect(JSON.stringify(payload)).not.toMatch(/team dynamics/i);
    // Retired events must not be emitted.
    expect(events.some((e) => e.name === 'v5.edit_graph.template_applied')).toBe(false);
    expect(events.some((e) => e.name === 'v5.edit_graph.template_rejected')).toBe(false);
  });

  it('canonical graph with no decision node still clarifies without LLM or graph mutation', async () => {
    const noDecisionCanonical: GraphStateIngress = {
      nodes: [
        { id: 'goal_growth', kind: 'goal', label: 'Reach 1000 customers' },
        { id: 'fac_price', kind: 'factor', label: 'Price' },
      ],
      edges: [
        {
          from: 'fac_price',
          to: 'goal_growth',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.8,
          effect_direction: 'positive' as const,
        },
      ],
    } as unknown as GraphStateIngress;

    const result = await dispatchEditGraph({
      payload: makePayload({ turn_id: '99999999-9999-4999-8999-999999999999' }),
      requestId: 'req-add-risk-no-decision',
      request: STUB_REQUEST,
      graphState: noDecisionCanonical,
      analysisState: null,
    });

    expect(llmChatMock).not.toHaveBeenCalled();
    expect(result.graph).toBeNull();

    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    const [, metadata] = calls[0]!;
    expect(metadata.llm_calls_used).toBe(0);
    expect(metadata.graph).toBeUndefined();
  });
});
