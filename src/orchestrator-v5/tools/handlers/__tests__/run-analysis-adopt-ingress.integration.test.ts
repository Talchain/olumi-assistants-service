/**
 * #343 CEE half — run_analysis ingress-graph adoption (adopt-on-empty).
 *
 * Live repro this fixes: a starter/template insert builds the model CLIENT-SIDE
 * only; nothing ever writes `scenarios.graph` (staging is guest mode, the UI
 * Supabase autosave is auth-gated, V5 wire bodies carried no graph). The user's
 * first CTA — "Analyse first pass" — then dead-ends on the NO_GRAPH refusal
 * ("Draft or save a model first, then run analysis.") while the panel says
 * "Analysis available".
 *
 * Mechanism under test (CEE_RUN_ANALYSIS_ADOPT_INGRESS_GRAPH, default ON):
 * when the STRICT persisted read returns a GENUINELY-null graph AND the request
 * carried a graph_state, `loadScenarioSnapshotForRunAnalysis` assesses the
 * ingress graph with the SAME neutral readiness core EP2 uses
 * (`assessAnalysisReadiness`) —
 *   - ready/repaired  → the canonical ingress graph becomes the snapshot
 *                       (analysed; persisted at the commit seam, covered by the
 *                       dispatch-path tests);
 *   - unrecoverable   → AnalysisNotReadyError with the SPECIFIC verdict,
 *                       NEVER the false NO_GRAPH copy; nothing is adopted.
 * A PRESENT persisted graph is NEVER affected (ingress cannot overwrite
 * canonical state), and a store/RPC failure still propagates (adoption must
 * not mask an infra outage as a first write).
 *
 * Test idioms mirror analysis-ready-guard.integration.test.ts (same fixtures,
 * same config-setter pattern) so the two seams stay reviewable side by side.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { AnalysisNotReadyError } from '../analysis-ready-core.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { HandlerInvocation } from '../../registry.js';
import { config } from '../../../../config/index.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { SessionReadError } from '../../../session/store.js';
import type { SessionStore } from '../../../session/store.js';

type Dict = Record<string, unknown>;

function setAdopt(on: boolean): void {
  (config.cee as { runAnalysisAdoptIngressGraph: boolean }).runAnalysisAdoptIngressGraph = on;
}
function setNullRecoverable(on: boolean): void {
  (config.cee as { runAnalysisNullGraphRecoverable: boolean }).runAnalysisNullGraphRecoverable = on;
}
afterEach(() => {
  setAdopt(true); // default (ON)
  setNullRecoverable(true); // default (ON)
});

/** Valid analysable graph — same shape as the EP2 guard test's makeBase(). */
function makeIngressGraph(): Dict {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise outcome', goal_threshold: 0.5 },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      { id: 'fac_annual_cost', kind: 'factor', label: 'Annual cost', observed_state: { value: 0.6, unit: '£', cap: 150000 } },
      { id: 'opt_hybrid', kind: 'option', label: 'Hybrid', interventions: { fac_annual_cost: { value: 0.8, source: 'user_specified' } } },
      { id: 'opt_status_quo', kind: 'option', label: 'Status quo', is_baseline: true, interventions: {} },
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
/** Unrecoverable ingress: raw-value intervention whose factor has no cap. */
function makeUnrecoverableIngress(): Dict {
  const g = makeIngressGraph();
  const opt = (g.nodes as Dict[]).find((n) => n.id === 'opt_hybrid')!;
  delete opt.interventions;
  opt.data = { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } };
  const fac = (g.nodes as Dict[]).find((n) => n.id === 'fac_annual_cost')!;
  fac.observed_state = { value: 0.6, unit: '£' }; // cap removed
  return g;
}
/** A distinct PERSISTED graph so persisted-vs-ingress selection is provable. */
function makePersistedGraph(): Dict {
  const g = makeIngressGraph();
  (g.nodes as Dict[]).find((n) => n.id === 'goal_1')!.label = 'PERSISTED goal';
  return g;
}
function stubStore(graph: unknown): SessionStore {
  return {
    loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: null }),
  } as unknown as SessionStore;
}
function throwingStore(err: Error): SessionStore {
  return {
    loadGraph: async () => { throw err; },
    loadGraphAndBriefText: async () => { throw err; },
  } as unknown as SessionStore;
}

