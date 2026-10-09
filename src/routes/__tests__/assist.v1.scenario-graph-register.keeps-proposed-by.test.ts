import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/**
 * ⭐ AN OPTION OLUMI ADDED KEEPS ITS MARK THROUGH THE REGISTER WRITE AND THE PERSISTED READ (DL #72 5887755959: "it must
 * survive the actual admission/register/read path"). The register write keeps any key; the strip is CEE's `NodeV3` parse,
 * which the Run's snapshot (`build-turn-context.ts`), commits and edits all go through. The contrast row shows that parse
 * drops an undeclared key on the same node: the mark survives because it is declared, not because nothing strips.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

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
import { GraphV3 } from '../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const GRAPH = {
  goal_node_id: 'g_mrr',
  nodes: [
    { id: 'g_mrr', kind: 'goal', label: 'MRR' },
    { id: 'dec_price', kind: 'decision', label: 'Pro price' },
    { id: 'fac_price', kind: 'factor', label: 'Pro plan price', category: 'controllable', observed_state: { value: 0.245 } },
    { id: 'opt_keep', kind: 'option', label: 'Keep £49', is_baseline: true, interventions: { fac_price: 0.245 } },
    { id: 'opt_59', kind: 'option', label: 'Raise to £59', interventions: { fac_price: 0.295 } },
    { id: 'opt_54', kind: 'option', label: '£54 Pro release', proposed_by: 'olumi', zz_undeclared: 'x', interventions: { fac_price: 0.27 } },
  ],
  edges: [
    { from: 'fac_price', to: 'g_mrr', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'dec_price', to: 'opt_keep', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_price', to: 'opt_59', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_price', to: 'opt_54', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_keep', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_59', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_54', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

async function register(graph: unknown) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  await app.close();
  return res;
}
const written = () => (append.mock.calls[0]![0] as Rec).graph as Rec;
const node = (g: Rec, id: string) => (g.nodes as Rec[]).find((n) => n.id === id)!;

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

describe('/graph/register keeps an Olumi option\'s mark', () => {
  it('⭐ the written graph and its persisted read keep `proposed_by: "olumi"` on that option only', async () => {
    const res = await register(structuredClone(GRAPH));
    expect(res.statusCode, res.body).toBe(200);
    const g = written();
    expect(node(g, 'opt_54').proposed_by).toBe('olumi');
    expect(node(g, 'opt_59').proposed_by).toBeUndefined();
    expect(node(g, 'opt_keep').proposed_by).toBeUndefined();
    const read = projectGraphForPersistence(g as never) as Rec;
    expect(node(read, 'opt_54').proposed_by).toBe('olumi');
  });
  it('⭐ the Run\'s snapshot parse (`GraphV3`, build-turn-context) keeps the mark; CONTRAST: it drops an undeclared key on the same node', async () => {
    const res = await register(structuredClone(GRAPH));
    expect(res.statusCode, res.body).toBe(200);
    const read = projectGraphForPersistence(written() as never) as Rec;
    expect(node(read, 'opt_54').zz_undeclared).toBe('x');
    const parsed = GraphV3.safeParse(read);
    expect(parsed.success).toBe(true);
    const snap = (parsed as { data: Rec }).data;
    expect(node(snap, 'opt_54').proposed_by).toBe('olumi');
    expect(node(snap, 'opt_54').zz_undeclared).toBeUndefined();
  });
});
