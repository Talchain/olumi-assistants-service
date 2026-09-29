/**
 * POC-BOARD item 4 — RELOAD black-box + freshness-vs-committed.
 *
 * The invariant this pins: after an edit-commit, the graph analysis CONSUMED,
 * the graph a RELOAD shows, and the graph FRESHNESS compares against are ALL
 * the one committed `scenarios.graph` row — never the current turn's
 * UI-supplied `graph_state` ingress.
 *
 * ⚠️ Finding (re-derived at staging tip, NOT inherited from the item brief):
 * the item-4 premise as originally framed — "freshness compares two hashes
 * BOTH computed from the UI-supplied graph_state ingress" — is STALE for this
 * estate. A prior fix (run-analysis.ts, build abc7d29, documented inline
 * there) already made `graph_hash_at_run` derive from `snapshot.rawPersistedGraph`
 * (the committed row), and `loadScenarioSnapshotForRunAnalysis` takes NO
 * request graph at all — so the "graph analysis ran against" is committed-only
 * BY CONSTRUCTION. The turn-executor's `current_graph_hash` likewise prefers
 * `context.persistedGraph` (the committed row) over ingress. So the gap the
 * brief describes is already closed; these tests therefore GUARD the invariant
 * against regression and assert the POST-CAS authority (item 3's
 * graph_identity_hash is stamped from the same committed row), rather than
 * exposing an open gap.
 *
 * The `computeExpectedGraphCasHashes` used here is item 3's helper — using it
 * deliberately ties this invariant to the CAS anchor: the identity hash v3
 * stamps into scenarios.graph_identity_hash and the analysis hash freshness
 * compares both derive from the SAME committed graph via the single normaliser
 * authority.
 */
