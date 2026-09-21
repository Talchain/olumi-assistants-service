/**
 * ⭐⭐ G3 AT THE ROUTE SEAM — THE GUARANTEE'S ONLY APPLICATION SITE, DRIVEN.
 *
 * ⚠ WHY THIS FILE EXISTS, and it is not a duplicate of the wire spec.
 *
 * The G3 change has three parts: a PRODUCER (`turn-executor.ts` surfaces
 * `scenarioFreshness`), a CONSUMER (`response-finaliser.ts` reads
 * `analysisStateFreshness` / `analysisStateCanonical`), and a CONNECTOR — the
 * ~30 lines at `orchestrator/route-v2.ts` that forward the producer's field onto
 * the finaliser context and attach the resolved supersession to it.
 *
 * The producer is pinned end-to-end (`turn-executor-scenario-freshness-authority`
 * genuinely calls `runTurnExecutor`). The consumer is pinned directly
 * (`g3-scenario-freshness-wire` drives `finaliseV5Response`). But that file says
 * of itself, verbatim: *"`superseded: true` adds exactly the two members the
 * route seam attaches"* — it HAND-ATTACHES them. So the connector was
 * SIMULATED, and an adversarial review measured the consequence by execution:
 * deleting the entire user-facing fix at the route left **202 tests green,
 * including all 29 of the change's own**. CLAUDE.md trap 11 — *never merge a fix
 * until reverting it turns something RED* — was unmet for the one file the PR
 * body names as where the change is applied.
 *
 * ⭐ AND THE REASON IT SURVIVED SELF-REVIEW, which is the durable lesson: the
 * change's six mutants contain ZERO `route-v2.ts` mutants. A mutation kit that
 * never touches the connector cannot observe a disconnected connector. Every
 * instrument agreed with every other because all of them were pointed at the two
 * ends of a wire nobody tested the middle of (CLAUDE.md trap 3b raised from the
 * component to the seam; trap 16's *a fixture you wrote yourself is not evidence
 * about the wire*).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE ASSERTS, AND ON WHAT.
 *
 * Assertions are on the SERIALISED HTTP BYTES of a real `POST
 * /orchestrate/v2/turn` through `ceeOrchestratorRouteV2`. Nothing here
 * hand-attaches `analysisStateFreshness`, `analysisStateCanonical` or
 * `scenarioFreshness`; nothing here imports or calls
 * `resolveScenarioAnalysisSupersession`. Every one of those must be produced,
 * forwarded and applied by the code under test, or the assertions fail.
 *
 * THE FIXTURE IS THE WHOLE POINT: one turn on which the durable scenario history
 * still holds a saved `run_analysis` fact that the bounded hot window has LOST.
 * That is the state G3 exists for, and it is built by SPLITTING the two store
 * reads — `readFactsFor` (the window) returns no analysis, while
 * `readScenarioRunAnalysisFactsFor` (the durable authority) returns one.
 *
 * ⚠⚠ THE CONTRAST IS AN EMPTY DURABLE PAGE, **NOT** AN ABSENT DURABLE PORT, AND
 * THE DIFFERENCE WAS MEASURED, NOT ASSUMED. Removing the port was the obvious
 * contrast and it is the WRONG one: a probe at the seam showed it flips
 * `analysisAuthorityUnavailable` to `true`, so the route takes the FAIL-CLOSED
 * arm and substitutes `ANALYSIS_AUTHORITY_UNAVAILABLE_FRESHNESS` — the turn
 * never reaches the supersession branch at all. A contrast that lands on a
 * different arm is not a contrast; it would have made these cases look
 * discriminating while comparing two unrelated code paths (trap 13b). The empty
 * page is a SUCCESSFUL read of a scenario with no analysis, which is the state
 * the guarantee must decline on. The fail-closed arm gets its own case below.
 *
 * BINDING BY IDENTITY (trap 19): the superseded state is asserted to carry the
 * saved fact's OWN `computed_at` and `graph_hash_at_run`, never merely "some
 * stale verdict" that another object could satisfy.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const SCENARIO_ID = 'a1b2c3d4-1646-4123-8123-a1b2c3d41646';
const SAVED_COMPUTED_AT = '2026-09-01T09:00:00.000Z';
const SAVED_FACT_ROW_ID = 'cccccccc-1646-4ccc-8ccc-cccccccccccc';

// ---------------------------------------------------------------------------
// Fixtures — graphs and hashes are COMPUTED, never spelled.
// ---------------------------------------------------------------------------

/**
 * The graph as it stood when the saved analysis ran. Shaped to reach readiness
 * `ready` rather than `blocked`: a decision node with an edge to each option
 * (else `NO_DECISION`), and every factor carrying an intervention value on both
 * options (else `MISSING_OPTION_VALUE`). Both were measured, not guessed — a
 * `blocked` readiness makes `run_state.kind` `'blocked'`, which would mask the
 * `never_run` / `complete_stale` distinction this whole file is about.
 */
