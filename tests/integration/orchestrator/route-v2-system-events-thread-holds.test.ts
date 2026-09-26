/**
 * Every MUTATING system-event writer threads live consent holds THROUGH its
 * mutation — re-pinned when still valid, lapsed WITH a notice when not — and
 * never drops them silently.
 *
 * THE DEFECT. The canvas writers passed the prior row's pendings to the commit
 * PLAINLY. The commit carry-forward's hash rule (rule 4) then dropped every hold
 * pinned to the pre-edit hash, notice-less by design (commit.ts: that rule
 * assumes the MUTATING dispatchers already ran `threadHoldsThroughMutatingCommit`).
 * Only `option_intervention_edit` did. So an Agent or chat proposal the user had
 * not yet approved vanished the moment they touched the canvas, and "yes" said
 * the offer was gone. `goal_target_edit` passed no priors at all: a total wipe.
 *
 * Harness: `route-v2-every-writer-reply-freshness.test.ts`, with the store's
 * pending read returning a real GM hold minted by the real gate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

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
  /** The DB-stamped restore marker (`scenarios.analysis_invalidated_at`), or null. */
  analysisInvalidatedAt: string | null;
  markerFails: boolean;
} = { rows: [], durableFails: false, recentFails: false, analysisInvalidatedAt: null, markerFails: false };

let windowSize = 20; // replaced in beforeAll by the REAL SESSION_READ_WINDOW_DEFAULT
let persisted: unknown = buildPersistedGraph();
// The live consent holds the prior row carries (THIS file's subject).
let priorPendings: unknown[] = [];
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
  // The same port the reload reads (`scenario-graph-analysis-read.ts`); the real
  // store THROWS on a database error or a malformed timestamp.
  readAnalysisInvalidatedAt: async () => {
    if (storeState.markerFails) throw new Error('analysis_invalidated_at read unavailable (test)');
    return storeState.analysisInvalidatedAt;
  },
  loadGraph: async () => persisted,
  // The structural writers read the latest pending actions (integrity-strict) before any
  // append; a healthy empty read, as route-v2-structural-delete.test.ts models it.
  readMostRecentPendingActions: async () => priorPendings,
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

const PRE_HASH = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never)!;

function eventFor(writer: string): Record<string, unknown> {
  switch (writer) {
    case 'factor_value_edit':
      return { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.6, raw_value: 60000, unit: '£' };
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


const { evaluateEditGraphMutations } = await import('../../../src/orchestrator-v5/handlers/edit-graph-referee-gate.js');
const { buildHoldMutationLapseNotice } = await import('../../../src/orchestrator-v5/handlers/hold-thread-through.js');
const telemetryModule = await import('../../../src/utils/telemetry.js');
const { buildProposalPendingAction } = await import('../../../src/orchestrator-v5/coaching/proposal-continuation.js');

/** A real GM hold, minted by the real gate on the persisted graph: add a new factor
 *  (STRUCTURAL_APPLY_HELD). Every writer below leaves it valid. */
function liveHold(): Record<string, unknown> {
  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations: [{ op: 'add_node', path: 'f-held', value: { id: 'f-held', kind: 'factor', label: 'Churn risk' } }] as never,
    currentGraph: buildPersistedGraph(),
    currentGraphHash: PRE_HASH,
    baseGraphHash: PRE_HASH,
    freshness: 'none',
    scenarioId: SCENARIO_ID,
    turnId: 'turn-hold',
    requestId: 'req-hold',
    dispatchPath: 'edit_graph',
  });
  if (decision.governing !== 'held' || !decision.pendingActions?.[0]) {
    throw new Error(`fixture must hold, got ${decision.governing}`);
  }
  return decision.pendingActions[0] as unknown as Record<string, unknown>;
}

/** A hold the DELETE invalidates: a field update on the option the delete removes. */
function holdOnDeletedOption(): Record<string, unknown> {
  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations: [
      { op: 'add_node', path: 'f-held2', value: { id: 'f-held2', kind: 'factor', label: 'Launch cost' } },
      { op: 'add_edge', path: 'o-launch::f-held2', value: { from: 'o-launch', to: 'f-held2', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' } },
    ] as never,
    currentGraph: buildPersistedGraph(),
    currentGraphHash: PRE_HASH,
    baseGraphHash: PRE_HASH,
    freshness: 'none',
    scenarioId: SCENARIO_ID,
    turnId: 'turn-hold-2',
    requestId: 'req-hold-2',
    dispatchPath: 'edit_graph',
  });
  if (decision.governing !== 'held' || !decision.pendingActions?.[0]) {
    throw new Error(`fixture must hold, got ${decision.governing}`);
  }
  return decision.pendingActions[0] as unknown as Record<string, unknown>;
}

function committedPendings(): Array<Record<string, any>> {
  const write = appendMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
  return (write?.pending_actions ?? []) as Array<Record<string, any>>;
}

const HASH_MOVING_WRITERS = ['factor_value_edit', 'edge_strength_edit', 'structural_delete', 'structural_add', 'structural_add_edge'] as const;

