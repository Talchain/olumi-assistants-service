/**
 * ⛔ THE SCENARIO READ RUNS NONE OF THE LEGACY READ PRODUCERS (inventory F3, PR-A then PR-C). The read serves every reload,
 * every core turn's read and every program save's readback. It ran the legacy goal-scope claim reader, today-part notes, the
 * analysis reader and its claim permissions, the admission projection and, on a reload, the goal-chance egress gate over the
 * stored words, the answer offers and the changed-since-Run marks. Through the REAL read route, with a mock store and spies
 * that call the real functions: a program read calls none of them and serves its own view and readiness; since PR-C a read of
 * the SAME graph with no program calls none of them either and serves no analysis. Each probe counts a direct call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = 'f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c';

const spies = vi.hoisted(() => ({ scope: vi.fn(), today: vi.fn(), egress: vi.fn(), analysis: vi.fn(), claims: vi.fn() }));
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
vi.mock('../../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js')>();
  spies.egress.mockImplementation(actual.withEstimateGoalPointsAtEgress);
  return { ...actual, withEstimateGoalPointsAtEgress: spies.egress };
});
// PR-C: the legacy analysis reader and its claim permissions.
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

/** Each legacy producer, called directly: the probes are live (each spy counts a direct call). */
async function callEachDirectly(): Promise<void> {
  const calls: (() => Promise<unknown>)[] = [
    async () => (await import('../../orchestrator-v5/compose/goal-scope-claim-input.js')).goalScopeClaimInput([], null),
    async () => (await import('../../orchestrator-v5/agent-lane/goal-definition-sum.js')).deriveTodayParts({}),
    async () => (await import('../../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js')).withEstimateGoalPointsAtEgress({ assistant_text: '' }, {} as never),
    async () => (await import('../scenario-graph-analysis-read.js')).readScenarioAnalysis({ scenarioId: SCENARIO, graph: null, requestId: 'r' }),
    async () => (await import('../../orchestrator-v5/agent-lane/first-analysis.js')).claimPermissionsFrom(null, undefined),
  ];
  for (const call of calls) { try { await call(); } catch { /* the call is what counts */ } }
}
const none = () => Object.values(spies).map((spy) => spy.mock.calls.length);

describe('the scenario read runs none of the legacy read producers (inventory F3, PR-A + PR-C)', () => {
  it('the internal read of a program (every core turn, every save readback): none runs; its own readiness and stored Run, no legacy analysis', async () => {
    const body = await internalRead(await storedProgram());
    expect(none()).toEqual([0, 0, 0, 0, 0]);
    expect([body.analysis_state, body.analysis_result]).toEqual([null, null]);
    expect(body.current_read).toEqual({ run_state: null, computed_against_hash: null, current_analysis_hash: null, figures: [],
      analysis_ready: expect.objectContaining({ goal_node_id: 'more_loaves', status: 'ready', may_run: true }) });
    expect(body.analysis_admission).toBeNull();
    expect(body).not.toHaveProperty('goal_scope_reconciliation');
    expect(body).not.toHaveProperty('today_part_notes');
    expect(body.canonical_analysis_view).not.toBeNull();
  });

  it('the reload of a program: its stored words are restored as sent; none runs; no offers and no changed-since-Run marks', async () => {
    const body = await reload(await storedProgram());
    expect(none()).toEqual([0, 0, 0, 0, 0]);
    expect((body.conversation_turns as Rec[]).map((t) => t.assistant_message)).toEqual([SAID]);
    expect((body.conversation_turns as Rec[]).at(-1)).not.toHaveProperty('suggested_actions');
    expect(body).not.toHaveProperty('changed_since_run');
    expect(body).not.toHaveProperty('action_bar');
    // Kept from the retired offers suite (x4 row 9): a restored turn is exactly its four keys.
    expect(Object.keys((body.conversation_turns as Rec[])[0]!)).toEqual(['turn_id', 'created_at', 'user_message', 'assistant_message']);
  });

  it('kept from the retired analysis-read suite: a scenario with no graph yet answers no analysis and spends no fact read; no read carries a prose surface', async () => {
    store.readExistingScenario.mockResolvedValue({ userId: null, graph: null, briefText: BRIEF, analysisInvalidatedAt: null, revision: 1 });
    const app = Fastify();
    await scenarioGraphRoute(app);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
    await app.close();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Rec;
    expect([body.graph_present, body.graph, body.analysis_state, body.analysis_result, body.canonical_analysis_view]).toEqual([false, null, null, null, null]);
    expect(store.readScenarioRunAnalysisFactsFor).not.toHaveBeenCalled();
    for (const prose of ['assistant_text', 'blocks', 'suggested_actions']) expect(body).not.toHaveProperty(prose);
    // CONTRAST: the same read of a program serves its view.
    expect((await internalRead(await storedProgram())).canonical_analysis_view).not.toBeNull();
  });

  it('PR-C: the SAME graph with no program, internal read and reload: none runs either, its words restored as sent, and no analysis, readiness or view; CONTRAST: the program read serves its readiness and view, and each probe counts a direct call', async () => {
    const stored = await storedProgram();
    const plain = await internalRead(withoutProgram(stored));
    expect(none(), 'the internal read').toEqual([0, 0, 0, 0, 0]);
    const reloaded = await reload(withoutProgram(stored));
    expect(none(), 'the reload').toEqual([0, 0, 0, 0, 0]);
    expect([plain.analysis_state, plain.analysis_result, plain.canonical_analysis_view, plain.analysis_admission]).toEqual([null, null, null, null]);
    expect(plain.current_read).toEqual({ run_state: null, computed_against_hash: null, current_analysis_hash: null, figures: [] });
    expect((reloaded.conversation_turns as Rec[]).map((t) => t.assistant_message)).toEqual([SAID]);
    expect(reloaded).not.toHaveProperty('changed_since_run');
    const program = await internalRead(stored);
    expect((program.current_read as Rec).analysis_ready).toMatchObject({ goal_node_id: 'more_loaves' });
    expect(program.canonical_analysis_view).not.toBeNull();
    await callEachDirectly();
    expect(none().every((n) => n === 1), JSON.stringify(none())).toBe(true);
  });
});
