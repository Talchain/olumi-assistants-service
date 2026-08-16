/**
 * CONTEXT/MEMORY V5 defect 4 — ROUTE A: `dispatchEditGraph`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PINS
 *
 * `fetchPriorFacts` (build-turn-context.ts) returns `[]` in FOUR different
 * situations: no session store, no prior turns, no prior-turn row ids, and
 * `readFactsFor` THREW. Only the last is a failure; the first three are
 * genuine, successful emptiness. Before the fix every one of them derived
 * `freshness: 'none' / reason: 'no_successful_run_analysis_fact'` — a POSITIVE
 * claim that this scenario has never been analysed, made on a turn where we
 * could not look.
 *
 * The fix threads a read-state flag (`EnrichedTurnContext.prior_facts_read_ok`,
 * set at build-turn-context.ts:816, `false` ONLY from the `fetchPriorFacts`
 * catch) into `deriveAnalysisFreshness`'s 4th parameter, so a THROWN read
 * yields `'unknown' / 'derivation_failed'` instead.
 *
 * This file exercises the PRIMARY edit-graph derivation (edit-graph-dispatch.ts
 * ~:2500, telemetry at ~:2515) end to end through the REAL `buildTurnContext`
 * and the REAL `fetchPriorFacts`, driven by a session store whose
 * `readFactsFor` genuinely rejects. Nothing hand-authors `prior_facts_read_ok`
 * — that is the point: a test that constructed the flag itself would prove the
 * derivation reads a field, not that the read failure reaches it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OBSERVABLE
 *
 * The `v5.analysis_freshness.derived` telemetry event emitted by
 * `emitFreshnessTelemetry` (context/freshness.ts:780), captured via
 * `setTestSink`. Assertions bind BY IDENTITY to `dispatch_path === 'edit_graph'`
 * — the dispatcher emits other freshness events on other paths
 * (`edit_graph_rejected_multipart`, `edit_graph_finalise`,
 * `edit_graph_unmapped_parts`), and a value-predicate match ("the event whose
 * freshness is unknown") could be satisfied by a different derivation site
 * entirely. `assertSoleEditGraphDerived` also asserts EXACTLY ONE such event,
 * so a second `edit_graph` derivation appearing later cannot be silently
 * matched against instead.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WOULD HAVE TO BE TRUE FOR THESE TESTS TO PASS WHILE THE PROPERTY IS BROKEN
 *
 * The classic vacuity here is that the degraded arm never actually degrades.
 * `fetchPriorFacts` short-circuits BEFORE its try/catch on three guards
 * (`!store`, `priorTurns.length === 0`, `priorTurnRowIds.length === 0`), each
 * returning `readOk: TRUE`. If `readRecent` returned `[]`, the rejecting
 * `readFactsFor` would never be called at all, the flag would be `true`, and
 * the arm would assert against the HEALTHY branch — passing only because the
 * verdict happens to look wrong in the same way. Three defences:
 *
 *   1. `readRecent` returns one row WITH a string `id`, so the guards are
 *      cleared and the try block is genuinely entered.
 *   2. `readFactsWithTurnFor` is DELIBERATELY ABSENT from the store mock. It is
 *      tried FIRST (build-turn-context.ts:1705); had it been present and
 *      resolved non-empty, `readFactsFor` would never run and the rejection
 *      would never fire.
 *   3. Every arm asserts `readFactsForMock` WAS CALLED — the precondition is
 *      pinned in-test, so a short-circuit fails loud instead of passing quietly.
 *
 * The second vacuity is a fix that downgraded EVERY empty read to `unknown`,
 * which would satisfy arm 1 while destroying the product's ability to say "no
 * analysis has been run". Arm 2 is the discriminating twin: same code path,
 * same store, `readFactsFor` RESOLVES `[]`, and the verdict must still be
 * `'none' / 'no_successful_run_analysis_fact'`. Arms 1 and 2 differ in exactly
 * one byte of stimulus — reject vs resolve — so any verdict difference between
 * them is attributable to the read state and nothing else.
 *
 * The third vacuity is a degraded flag that blanks out a REAL analysis. Arm 3
 * feeds a genuine `run_analysis` fact and proves the verdict is
 * HASH-DERIVED, by moving the hash and nothing else: a deliberately-diverged
 * `graph_hash_at_run` must give `'stale' / 'graph_hash_diverged'`, and the
 * SAME fact re-run with `graph_hash_at_run` set to the `current_graph_hash`
 * the dispatcher itself reported must give `'fresh' / 'graph_hash_match'`.
 * A stuck verdict cannot satisfy both halves.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

// ── mutable store seams (hoisted so the vi.mock factory can close over them) ──

const { readRecentMock, readFactsForMock, appendMock } = vi.hoisted(() => ({
  readRecentMock: vi.fn(),
  readFactsForMock: vi.fn(),
  appendMock: vi.fn().mockResolvedValue({ id: 'mock-row-id' }),
}));

// ⚠ `readFactsWithTurnFor` is DELIBERATELY OMITTED — see the docblock. It is
// tried before `readFactsFor`, so including it would let a resolved non-empty
// value bypass the rejection this file exists to exercise.
vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: readRecentMock,
    readFactsFor: readFactsForMock,
    readMostRecentPendingActions: async () => [],
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

// Stub ONLY the strict persisted read (V5-PERSIST-FIX-01 precedent, copied
// verbatim from edit-graph-dispatch-analysis-ready.test.ts). `null` = a
// genuinely-empty scenarios.graph → ingress-base fallback merge. `buildTurnContext`
// itself stays REAL — it is the unit under test here.
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Bump the launch→revenue edge',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

const POST_EDIT_GRAPH = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    {
      id: 'opt_launch',
      kind: 'option',
      label: 'Launch now',
      data: { interventions: { fac_marketing: 0.7 } },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Status quo',
      data: { interventions: { fac_marketing: 0.3 } },
    },
  ],
  edges: [
    { from: 'opt_launch', to: 'fac_marketing' },
    { from: 'opt_status_quo', to: 'fac_marketing' },
    {
      from: 'fac_marketing',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

function appliedResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge updated.',
    latencyMs: 100,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{ op: 'update_edge', path: 'fac_marketing->goal_revenue', value: 0.7 }],
  };
}

/**
 * A run_analysis fact in the shape the PRODUCER actually reads.
 *
 * ⚠ `viewRunAnalysisFact` (context/freshness.ts:227) reads `graph_hash_at_run`
 * and `computed_at` from `fact.result`, and requires `noop === false`. The same
 * fields at the TOP level make the fact silently UNSELECTABLE — the derivation
 * would fall to the no-fact branch and arm 3 would be asserting against a fact
 * the code cannot see. Derived from the producer, not from the field names.
 */
