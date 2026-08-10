/**
 * EP2 read-boundary guard — PRODUCTION-PATH integration tests.
 *
 * Exercises the REAL wired functions (not the core in isolation):
 *   - loadScenarioSnapshotForRunAnalysis (the run_analysis ScenarioReader seam):
 *     canonicalise-before-GraphV3.safeParse, block on unrecoverable, canonical
 *     rawPersistedGraph.
 *   - deriveDecisionContextGraphHash (the freshness-side hash site): canonicalise-
 *     before-hash + unrecoverable short-circuit to null.
 *   - the run_analysis handler: blocked → typed `analysis_not_ready` (no PLoT call,
 *     no fact); repaired → analysed with a canonical graph_hash_at_run.
 *   - flag-off parity on BOTH the run-time and freshness paths.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  loadScenarioSnapshotForRunAnalysis,
  deriveDecisionContextGraphHash,
} from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { AnalysisNotReadyError } from '../analysis-ready-core.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { HandlerInvocation } from '../../registry.js';
import { config } from '../../../../config/index.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import {
  buildFactorScaleMap,
  projectRequestInterventionsToWireScale,
} from '../../plot-intervention-scale.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { SessionReadError } from '../../../session/store.js';
import type { SessionStore } from '../../../session/store.js';

type Dict = Record<string, unknown>;

function setGuard(on: boolean): void {
  (config.cee as { analysisReadyGuardEnabled: boolean }).analysisReadyGuardEnabled = on;
}
// NULL-graph recoverable kill-switch (default ON). Independent of the EP2 guard.
function setNullRecoverable(on: boolean): void {
  (config.cee as { runAnalysisNullGraphRecoverable: boolean }).runAnalysisNullGraphRecoverable = on;
}
afterEach(() => {
  setGuard(false); // EP2 default (OFF)
  setNullRecoverable(true); // kill-switch default (ON)
});

/** Valid BASE; opt_hybrid carries a canonical numeric intervention. */
function makeBase(): Dict {
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
/** F1: the DGAI autosave-shaped broken option (interventions under node.data, raw £120,000). */
function makeBrokenF1(raw = 120000): Dict {
  const g = makeBase();
  const opt = (g.nodes as Dict[]).find((n) => n.id === 'opt_hybrid')!;
  delete opt.interventions;
  opt.data = { interventions: { fac_annual_cost: { unit: '£', raw_value: raw } } };
  return g;
}
/** F3: missing cap → unrecoverable. */
function makeUnrecoverableF3(): Dict {
  const g = makeBrokenF1();
  const fac = (g.nodes as Dict[]).find((n) => n.id === 'fac_annual_cost')!;
  fac.observed_state = { value: 0.6, unit: '£' }; // cap removed
  return g;
}
function stubStore(graph: unknown): SessionStore {
  // The run_analysis reader uses loadPersistedGraphStrict → store.loadGraph. Provide
  // both methods so the stub matches the real interface (loadGraph drives the seam;
  // loadGraphAndBriefText kept for any brief-reading path).
  return {
    loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: null }),
  } as unknown as SessionStore;
}
// A store whose reads THROW (DB/RPC failure). The strict reader propagates this, so it
// must classify as a retryable scenario_read_failed, NOT a genuinely-missing graph.
function throwingStore(err: Error): SessionStore {
  return {
    loadGraph: async () => { throw err; },
    loadGraphAndBriefText: async () => { throw err; },
  } as unknown as SessionStore;
}
function optInterventions(snapshotOption: Dict): Dict {
  return (snapshotOption.interventions ?? {}) as Dict;
}

// Shared run_analysis handler harness (module-scope so both the EP2 and the
// NULL-graph handler describes can use it). `plotRunCalls.n` counts real PLoT runs.
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
  const scenarioReader = async (scenarioId: string) =>
    loadScenarioSnapshotForRunAnalysis(scenarioId, 'req', store);
  return createRunAnalysisHandler({ plotClient, scenarioReader });
}
function makeHandler(graph: unknown, plotRunCalls: { n: number }) {
  return makeHandlerForStore(stubStore(graph), plotRunCalls);
}
const invocation = { payload: { scenario_id: '11111111-1111-4111-8111-111111111111' }, requestId: 'req1', signal: undefined } as unknown as HandlerInvocation;

