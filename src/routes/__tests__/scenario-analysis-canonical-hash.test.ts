/**
 * CS-AN-2: THE RELOAD MUST JUDGE FRESHNESS WITH THE HASH THE RUN STAMPED.
 *
 * A run stamps `graph_hash_at_run` over the CANONICALISED persisted graph:
 * `loadScenarioSnapshotForRunAnalysis` hands run_analysis
 * `rawPersistedGraph: canonicaliseForAnalysis(persistedGraph)`, and
 * run-analysis.ts hashes that after `GraphStateIngressSchema.safeParse`. The
 * turn path compares against the same canonical projection
 * (`deriveDecisionContextGraphHash`, turn-executor's
 * `selectedGraphForFreshness`). The reload leg (`readScenarioAnalysis`) hashed
 * the RAW persisted bytes instead. On any graph whose option-intervention
 * carriers need promotion (the DGAI autosave shape below) the two hashes
 * differ, so a reload immediately after a successful run reported
 * `complete_stale` and WITHHELD the result the user had just computed.
 *
 * Everything that decides the verdict is production code; the only authored
 * inputs are the graph bytes (copied from the repo's own F1 fixture) and the
 * store doubles. The run's hash is DERIVED through the production run-time
 * seam, never written down.
 *
 *   DEFECT:   F1 autosave shape, run on its canonical hash → complete_current.
 *             RED before the fix.
 *   CHURN:    the same model re-saved in a different carrier shape → still
 *             current (shape-only churn must not flap freshness).
 *   CONTRAST: a graph already in canonical shape (raw hash === canonical hash)
 *             → complete_current before AND after.
 *   STALE:    the F1 graph after a real value change, run on the pre-change
 *             canonical hash → complete_stale, no result. Kills an "always
 *             current" fix and any fix that stops comparing hashes on
 *             repaired-shape graphs.
 *   FALSE-CURRENT CLOSED (verifier probe P3): the run's canonical graph gains a
 *             stale `data.interventions` carrier. The RAW hash still equals the
 *             stamp, but canonicalisation promotes the carrier, so the value
 *             compute would receive moves 0.8 → 0.4. The raw-hash leg called
 *             that current and served the old numbers — a real false-current
 *             the fix closes. Kills a raw-hash fix and a raw-OR-canonical fix.
 *   UNPARSEABLE AFTER RUN (verifier probe P1): after a run, one node loses its
 *             label — no hashed field changes (raw hash === stamp) but the
 *             graph no longer parses. Pinned: fail closed, as the turn path
 *             does. Kills a canonicalise-without-parse fix and a raw-hash
 *             fallback.
 *
 * The wire `graph_hash` is pinned as the RAW hash throughout: it is the write
 * compare-and-set base (`assist.v1.scenario-graph.ts`), which other consumers
 * compare against the persisted bytes, and this fix must not move it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

const SCENARIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  mockConfig.value = {
    ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false },
  };
  return { ...actual, config: mockConfig.value };
});

vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const scenarioExists = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
const routeStore = {
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
  readRecent,
  readFactsFor,
  readFactsWithTurnFor,
  readScenarioRunAnalysisFactsFor,
  readAnalysisInvalidatedAt,
};
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => routeStore,
}));

import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../orchestrator-v5/build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { GraphStateIngressSchema } from '../../orchestrator-v5/boundary/request-extensions.js';
import { canonicaliseForAnalysis } from '../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import type { SessionStore } from '../../orchestrator-v5/session/store.js';

type Dict = Record<string, unknown>;

// ─── Graph fixtures — copied verbatim from
// `orchestrator-v5/tools/handlers/__tests__/analysis-ready-guard.integration.test.ts`
// (`makeBase` / `makeBrokenF1`), the repo's own DGAI autosave-shaped fixture. ──

/** Valid BASE; opt_hybrid carries a canonical numeric intervention. */
function makeBase(): Dict {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise outcome', goal_threshold: 0.5 },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      { id: 'fac_annual_cost', kind: 'factor', label: 'Annual cost', observed_state: { value: 0.6, raw_value: 90000, unit: '£', cap: 150000 } },
      { id: 'opt_hybrid', kind: 'option', label: 'Hybrid', interventions: { fac_annual_cost: { value: 0.8, source: 'user_specified' } } },
      { id: 'opt_status_quo', kind: 'option', label: 'Status quo', is_baseline: true, interventions: { fac_annual_cost: { value: 0.6, raw_value: 90000, unit: '£' } } },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_hybrid', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_status_quo', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_hybrid', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_status_quo', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'fac_annual_cost', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
    ],
  };
}
/** F1: the DGAI autosave-shaped broken option (interventions under node.data, raw £120,000). */
function makeBrokenF1(raw = 120000): Dict {
  const g = makeBase();
  const opt = (g.nodes as Dict[]).find((n) => n.id === 'opt_hybrid')!;
  delete opt.interventions;
  opt.data = { interventions: { fac_annual_cost: { unit: '£', raw_value: raw } } };
  return g;
}
/** The same £120,000 re-saved as a top-level raw-only entry (shape-only churn). */
function makeTopLevelRawOnly(raw = 120000): Dict {
  const g = makeBase();
  const opt = (g.nodes as Dict[]).find((n) => n.id === 'opt_hybrid')!;
  opt.interventions = { fac_annual_cost: { unit: '£', raw_value: raw } };
  return g;
}

