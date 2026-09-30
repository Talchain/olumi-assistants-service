/**
 * ⭐ A NODE'S UNIT READING SURVIVES THE REGISTER WRITE AND THE RUN'S SNAPSHOT PARSE (`@talchain/schemas` 0.67.0
 * `NodeV3Schema.unit_reading`, MG; PTL A — Paul's funding goal read in GBP from "deals between £1-2 million"; P0 SHARED
 * DATA 5914707462, AIQ 5914471584). CEE's `NodeV3` strips undeclared keys, so a construction writer's reading would be
 * lost on the Run path without the declaration: the contrast row shows the same parse dropping an undeclared key.
 * A unit is a READING, never a figure: it is out of the analysis hash, so writing one never makes a Run stale.
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
import { GraphV3 } from '../../schemas/cee-v3.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';

type Rec = Record<string, unknown>;
const READING = { unit: 'GBP', source: 'olumi_reading', source_quote: 'investment firms that do deals between £1-2 million' };
const graphWith = (reading?: unknown, extra: Rec = {}) => ({
  goal_node_id: 'securing_funding',
  nodes: [
    { id: 'securing_funding', kind: 'goal', label: 'securing funding', ...(reading === undefined ? {} : { unit_reading: reading }), ...extra },
    { id: 'dec_funding', kind: 'decision', label: 'How to fund' },
    { id: 'fac_outreach', kind: 'factor', label: 'Angel investor outreach', category: 'controllable', observed_state: { value: 0 } },
    { id: 'opt_now', kind: 'option', label: 'Current outreach', is_baseline: true, interventions: { fac_outreach: 0 } },
    { id: 'opt_angel', kind: 'option', label: 'Angel bridge outreach', interventions: { fac_outreach: 0.2 } },
  ],
  edges: [
    { from: 'fac_outreach', to: 'securing_funding', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'dec_funding', to: 'opt_now', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_funding', to: 'opt_angel', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_now', to: 'fac_outreach', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_angel', to: 'fac_outreach', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
});

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

describe("a goal's unit reading survives the write and the Run's parse (0.67.0)", () => {
  it('⭐ the written graph and its persisted read keep `unit_reading` verbatim', async () => {
    const res = await register(graphWith(READING));
    expect(res.statusCode, res.body).toBe(200);
    expect(node(projectGraphForPersistence(written() as never) as Rec, 'securing_funding').unit_reading).toEqual(READING);
  });

  it("RED: the Run's snapshot parse (`GraphV3`) keeps it; CONTRAST: it drops an undeclared key on the same node", async () => {
    const res = await register(graphWith(READING, { zz_undeclared: 'x' }));
    expect(res.statusCode, res.body).toBe(200);
    const parsed = GraphV3.safeParse(projectGraphForPersistence(written() as never));
    expect(parsed.success).toBe(true);
    const goal = node((parsed as { data: Rec }).data, 'securing_funding');
    expect(goal.unit_reading).toEqual(READING);
    expect(goal.zz_undeclared).toBeUndefined();
  });

  it('a reading carrying a VALUE (a unit is never a figure), or with no author, is dropped — never a reason to refuse the graph', () => {
    for (const bad of [{ ...READING, value: 1200000 }, { unit: 'GBP', source_quote: READING.source_quote }, { ...READING, source: 'brief_extraction' }]) {
      const parsed = GraphV3.safeParse(graphWith(bad));
      expect(parsed.success).toBe(true);
      expect(node((parsed as { data: Rec }).data, 'securing_funding').unit_reading).toBeUndefined();
    }
  });

  it('writing a unit reading never makes a Run stale: the ANALYSIS hash is unchanged; the IDENTITY hash moves', () => {
    const without = GraphV3.parse(graphWith());
    const withReading = GraphV3.parse(graphWith(READING));
    expect(computeAnalysisAffectingGraphHash(withReading as never)).toEqual(computeAnalysisAffectingGraphHash(without as never));
    expect(computeGraphIdentityHash(withReading as never)?.value).not.toBe(computeGraphIdentityHash(without as never)?.value);
  });
});