describe('EP2 integration — loadScenarioSnapshotForRunAnalysis (run-time seam)', () => {
  it('guard OFF: the broken node.data option is dropped (the bug EP2 fixes) → not configured', async () => {
    setGuard(false);
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makeBrokenF1()));
    const opt = snap.options.find((o) => (o as Dict).option_id === 'opt_hybrid') as Dict;
    expect(Object.keys(optInterventions(opt))).toHaveLength(0); // node.data stripped by GraphV3.safeParse
  });

  it('guard ON: the broken node.data option is canonicalised before strip → configured (RAW user-scale)', async () => {
    setGuard(true);
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makeBrokenF1()));
    const opt = snap.options.find((o) => (o as Dict).option_id === 'opt_hybrid') as Dict;
    // UPDATED round 4 (final-payload enforcement): the loader returns the
    // canonicalised intervention OBJECT (0.8 normalised, cap 150000) — the ONE
    // request-level projection now runs in run_analysis after the scaffold.
    // Both halves of the original intent are asserted: the guard canonicalised
    // the node.data option (object present, configured), AND the run-path
    // projection resolves it to RAW user-scale 120000.
    const ivObject = optInterventions(opt).fac_annual_cost as Record<string, unknown>;
    expect(ivObject).toMatchObject({ value: expect.any(Number) });
    const scaleMap = buildFactorScaleMap((snap.graph as { nodes: unknown }).nodes);
    const projected = projectRequestInterventionsToWireScale(
      [{ fac_annual_cost: ivObject }],
      scaleMap,
    );
    expect(projected.perOption[0]!.fac_annual_cost).toBeCloseTo(120000, 6);
    // rawPersistedGraph is the canonical graph → graph_hash_at_run is over the canonical projection.
    const parsed = GraphStateIngressSchema.safeParse(snap.rawPersistedGraph);
    expect(parsed.success).toBe(true);
  });

  it('guard ON: an unrecoverable graph throws AnalysisNotReadyError (→ typed blocked, not a read failure)', async () => {
    setGuard(true);
    await expect(loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makeUnrecoverableF3())))
      .rejects.toMatchObject({ name: 'AnalysisNotReadyError' });
  });

  it('guard OFF: an unrecoverable-shaped graph does NOT throw AnalysisNotReadyError (parity)', async () => {
    setGuard(false);
    // node.data stripped → option simply unconfigured; reader returns a snapshot (no EP2 block).
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makeUnrecoverableF3()));
    expect(snap.goal_node_id).toBe('goal_1');
  });
});

describe('EP2 integration — freshness/hash consistency (deriveDecisionContextGraphHash)', () => {
  it('repaired graph: run-time graph_hash_at_run == freshness-side hash (NOT falsely stale)', async () => {
    setGuard(true);
    const broken = makeBrokenF1();
    // Run-time hash: exactly how run-analysis.ts computes graph_hash_at_run from snapshot.rawPersistedGraph.
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(broken));
    const parsed = GraphStateIngressSchema.safeParse(snap.rawPersistedGraph);
    const runHash = parsed.success ? computeAnalysisAffectingGraphHash(parsed.data) : null;
    // Freshness-side hash over the same persisted (broken) graph.
    const freshHash = deriveDecisionContextGraphHash(broken);
    expect(runHash).not.toBeNull();
    expect(freshHash).toBe(runHash); // consistency — a repaired run reads fresh, not stale
  });

  it('shape-only churn stays the same hash; a real value change shifts it (stale)', () => {
    setGuard(true);
    const h120 = deriveDecisionContextGraphHash(makeBrokenF1(120000));
    const hTopLevelRawSame = deriveDecisionContextGraphHash((() => {
      // same £120,000 written as a top-level raw-only entry (shape-only churn).
      const g = makeBase();
      const opt = (g.nodes as Dict[]).find((n) => n.id === 'opt_hybrid')!;
      opt.interventions = { fac_annual_cost: { unit: '£', raw_value: 120000 } };
      return g;
    })());
    const h130 = deriveDecisionContextGraphHash(makeBrokenF1(130000));
    expect(hTopLevelRawSame).toBe(h120); // shape-only churn does not flap freshness
    expect(h130).not.toBe(h120); // value change → different hash → stale
  });

  it('unrecoverable graph short-circuits freshness to null (unknown, not fresh)', () => {
    setGuard(true);
    expect(deriveDecisionContextGraphHash(makeUnrecoverableF3())).toBeNull();
  });

  it('flag-off parity: freshness hash equals the raw (un-canonicalised) baseline hash', () => {
    const broken = makeBrokenF1();
    setGuard(false);
    const off = deriveDecisionContextGraphHash(broken);
    const baseline = (() => {
      const parsed = GraphStateIngressSchema.safeParse(broken);
      return parsed.success ? computeAnalysisAffectingGraphHash(parsed.data) : null;
    })();
    expect(off).toBe(baseline); // byte-identical to today when the guard is off
  });
});

