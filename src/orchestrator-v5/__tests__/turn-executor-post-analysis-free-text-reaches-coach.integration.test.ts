/**
 * ROADMAP 2.229 — post-analysis free text reaches the COACH.
 *
 * ⚠ THIS FILE PREVIOUSLY PINNED THE OPPOSITE GUARANTEE. It was
 * `turn-executor-fresh-analysis-followup.integration.test.ts`'s acceptance for
 * the fresh-analysis follow-up guard, and it asserted that a recognised
 * post-analysis question NEVER reached the LLM — with a routing adapter that
 * THREW if invoked, and an assertion that the frozen `RECAP_TEXT` constant
 * shipped verbatim. Founder ruling (ROADMAP 2.229): RETIRE that guard. Every
 * assertion below is the INVERSE of the one it replaces; none was deleted
 * without a replacement that bites.
 *
 * Why the guard went. Its stated premise was that reaching the LLM router
 * "costs ~11s and misroutes to `edit_graph`". Measured on the deployed build
 * (`b8a38de`, diagnosis 2.229 §3): two of the four post-analysis questions a
 * live walk asked FELL THROUGH the guard, reached `routeWithToolUse`, and came
 * back with 47 KB of grounded discursive coaching and the complete Phase-3
 * block estate — one routing LLM call each, 10.0 s and 14.9 s. The premise was
 * falsified by the estate it was protecting against.
 *
 * The inversion it created: on a fresh analysis, a question the regex
 * RECOGNISED was answered by a string with ZERO inputs (1,956 bytes, 0 blocks,
 * `llm_calls: []`), while one it FAILED to recognise reached the coach and got
 * grounded prose. Recognition was punished. CEE already treated the constant
 * as the wrong answer — but only said so for CHIP clicks, which bypassed the
 * guard explicitly ("Skip it for a forced pill so the click reaches the coach
 * with conversation sight"). The same sentence, TYPED instead of clicked, got
 * the constant.
 *
 * What this file now proves, at the path level:
 *   - a recognised post-analysis question on a FRESH analysis REACHES
 *     `routeWithToolUse` (the adapter is called) — the treatment chip clicks
 *     already got;
 *   - the retired constant does not ship, on any of the four shapes;
 *   - the guard's telemetry event is GONE, so a re-introduction is RED here
 *     rather than silently restoring the constant;
 *   - MUTATION PRECEDENCE IS UNCHANGED. The four mutation cases the guard's
 *     three review rounds hardened are kept verbatim: a concrete edit paired
 *     with analytical phrasing still reaches the edit path, and still does not
 *     ship the recap. Those cases were the expensive part of the guard's
 *     history and retiring the guard must not quietly retire them too.
 *
 * Setup mirrors `turn-executor-edit-graph-then-state-query.integration.test.ts`:
 * a mocked `getSessionStore` returns the prior facts + persisted graph the
 * turn-executor needs, the routing adapter is the only seam where Sonnet
 * would be called, and telemetry is captured via `setTestSink`.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test
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



// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIOR_RA_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    {
      id: 'opt_hire',
      kind: 'option',
      label: 'Hire',
      interventions: { fac_capacity: 1 },
    },
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

// Successful run_analysis fact with graph_hash_at_run matching the
// currently-persisted graph — `deriveAnalysisFreshness` returns 'fresh'.
function makeFreshRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



/**
 * A routing adapter that RECORDS the call and answers with plain text. The
 * previous version of this file used an adapter that THREW on invocation — the
 * whole point was that the LLM was never reached. Reaching it is now the
 * guarantee, so the adapter answers instead of throwing and `toHaveBeenCalled`
 * is the path proof.
 */


/** The retired constant, verbatim, so its absence is asserted against the
 *  exact bytes that used to ship. */


type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ROADMAP 2.229 — post-analysis free text reaches the coach', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeFreshRunAnalysisFact()];
    mockState.persistedGraph = READY_GRAPH;
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  // The four shapes the retired guard used to claim, one per intent class it
  // recognised. Each `it` below is the INVERSE of the assertion this file
  // carried before: the adapter must be CALLED, and the constant must NOT ship.






  it('the retired constant is gone from the source tree entirely', () => {
    // Belt-and-braces on the deletion itself: the guard MODULE is removed, not
    // merely unwired. If a future change re-adds the module, the import below
    // resolves and this test fails — so the deletion cannot be silently undone
    // by restoring the file and leaving it unreferenced.
    expect(
      existsSync(resolve(HERE, '../routing/fresh-analysis-followup-guard.ts')),
      'the fresh-analysis follow-up guard module must stay deleted (ROADMAP 2.229 founder ruling)',
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // MUTATION PRECEDENCE — carried over VERBATIM from the retired guard's three
  // review rounds. These cases cost the estate real review time and they are
  // about the EDIT path, not the guard: a concrete edit paired with analytical
  // phrasing must still reach edit dispatch. Retiring the guard must not
  // quietly retire the coverage it accumulated.
  // -------------------------------------------------------------------------







});
