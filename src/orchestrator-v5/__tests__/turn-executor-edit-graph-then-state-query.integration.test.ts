/**
 * V5 stale-aware explain recovery — Layer A central acceptance proof.
 *
 * Paul's tightened brief separates the workstream into three layers:
 *   A. Successful-commit path: given an accepted EditGraphHandlerFact
 *      is persisted, does the chain
 *      `prior_facts → recent_changes → state-query-guard → assistant_text`
 *      produce a faithful "what changed?" answer?
 *   B. Staging dispatch reliability (V4 intermittent commit) — out of
 *      scope for this workstream; promoted to a separate H5 brief.
 *   C. Deterministic denial copy — covered by the egress guard tests +
 *      C4 copy updates.
 *
 * This file proves Layer A for the edit_graph mutation specifically,
 * isolating the V5 plumbing from V4's non-determinism by mocking the
 * single seam where H5 lives: the LLM-driven edit_graph adapter.
 *
 * The existing `state-query-after-mutation.test.ts` proves the same
 * chain for `add_constraint` (D1 deterministic handler). This file
 * adds the edit_graph variant — the path that drives the V5 Golden
 * Journey's dl7-edit-graph and dl7-staleness journeys.
 *
 * Coverage:
 *   1. Accepted edit_graph fact present → "what changed?" quotes the
 *      safe_summary verbatim, no what_would_flip chip, no neutral
 *      fallback copy.
 *   2. Stale path: prior run_analysis fact + accepted edit_graph fact
 *      + canonical persisted (post-edit) graph → freshness === 'stale'
 *      on the explain turn (the H3 fix bears this out).
 *   3. Rejected edit (negative control) — no recent_changes, no fact
 *      created, explain turn stays fresh.
 *   4. No-op / zero-operation edit (negative control) — same.
 *   5. Fresh path unchanged: run_analysis with NO subsequent edit →
 *      what_would_flip chip preserved on the explain turn (regression
 *      guard for the chip swap added in C4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import {
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
  findForbiddenPhraseHit,
} from '../compose/forbidden-user-facing-phrases.js';
import { OLUMI_ACTION_TOOL_NAME } from '../routing/tool-schema.js';
import { extractProposedConcept } from '../coaching/proposal-continuation.js';
import type { PendingAction } from '../session/pending-action.js';
import { MUTATION_RECEIPT_FACT_TYPES } from '../mutation-receipt-fact-types.js';
import { CHANGES_UNAVAILABLE_TEXT } from '../routing/state-query-guard.js';

// ---------------------------------------------------------------------------
// Session store mock — replayable across two synthetic turns
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  priorTurnsTotal: number | null;
  durableMutationFacts: Array<Record<string, unknown>> | null;
  durableMutationReadFails: boolean;
  appendWrites: Array<Record<string, unknown>>;
  pendingActions: PendingAction[];
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
  priorTurnsTotal: null,
  durableMutationFacts: null,
  durableMutationReadFails: false,
  appendWrites: [],
  pendingActions: [],
};

function identifiedMockFact(
  fact: Record<string, unknown>,
  index: number,
  source: 'window' | 'durable',
) {
  const turn = mockState.priorTurns[index] ?? mockState.priorTurns[0];
  return {
    fact,
    fact_row_id: `fact-${source}-${String(index + 1).padStart(3, '0')}`,
    turn_id:
      typeof turn?.id === 'string'
        ? turn.id
        : `turn-${source}-${String(index + 1).padStart(3, '0')}`,
    fact_created_at:
      typeof turn?.created_at === 'string'
        ? turn.created_at
        : new Date(Date.UTC(2026, 7, 27, 12, 0, -index)).toISOString(),
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      mockState.appendWrites.push(write);
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => mockState.priorTurns,
    countTurns: async () => mockState.priorTurnsTotal ?? mockState.priorTurns.length,
    readFactsFor: async () => mockState.priorFacts,
    readFactsWithTurnFor: async () =>
      mockState.priorFacts.map((fact, index) =>
        identifiedMockFact(fact, index, 'window'),
      ),
    readRecentAppliedMutationFactsFor: async (_scenarioId: string, limit: number) => {
      if (mockState.durableMutationReadFails) {
        throw new Error('simulated durable mutation receipt read failure');
      }
      if (mockState.durableMutationFacts !== null) {
        return mockState.durableMutationFacts
          .slice(0, limit)
          .map((fact, index) => identifiedMockFact(fact, index, 'durable'));
      }
      return mockState.priorFacts
        .filter((fact) => {
          const result = fact.result;
          return (
            typeof fact.fact_type === 'string' &&
            MUTATION_RECEIPT_FACT_TYPES.has(
              fact.fact_type as HandlerFact['fact_type'],
            ) &&
            fact.noop === false &&
            result !== null &&
            typeof result === 'object' &&
            !Array.isArray(result) &&
            (result as { status?: unknown }).status === 'applied'
          );
        })
        .slice(0, limit)
        .map((fact, index) => identifiedMockFact(fact, index, 'window'));
    },
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: mockState.persistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockState.pendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const PRIOR_EDIT_ROW_ID = '22222222-2222-4222-8222-222222222222';
const PRIOR_RUN_ANALYSIS_ROW_ID = '33333333-3333-4333-8333-333333333333';

const PRE_EDIT_GRAPH = {
  nodes: [
    { id: 'opt_hire', kind: 'option', label: 'Hire two senior engineers' },
    { id: 'fac_hiring_cost', kind: 'factor', label: 'Incremental Hiring Cost' },
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap Commitments' },
  ],
  edges: [
    {
      from: 'opt_hire',
      to: 'fac_hiring_cost',
      edge_type: 'causal',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac_hiring_cost',
      to: 'goal_q3',
      edge_type: 'causal',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
  goal_node_id: 'goal_q3',
};

const POST_EDIT_GRAPH = {
  ...PRE_EDIT_GRAPH,
  edges: [
    {
      ...PRE_EDIT_GRAPH.edges[0]!,
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.95,
    },
    PRE_EDIT_GRAPH.edges[1]!,
  ],
};

const PRE_EDIT_HASH = computeAnalysisAffectingGraphHash(PRE_EDIT_GRAPH as never)!;
const POST_EDIT_HASH = computeAnalysisAffectingGraphHash(POST_EDIT_GRAPH as never)!;

// Kept under 80 chars so the recent-changes cap() in recent-changes.ts
// does not truncate it; the projection then quotes the summary verbatim
// into assistant_text. Production fixtures rarely hit the cap because
// the upstream sanitiser already truncates.
const SAFE_SUMMARY =
  'Strengthened the Hiring Cost → Budget Overrun Risk edge from 0.5 to 0.7.';

// Accepted edit_graph fact — the shape EditGraphHandlerFactSchema produces.
// Modelled on the rich-path builder output: status='applied', noop=false,
// safe_summary populated, affected_entities[0].label set.
const ACCEPTED_EDIT_GRAPH_FACT = {
  fact_type: 'edit_graph' as const,
  fact_version: 1 as const,
  noop: false,
  result: {
    edit_kind: 'parameter_update' as const,
    status: 'applied' as const,
    operations_count: 1,
    affected_entities: [
      { kind: 'edge' as const, label: 'Incremental Hiring Cost edge' },
    ],
    graph_hash_before: 'pre0000000000000',
    graph_hash_after: 'post000000000000',
    safe_summary: SAFE_SUMMARY,
    impact: 'moderate' as const,
    rerun_recommended: true,
  },
};

const APPLIED_BUT_UNPROJECTABLE_FACT: HandlerFact = {
  fact_type: 'add_constraint',
  fact_version: 1,
  noop: false,
  result: {
    target_id: 'constraint-unprojectable',
    status: 'applied',
    before: null,
    after: null,
  },
};

const PRIOR_EDIT_TURN = {
  id: PRIOR_EDIT_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-edit-graph',
  turn_class: 'direct_answer',
  handler_id: null,
  request_hash: 'sha256:prior-edit',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 8,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

// run_analysis fact — for the stale-path test. graph_hash_at_run captures
// the pre-edit graph (the analysis was run BEFORE the edit).
function makeRunAnalysisFact(graphHashAtRun: string) {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: graphHashAtRun,
      computed_at: new Date(Date.now() - 120_000).toISOString(),
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72 },
    },
  };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: PRIOR_RUN_ANALYSIS_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 120_000).toISOString(),
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error(
          'Routing adapter must NOT be called when the deterministic state-query guard matches',
        );
      }),
  };
}

function callingRoutingAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

function consequenceRoutingAdapter(answer: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [
          {
            type: 'tool_use' as const,
            id: 'toolu-edit-effect',
            name: OLUMI_ACTION_TOOL_NAME,
            input: {
              intent_class: 'execute',
              action: {
                // Hostile control: the model asks to mutate. The forced
                // explanation carrier must pin this to a read-only handler.
                handler_id: 'add_constraint',
                entity: {
                  id: 'fac_hiring_cost',
                  kind: 'node',
                  label: 'Incremental Hiring Cost',
                  resolution_status: 'resolved',
                  resolution_method: 'id_match',
                },
                parameters: [],
                cited_context_fields: ['recent_changes', 'graph.nodes', 'graph.edges'],
                explanation: {
                  answer_text: answer,
                  cited_fields: ['recent_changes', 'graph.nodes', 'graph.edges'],
                },
              },
            },
          },
        ],
        stop_reason: 'tool_use' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

function committedPendingActions(): unknown[] {
  return mockState.appendWrites.flatMap((write) =>
    Array.isArray(write.pending_actions) ? write.pending_actions : [],
  );
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('V5 edit_graph → state-query — Layer A acceptance proof (forced commit)', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    mockState.persistedGraph = null;
    mockState.priorTurnsTotal = null;
    mockState.durableMutationFacts = null;
    mockState.durableMutationReadFails = false;
    mockState.appendWrites = [];
    mockState.pendingActions = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  // -------------------------------------------------------------------------
  // Layer A.1 — happy path: accepted fact + state query
  // -------------------------------------------------------------------------
  describe('after an accepted edit_graph fact, on the "what changed?" turn', () => {
    beforeEach(() => {
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [ACCEPTED_EDIT_GRAPH_FACT];
      mockState.persistedGraph = POST_EDIT_GRAPH;
    });

    it('does NOT call the routing LLM (state-query guard owns the turn)', async () => {
      const adapter = throwingRoutingAdapter();
      await runTurnExecutor(
        mkPayload('what changed?'),
        'req-edit-graph-state-query',
        { routingAdapter: adapter, graphState: POST_EDIT_GRAPH as never },
      );
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
    });

    it('assistant_text quotes the EditGraphHandlerFact safe_summary verbatim', async () => {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        mkPayload('what changed?'),
        'req-edit-graph-safe-summary',
        { routingAdapter: adapter, graphState: POST_EDIT_GRAPH as never },
      );
      expect(result.response.assistant_text).toContain(SAFE_SUMMARY);
      // And NOT the egress-guard neutral fallback (which would only ship
      // if the deterministic path emitted a forbidden phrase).
      expect(result.response.assistant_text).not.toBe(
        EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
      );
      // And NOT any forbidden phrase from the contradiction list.
      expect(findForbiddenPhraseHit(result.response.assistant_text!)).toBeNull();
    });

    it('emits v5.state_query_guard with dispatch=with_recent_change and count=1', async () => {
      const adapter = throwingRoutingAdapter();
      await runTurnExecutor(
        mkPayload('what changed?'),
        'req-edit-graph-telemetry',
        { routingAdapter: adapter, graphState: POST_EDIT_GRAPH as never },
      );
      const evt = events.find((e) => e.event === 'v5.state_query_guard');
      expect(evt, 'state-query guard telemetry should fire').toBeDefined();
      expect(evt!.data.matched).toBe(true);
      expect(evt!.data.dispatch).toBe('with_recent_change');
      expect(evt!.data.recent_change_count).toBe(1);
      expect(evt!.data.recent_changes_status).toBe('complete');
      const telemetryBytes = JSON.stringify(evt!.data);
      expect(telemetryBytes).not.toContain(SAFE_SUMMARY);
      expect(telemetryBytes).not.toContain('Incremental Hiring Cost edge');
      expect(evt!.data).not.toHaveProperty('recent_changes');
      expect(evt!.data).not.toHaveProperty('handler_facts');
    });

    it('dispatches as direct_answer with zero LLM calls', async () => {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        mkPayload('did you change it?'),
        'req-edit-graph-direct-answer',
        { routingAdapter: adapter, graphState: POST_EDIT_GRAPH as never },
      );
      expect(result.telemetry.turn_class).toBe('direct_answer');
      expect(result.telemetry.llm_calls_used).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Layer A.2 — stale path: run_analysis + edit_graph then explain
  // -------------------------------------------------------------------------
  describe('after run_analysis then accepted edit_graph, the next turn is STALE', () => {
    beforeEach(() => {
      mockState.priorTurns = [PRIOR_EDIT_TURN, PRIOR_RUN_ANALYSIS_TURN];
      mockState.priorFacts = [
        ACCEPTED_EDIT_GRAPH_FACT,
        // run_analysis captured the PRE-edit hash; the persisted graph
        // is the POST-edit shape, so freshness must come out STALE.
        makeRunAnalysisFact(PRE_EDIT_HASH),
      ];
      mockState.persistedGraph = POST_EDIT_GRAPH;
    });

    it('freshness derivation returns stale on the explain turn', async () => {
      const adapter = callingRoutingAdapter('placeholder explain text');
      await runTurnExecutor(
        mkPayload('why does that option lead?'),
        'req-stale-explain',
        // Client still sends the PRE-edit graph (lag) — the H3 fix
        // means freshness uses the persisted (POST-edit) hash anyway.
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );
      const evt = events.find(
        (e) =>
          e.event === 'v5.analysis_freshness.derived' &&
          (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
      );
      expect(evt, 'pre-handler freshness telemetry should fire').toBeDefined();
      expect(evt!.data.freshness).toBe('stale');
      expect(evt!.data.reason).toBe('graph_hash_diverged');
      expect(evt!.data.graph_hash_at_run).toBe(PRE_EDIT_HASH);
      expect(evt!.data.current_graph_hash).toBe(POST_EDIT_HASH);
    });

    it('grounds the exact standalone consequence question on canonical state without creating authority', async () => {
      const answer =
        'In the saved model, the cost relationship now carries more downside weight when reasoning about the Q3 goal. The previous result is stale, so rerun it before comparing options.';
      const adapter = consequenceRoutingAdapter(answer);
      const requestGraphCanary = {
        ...PRE_EDIT_GRAPH,
        nodes: PRE_EDIT_GRAPH.nodes.map((node) =>
          node.id === 'fac_hiring_cost'
            ? { ...node, label: 'REQUEST GRAPH CANARY' }
            : node,
        ),
      };
      const existingPending: PendingAction = {
        id: 'pending-existing',
        scenario_id: SCENARIO_ID,
        chip_id: 'chip_existing_run',
        action: { kind: 'run_analysis' },
        preconditions: {},
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: '2026-08-27T00:00:00.000Z',
      };
      mockState.pendingActions = [existingPending];

      const result = await runTurnExecutor(
        mkPayload('What did that update do?'),
        'req-edit-effect-canonical',
        { routingAdapter: adapter, graphState: requestGraphCanary as never },
      );

      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      const call = adapter.chatWithTools.mock.calls[0]![0];
      expect(call.tool_choice).toEqual({ type: 'tool', name: OLUMI_ACTION_TOOL_NAME });
      const prompt = String(call.messages[0]!.content);
      expect(prompt).toMatch(/"graph_context":\s*\{\s*"status": "canonical"/);
      expect(prompt).toContain(SAFE_SUMMARY);
      expect(prompt).toContain('Incremental Hiring Cost');
      expect(prompt).not.toContain('REQUEST GRAPH CANARY');
      expect(prompt).toContain('Requested answer (non-mutating)');

      expect(result.response.assistant_text).toContain('saved model');
      expect(result.response.suggested_actions ?? []).toEqual([]);
      expect(result.response).not.toHaveProperty('model_version_receipt');

      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-edit-effect-canonical',
      );
      expect(committed).toBeDefined();
      expect(committed).toHaveProperty('graph', undefined);
      expect(committed?.handler_id).toBe('explain_from_structure');
      // #1149 review gate 2 — `not.toEqual(arrayContaining([a, b, c]))` asks
      // whether ALL THREE are present, so the negation was satisfied by an
      // array containing exactly ONE of them: it passed while
      // `handler_facts` genuinely carried `{ fact_type: 'edit_graph' }`, i.e.
      // it could not observe the harm it names. Three membership assertions,
      // one per forbidden fact type, each of which can fail on its own.
      const committedFactTypes =
        (committed?.handler_facts as Array<{ fact_type?: string }> | undefined) ?? [];
      expect(committedFactTypes).not.toContainEqual(
        expect.objectContaining({ fact_type: 'edit_graph' }),
      );
      expect(committedFactTypes).not.toContainEqual(
        expect.objectContaining({ fact_type: 'add_constraint' }),
      );
      expect(committedFactTypes).not.toContainEqual(
        expect.objectContaining({ fact_type: 'set_factor_value' }),
      );
      expect(committed?.pending_actions).toEqual([
        expect.objectContaining({ id: existingPending.id, chip_id: existingPending.chip_id }),
      ]);
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data).toMatchObject({
        matched: false,
        dispatch: null,
        recent_change_count: 1,
      });
    });
  });

  describe('scenario-wide recent history status consumption', () => {
    it('uses no_recent_changes only for a complete empty durable history', async () => {
      mockState.persistedGraph = PRE_EDIT_GRAPH;
      mockState.priorTurnsTotal = 0;
      mockState.durableMutationFacts = [];
      const adapter = throwingRoutingAdapter();

      const result = await runTurnExecutor(
        mkPayload('What changed?'),
        'req-complete-empty-history',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(result.response.assistant_text).toContain(
        'record of recent edits in the saved model history',
      );
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data)
        .toMatchObject({
          dispatch: 'no_recent_changes',
          recent_change_count: 0,
          recent_changes_status: 'complete',
        });
    });

    it('returns changes_unavailable on a 41-turn durable read failure with no known receipt and performs no model or mutation write', async () => {
      mockState.persistedGraph = PRE_EDIT_GRAPH;
      mockState.priorTurnsTotal = 41;
      mockState.durableMutationReadFails = true;
      const adapter = throwingRoutingAdapter();

      const result = await runTurnExecutor(
        mkPayload('What changed?'),
        'req-degraded-empty-history',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(result.response.assistant_text).toBe(CHANGES_UNAVAILABLE_TEXT);
      expect(result.response.suggested_actions ?? []).toEqual([]);
      expect(result.telemetry.llm_calls_used).toBe(0);
      expect(result.response.blocks).toEqual([]);
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(committedPendingActions()).toEqual([]);
      expect(mockState.appendWrites.some((write) => write.graph !== undefined)).toBe(false);
      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-degraded-empty-history',
      );
      expect(committed).toMatchObject({
        handler_id: null,
        turn_class: 'direct_answer',
        handler_facts: [],
      });
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data)
        .toMatchObject({
          dispatch: 'changes_unavailable',
          recent_change_count: 0,
          recent_changes_status: 'degraded',
        });
    });

    it('downgrades a complete durable carrier when its applied receipt cannot be projected', async () => {
      mockState.persistedGraph = PRE_EDIT_GRAPH;
      mockState.priorTurnsTotal = 41;
      mockState.durableMutationFacts = [
        APPLIED_BUT_UNPROJECTABLE_FACT as unknown as Record<string, unknown>,
      ];
      const adapter = throwingRoutingAdapter();

      const result = await runTurnExecutor(
        mkPayload('What changed?'),
        'req-projection-loss-history',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(result.response.assistant_text).toBe(CHANGES_UNAVAILABLE_TEXT);
      expect(result.response.suggested_actions ?? []).toEqual([]);
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data)
        .toMatchObject({
          dispatch: 'changes_unavailable',
          recent_change_count: 0,
          recent_changes_status: 'degraded',
        });
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(mockState.appendWrites.some((write) => write.graph !== undefined)).toBe(false);
    });

    it('retains the newest capped receipts and discloses that older saved edits may be absent', async () => {
      mockState.persistedGraph = POST_EDIT_GRAPH;
      mockState.priorTurnsTotal = 41;
      mockState.durableMutationFacts = Array.from(
        { length: 4 },
        () => ACCEPTED_EDIT_GRAPH_FACT as unknown as Record<string, unknown>,
      );
      const adapter = throwingRoutingAdapter();

      const result = await runTurnExecutor(
        mkPayload('What changed?'),
        'req-capped-known-history',
        { routingAdapter: adapter, graphState: POST_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(result.response.assistant_text).toContain(SAFE_SUMMARY);
      expect(result.response.assistant_text).toContain(
        'available history is limited to the latest three recorded edits',
      );
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data)
        .toMatchObject({
          dispatch: 'with_recent_change',
          recent_change_count: 3,
          recent_changes_status: 'capped',
        });
    });

    it('retains a known hot-window receipt under degraded durable history without claiming latest or complete', async () => {
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [ACCEPTED_EDIT_GRAPH_FACT];
      mockState.persistedGraph = POST_EDIT_GRAPH;
      mockState.priorTurnsTotal = 41;
      mockState.durableMutationReadFails = true;
      const adapter = throwingRoutingAdapter();

      const result = await runTurnExecutor(
        mkPayload('What changed?'),
        'req-degraded-known-history',
        { routingAdapter: adapter, graphState: POST_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(result.response.assistant_text).toContain(SAFE_SUMMARY);
      expect(result.response.assistant_text).toContain(
        'cannot confirm that the recent edit history is complete',
      );
      expect(result.response.assistant_text).not.toMatch(/latest/i);
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data)
        .toMatchObject({
          dispatch: 'with_recent_change',
          recent_change_count: 1,
          recent_changes_status: 'degraded',
        });
    });

    it('carries a degraded known receipt and its status into the read-only consequence prompt', async () => {
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [ACCEPTED_EDIT_GRAPH_FACT];
      mockState.persistedGraph = POST_EDIT_GRAPH;
      mockState.priorTurnsTotal = 41;
      mockState.durableMutationReadFails = true;
      const adapter = consequenceRoutingAdapter(
        'The saved cost link is stronger, but I cannot confirm the edit history is complete.',
      );

      const result = await runTurnExecutor(
        mkPayload('What did that update do?'),
        'req-degraded-known-consequence',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      const prompt = adapter.chatWithTools.mock.calls[0]![0].messages[0]!
        .content as string;
      expect(prompt).toContain('"recent_changes_status": "degraded"');
      expect(prompt).toContain(SAFE_SUMMARY);
      expect(prompt).toContain('Conversation turns and rolling summaries are not');
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(committedPendingActions()).toEqual([]);
      expect(mockState.appendWrites.some((write) => write.graph !== undefined)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Layer A.3 — negative control: rejected edit
  // -------------------------------------------------------------------------
  describe('rejected/no-op edits do NOT create recent_changes or stale analysis', () => {
    it('rejected fact is filtered: state-query falls through to LLM (no recent_changes)', async () => {
      const REJECTED_FACT = {
        ...ACCEPTED_EDIT_GRAPH_FACT,
        noop: true, // schema would also have status: 'rejected' but noop=true is the projection-filter signal
      };
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [REJECTED_FACT];
      mockState.persistedGraph = PRE_EDIT_GRAPH; // not edited

      const adapter = callingRoutingAdapter('clean LLM response');
      const result = await runTurnExecutor(
        mkPayload('what changed?'),
        'req-rejected-state-query',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );
      // recent_changes was empty (noop filtered) so the deterministic
      // guard returns the neutral "no recent edits" copy — NOT
      // "I haven't applied any changes".
      const text = result.response.assistant_text;
      expect(findForbiddenPhraseHit(text!)).toBeNull();
      // The guard's `no_recent_changes` dispatch fires (the C4 copy
      // change replaces the forbidden denial with neutral copy).
      const guardEvent = events.find((e) => e.event === 'v5.state_query_guard');
      expect(guardEvent?.data.recent_change_count).toBe(0);
    });

    it('keeps the exact standalone consequence question deterministic when no receipt exists', async () => {
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [{ ...ACCEPTED_EDIT_GRAPH_FACT, noop: true }];
      mockState.persistedGraph = PRE_EDIT_GRAPH;
      const adapter = throwingRoutingAdapter();

      const result = await runTurnExecutor(
        mkPayload('What did that update do?'),
        'req-no-receipt-edit-effect',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data).toMatchObject({
        matched: true,
        dispatch: 'no_recent_changes',
        recent_change_count: 0,
      });
      expect(result.response.suggested_actions ?? []).toEqual([]);
      expect(result.response).not.toHaveProperty('model_version_receipt');
      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-no-receipt-edit-effect',
      );
      expect(committed).toHaveProperty('graph', undefined);
    });
  });

  // -------------------------------------------------------------------------
  // Layer A.5 — fresh path unchanged (regression guard for the chip swap)
  // -------------------------------------------------------------------------
  describe('run_analysis WITHOUT subsequent edit: explain turn stays fresh', () => {
    beforeEach(() => {
      mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
      mockState.priorFacts = [makeRunAnalysisFact(PRE_EDIT_HASH)];
      mockState.persistedGraph = PRE_EDIT_GRAPH; // matches the run_analysis fact
    });

    it('freshness === fresh (no edit happened — chip-generator rerun rule cannot fire)', async () => {
      const adapter = callingRoutingAdapter('explanation prose');
      await runTurnExecutor(
        mkPayload('why does it lead?'),
        'req-fresh-explain',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );
      const evt = events.find(
        (e) =>
          e.event === 'v5.analysis_freshness.derived' &&
          (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
      );
      expect(evt).toBeDefined();
      expect(evt!.data.freshness).toBe('fresh');
      expect(evt!.data.reason).toBe('graph_hash_match');
    });
  });

  // -------------------------------------------------------------------------
  // Layer A.6 — #1149 review gate 1: the consequence turn's two SUPPRESSION
  // arms, pinned.
  //
  // `explainAcceptedEditConsequenceForRun` drives five effects. Three were
  // already pinned by the acceptance test above (state-query bypass, forced
  // `explain_from_structure`, bounded-analytical chips). The remaining two —
  // the graph-write suppression and the proposal-capture suppression — read
  // GREEN under mutation on that fixture, because that fixture cannot reach
  // either arm: it has a populated canonical graph (so the graph write is
  // already `undefined` via ROW E) and a proposal-free answer (so the capture
  // already returns `undefined`). An arm that changes nothing observable is
  // the worst of both worlds — a later lane deletes it as dead or leans on it
  // as a guarantee, and neither is checkable. These two tests supply fixtures
  // that DO reach each arm, so removing either clause turns one RED.
  // -------------------------------------------------------------------------
  describe('the consequence turn creates no authority it was not asked to create', () => {
    it('does NOT adopt the request graph as the canonical model (ROW-A first-touch adopt suppressed)', async () => {
      // Canonical state carries NO server model while an accepted mutation
      // fact is still in the projection. `graphForCommit`'s ROW A then
      // ADOPTS the client's `graph_state` verbatim on any non-mutating turn
      // — proven by the contrast test below, which is the same fixture with
      // the consequence question replaced. On THIS question the adopt must
      // not happen: the turn answers from canonical state and must not
      // promote a client graph into canonical authority on the way past.
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [ACCEPTED_EDIT_GRAPH_FACT];
      mockState.persistedGraph = null;

      const adapter = consequenceRoutingAdapter(
        'In the saved model, the cost relationship now carries more downside weight.',
      );
      await runTurnExecutor(
        mkPayload('What did that update do?'),
        'req-consequence-no-adopt',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-consequence-no-adopt',
      );
      expect(committed).toBeDefined();
      // Precondition pins — without these the assertion below could pass
      // because nothing was adoptable rather than because the clause fired.
      expect(PRE_EDIT_GRAPH.nodes.length).toBeGreaterThan(0); // request graph IS adoptable
      expect(mockState.persistedGraph).toBeNull(); // canonical has NO server model
      expect(committed?.handler_id).toBe('explain_from_structure'); // the flagged path ran
      // The pin.
      expect(committed).toHaveProperty('graph', undefined);
    });

    it('CONTRAST — the same canonical state DOES adopt on an ordinary explanation turn', async () => {
      // Guards the test above from decaying into a tautology (a pin whose
      // precondition silently stops holding passes for the wrong reason).
      // If ROW A's adopt ever becomes unreachable here, THIS test REDs and
      // says so, rather than the pin quietly asserting nothing.
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [ACCEPTED_EDIT_GRAPH_FACT];
      mockState.persistedGraph = null;

      const adapter = consequenceRoutingAdapter('Here is what the model says.');
      await runTurnExecutor(
        mkPayload('Explain the current results please.'),
        'req-contrast-adopt',
        {
          routingAdapter: adapter,
          graphState: PRE_EDIT_GRAPH as never,
          chipClickForcedIntent: 'explain_results',
        },
      );

      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-contrast-adopt',
      );
      expect(committed).toBeDefined();
      expect(committed?.handler_id).toBe('explain_results'); // NOT the flagged path
      expect(committed?.graph).toMatchObject({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'fac_hiring_cost' }),
        ]),
      });
    });

    it('does NOT capture a proposed concept from its own answer (no pending the user never accepted)', async () => {
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [ACCEPTED_EDIT_GRAPH_FACT];
      mockState.persistedGraph = PRE_EDIT_GRAPH;

      const answerWithProposal =
        'In the saved model, the cost relationship now carries more downside weight. Would you like me to add supplier concentration as a risk?';
      // Precondition pin — the answer under test genuinely IS proposal-bearing.
      // If the extractor's breadth ever moves off this phrasing the test REDs
      // here instead of passing because nothing was there to capture.
      expect(extractProposedConcept(answerWithProposal)).not.toBeNull();

      const adapter = consequenceRoutingAdapter(answerWithProposal);
      await runTurnExecutor(
        mkPayload('What did that update do?'),
        'req-consequence-no-proposal-capture',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-consequence-no-proposal-capture',
      );
      expect(committed).toBeDefined();
      expect(committed?.handler_id).toBe('explain_from_structure'); // the flagged path ran
      // The pin: a read-only consequence answer must not leave behind a
      // resumable `proposed_concept` pending — the next turn's "yes" would
      // turn it into a graph mutation the user never asked this turn for.
      const committedPendings =
        (committed?.pending_actions as
          | Array<{ action?: { kind?: string } }>
          | undefined) ?? [];
      expect(committedPendings).not.toContainEqual(
        expect.objectContaining({
          action: expect.objectContaining({ kind: 'proposed_concept' }),
        }),
      );
      expect(
        events.some(
          (event) => event.event === 'v5.proposal_continuation.captured',
        ),
      ).toBe(false);
    });
  });
});
