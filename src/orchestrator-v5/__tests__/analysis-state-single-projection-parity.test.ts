/**
 * ONE SET OF PERSISTED RUN FACTS — DO THE THREE SERVED CONSUMERS PRESENT ONE ANALYSIS STATE?
 *
 * The three consumers, each driven through its REAL production code, over ONE fake session store
 * (the only thing faked, plus the routing LLM call and two other I/O boundaries):
 *
 *   1. READ ROUTE   `readScenarioAnalysis` (routes/scenario-graph-analysis-read.ts). The UI reload reads it, and so
 *                   does the Agent (`earlierAnalysisOf(g.analysis_state)`, agent-lane/runtime/agent-capabilities.ts).
 *                   Durable facts; `mayPresentLeaderClaimForFact` on the selected fresh fact.
 *   2. TURN PAYLOAD `analysis_state` on a real `/orchestrate/v2/turn` 200 (route-v2 → TurnExecutor → sendFinalised200
 *                   → resolveScenarioAnalysisSupersession → finaliseV5Response). Hot-window canonical state,
 *                   turn-entry leader entitlement (`readMayNameLeadingOptionVerdict` → the claim-bearing selector).
 *   3. CONTEXT PACK the pack TurnExecutor hands the routing model (captured as `routeWithToolUse`'s first argument):
 *                   `display_analysis` + `coaching_context` from the durable facts, `analysis` from the hot window,
 *                   leader gate from the same turn-entry entitlement.
 *
 * WHAT EACH CONSUMER EXPOSES, and therefore what is compared (nothing is compared that a consumer does not expose):
 *   - read route + turn payload: `run_state.kind`, `run_state.computed_at`, `leader_claim.permitted`,
 *     `leader_claim.withheld_reason`, `requires_rerun`.
 *   - context pack: NO computed_at (coaching_context is timestamp/hash-free by design; display_analysis carries none)
 *     and NO withheld-reason CODE (only a note's prose). It exposes `coaching_context.freshness` (compared against the
 *     freshness each run_state.kind implies), `coaching_context.rerun_required`, leader permission as
 *     `display_analysis.leading_option` present with no `leading_option_note`, and whether an analysis is present in
 *     `display_analysis` (durable, model-facing) and in `analysis` (hot window, handler-facing).
 *
 * RED IS THE FINDING. A failing case is kept failing; production code is not changed here.
 *
 * No network: the LLM router is mocked, no provider key is set, and `fetch` is stubbed to record and refuse.
 * No server: Fastify `inject` never binds a socket.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { ContextPack } from '../context/context-pack-assembler.js';

// ── The one fake store every consumer reads ────────────────────────────────
interface TurnRow {
  readonly id: string;
  readonly scenario_id: string;
  readonly user_id: null;
  readonly turn_id: string;
  readonly turn_class: string;
  readonly handler_id: string | null;
  readonly request_hash: string;
  readonly response_emitted: boolean;
  readonly llm_calls_used: number;
  readonly duration_ms: number;
  readonly created_at: string;
  readonly user_message: string;
  readonly assistant_message: string;
}
interface StoredTurn {
  readonly row: TurnRow;
  /** At most one fact per turn, so the hot-window and durable row ids line up by construction. */
  readonly fact: HandlerFact | null;
}

const fixture = vi.hoisted(() => ({
  /** Newest first, as the real `readRecent` returns them. */
  turns: [] as Array<{ row: Record<string, unknown>; fact: Record<string, unknown> | null }>,
  persistedGraph: null as unknown,
  windowSize: 20,
  durableReads: 0,
}));
const { routeWithToolUseMock, fetchGuard } = vi.hoisted(() => ({
  routeWithToolUseMock: vi.fn(),
  fetchGuard: vi.fn(async () => {
    throw new Error('network is not allowed in this test');
  }),
}));

function factRowId(turnRowId: string): string {
  return `${turnRowId}-fact-0`;
}

