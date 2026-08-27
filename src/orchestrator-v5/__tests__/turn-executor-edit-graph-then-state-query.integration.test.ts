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
 *   6. An edit-CONSEQUENCE question reaches the read-only reasoning model with
 *      the canonical post-edit graph, persisted receipt and stale verdict;
 *      degraded canonical reads fail weak and never substitute request bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import {
  EditGraphHandlerFactSchema,
  type HandlerFact,
} from '@talchain/schemas/orchestrator';

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
import { MUTATION_RECEIPT_FACT_TYPES } from '../mutation-receipt-fact-types.js';
import { CHANGES_UNAVAILABLE_TEXT } from '../routing/state-query-guard.js';

// ---------------------------------------------------------------------------
// Session store mock — replayable across two synthetic turns
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  graphReadFails: boolean;
  priorTurnsTotal: number | null;
  durableMutationFacts: Array<Record<string, unknown>> | null;
  durableMutationReadFails: boolean;
  appendWrites: Array<Record<string, unknown>>;
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
  graphReadFails: false,
  priorTurnsTotal: null,
  durableMutationFacts: null,
  durableMutationReadFails: false,
  appendWrites: [],
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      mockState.appendWrites.push(write);
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => mockState.priorTurns,
    countTurns: async () => mockState.priorTurnsTotal ?? mockState.priorTurns.length,
    readFactsFor: async () => mockState.priorFacts,
    readScenarioRunAnalysisFactsFor: async (_scenarioId: string, limit: number) => {
      const facts = mockState.priorFacts.filter(
        (fact) => fact.fact_type === 'run_analysis' && fact.noop === false,
      );
      return {
        facts: facts.slice(0, limit),
        total_count: facts.length,
      };
    },
    readRecentAppliedMutationFactsFor: async (_scenarioId: string, limit: number) => {
      if (mockState.durableMutationReadFails) {
        throw new Error('simulated durable mutation receipt read failure');
      }
      if (mockState.durableMutationFacts !== null) {
        return mockState.durableMutationFacts.slice(0, limit);
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
        .slice(0, limit);
    },
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => {
      if (mockState.graphReadFails) throw new Error('simulated canonical graph read failure');
      return mockState.persistedGraph;
    },
    loadGraphAndBriefText: async () => {
      if (mockState.graphReadFails) throw new Error('simulated canonical graph read failure');
      return {
        graph: mockState.persistedGraph,
        briefText: null,
      };
    },
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
      edge_type: 'directed',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac_hiring_cost',
      to: 'goal_q3',
      edge_type: 'directed',
      strength: { mean: -0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
  goal_node_id: 'goal_q3',
};

const POST_EDIT_GRAPH = {
  ...PRE_EDIT_GRAPH,
  edges: [
    PRE_EDIT_GRAPH.edges[0]!,
    {
      ...PRE_EDIT_GRAPH.edges[1]!,
      strength: { mean: -0.7, std: 0.1 },
      exists_probability: 0.95,
    },
  ],
};

const PRE_EDIT_HASH = computeAnalysisAffectingGraphHash(PRE_EDIT_GRAPH as never)!;
const POST_EDIT_HASH = computeAnalysisAffectingGraphHash(POST_EDIT_GRAPH as never)!;

// Kept under 80 chars so the recent-changes cap() in recent-changes.ts
// does not truncate it; the projection then quotes the summary verbatim
// into assistant_text. Production fixtures rarely hit the cap because
// the upstream sanitiser already truncates.
const SAFE_SUMMARY =
  'Strengthened the Hiring Cost → Q3 Roadmap downside from 0.4 to 0.7.';

// Accepted edit_graph fact — the shape EditGraphHandlerFactSchema produces.
// Modelled on the rich-path builder output: status='applied', noop=false,
// safe_summary populated, affected_entities[0].label set.
const ACCEPTED_EDIT_GRAPH_FACT = EditGraphHandlerFactSchema.parse({
  fact_type: 'edit_graph',
  fact_version: 1,
  noop: false,
  result: {
    edit_kind: 'parameter_update',
    status: 'applied',
    operations_count: 1,
    affected_entities: [
      { kind: 'edge', label: 'Incremental Hiring Cost edge' },
    ],
    graph_hash_before: 'pre0000000000000',
    graph_hash_after: 'post000000000000',
    safe_summary: SAFE_SUMMARY,
    impact: 'moderate' as const,
    rerun_recommended: true,
  },
});

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

/**
 * Hostile control for the compound-consequence boundary: the model proposes a
 * real graph mutation even though the turn contains a read-only question. The
 * executor must pin the effective call to the explanation carrier and must not
 * let the proposal survive as either a write or a persisted pending action.
 */
function hostileMutatingRoutingAdapter(answer: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [
          {
            type: 'tool_use' as const,
            id: 'toolu-hostile-compound',
            name: OLUMI_ACTION_TOOL_NAME,
            input: {
              intent_class: 'execute',
              action: {
                handler_id: 'add_constraint',
                entity: {
                  id: 'fac_hiring_cost',
                  kind: 'node',
                  label: 'Incremental Hiring Cost',
                  resolution_status: 'resolved',
                  resolution_method: 'label_match',
                },
                parameters: [
                  { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
                  { name: 'value', value: 3, source: 'user_explicit' },
                  { name: 'unit', value: '%', source: 'user_explicit' },
                ],
                cited_context_fields: ['recent_changes', 'graph'],
                explanation: { answer_text: answer },
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
    mockState.graphReadFails = false;
    mockState.priorTurnsTotal = null;
    mockState.durableMutationFacts = null;
    mockState.durableMutationReadFails = false;
    mockState.appendWrites = [];
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

    it('reasons about the accepted edit from canonical post-edit state without writing the model', async () => {
      const answer =
        'The stronger saved cost link now puts more downside pressure on the Q3 goal. ' +
        'The earlier analysis is out of date, so rerun it before comparing options.';
      const adapter = callingRoutingAdapter(answer);
      const payload = mkPayload('What did that update do?');
      const canonicalBefore = JSON.stringify(POST_EDIT_GRAPH);

      const result = await runTurnExecutor(
        payload,
        'req-edit-effect-canonical',
        {
          routingAdapter: adapter,
          // Deliberately stale request bytes: persisted POST_EDIT_GRAPH must win.
          graphState: PRE_EDIT_GRAPH as never,
        },
      );

      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      const prompt = adapter.chatWithTools.mock.calls[0]![0].messages[0]!.content as string;
      expect(prompt).toMatch(/"graph_context":\s*\{\s*"status": "canonical"/);
      expect(prompt).toContain('"recent_changes": [');
      expect(prompt).toContain(SAFE_SUMMARY);
      expect(prompt).toContain('"freshness": "stale"');
      expect(prompt).toContain('"rerun_required": true');
      expect(prompt).toMatch(
        /"from": "fac_hiring_cost"[\s\S]{0,320}"to": "goal_q3"[\s\S]{0,320}"relationship": "strong negative link"/,
      );
      expect(prompt).not.toMatch(
        /"from": "fac_hiring_cost"[\s\S]{0,320}"to": "goal_q3"[\s\S]{0,320}"relationship": "moderate negative link"/,
      );

      const guardEvent = events.find((e) => e.event === 'v5.state_query_guard');
      expect(guardEvent?.data).toMatchObject({
        matched: false,
        dispatch: null,
        recent_change_count: 1,
      });
      expect(result.response.assistant_text).toBe(answer);
      expect(result.telemetry.turn_class).toBe('direct_answer');
      expect(result.telemetry.llm_calls_used).toBe(1);

      // A read-only reasoning turn still persists its conversation record, but
      // carries no graph, handler fact or mutation/version receipt.
      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-edit-effect-canonical',
      );
      expect(committed).toBeDefined();
      expect(committed).toMatchObject({
        handler_id: null,
        turn_class: 'direct_answer',
        handler_facts: [],
      });
      expect(committed).toHaveProperty('graph', undefined);
      expect(result.response.blocks).toEqual([]);
      expect(result.response.suggested_actions ?? []).toEqual([]);
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(JSON.stringify(POST_EDIT_GRAPH)).toBe(canonicalBefore);
    });

    it.each([
      {
        message: 'What did that update do? It may set hiring cost to 5%.',
        discloseTail: true,
      },
      {
        // The canonical factor label makes this look exactly like the
        // deterministic value-update carrier. The receipt-backed consequence
        // route must already own the turn before that pre-route runs.
        message:
          'What did that update do? It may set Incremental Hiring Cost to 5%.',
        discloseTail: true,
      },
      {
        // Likewise, an imperative analysis tail must remain part of the
        // read-only explanation turn rather than execute run_analysis.
        message: 'What did that update do? Run the analysis again.',
        // The existing structural-tail recogniser does not classify analysis
        // execution copy as a graph-edit carrier. The ordering/no-execution
        // invariant is independent of that disclosure policy.
        discloseTail: false,
      },
      {
        // These next three are independent deterministic pre-route families.
        // Their disclosure classification is not the invariant under test;
        // each must defer to the sole receipt-backed explanation carrier.
        message:
          'What did that update do? 3 out of 7 similar projects succeeded.',
        discloseTail: undefined,
      },
      {
        message:
          'What did that update do? Incremental Hiring Cost is pretty likely.',
        discloseTail: undefined,
      },
      {
        message: 'What did that update do? Should I rerun it?',
        discloseTail: undefined,
      },
      {
        message:
          'What did that update do? It may link Incremental Hiring Cost to Q3 Roadmap Commitments.',
        discloseTail: true,
      },
      {
        message: 'What did that update do? Delete operations are irreversible.',
        discloseTail: false,
      },
      {
        message: '"What did that update do?" Add another option.',
        discloseTail: true,
      },
    ])(
      'forces one grounded read-only call and cannot mint a pending action: $message',
      async ({ message, discloseTail }) => {
        const answer =
          'The accepted update strengthened the saved Hiring Cost to Q3 Roadmap downside, so the current model records more pressure on the goal.';
        const adapter = hostileMutatingRoutingAdapter(answer);
        const requestId = `req-edit-effect-compound-${randomUUID()}`;

        const result = await runTurnExecutor(
          mkPayload(message),
          requestId,
          {
            routingAdapter: adapter,
            // A stale request graph must not retarget the accepted consequence.
            graphState: PRE_EDIT_GRAPH as never,
          },
        );

        expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
        const call = adapter.chatWithTools.mock.calls[0]![0];
        const prompt = String(call.messages[0]!.content);
        expect(call.tool_choice).toEqual({ type: 'tool', name: OLUMI_ACTION_TOOL_NAME });
        expect(prompt).toContain('accepted update did');
        expect(prompt).toContain('trailing clause is handled separately');
        expect(prompt).toMatch(/"graph_context":\s*\{\s*"status": "canonical"/);
        expect(prompt).toContain(SAFE_SUMMARY);
        expect(events.find((event) => event.event === 'v5.state_query_guard')?.data).toMatchObject({
          matched: false,
          dispatch: null,
          recent_change_count: 1,
        });

        expect(result.response.assistant_text).toContain(answer);
        if (discloseTail === true) {
          expect(result.response.assistant_text).toContain(
            'I did not apply the carrier-looking clause',
          );
        } else if (discloseTail === false) {
          expect(result.response.assistant_text).not.toContain(
            'I did not apply the carrier-looking clause',
          );
        }
        expect(result.response.suggested_actions ?? []).toHaveLength(0);
        expect(result.response).not.toHaveProperty('model_version_receipt');
        expect(committedPendingActions()).toHaveLength(0);

        const committed = mockState.appendWrites.find(
          (write) => write.turn_id === requestId,
        );
        expect(committed).toBeDefined();
        expect(committed).toMatchObject({ handler_id: null, handler_facts: [] });
        expect(committed).toHaveProperty('graph', undefined);
      },
    );

    it.each([
      {
        preRoute: 'run comparison',
        message: 'What did that update do? Why did the result change?',
        facts: () => [
          ACCEPTED_EDIT_GRAPH_FACT,
          {
            ...makeRunAnalysisFact(POST_EDIT_HASH),
            result: {
              ...makeRunAnalysisFact(POST_EDIT_HASH).result,
              computed_at: new Date(Date.now() - 30_000).toISOString(),
              summary: 'Current run',
            },
          },
          {
            ...makeRunAnalysisFact(PRE_EDIT_HASH),
            result: {
              ...makeRunAnalysisFact(PRE_EDIT_HASH).result,
              computed_at: new Date(Date.now() - 180_000).toISOString(),
              summary: 'Baseline run',
            },
          },
        ],
      },
      {
        preRoute: 'fresh post-analysis advice',
        message: 'What did that update do? Explain the results.',
        facts: () => [makeRunAnalysisFact(POST_EDIT_HASH), ACCEPTED_EDIT_GRAPH_FACT],
      },
      {
        preRoute: 'no-analysis recovery',
        message: 'What did that update do? Walk me through the analysis.',
        facts: () => [ACCEPTED_EDIT_GRAPH_FACT],
      },
    ])(
      'keeps the $preRoute pre-route behind the receipt-backed explanation carrier',
      async ({ message, facts }) => {
        mockState.priorFacts = facts();
        const adapter = hostileMutatingRoutingAdapter(
          'The saved change and current model together explain the consequence without applying anything else.',
        );

        const result = await runTurnExecutor(
          mkPayload(message),
          `req-edit-effect-preroute-${randomUUID()}`,
          { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
        );

        expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
        expect(result.telemetry.turn_class).toBe('direct_answer');
        expect(result.response.suggested_actions ?? []).toHaveLength(0);
        expect(result.response).not.toHaveProperty('model_version_receipt');
        expect(committedPendingActions()).toHaveLength(0);
        expect(mockState.appendWrites.some((write) => write.graph !== undefined)).toBe(false);
      },
    );

    it('keeps typed mutation-chip metadata behind the same focused read-only carrier', async () => {
      const adapter = hostileMutatingRoutingAdapter(
        'The accepted update changed the saved relationship; the chip metadata did not create another edit.',
      );
      const payload: MessageTurnPayload = {
        ...mkPayload('What did that update do? Please use this control.'),
        source: 'chip_click',
        chip: {
          action_type: 'set_factor_value',
          parameters: {
            target_id: 'fac_hiring_cost',
            value: 5,
            unit: '%',
            operator: 'set',
          },
        },
      };

      const result = await runTurnExecutor(
        payload,
        'req-edit-effect-typed-chip',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      expect(result.telemetry.turn_class).toBe('direct_answer');
      expect(result.response.suggested_actions ?? []).toHaveLength(0);
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(committedPendingActions()).toHaveLength(0);
      expect(mockState.appendWrites.some((write) => write.graph !== undefined)).toBe(false);
    });

    it.each(['canonical', 'provisional', 'absent', 'unavailable'] as const)(
      'carries graph_context=%s into the effective compound-consequence call without request promotion',
      async (status) => {
        mockState.persistedGraph = status === 'canonical' ? POST_EDIT_GRAPH : null;
        mockState.graphReadFails = status === 'unavailable';
        const requestGraph =
          status === 'canonical'
            ? PRE_EDIT_GRAPH
            : status === 'provisional' || status === 'unavailable'
              ? POST_EDIT_GRAPH
              : undefined;
        const adapter = hostileMutatingRoutingAdapter(
          'I can explain the accepted record only to the extent supported by the available saved-model authority.',
        );

        const result = await runTurnExecutor(
          mkPayload('What did that update do? It may set hiring cost to 5%.'),
          `req-edit-effect-status-${status}`,
          {
            routingAdapter: adapter,
            ...(requestGraph === undefined ? {} : { graphState: requestGraph as never }),
          },
        );

        expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
        const call = adapter.chatWithTools.mock.calls[0]![0];
        const prompt = String(call.messages[0]!.content);
        expect(call.tool_choice).toEqual({ type: 'tool', name: OLUMI_ACTION_TOOL_NAME });
        expect(prompt).toContain('accepted update did');
        expect(prompt).toMatch(
          new RegExp(`"graph_context":\\s*\\{\\s*"status": "${status}"`),
        );
        expect(result.response.suggested_actions ?? []).toHaveLength(0);
        expect(result.response).not.toHaveProperty('model_version_receipt');
        expect(committedPendingActions()).toHaveLength(0);
      },
    );

    it('suppresses pending mutation authority for an unanchored consequence occurrence', async () => {
      const adapter = hostileMutatingRoutingAdapter(
        'The accepted record strengthened the saved downside relationship; no new model change is warranted by this explanation.',
      );

      const result = await runTurnExecutor(
        mkPayload('Note: What did that update do? Add another option.'),
        'req-edit-effect-unanchored',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      expect(result.response.suggested_actions ?? []).toHaveLength(0);
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(committedPendingActions()).toHaveLength(0);
      expect(
        mockState.appendWrites.some((write) => write.graph !== undefined),
      ).toBe(false);
    });

    it('suppresses text-only proposal chips and pending capture for an unanchored occurrence', async () => {
      const adapter = callingRoutingAdapter(
        'I can explain the accepted update. Would you like me to add Supplier concentration as a risk?',
      );

      const result = await runTurnExecutor(
        mkPayload('Note: What did that update do? Add another option.'),
        'req-edit-effect-unanchored-text-proposal',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      expect(result.response.suggested_actions ?? []).toHaveLength(0);
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(committedPendingActions()).toHaveLength(0);
      expect(
        mockState.appendWrites.some((write) => write.graph !== undefined),
      ).toBe(false);
    });

    it('fails weak on a degraded canonical read and never promotes valid request bytes', async () => {
      const requestCanaryGraph = {
        ...POST_EDIT_GRAPH,
        nodes: POST_EDIT_GRAPH.nodes.map((node) =>
          node.id === 'fac_hiring_cost'
            ? { ...node, label: 'REQUEST CANARY COST' }
            : node,
        ),
      };
      mockState.graphReadFails = true;
      const adapter = callingRoutingAdapter(
        'I cannot establish the saved model consequence from the available state.',
      );
      const payload = mkPayload('What did that update do?');

      const result = await runTurnExecutor(
        payload,
        'req-edit-effect-degraded',
        { routingAdapter: adapter, graphState: requestCanaryGraph as never },
      );

      expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
      const prompt = adapter.chatWithTools.mock.calls[0]![0].messages[0]!.content as string;
      expect(prompt).toMatch(/"graph_context":\s*\{\s*"status": "unavailable"/);
      expect(prompt).not.toContain('REQUEST CANARY COST');
      expect(prompt).toContain(SAFE_SUMMARY);
      expect(prompt).toContain(
        'caller input, conversation or summaries as model truth',
      );

      const guardEvent = events.find((e) => e.event === 'v5.state_query_guard');
      expect(guardEvent?.data).toMatchObject({ matched: false, dispatch: null });
      // The read-only answer is retained as conversation, but valid request
      // bytes never become a fallback graph write when canonical state is
      // unavailable.
      const committed = mockState.appendWrites.find(
        (write) => write.turn_id === 'req-edit-effect-degraded',
      );
      expect(committed).toBeDefined();
      expect(committed).toMatchObject({ handler_id: null, handler_facts: [] });
      expect(committed).toHaveProperty('graph', undefined);
      expect(mockState.appendWrites.some((write) => write.graph !== undefined)).toBe(false);
      expect(result.telemetry.commit_performed).toBe(true);
      expect(result.response.blocks).toEqual([]);
      expect(result.response).not.toHaveProperty('model_version_receipt');
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
      const adapter = callingRoutingAdapter(
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

    it.each([
      'What did that update do?',
      'What did that update do? Set Incremental Hiring Cost to 42.',
      'What did that update do? Please run the analysis again.',
    ])(
      'answers an edit-effect question deterministically when no accepted receipt exists: %s',
      async (message) => {
      mockState.priorTurns = [PRIOR_EDIT_TURN];
      mockState.priorFacts = [{ ...ACCEPTED_EDIT_GRAPH_FACT, noop: true }];
      mockState.persistedGraph = PRE_EDIT_GRAPH;
      const adapter = throwingRoutingAdapter();

      const result = await runTurnExecutor(
        mkPayload(message),
        'req-no-receipt-edit-effect',
        { routingAdapter: adapter, graphState: PRE_EDIT_GRAPH as never },
      );

      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(result.response.assistant_text?.toLowerCase()).toMatch(
        /record of recent edits|like to make a change/,
      );
      expect(findForbiddenPhraseHit(result.response.assistant_text!)).toBeNull();
      expect(events.find((event) => event.event === 'v5.state_query_guard')?.data).toMatchObject({
        matched: true,
        dispatch: 'no_recent_changes',
        recent_change_count: 0,
      });
      expect(result.response).not.toHaveProperty('model_version_receipt');
      expect(committedPendingActions()).toHaveLength(0);
      expect(mockState.appendWrites.some((write) => write.graph !== undefined)).toBe(false);
      },
    );
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