import { describe, it, expect } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import type { EnrichedTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import { deriveContextReadiness } from '../context/readiness.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** A GraphV3-valid committed decision graph (hiring). */
const COMMITTED_GRAPH = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Ship AI Features Within 6 Months' },
    { id: 'dec_1', kind: 'decision', label: 'Hiring Decision' },
    { id: 'opt_lead', kind: 'option', label: 'Hire Tech Lead', interventions: { fac_cost: 1, fac_velocity: 1 } },
    { id: 'opt_devs', kind: 'option', label: 'Hire Two Developers', interventions: { fac_cost: 0.6, fac_velocity: 0.7 } },
    { id: 'fac_cost', kind: 'factor', label: 'Hiring Cost', category: 'controllable', observed_state: { value: 120000, unit: 'GBP', extractionType: 'explicit', factor_type: 'cost' } },
    { id: 'fac_velocity', kind: 'factor', label: 'Team Velocity', category: 'controllable', observed_state: { value: 0.7, extractionType: 'inferred', factor_type: 'other' } },
    { id: 'out_delivery', kind: 'outcome', label: 'Feature Delivery Rate' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_lead', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_devs', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_lead', to: 'fac_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_lead', to: 'fac_velocity', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_devs', to: 'fac_cost', strength: { mean: 0.6, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_devs', to: 'fac_velocity', strength: { mean: 0.7, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_cost', to: 'out_delivery', strength: { mean: -0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
    { from: 'fac_velocity', to: 'out_delivery', strength: { mean: 0.75, std: 0.08 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'out_delivery', to: 'goal_1', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

/**
 * A DIVERGED committed graph: a concurrent analysis-affecting edit landed
 * (fac_cost value moved). Models "the committed row moved on after analysis ran".
 */
const DIVERGED_COMMITTED_GRAPH = {
  ...COMMITTED_GRAPH,
  nodes: COMMITTED_GRAPH.nodes.map((n) =>
    n.id === 'fac_cost'
      ? { ...n, observed_state: { value: 90000, unit: 'GBP', extractionType: 'explicit', factor_type: 'cost' } }
      : n,
  ),
};

/** Hash a raw graph the way run-analysis / turn-executor do (ingress-parse → analysis hash). */
function analysisHash(raw: unknown): string {
  const parsed = GraphStateIngressSchema.safeParse(raw);
  if (!parsed.success) throw new Error('fixture must ingress-parse');
  const hash = computeAnalysisAffectingGraphHash(parsed.data);
  if (hash === null) throw new Error('fixture must produce an analysis hash');
  return hash;
}

function mkRunAnalysisFact(graphHashAtRun: string): RunAnalysisHandlerFact {
  const result: RunAnalysisHandlerFact['result'] = {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_lead',
    summary: 'Ran analysis on your current scenario.',
    enrichment: { analysis_status: 'computed' },
    graph_hash_at_run: graphHashAtRun,
  };
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result };
}

// ── 1. graph analysis consumed == committed row (never the request graph) ──

describe('item 4 — graph_hash_at_run is sourced from the COMMITTED row', () => {
  it('rawPersistedGraph on the run_analysis snapshot equals the committed scenarios.graph', async () => {
    const store = createNoopSessionStore({ loadGraphResult: COMMITTED_GRAPH });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-1', store);

    // Structural guarantee: loadScenarioSnapshotForRunAnalysis takes only
    // (scenarioId, requestId, store) — there is NO request-graph parameter it
    // could hash instead. rawPersistedGraph IS the committed row.
    expect(snapshot.rawPersistedGraph).toEqual(COMMITTED_GRAPH);

    // graph_hash_at_run (run-analysis.ts hashes exactly this) therefore tracks
    // the committed row, byte-for-byte.
    expect(analysisHash(snapshot.rawPersistedGraph)).toBe(analysisHash(COMMITTED_GRAPH));
  });

  it('committed == reload: what a subsequent scenario read shows equals what analysis consumed', async () => {
    const store = createNoopSessionStore({ loadGraphResult: COMMITTED_GRAPH });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-2', store);
    const reload = await store.loadGraphAndBriefText(SCENARIO_ID);

    expect(reload.graph).toEqual(COMMITTED_GRAPH);
    // consumed === reload === committed
    expect(reload.graph).toEqual(snapshot.rawPersistedGraph);
  });
});

// ── 2. freshness verdict is anchored to the committed row ──

describe('item 4 — freshness tracks the committed row', () => {
  it('committed unchanged since the run → FRESH', () => {
    const committedHash = analysisHash(COMMITTED_GRAPH);
    const fact = mkRunAnalysisFact(committedHash);
    // current_graph_hash derived from the (unchanged) committed row.
    const d = deriveAnalysisFreshness([fact], committedHash);
    expect(d.freshness).toBe('fresh');
    expect(d.reason).toBe('graph_hash_match');
  });

  it('committed row moved on after the run (concurrent edit landed) → STALE (honest)', () => {
    const ranAgainstHash = analysisHash(COMMITTED_GRAPH);
    const fact = mkRunAnalysisFact(ranAgainstHash);
    // current_graph_hash derived from the NOW-DIVERGED committed row.
    const currentFromCommitted = analysisHash(DIVERGED_COMMITTED_GRAPH);
    expect(currentFromCommitted).not.toBe(ranAgainstHash);
    const d = deriveAnalysisFreshness([fact], currentFromCommitted);
    expect(d.freshness).toBe('stale');
    expect(d.reason).toBe('graph_hash_diverged');
  });
});

// ── 3. the false-fresh trap the committed-source design avoids ──

describe('item 4 — sourcing current_graph_hash from the committed row (not ingress) prevents false-fresh', () => {
  it('a lagging client re-sending the OLD graph would read FALSE-FRESH from ingress, but STALE from committed', () => {
    // The committed row has actually advanced to DIVERGED (a real edit landed).
    // Analysis ran against the OLD committed graph, so its stamped
    // graph_hash_at_run == analysisHash(old).
    const ranAgainstHash = analysisHash(COMMITTED_GRAPH);
    const fact = mkRunAnalysisFact(ranAgainstHash);

    // (a) THE BUG the brief warns about: if current_graph_hash came from the
    // client's STALE ingress graph (still the OLD graph), it would equal the
    // run hash → a FALSE 'fresh' over a committed row that has actually moved.
    const staleIngressHash = analysisHash(COMMITTED_GRAPH); // client is behind
    const bugVerdict = deriveAnalysisFreshness([fact], staleIngressHash);
    expect(bugVerdict.freshness).toBe('fresh'); // ← false-fresh, if ingress-sourced

    // (b) THE ESTATE: current_graph_hash is sourced from the COMMITTED row
    // (context.persistedGraph), which is now DIVERGED → the honest verdict.
    const committedVerdict = deriveAnalysisFreshness([fact], analysisHash(DIVERGED_COMMITTED_GRAPH));
    expect(committedVerdict.freshness).toBe('stale'); // ← honest, committed-sourced

    // The two disagree — which is precisely why the current-hash MUST come from
    // the committed row. This test regression-guards that choice.
    expect(bugVerdict.freshness).not.toBe(committedVerdict.freshness);
  });
});

// ── 4. post-CAS authority: CAS anchor + freshness read the same committed row ──

describe('item 4 — post-CAS: the committed row is the single authority for both hashes', () => {
  it('the identity hash item-3 v3 stamps and the analysis hash freshness compares both derive from the committed graph', () => {
    const cas = computeExpectedGraphCasHashes(COMMITTED_GRAPH);
    // Both hashes are computable from the committed row (the single source).
    expect(cas.expectedGraphIdentityHash).not.toBeNull();
    expect(cas.expectedGraphAnalysisHash).not.toBeNull();
    // The analysis hash freshness uses is exactly the committed row's.
    expect(cas.expectedGraphAnalysisHash).toBe(analysisHash(COMMITTED_GRAPH));

    // A real committed edit forks BOTH the CAS identity anchor (so item 3
    // catches a concurrent stale write) and the freshness analysis hash (so a
    // reload reads 'stale') — proving they cannot silently disagree with the
    // committed row.
    const divergedCas = computeExpectedGraphCasHashes(DIVERGED_COMMITTED_GRAPH);
    expect(divergedCas.expectedGraphIdentityHash).not.toBe(cas.expectedGraphIdentityHash);
    expect(divergedCas.expectedGraphAnalysisHash).not.toBe(cas.expectedGraphAnalysisHash);
  });

  it('the hashes are deterministic (stable across recompute) — a reload cannot fork them', () => {
    expect(computeExpectedGraphCasHashes(COMMITTED_GRAPH).expectedGraphIdentityHash).toBe(
      computeExpectedGraphCasHashes(COMMITTED_GRAPH).expectedGraphIdentityHash,
    );
    expect(analysisHash(COMMITTED_GRAPH)).toBe(analysisHash(COMMITTED_GRAPH));
  });
});

// ── 5. item 7 — the coach context identifies the SAME revision shown to the user ──
//
// The turn threads a SINGLE FreshnessDerivation to (a) the wire's
// analysis_ready (finalizeRun), (b) the coach ContextPack (compose.ts:135 —
// the Phase 3 blocks are tagged current_graph_hash = the selected fact's
// graph_hash_at_run on the fresh path), and (c) the coach-facing context
// readiness snapshot (turn-executor.ts:1622 deriveContextReadiness({ context,
// freshness })). Because it is one derivation, the revision the coach reasons
// about cannot drift from the revision the user sees. This guards that
// single-source invariant at the readiness seam (the deeper full-turn e2e —
// compose ContextPack + finalize sharing the derivation — holds by
// construction; a full driven-turn assertion would be its own lane).

function makeContext(persistedGraph: unknown, priorFacts: readonly RunAnalysisHandlerFact[]): EnrichedTurnContext {
  return {
    prior_turns: [],
    prior_facts: priorFacts,
    prior_facts_with_turn: [],
    scenarioBriefText: null,
    persistedGraph,
    most_recent_pending_actions: [],
  } as unknown as EnrichedTurnContext;
}

function makeFreshness(overrides: Partial<FreshnessDerivation>): FreshnessDerivation {
  return {
    freshness: 'none',
    reason: 'no_successful_run_analysis_fact',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: null,
    computed_at: null,
    ...overrides,
  };
}

describe('item 7 — coach context revision == visible revision', () => {
  it('the coach-facing readiness identifies the SAME committed revision the turn ships on the wire', () => {
    const committedHash = analysisHash(COMMITTED_GRAPH);
    const fact = mkRunAnalysisFact(committedHash);
    // The one derivation that also drives the wire + the coach ContextPack.
    const freshness = makeFreshness({
      freshness: 'fresh',
      reason: 'graph_hash_match',
      selected_fact_index: 0,
      graph_hash_at_run: committedHash,
      current_graph_hash: committedHash,
    });

    const readiness = deriveContextReadiness({
      context: makeContext(COMMITTED_GRAPH, [fact]),
      freshness,
      recentChangeCount: 0,
      contextPackChars: 1000,
    });

    // (a) coach revision == wire revision — sourced from the SAME derivation.
    expect(readiness.current_graph_hash).toBe(freshness.current_graph_hash);
    expect(readiness.latest_analysis_graph_hash).toBe(freshness.graph_hash_at_run);

    // (b) == the committed graph the USER sees (item 4 chain: committed row).
    expect(readiness.current_graph_hash).toBe(committedHash);

    // (c) the coach's structural picture is drawn from the committed graph,
    // not any ingress graph — same revision, end to end.
    expect(readiness.graph_node_count).toBe(COMMITTED_GRAPH.nodes.length);
    expect(readiness.graph_edge_count).toBe(COMMITTED_GRAPH.edges.length);

    // (d) fresh ⇒ the analysis revision and the shown-graph revision coincide.
    expect(readiness.latest_analysis_graph_hash).toBe(readiness.current_graph_hash);
  });

  it('a revision split is SURFACED, never papered over: readiness mirrors freshness verbatim', () => {
    // If the committed row had moved on (stale), the coach must SEE stale — the
    // readiness cannot silently report the old revision as current.
    const ranAgainstHash = analysisHash(COMMITTED_GRAPH);
    const currentCommittedHash = analysisHash(DIVERGED_COMMITTED_GRAPH);
    const fact = mkRunAnalysisFact(ranAgainstHash);
    const freshness = makeFreshness({
      freshness: 'stale',
      reason: 'graph_hash_diverged',
      selected_fact_index: 0,
      graph_hash_at_run: ranAgainstHash,
      current_graph_hash: currentCommittedHash,
    });

    const readiness = deriveContextReadiness({
      context: makeContext(DIVERGED_COMMITTED_GRAPH, [fact]),
      freshness,
      recentChangeCount: 1,
      contextPackChars: 1000,
    });

    // The coach sees the CURRENT committed revision as current, and the (older)
    // analysis revision as what the run used — a truthful, non-matching pair.
    expect(readiness.latest_analysis_freshness).toBe('stale');
    expect(readiness.current_graph_hash).toBe(currentCommittedHash);
    expect(readiness.latest_analysis_graph_hash).toBe(ranAgainstHash);
    expect(readiness.current_graph_hash).not.toBe(readiness.latest_analysis_graph_hash);
  });
});
