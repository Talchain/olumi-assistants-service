/**
 * Recorded B1-d2 construction -> real register -> persistence projection ->
 * real graph read. Only provider/dispatch, identity and storage are doubles.
 * The basis arm updates the pre-basis recording; the control keeps it intact.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { CandidateModel } from '../../orchestrator-v5/agent-lane/admit-model.js';
import type { InternalDispatch } from '../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import type { SessionStore } from '../../orchestrator-v5/session/store.js';

vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});

vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

const { store, resolveUserIdentity, fetchSpy } = vi.hoisted(() => ({
  store: {
    append: vi.fn<SessionStore['append']>(),
    loadGraph: vi.fn<SessionStore['loadGraph']>(),
    loadGraphAndBriefText: vi.fn<SessionStore['loadGraphAndBriefText']>(),
    ensureScenarioExists: vi.fn<SessionStore['ensureScenarioExists']>(),
    getScenarioOwner: vi.fn<NonNullable<SessionStore['getScenarioOwner']>>(),
    scenarioExists: vi.fn<NonNullable<SessionStore['scenarioExists']>>(),
    readCommittedTurn: vi.fn<NonNullable<SessionStore['readCommittedTurn']>>(),
    readMostRecentPendingActions: vi.fn<SessionStore['readMostRecentPendingActions']>(),
    readRecent: vi.fn<SessionStore['readRecent']>(),
    readScenarioRunAnalysisFactsFor: vi.fn<NonNullable<SessionStore['readScenarioRunAnalysisFactsFor']>>(),
    readAnalysisInvalidatedAt: vi.fn<NonNullable<SessionStore['readAnalysisInvalidatedAt']>>(),
  },
  resolveUserIdentity: vi.fn(),
  fetchSpy: vi.fn<typeof fetch>(async () => { throw new Error('This recorded wire test forbids network requests'); }),
}));

vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => store,
}));

vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator/user-identity.js')>()),
  resolveUserIdentity,
}));

import { buildModelFromBrief, type CallStructuredModel } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import registerRoute from '../assist.v1.scenario-graph-register.js';
import scenarioGraphRoute from '../assist.v1.scenario-graph.js';

const SCENARIO = '00000000-0000-4000-8000-000000000044';
const PRICE = 'Pro plan price';

interface RecordedDraft {
  provider_calls: { output_text: string; request?: { input: string } }[];
}

interface WireNode {
  id: string;
  kind: string;
  label: string;
  observed_state?: { frame_source?: unknown; cap?: number; [key: string]: unknown };
  [key: string]: unknown;
}

interface WireGraph {
  nodes: WireNode[];
  edges: Record<string, unknown>[];
  [key: string]: unknown;
}

const recording = JSON.parse(readFileSync(
  new URL('./fixtures/convention-rescue-b1-d2.json', import.meta.url), 'utf8',
)) as RecordedDraft;
const recordedBrief = recording.provider_calls[0]?.request?.input;
const candidateText = recording.provider_calls.map((call) => call.output_text)
  .filter((text) => typeof text === 'string' && text.trim().length > 0).at(-1);
if (typeof recordedBrief !== 'string' || candidateText === undefined) throw new Error('Recording must contain a brief and candidate');
const brief = recordedBrief;
const candidate = JSON.parse(candidateText) as CandidateModel;

function graphOf(value: unknown): WireGraph {
  expect(value).not.toBeNull();
  expect(value).toBeTypeOf('object');
  const graph = value as WireGraph;
  expect(Array.isArray(graph.nodes)).toBe(true);
  expect(Array.isArray(graph.edges)).toBe(true);
  return graph;
}

function priceOf(graph: WireGraph): WireNode {
  const price = graph.nodes.find((node) => node.label === PRICE);
  expect(price, 'the graph must contain the recorded price factor').toBeDefined();
  if (price === undefined) throw new Error('Price factor missing');
  expect(price.kind).toBe('factor');
  return price;
}

async function construct(model: CandidateModel): Promise<WireGraph> {
  let registered: WireGraph | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = graphOf((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (path.endsWith('/graph')) return { status: 200, json: { graph: registered ?? { nodes: [], edges: [] } } };
    throw new Error(`Unexpected construction dispatch: ${path}`);
  };
  const callStructured = vi.fn<CallStructuredModel>(async () => ({ text: JSON.stringify(model), status: 'completed' }));
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, callStructured);
  expect(result, 'real construction must reach registration').toMatchObject({ ok: true });
  expect(callStructured).toHaveBeenCalled();
  expect(registered).toBeDefined();
  return graphOf(registered);
}

async function register(graph: WireGraph) {
  const app = Fastify();
  try {
    await registerRoute(app);
    await app.ready();
    return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: { graph } });
  } finally {
    await app.close();
  }
}

async function read() {
  const app = Fastify();
  try {
    await scenarioGraphRoute(app);
    await app.ready();
    return await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
  } finally {
    await app.close();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.append.mockResolvedValue({ id: 'turn-1' });
  store.loadGraph.mockResolvedValue(null);
  // The real read route's combined reader consumes the same loadGraph double.
  store.loadGraphAndBriefText.mockImplementation(async (scenarioId) => ({ graph: await store.loadGraph(scenarioId), briefText: brief }));
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  store.readRecent.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllGlobals());

it('carries the rescued convention frame through construction, registration, persistence and the graph read', async () => {
  expect(process.env.SUPABASE_URL).toBeUndefined();
  expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();

  // These recordings predate basis; only finite, non-explicit sizes receive it.
  const withBasis: CandidateModel = {
    ...structuredClone(candidate),
    links: candidate.links.map((link) => typeof link.effect_amount === 'number'
      && Number.isFinite(link.effect_amount) && (link.effect_provenance ?? link.provenance) !== 'explicit'
      ? { ...link, basis: 'from the brief’s own figures' }
      : { ...link }),
  };
  const armA = await construct(withBasis);
  expect(priceOf(armA).observed_state?.frame_source, 'Arm A: construction marks the rescued frame').toBe('olumi_convention');
  expect(priceOf(armA).observed_state?.cap).toBe(98);

  const armB = await construct(structuredClone(candidate));
  for (const node of armB.nodes) expect(node.observed_state ?? {}).not.toHaveProperty('frame_source');
  expect(priceOf(armB).observed_state?.cap, 'Arm B: the unmodified recording keeps the original cap').toBe(200);

  const registration = await register(armA);
  expect(registration.statusCode, registration.body).toBe(200);
  expect(store.append).toHaveBeenCalledTimes(1);
  const written = store.append.mock.calls[0]?.[0];
  expect(written).toBeDefined();
  const persisted = projectGraphForPersistence(graphOf(written?.graph));
  expect(priceOf(persisted).observed_state?.frame_source, 'register and persistence retain the convention source').toBe('olumi_convention');
  expect(priceOf(persisted).observed_state?.cap).toBe(98);

  store.loadGraph.mockResolvedValue(persisted);
  store.loadGraph.mockClear();
  const response = await read();
  expect(response.statusCode, response.body).toBe(200);
  expect(store.loadGraph).toHaveBeenCalledWith(SCENARIO);
  const served = graphOf(response.json<{ graph: unknown }>().graph);
  expect(priceOf(served).observed_state?.frame_source, 'real graph read JSON must carry the convention source').toBe('olumi_convention');
  expect(priceOf(served).observed_state?.cap).toBe(98);
  expect(fetchSpy, 'the entire wire path must run without network or live LLM calls').not.toHaveBeenCalled();
});