vi.mock('../session/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session/index.js')>();
  fixture.windowSize = actual.SESSION_READ_WINDOW_DEFAULT;
  const withIdentity = (ids: readonly string[]) =>
    fixture.turns
      .filter((t) => ids.includes(t.row.id as string) && t.fact !== null)
      .map((t) => ({
        fact: t.fact,
        turn_id: t.row.id,
        fact_row_id: factRowId(t.row.id as string),
        fact_created_at: t.row.created_at,
      }));
  const store = {
    append: async () => ({ id: `row-${randomUUID()}` }),
    // The real store's default window (SESSION_READ_WINDOW_DEFAULT), newest first.
    readRecent: async (_id: string, limit: number = fixture.windowSize) =>
      fixture.turns.slice(0, limit).map((t) => t.row),
    countTurns: async () => fixture.turns.length,
    readFactsFor: async (ids: readonly string[]) => withIdentity(ids).map((entry) => entry.fact),
    readFactsWithTurnFor: async (ids: readonly string[]) => withIdentity(ids),
    // The durable, scenario-scoped exact-count page: every run fact whatever its age, newest first.
    readScenarioRunAnalysisFactsFor: async (_id: string, limit: number) => {
      fixture.durableReads += 1;
      const facts = fixture.turns
        .filter((t) => t.fact !== null && t.fact.fact_type === 'run_analysis' && t.fact.noop === false)
        .map((t) => ({ fact: t.fact, fact_row_id: factRowId(t.row.id as string), fact_created_at: t.row.created_at }));
      return { facts: facts.slice(0, limit), total_count: facts.length };
    },
    readAnalysisInvalidatedAt: async () => null,
    readNewestAnalysisFactFor: async () => {
      throw new Error('retired newest-analysis query was called');
    },
    loadGraph: async () => fixture.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: fixture.persistedGraph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  };
  return { ...actual, getSessionStore: () => store, resetSessionStoreForTests: () => undefined };
});

vi.mock('../decision-records/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../decision-records/index.js')>()),
  getDecisionRecordStore: () => ({
    createRecord: async () => ({ record_id: 'unused', deduped: false }),
    retrieveRecords: async () => ({ records: [], totalCount: 0 }),
  }),
}));

// Case B puts 21 turns in the scenario; the rolling-summary loader then reads a store. Faked, never Supabase.
vi.mock('../rolling-summary/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rolling-summary/index.js')>()),
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
}));

// The routing LLM call. Its first argument IS the ContextPack the model receives.
vi.mock('../routing/route-with-tool-use.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../routing/route-with-tool-use.js')>()),
  routeWithToolUse: routeWithToolUseMock,
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');
const { readScenarioAnalysis } = await import('../../routes/scenario-graph-analysis-read.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
const { deriveDecisionContextGraphHash } = await import('../build-turn-context.js');
const { buildAnalysisRefusalFact } = await import('../context/analysis-refusal-continuity.js');
const { selectRunAnalysisFact, selectClaimBearingRunAnalysisFact } = await import('../context/freshness.js');

// ── Fixtures ────────────────────────────────────────────────────────────────
const SCENARIO_ID = 'c0ffee00-5106-4b21-8b21-5106b21b5106';
const LEADER = 'opt_local';

const edge = (from: string, to: string, mean = 0.4) => ({
  from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
});
/**
 * A model that genuinely CAN run: canonical readiness `ready` (a decision node, two options each with an
 * intervention and a factor edge, the factor connected to the goal). Same shape as the READY control in
 * `context-pack-readiness.route-level.test.ts`. Readiness matters here: `requires_rerun` is offered only when a Run
 * is admitted, so on a blocked model every consumer would agree on `false` vacuously.
 */
const READY_GRAPH = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'How should we staff the new tier' },
    { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
    {
      id: 'factor_salary', kind: 'factor', label: 'Engineer salary in the local market',
      observed_state: { value: 95000, unit: 'GBP', source: 'user_edited' },
    },
    { id: 'opt_local', kind: 'option', label: 'Hire locally', interventions: { factor_salary: { value: 95000 } } },
    { id: 'opt_off', kind: 'option', label: 'Offshore partner', interventions: { factor_salary: { value: 55000 } } },
  ],
  edges: [
    edge('factor_salary', 'goal_rev'),
    edge('opt_local', 'factor_salary'),
    edge('opt_off', 'factor_salary'),
    edge('dec', 'opt_local'),
    edge('dec', 'opt_off'),
  ],
};
/** The same model after the user changed an analysis-affecting value (salary → revenue strength). */
const EDITED_GRAPH = {
  ...READY_GRAPH,
  edges: READY_GRAPH.edges.map((e) =>
    e.from === 'factor_salary' && e.to === 'goal_rev' ? { ...e, strength: { mean: 0.7, std: 0.1 } } : e,
  ),
};