function runAnalysisFact(graphHashAtRun: string) {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1,
    noop: false,
    result: {
      graph_hash_at_run: graphHashAtRun,
      computed_at: '2026-08-15T00:00:00.000Z',
    },
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// ── telemetry capture ───────────────────────────────────────────────────────

type Captured = { event: string; data: Record<string, unknown> };
let captured: Captured[] = [];

/**
 * The sole `v5.analysis_freshness.derived` event for the PRIMARY edit-graph
 * derivation. Bound by IDENTITY (`dispatch_path === 'edit_graph'`), never by a
 * value predicate — and asserted to be unique, so a second derivation site
 * cannot be silently substituted for the one under test.
 */
function soleEditGraphDerived(): Record<string, unknown> {
  const matches = captured.filter(
    (c) => c.event === 'v5.analysis_freshness.derived' && c.data.dispatch_path === 'edit_graph',
  );
  expect(matches).toHaveLength(1);
  return matches[0]!.data;
}

async function runDispatch() {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(appliedResult());
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: true,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);

  return dispatchEditGraph({
    payload: payload(),
    requestId: 'req-edit-degraded',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

describe('edit-graph-dispatch — a degraded prior-fact read must not claim "never analysed" (defect 4, route A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured = [];
    setTestSink((event, data) => {
      if (event.startsWith('v5.analysis_freshness.')) captured.push({ event, data });
    });
    // Non-empty prior turns WITH row ids — clears the three `fetchPriorFacts`
    // short-circuits so the try/catch is genuinely reached. Without this the
    // degraded arm silently tests the healthy branch.
    readRecentMock.mockResolvedValue([{ id: 'prior-run-row' }]);
  });

  afterEach(() => {
    setTestSink(null);
  });

  it('DEGRADED: readFactsFor THROWS → unknown / derivation_failed, never none', async () => {
    readFactsForMock.mockRejectedValue(new Error('simulated prior-fact read failure'));

    await runDispatch();

    // Precondition pin: the rejecting read was genuinely reached. If
    // `fetchPriorFacts` had short-circuited, this fails loud rather than
    // letting the assertions below pass on the healthy branch.
    expect(readFactsForMock).toHaveBeenCalled();

    const derived = soleEditGraphDerived();
    expect(derived.freshness).toBe('unknown');
    expect(derived.reason).toBe('derivation_failed');
    // The defect, stated as its own assertion: a store failure must never be
    // reported as a positive "this scenario has never been analysed" claim.
    expect(derived.freshness).not.toBe('none');
    expect(derived.reason).not.toBe('no_successful_run_analysis_fact');
  });

  it('OK-ARM CONTROL: readFactsFor RESOLVES [] → none / no_successful_run_analysis_fact', async () => {
    // The discriminating twin. Identical to the degraded arm in every respect
    // except that the read SUCCEEDS and is genuinely empty. A fix that
    // downgraded every empty read to `unknown` would pass the arm above and
    // fail here — which is exactly what this arm exists to catch.
    readFactsForMock.mockResolvedValue([]);

    await runDispatch();

    expect(readFactsForMock).toHaveBeenCalled();

    const derived = soleEditGraphDerived();
    expect(derived.freshness).toBe('none');
    expect(derived.reason).toBe('no_successful_run_analysis_fact');
    expect(derived.reason).not.toBe('derivation_failed');
  });

  it('FACT-AUTHORITATIVE: a real run_analysis fact is never blanked out, and the verdict tracks the HASH', async () => {
    // ── half 1: a diverged hash must produce the hash-derived stale verdict ──
    readFactsForMock.mockResolvedValue([runAnalysisFact('sha256:deliberately-diverged')]);

    await runDispatch();

    expect(readFactsForMock).toHaveBeenCalled();

    const diverged = soleEditGraphDerived();
    expect(diverged.freshness).toBe('stale');
    expect(diverged.reason).toBe('graph_hash_diverged');
    // A real analysis exists, so neither the "never analysed" claim nor the
    // degraded claim may be made.
    expect(diverged.freshness).not.toBe('none');
    expect(diverged.reason).not.toBe('no_successful_run_analysis_fact');
    expect(diverged.reason).not.toBe('derivation_failed');
    // Pins that the fact was genuinely SELECTED — the guard against the
    // silently-unselectable fixture shape described above.
    expect(diverged.selected_fact_index).toBe(0);
    expect(diverged.graph_hash_at_run).toBe('sha256:deliberately-diverged');

    // The dispatcher's own report of the current graph hash. Used to build the
    // matching-hash half, so the fixture cannot drift from the code's hashing.
    const currentGraphHash = diverged.current_graph_hash;
    expect(typeof currentGraphHash).toBe('string');
    expect(currentGraphHash).not.toBe('sha256:deliberately-diverged');

    // ── half 2: the SAME fact with a matching hash must flip to fresh ────────
    // Moving one field and nothing else. A verdict stuck on any single value
    // cannot satisfy both halves, so this pair proves the verdict is genuinely
    // derived from the hash comparison rather than from the read state.
    captured = [];
    vi.clearAllMocks();
    readRecentMock.mockResolvedValue([{ id: 'prior-run-row' }]);
    readFactsForMock.mockResolvedValue([runAnalysisFact(currentGraphHash as string)]);

    await runDispatch();

    expect(readFactsForMock).toHaveBeenCalled();

    const matched = soleEditGraphDerived();
    expect(matched.freshness).toBe('fresh');
    expect(matched.reason).toBe('graph_hash_match');
    expect(matched.selected_fact_index).toBe(0);
  });
});
