/**
 * V5 context-reliability lifecycle — deterministic, context-correctness proof.
 *
 * Proves the option-identity freshness guard end-to-end through the real
 * turn-executor (mocked SessionStore, no network), asserting the actual CONTEXT
 * DECISION (the freshness verdict + reason on the pre-handler derivation) — not
 * HTTP success. Mirrors the deterministic pattern of
 * turn-executor-edit-graph-then-state-query.integration.test.ts.
 *
 * Coverage (the deltas this lane introduces):
 *   1. Clean in-sync analysis, guard ON → stays FRESH (no false-positive stale).
 *   2. Recovered-session option mismatch (legacy fact, analysed X/Y/C vs current
 *      A/B/C, clear leader X), guard ON → fails closed to STALE /
 *      analysed_options_diverged (the system must NOT imply the analysis
 *      reflects the current model).
 *   3. Same scenario, guard OFF → UNKNOWN (flag-off is byte-identical; the guard
 *      is the only thing that changes the verdict).
 *   4. A routed follow-up on a fresh analysis stays correctly grounded (freshness
 *      fresh, the turn produces a response rather than refusing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { _resetConfigCache } from '../../config/index.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';

// Persisted (current) graph: options A/B/C as a top-level options[] array (the
// production CEEGraphResponseV3 shape) plus the matching factor/goal nodes.
const CURRENT_GRAPH = {
  schema_version: 'v3',
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 goal' },
    { id: 'fac_cost', kind: 'factor', label: 'Cost', observed_state: { value: 100 } },
  ],
  edges: [
    {
      from: 'fac_cost',
      to: 'goal_q3',
      edge_type: 'causal',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
  options: [{ id: 'opt_a' }, { id: 'opt_b' }, { id: 'opt_c' }],
  goal_node_id: 'goal_q3',
};

const CURRENT_GRAPH_HASH = computeAnalysisAffectingGraphHash(CURRENT_GRAPH as never)!;

function mkRunAnalysisFact(opts: {
  graphHashAtRun?: string | null; // omit → legacy fact (no hash)
  leader: string;
  analysedOptionIds: readonly string[];
}) {
  const result: Record<string, unknown> = {
    scenario_id: SCENARIO_ID,
    leading_option_id: opts.leader,
    summary: 'Prior analysis result',
    computed_at: new Date(Date.now() - 120_000).toISOString(),
    enrichment: {
      analysis_status: 'completed',
      option_comparison: opts.analysedOptionIds.map((id) => ({
        option_id: id,
        option_label: `Label ${id}`,
        win_probability: 0.5,
      })),
    },
  };
  if (opts.graphHashAtRun != null) result.graph_hash_at_run = opts.graphHashAtRun;
  return { fact_type: 'run_analysis' as const, fact_version: 1 as const, noop: false, result };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: '33333333-3333-4333-8333-333333333333',
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

function callingRoutingAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
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

function preHandlerFreshness(): Event | undefined {
  return events.find(
    (e) =>
      e.event === 'v5.analysis_freshness.derived' &&
      (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
  );
}

function setGuard(on: boolean): void {
  vi.stubEnv('CEE_OPTION_IDENTITY_FRESHNESS_GUARD', on ? 'true' : 'false');
  _resetConfigCache();
}

describe('V5 context-reliability lifecycle — option-identity freshness guard', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [];
    mockState.persistedGraph = CURRENT_GRAPH;
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it('clean in-sync analysis with guard ON → FRESH (no false-positive stale)', async () => {
    // Fact ran against the CURRENT graph hash and analysed exactly A/B/C.
    mockState.priorFacts = [
      mkRunAnalysisFact({
        graphHashAtRun: CURRENT_GRAPH_HASH,
        leader: 'opt_a',
        analysedOptionIds: ['opt_a', 'opt_b', 'opt_c'],
      }),
    ];
    setGuard(true);
    await runTurnExecutor(mkPayload('why does that option lead?'), 'req-clean-fresh', {
      routingAdapter: callingRoutingAdapter('Because of the cost factor.'),
      graphState: CURRENT_GRAPH as never,
    });
    const evt = preHandlerFreshness();
    expect(evt, 'pre-handler freshness telemetry should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.reason).toBe('graph_hash_match');
  });

  it('RECOVERED-SESSION mismatch with guard ON → STALE / analysed_options_diverged (fails closed)', async () => {
    // Legacy fact (no graph_hash_at_run → the hash path lands on UNKNOWN), and
    // the analysis refers to options X/Y/C (leader X) that no longer exist on
    // the current A/B/C canvas — the exact failure class from the brief.
    mockState.priorFacts = [
      mkRunAnalysisFact({
        graphHashAtRun: null,
        leader: 'opt_x',
        analysedOptionIds: ['opt_x', 'opt_y', 'opt_c'],
      }),
    ];
    setGuard(true);
    await runTurnExecutor(mkPayload('which option should we go with?'), 'req-recovered-stale', {
      routingAdapter: callingRoutingAdapter('placeholder'),
      graphState: CURRENT_GRAPH as never,
    });
    const evt = preHandlerFreshness();
    expect(evt).toBeDefined();
    expect(evt!.data.freshness).toBe('stale');
    expect(evt!.data.reason).toBe('analysed_options_diverged');
    // The dedicated divergence event fired too.
    expect(events.some((e) => e.event === 'v5.analysis_freshness.options_diverged')).toBe(true);
  });

  it('same recovered-session mismatch with guard OFF → UNKNOWN (flag-off byte-identical)', async () => {
    mockState.priorFacts = [
      mkRunAnalysisFact({
        graphHashAtRun: null,
        leader: 'opt_x',
        analysedOptionIds: ['opt_x', 'opt_y', 'opt_c'],
      }),
    ];
    setGuard(false);
    await runTurnExecutor(mkPayload('which option should we go with?'), 'req-recovered-unknown', {
      routingAdapter: callingRoutingAdapter('placeholder'),
      graphState: CURRENT_GRAPH as never,
    });
    const evt = preHandlerFreshness();
    expect(evt).toBeDefined();
    expect(evt!.data.freshness).toBe('unknown');
    expect(evt!.data.reason).toBe('legacy_fact_missing_hash');
    // No divergence event when the guard is off.
    expect(events.some((e) => e.event === 'v5.analysis_freshness.options_diverged')).toBe(false);
  });

  it('routed follow-up on a fresh analysis stays grounded (fresh + a response is produced)', async () => {
    mockState.priorFacts = [
      mkRunAnalysisFact({
        graphHashAtRun: CURRENT_GRAPH_HASH,
        leader: 'opt_a',
        analysedOptionIds: ['opt_a', 'opt_b', 'opt_c'],
      }),
    ];
    setGuard(true);
    const result = await runTurnExecutor(
      mkPayload('what does the analysis say about option A?'),
      'req-routed-grounded',
      {
        routingAdapter: callingRoutingAdapter('Option A leads on the current model.'),
        graphState: CURRENT_GRAPH as never,
      },
    );
    const evt = preHandlerFreshness();
    expect(evt!.data.freshness).toBe('fresh');
    // Context-grounded: the turn produced a non-empty response (not a refusal).
    expect(typeof result.response.assistant_text).toBe('string');
    expect((result.response.assistant_text ?? '').length).toBeGreaterThan(0);
  });
});
