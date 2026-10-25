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
import { at, bakery, BRIEF, q } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { CanonicalModelT } from '../../orchestrator-v5/model-program/canonical.js';
import { compile } from '../../orchestrator-v5/model-program/compile.js';
import { applyProgramChange, holdProgramCard } from '../../orchestrator-v5/model-program-turn/program-tools.js';
import { validatePostimage } from '../../orchestrator-v5/model-program-turn/postimage.js';
import { savedProgramOf } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { ProposalStore } from '../../orchestrator-v5/agent-lane/proposal.js';
import { isSavedRead, readSaved } from '../../orchestrator-v5/path-b/tools/context-tool.js';
import { GraphStaleWriteError } from '../../orchestrator-v5/session/store.js';
import { GRAPH_MAX_NODES } from '../../config/graphCaps.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';

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

  it('DL 23 Oct (UI witness on alpha3): a program capacity graph with the person\'s 10–30 range gets NO legacy readiness asks; the same graph as a Living Model still does', async () => {
    const brief = 'Our support team handles 80 tickets a week. We need at least 100 tickets a week. Each specialist would add between 10 and 30 tickets a week. Add one specialist or keep the team as it is.';
    const capacity: CanonicalModelT = { version: 'canonical.v1', question: 'Add a specialist?', period: 'week',
      quantities: [q('existing', 'ticket/week', { value: 80, quote: 'handles 80 tickets a week' }),
        q('specialists', 'specialist', { value: 0, author: 'structure', basis: 'None added today.' }), q('one', 'specialist', { value: 1, author: 'structure', basis: 'One specialist.' }),
        q('per_specialist', 'ticket/week/specialist', { kind: 'coefficient', low: 10, high: 30, range_kind: 'plausible', quote: 'between 10 and 30 tickets a week' }),
        q('weekly', 'ticket/week', { kind: 'derived', status: 'derived', author: 'olumi' }), q('target', 'ticket/week', { value: 100, quote: 'at least 100 tickets a week' })],
      relations: [{ form: 'effect', id: 'weekly_rel', defines: 'weekly', base: 'existing', terms: [{ driver: 'specialists', coefficient: 'per_specialist', author: 'person', quote: 'Each specialist would add', ...at }], author: 'olumi', quote: null, ...at }],
      goals: [{ id: 'g', label: 'At least 100 tickets a week', measure: { quantity: 'weekly', per: null, cmp: '>=', target: 'target', frame: 'level', reference: null, aggregation: 'end', window: null,
        measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'at least 100 tickets a week', ...at }],
      limits: [], preferences: [],
      options: [{ id: 'add', label: 'Add one specialist', sets: [{ quantity: 'specialists', to: 'one', value: null, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0, author: 'person', quote: 'Add one specialist' }],
        status: 'live', developed_from: null, author: 'person', quote: 'Add one specialist', ...at },
      { id: 'keep', label: 'Keep the team', sets: [], status: 'live', developed_from: null, author: 'person', quote: 'keep the team as it is', ...at }],
      risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [] };
    const { graph } = withNewRun({ model_program: MODEL_PROGRAM, canonical: capacity, seed: seedOf(SCENARIO), person_words: [brief], runs: [] });
    expect((await register({ graph, thin_core: true, brief_text: brief }, true)).statusCode).toBe(200);
    const written = (append.mock.calls[0]![0] as Rec).graph as Rec;
    const readOf = async (g: Rec) => {
      store.readExistingScenario.mockResolvedValue({ userId: null, graph: JSON.parse(JSON.stringify(g)), briefText: brief, analysisInvalidatedAt: null, revision: 1 });
      const app = Fastify();
      await scenarioGraphRoute(app);
      await app.ready();
      const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
      await app.close();
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as Rec;
    };
    const LEGACY_ASKS = /FACTOR_LEVEL_SCALE_UNRESOLVED|recorded as [0-9]+ ticket\/week with no range|needs a change before it can be analysed/;
    // The program: its readiness is the program's (a Run is current with figures), and no legacy range ask anywhere.
    const program = await readOf(written);
    expect(((program.canonical_analysis_view as Rec).options as Rec[]).map((o) => (o.cell as Rec).kind)).toEqual(['figure', 'figure']);
    expect((program.current_read as Rec).analysis_ready).toMatchObject({ status: 'ready', may_run: true });
    expect(JSON.stringify({ ...program, graph: null })).not.toMatch(LEGACY_ASKS);
    // Contrast: the SAME graph with no program (a Living Model) still gets the legacy readiness and its range asks.
    const { living_model: _program, ...plain } = written;
    expect(JSON.stringify(buildCanonicalAnalysisReadyFromGraph(plain))).toMatch(LEGACY_ASKS);
    expect(JSON.stringify({ ...(await readOf(plain)), graph: null })).toMatch(LEGACY_ASKS);
  });

  /**
   * Paul's test, 25 Oct 09:39–09:41Z (served CEE 1e74dbf9, scenario 19faa1f8): Olumi's card replaced its own figure for an
   * option's setting with a question; three presses were each refused as `untouched_level_rescaled` by the legacy
   * registration rules. The same shape, synthetic: the second oven's setting is Olumi's figure, and the card asks it instead.
   */
  const olumisSetting = (): CanonicalModelT => {
    const m = bakery();
    m.quantities = m.quantities.map((x) => (x.id === 'one_oven' ? { ...x, author: 'olumi', quote: null, basis: 'Olumi’s placeholder for the setting.' } : x));
    return m;
  };
  const askedSetting = (m: CanonicalModelT): CanonicalModelT => ({ ...m, quantities: m.quantities.map((x) => (x.id === 'one_oven'
    ? { ...x, status: 'asked', value: null, question: 'How many ovens would you add?', basis: null } : x)) });
  /** A stateful store behind the REAL register and the REAL scenario read: what the register appends is what the read serves. */
  async function realRoutes() {
    let saved: Rec | null = null;
    loadGraph.mockImplementation(async () => (saved === null ? null : JSON.parse(JSON.stringify(saved))));
    // The store echoes the version it was asked to write, as the atomic append returns it (none without a carrier).
    append.mockImplementation(async (w: Rec) => {
      saved = JSON.parse(JSON.stringify(w.graph)) as Rec;
      const n = append.mock.calls.length, mv = w.modelVersion as Rec | undefined;
      return { id: `turn-${n}`, ...(mv === undefined ? {} : { modelVersionReceipt: { mutation_id: mv.mutation_id, version_id: `ver-${n}`, version_number: n,
        creation_kind: mv.creation_kind, graph_identity_hash: mv.graph_identity_hash, analysis_affecting_hash: mv.analysis_affecting_hash } }) };
    });
    store.readExistingScenario.mockImplementation(async () => (saved === null ? null
      : { userId: null, graph: JSON.parse(JSON.stringify(saved)), briefText: BRIEF, analysisInvalidatedAt: null, revision: append.mock.calls.length }));
    const app = Fastify();
    await registerRoute(app);
    await scenarioGraphRoute(app);
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    await app.ready();
    // The Agent's in-process dispatch: a register inside its mark for this scenario, as `core-turn.ts` sends it.
    const dispatch = async (path: string, payload: unknown) => {
      const r = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: payload as never });
      return { status: r.statusCode, json: r.json() as Rec };
    };
    return { app, dispatch, saved: () => saved };
  }
  const registerUrl = `/assist/v1/scenarios/${SCENARIO}/graph/register`;

  it('Paul 25 Oct 09:39Z (3 refused presses): an approved card that turns Olumi\'s figure for an option\'s setting into a question saves through the REAL register, with its receipt; the readback is the saved model', async () => {
    const { app, dispatch } = await realRoutes();
    const first = withNewRun({ model_program: MODEL_PROGRAM, canonical: olumisSetting(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
    expect((await dispatch(registerUrl, { graph: first.graph, thin_core: true, operation_id: '0f9b2c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b', expected_graph_identity_hash: null, brief_text: BRIEF })).status).toBe(200);
    const base = await readSaved({ dispatch }, SCENARIO);
    if (!isSavedRead(base)) throw new Error('no saved base');
    // The setting's cell on the saved option holds Olumi's figure; the card's postimage holds it with no figure.
    const cell = (g: Rec) => ((g.nodes as Rec[]).find((n) => n.id === 'second_oven')!.interventions as Rec).ovens_added as Rec;
    expect(cell(base.graph).value).toBe(1);
    // The host's own card: the same validator and compile the proposal path runs, then its hold. No AI call.
    const v = validatePostimage(first.program.canonical, askedSetting(first.program.canonical), { removals: [], words: [BRIEF], fresh: [] });
    if (!v.ok) throw new Error(v.reason);
    expect(v.changes.map((c) => [c.id, c.action])).toEqual([['one_oven', 'change']]);
    expect(compile(v.model, { sourceText: BRIEF }).errors).toEqual([]);
    const next = withNewRun({ ...first.program, canonical: v.model });
    expect(cell(next.graph).value).toBeNull();
    const proposals = new ProposalStore();
    const card = holdProgramCard(proposals, { scenarioId: SCENARIO, userId: null, graphHash: base.graphHash, identity: base.identity! },
      { label: 'Ask how many ovens', basis: 'Olumi’s figure was a placeholder', program: next.program, changes: v.changes });
    const applied = await applyProgramChange({ dispatch, proposals }, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: 'press-1' }, card.proposal_id) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', data: { saved: true } });
    expect(append).toHaveBeenCalledTimes(2);
    // The commit's own CAS is on the base the card was made on (the read route's identity and hash, the store's revision).
    const written = append.mock.calls[1]![0] as Rec;
    expect([written.expectedGraphIdentityHash, written.expectedGraphAnalysisHash, written.expectedRevision]).toEqual([base.identity, base.graphHash, 7]);
    // Unknown figures are valid program state: the same transaction carries its version, without inventing a value.
    expect(written.modelVersion).toMatchObject({ creation_kind: 'committed_mutation' });
    // Its receipt names the model a fresh read serves, and that read is the approved card's program, byte for byte.
    const after = await readSaved({ dispatch }, SCENARIO);
    await app.close();
    if (!isSavedRead(after)) throw new Error('no readback');
    expect(written.modelVersion).toMatchObject({ graph_identity_hash: after.identity });
    const data = applied.data as Rec;
    expect((data.receipt as Rec).graph_identity_hash).toBe(after.identity);
    expect((data.revision as Rec).graph_identity_hash).toBe(after.identity);
    expect(stableStringify(savedProgramOf(after.graph))).toBe(stableStringify(next.program));
    expect(cell(after.graph).value).toBeNull();
  });

  it('a program save whose figures are all given carries its version to the commit, and its receipt is that version, read back', async () => {
    const { app, dispatch } = await realRoutes();
    const first = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
    expect((await dispatch(registerUrl, { graph: first.graph, thin_core: true, expected_graph_identity_hash: null, brief_text: BRIEF })).status).toBe(200);
    const base = await readSaved({ dispatch }, SCENARIO);
    if (!isSavedRead(base)) throw new Error('no saved base');
    // Their answer to the one asked figure: every figure is then given, so the graph is versionable.
    const words = 'The oven would cost £2,500.';
    const answered: CanonicalModelT = { ...first.program.canonical, quantities: first.program.canonical.quantities.map((x) => (x.id === 'oven_price'
      ? { ...x, status: 'known', value: 2500, question: null, quote: words } : x)) };
    const v = validatePostimage(first.program.canonical, answered, { removals: [], words: [BRIEF, words], fresh: [words] });
    if (!v.ok) throw new Error(v.reason);
    const next = withNewRun({ ...first.program, canonical: v.model, person_words: [BRIEF, words] });
    const proposals = new ProposalStore();
    const card = holdProgramCard(proposals, { scenarioId: SCENARIO, userId: null, graphHash: base.graphHash, identity: base.identity! },
      { label: 'Oven price £2,500', basis: 'their answer', program: next.program, changes: v.changes });
    const applied = await applyProgramChange({ dispatch, proposals }, { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: 'press-2' }, card.proposal_id) as Rec;
    const after = await readSaved({ dispatch }, SCENARIO);
    await app.close();
    if (!isSavedRead(after)) throw new Error('no readback');
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', data: { saved: true } });
    // The version carrier the commit was given names the model a fresh read serves.
    const carrier = (append.mock.calls[1]![0] as Rec).modelVersion as Rec;
    expect(carrier).toMatchObject({ graph_identity_hash: after.identity, creation_kind: 'committed_mutation' });
    expect(typeof carrier.mutation_id).toBe('string');
    // The receipt the person's save reports is THAT version (core-write checks its hashes against the readback).
    expect((applied.data as Rec).receipt).toEqual({ mutation_id: carrier.mutation_id, version_id: 'ver-2', version_number: 2, creation_kind: 'committed_mutation',
      graph_identity_hash: after.identity, analysis_affecting_hash: carrier.analysis_affecting_hash });
    expect(stableStringify(savedProgramOf(after.graph))).toBe(stableStringify(next.program));
  });

  it('CONTRAST (the legacy rules stay on every other writer): the SAME two graphs as a non-program core write (no `model_program`) are still refused as untouched_level_rescaled, and nothing is written', async () => {
    const { app, dispatch } = await realRoutes();
    const first = withNewRun({ model_program: MODEL_PROGRAM, canonical: olumisSetting(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
    const notProgram = (g: Rec): Rec => { const { model_program: _p, ...lm } = g.living_model as Rec; return { ...g, living_model: lm }; };
    expect((await dispatch(registerUrl, { graph: notProgram(first.graph), thin_core: true, expected_graph_identity_hash: null, brief_text: BRIEF })).status).toBe(200);
    const base = await readSaved({ dispatch }, SCENARIO);
    if (!isSavedRead(base)) throw new Error('no saved base');
    const next = withNewRun({ ...first.program, canonical: askedSetting(first.program.canonical) });
    const res = await dispatch(registerUrl, { graph: notProgram(next.graph), thin_core: true, expected_graph_identity_hash: base.identity });
    await app.close();
    expect(res.status, JSON.stringify(res.json)).toBe(422);
    expect((res.json.details as Rec).violations).toEqual([{ code: 'untouched_level_rescaled', count: 1, entity_ids: ['second_oven::ovens_added'] }]);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('KEPT NEGATIVES (storage integrity on a program save): CAS, the held cards\' read, schema, size and the structural floor each still refuse, and nothing is written', async () => {
    const first = withNewRun({ model_program: MODEL_PROGRAM, canonical: olumisSetting(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
    const next = withNewRun({ ...first.program, canonical: askedSetting(first.program.canonical) }).graph;
    const nodes = next.nodes as Rec[], edges = next.edges as Rec[];
    const stale = () => { throw new GraphStaleWriteError('stale', { conflict_category: 'rpc_cas_conflict' }); };
    const cases: [string, Rec, number, string | undefined, () => void][] = [
      ['stale base (route CAS)', next, 409, 'GRAPH_STALE', () => {}],
      ['stale base (the commit\'s own CAS)', next, 409, 'GRAPH_STALE', () => append.mockImplementation(async () => stale())],
      ['the held cards cannot be read', next, 503, undefined, () => store.readMostRecentPendingActions.mockRejectedValue(new Error('unreadable'))],
      ['nodes not a list', { ...next, nodes: 'none' }, 422, 'GRAPH_SHAPE_INVALID', () => {}],
      ['a node with no kind', { ...next, nodes: nodes.map((n, i) => (i === 0 ? { ...n, kind: undefined } : n)) }, 422, 'GRAPH_NODE_KIND_MISSING', () => {}],
      ['too many nodes', { ...next, nodes: [...nodes, ...Array.from({ length: GRAPH_MAX_NODES }, (_, i) => ({ id: `extra_${i}`, kind: 'factor', label: 'x' }))] }, 422, 'GRAPH_TOO_LARGE', () => {}],
      ['a duplicate node id', { ...next, nodes: [...nodes, { ...nodes.find((n) => n.kind === 'factor')! }] }, 422, 'GRAPH_INVARIANT_VIOLATION', () => {}],
      ['a link to no node', { ...next, edges: [...edges, { ...edges[0]!, id: 'dangling', to: 'no_such_node' }] }, 422, 'GRAPH_INVARIANT_VIOLATION', () => {}],
    ];
    for (const [name, graph, status, code, setup] of cases) {
      append.mockReset();
      append.mockResolvedValue({ id: 'turn-2' });
      store.readMostRecentPendingActions.mockReset();
      store.readMostRecentPendingActions.mockResolvedValue([]);
      loadGraph.mockResolvedValue(JSON.parse(JSON.stringify(first.graph)));
      setup();
      const res = await register({ graph, thin_core: true, ...(name === 'stale base (route CAS)' ? { expected_graph_identity_hash: 'f'.repeat(64) } : {}) }, true);
      expect([name, res.statusCode, res.json().details?.code], res.body).toEqual([name, status, code]);
      // Nothing is written: only the commit's own CAS reaches the append, and its transaction refuses.
      expect([name, append.mock.calls.length]).toEqual([name, name === 'stale base (the commit\'s own CAS)' ? 1 : 0]);
      if (name === 'stale base (the commit\'s own CAS)') {
        // It refused on THESE expectations: the stored base's identity and analysis hash, and the revision the base read gave.
        const w = append.mock.calls[0]![0] as Rec;
        expect([w.expectedGraphIdentityHash, w.expectedGraphAnalysisHash, w.expectedRevision])
          .toEqual([computeGraphIdentityHash(first.graph as never)!.value, computeAnalysisAffectingGraphHash(first.graph as never), 7]);
        expect(w.expectedGraphIdentityHash).not.toBe(computeGraphIdentityHash(graph as never)!.value);
      }
    }
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