/** The analysis-affecting hash a Run stamps: the canonical projection, then `computeAnalysisAffectingGraphHash`. */
const RUN_HASH = deriveDecisionContextGraphHash(READY_GRAPH)!;
const EDITED_HASH = deriveDecisionContextGraphHash(EDITED_GRAPH)!;

const RUN_AT = '2026-09-27T10:00:00.000Z';
const REFUSED_AT = '2026-09-27T10:30:00.000Z';

function runFact(opts: { computedAt: string; mayName: boolean; state: string }): HandlerFact {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO_ID, computed_at: opts.computedAt, graph_hash_at_run: RUN_HASH,
      leading_option_id: LEADER, summary: 'The analysis is complete.',
      win_probabilities: { opt_local: 0.72, opt_off: 0.28 },
      constraint_verdict: { may_name_leading_option: opts.mayName, constraint_verdict_state: opts.state },
      enrichment: {
        analysis_status: 'completed',
        robustness: { level: 'strong', near_tie: { is_tie: false } },
        option_comparison: [
          { option_id: 'opt_local', option_label: 'Hire locally', win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_off', option_label: 'Offshore partner', win_probability: 0.28, outcome_mean: 0.3 },
        ],
      },
    },
  }) as HandlerFact;
}
const PERMITTED_RUN = () => runFact({ computedAt: RUN_AT, mayName: true, state: 'evaluated_feasible' });

function turnRow(id: string, createdAt: string, handlerId: string | null): TurnRow {
  return {
    id, scenario_id: SCENARIO_ID, user_id: null, turn_id: `turn-${id}`,
    turn_class: handlerId === null ? 'direct_answer' : 'handler', handler_id: handlerId,
    request_hash: `sha256:${id}`, response_emitted: true, llm_calls_used: 1, duration_ms: 100,
    created_at: createdAt,
    user_message: handlerId === null ? 'Tell me more.' : 'Run the analysis',
    assistant_message: handlerId === null ? 'Noted.' : 'Analysis complete.',
  };
}
function runTurn(id: string, fact: HandlerFact): StoredTurn {
  return { row: turnRow(id, (fact.result as { computed_at: string }).computed_at, 'run_analysis'), fact };
}
/** `count` value-op / chat turns NEWER than every run, carrying no analysis. */
function newerChatTurns(count: number): StoredTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    row: turnRow(`chat-${String(i).padStart(2, '0')}`, new Date(Date.parse('2026-09-27T12:00:00.000Z') + (count - i) * 60_000).toISOString(), null),
    fact: null,
  }));
}
function seed(turns: readonly StoredTurn[], graph: unknown): void {
  fixture.turns = turns.map((t) => ({ row: { ...t.row }, fact: t.fact as unknown as Record<string, unknown> | null }));
  fixture.persistedGraph = structuredClone(graph);
}

// ── Observation: one call per consumer, same store, same graph ─────────────
function converseTextOnly(text: string) {
  return {
    type: 'text_only' as const, text, inferredIntent: 'converse', llmCallCount: 1, droppedActions: [], orientationText: '',
    rawResult: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, model: 'mock', latencyMs: 0 },
  };
}

type RunStateKind = 'complete_current' | 'complete_stale' | 'never_run' | 'unknown_degraded' | 'blocked' | 'refused' | 'running';
/** The freshness each run-state kind asserts; the pack exposes freshness, not a kind. */
const FRESHNESS_OF_KIND: Record<string, string> = {
  complete_current: 'fresh', complete_stale: 'stale', never_run: 'none', unknown_degraded: 'unknown',
};

