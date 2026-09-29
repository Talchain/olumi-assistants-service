/**
 * TRUST-SPINE — board item #4: reload == committed == analysed.
 * Regression guard AT THE TURN-EXECUTOR SEAM (the real "reload" object).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Why this file exists (see acceptance-evidence/
 * trust-spine-scoreboard-2026-07-17/RED-DIAGNOSIS-4-and-7.md):
 *
 * The peer gate `context/__tests__/trust-spine-red-reload-committed.test.ts`
 * asserted item #4 by calling `assembleContextPack(...)` with NO `canonicalState`
 * and NO raw `graph`. That hits the assembler's DOCUMENTED compacted-path
 * fallback (`context-pack-assembler.ts:698` — `rawGraph === null → return null`),
 * which is a deliberately-null design of the ContextPack.analysis_state FIELD
 * (locked in by the sibling `context-pack-analysis-state.test.ts:104`), NOT the
 * live freshness seam. So that gate's `it.fails` was an under-mock: it observed a
 * null the assembler is designed to emit, not a live "committed row never read".
 *
 * The ACTUAL "reload = committed = analysed" property lives at the turn-executor:
 * `turn-executor.ts:1283-1350` derives `currentAnalysisGraphHashForTurn` from
 * `context.persistedGraph` (the committed `scenarios.graph` row) — NEVER the
 * request's ingress `graph_state` — then `deriveAnalysisFreshness(prior_facts,
 * currentAnalysisGraphHashForTurn, …)` compares the analysed hash against it.
 * On a reload turn that carries NO ingress graph_state, `context.persistedGraph`
 * is still loaded by `buildTurnContext`, so the committed row IS the freshness
 * authority. This guard drives that seam through the real `runTurnExecutor`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * The two directions (both drive the same seam with graphState OMITTED):
 *
 *   FRESH  — committed row unchanged since the run → freshness 'fresh'.
 *            (Positive control: proves the harness SEES a real, present verdict,
 *             so the STALE assertion below is non-vacuous.)
 *   STALE  — committed row moved on (analysis-affecting edit) after the run →
 *            freshness 'stale'. THE DISCRIMINATING HALF.
 *
 * Mutation-proof (the point of the STALE direction): if the seam ever
 * re-derived the current hash from the ingress graph instead of the committed
 * row, a reload (which carries NO ingress graph) could no longer see the
 * committed-row divergence — the STALE case would flip off 'stale' and go RED.
 * Verified in a throwaway tree by mutating the derivation source at
 * `turn-executor.ts:1298` from the committed row to the RAW request ingress
 * (`graphForHash = persistedGraph` → `options.graphState`). NB: `graphStateForTurn`
 * is itself back-filled from `context.persistedGraph` on a no-ingress turn
 * (turn-executor.ts:1132-1137), so the honest "ingress-only" source is
 * `options.graphState`, which is absent on reload. Under that mutation both
 * directions fall to 'unknown' (fresh→unknown, stale→unknown) — see the PR
 * body's recorded output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Session store mock — no Supabase. Mirrors the slim mock in
// turn-executor-freshness-canonical-graph.test.ts so this test exercises the
// real runTurnExecutor path with deterministic prior_facts / persisted_graph
// fixtures. The reload case is modelled by driving runTurnExecutor with NO
// `graphState` option (no ingress graph_state) while `__test_persisted_graph`
// holds the committed row.
// ---------------------------------------------------------------------------

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => (global as Record<string, unknown>).__test_prior_turns ?? [],
    readFactsFor: async () => (global as Record<string, unknown>).__test_prior_facts ?? [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => (global as Record<string, unknown>).__test_persisted_graph ?? null,
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
// Fixtures
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

// A reload turn: a follow-up message that carries NO graph_state. `turn_class`
// 'frame' routes to a plain conversational reply (the routing adapter returns
// text, no tool call), so no run_analysis fact is produced this turn — the
// verdict is derived purely from the prior fact + the committed row.
const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: SCENARIO_ID,
  message: 'what did the analysis say?',
  turn_class: 'frame',
  stage: 'analyse',
};

/** The committed `scenarios.graph` row the analysis ran against. GraphV3-valid. */
const COMMITTED_GRAPH = {
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

/**
 * The committed row AFTER an analysis-affecting edit landed (edge strength.mean
 * moved). Models "the committed row moved on after the run" — a reload must read
 * this as STALE, never re-surface the old analysis as fresh.
 */
const DIVERGED_COMMITTED_GRAPH = {
  ...COMMITTED_GRAPH,
  edges: [
    { ...COMMITTED_GRAPH.edges[0]!, strength: { mean: 0.85, std: 0.1 } },
    COMMITTED_GRAPH.edges[1]!,
  ],
};

const COMMITTED_HASH = computeAnalysisAffectingGraphHash(COMMITTED_GRAPH as never)!;
const DIVERGED_HASH = computeAnalysisAffectingGraphHash(DIVERGED_COMMITTED_GRAPH as never)!;

// ---------------------------------------------------------------------------
// Telemetry sink — the pre-handler `v5.analysis_freshness.derived` event is the
// direct output of the derivation seam (turn-executor.ts:1346 routingFreshness).
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function preHandlerFreshnessEvent(): Event | undefined {
  return events.find(
    (e) =>
      e.event === 'v5.analysis_freshness.derived' &&
      (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
  );
}

function installPriorRunAnalysisFact(graphHashAtRun: string): void {
  // The prior turn row — buildTurnContext loads prior_facts by row id, so the
  // turn MUST be present or the facts are dropped (build-turn-context.ts:907).
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

describe('turn-executor reload — committed row is the freshness authority (board #4)', () => {
  beforeEach(() => {
    events = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
    // Fixture invariant: the two graphs MUST hash differently, else the STALE
    // direction is meaningless. Guard against a future graph-hash change that
    // accidentally projects strength.mean out.
    if (COMMITTED_HASH === DIVERGED_HASH) {
      throw new Error(
        'Test fixture invariant violated: COMMITTED_HASH must differ from DIVERGED_HASH',
      );
    }
  });
  afterEach(() => {
    setTestSink(null);
    delete (global as Record<string, unknown>).__test_prior_turns;
    delete (global as Record<string, unknown>).__test_prior_facts;
    delete (global as Record<string, unknown>).__test_persisted_graph;
  });

  it('FRESH: a reload with NO ingress graph_state surfaces the committed analysis as fresh', async () => {
    // Prior run_analysis ran against the committed row; the committed row is
    // unchanged; the reload turn carries NO graph_state.
    installPriorRunAnalysisFact(COMMITTED_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = COMMITTED_GRAPH;

    const run = await runTurnExecutor({ ...BASE_PAYLOAD }, 'req-reload-fresh', {
      routingAdapter: mockRoutingAdapter(async () => mkTextResult('Here is a recap of the prior analysis.')),
      // graphState OMITTED — the reload / no-ingress case.
    });

    // (a) The wire-bound verdict route-v2 threads into finaliseV5Response.
    expect(run.freshness, 'runTurnExecutor must surface a freshness verdict').toBeDefined();
    expect(run.freshness!.freshness).toBe('fresh');
    expect(run.freshness!.reason).toBe('graph_hash_match');
    // Both hashes are the COMMITTED row's — proving the current hash was
    // sourced from the committed row, not any ingress graph (there is none).
    expect(run.freshness!.graph_hash_at_run).toBe(COMMITTED_HASH);
    expect(run.freshness!.current_graph_hash).toBe(COMMITTED_HASH);

    // (b) The derivation-seam telemetry mirrors it (pre-handler routing view).
    const evt = preHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.current_graph_hash).toBe(COMMITTED_HASH);
  });

  it('STALE: a reload after a committed-row analysis-affecting edit surfaces stale (discriminating half)', async () => {
    // Prior run_analysis ran against the ORIGINAL committed row (COMMITTED_HASH);
    // the committed row then moved on to DIVERGED; the reload carries NO
    // graph_state. The only way to see this divergence is to hash the committed
    // row — a seam that re-derived from ingress could not (there is no ingress).
    installPriorRunAnalysisFact(COMMITTED_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = DIVERGED_COMMITTED_GRAPH;

    const run = await runTurnExecutor({ ...BASE_PAYLOAD }, 'req-reload-stale', {
      routingAdapter: mockRoutingAdapter(async () => mkTextResult('Here is a recap of the prior analysis.')),
      // graphState OMITTED — the reload / no-ingress case.
    });

    expect(run.freshness, 'runTurnExecutor must surface a freshness verdict').toBeDefined();
    expect(run.freshness!.freshness).toBe('stale');
    expect(run.freshness!.reason).toBe('graph_hash_diverged');
    // The analysed hash is the OLD committed row; the current hash is the NOW
    // DIVERGED committed row — a truthful, non-matching pair. A false-fresh
    // (current == run) would mean the seam read something other than the moved
    // committed row.
    expect(run.freshness!.graph_hash_at_run).toBe(COMMITTED_HASH);
    expect(run.freshness!.current_graph_hash).toBe(DIVERGED_HASH);
    expect(run.freshness!.current_graph_hash).not.toBe(run.freshness!.graph_hash_at_run);

    const evt = preHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('stale');
    expect(evt!.data.current_graph_hash).toBe(DIVERGED_HASH);
  });
});
