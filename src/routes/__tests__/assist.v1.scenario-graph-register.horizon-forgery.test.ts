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
  getSessionStore: () => store,
}));

const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { stripModelAuthoredGoalThreshold } from '../../adapters/llm/normalisation.js';
import { PIPELINE_OWNED_ROOTS, stripPipelineOwnedFromAddOperations } from '../../orchestrator-v5/graph-management/field-safety.js';
import { goalHorizonVerdict } from '../../orchestrator-v5/goal-target/goal-horizon-verdict.js';

type Rec = Record<string, any>;
const graph = () => ({ nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR', goal_horizon_months: 12 }], edges: [] });
async function register(graph: unknown) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  try {
    return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  } finally { await app.close(); }
}
const written = () => projectGraphForPersistence((append.mock.calls[0]![0] as Rec).graph as never) as Rec;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  scenarioExists.mockResolvedValue(true);
  append.mockResolvedValue({ id: 'turn-1' });
  loadGraph.mockResolvedValue(null);
  readCommittedTurn.mockResolvedValue(null);
  readMostRecentPendingActions.mockResolvedValue([]);
});

describe('S4 DL Q1: register cannot forge a parked horizon attestation', () => {
  it('strips the forged triple before storage and keeps the horizon withheld', async () => {
    const sent = graph();
    Object.assign(sent.nodes[0]!, { horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: 12 });
    const res = await register(sent);
    expect(res.statusCode, res.body).toBe(200);
    const stored = written();
    for (const field of ['horizon_basis', 'horizon_basis_source', 'horizon_basis_months']) {
      expect((append.mock.calls[0]![0] as Rec).graph.nodes[0]).not.toHaveProperty(field);
      expect(stored.nodes[0]).not.toHaveProperty(field);
    }
    expect(goalHorizonVerdict(stored)).toBe('withhold');
  });
  it('the draft and add-node doors also strip every member of the triple', () => {
    const forged = { ...graph().nodes[0]!, horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: 12 };
    const draft = { nodes: [{ ...forged }] };
    const removed = stripModelAuthoredGoalThreshold(draft);
    const added = stripPipelineOwnedFromAddOperations([{ op: 'add_node', value: forged }]);
    for (const field of ['horizon_basis', 'horizon_basis_source', 'horizon_basis_months']) {
      expect(PIPELINE_OWNED_ROOTS.has(field)).toBe(true);
      expect(removed.fields).toContain(field);
      expect(draft.nodes[0]).not.toHaveProperty(field);
      expect(added.operations[0]!.value).not.toHaveProperty(field);
    }
    expect(added.operations[0]!.value).toMatchObject({ id: 'mrr', kind: 'goal' });
  });
  it('CONTROL: the same graph without the triple registers normally', async () => {
    const res = await register(graph());
    expect(res.statusCode, res.body).toBe(200);
    expect(written().nodes[0]).toMatchObject(graph().nodes[0]!);
    expect(goalHorizonVerdict(written())).toBe('withhold');
  });
});