interface StateView {
  readonly kind: RunStateKind | null;
  readonly computed_at: string | null;
  readonly permitted: boolean | null;
  readonly withheld_reason: string | null;
  readonly requires_rerun: boolean | null;
  /** Diagnostic only (not a parity field): shows whether a Run is admitted, which gates `requires_rerun`. */
  readonly readiness_status: string | null;
}
interface PackView {
  readonly freshness: string | null;
  readonly rerun_required: boolean | null;
  readonly analysis_present: boolean | null;
  readonly leader_permitted: boolean;
  readonly leading_option_note: string | null;
  /** Diagnostic only: `display_analysis.analysis_not_current_note` is present (the figures carry a staleness note). */
  readonly not_current_note: boolean;
  readonly display_analysis_present: boolean;
  readonly hot_window_analysis_present: boolean;
}
interface Views {
  readonly read_route: StateView;
  readonly turn_payload: StateView;
  readonly context_pack: PackView;
}

function stateView(state: Record<string, any> | null | undefined): StateView {
  return {
    kind: state?.run_state?.kind ?? null,
    computed_at: state?.run_state?.computed_at ?? null,
    permitted: typeof state?.leader_claim?.permitted === 'boolean' ? state.leader_claim.permitted : null,
    withheld_reason: state?.leader_claim?.withheld_reason ?? null,
    requires_rerun: typeof state?.requires_rerun === 'boolean' ? state.requires_rerun : null,
    readiness_status: state?.readiness?.status ?? null,
  };
}

let app: FastifyInstance;

async function observe(caseId: string, graphState: unknown): Promise<Views> {
  // 1. READ ROUTE — the reload / Agent read.
  const read = await readScenarioAnalysis({ scenarioId: SCENARIO_ID, graph: fixture.persistedGraph, requestId: `parity-read-${caseId}` });

  // 2 + 3. One real turn. The pack is what the router was handed; the payload is the 200 body.
  routeWithToolUseMock.mockReset();
  routeWithToolUseMock.mockResolvedValue(converseTextOnly('Understood. Tell me what you would like to look at next.'));
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO_ID, stage: 'analyse',
      message: 'Where does this leave things?', turn_class: 'clarify', source: 'composer',
      graph_state: graphState,
    },
  });
  expect(res.statusCode, `turn must 200: ${res.body.slice(0, 400)}`).toBe(200);
  const body = JSON.parse(res.body) as Record<string, any>;
  // BRANCH DISCRIMINATOR: the turn reached the router, so the captured pack is the one this turn assembled.
  expect(routeWithToolUseMock, 'the turn must reach the routing model, or there is no ContextPack to read').toHaveBeenCalledTimes(1);
  const pack = routeWithToolUseMock.mock.calls[0]![0] as ContextPack;
  const display = pack.display_analysis as (Record<string, unknown> | null);

  return {
    read_route: stateView(read.analysis_state as Record<string, any> | null),
    turn_payload: stateView(body.analysis_state),
    context_pack: {
      freshness: pack.coaching_context?.freshness ?? null,
      rerun_required: pack.coaching_context?.rerun_required ?? null,
      analysis_present: pack.coaching_context?.analysis_present ?? null,
      leader_permitted: display != null && display.leading_option !== undefined && display.leading_option_note === undefined,
      leading_option_note: typeof display?.leading_option_note === 'string' ? display.leading_option_note : null,
      not_current_note: typeof display?.analysis_not_current_note === 'string',
      display_analysis_present: display != null,
      hot_window_analysis_present: pack.analysis != null,
    },
  };
}

/**
 * Non-vacuity: every consumer must have said SOMETHING non-null, or agreement between them means nothing.
 */
function assertEachConsumerAnswered(v: Views): void {
  expect(v.read_route.kind, 'read route produced no analysis_state').not.toBeNull();
  expect(v.turn_payload.kind, 'turn payload produced no analysis_state').not.toBeNull();
  expect(v.context_pack.freshness, 'context pack carried no coaching_context').not.toBeNull();
}

/**
 * The parity assertions. Soft, so every diverging field of a case is reported, not only the first.
 * Every message carries the full three-way view.
 */
