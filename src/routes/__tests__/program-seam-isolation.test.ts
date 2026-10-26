/**
 * ⛔ A MODEL PROGRAM NEVER ENTERS THE LEGACY CODE AROUND THE MODEL (spec §3 and §8; DL 26 Oct). Through the REAL routes, with a
 * mock store (nothing reaches a database) and spies that call the real functions: a program's read, write and browser turn
 * never invoke the legacy analysis composer, action ranker, Living Model reader, kind repair, event_risk contract or legacy
 * turn route. Each row has its contrast: the SAME graph with no program still runs every one of them. Synthetic bakery.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
const { ORIGIN } = vi.hoisted(() => ({ ORIGIN: 'https://staging--olumi.netlify.app' }));

const spies = vi.hoisted(() => ({ compose: vi.fn(), rank: vi.fn(), living: vi.fn(), kind: vi.fn(), eventRisk: vi.fn() }));
vi.mock('../../orchestrator-v5/compose/analysis-state-v1.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/compose/analysis-state-v1.js')>();
  spies.compose.mockImplementation(actual.composeAnalysisStateV1);
  return { ...actual, composeAnalysisStateV1: spies.compose };
});
vi.mock('../../orchestrator-v5/agent-lane/actions/rank.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/actions/rank.js')>();
  spies.rank.mockImplementation(actual.actionBarOf);
  return { ...actual, actionBarOf: spies.rank };
});
vi.mock('../../orchestrator-v5/path-b/living-model/view.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/path-b/living-model/view.js')>();
  spies.living.mockImplementation(actual.livingViewOf);
  return { ...actual, livingViewOf: spies.living };
});
vi.mock('../../orchestrator-v5/graph-registration/normalise-node-kind.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/graph-registration/normalise-node-kind.js')>();
  spies.kind.mockImplementation(actual.normaliseGraphNodeKindField);
  return { ...actual, normaliseGraphNodeKindField: spies.kind };
});
vi.mock('../../schemas/event-risk.js', async (load) => {
  const actual = await load<typeof import('../../schemas/event-risk.js')>();
  spies.eventRisk.mockImplementation(actual.eventRiskIngressIssues);
  return { ...actual, eventRiskIngressIssues: spies.eventRisk };
});
vi.mock('../../config/index.js', async (load) => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false },
    proxy: { ...actual.config.proxy, browserProxyEnabled: true, browserProxyAllowedOrigins: ORIGIN, proxyV5Target: 'orchestrator' } } };
});
vi.mock('../../utils/telemetry.js', async (load) => {
  const actual = await load<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});
const append = vi.fn();
const loadGraph = vi.fn();
const store = { append, loadGraph, ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn(),
  readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(), readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (load) => ({
  ...(await load<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (load) => ({ ...(await load<Record<string, unknown>>()), resolveUserIdentity }));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { proxyV5TurnRoute } from '../proxy-v5-turn.js';
import proxyV5TurnStreamRoute, { PROXY_STREAMED_TURN_ROUTE } from '../proxy-v5-turn-stream.js';
import { scenarioOwnershipPlugin } from '../../plugins/scenario-ownership.js';
import { coreActionBarOf } from '../../orchestrator-v5/core-route/action-bar.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { bakery, BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';

type Rec = Record<string, unknown>;
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
  for (const read of [store.readRecent, store.readFactsFor, store.readFactsWithTurnFor]) read.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
});

const programOf = () => withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
/** The same graph with no program: its living model loses only the discriminator, as a non-program scenario's would. */
const withoutProgram = (g: Rec): Rec => { const { living_model: _program, ...plain } = g; return plain; };

async function register(graph: Rec) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const res = await injectAsCeeWriter(app, { method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph, thin_core: true, brief_text: BRIEF } });
  await app.close();
  return res;
}
/** The stored program, as the REAL register wrote it. */
async function storedProgram(): Promise<Rec> {
  const { graph } = programOf();
  const res = await register(graph);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(JSON.stringify((append.mock.calls[0]![0] as Rec).graph)) as Rec;
}
async function read(graph: Rec, payload: Rec = {}, headers: Record<string, string> = {}) {
  store.readExistingScenario.mockResolvedValue({ userId: null, graph: JSON.parse(JSON.stringify(graph)), briefText: BRIEF, analysisInvalidatedAt: null, revision: 1 });
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload, headers });
  await app.close();
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Rec;
}

describe('item 1: the legacy analysis reader and composer never run on a program read', () => {
  it('a program read: no fact read, no composed state (analysis_state null, never `never_run`); its stored Run and its own readiness stand', async () => {
    const stored = await storedProgram();
    spies.compose.mockClear();
    const body = await read(stored);
    expect(spies.compose).not.toHaveBeenCalled();
    expect(store.readScenarioRunAnalysisFactsFor).not.toHaveBeenCalled();
    expect([body.analysis_state, body.analysis_result]).toEqual([null, null]);
    expect((body.current_read as Rec).run_state).toBeNull();
    expect((body.current_read as Rec).analysis_ready).toMatchObject({ goal_node_id: 'more_loaves', status: 'ready', may_run: true });
    // The stored Run is what the read shows, exactly as before.
    const run = ((stored.living_model as Rec).runs as Rec[])[0]!;
    expect(stableStringify({ ...(body.canonical_analysis_view as Rec), staleness: null, run: null }))
      .toBe(stableStringify({ ...((run.result as Rec).canonical_analysis_view as Rec), staleness: null, run: null }));
  });

  it('CONTRAST: the SAME graph with no program still reads its facts and composes its state (`never_run`, no Run yet)', async () => {
    const stored = await storedProgram();
    spies.compose.mockClear();
    const body = await read(withoutProgram(stored));
    expect(spies.compose).toHaveBeenCalledTimes(1);
    expect(store.readScenarioRunAnalysisFactsFor).toHaveBeenCalled();
    expect(((body.analysis_state as Rec).run_state as Rec).kind).toBe('never_run');
  });
});

