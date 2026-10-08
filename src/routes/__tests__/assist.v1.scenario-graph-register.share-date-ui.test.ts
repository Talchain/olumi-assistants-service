/** Lens3 P1-1: DGAI buildRegistrationGraph omits provenance on every edge. */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: {
  append: vi.fn(), loadGraph: vi.fn(), ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(),
  scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn(),
} }));
vi.mock('../../config/index.js', async original => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../orchestrator-v5/session/index.js', async original => ({
  ...(await original<typeof import('../../orchestrator-v5/session/index.js')>()), getSessionStore: () => store,
}));
vi.mock('../../orchestrator/user-identity.js', async original => ({
  ...(await original<typeof import('../../orchestrator/user-identity.js')>()),
  resolveUserIdentity: async () => ({ mode: 'verified', userId: 'u-1' }),
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';

const SCENARIO = 'b7c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e';
const CARRIER = { role: 'team', team_id: 'team', goal_id: 'goal', deliverable: 'the launch', unresolved_option_ids: ['hire'] };
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Share of the launch done by April' },
    { id: 'team', kind: 'factor', label: "Today's team", category: 'external', observed_state: { value: 0.77 } },
    { id: 'decision', kind: 'decision', label: 'How to launch' },
    { id: 'hire', kind: 'option', label: 'Hire', interventions: {} },
  ],
  edges: [
    { from: 'team', to: 'goal', strength: { mean: 1, std: 0.01 }, exists_probability: 1,
      effect_direction: 'positive', provenance: { source: 'cee_hypothesis', share_by_date: CARRIER } },
    { from: 'decision', to: 'hire', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};
type Rec = Record<string, unknown>;
const base = () => projectGraphForPersistence(structuredClone(GRAPH));

beforeEach(() => {
  vi.resetAllMocks();
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.loadGraph.mockResolvedValue(base());
  store.append.mockResolvedValue({ id: 'turn-1' });
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
});

async function post(graph: unknown) {
  const app = Fastify();
  await registerRoute(app);
  const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  await app.close();
  return response;
}

describe('share-by-date registration verifies the final carried graph', () => {
  it('L3-P1-1 UI-shaped edge without provenance re-registers with 200 and restores the held carrier', async () => {
    const ui = { ...structuredClone(GRAPH), edges: GRAPH.edges.map(e => ({
      from: e.from, to: e.to, strength: { ...e.strength }, exists_probability: e.exists_probability,
      effect_direction: e.effect_direction,
    })) };
    expect(ui.edges[0]).not.toHaveProperty('provenance');
    const response = await post(ui);
    expect(response.statusCode, response.body).toBe(200);
    expect(store.append).toHaveBeenCalledTimes(1);
    const written = (store.append.mock.calls[0]![0] as { graph: { edges: Rec[] } }).graph;
    expect(written.edges[0]?.provenance).toEqual(GRAPH.edges[0]!.provenance);
  });

  it.each(['forge', 'drop link'])('L3-P1-1 control: an explicit %s still refuses with words and writes nothing', async mode => {
    const submitted = structuredClone(GRAPH);
    if (mode === 'forge') submitted.edges[0]!.provenance!.share_by_date.unresolved_option_ids = [];
    else submitted.edges.shift();
    const response = await post(submitted);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.body).toContain('SHARE_BY_DATE_SERVER_OWNED');
    expect(response.body).toContain('Nothing was written');
    expect(store.append).not.toHaveBeenCalled();
  });
});