describe('EP2 integration — run_analysis handler blocked/analysed', () => {
  it('guard ON + unrecoverable → analysis_not_ready (NO PLoT call, no run_analysis fact)', async () => {
    setGuard(true);
    const calls = { n: 0 };
    const handler = makeHandler(makeUnrecoverableF3(), calls);
    let err: unknown;
    try { await handler(invocation); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HandlerInvocationFailedError);
    expect((err as HandlerInvocationFailedError).cause_kind).toBe('analysis_not_ready');
    expect(calls.n).toBe(0); // PLoT was never called
  });

  it('guard ON + repaired (broken node.data) → analysed, PLoT called, canonical graph_hash_at_run present', async () => {
    setGuard(true);
    const calls = { n: 0 };
    const handler = makeHandler(makeBrokenF1(), calls);
    const outcome = await handler(invocation);
    expect(calls.n).toBe(1);
    const fact = outcome.handler_facts[0] as { result?: { graph_hash_at_run?: unknown } };
    expect(typeof fact.result?.graph_hash_at_run).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// NULL persisted graph → typed recoverable (the cee-staging 500 fix).
// Distinct from EP2: this is the genuinely-no-graph branch (no model drafted/
// saved), gated by its OWN default-ON kill-switch, NOT by analysisReadyGuardEnabled.
// ---------------------------------------------------------------------------
describe('NULL persisted graph — reader seam (loadScenarioSnapshotForRunAnalysis)', () => {
  it('kill-switch ON (default) + EP2 OFF: throws AnalysisNotReadyError(NO_GRAPH) — fix is NOT gated on EP2', async () => {
    setGuard(false); // EP2 off — proves flag-independence from CEE_RUN_ANALYSIS_READY_GUARD
    let err: unknown;
    try { await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AnalysisNotReadyError);
    const verdict = (err as AnalysisNotReadyError).verdict;
    expect(verdict.reasonCodes).toEqual(['NO_GRAPH']);
    expect(verdict.nextStep).toBe('Draft or save a model first, then run analysis.');
  });

  it('kill-switch ON + EP2 ON: still AnalysisNotReadyError — the EP2 guard is downstream of the null branch', async () => {
    setGuard(true);
    await expect(loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null)))
      .rejects.toMatchObject({ name: 'AnalysisNotReadyError' });
  });

  it('kill-switch FORCED OFF: rolls back to the legacy raw Error (the 500 path), NOT AnalysisNotReadyError', async () => {
    setNullRecoverable(false);
    let err: unknown;
    try { await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(null)); } catch (e) { err = e; }
    expect(err).not.toBeInstanceOf(AnalysisNotReadyError);
    expect((err as Error)?.message).toContain('No persisted graph found');
  });

  it('a PRESENT graph is unaffected by the kill-switch (regression: normal load still succeeds)', async () => {
    setGuard(false);
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makeBase()));
    expect(snap.goal_node_id).toBe('goal_1');
  });

  it('STORE/RPC failure: propagates SessionReadError verbatim — NOT converted to AnalysisNotReadyError', async () => {
    // The strict reader (loadPersistedGraphStrict → store.loadGraph) THROWS on a DB/RPC
    // failure; loadScenarioSnapshotForRunAnalysis must let it PROPAGATE so a transient
    // store outage is never misread as "no model". Kill-switch ON (default).
    setGuard(false);
    const boom = new SessionReadError('loadGraph failed: supabase RPC down');
    await expect(loadScenarioSnapshotForRunAnalysis('sc', 'req', throwingStore(boom)))
      .rejects.toBe(boom); // exact same error object — not wrapped, not converted to NO_GRAPH
  });

  it('a present-but-corrupt FALSY graph (0, "") is NOT NO_GRAPH — it is malformed, not missing', async () => {
    // The null branch uses `== null`, so the recovery is scoped to a genuinely absent
    // graph. A corrupt falsy value is present-but-invalid → it must fall through to
    // GraphV3 validation (→ scenario_read_failed), never be misclassified as "draft a
    // model first" (which a truthy `!persistedGraph` check would have done).
    setGuard(false);
    for (const corrupt of [0, '']) {
      let err: unknown;
      try { await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(corrupt)); } catch (e) { err = e; }
      expect(err).not.toBeInstanceOf(AnalysisNotReadyError);
      expect((err as Error)?.message).toMatch(/GraphV3 validation/);
    }
  });
});