describe('item 2: the legacy action ranker never runs on a program (reload and core turn)', () => {
  const conversation = { include_conversation_turns: true };
  it.each([['the default lane', {}], ['the core lane', { 'x-olumi-ai-mode': 'core' }]] as const)('a program reload on %s: no ranking and no bar', async (_lane, headers) => {
    const stored = await storedProgram();
    const body = await read(stored, conversation, headers);
    expect(spies.rank).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('action_bar');
    // The core turn ranks from its own read's body (`core-turn.ts` `coreActionBarOf(scenarioId, after.body)`): none either.
    expect(coreActionBarOf(SCENARIO, body)).toBeUndefined();
    expect(spies.rank).not.toHaveBeenCalled();
  });

  it.each([['the default lane', {}], ['the core lane', { 'x-olumi-ai-mode': 'core' }]] as const)('CONTRAST: the SAME graph with no program is ranked on %s', async (_lane, headers) => {
    const stored = await storedProgram();
    await read(withoutProgram(stored), conversation, headers);
    expect(spies.rank).toHaveBeenCalledTimes(1);
  });
});

describe('item 4 (on the read): the Living Model reader never runs on a program', () => {
  it('a program read never calls `livingViewOf`; the same graph with no program does', async () => {
    const stored = await storedProgram();
    const program = await read(stored);
    expect(spies.living).not.toHaveBeenCalled();
    expect(program.withheld).toBeNull();
    await read({ ...withoutProgram(stored), living_model: { not: 'a program' } });
    expect(spies.living).toHaveBeenCalledTimes(1);
  });
});

describe('item 3: a program write never enters the legacy kind repair or event_risk contract', () => {
  it('CEE\'s program write: neither runs, and the program is stored as given', async () => {
    const { graph } = programOf();
    const res = await register(graph);
    expect(res.statusCode, res.body).toBe(200);
    expect(spies.kind).not.toHaveBeenCalled();
    expect(spies.eventRisk).not.toHaveBeenCalled();
    expect(JSON.stringify(((append.mock.calls[0]![0] as Rec).graph as Rec).living_model)).toBe(JSON.stringify(graph.living_model));
  });

  it('CONTRAST: the SAME graph with no program, as a core write, still runs both', async () => {
    const { graph } = programOf();
    await register(withoutProgram(graph));
    expect(spies.kind).toHaveBeenCalledTimes(1);
    expect(spies.eventRisk).toHaveBeenCalledTimes(1);
  });
});

describe('item 5: a browser turn never reaches a legacy turn route (inventory F1b: every mode is the core route\'s)', () => {
  async function proxied(graph: Rec | null, mode: string | undefined, url = '/proxy/v5/turn') {
    // A guest scenario (no owner), as a visitor with no sign-in uses it: the ownership hook admits the turn on this snapshot.
    store.readExistingScenario.mockResolvedValue(graph === null ? null : { userId: null, graph, briefText: BRIEF, analysisInvalidatedAt: null, revision: 1 });
    const reached: string[] = [];
    const app = Fastify();
    await app.register(scenarioOwnershipPlugin);
    // Each internal turn route as a double, admitted by the same hook as the real ones.
    for (const path of ['/agent/v1/turn', '/orchestrate/v2/turn', '/agent/v1/core-turn']) {
      app.post(path, { config: { scenarioId: { from: 'body', key: 'scenario_id' } } }, async () => { reached.push(path); return { ok: true }; });
    }
    await app.register(proxyV5TurnRoute);
    await app.register(proxyV5TurnStreamRoute);
    await app.ready();
    const res = await app.inject({ method: 'POST', url, headers: { origin: ORIGIN, 'content-type': 'application/json', ...(mode ? { 'x-olumi-ai-mode': mode } : {}) },
      payload: { kind: 'message', scenario_id: SCENARIO, turn_id: 'f0e1d2c3-b4a5-4968-8776-655443322110', message: 'What does the model hold?' } });
    await app.close();
    return { res, reached };
  }

  it.each([['?ai=openai', 'openai'], ['?ai=conventional', 'conventional'], ['?ai=core (PATH-B\'s old surface)', 'core'], ['no mode (the deployment default)', undefined]] as const)(
    'F1b: a program on %s goes to the core route, and no legacy turn route runs', async (_label, mode) => {
      const { res, reached } = await proxied(await storedProgram(), mode);
      expect(res.statusCode, res.body).toBe(200);
      expect(reached).toEqual(['/agent/v1/core-turn']);
      expect(res.headers['x-olumi-ai-mode']).toBe('core-route');
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    });

  it('the streamed sibling (one rule, not two): a program on ?ai=openai streams from the core route, and no legacy turn route runs', async () => {
    const { reached } = await proxied(await storedProgram(), 'openai', PROXY_STREAMED_TURN_ROUTE);
    expect(reached).toEqual(['/agent/v1/core-turn']);
  });

  it('F1b: the same graph with no program, and a new scenario, go to the core route on every mode too (the route refuses the former): no legacy turn route runs', async () => {
    const stored = await storedProgram();
    for (const mode of ['openai', 'conventional', undefined]) {
      expect((await proxied(withoutProgram(stored), mode)).reached, String(mode)).toEqual(['/agent/v1/core-turn']);
      expect((await proxied(null, mode)).reached, String(mode)).toEqual(['/agent/v1/core-turn']);
    }
  });
});