const PLOT_OK = {
  analysis_status: 'computed',
  results: [
    { option_id: 'opt_hybrid', option_label: 'Hybrid', win_probability: 0.6 },
    { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.4 },
  ],
  response_hash: 'hash_x',
  meta: { seed_used: 1 },
};
function makeHandlerForStore(store: SessionStore, plotRunCalls: { n: number }) {
  const plotClient = {
    run: async () => { plotRunCalls.n += 1; return PLOT_OK; },
  } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];
  // Production-shaped reader: forwards the ingress graph exactly as
  // DEFAULT_SCENARIO_READER / the chip one-shot pre-load do.
  const scenarioReader = async (scenarioId: string, _signal?: AbortSignal, ingressGraph?: unknown) =>
    loadScenarioSnapshotForRunAnalysis(scenarioId, 'req', store, ingressGraph);
  return createRunAnalysisHandler({ plotClient, scenarioReader });
}
function invocationWith(graphForTurn: unknown): HandlerInvocation {
  return {
    payload: { scenario_id: '11111111-1111-4111-8111-111111111111' },
    requestId: 'req1',
    signal: undefined,
    ...(graphForTurn !== undefined ? { graphForTurn } : {}),
  } as unknown as HandlerInvocation;
}

// ---------------------------------------------------------------------------
// Reader seam — loadScenarioSnapshotForRunAnalysis
// ---------------------------------------------------------------------------

describe('#343 adopt-on-empty — reader seam', () => {
  it('null persisted + valid ingress (flag ON, default): snapshot is built FROM the ingress graph and marked adopted', async () => {
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null), makeIngressGraph());
    expect(snap.goal_node_id).toBe('goal_1');
    expect(snap.adoptedIngressGraph).toBe(true);
    // rawPersistedGraph carries the canonical adopted graph — hashable with the
    // SAME parser the freshness side uses (graph_hash_at_run consistency).
    const parsed = GraphStateIngressSchema.safeParse(snap.rawPersistedGraph);
    expect(parsed.success).toBe(true);
    // The configured option survives (the whole point: the model is analysable).
    const opt = snap.options.find((o) => (o as Dict).option_id === 'opt_hybrid') as Dict;
    expect(Object.keys((opt.interventions ?? {}) as Dict).length).toBeGreaterThan(0);
  });

  it('null persisted + valid ingress + flag OFF: rolls back to NO_GRAPH exactly as before (kill-switch)', async () => {
    setAdopt(false);
    let err: unknown;
    try { await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null), makeIngressGraph()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AnalysisNotReadyError);
    expect((err as AnalysisNotReadyError).verdict.reasonCodes).toEqual(['NO_GRAPH']);
  });

  it('null persisted + NO ingress: NO_GRAPH branch byte-unchanged (the null-extensions mode)', async () => {
    let err: unknown;
    try { await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AnalysisNotReadyError);
    const verdict = (err as AnalysisNotReadyError).verdict;
    expect(verdict.reasonCodes).toEqual(['NO_GRAPH']);
    expect(verdict.nextStep).toBe('Draft or save a model first, then run analysis.');
  });

  it('null persisted + UNRECOVERABLE ingress: the SPECIFIC verdict, never the false NO_GRAPH copy', async () => {
    let err: unknown;
    try { await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null), makeUnrecoverableIngress()); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AnalysisNotReadyError);
    const verdict = (err as AnalysisNotReadyError).verdict;
    expect(verdict.reasonCodes).not.toEqual(['NO_GRAPH']);
    expect(verdict.reasonCodes).toEqual(['NO_CAP_UNRECOVERABLE']);
    expect(verdict.nextStep).not.toBe('Draft or save a model first, then run analysis.');
    expect(verdict.nextStep).toContain('bound (cap)');
  });

  it('null persisted + structurally-invalid ingress: specific verdict (schema/structure), not NO_GRAPH', async () => {
    const garbage = { nodes: [{ id: 'x' }], edges: 'nope' };
    let err: unknown;
    try { await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null), garbage); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AnalysisNotReadyError);
    const verdict = (err as AnalysisNotReadyError).verdict;
    expect(verdict.reasonCodes).not.toEqual(['NO_GRAPH']);
  });

  it('PRESENT persisted graph + ingress supplied: ingress is IGNORED — canonical state wins, no adoption marker', async () => {
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makePersistedGraph()), makeIngressGraph());
    expect(snap.adoptedIngressGraph).toBeUndefined();
    // Provably the PERSISTED graph, not the ingress echo.
    const goal = (snap.graph as { nodes: Array<{ id: string; label: string }> }).nodes.find((n) => n.id === 'goal_1');
    expect(goal?.label).toBe('PERSISTED goal');
    // And the hash matches the persisted graph, not the ingress graph.
    const parsed = GraphStateIngressSchema.safeParse(snap.rawPersistedGraph);
    expect(parsed.success).toBe(true);
    expect(computeAnalysisAffectingGraphHash(parsed.data!)).toBe(
      computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(makePersistedGraph())),
    );
  });

  it('STORE/RPC failure + ingress supplied: SessionReadError still propagates — adoption never masks an outage', async () => {
    const boom = new SessionReadError('loadGraph failed: supabase RPC down');
    await expect(
      loadScenarioSnapshotForRunAnalysis('sc', 'req', throwingStore(boom), makeIngressGraph()),
    ).rejects.toBe(boom);
  });
});