describe('NULL persisted graph — run_analysis handler (analysis_not_ready, NO PLoT, NO fact)', () => {
  it('kill-switch ON + EP2 OFF: handler → analysis_not_ready; ZERO PLoT calls; ZERO handler facts', async () => {
    setGuard(false);
    const calls = { n: 0 };
    const handler = makeHandler(null, calls);
    let outcome: Awaited<ReturnType<typeof handler>> | undefined;
    let err: unknown;
    try { outcome = await handler(invocation); } catch (e) { err = e; }
    // Typed recoverable failure, NOT the retryable scenario_read_failed (which reads as a 500).
    expect(err).toBeInstanceOf(HandlerInvocationFailedError);
    expect((err as HandlerInvocationFailedError).cause_kind).toBe('analysis_not_ready');
    // EXPLICIT zero-PLoT proof (NOT inferred from a 200 body): the run counter never moved.
    expect(calls.n).toBe(0);
    // EXPLICIT zero-fact proof: the handler threw before any PLoT result, so no outcome /
    // handler_facts object was ever produced (facts are only assembled from a PLoT result).
    expect(outcome).toBeUndefined();
  });

  it('kill-switch ON + EP2 OFF: the typed failure carries reason_code NO_GRAPH + the draft-a-model next step', async () => {
    setGuard(false);
    const calls = { n: 0 };
    const handler = makeHandler(null, calls);
    let err: unknown;
    try { await handler(invocation); } catch (e) { err = e; }
    const details = (err as HandlerInvocationFailedError).details as Record<string, unknown>;
    expect(details.reason_code).toBe('NO_GRAPH');
    expect(details.next_step).toBe('Draft or save a model first, then run analysis.');
    expect(calls.n).toBe(0);
  });

  it('PRESENT graph (EP2 OFF, kill-switch ON = deployed default): analysed normally — PLoT called once, fact produced', async () => {
    setGuard(false);
    const calls = { n: 0 };
    const handler = makeHandler(makeBase(), calls);
    const outcome = await handler(invocation);
    expect(calls.n).toBe(1); // PLoT called exactly once — normal path untouched
    const fact = outcome.handler_facts[0] as { result?: { graph_hash_at_run?: unknown } };
    expect(typeof fact.result?.graph_hash_at_run).toBe('string'); // run_analysis fact produced
  });

  it('STORE/RPC failure (real strict seam) → scenario_read_failed (retryable), NOT analysis_not_ready; ZERO PLoT, ZERO fact', async () => {
    // Load-bearing: the production reader now THROWS SessionReadError on a store/RPC
    // failure (it no longer swallows to null), so a transient outage stays a retryable
    // infra failure instead of a misleading "draft a model first" 200. This exercises
    // the REAL seam the injected-throwing-reader unit test (run-analysis.test.ts) could
    // not prove, because the old non-strict reader swallowed store errors into null.
    setGuard(false);
    const calls = { n: 0 };
    const handler = makeHandlerForStore(
      throwingStore(new SessionReadError('loadGraph failed: supabase RPC down')),
      calls,
    );
    let outcome: Awaited<ReturnType<typeof handler>> | undefined;
    let err: unknown;
    try { outcome = await handler(invocation); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HandlerInvocationFailedError);
    expect((err as HandlerInvocationFailedError).cause_kind).toBe('scenario_read_failed');
    expect((err as HandlerInvocationFailedError).retryable).toBe(true);
    expect(calls.n).toBe(0); // no PLoT
    expect(outcome).toBeUndefined(); // no fact
  });
});

describe('NULL persisted graph — freshness derivation is unaffected', () => {
  it('deriveDecisionContextGraphHash(null) is null regardless of the kill-switch (no leak into freshness)', () => {
    setNullRecoverable(true);
    expect(deriveDecisionContextGraphHash(null)).toBeNull();
    setNullRecoverable(false);
    expect(deriveDecisionContextGraphHash(null)).toBeNull();
  });
});
