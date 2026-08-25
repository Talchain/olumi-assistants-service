/**
 * V5 Context Management v1 — end-to-end tests for edit_graph memory input
 * and the no-op recovery layer inside `dispatchEditGraph`.
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

const {
  priorFactsOverrideRef,
  recentTurnsOverrideRef,
  summaryOverrideRef,
  summaryLoadMock,
} = vi.hoisted(() => ({
  priorFactsOverrideRef: { current: null as unknown[] | null },
  recentTurnsOverrideRef: { current: [] as Array<Record<string, unknown>> },
  summaryOverrideRef: { current: null as Record<string, unknown> | null },
  summaryLoadMock: vi.fn(),
}));

vi.mock('../../../src/orchestrator-v5/rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: summaryLoadMock,
    upsertSummary: vi.fn(),
  }),
  getRollingSummaryModel: () => ({ summarise: vi.fn() }),
  resetRollingSummaryForTests: () => undefined,
}));
// ROADMAP 1.148 C2 — importOriginal-spread (derive, don't mirror): the old
// hand-listed factory silently LACKED every export it didn't enumerate, so
// when PR #212 added a live `loadMostRecentPendingActions` call to
// edit-graph-dispatch the suite crashed with "is not a function". Spreading
// the real module keeps current AND future exports present (the real
// loaders degrade gracefully to [] without Supabase env); only the seams
// this suite controls are overridden.
vi.mock('../../../src/orchestrator-v5/build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/build-turn-context.js')>()),
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
  // ROADMAP 1.33: dispatchEditGraph reads this unconditionally for the
  // conversation-slice feed. Individual tests choose an empty or populated
  // hot window through the shared override.
  loadRecentConversationTurns: vi.fn(async () => recentTurnsOverrideRef.current),
  // Proposal-memory continuation (PR #212): no pending actions in this suite.
  loadMostRecentPendingActions: vi.fn(async () => []),
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
import { serialiseEditContextForLLMWithMeta } from '../../../src/orchestrator/context/serialise.js';
import type { ConversationContext } from '../../../src/orchestrator/types.js';

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
  recentTurnsOverrideRef.current = [];
  summaryOverrideRef.current = null;
  summaryLoadMock.mockReset();
  summaryLoadMock.mockImplementation(async () => summaryOverrideRef.current);
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
  function conversationTurns(count: number): Array<Record<string, unknown>> {
    return Array.from({ length: count }, (_, index) => {
      const ordinal = index + 1;
      return {
        id: `row-${ordinal}`,
        turn_id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
        turn_class: ordinal === 4 ? 'handler' : 'decide',
        handler_id: ordinal === 4 ? 'set_factor_value' : null,
        created_at: new Date(Date.UTC(2026, 7, 25, 10, ordinal)).toISOString(),
        user_message:
          ordinal === 4
            ? 'Set Supplier assurance readiness to 0.8.'
            : `Read-only strategic turn ${ordinal}.`,
        assistant_message:
          ordinal === 4
            ? 'Updated Supplier assurance readiness from 0.3 to 0.8.'
            : `Grounded response ${ordinal}.`,
      };
    }).reverse();
  }

  function acceptedChangeSummary(turns: Array<Record<string, unknown>>): Record<string, unknown> {
    const accepted = turns.find((turn) => turn.handler_id === 'set_factor_value')!;
    return {
      text: [
        'DECISION FRAME: Launch Northstar.',
        'CONSTRAINTS & PREFERENCES: Success means 40% adoption by 30 June.',
        'RESOLVED: Supplier assurance readiness changed from 0.3 to 0.8.',
        'OPEN: Supplier assurance remains an unresolved delivery tension.',
      ].join('\n'),
      slots: [
        { slot: 'FRAME', entries: [{ text: 'Launch Northstar.', source_turn_ids: [] }] },
        {
          slot: 'CONSTRAINTS',
          entries: [{ text: 'Success means 40% adoption by 30 June.', source_turn_ids: [] }],
        },
        {
          slot: 'RESOLVED',
          entries: [
            {
              text: 'Supplier assurance readiness changed from 0.3 to 0.8.',
              source_turn_ids: [accepted.turn_id],
            },
          ],
        },
        {
          slot: 'OPEN',
          entries: [
            { text: 'Supplier assurance remains an unresolved delivery tension.', source_turn_ids: [] },
          ],
        },
      ],
      updated_turn_id: accepted.turn_id,
      updated_turn_created_at: accepted.created_at,
      version: 2,
      generator: 'incremental',
      schema_version: 1,
    };
  }

  it('threads accepted changes through the persisted summary after they leave the edit verbatim window', async () => {
    const turns = conversationTurns(12);
    recentTurnsOverrideRef.current = turns;
    summaryOverrideRef.current = acceptedChangeSummary(turns);
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    await dispatchEditGraph({
      payload: makePayload({ message: 'What successful model change did I make most recently?' }),
      requestId: 'req-edit-summary-continuity',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    const context = handleEditGraphMock.mock.calls[0]?.[0] as ConversationContext;
    expect(context.messages).toHaveLength(16); // eight prior turns, user + assistant
    expect(context.conversation_summary?.text).toContain(
      'Supplier assurance readiness changed from 0.3 to 0.8.',
    );
    const serialised = serialiseEditContextForLLMWithMeta(context);
    expect(serialised.text).toContain('## Conversation Summary — working notes');
    expect(serialised.text).toContain('Supplier assurance readiness changed from 0.3 to 0.8.');
    expect(serialised.sectionChars.conversation_summary).toBeGreaterThan(0);
    expect(summaryLoadMock).toHaveBeenCalledTimes(1);
  });

  it('expands the fetched hot window and discloses unknown total when no summary exists', async () => {
    recentTurnsOverrideRef.current = conversationTurns(12);
    summaryOverrideRef.current = null;
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    await dispatchEditGraph({
      payload: makePayload({ message: 'What changed earlier?' }),
      requestId: 'req-edit-summary-missing',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    const context = handleEditGraphMock.mock.calls[0]?.[0] as ConversationContext;
    expect(context.messages).toHaveLength(24); // all 12 fetched turns, user + assistant
    expect(context.conversation_summary).toBeUndefined();
    expect(context.conversation_window_notice).toContain('true conversation total is unavailable');
    expect(context.conversation_window_notice).toContain('earlier turns may exist');
    const serialised = serialiseEditContextForLLMWithMeta(context).text;
    expect(serialised).toContain(context.conversation_window_notice);
    expect(serialised).toContain('Set Supplier assurance readiness to 0.8.');
  });

  it('uses the same honest hot-window fallback when the summary store is unavailable', async () => {
    recentTurnsOverrideRef.current = conversationTurns(12);
    summaryLoadMock.mockRejectedValueOnce(new Error('forced summary-store outage'));
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    await dispatchEditGraph({
      payload: makePayload({ message: 'What changed earlier?' }),
      requestId: 'req-edit-summary-store-outage',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    const context = handleEditGraphMock.mock.calls[0]?.[0] as ConversationContext;
    expect(context.messages).toHaveLength(24);
    expect(context.conversation_summary).toBeUndefined();
    expect(context.conversation_window_notice).toContain('true conversation total is unavailable');
    expect(serialiseEditContextForLLMWithMeta(context).text).toContain(
      'Set Supplier assurance readiness to 0.8.',
    );
  });

  it('expands the hot window and preserves the floor disclosure when summary coverage is zero', async () => {
    const turns = conversationTurns(12);
    recentTurnsOverrideRef.current = turns;
    summaryOverrideRef.current = {
      ...acceptedChangeSummary(turns),
      generator: 'floor',
      text: 'DECISION FRAME: Launch Northstar.',
      slots: [
        { slot: 'FRAME', entries: [{ text: 'Launch Northstar.', source_turn_ids: [] }] },
        { slot: 'CONSTRAINTS', entries: [] },
        { slot: 'RESOLVED', entries: [] },
        { slot: 'OPEN', entries: [] },
      ],
    };
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    await dispatchEditGraph({
      payload: makePayload({ message: 'What changed earlier?' }),
      requestId: 'req-edit-summary-floor',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    const context = handleEditGraphMock.mock.calls[0]?.[0] as ConversationContext;
    expect(context.messages).toHaveLength(24);
    expect(context.conversation_window_notice).toBeUndefined();
    expect(context.conversation_summary?.text).not.toContain(
      'Supplier assurance readiness changed from 0.3 to 0.8.',
    );
    expect(context.conversation_summary?.note).toContain('nothing else has been captured yet');
    const serialised = serialiseEditContextForLLMWithMeta(context).text;
    expect(serialised).toContain('Set Supplier assurance readiness to 0.8.');
    expect(serialised).toContain('conversation summary not yet generated');
  });

  it('updates a withheld-summary disclosure to match the expanded edit window', async () => {
    const turns = conversationTurns(12);
    recentTurnsOverrideRef.current = turns;
    summaryOverrideRef.current = {
      ...acceptedChangeSummary(turns),
      updated_turn_id: '00000000-0000-4000-8000-000000000001',
      updated_turn_created_at: '2026-08-25T09:00:00.000Z',
    };
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    await dispatchEditGraph({
      payload: makePayload({ message: 'What changed earlier?' }),
      requestId: 'req-edit-summary-memory-hole',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    const context = handleEditGraphMock.mock.calls[0]?.[0] as ConversationContext;
    expect(context.messages).toHaveLength(24);
    expect(context.conversation_summary?.text).toBe('');
    expect(context.conversation_summary?.note).toContain('showing 12 fetched recent turns verbatim');
    expect(context.conversation_summary?.note).toContain('earlier turns may exist');
    expect(context.conversation_summary?.note).not.toContain('only the latest 8 turns');
    expect(context.conversation_summary?.note).not.toContain('turns in between are NOT shown');
  });

  it('does not read or add summary metadata while history fits the normal window', async () => {
    recentTurnsOverrideRef.current = conversationTurns(4);
    handleEditGraphMock.mockResolvedValue(makeNoOpEditResult());

    await dispatchEditGraph({
      payload: makePayload({ message: 'Make the label clearer.' }),
      requestId: 'req-edit-summary-below-window',
      request: STUB_REQUEST,
      graphState: PRICING_GRAPH,
      analysisState: null,
    });

    const context = handleEditGraphMock.mock.calls[0]?.[0] as ConversationContext;
    expect(context.messages).toHaveLength(8);
    expect(context.conversation_summary).toBeUndefined();
    expect(context.conversation_window_notice).toBeUndefined();
    expect(summaryLoadMock).not.toHaveBeenCalled();
  });

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
