/**
 * `/graph/register` THREADS LIVE CONSENT HOLDS THROUGH ITS WRITE.
 *
 * Served (CEE `e3b0844`, 26 Sep 03:1xZ, #70 5842670630): the Agent held an
 * add-option (`gmh_1045daca3111`), a register of the UNCHANGED graph returned
 * 200 with the SAME hash, and approving the hold then read "that proposal is no
 * longer available". The register's append omitted `pending_actions`, the RPC
 * defaulted it to `[]`, and the pending read takes only the newest row — so every
 * register (the UI's re-registers, imports, and the Agent's own register-based
 * value writes) silently destroyed every pending approval.
 *
 * The hold here is minted by the production add-option dispatcher over the
 * stored graph, so its batch and pin are the real shape.
 *
 *   unchanged graph            → the hold is written back, pin unchanged
 *   value moved (hash moves)   → the hold is re-pinned to the stored bytes' hash
 *   the hold's target removed  → the hold lapses (telemetry, site graph_registration)
 *   a non-hold pending         → carried as-is
 *   pending read FAILS         → today's write (no pending_actions key) + a warn
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = 'b7c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  mockConfig.value = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } };
  return { ...actual, config: mockConfig.value };
});

const { logWarn, emitFn } = vi.hoisted(() => ({ logWarn: vi.fn(), emitFn: vi.fn() }));
vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn() },
    emit: emitFn,
  };
});

const append = vi.fn();
const loadGraph = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const scenarioExists = vi.fn();
const readCommittedTurn = vi.fn();
const readMostRecentPendingActions = vi.fn();
const store = { append, loadGraph, ensureScenarioExists, getScenarioOwner, scenarioExists, readCommittedTurn, readMostRecentPendingActions };
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => store,
}));

const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { dispatchAddOptionTransaction } from '../../orchestrator-v5/handlers/add-option-dispatch.js';
import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';

type Rec = Record<string, unknown>;
const GRAPH = {
  goal_node_id: 'g_profit',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    { id: 'dec_choice', kind: 'decision', label: 'Which price' },
    { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.4 } },
    { id: 'fac_churn', kind: 'factor', label: 'Churn', category: 'external', observed_state: { value: 0.3 } },
    { id: 'opt_stay', kind: 'option', label: 'Stay', interventions: { fac_price: 0.4 } },
  ],
  edges: [
    { from: 'fac_price', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_churn', to: 'g_profit', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    { from: 'dec_choice', to: 'opt_stay', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_stay', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};
const STORED = projectGraphForPersistence(structuredClone(GRAPH)) as typeof GRAPH;
const STORED_HASH = computeAnalysisAffectingGraphHash(STORED as never)!;

function liveHold(): PendingAction {
  const out = dispatchAddOptionTransaction({
    parameters: { parent_decision_id: 'dec_choice', label: 'Raise to £50', interventions: [{ factor_id: 'fac_price', value: 0.6 }] },
    currentGraph: STORED,
    currentGraphHash: STORED_HASH,
    freshness: 'none',
    mode: 'live',
    scenarioId: SCENARIO,
    turnId: 'turn-propose',
    requestId: 'req-propose',
    stage: 'decide',
  } as never);
  if (out.kind !== 'held') throw new Error(`fixture must hold, got ${out.kind}`);
  return out.pendingActions[0]!;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  return app;
}
async function register(app: FastifyInstance, graph: unknown) {
  return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
}
const written = () => append.mock.calls[0]![0] as Rec;
const writtenPendings = () => written().pending_actions as PendingAction[] | undefined;

let hold: PendingAction;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  loadGraph.mockResolvedValue(STORED);
  append.mockResolvedValue({ id: 'turn-1' });
  readCommittedTurn.mockResolvedValue(null);
  hold = liveHold();
  readMostRecentPendingActions.mockResolvedValue([hold]);
});

describe('/graph/register threads live consent holds through its write', () => {
  it('PRECONDITION: the hold is pinned to the stored graph', () => {
    expect(hold.preconditions.graph_hash).toBe(STORED_HASH);
    expect(hold.chip_id).toMatch(/^gmh_[0-9a-f]{12}$/);
  });

  it('⭐ an UNCHANGED register writes the live hold back — the served wipe', async () => {
    const app = await buildApp();
    expect((await register(app, GRAPH)).statusCode).toBe(200);
    const pendings = writtenPendings();
    expect(pendings?.map((p) => p.chip_id)).toEqual([hold.chip_id]);
    expect(pendings?.[0]?.preconditions.graph_hash).toBe(STORED_HASH);
    await app.close();
  });

  it('⭐ a register that MOVES the hash re-pins a still-valid hold to the stored bytes\' hash', async () => {
    const moved = structuredClone(GRAPH);
    (moved.nodes.find((n) => n.id === 'fac_churn') as Rec).observed_state = { value: 0.5 };
    const app = await buildApp();
    const res = await register(app, moved);
    expect(res.statusCode).toBe(200);
    const storedHash = computeAnalysisAffectingGraphHash(written().graph as never);
    expect(storedHash).not.toBe(STORED_HASH);
    const pendings = writtenPendings();
    expect(pendings?.map((p) => p.chip_id)).toEqual([hold.chip_id]);
    expect(pendings?.[0]?.preconditions.graph_hash).toBe(storedHash);
    await app.close();
  });

  it('a register that removes the hold\'s target LAPSES it, with telemetry at site graph_registration', async () => {
    const gone = structuredClone(GRAPH);
    gone.nodes = gone.nodes.filter((n) => n.id !== 'fac_price');
    gone.edges = gone.edges.filter((e) => e.from !== 'fac_price' && e.to !== 'fac_price');
    (gone.nodes.find((n) => n.id === 'opt_stay') as Rec).interventions = {};
    const app = await buildApp();
    const res = await register(app, gone);
    expect(res.statusCode).toBe(200);
    expect(writtenPendings()?.some((p) => p.chip_id === hold.chip_id)).toBe(false);
    const lapseEvents = emitFn.mock.calls
      .map((c) => c[1] as Rec)
      .filter((p) => p?.site === 'graph_registration' && p?.scenario_id === SCENARIO);
    expect(lapseEvents).toEqual([
      expect.objectContaining({ kind: hold.action.kind, detail: 'held_batch_invalid_post_mutation', reason: 'graph_hash_changed' }),
    ]);
    await app.close();
  });

  it('a non-hold pending is carried as-is', async () => {
    const other = { ...hold, chip_id: 'chip_other', action: { kind: 'set_factor_value', factor_id: 'fac_churn', value: 0.2 } } as unknown as PendingAction;
    readMostRecentPendingActions.mockResolvedValue([hold, other]);
    const app = await buildApp();
    expect((await register(app, GRAPH)).statusCode).toBe(200);
    expect(writtenPendings()?.map((p) => p.chip_id)).toEqual([hold.chip_id, 'chip_other']);
    await app.close();
  });

  it('a FAILED pending read keeps today\'s write (no pending_actions key) and says so in a warn', async () => {
    readMostRecentPendingActions.mockRejectedValue(new Error('store down'));
    const app = await buildApp();
    expect((await register(app, GRAPH)).statusCode).toBe(200);
    expect('pending_actions' in written()).toBe(false);
    expect(logWarn.mock.calls.some((c) => (c[0] as Rec)?.event === 'v5.scenario_graph_register.pending_wipe_risk')).toBe(true);
    await app.close();
  });
});
