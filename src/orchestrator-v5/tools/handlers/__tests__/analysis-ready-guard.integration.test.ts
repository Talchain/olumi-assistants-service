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
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { HandlerInvocation } from '../../registry.js';
import { config } from '../../../../config/index.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { SessionStore } from '../../../session/store.js';

type Dict = Record<string, unknown>;

function setGuard(on: boolean): void {
  (config.cee as { analysisReadyGuardEnabled: boolean }).analysisReadyGuardEnabled = on;
}
afterEach(() => setGuard(false));

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
  return { loadGraphAndBriefText: async () => ({ graph, briefText: null }) } as unknown as SessionStore;
}
function optInterventions(snapshotOption: Dict): Dict {
  return (snapshotOption.interventions ?? {}) as Dict;
}

describe('EP2 integration — loadScenarioSnapshotForRunAnalysis (run-time seam)', () => {
  it('guard OFF: the broken node.data option is dropped (the bug EP2 fixes) → not configured', async () => {
    setGuard(false);
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makeBrokenF1()));
    const opt = snap.options.find((o) => (o as Dict).option_id === 'opt_hybrid') as Dict;
    expect(Object.keys(optInterventions(opt))).toHaveLength(0); // node.data stripped by GraphV3.safeParse
  });

  it('guard ON: the broken node.data option is canonicalised before strip → configured (0.8)', async () => {
    setGuard(true);
    const snap = await loadScenarioSnapshotForRunAnalysis('sc', 'req', stubStore(makeBrokenF1()));
    const opt = snap.options.find((o) => (o as Dict).option_id === 'opt_hybrid') as Dict;
    expect(optInterventions(opt).fac_annual_cost).toBeCloseTo(0.8, 10);
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
  const PLOT_OK = {
    analysis_status: 'computed',
    results: [
      { option_id: 'opt_hybrid', option_label: 'Hybrid', win_probability: 0.6 },
      { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.4 },
    ],
    response_hash: 'hash_x',
    meta: { seed_used: 1 },
  };
  function makeHandler(graph: unknown, plotRunCalls: { n: number }) {
    const plotClient = {
      run: async () => { plotRunCalls.n += 1; return PLOT_OK; },
    } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];
    const scenarioReader = async (scenarioId: string) =>
      loadScenarioSnapshotForRunAnalysis(scenarioId, 'req', stubStore(graph));
    return createRunAnalysisHandler({ plotClient, scenarioReader });
  }
  const invocation = { payload: { scenario_id: '11111111-1111-4111-8111-111111111111' }, requestId: 'req1', signal: undefined } as unknown as HandlerInvocation;

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
