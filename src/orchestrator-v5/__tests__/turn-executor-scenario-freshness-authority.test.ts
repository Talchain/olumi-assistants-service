/**
 * ⭐⭐ THE GUARD THAT WAS MISSING: the wire-bound and scenario-bound freshness
 * derivations are DISTINCT AUTHORITIES OVER DISTINCT FACT ARRAYS.
 *
 * ⚠ WHY THIS FILE EXISTS, stated precisely, because the failure it prevents has
 * already happened once and cost 56 spec files / 179 tests to discover.
 *
 * `turn-executor.ts` derives freshness twice on every turn:
 *
 *   · `routingFreshness` over `context.prior_facts` — the bounded ~20-turn hot
 *     window. This is the WIRE-bound verdict. It drives pending-action hash
 *     preconditions, chips, `analysis_ready` and the authoritative top-level
 *     `graph_hash`, and it is surfaced as `TurnExecutorRunResult.freshness`.
 *   · `promptAnalysisFreshness` over the durable scenario-lifetime
 *     `run_analysis` history. This feeds the ContextPack and the prompt, and is
 *     now also surfaced as `TurnExecutorRunResult.scenarioFreshness`.
 *
 * The separation is annotated in-code as *"⚠ NOT the same question"*. A change
 * that repoints the first at the second's array, or assigns one to the other,
 * looks like tidying two near-identical expressions into one. It is the inverse
 * of the trap-21 remedy: reconciling two authorities that were correctly named
 * apart.
 *
 * ⚠ AND IT DOES NOT FAIL LOUDLY BY ITSELF. When the durable carrier is absent —
 * every spec that stubs only `context.prior_facts`, and any turn whose canonical
 * graph read does not license the durable analysis — the collapsed derivation
 * short-circuits at `deriveAnalysisFreshness`'s FIRST branch and returns
 * `unknown` / `derivation_failed` for EVERY input class. The discriminator stops
 * discriminating, and 179 unrelated assertions report the collapse as their own
 * failure (CLAUDE.md trap 20: *when a per-item query returns identical results
 * for every item, suspect the query*).
 *
 * THIS SUITE IS THE POSITIVE PIN. It constructs a turn on which the two
 * authorities MUST disagree — the hot window has lost the saved analysis, the
 * durable history still holds it — and asserts they do. Any collapse makes the
 * two verdicts equal and REDs this file BY NAME, before the estate-wide damage.
 *
 * BINDING BY IDENTITY (trap 19): the scenario verdict is asserted to carry the
 * saved fact's OWN `graph_hash_at_run` and `computed_at`, never merely "some
 * stale verdict".
 */

import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test.
//
// `durablePage` is the half that matters: it is what
// `build-turn-context.ts::fetchScenarioAnalysisFacts` reads, and setting it to
// `null` removes the method entirely, which is the honest way to reproduce "no
// durable port" (the reconciler then answers `degraded` / `durable_unavailable`).
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  priorFactsWithTurn: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  pendingActions: readonly PendingAction[];
  durablePage: { total_count: number; facts: Array<Record<string, unknown>>; legacy_edit_facts?: import('../types/handler-fact.js').LegacyAnalysisEditFacts } | null;
} = {
  priorTurns: [],
  priorFacts: [],
  priorFactsWithTurn: [],
  persistedGraph: null,
  pendingActions: [],
  durablePage: null,
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    readFactsWithTurnFor: async () => mockState.priorFactsWithTurn,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: mockState.persistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockState.pendingActions,
    ...(mockState.durablePage === null
      ? {}
      : { readScenarioRunAnalysisFactsFor: async () => mockState.durablePage }),
  }),
  resetSessionStoreForTests: () => undefined,
}));




// ---------------------------------------------------------------------------
// Fixtures — the graphs and hashes are COMPUTED, never spelled.
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SAVED_FACT_ROW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SAVED_COMPUTED_AT = '2026-09-01T09:00:00.000Z';

const ANALYSED_GRAPH = {
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
const ANALYSED_GRAPH_HASH = computeAnalysisAffectingGraphHash(ANALYSED_GRAPH as never)!;

/** The graph as it stands now — an edge strength was edited since the run. */
const EDITED_GRAPH = {
  ...ANALYSED_GRAPH,
  edges: [
    { ...ANALYSED_GRAPH.edges[0]!, strength: { mean: 0.6, std: 0.1 } },
    ANALYSED_GRAPH.edges[1]!,
    ANALYSED_GRAPH.edges[2]!,
  ],
};
const EDITED_GRAPH_HASH = computeAnalysisAffectingGraphHash(EDITED_GRAPH as never)!;

function savedRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'The analysis that has rolled out of the hot window',
      graph_hash_at_run: ANALYSED_GRAPH_HASH,
      computed_at: SAVED_COMPUTED_AT,
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  };
}

/**
 * The durable page the store returns. One row, `total_count: 1` ⇒ the reconciler
 * answers `complete`, which is a reasoning authority.
 */
function durablePageWithSavedAnalysis() {
  return {
    total_count: 1,
    facts: [
      {
        fact: savedRunAnalysisFact(),
        fact_row_id: SAVED_FACT_ROW_ID,
        fact_created_at: SAVED_COMPUTED_AT,
      },
    ],
  };
}

/**
 * A hot-window fact that is NOT a `run_analysis`. Deliberately non-empty: an
 * empty window is indistinguishable from "no facts were threaded", and would
 * not show that the window verdict is `none` BECAUSE the analysis is missing
 * rather than because nothing was read.
 */
const HOT_WINDOW_EDIT_FACT = {
  fact_type: 'edit_graph' as const,
  fact_version: 1 as const,
  noop: false,
  result: { scenario_id: SCENARIO_ID, applied: true },
};

const PRIOR_TURN = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-edit',
  turn_class: 'handler',
  handler_id: 'edit_graph',
  request_hash: 'sha256:prior-edit',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};



/** A coach tool call that finalises without dispatching a handler. */




beforeEach(() => {
  mockState.priorTurns = [PRIOR_TURN];
  mockState.priorFacts = [HOT_WINDOW_EDIT_FACT];
  mockState.priorFactsWithTurn = [];
  mockState.persistedGraph = EDITED_GRAPH;
  mockState.pendingActions = [];
  mockState.durablePage = durablePageWithSavedAnalysis();
  setTestSink(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  setTestSink(null);
});

describe('turn-executor — two freshness authorities, two questions, one turn', () => {
  it('fixture sanity: the graph has genuinely moved since the saved run', () => {
    // Without this the "stale" assertions below could pass as "fresh" and the
    // suite would still look healthy.
    expect(EDITED_GRAPH_HASH).not.toBe(ANALYSED_GRAPH_HASH);
  });






});
