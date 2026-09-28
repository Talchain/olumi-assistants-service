/**
 * An ABSENT `goal_constraints` on a register is "no statement": the stored limits
 * are kept. An explicit list (`[]` included) is the caller's statement. (#70 5852105101)
 * Served before the fix (CEE ecd379a): re-registering a scenario's nodes and edges
 * without the key replaced its stored limit list with nothing (1 → 0).
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

type Rec = Record<string, unknown>;
const CHURN_LIMIT = { constraint_id: 'constraint_fac_churn_max', node_id: 'fac_churn', operator: '<=', value: 0.1, unit: 'fraction', label: 'monthly churn', provenance: 'explicit' };
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
const STORED = projectGraphForPersistence({ ...structuredClone(GRAPH), goal_constraints: [CHURN_LIMIT] } as never) as Rec;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  return app;
}
async function register(graph: unknown) {
  const app = await buildApp();
  const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  await app.close();
  return res;
}
const writtenLimits = () => ((append.mock.calls[0]![0] as Rec).graph as Rec).goal_constraints as Rec[] | undefined;
const ids = (xs: Rec[] | undefined) => (xs ?? []).map((c) => c.constraint_id);

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
  readMostRecentPendingActions.mockResolvedValue([]);
});

describe('/graph/register never erases limits it was not told about', () => {
  it('PRECONDITION: the stored graph holds the churn limit', () => {
    expect(ids(STORED.goal_constraints as Rec[])).toEqual(['constraint_fac_churn_max']);
  });

  it('⭐ a register with NO goal_constraints key keeps the stored limit, whole (the served 1 → 0)', async () => {
    const res = await register(structuredClone(GRAPH));
    expect(res.statusCode, res.body).toBe(200);
    expect(writtenLimits()).toEqual([expect.objectContaining(CHURN_LIMIT)]);
  });

  it('an explicit [] is a statement: the stored limit is cleared', async () => {
    const res = await register({ ...structuredClone(GRAPH), goal_constraints: [] });
    expect(res.statusCode, res.body).toBe(200);
    expect(ids(writtenLimits())).toEqual([]);
  });

  it('an explicit list replaces the stored one exactly (no merge)', async () => {
    const price = { constraint_id: 'constraint_fac_price_min', node_id: 'fac_price', operator: '>=', value: 0.2, label: 'price floor', provenance: 'explicit' };
    const res = await register({ ...structuredClone(GRAPH), goal_constraints: [price] });
    expect(res.statusCode, res.body).toBe(200);
    expect(ids(writtenLimits())).toEqual(['constraint_fac_price_min']);
  });

  it('a stored limit whose node the new graph dropped is not carried', async () => {
    const gone = structuredClone(GRAPH);
    gone.nodes = gone.nodes.filter((n) => n.id !== 'fac_churn');
    gone.edges = gone.edges.filter((e) => e.from !== 'fac_churn' && e.to !== 'fac_churn');
    const res = await register(gone);
    expect(res.statusCode, res.body).toBe(200);
    expect(ids(writtenLimits())).toEqual([]);
  });

  it('a failed read of the stored graph refuses the register (503): the stored limits are never erased blind', async () => {
    loadGraph.mockRejectedValue(new Error('read failed'));
    const res = await register(structuredClone(GRAPH));
    expect(res.statusCode, res.body).toBe(503);
    expect(append).not.toHaveBeenCalled();
  });
});
