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
const store = { append, loadGraph, ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn(),
  // The scenario read's own reads (the real read route, below).
  readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(), readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity }));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
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
  for (const read of [store.readRecent, store.readFactsFor, store.readFactsWithTurnFor]) read.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
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

  it('Lenses fit 2 (DL 23 Oct): the REAL scenario read of the stored program is `scenario_graph.v1`, with the stored Run\'s view bound to the graph it serves', async () => {
    const program = { model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] };
    const { graph, run } = withNewRun(program);
    expect((await register({ graph, thin_core: true, brief_text: BRIEF }, true)).statusCode).toBe(200);
    const written = (append.mock.calls[0]![0] as Rec).graph as Rec;
    store.readExistingScenario.mockResolvedValue({ userId: null, graph: JSON.parse(JSON.stringify(written)), briefText: BRIEF, analysisInvalidatedAt: null, revision: 1 });
    const app = Fastify();
    await scenarioGraphRoute(app);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    await app.close();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Rec;
    // The schema DGAI's reader accepts (scenarioGraph.ts rejects anything else, and the board opens empty).
    expect(body.schema).toBe('scenario_graph.v1');
    // The stored Run's view as stored, bound to the graph this read serves: the canvas shows chances only when it binds.
    const view = body.canonical_analysis_view as Rec;
    expect(stableStringify({ ...view, staleness: null })).toBe(stableStringify({ ...(run.result.canonical_analysis_view as Rec), staleness: null }));
    expect(view.run).toEqual({ run_id: run.run_id, graph_hash_at_run: body.graph_hash, computed_at: run.computed_at });
    expect((view.staleness as Rec).stale).toBe(false);
    // The served nodes keep what the projection wrote for the canvas: a setting's source, a worked-out figure's basis.
    const node = (id: string) => (body.graph as { nodes: Rec[] }).nodes.find((n) => n.id === id)!;
    expect((node('second_oven').interventions as Rec).ovens_added).toMatchObject({ source: 'brief_extraction' });
    expect(node('sales').value_basis).toMatchObject({ kind: 'worked_out' });
    expect(node('oven_price')).toMatchObject({ analysis_participation: 'included', display_value: 'Waiting for your answer' });
    expect(((body.current_read as Rec).analysis_ready as Rec).goal_threshold_raw).toBe(380);
    // DL 23 Oct: the legacy readiness and blocker producers never run on a program. Its readiness is the program's own:
    // the bakery's goal can be worked out now (its limit waits on the oven's price), so a Run may run; no legacy verdict.
    expect((body.current_read as Rec).analysis_ready).toMatchObject({ goal_node_id: 'more_loaves', status: 'ready', may_run: true,
      options: [{ option_id: 'second_oven', status: 'ready', interventions: { ovens_added: 1 } }, { option_id: 'keep_one', status: 'ready', is_baseline: true }] });
    for (const legacy of ['readiness_issues', 'repair_proposal', 'analysis_admission', 'blocked_reason']) expect((body.current_read as Rec).analysis_ready).not.toHaveProperty(legacy);
    expect(body.analysis_admission).toBeNull();
    expect(JSON.stringify({ ...body, graph: null, canonical_analysis_view: null })).not.toMatch(/FACTOR_LEVEL_SCALE_UNRESOLVED|MODEL_HAS_BLOCKERS|ORPHAN_NODE/);
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
