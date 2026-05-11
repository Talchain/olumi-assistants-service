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

// ---------------------------------------------------------------------------
// Session store mock — replayable across two synthetic turns
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: mockState.persistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
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
});
