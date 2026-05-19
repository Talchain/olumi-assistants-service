/**
 * V5 Context Management v1 — end-to-end test for the edit_graph no-op
 * recovery layer inside `dispatchEditGraph`.
 *
 * Stubs the V4 `handleEditGraph` to return a no-op `EditGraphResult`
 * (zero operations, no appliedGraph, no rejection, with the bland V4
 * fallback assistant text) and verifies that:
 *   - The final response's assistant_text is upgraded to the
 *     analytical_fresh recovery copy.
 *   - The recovery layer appends the `explain_results` chip (plural —
 *     matching the registered V5 handler) without dropping the V4
 *     response's existing chips/blocks.
 *   - Chips are deduped by `action_type` so the same intent does not
 *     appear twice in the final response.
 *
 * Mirrors the dispatcher mocking pattern used by
 * `edit-graph-dispatch-add-risk-e2e.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ────────────────────────────────────────────────────────────────────
// Mocks (must come before the imports they affect)
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

// Stub handleEditGraph: returns a legitimate no-op (zero operations,
// no appliedGraph, no rejection). The bland fallback text mimics what
// V4 emits on this path; the V4 response also carries a placeholder
// chip so we can prove the recovery layer preserves it.
const { handleEditGraphMock } = vi.hoisted(() => ({ handleEditGraphMock: vi.fn() }));
vi.mock('../../../src/orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: handleEditGraphMock,
}));

// ────────────────────────────────────────────────────────────────────
// Imports after mocks
// ────────────────────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../../src/orchestrator-v5/commit.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';
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

const BLAND_V4_TEXT = 'No changes were needed for this request.';

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Walk me through the analysis.',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

function makeNoOpEditResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    blocks: [],
    assistantText: BLAND_V4_TEXT,
    latencyMs: 100,
    appliedGraph: null,
    wasRejected: false,
    operations: [],
    ...overrides,
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-no-op-recovery',
    graphPersisted: false,
  };
}

// Telemetry capture: setTestSink installs a function the central
// emit() calls in addition to the pino log line. Each `emit(event,
// data)` call appends `{ event, data }` to the test-scoped buffer so
// individual tests can assert on the post-strip/post-dedupe payload of
// `v5.edit_graph.no_op_recovery`.
const captured: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  llmChatMock.mockReset();
  handleEditGraphMock.mockReset();
  priorFactsOverrideRef.current = null;
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);
  captured.length = 0;
  setTestSink((event, data) => {
    captured.push({ event, data: data as Record<string, unknown> });
  });
});

afterEach(() => {
  setTestSink(null);
});

function findRecoveryEvent(): Record<string, unknown> | undefined {
  return captured.find(
    (c) => c.event === TelemetryEvents.V5EditGraphNoOpRecovery,
  )?.data;
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('dispatchEditGraph e2e — no-op recovery layer', () => {
  it('analytical_fresh: stubbed no-op + fresh run_analysis fact → analytical_fresh recovery copy + explain_results chip', async () => {
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
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-no-op-fresh',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    // Recovery copy replaces the bland V4 text.
    expect(result.response.assistant_text).not.toBe(BLAND_V4_TEXT);
    expect(result.response.assistant_text).toContain("haven't changed the model");
    expect(result.response.assistant_text).toContain('analysis question');

    // explain_results chip (plural — matches the registered V5 handler).
    const chips = result.response.suggested_actions ?? [];
    expect(chips.some((c) => c.action_type === 'explain_results')).toBe(true);
    const explainChip = chips.find((c) => c.action_type === 'explain_results');
    expect(explainChip?.label).toBe('Walk me through the analysis');

    // Recovery does not claim a change happened.
    expect(result.response.assistant_text).not.toMatch(/successfully|I['']ve\s+(?:applied|updated)/i);

    // Freshness verdict reflects the unchanged-graph fact pair.
    expect(result.freshness?.freshness).toBe('fresh');
  });

  it('analytical_none + graph not ready: suppresses run_analysis chip', async () => {
    // No prior facts → freshness='none'. Graph not ready means no
    // edges; provide a nodes-only ingress so the dispatcher sees a
    // graph with zero edges.
    priorFactsOverrideRef.current = [];
    const NODES_ONLY_GRAPH: GraphStateIngress = {
      nodes: PRICING_GRAPH.nodes,
      edges: [],
    } as unknown as GraphStateIngress;
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    const result = await dispatchEditGraph({
      payload: makePayload({ turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
      requestId: 'req-no-op-no-fact-not-ready',
      request: STUB_REQUEST,
      graphState: NODES_ONLY_GRAPH,
      analysisState: null,
    });

    expect(result.response.assistant_text).toContain("haven't changed the model");
    expect(result.response.assistant_text).toContain('Once the model is ready');

    // run_analysis chip is suppressed when graph is not ready.
    const chips = result.response.suggested_actions ?? [];
    expect(chips.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  it('dedupe: if V4 already attached a chip with the same action_type, recovery does not append a duplicate', async () => {
    priorFactsOverrideRef.current = [];
    // V4 returns a no-op response that already includes a run_analysis
    // chip in its blocks → editResultToOlumiResponse will surface it
    // on suggested_actions. We assert the recovery layer's
    // analytical_none branch does NOT re-append the same intent.
    handleEditGraphMock.mockResolvedValue(
      makeNoOpEditResult({
        suggestedActions: [
          {
            label: 'Pre-existing run analysis',
            prompt: 'Run analysis.',
            role: 'facilitator',
            action_type: 'run_analysis',
          },
        ],
      }),
    );

    const result = await dispatchEditGraph({
      payload: makePayload({ turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
      requestId: 'req-no-op-dedupe',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    const chips = result.response.suggested_actions ?? [];
    const runAnalysisChips = chips.filter((c) => c.action_type === 'run_analysis');
    expect(runAnalysisChips).toHaveLength(1);
    expect(runAnalysisChips[0]?.label).toBe('Pre-existing run analysis');

    // Telemetry contract — `appended_actions` is the POST-dedupe count
    // (recovery's run_analysis chip was dropped because the existing
    // response already had that intent), and `stripped_actions` is 0
    // because the graph IS ready in this case.
    const ev = findRecoveryEvent();
    expect(ev).toBeDefined();
    expect(ev?.branch_taken).toBe('analytical_none');
    expect(ev?.appended_actions).toBe(0);
    expect(ev?.stripped_actions).toBe(0);
  });

  it('analytical_none + graph not ready: strips a pre-existing V4 run_analysis chip', async () => {
    // The V4 no-op response already carries a run_analysis chip. The
    // graph has zero edges, so the chip cannot succeed if clicked.
    // Recovery must STRIP the existing chip, not just suppress its own.
    priorFactsOverrideRef.current = [];
    const NODES_ONLY_GRAPH: GraphStateIngress = {
      nodes: PRICING_GRAPH.nodes,
      edges: [],
    } as unknown as GraphStateIngress;
    handleEditGraphMock.mockResolvedValue(
      makeNoOpEditResult({
        suggestedActions: [
          {
            label: 'V4 attached this',
            prompt: 'Run analysis.',
            role: 'facilitator',
            action_type: 'run_analysis',
          },
          {
            label: 'V4 attached this too',
            prompt: 'Try a simpler change.',
            role: 'facilitator',
            action_type: 'set_factor_value',
          },
        ],
      }),
    );

    const result = await dispatchEditGraph({
      payload: makePayload({ turn_id: '99999999-9999-4999-8999-999999999999' }),
      requestId: 'req-no-op-strip',
      request: STUB_REQUEST,
      graphState: NODES_ONLY_GRAPH,
      analysisState: null,
    });

    const chips = result.response.suggested_actions ?? [];
    // No run_analysis chip survives — neither the V4 one (stripped)
    // nor a recovery one (suppressed by graphReady=false).
    expect(chips.some((c) => c.action_type === 'run_analysis')).toBe(false);
    // The unrelated V4 chip survives.
    expect(chips.some((c) => c.action_type === 'set_factor_value')).toBe(true);

    // Telemetry: `stripped_actions` reports the V4 chip removal,
    // `appended_actions` is 0 because the recovery's chip was already
    // suppressed at the decideNoOpRecovery layer (graphReady=false).
    const ev = findRecoveryEvent();
    expect(ev).toBeDefined();
    expect(ev?.branch_taken).toBe('analytical_none');
    expect(ev?.appended_actions).toBe(0);
    expect(ev?.stripped_actions).toBe(1);
  });

  it('analytical_fresh telemetry: appended_actions reports the post-dedupe count', async () => {
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
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    await dispatchEditGraph({
      payload: makePayload({ turn_id: '77777777-7777-4777-8777-777777777777' }),
      requestId: 'req-no-op-fresh-telemetry',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    // No existing chips → recovery's explain_results chip is appended,
    // not deduped. appended_actions === 1, stripped_actions === 0.
    const ev = findRecoveryEvent();
    expect(ev).toBeDefined();
    expect(ev?.branch_taken).toBe('analytical_fresh');
    expect(ev?.appended_actions).toBe(1);
    expect(ev?.stripped_actions).toBe(0);
  });
});
