/**
 * The bounded routing-failure copy must name the TRUE unblock.
 *
 * EVERY path into `buildBoundedFallbackCopyAndChips` (turn-executor.ts) is a
 * MODEL-OUTPUT failure, and none of them is caused or cured by the state of
 * the analysis:
 *
 *   - `commitBoundedRoutingFallback` (turn-executor.ts, the `switch` on
 *     `RoutingError.cause`): `schema_repair_failed` | `empty_response` |
 *     `unexpected_stop_reason`. The last of these is `tryInterpret`
 *     (routing/route-with-tool-use.ts) classifying `stop_reason ===
 *     'max_tokens'` on BOTH the initial `V5_ROUTING_MAX_OUTPUT_TOKENS` call
 *     and the escalated `V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY` retry — 3072 and
 *     8192 respectively, read at `routing/route-with-tool-use.ts:61` and `:75`
 *     on 2026-09-02. An earlier draft of this file said 2048, a cap that was
 *     superseded before this suite existed, so both budgets are now IMPORTED
 *     and asserted below rather than described in prose (`expectDoubleExhaustion`).
 *   - the coach-branch empty-answer recovery,
 *   - the converse-branch empty-answer recovery,
 *   - the STEP 7 unconditional empty-answer backstop.
 *
 * The turn is therefore genuinely unanswerable (CEE has no model output to
 * compose from), so the copy is the fix — but it must name the unblock that
 * is TRUE ACROSS THE WHOLE DOMAIN, which is to ASK AGAIN. Re-running the
 * analysis does not address a max_tokens routing failure.
 *
 * The defect this suite pins: on a stale (and on an unconfirmed-currency)
 * turn the copy named ONLY the re-run, so it read as though the staleness
 * were both the cause of the failure and its remedy. A live witness followed
 * exactly that instruction, re-ran, re-asked, and concluded the failure was
 * deterministic-on-stale. It is not: the re-ASK is what unblocked the turn.
 *
 * The staleness disclosure itself is TRUE and stays — it is simply not the
 * remedy for the failure, so it must follow the remedy rather than stand in
 * for it. The ordering assertion below is the load-bearing one.
 *
 * Harness mirrors `turn-executor-bounded-recovery-unknown-freshness.test.ts`
 * (same session-store mock and graph fixtures) but drives the ROUTING-FAILURE
 * entry point rather than the STEP 7 backstop, because that is the path the
 * live witness actually took. The message `'help me think this through'`
 * carries no analytical signal, so `tryStaleRerunGuard` declines with
 * `no_analytical_signal` and the turn genuinely reaches routing — asserted
 * per-test, not assumed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  V5_ROUTING_MAX_OUTPUT_TOKENS,
  V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY,
} from '../routing/route-with-tool-use.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test.
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  pendingActions: readonly PendingAction[];
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
  pendingActions: [],
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
    readMostRecentPendingActions: async () => mockState.pendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Fixtures (identical shapes to the sibling F7 suite).
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIOR_RA_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: 'Hire', interventions: { fac_capacity: 1 } },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Hold',
      is_baseline: true,
      interventions: { fac_capacity: 0 },
    },
  ],
  edges: [
    {
      from: 'opt_hire',
      to: 'fac_capacity',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_status_quo',
      to: 'fac_capacity',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_q3',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_q3',
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

const EDITED_GRAPH = {
  ...READY_GRAPH,
  edges: [
    { ...READY_GRAPH.edges[0]!, strength: { mean: 0.6, std: 0.1 } },
    READY_GRAPH.edges[1]!,
    READY_GRAPH.edges[2]!,
  ],
};
const EDITED_GRAPH_HASH = computeAnalysisAffectingGraphHash(EDITED_GRAPH as never)!;

function makeRunAnalysisFact(graphHashAtRun: string): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: graphHashAtRun,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: PRIOR_RA_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

/** No analytical signal, so `tryStaleRerunGuard` declines and the turn
 *  genuinely reaches the routing call. Asserted per-test. */
const NON_ANALYTICAL_MESSAGE = 'help me think this through';

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

/** Both routing calls end `stop_reason: 'max_tokens'` → `tryInterpret`
 *  returns non_repairable `unexpected_stop_reason` → the bounded routing
 *  fallback. This is the live-witnessed failure cause.
 *
 *  `output_tokens` is the IMPORTED first-call cap, not a typed-in number: a
 *  truncated first attempt burns exactly its budget, and a hardcoded literal
 *  here is how the superseded 2048 figure survived a cap change. */
function maxTokensAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue({
        content: [{ type: 'text', text: 'Partial answer cut off at...' }],
        stop_reason: 'max_tokens',
        usage: {
          input_tokens: 10,
          output_tokens: V5_ROUTING_MAX_OUTPUT_TOKENS,
        } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 200,
      }),
  };
}

/**
 * The retry path this suite NAMES, asserted rather than assumed.
 *
 * `stop_reason: 'max_tokens'` on the first call makes `routeWithToolUse` retry
 * ONCE at the escalated budget; only when that second call ALSO ends
 * `max_tokens` does `tryInterpret` classify `unexpected_stop_reason` and the
 * bounded fallback fire. Without this, the suite's commentary described a
 * two-call double-exhaustion that nothing in it bound: the mocked
 * `usage.output_tokens` is a RESPONSE field and constrains neither budget, so
 * a single-call failure shape would have satisfied every assertion.
 *
 * Both budgets are IMPORTED from the producer — the literal values live in
 * exactly one place, `routing/__tests__/routing-max-tokens-caps.test.ts`.
 */
function expectDoubleExhaustion(adapter: ReturnType<typeof maxTokensAdapter>): void {
  // Precondition for the pair below: if the two caps were ever equal, the two
  // budget assertions would agree with each other while discriminating
  // nothing. Pin it in-test (trap 13b) rather than trusting the constants.
  expect(V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY).toBeGreaterThan(V5_ROUTING_MAX_OUTPUT_TOKENS);

  expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
  const firstArgs = adapter.chatWithTools.mock.calls[0]![0];
  const retryArgs = adapter.chatWithTools.mock.calls[1]![0];
  expect(firstArgs.maxTokens).toBe(V5_ROUTING_MAX_OUTPUT_TOKENS);
  expect(retryArgs.maxTokens).toBe(V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY);
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function findPreHandlerFreshnessEvent(): Event | undefined {
  return events.find(
    (e) =>
      e.event === 'v5.analysis_freshness.derived' &&
      (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
  );
}

function findBoundedFallbackEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.routing_bounded_fallback');
}

function findStaleRerunGuardEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.stale_rerun_guard');
}

/** The remedy for the FAILURE, true on every path into this helper. */
const TRUE_UNBLOCK = /ask me again/i;

