/**
 * A PANEL ANSWER'S ORIGIN SURVIVES A COLD READ (S1, P1 demo journey, 30 Oct). When the owner applies a participant's panel
 * answer, the figure is saved as the participant's (`author_id`, `party`) and approved by the owner (`approved_by`):
 * `core-turn.route.test.ts` S1 (a) proves the write. This proves the reload: through the REAL read route with a mock store,
 * the stored program (the bakery, its `sell_through` record as S1 (a) saves it) reads back with all three, unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = '5a1d0c2e-3b4f-4a6d-8e9f-0a1b2c3d4e5f';

vi.mock('../../config/index.js', async (load) => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', async (load) => {
  const actual = await load<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});
const store = { append: vi.fn(), loadGraph: vi.fn(), ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(),
  readMostRecentPendingActions: vi.fn(), readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(),
  readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn(), readLatestAnswerOffers: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (load) => ({
  ...(await load<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (load) => ({ ...(await load<Record<string, unknown>>()), resolveUserIdentity }));

import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { bakery, BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';

type Rec = Record<string, any>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'owner-1' });
  store.scenarioExists.mockResolvedValue(true);
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  store.loadGraph.mockResolvedValue(null);
  store.readRecent.mockResolvedValue([]);
  store.readLatestAnswerOffers.mockResolvedValue(null);
  for (const read of [store.readFactsFor, store.readFactsWithTurnFor]) read.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('a panel answer\'s origin survives a cold read', () => {
  it('the stored figure reads back as the participant\'s (author_id, party), approved by the owner (approved_by)', async () => {
    const m = bakery();
    // `sell_through` as S1 (a) saves Sam's 0.6: Sam's words, Sam's figure, the owner's approval.
    m.quantities = m.quantities.map((q) => (q.id === 'sell_through'
      ? { ...q, value: 0.6, low: null, high: null, range_kind: null, status: 'known', author: 'person', quote: '0.6', party: 'Sam', basis: null,
        author_id: 'p-sam', approval: 'approved', approved_by: 'owner-1' } : q));
    const { graph } = withNewRun({ model_program: MODEL_PROGRAM, canonical: m, seed: seedOf(SCENARIO), person_words: [BRIEF, '0.6'], runs: [] });
    store.readExistingScenario.mockResolvedValue({ userId: 'owner-1', graph: JSON.parse(JSON.stringify(graph)), briefText: BRIEF, analysisInvalidatedAt: null, revision: 1 });
    const app = Fastify();
    await scenarioGraphRoute(app);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { fresh: true } });
    await app.close();
    expect(res.statusCode, res.body).toBe(200);
    const read = ((res.json() as Rec).graph.living_model.canonical.quantities as Rec[]).find((q) => q.id === 'sell_through')!;
    expect([read.value, read.author_id, read.approved_by, read.party]).toEqual([0.6, 'p-sam', 'owner-1', 'Sam']);
    // CONTRAST: a figure the owner did not touch keeps no participant and no approver of theirs.
    const other = ((res.json() as Rec).graph.living_model.canonical.quantities as Rec[]).find((q) => q.id === 'base_sales')!;
    expect([other.author_id, other.party]).not.toEqual(['p-sam', 'Sam']);
  });
});
