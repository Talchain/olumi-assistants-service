/**
 * THE EDIT REPLY MUST NOT FORGET AN ANALYSIS WHOSE TURN HAS AGED OUT OF THE WINDOW.
 *
 * `dispatchFactorValueEdit` derives the reply's `analysis_ready.freshness` from
 * prior facts. It read them through the `readRecent` window ALONE
 * (SESSION_READ_WINDOW_DEFAULT = 20 rows). Every value op and every Agent turn
 * is a row, so once the scenario's run_analysis turn aged out of the newest 20,
 * a committed value edit that had just invalidated the analysis answered
 * `none / no_successful_run_analysis_fact` instead of `stale`, and the UI showed
 * no stale mark: a stale analysis presented as current.
 *
 * #1843 fixed the RELOAD leg (`routes/scenario-graph-analysis-read.ts`); this
 * pins the EDIT-REPLY leg at the route, through the real `route-v2` →
 * `dispatchSystemEvent` → `commitDirectAnswer` path.
 *
 * The store fake behaves like the real store on BOTH ports: `readRecent` returns
 * only the newest window rows, `readFactsFor` / `readFactsWithTurnFor` return
 * only the facts of the rows asked for, and `readScenarioRunAnalysisFactsFor`
 * (the durable, scenario-scoped port) returns the scenario's run facts
 * newest-first with an exact pre-limit count, whatever their age.
 *
 * Every verdict is bound by IDENTITY, not by a value another object could
 * satisfy: the derivation's `graph_hash_at_run` and `computed_at` are the seeded
 * run's own, and its `current_graph_hash` is the hash the commit persisted
 * (the reply's own `graph_hash`).
 *
 *   CONTRAST     run inside the window  → stale. Green before and after.
 *   DEFECT       run outside the window → stale. RED before the fix (`none`).
 *   FRESH ARM    run outside the window, edit back to the analysed value → fresh.
 *   NEVER-RUN    no run anywhere → none (the honest answer stays).
 *   DEGRADED     the durable read fails: the reload route's own rule applies.
 *   NO PROVIDER  the LLM adapter and `fetch` are never called.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import type { FreshnessDerivation } from '../../../src/orchestrator-v5/context/freshness.js';

// ── the persisted model (same shape as route-v2-factor-value-edit.test.ts) ──
function buildPersistedGraph(): Record<string, unknown> {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

// ── a store fake that behaves like the real store on BOTH fact ports ────────
interface StoredFact {
  readonly fact: HandlerFact;
  readonly fact_row_id: string;
  readonly fact_created_at: string;
}
interface StoredRow {
  readonly id: string;
  readonly turn_id: string;
  readonly created_at: string;
  readonly facts: readonly StoredFact[];
}

const storeState: {
  /** Newest-first, exactly as the real store orders `readRecent`. */
  rows: StoredRow[];
  durableFails: boolean;
  recentFails: boolean;
} = { rows: [], durableFails: false, recentFails: false };

let windowSize = 20; // replaced in beforeAll by the REAL SESSION_READ_WINDOW_DEFAULT
let persisted: unknown = buildPersistedGraph();
const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const readRecentSpy = vi.fn();
const readScenarioRunAnalysisFactsForSpy = vi.fn();

function factsOfRows(ids: readonly string[]): Array<StoredFact & { turn_id: string }> {
  const wanted = new Set(ids);
  return storeState.rows
    .filter((row) => wanted.has(row.id))
    .flatMap((row) => row.facts.map((entry) => ({ ...entry, turn_id: row.id })));
}

const fakeStore = {
  append: appendMock,
  readRecent: async (scenarioId: string, limit?: number) => {
    readRecentSpy(scenarioId, limit);
    if (storeState.recentFails) throw new Error('readRecent unavailable (test)');
    return storeState.rows.slice(0, limit ?? windowSize).map((row) => ({
      id: row.id,
      turn_id: row.turn_id,
      scenario_id: SCENARIO_ID,
      turn_class: 'handler',
      handler_id: null,
      created_at: row.created_at,
    }));
  },
  readFactsFor: async (ids: readonly string[]) => factsOfRows(ids).map((entry) => entry.fact),
  readFactsWithTurnFor: async (ids: readonly string[]) => factsOfRows(ids),
  readScenarioRunAnalysisFactsFor: async (scenarioId: string, limit: number) => {
    readScenarioRunAnalysisFactsForSpy(scenarioId, limit);
    if (storeState.durableFails) throw new Error('durable analysis-fact read unavailable (test)');
    // Scenario-scoped and NOT window-bounded: every run fact, whatever its age.
    const all = storeState.rows
      .flatMap((row) => row.facts)
      .filter((entry) => entry.fact.fact_type === 'run_analysis');
    return {
      facts: all.slice(0, limit).map(({ fact, fact_row_id, fact_created_at }) => ({
        fact,
        fact_row_id,
        fact_created_at,
      })),
      total_count: all.length,
    };
  },
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
};

