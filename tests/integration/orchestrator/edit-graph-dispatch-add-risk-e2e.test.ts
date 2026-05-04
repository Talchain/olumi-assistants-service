/**
 * End-to-end integration test — V5 A4 add_risk template through
 * `dispatchEditGraph`.
 *
 * Pins the brief's acceptance criteria for the deterministic template
 * happy path:
 *   - "Add team dynamics as a risk" triggers the template.
 *   - Zero LLM adapter calls (template bypasses handleEditGraph).
 *   - Post-edit graph carries the new risk node + decision->risk +
 *     risk->goal (negative) bridge edges.
 *   - editResultToOlumiResponse emits no blocks (success path matches
 *     LLM success path: applied graph reaches UI via analysis_ready).
 *   - assistantText is the friendly confirmation asking what factors
 *     drive the risk — no raw IDs, no operation counts.
 *   - commitDirectAnswer receives llm_calls_used: 0 and a non-undefined
 *     `graph` (so scenarios.graph is updated atomically with the turn).
 *   - analysisReady is computed from the post-edit graph.
 *   - Boundary OlumiResponseSchema parse succeeds.
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

// ────────────────────────────────────────────────────────────────────
// Imports after mocks
// ────────────────────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../../src/orchestrator-v5/commit.js';
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

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
    { from: 'dec_pricing', to: 'opt_subscription' },
    { from: 'dec_pricing', to: 'opt_oneoff' },
    { from: 'opt_subscription', to: 'fac_price' },
    { from: 'opt_oneoff', to: 'fac_price' },
    { from: 'fac_price', to: 'goal_growth' },
  ],
};

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
    graphPersisted: true,
  };
}

beforeEach(() => {
  llmChatMock.mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('dispatchEditGraph e2e — add_risk template happy path', () => {
  it('"Add team dynamics as a risk" → 0 LLM calls, applied graph mutated, llm_calls_used=0, no blocks', async () => {
    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-add-risk-happy',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    // (1) ZERO LLM calls — template fired.
    expect(llmChatMock).not.toHaveBeenCalled();

    // (2) Wire envelope shape: success path emits no blocks (parity with
    // LLM success — applied graph reaches UI via analysis_ready).
    expect(result.response.blocks).toEqual([]);

    // (3) assistantText is friendly + asks about drivers; no raw IDs / counts.
    expect(result.response.assistant_text).toContain('team dynamics');
    expect(result.response.assistant_text).toContain('What factors drive this risk');
    expect(result.response.assistant_text).not.toMatch(/risk_team_dynamics/);
    expect(result.response.assistant_text).not.toMatch(/\boperation\b/i);
    expect(result.response.assistant_text).not.toMatch(/\b\d+\s+(?:operation|edge|node)/i);

    // (4) commitDirectAnswer received llm_calls_used: 0 and the post-edit graph.
    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    expect(calls).toHaveLength(1);
    const [, metadata] = calls[0]!;
    expect(metadata.llm_calls_used).toBe(0);
    expect(metadata.graph).toBeDefined();
    const persistedGraph = metadata.graph as { nodes: Array<{ id: string; kind: string }>; edges: Array<{ from: string; to: string; strength: { mean: number }; effect_direction: string }> };
    expect(persistedGraph.nodes.some((n) => n.id === 'risk_team_dynamics' && n.kind === 'risk')).toBe(true);

    // (5) Decision -> risk bridge present (positive).
    const decisionBridge = persistedGraph.edges.find((e) => e.from === 'dec_pricing' && e.to === 'risk_team_dynamics');
    expect(decisionBridge).toBeDefined();
    expect(decisionBridge!.effect_direction).toBe('positive');

    // (6) Risk -> goal bridge present (negative).
    const goalBridge = persistedGraph.edges.find((e) => e.from === 'risk_team_dynamics' && e.to === 'goal_growth');
    expect(goalBridge).toBeDefined();
    expect(goalBridge!.strength.mean).toBeLessThan(0);
    expect(goalBridge!.effect_direction).toBe('negative');

    // (7) analysisReady computed from the post-edit graph.
    expect(result.analysisReady).toBeDefined();

    // (8) Boundary contract holds.
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });

  it('compound request "Add team dynamics as a risk and connect it to churn" → falls through to LLM (template did not fire)', async () => {
    // LLM returns a no-op so the test doesn't depend on a real edit pipeline output —
    // we only care that handleEditGraph was invoked (i.e. template did NOT intercept).
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

    // LLM was called → template fell through (compound guard fired).
    expect(llmChatMock).toHaveBeenCalled();
  });

  it('graph with no decision node → template falls through to LLM', async () => {
    llmChatMock.mockResolvedValue({
      content: JSON.stringify({ operations: [], removed_edges: [], warnings: [], coaching: { summary: 'No-op.' } }),
    });

    const noDecision: GraphStateIngress = {
      nodes: [
        { id: 'goal_growth', kind: 'goal', label: 'Reach 1000 customers' },
        { id: 'fac_price', kind: 'factor', label: 'Price' },
      ],
      edges: [{ from: 'fac_price', to: 'goal_growth' }],
    };

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-add-risk-no-decision',
      request: STUB_REQUEST,
      graphState: noDecision,
      analysisState: null,
    });

    expect(llmChatMock).toHaveBeenCalled();
  });
});
