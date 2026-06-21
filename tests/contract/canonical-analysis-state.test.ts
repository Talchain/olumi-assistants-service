/**
 * V5 Canonical Analysis State — contract tests.
 *
 * Exercises `selectCanonicalAnalysisState` (the single composed verdict)
 * directly over seeded handler-fact chains — no HTTP route, no live
 * staging — mirroring the in-process style of
 * tests/contract/analysis-freshness.test.ts.
 *
 * Proves: predicate derivation, all four contradiction codes (including
 * the by-design `ready` + advisory `constraint_dropped` NON-contradiction),
 * the current-turn + prior-turn fact unification that fixes the documented
 * chip-floor / freshness split, freshness equivalence with
 * `deriveAnalysisFreshness` (no drift), and summary redaction.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../../src/orchestrator-v5/context/graph-hash.js';
import { deriveAnalysisFreshness } from '../../src/orchestrator-v5/context/freshness.js';
import {
  selectCanonicalAnalysisState,
  summariseCanonicalAnalysisState,
  CANONICAL_ANALYSIS_STATE_VERSION,
  type ReadinessLike,
} from '../../src/orchestrator-v5/context/canonical-analysis-state.js';
import type { AnalysisBlockerT } from '../../src/schemas/analysis-ready.js';
import type { GraphStateIngress } from '../../src/orchestrator-v5/boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// ─── Fact factories (mirror analysis-freshness.test.ts) ──────────────────

interface FactOpts {
  graph_hash_at_run?: string;
  computed_at?: string;
  status?: string;
  noop?: boolean;
}

function mkRunAnalysisFact(opts: FactOpts = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {
    analysis_status: opts.status ?? 'computed',
  };
  const result: RunAnalysisHandlerFact['result'] = {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_a',
    summary: 'Ran analysis on your current scenario.',
    enrichment,
  };
  if (opts.graph_hash_at_run !== undefined) {
    result.graph_hash_at_run = opts.graph_hash_at_run;
  }
  if (opts.computed_at !== undefined) {
    result.computed_at = opts.computed_at;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: opts.noop ?? false,
    result,
  };
}

// Prior_facts is delivered NEWEST-FIRST by the loader convention.
function chain(...facts: HandlerFact[]): readonly HandlerFact[] {
  return [...facts].reverse();
}

function mkBlocker(blocker_type: AnalysisBlockerT['blocker_type']): AnalysisBlockerT {
  return {
    factor_id: 'fac_x',
    factor_label: 'Factor X',
    blocker_type,
    message: 'needs attention',
    suggested_action: blocker_type === 'constraint_dropped' ? 'review_constraint' : 'add_value',
  };
}

const baseGraph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 100 } },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [{ from: 'budget', to: 'goal' }],
} as unknown as GraphStateIngress;

const editedGraph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 250 } },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [{ from: 'budget', to: 'goal' }],
} as unknown as GraphStateIngress;

const HASH_A = computeAnalysisAffectingGraphHash(baseGraph)!;
const HASH_B = computeAnalysisAffectingGraphHash(editedGraph)!;

const READY: ReadinessLike = { status: 'ready', goal_node_id: 'goal', blockers: [] };

// ─── Tests ───────────────────────────────────────────────────────────────

describe('selectCanonicalAnalysisState — freshness / predicate derivation', () => {
  it('no analysis → freshness none, nothing usable, no rerun, not blocked', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: [],
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.version).toBe(CANONICAL_ANALYSIS_STATE_VERSION);
    expect(state.freshness).toBe('none');
    expect(state.freshness_reason).toBe('no_successful_run_analysis_fact');
    expect(state.selected_fact_index).toBeNull();
    expect(state.usableForProse).toBe(false);
    expect(state.usableForChips).toBe(false);
    expect(state.usableForFollowupContext).toBe(false);
    expect(state.requiresRerun).toBe(false);
    expect(state.blockedUnusable).toBe(false);
    expect(state.contradictions).toEqual([]);
  });

  it('fresh analysis → prose/chips/followup usable, no rerun', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.freshness).toBe('fresh');
    expect(state.usableForProse).toBe(true);
    expect(state.usableForChips).toBe(true);
    expect(state.usableForFollowupContext).toBe(true);
    expect(state.requiresRerun).toBe(false);
    expect(state.blockedUnusable).toBe(false);
  });

  it('stale analysis → prose + followup usable, chips NOT, rerun required', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: HASH_B, // graph diverged since the run
      readiness: READY,
    });
    expect(state.freshness).toBe('stale');
    expect(state.usableForProse).toBe(true);
    expect(state.usableForChips).toBe(false);
    expect(state.usableForFollowupContext).toBe(true);
    expect(state.requiresRerun).toBe(true);
    expect(state.blockedUnusable).toBe(false);
  });

  it('legacy fact (no run hash) → unknown, prose usable, chips not, no rerun', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ computed_at: '2026-04-30T01:00:00.000Z' })), // no graph_hash_at_run
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.freshness).toBe('unknown');
    expect(state.freshness_reason).toBe('legacy_fact_missing_hash');
    expect(state.usableForProse).toBe(true);
    expect(state.usableForChips).toBe(false);
    expect(state.usableForFollowupContext).toBe(true);
    expect(state.requiresRerun).toBe(false);
    expect(state.blockedUnusable).toBe(false);
    expect(state.contradictions).toEqual([]);
  });

  it('degraded-only fact (no success) → none, followup not usable, degraded status surfaced', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ status: 'failed', graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.freshness).toBe('none');
    expect(state.usableForFollowupContext).toBe(false);
    expect(state.degraded_fact_status).toBe('failed');
  });
});

describe('selectCanonicalAnalysisState — contradictions (fail loud, no silent reconcile)', () => {
  it('scenario claims analysis but no fact → blocked unusable', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: [],
      currentGraphHash: HASH_A,
      scenarioClaimsAnalysis: true,
      readiness: READY,
    });
    expect(state.contradictions).toContain('scenario_claims_analysis_no_fact');
    expect(state.blockedUnusable).toBe(true);
    expect(state.usableForProse).toBe(false);
    expect(state.usableForChips).toBe(false);
    expect(state.usableForFollowupContext).toBe(false);
  });

  it('fact present + current graph not hashable this turn → unknown, NOT blocked (recoverable follow-up)', () => {
    // No-graph follow-up turn ("explain the result") or turn-executor's
    // deliberate null-hash on a persisted-graph parse failure. This is a
    // benign, recoverable state — handled as freshness 'unknown', NOT a
    // hard block, and SYMMETRIC with the legacy-fact 'unknown' case.
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: null, // graph could not be hashed this turn
      readiness: READY,
    });
    expect(state.freshness).toBe('unknown');
    expect(state.freshness_reason).toBe('current_graph_hash_unavailable');
    expect(state.contradictions).toEqual([]);
    expect(state.blockedUnusable).toBe(false);
    expect(state.usableForProse).toBe(true); // referenceable, caveated
    expect(state.usableForFollowupContext).toBe(true);
    expect(state.usableForChips).toBe(false); // freshness unverifiable → no result chips
    expect(state.requiresRerun).toBe(false);
  });

  it('symmetry: current_graph_hash_unavailable and legacy_fact_missing_hash get identical usability', () => {
    const noCurrentHash = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: null,
      readiness: READY,
    });
    const legacyFact = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ computed_at: '2026-04-30T01:00:00.000Z' })), // no graph_hash_at_run
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    for (const s of [noCurrentHash, legacyFact]) {
      expect(s.freshness).toBe('unknown');
      expect(s.blockedUnusable).toBe(false);
      expect(s.usableForProse).toBe(true);
      expect(s.usableForFollowupContext).toBe(true);
      expect(s.usableForChips).toBe(false);
      expect(s.contradictions).toEqual([]);
    }
  });

  it('ready + ACTIONABLE blocker (missing_value) → contradiction, chips off, rerun on, prose stays', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: HASH_A,
      readiness: { status: 'ready', goal_node_id: 'goal', blockers: [mkBlocker('missing_value')] },
    });
    expect(state.contradictions).toContain('status_ready_with_actionable_blockers');
    expect(state.usableForChips).toBe(false);
    expect(state.requiresRerun).toBe(true);
    expect(state.usableForProse).toBe(true); // caveated, not hard-blocked
    expect(state.blockedUnusable).toBe(false);
  });

  it('HARDENING #2: ready + advisory constraint_dropped blocker → NO contradiction, fully usable', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: HASH_A,
      readiness: { status: 'ready', goal_node_id: 'goal', blockers: [mkBlocker('constraint_dropped')] },
    });
    expect(state.contradictions).toEqual([]);
    expect(state.usableForChips).toBe(true); // must NOT downgrade an analysable graph
    expect(state.usableForProse).toBe(true);
    expect(state.requiresRerun).toBe(false);
    // The advisory blocker is still carried for consumers that want detail…
    expect(state.blockers).toHaveLength(1);
  });

  it('newer degraded fact than the selected success → contradiction, chips off, rerun on', () => {
    const success = mkRunAnalysisFact({ status: 'computed', graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' });
    const degradedNewer = mkRunAnalysisFact({ status: 'partial', graph_hash_at_run: HASH_A, computed_at: '2026-04-30T02:00:00.000Z' });
    const state = selectCanonicalAnalysisState({
      // newest-first: degraded (t2) then success (t1)
      priorFacts: [degradedNewer, success],
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.contradictions).toContain('fact_status_success_but_degraded_newer');
    expect(state.usableForChips).toBe(false);
    expect(state.requiresRerun).toBe(true);
    expect(state.usableForProse).toBe(true);
  });

  it('degraded-newer false-positive guard: missing timestamps do NOT raise the contradiction', () => {
    // Neither fact carries computed_at → "newer" is unprovable → no
    // contradiction (the guard must not fire on ambiguous ordering).
    const success = mkRunAnalysisFact({ status: 'computed', graph_hash_at_run: HASH_A });
    const degradedNoTs = mkRunAnalysisFact({ status: 'partial', graph_hash_at_run: HASH_A });
    const state = selectCanonicalAnalysisState({
      priorFacts: [degradedNoTs, success],
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.contradictions).not.toContain('fact_status_success_but_degraded_newer');
    expect(state.usableForChips).toBe(true); // fresh + no contradiction
    expect(state.degraded_fact_status).toBe('partial');
  });

  it('degraded_fact_status is normalised to a bounded token (unknown upstream PLoT status → other)', () => {
    const success = mkRunAnalysisFact({ status: 'computed', graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' });
    const weird = mkRunAnalysisFact({ status: 'SOME_WEIRD_PLOT_STATUS_v9', graph_hash_at_run: HASH_A, computed_at: '2026-04-30T02:00:00.000Z' });
    const state = selectCanonicalAnalysisState({
      priorFacts: [weird, success],
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.degraded_fact_status).toBe('other'); // not the raw upstream string
  });
});

describe('selectCanonicalAnalysisState — current+prior fact unification (the split fix)', () => {
  it('fact in CURRENT-turn handlerFacts only → selected + fresh (not none)', () => {
    // This is the documented bug: freshness over priorFacts-only returns
    // none, while the chip floor sees the fact. The canonical selector
    // unifies them, so this is fresh.
    const state = selectCanonicalAnalysisState({
      handlerFacts: [mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })],
      priorFacts: [],
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.freshness).toBe('fresh');
    expect(state.selected_fact_index).not.toBeNull();
    expect(state.usableForChips).toBe(true);
  });

  it('fact in PRIOR facts only → also selected', () => {
    const state = selectCanonicalAnalysisState({
      handlerFacts: [],
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    expect(state.freshness).toBe('fresh');
    expect(state.selected_fact_index).not.toBeNull();
  });

  it('current-turn fact wins over an older prior fact (current is newest)', () => {
    const current = mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T03:00:00.000Z' });
    const older = mkRunAnalysisFact({ graph_hash_at_run: HASH_B, computed_at: '2026-04-30T01:00:00.000Z' });
    const state = selectCanonicalAnalysisState({
      handlerFacts: [current],
      priorFacts: chain(older),
      currentGraphHash: HASH_A,
      readiness: READY,
    });
    // Selects the current-turn fact (HASH_A) → fresh, not the older HASH_B.
    expect(state.freshness).toBe('fresh');
    expect(state.graph_hash_at_run).toBe(HASH_A);
  });
});

describe('selectCanonicalAnalysisState — equivalence with deriveAnalysisFreshness (no drift)', () => {
  it('freshness / index / hashes / computed_at match the derivation over the same unified facts', () => {
    const handlerFacts = [mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T03:00:00.000Z' })];
    const priorFacts = chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_B, computed_at: '2026-04-30T01:00:00.000Z' }));
    const unified = [...handlerFacts, ...priorFacts];

    const derivation = deriveAnalysisFreshness(unified, HASH_A);
    const state = selectCanonicalAnalysisState({ handlerFacts, priorFacts, currentGraphHash: HASH_A, readiness: READY });

    expect(state.freshness).toBe(derivation.freshness);
    expect(state.freshness_reason).toBe(derivation.reason);
    expect(state.selected_fact_index).toBe(derivation.selected_fact_index);
    expect(state.graph_hash_at_run).toBe(derivation.graph_hash_at_run);
    expect(state.current_graph_hash).toBe(derivation.current_graph_hash);
    expect(state.computed_at).toBe(derivation.computed_at);
  });
});

describe('summariseCanonicalAnalysisState — redaction (counts only)', () => {
  it('reduces blocker objects to counts and exposes no message/label content', () => {
    const state = selectCanonicalAnalysisState({
      priorFacts: chain(mkRunAnalysisFact({ graph_hash_at_run: HASH_A, computed_at: '2026-04-30T01:00:00.000Z' })),
      currentGraphHash: HASH_A,
      readiness: {
        status: 'ready',
        goal_node_id: 'goal',
        blockers: [mkBlocker('constraint_dropped'), mkBlocker('missing_value')],
      },
    });
    const summary = summariseCanonicalAnalysisState(state);

    expect(summary.blocker_count).toBe(2);
    expect(summary.actionable_blocker_count).toBe(1); // missing_value only
    expect(summary.freshness).toBe('fresh');
    expect(summary.usable_for_chips).toBe(false); // actionable blocker downgrades

    // Redaction: the summary must not carry blocker objects / message text.
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain('needs attention');
    expect(serialised).not.toContain('factor_label');
    expect(serialised).not.toContain('Factor X');
    expect('blockers' in (summary as unknown as Record<string, unknown>)).toBe(false);
  });
});
