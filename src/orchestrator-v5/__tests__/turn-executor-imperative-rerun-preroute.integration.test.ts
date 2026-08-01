/**
 * ROADMAP 2.229 fix 4 — the imperative RE-RUN pre-route, at the path level.
 *
 * THE DEFECT. Every `rerun_question` pattern in `analytical-intent.ts` is
 * INTERROGATIVE ("do I need to re-run", "should I re-run", "is this still
 * stale"). There was no imperative form, so a direct instruction — the walk's
 * exact sentence, "Please run the analysis again on this same model." —
 * classified as `null`, carried no mutation signal, fell through every
 * deterministic guard, and was handed to the LLM router, which is
 * nondeterministic between `run_analysis` and a mutation handler. That is the
 * intermittency the walk recorded: sometimes honoured, sometimes read as an
 * edit (diagnosis 2.229 §8, anomaly 4).
 *
 * WHY A PRE-ROUTE AND NOT A CLASSIFIER PATTERN. The diagnosis flagged an
 * ORDERING HAZARD: adding an imperative to `INTENT_PATTERNS` would have made
 * the sentence match `classifyAnalyticalIntent`, be claimed by the
 * fresh-analysis follow-up guard, and answered with that guard's frozen recap
 * — converting an intermittent misroute into a CONSISTENT refusal to re-run.
 * The guard is retired in this same change, so that specific hazard is gone;
 * the pre-route shape is chosen anyway because it is the only one that makes
 * the route DETERMINISTIC. Adding a classifier pattern would leave the turn
 * falling through to the same nondeterministic LLM call it falls through to
 * today — it would recognise the sentence without changing where it goes.
 *
 * THE FALL-THROUGH CONTRACT (#634). The pre-route synthesises a proposal only
 * when it can do so safely: no mutation signal, an option node present in the
 * graph, and `run_analysis` executable in the ACTIVE registries. If any of
 * those fails it emits an observable `fell_through` event and leaves
 * `routingResult` undefined, so the turn behaves exactly as it does today.
 * Worst case is the status quo, never a new failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import type { RunTurnExecutorOptions } from '../turn-executor.js';

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
    storeDraftGraph: async () => undefined,
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

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/**
 * The routing adapter is the seam the LLM would be reached through. On a
 * successful pre-route it must never be touched — that is the determinism
 * claim. It answers rather than throwing so the NEGATIVE controls (which are
 * SUPPOSED to reach it) complete normally and can be asserted on the same
 * harness.
 */
function recordingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Routed answer.' }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock-routing',
        latencyMs: 0,
      })),
  };
}

/**
 * A stub `run_analysis` handler + its validation declaration. The real handler
 * needs a PLoT client and a scenario reader; what this file is proving is the
 * ROUTE, not the compute, so the handler is stubbed and the assertion is that
 * it was invoked with the synthesised proposal.
 */
const runAnalysisInvocations: Array<Record<string, unknown>> = [];

function stubRegistries(): Pick<
  RunTurnExecutorOptions,
  'validationRegistry' | 'handlerRegistry'
