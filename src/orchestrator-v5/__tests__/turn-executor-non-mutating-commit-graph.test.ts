/**
 * V5-FRESH-FIX-01 — non-mutating turns must NOT persist a graph (H2 fix).
 *
 * Confirmed defect (V5-PERSIST/FRESH-01 report, EXP-01 scenario
 * `49769b89`): every LLM-spine commit fell back to persisting the
 * client-echoed `options.graphState` when the handler emitted no
 * `mutated_graph`. The wire `draft_graph` block carries only
 * `{nodes, edges}` — no `options[]`, no `goal_node_id` — so the echo can
 * never be faithful to the rich draft-persisted graph, and the
 * analysis-freshness hash (`computeAnalysisAffectingGraphHash`) covers
 * exactly those fields. One non-mutating explain turn therefore
 * replaced the rich `scenarios.graph` with a lossy echo →
 * `graph_hash_diverged` with zero edits → false "Run analysis again
 * first?" deflections (EXP-01 J3).
 *
 * Fix under test: `turn-executor.ts` STEP 7 commits a graph ONLY when
 * `handlerOutcome.mutated_graph` is present; otherwise `p_graph` stays
 * null and the RPC leaves `scenarios.graph` untouched (the documented
 * `CommitMetadata.graph` contract).
 *
 * Golden fixtures are the CAPTURED EXP-01 graphs (not approximations):
 *   - `fixtures/exp01/rich-persisted-graph.json` — the draft-persisted
 *     shape `{nodes, edges, goal_node_id, options[]}`; hashes to
 *     `b3ebb23cfb03df1d`, the run_analysis anchor observed live
 *     (anchor == hash of the rich persisted graph at run time).
 *   - `fixtures/exp01/echo-graph-state.json` — the DGAI-shaped request
 *     echo the harness sent on every turn; hashes to
 *     `8fc73501f6fa5c79`, the diverged "current" hash observed live.
 */

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Stateful session-store mock — mirrors the RPC's p_graph semantics:
// `append` REPLACES the persisted graph only when the write carries a
// non-nullish `graph`; otherwise `scenarios.graph` is left untouched.
// This is what lets the suite assert content preservation (not just
// hash equality) across non-mutating turns.
// ---------------------------------------------------------------------------

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  turn_class?: unknown;
  handler_facts?: unknown;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;
let priorTurns: unknown[] = [];
let priorFacts: unknown[] = [];
let pendingActions: PendingAction[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      // append_turn_atomic(p_graph): null leaves scenarios.graph unchanged.
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    readMostRecentPendingActions: async () => pendingActions,
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => currentPersistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: currentPersistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Golden fixtures (captured EXP-01 graphs)
// ---------------------------------------------------------------------------

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(
    new URL('./fixtures/exp01/echo-graph-state.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** EXP-01 run_analysis anchor — hash of the rich persisted graph. */
const RICH_HASH = 'b3ebb23cfb03df1d';
/** EXP-01 diverged "current" hash — hash of the client echo. */
const ECHO_HASH = '8fc73501f6fa5c79';
/** EXP-01 J6 re-anchor — hash of the echo after the J5c set_factor_value. */
const POST_EDIT_ECHO_HASH = 'ac25c7af3b8417e2';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// Payload / adapter helpers (same patterns as
// turn-executor-freshness-canonical-graph.test.ts)
// ---------------------------------------------------------------------------

const SCENARIO_ID = '49769b89-37c7-4c98-a278-4e389fa1cfc1';
const PRIOR_ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function payload(message: string, turnId: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function textRoutingAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<
        (
          args: ChatWithToolsArgs,
          opts: { requestId: string },
        ) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () => mkTextResult(text)),
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (
          args: ChatWithToolsArgs,
          opts: { requestId: string },
        ) => Promise<ChatWithToolsResult>
      >()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on this path');
      }),
  };
}

function installPriorRunAnalysisFact(graphHashAtRun: string): void {
  priorTurns = [
    {
      id: PRIOR_ROW_ID,
      scenario_id: SCENARIO_ID,
      user_id: null,
      turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: 'sha256:prev',
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 42,
      created_at: '2026-06-11T23:33:33.796+00:00',
    },
  ];
  priorFacts = [
    {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_hire_local',
        summary: 'Hire Two Senior Engineers Locally currently leads.',
        graph_hash_at_run: graphHashAtRun,
        computed_at: '2026-06-11T23:33:33.000Z',
        enrichment: { analysis_status: 'completed' },
        win_probabilities: { opt_hire_local: 0.76 },
      },
    },
  ];
}