// ─── Hashes, all derived through production code ──────────────────────────

/** A store double for the run-time seam ONLY — never the route's store. */
function snapshotStore(graph: unknown): SessionStore {
  return {
    loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: null }),
  } as unknown as SessionStore;
}

/**
 * The hash run_analysis WOULD stamp on a run over `persisted`: the production
 * run-time seam, then exactly run-analysis.ts's `graphHashAtRun` computation
 * (`GraphStateIngressSchema.safeParse(snapshot.rawPersistedGraph)` →
 * `computeAnalysisAffectingGraphHash`).
 */
async function runStampFor(persisted: Dict): Promise<string> {
  const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'csan2-run', snapshotStore(persisted));
  const hash = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(snap.rawPersistedGraph));
  expect(hash, 'premise: the run-time seam must produce a stamp').not.toBeNull();
  return hash!;
}

/** The hash of the RAW persisted bytes — what the route's wire `graph_hash` carries. */
function rawHashOf(persisted: Dict): string {
  const hash = computeAnalysisAffectingGraphHash(persisted as never);
  expect(hash, 'premise: the raw graph must be hashable').not.toBeNull();
  return hash!;
}

/** F1 in the shape the run-time seam hands run_analysis (canonicalised). */
async function canonicalF1(): Promise<Dict> {
  const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'csan2-canonical', snapshotStore(makeBrokenF1()));
  return structuredClone(snap.rawPersistedGraph) as Dict;
}

/**
 * The opt_hybrid → fac_annual_cost value the run-time seam would hand compute
 * for `persisted` (the snapshot's merged option interventions).
 */
async function hybridValueForCompute(persisted: Dict): Promise<unknown> {
  const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'csan2-compute', snapshotStore(persisted));
  const hybrid = snap.options.find((o) => o.id === 'opt_hybrid');
  return (hybrid?.interventions.fac_annual_cost as { value?: unknown } | undefined)?.value;
}

// ─── The committed run ────────────────────────────────────────────────────

const RUN_AT = '2026-09-24T18:00:00.000Z';
const RUN_TURN = 'turn-csan2-run';
const RUN_ROW = 'fact-row-csan2-run';

function runFact(graphHashAtRun: string) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO,
      computed_at: RUN_AT,
      graph_hash_at_run: graphHashAtRun,
      leading_option_id: 'opt_hybrid',
      summary: 'Hybrid leads on the current model.',
      win_probabilities: { opt_hybrid: 0.6, opt_status_quo: 0.4 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: { analysis_status: 'completed', robustness: { level: 'strong', near_tie: { is_tie: false } } },
    },
  });
}

/** Seed the persisted graph and ONE successful run on both fact ports. */
function seed(persisted: Dict, graphHashAtRun: string): void {
  const fact = runFact(graphHashAtRun);
  loadGraphAndBriefText.mockResolvedValue({ graph: persisted, briefText: null });
  readRecent.mockResolvedValue([{ id: RUN_TURN }]);
  readFactsFor.mockResolvedValue([fact]);
  readFactsWithTurnFor.mockResolvedValue([
    { fact, fact_row_id: RUN_ROW, fact_created_at: RUN_AT, turn_id: RUN_TURN },
  ]);
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact, fact_row_id: RUN_ROW, fact_created_at: RUN_AT }],
    total_count: 1,
  });
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  return app;
}