// Partial mock: the REAL `SESSION_READ_WINDOW_DEFAULT` (and every other export)
// flows through, so the premise below is the production window, not a copy.
vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>()),
  getSessionStore: () => fakeStore,
}));

// The one generative seam on this route. Asserted uncalled in every case.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

// The commit seam fires the (Anthropic) rolling summariser after every commit.
// It is replaced outright so this file can never reach a provider through it.
const rollingSummaryMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/orchestrator-v5/rolling-summary/capture.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/rolling-summary/capture.js')>()),
  maintainRollingSummaryForCommit: rollingSummaryMock,
}));

// Capture the dispatch's OWN derivation (spread + wrap: the real emitter still runs).
const freshnessEmits: Array<{ derivation: FreshnessDerivation; dispatchPath: string }> = [];
vi.mock('../../../src/orchestrator-v5/context/freshness.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/orchestrator-v5/context/freshness.js')>();
  return {
    ...real,
    emitFreshnessTelemetry: (
      derivation: FreshnessDerivation,
      ctx: { dispatch_path: string },
      ...rest: unknown[]
    ) => {
      freshnessEmits.push({ derivation, dispatchPath: ctx.dispatch_path });
      return (real.emitFreshnessTelemetry as (...a: unknown[]) => unknown)(derivation, ctx, ...rest);
    },
  };
});

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { SESSION_READ_WINDOW_DEFAULT } = await import('../../../src/orchestrator-v5/session/index.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID_BASE = '44444444-4444-4444-8444-44444444444';
const RUN_ROW_ID = 'row-run-analysis';
const RUN_FACT_ROW_ID = 'fact-row-run-analysis';
const RUN_AT = '2026-09-24T09:00:00.000Z';

/** The value the user types: £50,000 against the £100,000 cap. */
const EDIT = { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' };

/** `suffix` is ONE hex character: it completes the turn id's last UUID group. */
function payloadFor(suffix: string) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event: EDIT,
  };
}

/** One successful run, stamped with the hash of the graph it analysed. */
function runFact(graphHashAtRun: string): HandlerFact {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      computed_at: RUN_AT,
      graph_hash_at_run: graphHashAtRun,
      leading_option_id: 'o-launch',
      summary: 'Launch now leads on the analysed model.',
      win_probabilities: { 'o-launch': 1 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: { analysis_status: 'completed', robustness: { level: 'strong', near_tie: { is_tie: false } } },
    },
  }) as HandlerFact;
}

