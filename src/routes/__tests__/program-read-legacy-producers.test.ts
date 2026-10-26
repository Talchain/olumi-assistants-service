/**
 * ⛔ A MODEL PROGRAM'S READ RUNS NONE OF THE LEGACY READ PRODUCERS (inventory F3, PR-A). The scenario read serves every reload,
 * every core turn's read and every program save's readback, and it ran the legacy goal-scope claim reader, today-part notes,
 * the admission projection and, on a reload, the goal-chance egress gate over the stored words and the answer-offers leg, on a
 * program graph. Through the REAL read route, with a mock store and spies that call the real functions: a program read calls
 * none of them and serves the same body; the SAME graph with no program still calls every one (each row's contrast).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = 'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c';

const spies = vi.hoisted(() => ({ scope: vi.fn(), today: vi.fn(), admission: vi.fn(), egress: vi.fn(), offers: vi.fn(), analysis: vi.fn(), claims: vi.fn(), changed: vi.fn() }));
vi.mock('../../orchestrator-v5/compose/goal-scope-claim-input.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/compose/goal-scope-claim-input.js')>();
  spies.scope.mockImplementation(actual.goalScopeClaimInput);
  return { ...actual, goalScopeClaimInput: spies.scope };
});
vi.mock('../../orchestrator-v5/agent-lane/goal-definition-sum.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/goal-definition-sum.js')>();
  spies.today.mockImplementation(actual.deriveTodayParts);
  return { ...actual, deriveTodayParts: spies.today };
});
vi.mock('../analysis-admission-projection.js', async (load) => {
  const actual = await load<typeof import('../analysis-admission-projection.js')>();
  spies.admission.mockImplementation(actual.projectAnalysisAdmission);
  return { ...actual, projectAnalysisAdmission: spies.admission };
});
vi.mock('../../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js')>();
  spies.egress.mockImplementation(actual.withEstimateGoalPointsAtEgress);
  return { ...actual, withEstimateGoalPointsAtEgress: spies.egress };
});
vi.mock('../../orchestrator-v5/agent-lane/answer-offers-reload.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/answer-offers-reload.js')>();
  spies.offers.mockImplementation(actual.answerOffersForReload);
  return { ...actual, answerOffersForReload: spies.offers };
});
// PR-C: the legacy analysis reader, its claim permissions and the changed-since-Run marks.
vi.mock('../scenario-graph-analysis-read.js', async (load) => {
  const actual = await load<typeof import('../scenario-graph-analysis-read.js')>();
  spies.analysis.mockImplementation(actual.readScenarioAnalysis);
  return { ...actual, readScenarioAnalysis: spies.analysis };
});
vi.mock('../../orchestrator-v5/agent-lane/first-analysis.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/first-analysis.js')>();
  spies.claims.mockImplementation(actual.claimPermissionsFrom);
  return { ...actual, claimPermissionsFrom: spies.claims };
});
vi.mock('../../orchestrator-v5/context/changed-since-run.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/context/changed-since-run.js')>();
  spies.changed.mockImplementation(actual.readChangedSinceRun);
  return { ...actual, readChangedSinceRun: spies.changed };
});
vi.mock('../../config/index.js', async (load) => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', async (load) => {
  const actual = await load<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});
const append = vi.fn();
const loadGraph = vi.fn();
const store = { append, loadGraph, ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn(),
  readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(), readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn(),
  readLatestAnswerOffers: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (load) => ({
  ...(await load<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (load) => ({ ...(await load<Record<string, unknown>>()), resolveUserIdentity }));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { bakery, BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { AGENT_ANSWER_REQUEST_HASH_PREFIX } from '../../orchestrator-v5/session/conversation-as-seen.js';

type Rec = Record<string, unknown>;
const SAID = 'In this model, buying the second oven has about a 62% chance of reaching 380 loaves a week.';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  append.mockResolvedValue({ id: 'turn-1' });
  loadGraph.mockResolvedValue(null);
  // One answer the person saw, and the offers stored with it: the reload restores the words and re-derives the offers.
  store.readRecent.mockResolvedValue([{ turn_id: 'turn-a', created_at: '2026-10-26T12:00:00.000Z', request_hash: `${AGENT_ANSWER_REQUEST_HASH_PREFIX}x`,
    user_message: 'Should we buy the second oven?', assistant_message: SAID }]);
  store.readLatestAnswerOffers.mockResolvedValue({ turn_id: 'turn-a', suggested_actions: [], run_key: null });
  for (const read of [store.readFactsFor, store.readFactsWithTurnFor]) read.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
});

/** The program as the REAL register stores it. */
async function storedProgram(): Promise<Rec> {
  const { graph } = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const res = await injectAsCeeWriter(app, { method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph, thin_core: true, brief_text: BRIEF } });
  await app.close();
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(JSON.stringify((append.mock.calls[0]![0] as Rec).graph)) as Rec;
}
/** The same graph with no program: its living model loses only the discriminator. */
const withoutProgram = (g: Rec): Rec => { const { living_model: _program, ...plain } = g; return plain; };
async function read(graph: Rec, payload: Rec): Promise<Rec> {
  store.readExistingScenario.mockResolvedValue({ userId: null, graph: JSON.parse(JSON.stringify(graph)), briefText: BRIEF, analysisInvalidatedAt: null, revision: 1 });
  for (const spy of Object.values(spies)) spy.mockClear();
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload });
  await app.close();
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Rec;
}
/** The read every core turn and every program save's readback makes: fresh, no conversation (`turn-read-cache.ts`). */
const internalRead = (graph: Rec) => read(graph, { fresh: true });
/** The UI's reload: the conversation restored with the model. */
const reload = (graph: Rec) => read(graph, { include_conversation_turns: true });