const ANALYSED_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'dec_growth', kind: 'decision', label: 'Growth approach' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    {
      id: 'opt_hire',
      kind: 'option',
      label: 'Hire Marketing Manager',
      interventions: { fac_capacity: 1 },
    },
    {
      id: 'opt_hold',
      kind: 'option',
      label: 'Hold',
      is_baseline: true,
      interventions: { fac_capacity: 0 },
    },
  ],
  edges: [
    {
      from: 'dec_growth',
      to: 'opt_hire',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'dec_growth',
      to: 'opt_hold',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_hire',
      to: 'fac_capacity',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_hold',
      to: 'fac_capacity',
      strength: { mean: 0.1, std: 0.05 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
      to: 'goal_growth',
      strength: { mean: 0.8, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_growth',
};
const ANALYSED_GRAPH_HASH = computeAnalysisAffectingGraphHash(ANALYSED_GRAPH as never)!;

/** The graph as it stands now — an edge strength was edited since the run. */
const EDITED_GRAPH = {
  ...ANALYSED_GRAPH,
  edges: [
    ANALYSED_GRAPH.edges[0]!,
    ANALYSED_GRAPH.edges[1]!,
    { ...ANALYSED_GRAPH.edges[2]!, strength: { mean: 0.55, std: 0.1 } },
    ANALYSED_GRAPH.edges[3]!,
    ANALYSED_GRAPH.edges[4]!,
  ],
};
const EDITED_GRAPH_HASH = computeAnalysisAffectingGraphHash(EDITED_GRAPH as never)!;

/** The saved analysis the durable history still holds. */
function savedRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'The analysis that has rolled out of the hot window',
      graph_hash_at_run: ANALYSED_GRAPH_HASH,
      computed_at: SAVED_COMPUTED_AT,
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
    },
  };
}

/**
 * The hot window on the turn under test. Deliberately NON-EMPTY and deliberately
 * NOT a `run_analysis`: an empty window is indistinguishable from "no facts were
 * threaded", so it would not show that the wire verdict is `none` BECAUSE the
 * analysis is missing rather than because nothing was read.
 */
const HOT_WINDOW_EDIT_FACT = {
  fact_type: 'edit_graph',
  fact_version: 1,
  noop: false,
  result: { scenario_id: SCENARIO_ID, applied: true },
};

const PRIOR_TURN_ROW_ID = 'bbbbbbbb-1646-4bbb-8bbb-bbbbbbbbbbbb';
const PRIOR_TURN = {
  id: PRIOR_TURN_ROW_ID,
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
  user_message: 'Nudge that edge down a little',
  assistant_message: 'Done.',
};

// ── Mutable fixture state, set per case ────────────────────────────────────

/** The DURABLE scenario-wide `run_analysis` page the store returns. */
let durablePage: { total_count: number; facts: Array<Record<string, unknown>> } =
  { total_count: 0, facts: [] };
/** Make the scenario-scoped durable read THROW — the fail-closed arm. */
let scenarioReadFails = false;

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
 * A SUCCESSFUL read of a scenario that has genuinely never been analysed. This
 * is the contrast arm — see the header: an absent port is a different branch.
 */
function durablePageWithNoAnalysis() {
  return { total_count: 0, facts: [] as Array<Record<string, unknown>> };
}

