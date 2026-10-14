import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/**
 * ⭐ A GAUGE SURVIVES THE UI's RE-REGISTER (no-dead-end #2623; MC 21's chain item, code-read on DGAI staging 39e1143f):
 * the UI's register body carries edges WITHOUT `provenance` (buildRegistrationGraph sends from/to/strength/
 * exists_probability/effect_direction/edge_type/origin), and CEE's register restores each unchanged edge's stored
 * provenance WHOLE (`withStoredEdgeFactsWhenUnstated`), so `sized_by_identity: { op: 'gauge' }` is kept. CONTRAST: an edge
 * whose numbers the caller CHANGED stands as sent (by design), and so does its missing marker.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const SCENARIO = 'd9e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60';

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
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../orchestrator-v5/system-events/link-effect-edit.js';
import { mediatorReadings } from '../../orchestrator-v5/agent-lane/mediator-reading.js';

type Rec = Record<string, any>;
const ph = (from: string, to: string, mean: number): Rec => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9,
  effect_direction: mean < 0 ? 'negative' : 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
const structural = (from: string, to: string): Rec => ({ from, to, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' });
const drafted = (): Rec => ({
  goal_node_id: 'mrr',
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.5, raw_value: 100000, cap: 200000, unit: '£/month', source: 'user_override' } },
    { id: 'dec', kind: 'decision', label: 'Pricing' },
    { id: 'price', kind: 'factor', label: 'Pro plan price', category: 'controllable', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
    { id: 'strain', kind: 'factor', label: 'Support capacity strain' },
    { id: 'opt_hold', kind: 'option', label: 'Hold price', is_baseline: true, interventions: { price: 0.49 } },
    { id: 'opt_raise', kind: 'option', label: 'Raise price', interventions: { price: 0.59 } },
  ],
  edges: [ph('price', 'strain', 0.4), ph('strain', 'mrr', -0.3), structural('dec', 'opt_hold'), structural('dec', 'opt_raise'),
    structural('opt_hold', 'price'), structural('opt_raise', 'price')],
});
/** The stored graph after the user's one end-to-end answer: price → strain sized, strain → MRR the gauge. */
function answered(): Rec {
  const g = drafted();
  const effect = { amount: -1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£' };
  const p = { persistedGraph: g, from: 'price', to: 'strain', effect, quote: 'every £1 on the price loses us about £1,200 a month of MRR through support strain',
    expected: { graph_hash: computeAnalysisAffectingGraphHash(g as never)!, edge_token: linkEffectEdgeToken(g, 'price', 'strain')! } };
  const r = applyLinkEffectEdit({ ...p, reading_token: linkEffectReadingToken(p) });
  if (r.kind !== 'mutated') throw new Error(JSON.stringify(r));
  return projectGraphForPersistence(r.mutatedGraph as never) as Rec;
}
/** What the UI's register body carries for an edge: no provenance (buildRegistrationGraph.ts:256-277). */
const uiShaped = (g: Rec): Rec => ({ ...g, edges: g.edges.map(({ from, to, strength, exists_probability, effect_direction, edge_type, origin }: Rec) =>
  ({ from, to, strength, exists_probability, effect_direction, ...(edge_type !== undefined ? { edge_type } : {}), ...(origin !== undefined ? { origin } : {}) })) });

async function register(graph: unknown) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  await app.close();
  return res;
}
const written = () => projectGraphForPersistence((append.mock.calls[0]![0] as Rec).graph as never) as Rec;
const gaugeEdge = (g: Rec) => g.edges.find((e: Rec) => e.from === 'strain' && e.to === 'mrr');

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

describe('a gauge survives the UI re-register (#2623 chain item)', () => {
  it('⭐ an unchanged gauge edge keeps sized_by_identity, so M keeps its unit after the re-register', async () => {
    const stored = answered();
    expect(gaugeEdge(stored).provenance.sized_by_identity, 'CONTROL: the answer stored the gauge').toEqual({ op: 'gauge' });
    loadGraph.mockResolvedValue(stored);
    const res = await register(uiShaped(stored));
    expect(res.statusCode, res.body).toBe(200);
    expect(gaugeEdge(written()).provenance.sized_by_identity).toEqual({ op: 'gauge' });
    expect(mediatorReadings(written()).get('strain')).toMatchObject({ via: 'gauge', stored: true });
  });
  it('CONTRAST: an edge whose numbers the caller changed stands as sent — no marker carried, so no stored gauge', async () => {
    const stored = answered();
    loadGraph.mockResolvedValue(stored);
    const sent = uiShaped(stored);
    gaugeEdge(sent).strength = { mean: -0.4, std: 0.1 };
    const res = await register(sent);
    expect(res.statusCode, res.body).toBe(200);
    expect(gaugeEdge(written()).provenance?.sized_by_identity).toBeUndefined();
    expect(mediatorReadings(written()).has('strain')).toBe(false);
  });
});
