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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
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
  durablePage: { total_count: number; facts: Array<Record<string, unknown>> } | null;
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
    storeDraftGraph: async () => undefined,
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

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

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

/** A coach tool call that finalises without dispatching a handler. */
function coachToolResult(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: {
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: {
          headline: 'Where the model stands',
          bullets: [],
          detail: 'A short reflection on the question.',
        },
      },
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

function adapterOnce() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce(coachToolResult()),
  };
}

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

  it('⭐ THE PIN: the wire-bound verdict says `none` while the scenario-bound verdict says `stale`', async () => {
    const result = await runTurnExecutor(
      mkPayload('where does the model stand?'),
      'req-g3-distinct',
      { routingAdapter: adapterOnce(), graphState: EDITED_GRAPH as never },
    );

    // The hot window has lost the analysis — the wire verdict is unchanged by
    // this feature and MUST stay the bounded-window answer.
    expect(result.freshness?.freshness).toBe('none');
    expect(result.freshness?.reason).toBe('no_successful_run_analysis_fact');

    // The durable history still holds it. Bound by identity to the saved fact,
    // not to "some stale verdict".
    expect(result.scenarioFreshness).toBeDefined();
    expect(result.scenarioFreshness?.freshness).toBe('stale');
    expect(result.scenarioFreshness?.graph_hash_at_run).toBe(ANALYSED_GRAPH_HASH);
    expect(result.scenarioFreshness?.computed_at).toBe(SAVED_COMPUTED_AT);

    // ⭐ THE COLLAPSE DETECTOR. Any change that repoints one derivation at the
    // other's array, or assigns one to the other, makes these two equal.
    expect(result.scenarioFreshness?.freshness).not.toBe(result.freshness?.freshness);
    expect(result.scenarioFreshness).not.toBe(result.freshness);

    // …and the collapse's OWN signature, named so a future reader recognises it:
    // a collapsed derivation over an absent carrier returns `unknown` /
    // `derivation_failed` for every input class.
    expect(result.freshness?.reason).not.toBe('derivation_failed');
  });

  it('both derivations describe the SAME current graph — the supersession gate\'s precondition', async () => {
    // The two verdicts differ; the graph they were taken against does not. This
    // is what licenses the route seam to adopt the durable verdict at all, and
    // it is the observable that moves first if either derivation is ever handed
    // a different hash at ORIENT.
    const result = await runTurnExecutor(
      mkPayload('where does the model stand?'),
      'req-g3-same-graph',
      { routingAdapter: adapterOnce(), graphState: EDITED_GRAPH as never },
    );
    expect(result.freshness?.current_graph_hash).toBe(EDITED_GRAPH_HASH);
    expect(result.scenarioFreshness?.current_graph_hash).toBe(EDITED_GRAPH_HASH);
  });

  it('CONTRAST: no durable port ⇒ the field is ABSENT, never a `derivation_failed` non-verdict', async () => {
    // This is the arm that keeps the authority gate honest. With no durable
    // read, `promptAnalysisFreshness` is a derivation over `[]` with
    // `readOk: false` — it exists, and it says `unknown` / `derivation_failed`
    // for every input. Surfacing THAT would hand a consumer a non-verdict
    // wearing a verdict's shape.
    //
    // The store factory re-reads `mockState.durablePage` on EVERY
    // `getSessionStore()` call, so flipping it here genuinely removes the
    // method — no module reset needed, and the first test in this file is the
    // positive control proving the field IS populated under this same harness.
    // Absence here is therefore a discrimination, not a blind instrument.
    mockState.durablePage = null;

    const result = await runTurnExecutor(
      mkPayload('where does the model stand?'),
      'req-g3-no-authority',
      { routingAdapter: adapterOnce(), graphState: EDITED_GRAPH as never },
    );

    expect(result.scenarioFreshness).toBeUndefined();
    // …and the wire verdict is untouched by the absence.
    expect(result.freshness?.freshness).toBe('none');
  });
});
