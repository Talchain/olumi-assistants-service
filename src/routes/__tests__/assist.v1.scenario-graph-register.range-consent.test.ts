import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
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
  getSessionStore: () => withScenarioRevision(store),
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


const RANGE = { low: 5, high: 20, meaning: 'likely_range', source: 'user_specified', source_quote: 'likely 5 to 20 days' };
function rangeGraph(withRange = true) {
  const graph = { ...structuredClone(GRAPH), options: [] } as Rec & { nodes: Rec[] };
  graph.nodes.find(n => n.id === 'fac_price')!.observed_state = { value: 0, raw_value: 0, cap: 40, unit: 'days' };
  graph.nodes.find(n => n.id === 'opt_stay')!.interventions = { fac_price: {
    value: 0.25, raw_value: 10, unit: 'days', source: 'user_specified',
    target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' },
    ...(withRange ? { range: structuredClone(RANGE) } : {}),
  } };
  return graph;
}
const cell = (graph: unknown, container: 'nodes' | 'options' = 'nodes') => {
  const row = (graph as Record<string, Rec[]>)[container]!.find(n => n.id === 'opt_stay')!;
  return (row.interventions as Record<string, Rec>).fac_price!;
};
const writtenGraph = () => (append.mock.calls[0]![0] as Rec).graph;

describe('registration range consent compares the final postimage with the stored graph', () => {
  it.each(['canonical', 'nested', 'slash', 'mirror'])('a new range has no stored approval: %s', async carrier => {
    const stored = projectGraphForPersistence(rangeGraph(false));
    loadGraph.mockResolvedValue(stored);
    const incoming = rangeGraph(false);
    const option = incoming.nodes.find(n => n.id === 'opt_stay')!;
    if (carrier === 'canonical') cell(incoming).range = RANGE;
    if (carrier === 'nested') option.data = { interventions: { fac_price: { ...cell(incoming), range: RANGE } } };
    if (carrier === 'slash') option['data/interventions/fac_price'] = { ...cell(incoming), range: RANGE };
    if (carrier === 'mirror') {
      incoming.options = [{ id: 'opt_stay', label: 'Stay', status: 'ready', interventions: { fac_price: { ...cell(incoming), range: RANGE } } }];
      delete option.interventions;
    }
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(409);
    expect(append).not.toHaveBeenCalled();
    expect(cell(stored).range).toBeUndefined();
  });

  it.each([
    { high: 30 }, { low: 6 }, { meaning: 'min_max' }, { source: 'cee_inference' }, { source_quote: 'invented quote' },
  ])('a changed range cannot reuse stored approval: %j', async change => {
    const stored = projectGraphForPersistence(rangeGraph());
    loadGraph.mockResolvedValue(stored);
    const incoming = rangeGraph();
    cell(incoming).range = { ...RANGE, ...change };
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(409);
    expect(append).not.toHaveBeenCalled();
    expect(cell(stored).range).toEqual(RANGE);
  });

  it('an approved stored range round-trips, including when omitted from an unchanged quantity', async () => {
    loadGraph.mockResolvedValue(projectGraphForPersistence(rangeGraph()));
    const incoming = rangeGraph(false);
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(200);
    expect(cell(writtenGraph()).range).toEqual(RANGE);
    expect(cell(writtenGraph(), 'options').range).toEqual(RANGE);
  });

  it.each([{ value: 0.3, raw_value: 12 }, { unit: 'weeks' }])('native quantity changes clear an inherited range: %j', async change => {
    loadGraph.mockResolvedValue(projectGraphForPersistence(rangeGraph()));
    const incoming = rangeGraph();
    Object.assign(cell(incoming), change);
    const res = await register(incoming);
    expect(res.statusCode, res.body).toBe(200);
    expect(cell(writtenGraph()).range).toBeUndefined();
    expect(cell(writtenGraph(), 'options').range).toBeUndefined();
    expect(cell(writtenGraph())).toMatchObject(change);
  });

  it('a failed stored read refuses registration', async () => {
    loadGraph.mockRejectedValue(new Error('stored read failed'));
    expect((await register(rangeGraph())).statusCode).toBe(503);
    expect(append).not.toHaveBeenCalled();
  });
});
