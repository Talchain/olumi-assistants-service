import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/**
 * THIN CORE (20 Oct 2026): a core postimage (a complete graph regenerated from its living model) is stored AS GIVEN, with only the
 * identity/format projection, never adapted back to the legacy meaning steps; and only CEE's own in-process writer can ask for
 * that (`thin_core` + `isAgentSubturnFor`). The discriminating input is a sized risk still carrying the unsized rule's stale mark,
 * which the full projection removes. Synthetic labels; an empty scenario, so a client's first registration is also allowed.
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
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';

type Rec = Record<string, unknown>;
const RISK = 'risk_supplier_delay';
const link = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.01 }, exists_probability: 1, effect_direction: mean < 0 ? 'negative' : 'positive' });
/** Olumi's unsized risk on the goal's path, persisted as left out with the rule's reason, as admission saves it. */
const stored = (risk: Rec = {}) => ({
  goal_node_id: 'g_output',
  nodes: [
    { id: 'g_output', kind: 'goal', label: 'Monthly output' },
    { id: 'dec_shift', kind: 'decision', label: 'Shift pattern' },
    { id: 'fac_hours', kind: 'factor', label: 'Weekly hours', category: 'controllable', observed_state: { value: 0.4 } },
    { id: 'opt_now', kind: 'option', label: 'Keep shifts', is_baseline: true, interventions: { fac_hours: 0.4 } },
    { id: 'opt_more', kind: 'option', label: 'Add a shift', interventions: { fac_hours: 0.6 } },
    { id: RISK, kind: 'risk', label: 'Supplier delay', provenance: 'ai_inferred', analysis_participation: 'retained_excluded',
      analysis_participation_reason: 'unsized_olumi_risk', ...risk },
  ],
  edges: [
    link('fac_hours', 'g_output', 0.5), link(RISK, 'g_output', -0.3),
    link('dec_shift', 'opt_now'), link('dec_shift', 'opt_more'), link('opt_now', 'fac_hours'), link('opt_more', 'fac_hours'),
  ],
});
const SIZED = { observed_state: { value: 0.2, raw_value: 0.2, source: 'user_edited', extractionType: 'explicit' } };

async function register(payload: Rec, asCeeWriter: boolean) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const opts = { method: 'POST' as const, url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload };
  const res = asCeeWriter ? await injectAsCeeWriter(app, opts) : await app.inject(opts);
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

const LIVING = { aims: [], options: [], factors: [], links: [], risks: [], conditions: [], views: [{ holder: 'us', position: 'wary', quote: null }], history: [] };

describe('/graph/register stores a core postimage as given, and only for CEE\'s own writer', () => {
  it('CEE\'s writer with thin_core: no meaning step runs (the stale mark is kept as given) and the living model is kept', async () => {
    loadGraph.mockResolvedValue(null);
    const res = await register({ graph: { ...stored(SIZED), living_model: LIVING }, thin_core: true }, true);
    expect(res.statusCode, res.body).toBe(200);
    expect(risk(written()).analysis_participation).toBe('retained_excluded');
    expect(written().living_model).toEqual(LIVING);
  });

  it('CONTROL: CEE\'s writer without thin_core gets the full projection (the stale mark is removed)', async () => {
    loadGraph.mockResolvedValue(null);
    const res = await register({ graph: stored(SIZED) }, true);
    expect(res.statusCode, res.body).toBe(200);
    expect(risk(written()).analysis_participation).toBeUndefined();
  });

  it('NEGATIVE: a client sending thin_core is not CEE\'s writer; the flag is ignored and the full projection runs', async () => {
    loadGraph.mockResolvedValue(null);
    const res = await register({ graph: stored(SIZED), thin_core: true }, false);
    expect(res.statusCode, res.body).toBe(200);
    expect(risk(written()).analysis_participation).toBeUndefined();
  });
});

describe('one write rule per scenario (THIN CORE): a scenario whose meaning is its living model takes only the core write', () => {
  const core = (): Rec => ({ ...stored(SIZED), living_model: LIVING });

  it('a CEE write without thin_core onto a core scenario is refused, and nothing is written', async () => {
    loadGraph.mockResolvedValue(core());
    const res = await register({ graph: stored(SIZED) }, true);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('CORE_SCENARIO_LEGACY_WRITE');
    expect(append).not.toHaveBeenCalled();
  });

  it('the core write replaces a core scenario on its base', async () => {
    loadGraph.mockResolvedValue(core());
    const next = { ...core(), living_model: { ...LIVING, views: [] } };
    const res = await register({ graph: next, thin_core: true, expected_graph_identity_hash: computeGraphIdentityHash(core() as never)!.value,
      operation_id: '0b6f2a9c-1d3e-4f5a-8b7c-9d0e1f2a3b4c' }, true);
    expect(res.statusCode, res.body).toBe(200);
    expect(written().living_model).toEqual(next.living_model);
  });

  it('CONTROL: a legacy scenario still takes the same legacy write', async () => {
    loadGraph.mockResolvedValue(stored());
    const res = await register({ graph: stored(SIZED) }, true);
    expect(res.statusCode, res.body).toBe(200);
  });
});
