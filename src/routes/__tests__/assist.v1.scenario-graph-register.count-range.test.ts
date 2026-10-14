import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/** MC: the real registration seam admits only quote-bound count ranges on create-only construction. */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, resolveUserIdentity } = vi.hoisted(() => ({
  store: { append: vi.fn(), loadGraph: vi.fn(), ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(),
    scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn() },
  resolveUserIdentity: vi.fn(),
}));
vi.mock('../../orchestrator-v5/session/index.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()), getSessionStore: () => withScenarioRevision(store),
}));
vi.mock('../../orchestrator/user-identity.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../orchestrator/user-identity.js')>()), resolveUserIdentity,
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';

const SCENARIO = 'b63d8672-0000-4000-8000-0000000b63d8';
const BRIEF = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const RANGE = { low: 80, high: 250, meaning: 'likely_range', source: 'brief_extraction', source_quote: BRIEF };
type Rec = Record<string, any>;
function graph(): Rec {
  return {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'Monthly recurring revenue' },
      { id: 'starter_subscribers', kind: 'factor', label: 'Starter subscribers', category: 'controllable',
        observed_state: { value: 0, raw_value: 0, cap: 1000, unit: 'subscribers', source: 'cee_inference' } },
      { id: 'launch', kind: 'option', label: 'Launch starter tier', interventions: { starter_subscribers: {
        value: 0.15, raw_value: 150, unit: 'subscribers', source: 'cee_hypothesis',
        target_match: { node_id: 'starter_subscribers', match_type: 'exact_id', confidence: 'high' }, range: { ...RANGE },
      } } },
    ],
    edges: [{ from: 'starter_subscribers', to: 'goal_mrr', strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9, effect_direction: 'positive' }],
  };
}
const cell = (g: Rec) => g.nodes.find((n: Rec) => n.id === 'launch').interventions.starter_subscribers;

async function register(incoming = graph(), brief = BRIEF, createOnly = true) {
  const app = Fastify();
  try {
    await registerRoute(app);
    return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: {
      graph: incoming, brief_text: brief, ...(createOnly ? { expected_graph_identity_hash: null } : {}),
    } });
  } finally { await app.close(); }
}

beforeEach(() => {
  vi.resetAllMocks();
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.loadGraph.mockResolvedValue(null);
  store.append.mockResolvedValue({ id: 'turn-mc' });
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
});

describe('MC: quote-bound count range at real graph registration', () => {
  it('RED at base: create-only registration stores the user’s count range and cold read retains it', async () => {
    const response = await register();
    expect(response.statusCode, response.body).toBe(200);
    expect(store.append).toHaveBeenCalledOnce();
    const saved = store.append.mock.calls[0]![0].graph;
    const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(saved))));
    expect(cell(reloaded)).toMatchObject({ raw_value: 150, range: RANGE });
    expect(cell(saved).range).toEqual(RANGE);
  });

  it.each([
    ['no stated range', 'The starter tier would win about 150 new subscribers.'],
    ['range for another quantity', 'The Pro tier would win about 150 new subscribers, between 80 and 250.'],
    ['exact count', 'The starter tier would win exactly 150 new subscribers, between 80 and 250.'],
  ])('CONTROL: %s cannot grant registration consent', async (_name, brief) => {
    const response = await register(graph(), brief);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().details.code).toBe('INTERVENTION_RANGE_APPROVAL_REQUIRED');
    expect(store.append).not.toHaveBeenCalled();
  });

  it.each([{ high: 240 }, { source: 'cee_hypothesis' }, { source_quote: 'invented quote' }])(
    'CONTROL: changed or invented range metadata still needs approval: %j', async change => {
      const incoming = graph();
      Object.assign(cell(incoming).range, change);
      expect((await register(incoming)).statusCode).toBe(409);
      expect(store.append).not.toHaveBeenCalled();
    });

  it('CONTROL: ordinary registration cannot grant range consent even with a matching brief', async () => {
    expect((await register(graph(), BRIEF, false)).statusCode).toBe(409);
    expect(store.append).not.toHaveBeenCalled();
  });

  it('CONTROL: an existing model cannot use the create-only exception', async () => {
    const stored = graph();
    delete cell(stored).range;
    store.loadGraph.mockResolvedValue(stored);
    expect((await register()).statusCode).toBe(409);
    expect(store.append).not.toHaveBeenCalled();
  });
});