/** Newer rows that carry no analysis — value ops and Agent turns. Newest first. */
function newerRows(count: number): StoredRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-newer-${count - 1 - i}`,
    turn_id: `turn-newer-${count - 1 - i}`,
    created_at: new Date(Date.parse(RUN_AT) + (count - i) * 60_000).toISOString(),
    facts: [],
  }));
}

function runRow(graphHashAtRun: string): StoredRow {
  return {
    id: RUN_ROW_ID,
    turn_id: 'turn-run-analysis',
    created_at: RUN_AT,
    facts: [{ fact: runFact(graphHashAtRun), fact_row_id: RUN_FACT_ROW_ID, fact_created_at: RUN_AT }],
  };
}

/** The window `readRecent` serves WITHOUT a limit — i.e. what the edit path reads. */
function servedWindowIds(): string[] {
  return storeState.rows.slice(0, SESSION_READ_WINDOW_DEFAULT).map((row) => row.id);
}

/** The dispatch's own derivation for this request (exactly one per edit). */
function dispatchDerivation(): FreshnessDerivation {
  const mine = freshnessEmits.filter((e) => e.dispatchPath === 'system_event.factor_value_edit');
  expect(mine, 'exactly one factor_value_edit freshness derivation per edit').toHaveLength(1);
  return mine[0]!.derivation;
}

/** The analysis-affecting hash of the graph the commit handed the store. */
function committedHash(): string {
  const call = appendMock.mock.calls.at(-1);
  const graph = (call?.[0] as { graph?: unknown } | undefined)?.graph;
  expect(graph, 'the edit must have written a graph').toBeDefined();
  return computeAnalysisAffectingGraphHash(graph as never)!;
}

/** The reply fields this file reads. */
interface WireBody {
  readonly graph_hash?: string;
  readonly draft_graph?: unknown;
  readonly analysis_ready?: {
    readonly freshness?: string;
    readonly freshness_reason?: string;
    readonly graph_hash_at_run?: string;
    readonly current_graph_hash?: string;
    readonly computed_at?: string;
  };
}

const PRE_EDIT_HASH = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never)!;

describe('POST /orchestrate/v2/turn — factor_value_edit freshness beyond the readRecent window', () => {
  let app: FastifyInstance;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    windowSize = SESSION_READ_WINDOW_DEFAULT;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    rollingSummaryMock.mockClear();
    readRecentSpy.mockClear();
    readScenarioRunAnalysisFactsForSpy.mockClear();
    freshnessEmits.length = 0;
    persisted = buildPersistedGraph();
    storeState.rows = [];
    storeState.durableFails = false;
    storeState.recentFails = false;
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    // NO PROVIDER, in every case: no model call and no network call at all.
    expect(llmChatMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  async function edit(suffix: string) {
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payloadFor(suffix) });
    expect(res.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    return JSON.parse(res.body) as WireBody;
  }

  /** The run's identity, read back off the wire AND off the dispatch's own derivation. */
  function expectRunIdentity(
    body: WireBody,
    expected: { freshness: 'fresh' | 'stale'; reason: string; graphHashAtRun: string },
  ) {
    const derivation = dispatchDerivation();
    const persistedHash = committedHash();
    // The dispatch derivation: the SEEDED run, compared against the COMMITTED bytes.
    expect(derivation.freshness).toBe(expected.freshness);
    expect(derivation.reason).toBe(expected.reason);
    expect(derivation.graph_hash_at_run).toBe(expected.graphHashAtRun);
    expect(derivation.computed_at).toBe(RUN_AT);
    expect(derivation.current_graph_hash).toBe(persistedHash);
    // The wire carries the same verdict and the same identity.
    expect(body.graph_hash).toBe(persistedHash);
    expect(body.analysis_ready?.freshness).toBe(expected.freshness);
    expect(body.analysis_ready?.freshness_reason).toBe(expected.reason);
    expect(body.analysis_ready?.graph_hash_at_run).toBe(expected.graphHashAtRun);
    expect(body.analysis_ready?.computed_at).toBe(RUN_AT);
    expect(body.analysis_ready?.current_graph_hash).toBe(persistedHash);
  }

  it('CONTRAST: the run turn is INSIDE the window — a hash-moving edit replies stale, bound to that run', async () => {
    storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT - 1), runRow(PRE_EDIT_HASH)];
    expect(servedWindowIds(), 'premise: the run row is inside the served window').toContain(RUN_ROW_ID);

    const body = await edit('0');

    expect(committedHash(), 'premise: the edit moved the analysis hash').not.toBe(PRE_EDIT_HASH);
    expectRunIdentity(body, { freshness: 'stale', reason: 'graph_hash_diverged', graphHashAtRun: PRE_EDIT_HASH });
  });

  it('DEFECT: 20 newer rows push the run turn OUT of the window — the same edit must STILL reply stale', async () => {
    storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(PRE_EDIT_HASH)];
    // Premise, proven with the REAL production window rather than assumed.
    expect(SESSION_READ_WINDOW_DEFAULT).toBe(20);
    expect(servedWindowIds()).toHaveLength(SESSION_READ_WINDOW_DEFAULT);
    expect(servedWindowIds(), 'premise: the run row has aged out of the served window').not.toContain(RUN_ROW_ID);

    const body = await edit('1');

    expect(
      body.analysis_ready?.freshness,
      'the edit reply forgot an analysis whose turn aged out of the 20-row readRecent window',
    ).toBe('stale');
    expectRunIdentity(body, { freshness: 'stale', reason: 'graph_hash_diverged', graphHashAtRun: PRE_EDIT_HASH });
  });

  it('FRESH ARM: run aged out, and the edit returns the model to the ANALYSED value — replies fresh, not stale', async () => {
    // Kills "a durable fact exists ⇒ stale" and "any edit ⇒ stale". The hash
    // comparison, not the fact's presence, must decide.
    //
    // Calibrate the analysed graph's hash from the commit itself (the persisted
    // bytes are projected, so a hand-computed hash would be a guess): the user
    // analysed the model at £50,000, then moved it to £40,000 (persisted now).
    const calibration = await edit('2');
    const analysedHash = committedHash();
    expect(calibration.graph_hash).toBe(analysedHash);
    expect(analysedHash).not.toBe(PRE_EDIT_HASH);

    appendMock.mockClear();
    freshnessEmits.length = 0;
    persisted = buildPersistedGraph();
    storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(analysedHash)];
    expect(servedWindowIds(), 'premise: the run row has aged out of the served window').not.toContain(RUN_ROW_ID);

    // Now the user types £50,000 back in.
    const body = await edit('3');

    expect(committedHash(), 'premise: the committed bytes hash back to the analysed graph').toBe(analysedHash);
    expectRunIdentity(body, { freshness: 'fresh', reason: 'graph_hash_match', graphHashAtRun: analysedHash });
  });

  it('NEVER-RUN CONTROL: no run fact anywhere — the honest answer stays none', async () => {
    storeState.rows = newerRows(SESSION_READ_WINDOW_DEFAULT + 5);

    const body = await edit('4');

    const derivation = dispatchDerivation();
    expect(derivation.freshness).toBe('none');
    expect(derivation.reason).toBe('no_successful_run_analysis_fact');
    expect(derivation.graph_hash_at_run).toBeNull();
    expect(derivation.computed_at).toBeNull();
    expect(derivation.current_graph_hash).toBe(committedHash());
    expect(body.analysis_ready?.freshness).toBe('none');
    expect(body.analysis_ready?.graph_hash_at_run).toBeUndefined();
  });

  describe('DEGRADED — the reload route\'s own rule (scenario-graph-analysis-read.ts:185-189)', () => {
    // The rule: the durable set is used only when it is reasoning authority
    // (`complete | capped`); otherwise the hot window, with `factsReadOk` taken
    // from WHICHEVER source was chosen.

    it('durable read FAILS, hot window healthy but holding no run — the rule falls back to the window: none', async () => {
      // ⚠ PINNED AS THE ROUTE'S RULE YIELDS IT, not as an endorsement. With the
      // durable set degraded the route keeps "the window behaviour it always
      // had", and a healthy window with no run in it derives `none`. That is the
      // same answer the edit reply gave before this change on this input.
      storeState.durableFails = true;
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(PRE_EDIT_HASH)];

      const body = await edit('5');

      expect(readScenarioRunAnalysisFactsForSpy, 'premise: the durable port was consulted and failed').toHaveBeenCalled();
      const derivation = dispatchDerivation();
      expect(derivation.freshness).toBe('none');
      expect(derivation.reason).toBe('no_successful_run_analysis_fact');
      expect(body.analysis_ready?.freshness).toBe('none');
    });

    it('durable read FAILS, run still inside the window — the window fallback keeps its stale verdict', async () => {
      storeState.durableFails = true;
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT - 1), runRow(PRE_EDIT_HASH)];

      const body = await edit('6');

      expect(readScenarioRunAnalysisFactsForSpy).toHaveBeenCalled();
      expectRunIdentity(body, { freshness: 'stale', reason: 'graph_hash_diverged', graphHashAtRun: PRE_EDIT_HASH });
    });

    it('durable read FAILS and the window read FAILS — unknown / derivation_failed, never none', async () => {
      storeState.durableFails = true;
      storeState.recentFails = true;
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(PRE_EDIT_HASH)];

      const body = await edit('7');

      expect(readScenarioRunAnalysisFactsForSpy).toHaveBeenCalled();
      const derivation = dispatchDerivation();
      expect(derivation.freshness).toBe('unknown');
      expect(derivation.reason).toBe('derivation_failed');
      expect(derivation.graph_hash_at_run).toBeNull();
      expect(derivation.current_graph_hash).toBe(committedHash());
      expect(body.analysis_ready?.freshness).toBe('unknown');
      // Fact history is observational: a failed read never costs the user the edit.
      expect(body.draft_graph).toBeDefined();
    });

    it('window read FAILS but the durable set is complete — the durable set decides (readOk from the CHOSEN source)', async () => {
      storeState.recentFails = true;
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(PRE_EDIT_HASH)];

      const body = await edit('8');

      expect(readScenarioRunAnalysisFactsForSpy).toHaveBeenCalled();
      expectRunIdentity(body, { freshness: 'stale', reason: 'graph_hash_diverged', graphHashAtRun: PRE_EDIT_HASH });
    });

    it('window read FAILS, durable set complete and EMPTY — absence in the complete record is authoritative: none', async () => {
      // Kills "read status from the hot window regardless of source": that
      // mutant answers `unknown` here, because only this case leaves the
      // derivation with no fact to select, the one place the status is read.
      storeState.recentFails = true;
      storeState.rows = newerRows(SESSION_READ_WINDOW_DEFAULT);

      const body = await edit('a');

      expect(readScenarioRunAnalysisFactsForSpy).toHaveBeenCalled();
      const derivation = dispatchDerivation();
      expect(derivation.freshness).toBe('none');
      expect(derivation.reason).toBe('no_successful_run_analysis_fact');
      expect(body.analysis_ready?.freshness).toBe('none');
    });
  });


  // ── CAPPED: the `capped` durable carrier (total_count > SCENARIO_ANALYSIS_FACT_CAP) ──
  function cappedRunRows(count: number, graphHashAtRun: string, status: 'completed' | 'failed'): StoredRow[] {
    return Array.from({ length: count }, (_, i) => {
      const at = new Date(Date.parse(RUN_AT) - i * 60_000).toISOString();
      const fact = RunAnalysisHandlerFactSchema.parse({
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          computed_at: at,
          graph_hash_at_run: graphHashAtRun,
          leading_option_id: 'o-launch',
          summary: 'Launch now leads on the analysed model.',
          win_probabilities: { 'o-launch': 1 },
          constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
          enrichment: { analysis_status: status, robustness: { level: 'strong', near_tie: { is_tie: false } } },
        },
      }) as HandlerFact;
      return {
        id: `row-capped-${i}`,
        turn_id: `turn-capped-${i}`,
        created_at: at,
        facts: [{ fact, fact_row_id: `fact-row-capped-${String(i).padStart(3, '0')}`, fact_created_at: at }],
      };
    });
  }

  it('CAPPED-1: 25 successful runs, all aged out of the window — capped durable set still decides: stale', async () => {
    storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), ...cappedRunRows(25, PRE_EDIT_HASH, 'completed')];
    expect(servedWindowIds().some((id) => id.startsWith('row-capped-')), 'premise: no run row in window').toBe(false);
    const body = await edit('b');
    expect(readScenarioRunAnalysisFactsForSpy).toHaveBeenCalled();
    const derivation = dispatchDerivation();
    expect(derivation.freshness).toBe('stale');
    expect(derivation.reason).toBe('graph_hash_diverged');
    expect(derivation.graph_hash_at_run).toBe(PRE_EDIT_HASH);
    expect(derivation.computed_at).toBe(RUN_AT);
    expect(body.analysis_ready?.freshness).toBe('stale');
  });

  it('CAPPED-2: 25 FAILED runs aged out — capped absence is NOT authoritative: unknown / derivation_failed', async () => {
    storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), ...cappedRunRows(25, PRE_EDIT_HASH, 'failed')];
    const body = await edit('c');
    expect(readScenarioRunAnalysisFactsForSpy).toHaveBeenCalled();
    const derivation = dispatchDerivation();
    expect(derivation.freshness).toBe('unknown');
    expect(derivation.reason).toBe('derivation_failed');
    expect(body.analysis_ready?.freshness).toBe('unknown');
  });

  it('NO PROVIDER: the defect scenario runs with the LLM adapter and fetch never called', async () => {
    storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(PRE_EDIT_HASH)];

    await edit('9');

    expect(llmChatMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The post-commit (Anthropic) summariser hook is replaced in this file, so
    // whether or not the commit reaches it, it cannot reach a provider.
  });
});
