/**
 * EVERY SYSTEM-EVENT WRITER STATES THE ANALYSIS'S FRESHNESS FROM THE SCENARIO'S
 * RECORD — not from the last 20 rows, and not by omission.
 *
 * The same defect, one writer at a time: #1843 fixed the reload (F1) and #1860
 * the factor_value_edit reply, but four writers still derive their reply's
 * freshness from the 20-row hot window alone (edge_strength_edit,
 * structural_delete, structural_add, structural_add_edge) and structural_rename
 * derives none, so its reply says `unknown_degraded / no_graph_this_turn`
 * (served e39f6e0/c6b4fbc: every forwarded rename in the F1 witness).
 * Once the run's turn ages out of the window (every value op and Agent turn is a
 * row), a structural edit's reply says the scenario was NEVER analysed.
 *
 * For each writer: the run fact lives only in the durable scenario record (20
 * newer rows push it out of the window), stamped with the pre-edit hash.
 *   hash-moving writers → `stale`, bound to that run (graph_hash_at_run);
 *   a label-only rename → `fresh` (the label is outside the analysis hash).
 * CONTROL: the same writers with the run INSIDE the window, which proves each
 * event reaches its commit and that the hash-moving ones already derive `stale`
 * from the window — so a RED below is the source of the facts, not the harness.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // The structural writers read the latest pending actions (integrity-strict) before any
  // append; a healthy empty read, as route-v2-structural-delete.test.ts models it.
  readMostRecentPendingActions: async () => [],
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
              // The SERVED posture (/healthz graph_cas: rpc_mode enforce), which is also
              // what opens the edge_strength_edit writer (reader-only otherwise).
              if (featProp === 'graphCas') {
                return { appMode: 'observe', rpcMode: 'enforce', rpcEnforce: true, requiresExpectedHash: true };
              }
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

const SCENARIO_ID = '66666666-6666-4666-8666-666666666666';
const TURN_ID_BASE = '77777777-7777-4777-8777-77777777777';
const RUN_ROW_ID = 'row-run-analysis';
const RUN_FACT_ROW_ID = 'fact-row-run-analysis';
const RUN_AT = '2026-09-24T09:00:00.000Z';


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


const PRE_HASH = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never)!;

function eventFor(writer: string): Record<string, unknown> {
  switch (writer) {
    case 'edge_strength_edit':
      return { kind: 'edge_strength_edit', from: 'f-budget', to: 'g-revenue', magnitude: 0.7,
        direction_intent: 'preserve', expected: { mean: 0.4, effect_direction: 'positive' }, intent: 'set' };
    case 'structural_delete':
      return { kind: 'structural_delete', removed_node_ids: ['o-launch'], removed_edges: [], base_graph_hash: PRE_HASH };
    case 'structural_add':
      return { kind: 'structural_add', node_id: 'f-new', node_kind: 'factor', label: 'Hiring pace', base_graph_hash: PRE_HASH };
    case 'structural_add_edge':
      return { kind: 'structural_add_edge', from: 'o-launch', to: 'f-budget', magnitude: 0.5,
        effect_direction: 'positive', base_graph_hash: PRE_HASH };
    case 'structural_rename':
      return { kind: 'structural_rename', node_id: 'f-budget', label: 'Marketing spend',
        expected_label: 'Marketing budget', base_graph_hash: PRE_HASH };
    default:
      throw new Error(`unknown writer ${writer}`);
  }
}

async function send(writer: string, suffix: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: { kind: 'system_event', turn_id: `${TURN_ID_BASE}${suffix}`, scenario_id: SCENARIO_ID, stage: 'analyse', event: eventFor(writer) },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

let app: FastifyInstance;

const HASH_MOVING = ['edge_strength_edit', 'structural_delete', 'structural_add', 'structural_add_edge'] as const;

describe('every system-event writer states freshness from the scenario record', () => {
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
    freshnessEmits.length = 0;
    persisted = buildPersistedGraph();
    storeState.durableFails = false;
    storeState.recentFails = false;
  });

  describe.each(HASH_MOVING.map((w, i) => [w, i] as const))('%s (hash-moving)', (writer, i) => {
    it('CONTROL: run INSIDE the window — commits and replies stale, bound to that run', async () => {
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT - 1), runRow(PRE_HASH)];
      const { status, body } = await send(writer, `${i}`);
      expect(status, JSON.stringify(body).slice(0, 400)).toBe(200);
      expect(appendMock, 'premise: the writer reached its commit').toHaveBeenCalledTimes(1);
      expect(typeof body.graph_hash, `premise: the edit committed a graph (blocks: ${JSON.stringify(body.blocks ?? []).slice(0, 300)})`).toBe('string');
      expect(body.graph_hash, 'premise: the edit moved the analysis hash').not.toBe(PRE_HASH);
      expect(body.analysis_ready?.freshness).toBe('stale');
      expect(body.analysis_ready?.graph_hash_at_run).toBe(PRE_HASH);
    });

    it('RED: run AGED OUT of the window, present in the durable record — must STILL reply stale, never none', async () => {
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(PRE_HASH)];
      const { status, body } = await send(writer, `${i + 4}`);
      expect(status).toBe(200);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(body.analysis_ready?.freshness, `${writer} said the scenario was never analysed`).toBe('stale');
      expect(body.analysis_ready?.graph_hash_at_run).toBe(PRE_HASH);
      // run_state carries READINESS first (an added factor with no level is `blocked`),
      // so the claim is the absence it must never state: not `never_run`, not current.
      expect(body.analysis_state?.run_state?.kind).not.toBe('never_run');
      expect(body.analysis_state?.run_state?.kind).not.toBe('complete_current');
    });
  });

  describe('structural_rename (label-only: outside the analysis hash)', () => {
    it('premise: the rename commits and does NOT move the analysis hash', async () => {
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT - 1), runRow(PRE_HASH)];
      const { status, body } = await send('structural_rename', '8');
      expect(status, JSON.stringify(body).slice(0, 400)).toBe(200);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(typeof body.graph_hash, 'premise: the rename committed').toBe('string');
      expect(body.graph_hash).toBe(PRE_HASH);
    });

    it('RED: a label-only rename after a current run states it CURRENT — not unknown / no_graph_this_turn', async () => {
      storeState.rows = [...newerRows(SESSION_READ_WINDOW_DEFAULT), runRow(PRE_HASH)];
      const { body } = await send('structural_rename', '9');
      expect(body.analysis_ready?.freshness).toBe('fresh');
      // run_state carries readiness first (this fixture's option has no interventions,
      // so it is `blocked`); the defect was the no-verdict fallback, which must be gone.
      expect(body.analysis_state?.run_state?.kind).not.toBe('unknown_degraded');
      expect(body.analysis_state?.run_state?.cause).not.toBe('no_graph_this_turn');
      expect(body.analysis_state?.run_state?.kind).not.toBe('never_run');
    });
  });
});