function assertParity(v: Views): void {
  const all = JSON.stringify(v, null, 2);
  const r = v.read_route;
  const t = v.turn_payload;
  const p = v.context_pack;
  expect.soft(t.kind, `run_state.kind: read_route=${r.kind} turn_payload=${t.kind}\n${all}`).toBe(r.kind);
  expect.soft(t.computed_at, `run_state.computed_at: read_route=${r.computed_at} turn_payload=${t.computed_at}\n${all}`).toBe(r.computed_at);
  expect.soft(t.permitted, `leader_claim.permitted: read_route=${r.permitted} turn_payload=${t.permitted}\n${all}`).toBe(r.permitted);
  expect.soft(t.withheld_reason, `leader_claim.withheld_reason: read_route=${r.withheld_reason} turn_payload=${t.withheld_reason}\n${all}`).toBe(r.withheld_reason);
  expect.soft(t.requires_rerun, `requires_rerun: read_route=${r.requires_rerun} turn_payload=${t.requires_rerun}\n${all}`).toBe(r.requires_rerun);
  // The pack against the read route (the pack exposes no computed_at and no withheld-reason code).
  expect.soft(p.freshness, `pack coaching_context.freshness=${p.freshness} vs read_route kind ${r.kind} (⇒ ${FRESHNESS_OF_KIND[r.kind ?? ''] ?? '?'})\n${all}`).toBe(FRESHNESS_OF_KIND[r.kind ?? ''] ?? `<no freshness for ${r.kind}>`);
  expect.soft(p.rerun_required, `pack coaching_context.rerun_required=${p.rerun_required} vs read_route requires_rerun=${r.requires_rerun}\n${all}`).toBe(r.requires_rerun);
  expect.soft(p.leader_permitted, `pack leader permitted (display_analysis.leading_option, no note)=${p.leader_permitted} vs read_route permitted=${r.permitted}\n${all}`).toBe(r.permitted);
  // Is there an analysis at all? The read route says so by a complete_* kind; the pack in three places.
  const readRouteHasAnalysis = r.kind === 'complete_current' || r.kind === 'complete_stale';
  expect.soft(p.analysis_present, `pack coaching_context.analysis_present=${p.analysis_present} vs read_route kind ${r.kind}\n${all}`).toBe(readRouteHasAnalysis);
  expect.soft(p.display_analysis_present, `pack display_analysis present=${p.display_analysis_present} vs read_route kind ${r.kind}\n${all}`).toBe(readRouteHasAnalysis);
  expect.soft(p.hot_window_analysis_present, `pack analysis (hot window) present=${p.hot_window_analysis_present} vs read_route kind ${r.kind}\n${all}`).toBe(readRouteHasAnalysis);
}

