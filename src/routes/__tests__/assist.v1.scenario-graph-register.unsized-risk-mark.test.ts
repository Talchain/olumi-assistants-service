import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/**
 * ⭐ THE REGISTRATION RECONCILES AN UNSIZED OLUMI RISK'S MARK LIKE EVERY OTHER SAVED WRITE (Codex R1 BLOCK on CEE #3441: graph/register
 * bypassed it). A registration over a saved model is CEE's own writer's (`injectAsCeeWriter`); it reaches the ONE persisted-form preparation (`projectGraphForPersistence`) with the stored graph it
 * replaces, so a model that sizes Olumi's kept-out risk is saved with it taking part; a model that leaves it unsized keeps it out;
 * and a mark a stored graph already carries is never rewritten by a write that did not end it. Synthetic labels.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const SCENARIO = 'c8d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  mockConfig.value = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } };
  return { ...actual, config: mockConfig.value };
});
vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
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
import { unsizedOlumiRiskIds } from '../../orchestrator-v5/agent-lane/unsized-risk.js';

type Rec = Record<string, unknown>;
const RISK = 'risk_supplier_delay';
const link = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.01 }, exists_probability: 1, effect_direction: mean < 0 ? 'negative' : 'positive' });
/** Olumi's unsized risk on the goal's path, persisted as left out (`retained_excluded`), as admission saves it. */
const stored = (risk: Rec = {}) => ({
  goal_node_id: 'g_output',
  nodes: [
    { id: 'g_output', kind: 'goal', label: 'Monthly output' },
    { id: 'dec_shift', kind: 'decision', label: 'Shift pattern' },
    { id: 'fac_hours', kind: 'factor', label: 'Weekly hours', category: 'controllable', observed_state: { value: 0.4 } },
    { id: 'opt_now', kind: 'option', label: 'Keep shifts', is_baseline: true, interventions: { fac_hours: 0.4 } },
    { id: 'opt_more', kind: 'option', label: 'Add a shift', interventions: { fac_hours: 0.6 } },
    { id: RISK, kind: 'risk', label: 'Supplier delay', provenance: 'ai_inferred', analysis_participation: 'retained_excluded', ...risk },
  ],
  edges: [
    link('fac_hours', 'g_output', 0.5), link(RISK, 'g_output', -0.3),
    link('dec_shift', 'opt_now'), link('dec_shift', 'opt_more'), link('opt_now', 'fac_hours'), link('opt_more', 'fac_hours'),
  ],
});
const SIZED = { observed_state: { value: 0.2, raw_value: 0.2, source: 'user_edited', extractionType: 'explicit' } };

async function register(graph: unknown) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const res = await injectAsCeeWriter(app, { method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  await app.close();
  return res;
}
const written = () => (append.mock.calls[0]![0] as Rec).graph as Rec;
const risk = (g: Rec) => (g.nodes as Rec[]).find((n) => n.id === RISK)!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  append.mockResolvedValue({ id: 'turn-1' });
  readCommittedTurn.mockResolvedValue(null);
  readMostRecentPendingActions.mockResolvedValue([]);
});

describe('/graph/register reconciles an unsized Olumi risk’s mark against the stored graph it replaces', () => {
  it('PRECONDITION: the stored risk is the unsized rule’s, and a level ends the rule on the node itself', () => {
    expect(unsizedOlumiRiskIds(stored()).has(RISK)).toBe(true);
    expect(unsizedOlumiRiskIds(stored(SIZED)).has(RISK)).toBe(false);
  });

  it('RED: the registered model gives the kept-out risk a level → it is written taking part (no stale "left out" mark)', async () => {
    loadGraph.mockResolvedValue(stored());
    const res = await register(stored(SIZED));
    expect(res.statusCode, res.body).toBe(200);
    expect(risk(written()).analysis_participation).toBeUndefined();
    expect(risk(written()).observed_state).toMatchObject({ value: 0.2 });
  });

  it('CONTROL: the same model registered with the risk still unsized keeps it out', async () => {
    loadGraph.mockResolvedValue(stored());
    const res = await register(stored());
    expect(res.statusCode, res.body).toBe(200);
    expect(risk(written()).analysis_participation).toBe('retained_excluded');
  });

  it('CONTROL (no history rewrite): a stored graph that already carries the mark beside a level is written as it stands when the write did not end the rule', async () => {
    loadGraph.mockResolvedValue(stored(SIZED));
    const res = await register(stored(SIZED));
    expect(res.statusCode, res.body).toBe(200);
    expect(risk(written()).analysis_participation).toBe('retained_excluded');
  });
});