describe('every mutating system-event writer threads live holds THROUGH the mutation', () => {
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
    persisted = buildPersistedGraph();
    storeState.rows = [];
    storeState.durableFails = false;
    storeState.recentFails = false;
    storeState.analysisInvalidatedAt = null;
    storeState.markerFails = false;
    priorPendings = [];
  });

  it('PRECONDITION: the fixture hold is pinned to the pre-edit hash', () => {
    const hold = liveHold() as { preconditions: { graph_hash: string } };
    expect(hold.preconditions.graph_hash).toBe(PRE_HASH);
  });

  describe.each(HASH_MOVING_WRITERS.map((w, i) => [w, i] as const))('%s', (writer, i) => {
    it('a still-valid live hold SURVIVES, re-pinned to the post-edit hash', async () => {
      const hold = liveHold();
      priorPendings = [hold];
      const { status, body } = await send(writer, `${i}`);
      expect(status, JSON.stringify(body).slice(0, 300)).toBe(200);
      expect(appendMock, 'premise: the writer committed').toHaveBeenCalledTimes(1);
      expect(body.graph_hash, 'premise: the edit moved the hash').not.toBe(PRE_HASH);
      const carried = committedPendings().filter((p) => p.chip_id === hold.chip_id);
      expect(carried, `${writer} dropped a live consent hold`).toHaveLength(1);
      expect(carried[0]!.preconditions.graph_hash).toBe(body.graph_hash);
    });
  });

  it('structural_delete LAPSES a hold it invalidates — WITH a notice, never silently', async () => {
    const hold = holdOnDeletedOption();
    priorPendings = [hold];
    const emitSpy = vi.spyOn(telemetryModule, 'emit');
    const { status, body } = await send('structural_delete', '5');
    // The retirement is TRACED at this seam, like the edit and draft seams.
    expect(
      emitSpy.mock.calls.some((c) => c[0] === 'v5.pending_action.invalidated' && (c[1] as Record<string, unknown>)?.site === 'system_event_dispatch'),
      'a lapse left no v5.pending_action.invalidated trace',
    ).toBe(true);
    emitSpy.mockRestore();
    expect(status).toBe(200);
    expect(committedPendings().some((p) => p.chip_id === hold.chip_id)).toBe(false);
    const base = await (async () => {
      appendMock.mockClear();
      priorPendings = [];
      return (await send('structural_delete', '6')).body.assistant_text as string;
    })();
    expect(body.assistant_text, 'the lapse must be said').not.toBe(base);
    // The EXACT sentence, on the wire AND in the stored row (review 5841968747).
    const sentence = buildHoldMutationLapseNotice(hold as never);
    expect(body.assistant_text).toContain(sentence);
  });

  it('goal_target_edit (it passed NO priors: a total wipe) now carries the live hold, re-pinned', async () => {
    const hold = liveHold();
    priorPendings = [hold];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'system_event', turn_id: `${TURN_ID_BASE}8`, scenario_id: SCENARIO_ID, stage: 'analyse',
        event: { kind: 'goal_target_edit', goal_node_id: 'g-revenue', constraint_type: 'at_least', raw_value: 50000, unit: '£', base_graph_hash: PRE_HASH },
      },
    });
    const body = JSON.parse(res.body) as Record<string, any>;
    expect(res.statusCode, JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(body.graph_hash, 'premise: the target moved the hash').not.toBe(PRE_HASH);
    const carried = committedPendings().filter((p) => p.chip_id === hold.chip_id);
    expect(carried, 'goal_target_edit dropped a live consent hold').toHaveLength(1);
    expect(carried[0]!.preconditions.graph_hash).toBe(body.graph_hash);
  });

  it('⭐ a CONCEPT offer whose word sits inside an existing label is LAPSED WITH its notice, never silently (review 5841968747)', async () => {
    // "budget" is a substring of "Marketing budget". With no applied-ops record the
    // thread-through used the DRAFT oracle, read the label as fulfilment, and retired
    // the offer with no notice.
    const concept = buildProposalPendingAction({
      scenario_id: SCENARIO_ID, concept: 'budget', preferred_kind: 'factor',
      emitted_at_iso: new Date().toISOString(), graph_hash: PRE_HASH,
    } as never);
    priorPendings = [concept];
    const { status, body } = await send('factor_value_edit', '9');
    expect(status).toBe(200);
    const sentence = buildHoldMutationLapseNotice(concept);
    expect(body.assistant_text).toContain(sentence);
    const stored = String((appendMock.mock.calls.at(-1)?.[0] as Record<string, unknown>)?.assistantMessage ?? '');
    expect(stored, 'the stored copy is the wire copy').toContain(sentence);
  });

  it('a REFUSED value edit (above the scale) keeps the live hold — the refusal writes no graph', async () => {
    const hold = liveHold();
    priorPendings = [hold];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: { kind: 'system_event', turn_id: `${TURN_ID_BASE}a`, scenario_id: SCENARIO_ID, stage: 'analyse',
        event: { kind: 'factor_value_edit', target_id: 'f-budget', value: 1.5, raw_value: 150000, unit: '£' } },
    });
    const body = JSON.parse(res.body) as Record<string, any>;
    expect(res.statusCode, JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(appendMock, 'premise: the refusal committed a turn row').toHaveBeenCalledTimes(1);
    const write = appendMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(write.graph ?? null, 'premise: the refusal wrote no graph').toBeNull();
    const carried = committedPendings().filter((p) => p.chip_id === hold.chip_id);
    expect(carried, 'a refused value edit wiped a live consent hold').toHaveLength(1);
  });

  it('CONTROL: a label-only rename (hash unchanged) carries the hold untouched', async () => {
    const hold = liveHold();
    priorPendings = [hold];
    const { status, body } = await send('structural_rename', '7');
    expect(status).toBe(200);
    expect(body.graph_hash).toBe(PRE_HASH);
    const carried = committedPendings().filter((p) => p.chip_id === hold.chip_id);
    expect(carried).toHaveLength(1);
    expect(carried[0]!.preconditions.graph_hash).toBe(PRE_HASH);
  });
});