describe('turn-executor — the bounded routing-failure copy names the TRUE unblock (ask again), not the analysis re-run', () => {
  beforeEach(() => {
    events = [];
    mockState.pendingActions = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('CONFIRMED STALE + routing max_tokens failure: names asking again as the remedy BEFORE the staleness caveat, and still discloses the staleness', async () => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeRunAnalysisFact(READY_GRAPH_HASH)];
    mockState.persistedGraph = EDITED_GRAPH;
    // Fixture sanity: without divergent hashes this would silently degrade to
    // the fresh case and the suite would assert nothing about stale.
    expect(EDITED_GRAPH_HASH).not.toBe(READY_GRAPH_HASH);

    const adapter = maxTokensAdapter();
    const result = await runTurnExecutor(
      mkPayload(NON_ANALYTICAL_MESSAGE),
      'req-unblock-stale',
      { routingAdapter: adapter, graphState: EDITED_GRAPH as never },
    );

    // Pin the PRECONDITIONS, so a green result cannot come from the fixture
    // quietly taking a different route (trap 13b).
    expect(findPreHandlerFreshnessEvent()?.data.freshness).toBe('stale');
    expect(findStaleRerunGuardEvent()?.data.matched).toBe(false);
    expect(findBoundedFallbackEvent()?.data.routing_error_cause).toBe(
      'unexpected_stop_reason',
    );
    expectDoubleExhaustion(adapter);

    const text = result.response.assistant_text;
    // The failure is still disclosed, not papered over.
    expect(text).toContain("I couldn't complete that turn cleanly");
    // THE FIX: the remedy for the failure is named.
    expect(text).toMatch(TRUE_UNBLOCK);
    // The staleness disclosure is TRUE and must survive.
    expect(text).toMatch(/has changed/i);
    expect(text.toLowerCase()).toContain('out of date');
    expect(text.toLowerCase()).toMatch(/re-?run analysis/);
    // THE LOAD-BEARING ORDERING: the remedy for the FAILURE precedes the
    // analysis housekeeping, so the re-run can no longer read as the fix for
    // the failed turn.
    const askIdx = text.toLowerCase().search(/ask me again/);
    const rerunIdx = text.toLowerCase().search(/re-?run analysis/);
    expect(askIdx).toBeGreaterThan(-1);
    expect(rerunIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeLessThan(rerunIdx);
  });

  it('FRESH + routing max_tokens failure: names asking again (the fresh branch previously named no remedy at all)', async () => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeRunAnalysisFact(READY_GRAPH_HASH)];
    mockState.persistedGraph = READY_GRAPH;

    const adapter = maxTokensAdapter();
    const result = await runTurnExecutor(
      mkPayload(NON_ANALYTICAL_MESSAGE),
      'req-unblock-fresh',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(findPreHandlerFreshnessEvent()?.data.freshness).toBe('fresh');
    expect(findBoundedFallbackEvent()?.data.routing_error_cause).toBe(
      'unexpected_stop_reason',
    );
    expectDoubleExhaustion(adapter);

    const text = result.response.assistant_text;
    expect(text).toContain("I couldn't complete that turn cleanly");
    expect(text).toMatch(TRUE_UNBLOCK);
    // The reassurance that the prior analysis survives is true and stays.
    expect(text.toLowerCase()).toContain('still available');
    // A fresh analysis has nothing to refresh, so this branch must NOT
    // instruct a re-run: that would be the same false-remedy defect mirrored.
    //
    // ⚠ Excluding only the change-assertion is NOT enough, and that was the
    // shape of the gap here. `has changed` is the CAVEAT; the harm is the
    // INSTRUCTION. A fresh-copy regression reading "…Ask me again. Re-run
    // analysis to be sure." asserts no change and would have passed the line
    // above while committing the exact defect this suite exists to pin, so
    // the re-run instruction gets its own negative assertion — and so does
    // the staleness claim it usually travels with.
    expect(text).not.toMatch(/has changed/i);
    expect(text.toLowerCase()).not.toMatch(/re-?run analysis/);
    expect(text.toLowerCase()).not.toContain('out of date');
  });

  it('UNCONFIRMED CURRENCY + routing max_tokens failure: names asking again, still refuses to assert a change', async () => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeRunAnalysisFact(READY_GRAPH_HASH)];
    // Persisted graph fails GraphStateIngressSchema ingress parse → freshness
    // 'unknown' / 'current_graph_hash_unavailable' (same fixture the F7 suite
    // proves reaches that branch).
    mockState.persistedGraph = { nodes: 'not-an-array', edges: [] };

    const adapter = maxTokensAdapter();
    const result = await runTurnExecutor(
      mkPayload(NON_ANALYTICAL_MESSAGE),
      'req-unblock-unknown',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt?.data.freshness).toBe('unknown');
    expect(evt?.data.reason).toBe('current_graph_hash_unavailable');
    expect(findBoundedFallbackEvent()?.data.routing_error_cause).toBe(
      'unexpected_stop_reason',
    );
    expectDoubleExhaustion(adapter);

    const text = result.response.assistant_text;
    expect(text).toContain("I couldn't complete that turn cleanly");
    expect(text).toMatch(TRUE_UNBLOCK);
    // Authority parity (the F7 ruling) is preserved: no fabricated change.
    expect(text).not.toMatch(/has changed/i);
    expect(text.toLowerCase()).not.toContain('out of date');
    expect(text.toLowerCase()).toMatch(/can'?t confirm/);
    const askIdx = text.toLowerCase().search(/ask me again/);
    const rerunIdx = text.toLowerCase().search(/re-?run analysis/);
    expect(askIdx).toBeGreaterThan(-1);
    expect(rerunIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeLessThan(rerunIdx);
  });

  it('CONTROL — NO projection: the generic branch copy is UNCHANGED (this fix must not broaden past the analysis-bearing branches)', async () => {
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    mockState.persistedGraph = null;

    const adapter = maxTokensAdapter();
    const result = await runTurnExecutor(
      mkPayload(NON_ANALYTICAL_MESSAGE),
      'req-unblock-none',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(findPreHandlerFreshnessEvent()?.data.freshness).toBe('none');
    expectDoubleExhaustion(adapter);
    expect(result.response.assistant_text).toBe(
      "I couldn't complete that turn cleanly. Try again, or rephrase what you'd like to do.",
    );
  });
});