describe('one persisted Run, three served consumers: do they present one analysis state?', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchGuard);
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    fetchGuard.mockClear();
    fixture.durableReads = 0;
    // Fixture premises, proven rather than assumed: the stamp is the hash of the canonical projection, which is
    // `computeAnalysisAffectingGraphHash` over the graph as given; and the edit really moves it.
    expect(RUN_HASH).toBe(computeAnalysisAffectingGraphHash(READY_GRAPH as never));
    expect(EDITED_HASH).not.toBe(RUN_HASH);
  });

  it('A. CONTROL — one successful, current, permitted Run in both the hot window and the durable store: all agree', async () => {
    seed([runTurn('run-a', PERMITTED_RUN())], READY_GRAPH);

    const v = await observe('A', READY_GRAPH);

    assertEachConsumerAnswered(v);
    // The control must show all three POPULATED with the Run, not three agreeing blanks.
    expect(v.read_route).toMatchObject({ kind: 'complete_current', computed_at: RUN_AT, permitted: true, readiness_status: 'ready' });
    expect(v.turn_payload).toMatchObject({ kind: 'complete_current', computed_at: RUN_AT, permitted: true });
    expect(v.context_pack).toMatchObject({ freshness: 'fresh', display_analysis_present: true, leader_permitted: true });
    expect(fixture.durableReads, 'the durable port was consulted').toBeGreaterThan(0);
    assertParity(v);
    expect(fetchGuard).not.toHaveBeenCalled();
  });

  it('B. The Run is OLDER than the hot window: the durable store has it, the last-20-turns window does not', async () => {
    const turns = [...newerChatTurns(fixture.windowSize), runTurn('run-b', PERMITTED_RUN())];
    seed(turns, READY_GRAPH);
    // Premise: the window is full of newer turns and holds no run.
    expect(turns.slice(0, fixture.windowSize).some((t) => t.fact !== null)).toBe(false);

    const v = await observe('B', READY_GRAPH);

    assertEachConsumerAnswered(v);
    expect(v.read_route.computed_at, 'the read route must still find the Run').toBe(RUN_AT);
    assertParity(v);
    expect(fetchGuard).not.toHaveBeenCalled();
  });

  it('C. A NEWER REFUSED Run after a successful one: the success is the displayed fact — does every consumer judge the leader on it?', async () => {
    const refused = buildAnalysisRefusalFact({
      scenarioId: SCENARIO_ID, reasonCode: 'mixed_scale_unresolved', graphHash: RUN_HASH, computedAt: REFUSED_AT,
    });
    seed([runTurn('run-c-refused', refused), runTurn('run-c-ok', PERMITTED_RUN())], READY_GRAPH);

    const v = await observe('C', READY_GRAPH);

    assertEachConsumerAnswered(v);
    // The freshness selector skips the refusal, so the displayed Run is the older success.
    expect(v.read_route.computed_at).toBe(RUN_AT);
    // The brief's question, asked of the real selectors over the same facts: does the claim-bearing selector (the one
    // the turn's leader entitlement uses, claim-safety-read.ts) also skip the refusal?
    const facts = fixture.turns.map((t) => t.fact).filter((f) => f !== null) as unknown as HandlerFact[];
    const displayedAt = (selectRunAnalysisFact(facts)?.fact.result as { computed_at?: string } | undefined)?.computed_at ?? null;
    const claimBearingAt = (selectClaimBearingRunAnalysisFact(facts)?.fact.result as { computed_at?: string } | undefined)?.computed_at ?? null;
    expect(displayedAt).toBe(RUN_AT);
    expect.soft(claimBearingAt, `selectClaimBearingRunAnalysisFact picked computed_at=${claimBearingAt}; selectRunAnalysisFact picked ${displayedAt}`).toBe(displayedAt);
    assertParity(v);
    expect(fetchGuard).not.toHaveBeenCalled();
  });

  it('C2. #730\'s SHADOW CASE — a newer PARTIAL Run that WITHHELD the leader, after an older permitted success: a partial Run makes claims, so every consumer withholds, for the same reason', async () => {
    const partial = RunAnalysisHandlerFactSchema.parse({
      ...(runFact({ computedAt: REFUSED_AT, mayName: false, state: 'evaluated_infeasible' }) as unknown as Record<string, unknown>),
    }) as unknown as { result: { enrichment: Record<string, unknown> } };
    partial.result.enrichment.analysis_status = 'partial';
    seed([runTurn('run-c2-partial', partial as unknown as HandlerFact), runTurn('run-c2-ok', PERMITTED_RUN())], READY_GRAPH);

    const v = await observe('C2', READY_GRAPH);

    assertEachConsumerAnswered(v);
    // The claim-bearing selector keeps the partial Run (it is not the refusal marker).
    const facts = fixture.turns.map((t) => t.fact).filter((f) => f !== null) as unknown as HandlerFact[];
    const claimBearingAt = (selectClaimBearingRunAnalysisFact(facts)?.fact.result as { computed_at?: string } | undefined)?.computed_at ?? null;
    expect(claimBearingAt).toBe(REFUSED_AT);
    expect(v.read_route.permitted, 'a newer claim that withheld the leader is never overridden by an older permitted one').toBe(false);
    assertParity(v);
    expect(fetchGuard).not.toHaveBeenCalled();
  });

  it('D. A WITHHELD leader on a fresh Run (constraint_verdict_withheld; Paul 5106b21b): all withhold, for the same reason', async () => {
    seed([runTurn('run-d', runFact({ computedAt: RUN_AT, mayName: false, state: 'evaluated_infeasible' }))], READY_GRAPH);

    const v = await observe('D', READY_GRAPH);

    assertEachConsumerAnswered(v);
    // The served read-route shape Paul saw.
    expect(v.read_route).toMatchObject({ kind: 'complete_current', permitted: false, withheld_reason: 'constraint_verdict_withheld' });
    assertParity(v);
    expect(fetchGuard).not.toHaveBeenCalled();
  });

  it('E. The graph was EDITED after the Run: all say stale, and requires_rerun, the same way', async () => {
    seed([runTurn('run-e', PERMITTED_RUN())], EDITED_GRAPH);

    const v = await observe('E', EDITED_GRAPH);

    assertEachConsumerAnswered(v);
    expect(v.read_route.kind).toBe('complete_stale');
    assertParity(v);
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});