describe('a program read runs none of the legacy read producers (inventory F3, PR-A + PR-C)', () => {
  it('the internal read (every core turn, every save readback): no goal-scope reader, today-part notes or admission projection; the same readiness, admission and stored Run', async () => {
    const body = await internalRead(await storedProgram());
    expect(spies.scope).not.toHaveBeenCalled();
    expect(spies.today).not.toHaveBeenCalled();
    expect(spies.admission).not.toHaveBeenCalled();
    // PR-C: nor the legacy analysis reader or its claim permissions; the program's readiness is served as its own.
    expect(spies.analysis).not.toHaveBeenCalled();
    expect(spies.claims).not.toHaveBeenCalled();
    expect([body.analysis_state, body.analysis_result]).toEqual([null, null]);
    expect(body.current_read).toEqual({ run_state: null, computed_against_hash: null, current_analysis_hash: null, figures: [],
      analysis_ready: expect.objectContaining({ goal_node_id: 'more_loaves' }) });
    expect(body.analysis_admission).toBeNull();
    expect(body).not.toHaveProperty('goal_scope_reconciliation');
    expect(body).not.toHaveProperty('today_part_notes');
    expect((body.current_read as Rec).analysis_ready).toMatchObject({ goal_node_id: 'more_loaves', status: 'ready', may_run: true });
    expect(body.canonical_analysis_view).not.toBeNull();
  });

  it('CONTRAST: the SAME graph with no program still runs each of them on the internal read', async () => {
    await internalRead(withoutProgram(await storedProgram()));
    expect(spies.analysis).toHaveBeenCalled();
    expect(spies.claims).toHaveBeenCalled();
    expect(spies.scope).toHaveBeenCalled();
    expect(spies.today).toHaveBeenCalled();
    expect(spies.admission).toHaveBeenCalled();
  });

  it('the reload: its stored words are restored as sent, with no egress gate, and no answer offer is re-derived', async () => {
    const body = await reload(await storedProgram());
    expect(spies.egress).not.toHaveBeenCalled();
    expect(spies.offers).not.toHaveBeenCalled();
    // PR-C: no changed-since-Run marks (a program's Run keeps no item marks) and no legacy analysis reader.
    expect(spies.changed).not.toHaveBeenCalled();
    expect(spies.analysis).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('changed_since_run');
    expect((body.conversation_turns as Rec[]).map((t) => t.assistant_message)).toEqual([SAID]);
  });

  it('CONTRAST: the SAME graph with no program still crosses the egress gate and re-derives its offers on reload', async () => {
    const body = await reload(withoutProgram(await storedProgram()));
    expect(spies.egress).toHaveBeenCalled();
    expect(spies.offers).toHaveBeenCalledTimes(1);
    expect(spies.changed).toHaveBeenCalledTimes(1);
    expect(spies.analysis).toHaveBeenCalled();
    expect((body.conversation_turns as Rec[]).map((t) => t.assistant_message)).toEqual([SAID]);
  });
});
