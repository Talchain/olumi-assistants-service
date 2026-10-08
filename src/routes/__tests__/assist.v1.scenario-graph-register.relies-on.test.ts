/** RC3 (a′): the identity stamp survives the same register → persistence → Run-loader parse as event_risk. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const SCENARIO = 'c8d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/telemetry.js')>()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

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
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserIdentity,
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { GraphV3, NodeV3 } from '../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../orchestrator-v5/boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';

type Rec = Record<string, unknown>;
const STAMP = { option_id: 'raise_59' };
const RISK_ID = 'risk_feature_release_slips';
const risk = (reliesOn?: unknown) => ({
  id: RISK_ID, kind: 'risk', label: 'Feature release slips',
  ...(reliesOn === undefined ? {} : { relies_on: reliesOn }),
});
const graphWith = (reliesOn?: unknown) => ({
  goal_node_id: 'mrr',
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.8, baseline: 0.8 } },
    { id: 'pricing', kind: 'decision', label: 'How to price Pro' },
    { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', category: 'controllable', observed_state: { value: 0.49 } },
    { id: 'keep_49', kind: 'option', label: 'Keep £49', is_baseline: true, interventions: { pro_plan_price: 0.49 } },
    { id: 'raise_59', kind: 'option', label: 'Raise Pro price to £59', interventions: { pro_plan_price: 0.59 } },
    risk(reliesOn),
  ],
  edges: [
    { from: 'pricing', to: 'keep_49', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'pricing', to: 'raise_59', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'keep_49', to: 'pro_plan_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'raise_59', to: 'pro_plan_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'pro_plan_price', to: 'mrr', strength: { mean: 0.4, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
});
const node = (graph: Rec) => (graph.nodes as Rec[]).find((n) => n.id === RISK_ID)!;

async function register(graph: unknown) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  try {
    return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  } finally {
    await app.close();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  loadGraph.mockResolvedValue(null);
  append.mockResolvedValue({ id: 'turn-1' });
  readCommittedTurn.mockResolvedValue(null);
  readMostRecentPendingActions.mockResolvedValue([]);
});

describe('RC3 (a′) — stamp carriage', () => {
  it('rc3-stamp-persisted: register → projection → ingress/Run-loader re-parse keeps the identity stamp with zero edges', async () => {
    const res = await register(graphWith(STAMP));
    expect(res.statusCode, res.body).toBe(200);
    const written = (append.mock.calls[0]![0] as Rec).graph as Rec;
    expect(node(written).relies_on).toEqual(STAMP);
    const projected = projectGraphForPersistence(written);
    expect(node(projected).relies_on).toEqual(STAMP);
    const ingress = GraphStateIngressSchema.parse(projected);
    expect(node(ingress).relies_on).toEqual(STAMP);
    // loadScenarioSnapshotForRunAnalysis re-parses with this exact GraphV3, as does every typed graph writer.
    const reparsed = GraphV3.parse(ingress);
    expect(node(reparsed).relies_on).toEqual(STAMP);
    expect(reparsed.edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  });

  it('CONTROL: no stamp stays absent through persistence and re-parse', () => {
    const parsed = GraphV3.parse(projectGraphForPersistence(graphWith()));
    expect('relies_on' in node(parsed)).toBe(false);
  });

  it.each([
    { option_id: 'Raise Pro price to £59' },
    { option_id: '' },
    { option_id: 'raise_59', injected: true },
    { option_id: 59 },
    null,
  ])('malformed on read drops the stamp, preserving the unstamped orphan control (%j)', (stamp) => {
    expect(NodeV3.parse(risk(stamp)).relies_on).toBeUndefined();
  });
});