function whatWouldFlipPending(): PendingAction {
  const now = Date.now();
  return {
    id: 'pending-flip-1',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_action_what_would_flip',
    action: { kind: 'what_would_flip' },
    preconditions: { required_freshness: 'fresh' },
    expires_at_turn_count: 2,
    expires_at_iso: new Date(now + 10 * 60 * 1000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function preHandlerFreshnessEvents(): Event[] {
  return events.filter(
    (e) =>
      e.event === 'v5.analysis_freshness.derived' &&
      (e.data.dispatch_path as string | undefined) ===
        'turn_executor_pre_handler',
  );
}

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  appendCalls.length = 0;
  currentPersistedGraph = null;
  priorTurns = [];
  priorFacts = [];
  pendingActions = [];
});

afterEach(() => {
  setTestSink(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('golden pins — captured EXP-01 graph shapes', () => {
  it('rich persisted graph hashes to the live run_analysis anchor; echo hashes to the live diverged hash', () => {
    // Acceptance 1 (anchor derivation) + 3 (echo-defect shape): the
    // anchor observed live IS the hash of the rich persisted graph, and
    // the captured echo produces the diverged hash — purely because the
    // wire shape cannot carry options[] (goal_node_id was re-attached by
    // the harness; the options[] absence alone moved the hash).
    expect(
      computeAnalysisAffectingGraphHash(RICH_PERSISTED_GRAPH as never),
    ).toBe(RICH_HASH);
    expect(computeAnalysisAffectingGraphHash(ECHO_GRAPH_STATE as never)).toBe(
      ECHO_HASH,
    );
    expect(RICH_HASH).not.toBe(ECHO_HASH);
    // The fixture premise: the echo differs from the rich graph ONLY in
    // the server-only top-level fields.
    expect(RICH_PERSISTED_GRAPH.options).toBeDefined();
    expect(ECHO_GRAPH_STATE.options).toBeUndefined();
    expect(ECHO_GRAPH_STATE.goal_node_id).toBe(
      RICH_PERSISTED_GRAPH.goal_node_id,
    );
  });
});

describe('non-mutating spine turns do not persist a graph (H2 fix)', () => {
  it('EXP-01 J1 replay: explain turn commits NO graph; scenarios.graph retains options[] and goal_node_id byte-for-byte; freshness stays fresh on the follow-up', async () => {
    installPriorRunAnalysisFact(RICH_HASH);
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    const pristine = JSON.stringify(currentPersistedGraph);

    // Turn 1 — non-mutating explain follow-up, DGAI-shaped: the client
    // echoes the lossy graph_state alongside the message (EXP-01 J1).
    await runTurnExecutor(
      payload('why does that option lead?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),
      'req-ff01-explain',
      {
        routingAdapter: textRoutingAdapter('Because its strongest driver favours it.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    // The turn itself saw fresh state (persisted graph still rich).
    const turn1Freshness = preHandlerFreshnessEvents().at(-1);
    expect(turn1Freshness).toBeDefined();
    expect(turn1Freshness!.data.freshness).toBe('fresh');
    expect(turn1Freshness!.data.reason).toBe('graph_hash_match');
    expect(turn1Freshness!.data.current_graph_hash).toBe(RICH_HASH);

    // THE FIX: the commit carries no graph — p_graph null, scenarios.graph
    // untouched. Pre-fix this was the echo object.
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();

    // Content preservation, not just hash: options[] and goal_node_id
    // survive byte-for-byte; nodes/edges unchanged.
    expect(JSON.stringify(currentPersistedGraph)).toBe(pristine);
    const persisted = currentPersistedGraph as Record<string, unknown>;
    expect(JSON.stringify(persisted.options)).toBe(
      JSON.stringify(RICH_PERSISTED_GRAPH.options),
    );
    expect(persisted.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
    expect(
      computeAnalysisAffectingGraphHash(currentPersistedGraph as never),
    ).toBe(RICH_HASH);

    // Turn 2 — the EXP-01 J2 regression: the next turn re-derives
    // freshness from the persisted graph. Pre-fix this was
    // stale/graph_hash_diverged (current 8fc73501…) with ZERO edits.
    await runTurnExecutor(
      payload('what does that mean for the runner-up?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'),
      'req-ff01-followup',
      {
        routingAdapter: textRoutingAdapter('It trails on the same driver.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );
    const turn2Freshness = preHandlerFreshnessEvents().at(-1);
    expect(turn2Freshness).toBeDefined();
    expect(turn2Freshness!.data.freshness).toBe('fresh');
    expect(turn2Freshness!.data.reason).toBe('graph_hash_match');
    expect(turn2Freshness!.data.current_graph_hash).toBe(RICH_HASH);
    expect(appendCalls).toHaveLength(2);
    expect(appendCalls[1]!.graph).toBeUndefined();
  });

  it('echo-defect regression: a persisted echo-shaped graph IS what diverges freshness (the state the fix prevents)', async () => {
    // Documents the defect mechanism with the captured shapes: if the
    // echo HAD replaced the rich graph (the pre-fix overwrite), the next
    // turn sees stale/graph_hash_diverged against the rich anchor with
    // zero edits — exactly EXP-01 J2/J3.
    installPriorRunAnalysisFact(RICH_HASH);
    currentPersistedGraph = clone(ECHO_GRAPH_STATE);

    await runTurnExecutor(
      payload('what does it mean?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03'),
      'req-ff01-diverged',
      {
        routingAdapter: textRoutingAdapter('follow-up'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    const freshness = preHandlerFreshnessEvents().at(-1);
    expect(freshness).toBeDefined();
    expect(freshness!.data.freshness).toBe('stale');
    expect(freshness!.data.reason).toBe('graph_hash_diverged');
    expect(freshness!.data.graph_hash_at_run).toBe(RICH_HASH);
    expect(freshness!.data.current_graph_hash).toBe(ECHO_HASH);
  });

  it('user-path smoke (EXP-01 J1→J3): "Do that." resumes the pending flip offer and is NOT deflected by graph_hash_diverged', async () => {
    installPriorRunAnalysisFact(RICH_HASH);
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);
    pendingActions = [whatWouldFlipPending()];

    // Turn 1 — non-mutating explain ("Why?"), echo-shaped request.
    await runTurnExecutor(
      payload('why does that option lead?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04'),
      'req-ff01-j1',
      {
        routingAdapter: textRoutingAdapter('Because of its strongest driver.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );
    expect(appendCalls.at(-1)!.graph).toBeUndefined();

    // Turn 2 — "Do that." resumes the what_would_flip pending, whose
    // required_freshness='fresh' precondition reads the freshness verdict.
    // Pre-fix, turn 1's echo overwrite made this stale → the
    // rerun_analysis_required deflection ("The analysis is no longer
    // fresh… Run analysis again first?") — EXP-01 J3's false deflection.
    const { response } = await runTurnExecutor(
      payload('Do that.', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05'),
      'req-ff01-j3',
      {
        routingAdapter: textRoutingAdapter('resumed'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    const deflection = events.find(
      (e) => e.event === 'v5.pending_action.rerun_analysis_required',
    );
    expect(
      deflection,
      'freshness precondition must not deflect — the analysis IS fresh',
    ).toBeUndefined();
    expect(response.assistant_text ?? '').not.toMatch(/no longer fresh/i);

    const turn2Freshness = preHandlerFreshnessEvents().at(-1);
    expect(turn2Freshness!.data.freshness).toBe('fresh');
    expect(turn2Freshness!.data.current_graph_hash).toBe(RICH_HASH);
  });
});

describe('mutation safety — D1 set_factor_value still persists and staleness still triggers', () => {
  it('EXP-01 J5c replay: deterministic "Set … to 1.0." dispatches set_factor_value, persists the mutated graph, and the next turn is legitimately stale', async () => {
    installPriorRunAnalysisFact(RICH_HASH);
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH);

    // The deterministic value-update pre-route synthesises the dispatch —
    // the routing LLM must never be called.
    await runTurnExecutor(
      payload(
        'Set the Local Senior Hire Indicator factor to 1.0.',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06',
      ),
      'req-ff01-j5c',
      {
        routingAdapter: throwingRoutingAdapter(),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    // Mutating turns still persist: the commit carries the handler's
    // graph (graph defined — the fix only stops the echo fallback).
    //
    // V5-D1-SHAPE-01 contract update: the committed graph is the
    // mutation MERGED onto the persisted base (STEP 7
    // mergeMutatedGraphForPersistence), so it retains goal_node_id +
    // options[] from the rich persisted graph instead of the stripped
    // echo shape this test originally pinned (POST_EDIT_ECHO_HASH —
    // the live J6 re-anchor — was itself the J5c corruption: an
    // echo-shaped scenarios.graph with options[] gone).
    const mutationWrite = appendCalls.at(-1)!;
    expect(mutationWrite.handler_id).toBe('set_factor_value');
    expect(mutationWrite.graph).toBeDefined();
    const committed = mutationWrite.graph as {
      goal_node_id?: unknown;
      options?: unknown;
      nodes: Array<{ id: string; observed_state?: { value?: number } }>;
    };
    const mutatedNode = committed.nodes.find((n) => n.id === 'fac_local_hire');
    expect(mutatedNode?.observed_state?.value).toBe(1);
    expect(committed.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
    expect(JSON.stringify(committed.options)).toBe(
      JSON.stringify(RICH_PERSISTED_GRAPH.options),
    );

    // The persisted graph was REPLACED by the merged graph (RPC applies
    // p_graph): off the run anchor (legitimate staleness) but NOT the
    // stripped POST_EDIT_ECHO_HASH shape the pre-fix commit produced.
    const committedHash = computeAnalysisAffectingGraphHash(
      currentPersistedGraph as never,
    );
    expect(committedHash).not.toBe(RICH_HASH);
    expect(committedHash).not.toBe(POST_EDIT_ECHO_HASH);

    // Follow-up turn: staleness is now LEGITIMATE (a real mutation
    // happened) — the prior anchor no longer matches.
    await runTurnExecutor(
      payload('what changed?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07'),
      'req-ff01-post-edit',
      {
        routingAdapter: textRoutingAdapter('The factor moved.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );
    const freshness = preHandlerFreshnessEvents().at(-1);
    expect(freshness!.data.freshness).toBe('stale');
    expect(freshness!.data.reason).toBe('graph_hash_diverged');
    expect(freshness!.data.current_graph_hash).toBe(committedHash);
  });
});
