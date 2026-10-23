/**
 * A MODEL PROGRAM'S POSTIMAGE THROUGH THE REAL REGISTER (alpha): the graph a program turn writes (S1's display projection,
 * the program and its Runs as `living_model`) is accepted by `/graph/register` as CEE's own thin-core write and stored AS
 * GIVEN: every node and link (with only each card's display `ref` added), and the living model byte for byte, so a cold read
 * shows the stored Run; a client's write of it is refused. The store is a mock
 * (nothing reaches a database); the route, its validation and its projection are the real ones. Synthetic bakery.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = 'd9e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60';

vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});
const append = vi.fn();
const loadGraph = vi.fn();
const store = { append, loadGraph, ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity }));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM, reopenProgram } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { bakery, BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';

type Rec = Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  append.mockResolvedValue({ id: 'turn-1' });
  loadGraph.mockResolvedValue(null);
});

async function register(payload: Rec, asCeeWriter: boolean) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const opts = { method: 'POST' as const, url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload };
  const res = asCeeWriter ? await injectAsCeeWriter(app, opts) : await app.inject(opts);
  await app.close();
  return res;
}

describe('a model program\'s postimage through the real /graph/register', () => {
  it('CEE\'s thin-core write stores it as given: every node and link, and the program with its Run byte for byte', async () => {
    const program = { model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] };
    const { graph } = withNewRun(program);
    const res = await register({ graph, thin_core: true, brief_text: BRIEF }, true);
    expect(res.statusCode, res.body).toBe(200);
    const written = (append.mock.calls[0]![0] as Rec).graph as Rec;
    expect(JSON.stringify(written.living_model)).toBe(JSON.stringify(graph.living_model));
    // The register adds only each card's display reference (`ref`: D1, G1, …), its identity/format projection.
    const unref = (nodes: unknown) => (nodes as Rec[]).map(({ ref: _ref, ...n }) => n);
    expect((written.nodes as Rec[]).every((n) => typeof n.ref === 'string')).toBe(true);
    expect(stableStringify(unref(written.nodes))).toBe(stableStringify(graph.nodes));
    expect(stableStringify(written.edges)).toBe(stableStringify(graph.edges));
    // Cold: the stored graph alone shows the stored Run.
    const cold = reopenProgram(JSON.parse(JSON.stringify(written)))!;
    expect([cold.current, cold.engine_current]).toEqual([true, true]);
    expect(stableStringify(cold.view)).toBe(stableStringify((graph.living_model as { runs: { result: { canonical_analysis_view: unknown } }[] }).runs[0]!.result.canonical_analysis_view));
  });

  it('NEGATIVE: the same graph from a client (not CEE\'s writer) is refused, and nothing is stored', async () => {
    const program = { model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] };
    const { graph } = withNewRun(program);
    const res = await register({ graph, thin_core: true }, false);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().details.code).toBe('GRAPH_INVARIANT_VIOLATION');
    expect(append).not.toHaveBeenCalled();
  });
});