async function reload(): Promise<Dict> {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/assist/v1/scenarios/${SCENARIO}/graph`,
    payload: {},
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Dict;
}

type RunState = { kind: string; computed_at?: string };
function runStateOf(body: Dict): RunState | undefined {
  return (body.analysis_state as { run_state?: RunState } | null)?.run_state;
}

// Zero network: nothing on this path may reach a model or any upstream.
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden in this suite'));
  scenarioExists.mockResolvedValue(true);
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

afterEach(() => {
  expect(fetchSpy, 'no network call may be made').not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

describe('CS-AN-2 — the reload judges freshness with the hash the run stamped', () => {
  it('DEFECT: a run over the F1 autosave shape reloads as complete_current with ITS result', async () => {
    const persisted = makeBrokenF1();
    const runHash = await runStampFor(persisted);
    const rawHash = rawHashOf(persisted);
    // Premise, proven here rather than assumed: this graph needs carrier
    // promotion, so its raw and canonical hashes genuinely differ.
    expect(rawHash).not.toBe(runHash);
    seed(persisted, runHash);

    const body = await reload();

    expect(
      runStateOf(body),
      'reload called a run it had just completed stale, because it hashed the raw bytes',
    ).toEqual({ kind: 'complete_current', computed_at: RUN_AT });
    const block = body.analysis_result as Dict | null;
    expect(block, 'the just-computed result must be delivered on reload').not.toBeNull();
    // Bound by identity: THIS run's stamp and THIS run's numbers.
    expect(block!.type).toBe('analysis_result');
    expect(block!.computed_against_hash).toBe(runHash);
    expect(block!.win_probabilities).toEqual({ opt_hybrid: 0.6, opt_status_quo: 0.4 });
    // The wire write base is NOT moved by this fix: still the raw hash.
    expect(body.graph_hash).toBe(rawHash);
  });

  it('CHURN: the same model re-saved in another carrier shape stays current', async () => {
    const runHash = await runStampFor(makeBrokenF1());
    const churned = makeTopLevelRawOnly();
    const churnedRaw = rawHashOf(churned);
    // Premise: the churned bytes hash differently raw, yet canonicalise to the
    // same model the run stamped.
    expect(churnedRaw).not.toBe(runHash);
    expect(await runStampFor(churned)).toBe(runHash);
    seed(churned, runHash);

    const body = await reload();

    expect(runStateOf(body)).toEqual({ kind: 'complete_current', computed_at: RUN_AT });
    expect((body.analysis_result as Dict | null)?.computed_against_hash).toBe(runHash);
    expect(body.graph_hash).toBe(churnedRaw);
  });

  it('CONTRAST: a graph already in canonical shape reloads as complete_current (before and after)', async () => {
    // The canonical projection of F1 is, by construction, a graph that needs no
    // promotion — so its raw hash already equals the stamp.
    const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'csan2-contrast', snapshotStore(makeBrokenF1()));
    const canonical = structuredClone(snap.rawPersistedGraph) as Dict;
    const runHash = await runStampFor(canonical);
    expect(rawHashOf(canonical), 'premise: canonical shape → raw hash === stamp').toBe(runHash);
    seed(canonical, runHash);

    const body = await reload();

    expect(runStateOf(body)).toEqual({ kind: 'complete_current', computed_at: RUN_AT });
    expect((body.analysis_result as Dict | null)?.computed_against_hash).toBe(runHash);
    expect(body.graph_hash).toBe(runHash);
  });

  it('STALE ARM: the F1 graph after a real value change reloads as complete_stale with NO result', async () => {
    const runHash = await runStampFor(makeBrokenF1(120000));
    const edited = makeBrokenF1(130000);
    // Premise: the edit is analysis-affecting under BOTH projections, so no
    // choice of hash can make the old run current.
    expect(await runStampFor(edited)).not.toBe(runHash);
    expect(rawHashOf(edited)).not.toBe(runHash);
    seed(edited, runHash);

    const body = await reload();

    expect(runStateOf(body)?.kind).toBe('complete_stale');
    expect(body.analysis_result, 'a stale run must not be served as the current result').toBeNull();
  });

  it('FALSE-CURRENT CLOSED (P3): raw hash === stamp but canonical !== stamp reloads as complete_stale with NO result', async () => {
    // The run is on canonical F1: opt_hybrid carries value 0.8 (£120,000).
    const canonical = await canonicalF1();
    const runHash = await runStampFor(canonical);
    // A stale `data.interventions` carrier (£60,000) re-appears beside the
    // canonical top-level value. The raw hash does not read `data`; the
    // canonicaliser promotes it.
    const current = structuredClone(canonical);
    const hybrid = (current.nodes as Dict[]).find((n) => n.id === 'opt_hybrid')!;
    hybrid.data = { interventions: { fac_annual_cost: { unit: '£', raw_value: 60000 } } };
    // Premise, proven here: the RAW hash still matches the stamp, the CANONICAL
    // hash does not ...
    expect(rawHashOf(current), 'premise: raw hash === stamp').toBe(runHash);
    expect(await runStampFor(current), 'premise: canonical hash !== stamp').not.toBe(runHash);
    // ... and the difference is real: compute would now receive a different
    // value, so the stamped result no longer describes this model.
    expect(await hybridValueForCompute(canonical), 'premise: the run computed on 0.8').toBe(0.8);
    expect(await hybridValueForCompute(current), 'premise: this model now computes on 0.4').toBe(0.4);
    seed(current, runHash);

    const body = await reload();

    expect(
      runStateOf(body),
      'FALSE-CURRENT: the raw hash matched the stamp and served a result computed on a different value',
    ).toEqual({ kind: 'complete_stale', computed_at: RUN_AT, cause: 'graph_changed' });
    expect(body.analysis_result, 'a result computed on 0.8 must not be served for a model on 0.4').toBeNull();
    // The wire write base stays the raw hash (here, coincidentally the stamp).
    expect(body.graph_hash).toBe(runHash);
  });

  it('UNPARSEABLE AFTER RUN (P1): a graph that stops parsing after its run fails closed — unknown_degraded, NO result', async () => {
    const canonical = await canonicalF1();
    const runHash = await runStampFor(canonical);
    // One node loses its label: no analysis-affecting field changes, but the
    // graph no longer passes GraphStateIngressSchema.
    const current = structuredClone(canonical);
    delete (current.nodes as Dict[]).find((n) => n.id === 'fac_annual_cost')!.label;
    // Premise, proven here: the RAW hash still equals the stamp, and the
    // canonical projection does not parse (so no canonical hash exists).
    expect(rawHashOf(current), 'premise: raw hash === stamp').toBe(runHash);
    expect(
      GraphStateIngressSchema.safeParse(canonicaliseForAnalysis(current)).success,
      'premise: the canonical projection must fail ingress parse',
    ).toBe(false);
    seed(current, runHash);

    const body = await reload();

    // Pinned: FAIL CLOSED. With no canonical hash, currency cannot be verified,
    // so the run's result is withheld even though no hashed field moved. This
    // matches the turn path, which also hashes only a canonical projection that
    // parses and otherwise carries a null current hash
    // (turn-executor.ts ~2897-2913, `selectedGraphForFreshness` →
    // `currentAnalysisGraphHashForTurn`).
    //
    // ⚠ KNOWN IMPRECISION, a named follow-up NOT fixed here: the wire cause
    // `no_graph_this_turn` (from `current_graph_hash_unavailable`) says no graph
    // was in scope, but this reload DID return a graph — it just does not
    // parse. The kind is right; the cause text is not.
    expect(
      runStateOf(body),
      'UNVERIFIABLE CURRENCY: a graph with no canonical hash was judged against the stamp anyway',
    ).toEqual({ kind: 'unknown_degraded', cause: 'no_graph_this_turn' });
    expect(body.analysis_result, 'an unverifiable run must not be served as the current result').toBeNull();
    expect(body.graph, 'the reload still serves the graph').not.toBeNull();
    expect(body.graph_hash).toBe(runHash);
  });
});
