/**
 * V5 stale-aware explain recovery — H3 wiring regression test.
 *
 * The freshness derivation comparing `graph_hash_at_run` (from a prior
 * run_analysis fact) against the current graph's hash MUST use the
 * canonical persisted graph (`scenarios.graph`, surfaced on
 * `context.persistedGraph` by buildTurnContext) — NOT the
 * request-supplied `options.graphState`.
 *
 * Without that wiring, a client (or replay harness) that lags behind a
 * persisted edit and re-sends the pre-edit graph on the follow-up
 * explain turn would hash to the same value as the run_analysis fact's
 * `graph_hash_at_run`, producing a false-fresh verdict and skipping the
 * stale recovery template + Rerun-analysis chip.
 *
 * This test sets up that exact divergence and asserts the post-fix
 * behaviour: persisted-graph hash diverges from `graph_hash_at_run` →
 * `analysis_freshness === 'stale'` on the pre-handler telemetry event.
 *
 * The negative-control test asserts the fresh path is unaffected: when
 * persisted and request graph match the run_analysis hash, freshness
 * stays `'fresh'`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Session store mock — no Supabase. Mirrors the slim mock in
// turn-executor.test.ts so the test exercises the real runTurnExecutor
// path with deterministic prior_facts / persisted_graph fixtures.
// ---------------------------------------------------------------------------

import { vi } from 'vitest';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => (global as Record<string, unknown>).__test_prior_turns ?? [],
    readFactsFor: async () =>
      (global as Record<string, unknown>).__test_prior_facts ?? [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () =>
      (global as Record<string, unknown>).__test_persisted_graph ?? null,
    loadGraphAndBriefText: async () => ({
      graph: (global as Record<string, unknown>).__test_persisted_graph ?? null,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {
    delete (global as Record<string, unknown>).__test_prior_turns;
    delete (global as Record<string, unknown>).__test_prior_facts;
    delete (global as Record<string, unknown>).__test_persisted_graph;
  },
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRIOR_ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRIOR_TURN_ID_CLIENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: SCENARIO_ID,
  message: 'why does that option lead?',
  turn_class: 'frame',
  stage: 'analyse',
};

// Two graphs that hash differently under
// `computeAnalysisAffectingGraphHash` (strength.mean differs).
const PRE_EDIT_GRAPH = {
  nodes: [
    { id: 'opt_a', kind: 'option', label: 'Option A' },
    { id: 'fac_cost', kind: 'factor', label: 'Cost' },
    { id: 'goal_outcome', kind: 'goal', label: 'Outcome' },
  ],
  edges: [
    {
      from: 'opt_a',
      to: 'fac_cost',
      edge_type: 'causal',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac_cost',
      to: 'goal_outcome',
      edge_type: 'causal',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
  goal_node_id: 'goal_outcome',
};

const POST_EDIT_GRAPH = {
  ...PRE_EDIT_GRAPH,
  edges: [
    {
      ...PRE_EDIT_GRAPH.edges[0]!,
      strength: { mean: 0.75, std: 0.1 }, // strengthened — should diverge the hash
    },
    PRE_EDIT_GRAPH.edges[1]!,
  ],
};

const PRE_EDIT_HASH = computeAnalysisAffectingGraphHash(
  PRE_EDIT_GRAPH as never,
)!;
const POST_EDIT_HASH = computeAnalysisAffectingGraphHash(
  POST_EDIT_GRAPH as never,
)!;

// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}

function findPreHandlerFreshnessEvent(): Event | undefined {
  return events.find(
    (e) =>
      e.event === 'v5.analysis_freshness.derived' &&
      (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
  );
}

// ---------------------------------------------------------------------------
// Fixture installer
// ---------------------------------------------------------------------------

function installPriorRunAnalysisFact(graphHashAtRun: string): void {
  (global as Record<string, unknown>).__test_prior_turns = [
    {
      id: PRIOR_ROW_ID,
      scenario_id: SCENARIO_ID,
      user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      turn_id: PRIOR_TURN_ID_CLIENT,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: 'sha256:prev',
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 42,
      created_at: '2026-05-10T10:00:00.000+00:00',
    },
  ];
  (global as Record<string, unknown>).__test_prior_facts = [
    {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Prior analysis',
        graph_hash_at_run: graphHashAtRun,
        computed_at: '2026-05-10T10:00:00.000Z',
        enrichment: { analysis_status: 'completed' },
        win_probabilities: { opt_a: 0.62 },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('turn-executor freshness — canonical persisted graph (H3 fix)', () => {
  beforeEach(() => {
    events = [];
    installSink();
    // Hash invariant: pre and post graphs must differ. Guard the fixture
    // so a future change to computeAnalysisAffectingGraphHash that
    // accidentally projects strength.mean out would not silently break
    // the test premise.
    if (PRE_EDIT_HASH === POST_EDIT_HASH) {
      throw new Error(
        'Test fixture invariant violated: PRE_EDIT_HASH must differ from POST_EDIT_HASH',
      );
    }
  });
  afterEach(() => {
    uninstallSink();
    delete (global as Record<string, unknown>).__test_prior_turns;
    delete (global as Record<string, unknown>).__test_prior_facts;
    delete (global as Record<string, unknown>).__test_persisted_graph;
  });

  it('marks STALE when persisted graph diverges from request graphState (client lag)', async () => {
    // Prior run_analysis fact captured the PRE-edit hash.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    // Canonical persisted graph reflects the post-edit state.
    (global as Record<string, unknown>).__test_persisted_graph = POST_EDIT_GRAPH;
    // Client is lagging — re-sends the PRE-edit graph as request body.
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('follow-up explanation'),
    );

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what does it mean?' },
      'req-stale-h3',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('stale');
    expect(evt!.data.reason).toBe('graph_hash_diverged');
    expect(evt!.data.graph_hash_at_run).toBe(PRE_EDIT_HASH);
    // The H3 fix: current_graph_hash must come from the persisted graph,
    // not the request graph. Without the fix this is PRE_EDIT_HASH and
    // freshness is 'fresh'.
    expect(evt!.data.current_graph_hash).toBe(POST_EDIT_HASH);
  });

  it('remains FRESH when persisted graph matches the prior run_analysis fact (no edit)', async () => {
    // Prior run_analysis on the PRE-edit graph, no subsequent edit:
    // persisted graph is still the same shape.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = PRE_EDIT_GRAPH;
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('explanation'),
    );

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'why does it lead?' },
      'req-fresh-h3',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.reason).toBe('graph_hash_match');
    expect(evt!.data.current_graph_hash).toBe(PRE_EDIT_HASH);
  });

  it('falls back to request graphState when persisted graph fails ingress parse (Codex Improvement 1)', async () => {
    // The H3 fix safe-parses `context.persistedGraph` via
    // GraphStateIngressSchema before hashing. If the persisted graph is
    // present BUT malformed (corrupt JSON shape after a partial write,
    // legacy schema version, or test fixture drift), the parse fails
    // and the code falls back to hashing the request graphState. This
    // test exercises that branch — without it, the malformed-persisted
    // case is reachable only by inspection.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    // Malformed: `nodes` must be an array per GraphStateIngressSchema;
    // a string-typed nodes field forces safeParse to fail.
    (global as Record<string, unknown>).__test_persisted_graph = {
      nodes: 'not-an-array',
      edges: [],
    };
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('fallback after parse failure'),
    );

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'why did that lead?' },
      'req-malformed-persisted-h3',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    // Persisted-graph parse failed → fallback hashed the request graph
    // → matches the prior fact's hash → freshness is `'fresh'`. The
    // critical assertion is `current_graph_hash === PRE_EDIT_HASH`,
    // proving the request-graph fallback executed. (The persisted-
    // graph branch with a malformed payload couldn't have produced
    // any hash value at all — `computeAnalysisAffectingGraphHash`
    // returns null when given a non-graph shape — so the only way
    // to observe a non-null `current_graph_hash` here is via the
    // fallback path.)
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.current_graph_hash).toBe(PRE_EDIT_HASH);
  });

  it('falls back to request graphState when persisted graph is absent (first-draft turn)', async () => {
    // No persisted graph: this is a first-draft turn or the persisted
    // read degraded. Request graphState is the only signal available.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = null;
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('fallback path'),
    );

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'first response after analysis' },
      'req-fallback-h3',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    // Without a persisted graph the fallback hashes the request graph —
    // and that matches the prior fact's hash so freshness is 'fresh'.
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.current_graph_hash).toBe(PRE_EDIT_HASH);
  });
});
