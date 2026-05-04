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

// V5 A4 Commit 6 — buildTurnContext is mocked so freshness derivation can
// be exercised against a controlled prior-fact chain. Tests override
// `priorFactsOverride` per case to inject a synthetic run_analysis fact.
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
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUB_REQUEST = {} as FastifyRequest;

// Canonical GraphV3-shaped fixture: every edge carries the strict
// {strength: {mean, std}, exists_probability, effect_direction} fields
// required by GraphV3.safeParse. Without these, dispatchEditGraph would
// fall back to the structural-only graph shape and the V5 A4 Commit 6
// strict-parse gate would refuse to fire the template.
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

    // (9) Persisted graph passes strict GraphV3 validation — no fallback
    // edges with inert defaults that would corrupt downstream state.
    const { GraphV3 } = await import('../../../src/schemas/cee-v3.js');
    const strictParse = GraphV3.safeParse(persistedGraph);
    expect(strictParse.success, strictParse.success ? '' : JSON.stringify(strictParse.error.issues)).toBe(true);
  });

  it('with prior analysis fact → freshness becomes "stale" (post-edit graph hash diverges)', async () => {
    // Inject a synthetic run_analysis fact via the buildTurnContext mock.
    // graph_hash_at_run differs from the post-edit graph hash → derivation
    // returns 'stale' (graph_hash_diverged).
    priorFactsOverrideRef.current = [
      {
        fact_type: 'run_analysis',
        noop: false,
        result: {
          graph_hash_at_run: 'sha256:DIFFERENT_FROM_POST_EDIT',
          computed_at: '2025-01-01T00:00:00.000Z',
          enrichment: { analysis_status: 'computed' },
        },
      },
    ];

    try {
      const result = await dispatchEditGraph({
        payload: makePayload({ turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
        requestId: 'req-add-risk-stale',
        request: STUB_REQUEST,
        graphState: PRICING_GRAPH,
        analysisState: null,
      });

      expect(llmChatMock).not.toHaveBeenCalled();
      expect(result.freshness).toBeDefined();
      expect(result.freshness!.freshness).toBe('stale');
    } finally {
      priorFactsOverrideRef.current = null;
    }
  });

  it('classifier fires + template safety-net rejection → still 0 LLM calls, llm_calls_used=0', async () => {
    // Force the template's post-mutation topology check to fail by feeding
    // a graph already at the structural-violation edge limit so adding 2
    // edges trips EDGE_LIMIT_EXCEEDED. The classifier still fires, the
    // template still attempts, but applyTemplateOperations returns a
    // rejected EditGraphResult.
    const overEdgeLimit: GraphStateIngress = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'G' },
        { id: 'dec_d', kind: 'decision', label: 'D' },
        { id: 'opt_a', kind: 'option', label: 'A' },
        { id: 'opt_b', kind: 'option', label: 'B' },
        ...Array.from({ length: 16 }, (_, i) => ({ id: `fac_${i}`, kind: 'factor' as const, label: `F${i}` })),
      ],
      edges: [
        { from: 'dec_d', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
        { from: 'dec_d', to: 'opt_b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
        ...Array.from({ length: 16 }, (_, i) => ({ from: 'opt_a', to: `fac_${i}`, strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' as const })),
        ...Array.from({ length: 16 }, (_, i) => ({ from: 'opt_b', to: `fac_${i}`, strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' as const })),
        ...Array.from({ length: 16 }, (_, i) => ({ from: `fac_${i}`, to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' as const })),
      ],
    } as unknown as GraphStateIngress;

    await dispatchEditGraph({
      payload: makePayload({ turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', message: 'Add team dynamics as a risk' }),
      requestId: 'req-add-risk-safety-reject',
      request: STUB_REQUEST,
      graphState: overEdgeLimit,
      analysisState: null,
    });

    // Critically: no LLM call regardless of template outcome.
    expect(llmChatMock).not.toHaveBeenCalled();

    // commit recorded llm_calls_used: 0 (template path was attempted).
    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    const [, metadata] = calls[calls.length - 1]!;
    expect(metadata.llm_calls_used).toBe(0);
  });

  it('non-canonical ingress edges → template does NOT fire (strict-parse gate)', async () => {
    // Edges missing strength / exists_probability / effect_direction →
    // GraphV3.safeParse fails → graphStrictlyCanonical=false → classifier
    // is bypassed → LLM path runs.
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
      // Missing the canonical edge fields — will trip safeParse fallback.
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

  it('canonical graph with no decision node → classifier fires, TemplateBuildError → LLM path', async () => {
    // Canonical edges so the strict-parse gate does NOT short-circuit
    // the classifier. The graph lacks a decision node, so
    // buildAddRiskOperations throws TemplateBuildError('no_decision')
    // and the dispatcher falls through to handleEditGraph.
    llmChatMock.mockResolvedValue({
      content: JSON.stringify({ operations: [], removed_edges: [], warnings: [], coaching: { summary: 'No-op.' } }),
    });

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

    await dispatchEditGraph({
      payload: makePayload({ turn_id: '99999999-9999-4999-8999-999999999999' }),
      requestId: 'req-add-risk-no-decision',
      request: STUB_REQUEST,
      graphState: noDecisionCanonical,
      analysisState: null,
    });

    expect(llmChatMock).toHaveBeenCalled();

    // commit metadata records llm_calls_used: 1 — the LLM path was taken
    // after TemplateBuildError reset templateAttempted (proves the reset
    // path is wired correctly, not just the success/rejection paths).
    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    const [, metadata] = calls[calls.length - 1]!;
    expect(metadata.llm_calls_used).toBe(1);
  });
});