> {
  const validationRegistry = {
    run_analysis: {
      handler_id: 'run_analysis',
      accepted_entity_kinds: ['option', 'goal'],
      preconditions: () => ({ ok: true as const }),
      confirmation_template: 'Ran analysis on your current scenario.',
    },
  } as unknown as RunTurnExecutorOptions['validationRegistry'];

  const handlerRegistry = new Map([
    [
      'run_analysis',
      async (invocation: Record<string, unknown>) => {
        runAnalysisInvocations.push(invocation);
        return {
          assistant_text: 'Ran analysis on your current scenario.',
          handler_facts: [],
          llm_calls_used: 0,
        };
      },
    ],
  ]) as unknown as RunTurnExecutorOptions['handlerRegistry'];

  return { validationRegistry, handlerRegistry };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function preRouteEvents(): Event[] {
  return events.filter((e) => e.event === 'v5.run_analysis.imperative_pre_route');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ROADMAP 2.229 fix 4 — imperative re-run pre-route', () => {
  beforeEach(() => {
    events = [];
    runAnalysisInvocations.length = 0;
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeFreshRunAnalysisFact()];
    mockState.persistedGraph = READY_GRAPH;
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it("the walk's exact sentence routes DETERMINISTICALLY to run_analysis, with no LLM call", async () => {
    const adapter = recordingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('Please run the analysis again on this same model.'),
      'req-2229-imperative-rerun',
      { routingAdapter: adapter, graphState: READY_GRAPH as never, ...stubRegistries() },
    );

    // THE GUARANTEE: the LLM is never consulted, so the route cannot vary
    // between `run_analysis` and a mutation handler from one turn to the next.
    expect(
      adapter.chatWithTools,
      'an imperative re-run must not depend on a nondeterministic routing call',
    ).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);

    // It reached the run_analysis HANDLER, not merely "not the LLM".
    expect(runAnalysisInvocations.length).toBe(1);
    expect(result.telemetry.turn_class).toBe('handler');
    // `handler_proposed` is on the observability payload, not the returned
    // telemetry shape, so the handler identity is asserted from the recorded
    // invocation above plus the emitted `turn_executor.completed` event.
    const completed = events.find((e) => e.event === 'turn_executor.completed');
    expect(completed?.data.handler_proposed).toBe('run_analysis');
    expect(result.telemetry.validation_error_code).toBeNull();

    const evt = preRouteEvents();
    expect(evt.length).toBe(1);
    expect(evt[0]!.data.outcome).toBe('routed');
  });

  const OTHER_IMPERATIVES = [
    'Run the analysis again.',
    'Re-run the analysis.',
    'Run it again.',
    'Can you re-run the analysis?',
  ];
  for (const message of OTHER_IMPERATIVES) {
    it(`"${message}" also routes deterministically`, async () => {
      const adapter = recordingRoutingAdapter();
      await runTurnExecutor(mkPayload(message), `req-2229-imp-${randomUUID()}`, {
        routingAdapter: adapter,
        graphState: READY_GRAPH as never,
        ...stubRegistries(),
      });
      expect(adapter.chatWithTools).not.toHaveBeenCalled();
      expect(runAnalysisInvocations.length).toBe(1);
    });
  }

  // -------------------------------------------------------------------------
  // NEGATIVE CONTROLS — the brief's explicit requirement. A graph-edit
  // sentence containing "again" must NOT trip the re-run route, and a QUESTION
  // about re-running must not execute one.
  // -------------------------------------------------------------------------

  it('NEGATIVE CONTROL: a graph edit containing "again" does NOT trip the re-run route', async () => {
    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Set Capacity to 0.7 again.'),
      'req-2229-neg-edit-again',
      { routingAdapter: adapter, graphState: READY_GRAPH as never, ...stubRegistries() },
    );
    // The re-run pre-route must not have claimed the turn. It either never
    // fired (the sentence does not read as an imperative re-run) or it
    // declined — never `routed`.
    for (const e of preRouteEvents()) {
      expect(e.data.outcome, 'a concrete edit must not be routed as a re-run').not.toBe('routed');
    }
    expect(runAnalysisInvocations.length).toBe(0);
  });

  it('NEGATIVE CONTROL: "Add a new risk factor again." does NOT trip the re-run route', async () => {
    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Add a new risk factor again.'),
      'req-2229-neg-add-again',
      { routingAdapter: adapter, graphState: READY_GRAPH as never, ...stubRegistries() },
    );
    for (const e of preRouteEvents()) {
      expect(e.data.outcome).not.toBe('routed');
    }
    expect(runAnalysisInvocations.length).toBe(0);
  });

  it('NEGATIVE CONTROL: "Do I need to re-run the analysis?" is answered, not executed', async () => {
    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Do I need to re-run the analysis?'),
      'req-2229-neg-question',
      { routingAdapter: adapter, graphState: READY_GRAPH as never, ...stubRegistries() },
    );
    for (const e of preRouteEvents()) {
      expect(e.data.outcome, 'a QUESTION about re-running must never execute one').not.toBe(
        'routed',
      );
    }
    expect(runAnalysisInvocations.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // ⚠ #779 REVIEW BLOCKER, at the PATH level. The unit controls prove the
  // recogniser declines; these prove the TURN does not execute. That distinction
  // matters because `run_analysis` is not a no-op — it forwards the graph to
  // PLoT→ISL for real compute, writes a new fact and `graph_hash_at_run`, and
  // REPLACES the user's existing result. A unit-level `false` with a wired
  // pre-route that still dispatched would be exactly the guarantee-theatre this
  // estate keeps paying for.
  // -------------------------------------------------------------------------
  const MUST_NEVER_EXECUTE: ReadonlyArray<readonly [string, string]> = [
    ['Do not re-run the analysis.', 'the user explicitly REFUSING — the strongest possible signal'],
    ["Don't re-run it.", 'contracted refusal'],
    ['Never re-run this automatically.', 'standing refusal'],
    ['I do not want to re-run anything.', 'refusal, first person'],
    ['What changed in the re-run?', 'canonical what_changed question the run-comparison gate serves'],
    ['Why did the rerun give a different answer?', 'question about a past run'],
    ['Show me the re-run results.', 'a request to SEE, not to compute'],
    ['How long did the rerun take?', 'question about a past run'],
    ['Explain the rerun to me.', 'question about a past run'],
    ['Was the rerun better?', 'question about a past run'],
    // ⚠ SECOND REVIEW PASS — the ATTRIBUTIVE-MODIFIER class. The object-group
    // repair never required `re-?run` to be in VERB position, so "the re-run
    // analysis" (determiner + modifier + noun) still matched, on the very words
    // proving it is not an instruction. All five measured here with real
    // dispatch, `invocations=1`, and all five are NEW relative to `staging` —
    // the pre-route does not exist there — so leaving them would have turned an
    // intermittent LLM misroute into a DETERMINISTIC destruction for this shape.
    ['What did the re-run analysis show?', 'attributive modifier: "the re-run analysis"'],
    ['Tell me about the rerun model.', 'attributive modifier: "the rerun model"'],
    ['Summarise the re-run analysis for me.', 'attributive modifier, imperative host verb'],
    ['Was the re-run analysis different?', 'attributive modifier, interrogative host'],
    ['The rerun scenario looked odd, why?', 'attributive modifier at sentence start'],
    // ⚠ THIRD REVIEW PASS — the lookbehind BLOCKLIST let 21 ordinary sentences
    // through at this exact seam. Replaced by a verb-position ALLOWLIST; the
    // full 21 are pinned at unit level, and the representative span is pinned
    // HERE, at the seam where the destruction would actually happen.
    ['What did your re-run analysis show?', 'possessive the blocklist omitted'],
    ["Paul's rerun analysis looked wrong.", "possessive-'s"],
    ['The failed re-run analysis was misleading.', 'determiner + adjective'],
    ['In the  re-run analysis, capacity was higher.', 'determiner + TWO spaces'],
    ['Which re-run analysis was better?', 'determiner absent from the blocklist'],
    ['Compare the two re-run analyses.', 'quantifier + plural'],
    ['Rerun analyses showed a different leader.', 'bare plural at sentence start'],
    // ⚠ FOURTH REVIEW PASS — the plural rule was one inflection wide: the
    // SINGULAR, one letter different, still executed here with `invocations=1`.
    // Each of these has a LICENSED left context and a bare noun after it — the
    // gap a left-context allowlist structurally cannot see.
    ['Rerun analysis showed a different leader.', 'bare SINGULAR at sentence start'],
    ['Rerun model was stale.', 'bare singular, different noun'],
    ['Results were mixed. Rerun analysis disagreed.', 'licensed context: sentence start'],
    ['As noted, rerun analysis was inconclusive.', 'licensed context: comma'],
    ['According to rerun analysis, capacity was higher.', 'licensed context: "to"'],
    ['Right now rerun analysis is queued.', 'licensed context: "now"'],
    ['Both the baseline and rerun analysis showed the same leader.', 'licensed context: "and"'],
  ];
  for (const [message, why] of MUST_NEVER_EXECUTE) {
    it(`NEVER executes an analysis for "${message}" (${why})`, async () => {
      const adapter = recordingRoutingAdapter();
      await runTurnExecutor(mkPayload(message), `req-2229-blocker-${randomUUID()}`, {
        routingAdapter: adapter,
        graphState: READY_GRAPH as never,
        ...stubRegistries(),
      });
      expect(
        runAnalysisInvocations.length,
        'this sentence must never reach the run_analysis handler — it would ' +
          'destroy the user\'s existing result',
      ).toBe(0);
      for (const e of preRouteEvents()) {
        expect(e.data.outcome).not.toBe('routed');
      }
    });
  }

  it('FALL-THROUGH CONTRACT: no option node in the graph → the turn behaves exactly as before', async () => {
    // The `run_analysis` precondition is "at least one option node exists".
    // With none, synthesising a proposal would produce a PRECONDITION_UNMET
    // rejection — worse than today's behaviour. The pre-route declines, the
    // decline is OBSERVABLE, and the turn reaches the LLM as it does now.
    const optionlessGraph = {
      ...READY_GRAPH,
      nodes: READY_GRAPH.nodes.filter((n) => n.kind !== 'option'),
      edges: [],
    };
    mockState.persistedGraph = optionlessGraph;
    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Please run the analysis again.'),
      'req-2229-fallthrough-no-options',
      { routingAdapter: adapter, graphState: optionlessGraph as never, ...stubRegistries() },
    );
    const evt = preRouteEvents();
    expect(evt.length).toBe(1);
    expect(evt[0]!.data.outcome).toBe('fell_through');
    expect(evt[0]!.data.reason).toBe('no_option_target');
    expect(runAnalysisInvocations.length).toBe(0);
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });
});