// ---------------------------------------------------------------------------
// Handler seam — createRunAnalysisHandler threads invocation.graphForTurn
// ---------------------------------------------------------------------------

describe('#343 adopt-on-empty — run_analysis handler seam', () => {
  it('null persisted + graphForTurn: analysed (PLoT once), fact hash == canonical ingress hash, adopted graph surfaced for the commit', async () => {
    const calls = { n: 0 };
    const handler = makeHandlerForStore(stubStore(null), calls);
    const outcome = await handler(invocationWith(makeIngressGraph()));
    expect(calls.n).toBe(1);
    const fact = outcome.handler_facts[0] as { result?: { graph_hash_at_run?: unknown } };
    const adopted = (outcome as { __adopted_ingress_graph?: unknown }).__adopted_ingress_graph;
    expect(adopted).toBeDefined();
    const parsed = GraphStateIngressSchema.safeParse(adopted);
    expect(parsed.success).toBe(true);
    // The fact's run-hash is computed FROM the adopted graph — freshness on the
    // next turn (persisted == adopted) reads fresh, not stale.
    expect(fact.result?.graph_hash_at_run).toBe(computeAnalysisAffectingGraphHash(parsed.data!));
  });

  it('null persisted + NO graphForTurn: analysis_not_ready NO_GRAPH, zero PLoT — unchanged mode', async () => {
    const calls = { n: 0 };
    const handler = makeHandlerForStore(stubStore(null), calls);
    let err: unknown;
    try { await handler(invocationWith(undefined)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HandlerInvocationFailedError);
    expect((err as HandlerInvocationFailedError).cause_kind).toBe('analysis_not_ready');
    const details = (err as HandlerInvocationFailedError).details as Dict;
    expect(details.reason_code).toBe('NO_GRAPH');
    expect(calls.n).toBe(0);
  });

  it('null persisted + unrecoverable graphForTurn: analysis_not_ready with the SPECIFIC reason + next step, zero PLoT', async () => {
    const calls = { n: 0 };
    const handler = makeHandlerForStore(stubStore(null), calls);
    let err: unknown;
    try { await handler(invocationWith(makeUnrecoverableIngress())); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HandlerInvocationFailedError);
    expect((err as HandlerInvocationFailedError).cause_kind).toBe('analysis_not_ready');
    const details = (err as HandlerInvocationFailedError).details as Dict;
    expect(details.reason_code).toBe('NO_CAP_UNRECOVERABLE');
    expect(String(details.next_step)).toContain('bound (cap)');
    expect(calls.n).toBe(0);
  });

  it('PRESENT persisted graph + graphForTurn: analysed from PERSISTED state, NO adopted-graph channel on the outcome', async () => {
    const calls = { n: 0 };
    const handler = makeHandlerForStore(stubStore(makePersistedGraph()), calls);
    const outcome = await handler(invocationWith(makeIngressGraph()));
    expect(calls.n).toBe(1);
    expect((outcome as { __adopted_ingress_graph?: unknown }).__adopted_ingress_graph).toBeUndefined();
    const fact = outcome.handler_facts[0] as { result?: { graph_hash_at_run?: unknown } };
    expect(fact.result?.graph_hash_at_run).toBe(
      computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(makePersistedGraph())),
    );
  });
});