function makeStore(): Record<string, unknown> {
  return {
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit: number = 20) => [PRIOR_TURN].slice(0, limit),
    countTurns: async () => 1,
    // ⭐ THE SPLIT, half one: the hot window holds NO `run_analysis` fact.
    readFactsFor: async () => [HOT_WINDOW_EDIT_FACT],
    readFactsWithTurnFor: async () => [
      {
        fact: HOT_WINDOW_EDIT_FACT,
        turn_id: PRIOR_TURN_ROW_ID,
        fact_row_id: `${PRIOR_TURN_ROW_ID}-edit-fact-0`,
        fact_created_at: PRIOR_TURN.created_at,
      },
    ],
    // ⭐ THE SPLIT, half two: the DURABLE authority does.
    readScenarioRunAnalysisFactsFor: async (_scenarioId: string, limit: number) => {
      if (scenarioReadFails) throw new Error('simulated durable scenario read failure');
      return { total_count: durablePage.total_count, facts: durablePage.facts.slice(0, limit) };
    },
    loadGraph: async () => EDITED_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: EDITED_GRAPH, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => makeStore(),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

/**
 * `importOriginal`-spread rather than a hand-listed factory (CLAUDE.md trap 12):
 * a `vi.mock` factory REPLACES the module, so listing only the export this file
 * stubs would silently blank every other one.
 */
vi.mock('../decision-records/index.js', async () => {
  const actual = await vi.importActual<typeof import('../decision-records/index.js')>(
    '../decision-records/index.js',
  );
  return {
    ...actual,
    getDecisionRecordStore: () => ({
      createRecord: async () => ({ record_id: 'unused', deduped: false }),
      retrieveRecords: async () => ({ records: [], totalCount: 0 }),
    }),
  };
});

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

function converseTextOnly(text: string) {
  return {
    type: 'text_only' as const,
    text,
    inferredIntent: 'converse',
    llmCallCount: 1,
    droppedActions: [],
    orientationText: '',
    rawResult: {
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'mock',
      latencyMs: 0,
    },
  };
}

// Dynamic, NOT a static top-level import: `route-v2.js` pulls in
// `turn-executor.js`, which imports the module mocked above. A static import
// here evaluates that graph before the `vi.mock` factory's closure variable is
// initialised.
const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

// ---------------------------------------------------------------------------

async function postTurn(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message: 'Where does this leave things?',
      turn_class: 'clarify',
      source: 'composer',
      graph_state: EDITED_GRAPH,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function runStateOf(body: Record<string, any>): Record<string, any> {
  expect(body.analysis_state, 'analysis_state must be present on this exit').toBeDefined();
  return body.analysis_state.run_state as Record<string, any>;
}

describe('G3 at the ROUTE SEAM — the guarantee, through the real connector', () => {
  let app: FastifyInstance;
  let priorTraceFlag: string | undefined;

  beforeAll(async () => {
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
  });

  beforeEach(() => {
    setTestSink(() => undefined);
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly('Here is where the model stands.'));
    durablePage = durablePageWithSavedAnalysis();
    scenarioReadFails = false;
  });

  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── INSTRUMENT CHECKS FIRST ──────────────────────────────────────────────

  describe('instrument', () => {
    it('FIXTURE SANITY: the graph has genuinely moved since the saved run', () => {
      // Without this the `complete_stale` assertions below could be satisfied by
      // a `fresh` verdict mislabelled, and the suite would still look healthy.
      expect(EDITED_GRAPH_HASH).not.toBe(ANALYSED_GRAPH_HASH);
    });

    it('the turn really reaches the turn_executor exit, the ONE exit that carries this field', async () => {
      // `run.scenarioFreshness` is forwarded on exactly one `sendFinalised200`
      // call site. A routing change that moved this message to a different exit
      // family would make every assertion below vacuous while staying green.
      const { status, body } = await postTurn(app);
      expect(status).toBe(200);
      expect(
        routeWithToolUseMock,
        'the router must have run — if it did not, this case returned at an intercept and reached the wrong exit',
      ).toHaveBeenCalled();
      expect(body.analysis_state, 'analysis_state must be on the wire, or every assertion is vacuous').toBeDefined();
    });

    it('the turn is READY, not blocked — or `run_state.kind` reports readiness instead of the run', async () => {
      // `composeRunState` gates on `canonical.status === 'blocked'` before it
      // ever looks at freshness, so a blocked fixture answers `'blocked'` in
      // BOTH arms and the contrast below would agree for the wrong reason.
      const { body } = await postTurn(app);
      expect(body.analysis_state.readiness?.status).toBe('ready');
    });
  });

  // ── ⭐ THE GUARANTEE ─────────────────────────────────────────────────────

  describe('a saved analysis the hot window has lost', () => {
    it('⭐ THE PIN: the wire reports it as an EARLIER REVISION, not "never run" — through the real seam', async () => {
      const { body } = await postTurn(app);
      const run = runStateOf(body);

      expect(
        run.kind,
        'the durable history holds this analysis; `never_run` is the product telling the user it was never run',
      ).toBe('complete_stale');
      // BOUND BY IDENTITY (trap 19): the state names the SAVED run's own
      // timestamp, so this cannot pass on some other object that merely happens
      // to be stale.
      expect(run.computed_at).toBe(SAVED_COMPUTED_AT);
      expect(run.cause).toBe('graph_changed');
      expect(run.kind).not.toBe('never_run');
    });

    it('⭐ CONTRAST: a scenario that genuinely HAS no saved analysis still says `never_run`', async () => {
      // The durable read SUCCEEDS and returns an empty page. Only the fact
      // changes; the code path is identical. This is what makes the case above
      // a discrimination rather than a guard agreeing with itself, and it is
      // also the one-way rule holding: the durable set may correct a `none`, it
      // may never invent an analysis.
      durablePage = durablePageWithNoAnalysis();
      const { body } = await postTurn(app);
      expect(runStateOf(body).kind).toBe('never_run');
    });

    it('…and it is NOT reported as a failed read — the two stay distinguishable at the wire', async () => {
      const { body } = await postTurn(app);
      const run = runStateOf(body);
      expect(run.kind).not.toBe('unknown_degraded');
      expect(run.cause).not.toBe('store_unreadable');
    });

    it('`analysis_ready` carries the durable verdict and the saved run\'s own hash', async () => {
      const { body } = await postTurn(app);
      expect(body.analysis_ready, 'analysis_ready must be stamped on this turn').toBeDefined();
      expect(body.analysis_ready.freshness).toBe('stale');
      expect(body.analysis_ready.freshness_reason).toBe('graph_hash_diverged');
      expect(body.analysis_ready.graph_hash_at_run).toBe(ANALYSED_GRAPH_HASH);
      expect(body.analysis_ready.computed_at).toBe(SAVED_COMPUTED_AT);
    });

    it('CONTRAST: with no saved analysis `analysis_ready` ships `none` and no run hash at all', async () => {
      durablePage = durablePageWithNoAnalysis();
      const { body } = await postTurn(app);
      expect(body.analysis_ready?.freshness).toBe('none');
      expect(body.analysis_ready?.graph_hash_at_run).toBeUndefined();
    });
  });

  // ── THE READERS THAT MUST NOT MOVE ───────────────────────────────────────

  describe('the additive contract, measured on the wire', () => {
    it('the authoritative top-level `graph_hash` still describes the CURRENT graph, not the analysed one', async () => {
      // The seam is ADDITIVE and must never overwrite `ctx.freshness`. An
      // implementation that "simplified" it by doing so would rewrite this
      // stamp on exactly the edit turns G3 is about.
      const { body } = await postTurn(app);
      expect(body.graph_hash).toBe(EDITED_GRAPH_HASH);
      expect(body.graph_hash).not.toBe(ANALYSED_GRAPH_HASH);
    });

    it('…and it is byte-identical to the same turn with no saved analysis', async () => {
      const superseded = await postTurn(app);
      durablePage = durablePageWithNoAnalysis();
      const plain = await postTurn(app);
      expect(superseded.body.graph_hash).toBe(plain.body.graph_hash);
    });
  });

  // ── THE FAIL-CLOSED TWIN THIS SEAM SITS BESIDE ───────────────────────────

  describe('the unavailable-authority arm', () => {
    it('MUTUAL EXCLUSION, MEASURED: a FAILED durable read is fail-closed, and carries no durable verdict to adopt', async () => {
      // ⚠ The seam guards the supersession behind `analysisAuthorityUnavailable`.
      // That guard is belt-and-braces, and this case is the measurement that
      // says so rather than the docstring asserting it: ONE store read feeds
      // both the claim-safety scope and the reasoning authority, so a failure
      // sets `fail_closed_unavailable` AND withholds the durable verdict on the
      // same turn. The two inputs cannot be set independently through any
      // route-reachable fixture — which is exactly why a mutant that DROPS the
      // guard cannot be killed, and why that survivor is equivalence rather
      // than a hole. The day they decouple, this case is where it shows up.
      scenarioReadFails = true;
      const { status, body } = await postTurn(app);
      expect(status).toBe(200);
      expect(body._diagnostic_trace?.claim_safety?.verdict_provenance).toBe(
        'fail_closed_unavailable',
      );
      // …and on that same turn the durable verdict does NOT reach the wire.
      expect(runStateOf(body).kind).not.toBe('complete_stale');
    });
  });
});
