import { readFileSync } from 'node:fs';
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
import { horizonSteadyAttested, steadyAttestationKey } from '../../orchestrator-v5/goal-target/horizon-basis.js';
import { goalChanceLicenceOf } from '../../orchestrator-v5/goal-target/goal-chance-licence.js';

type Rec = Record<string, any>;
const fixture = JSON.parse(readFileSync(new URL('../../orchestrator-v5/tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as Rec;
const seed = (): Rec => projectGraphForPersistence(structuredClone(fixture.graph_with_target)) as Rec;
const goalOf = (graph: Rec): Rec => graph.nodes.find((node: Rec) => node.id === 'monthly_cancellations');
const fields = ['horizon_basis', 'horizon_basis_source', 'horizon_basis_months', 'horizon_basis_key'];

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

describe('register/import cannot attest a steady goal — real register route, atomic-writer store double', () => {
  const attested = (): Rec => {
    const graph = seed();
    const goal = goalOf(graph);
    Object.assign(goal, { goal_horizon_months: 9, horizon_basis: 'steady_attested',
      horizon_basis_source: 'user_stated', horizon_basis_months: 9 });
    goal.horizon_basis_key = steadyAttestationKey(goal, SCENARIO);
    return graph;
  };
  const register = async (graph: Rec): Promise<Rec> => {
    const app = Fastify();
    await registerRoute(app);
    await app.ready();
    try {
      const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
      expect(res.statusCode, res.body).toBe(200);
      expect(append).toHaveBeenCalledTimes(1);
      return (append.mock.calls[0]![0] as Rec).graph as Rec;
    } finally {
      await app.close();
    }
  };

  it.each([false, true])('client all-four user_stated fields are stripped before storage (stored model, unattested: %s)', async existing => {
    const graph = attested();
    expect(horizonSteadyAttested(graph, SCENARIO), 'positive control: even a matching client key must be stripped').toBe(true);
    const unattested = structuredClone(graph);
    for (const field of fields) delete goalOf(unattested)[field];
    loadGraph.mockResolvedValue(existing ? unattested : null);
    const stored = await register(graph);
    for (const field of fields) expect(goalOf(stored)).not.toHaveProperty(field);
    expect(horizonSteadyAttested(stored, SCENARIO)).toBe(false);
    const licence = goalChanceLicenceOf({ option_comparison: [
      { option_id: 'a', probability_of_goal: 0.62 }, { option_id: 'b', probability_of_goal: 0.41 },
    ], inference_warnings: [] }, stored, goalOf(graph).id, undefined, undefined, stored, SCENARIO);
    expect(licence, 'control: a valid chance licence survives the import').not.toBeNull();
    expect(licence).not.toHaveProperty('horizon_basis');
  });

  it('a save of a model the user already attested keeps the SERVER\'s stored answer, never the client\'s bytes', async () => {
    const storedBefore = attested();
    loadGraph.mockResolvedValue(structuredClone(storedBefore));
    // The client omits the fields entirely: the stored answer is carried back.
    const omitted = structuredClone(storedBefore);
    for (const field of fields) delete goalOf(omitted)[field];
    const kept = await register(omitted);
    for (const field of fields) expect(goalOf(kept)[field]).toEqual(goalOf(storedBefore)[field]);
    expect(horizonSteadyAttested(kept, SCENARIO)).toBe(true);
    // The client sends a forged key: the stored one wins.
    append.mockClear();
    const forged = structuredClone(storedBefore);
    goalOf(forged).horizon_basis_key = 'f'.repeat(32);
    const kept2 = await register(forged);
    expect(goalOf(kept2).horizon_basis_key).toBe(goalOf(storedBefore).horizon_basis_key);
  });
});
