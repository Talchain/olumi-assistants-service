/**
 * V5 Coaching State Spine — Stage 2A unit tests for deriveCoachingState.
 *
 * Covers the per-kind derivation with controlled inputs. Integration wiring +
 * telemetry + the freshness-agreement guard live in
 * ../../__tests__/build-turn-context.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { DecisionContext, HandlerFact } from '@talchain/schemas/orchestrator';

import {
  deriveCoachingState,
  EMPTY_COACHING_STATE,
  type CoachingState,
  type CoachingStateSignal,
} from '../coaching-state.js';
import type { FreshnessDerivation } from '../../context/freshness.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function dc(status: DecisionContext['status']): DecisionContext {
  return {
    domain_anchors: { monetary_figures: [], timeline: null, named_entities: [] },
    goal_translation: { user_scale_metric: null, user_scale_target: null },
    status,
  };
}

function fresh(
  freshness: FreshnessDerivation['freshness'],
  reason: FreshnessDerivation['reason'],
  graph_hash_at_run: string | null = null,
  current_graph_hash: string | null = null,
): FreshnessDerivation {
  return {
    freshness,
    reason,
    selected_fact_index: freshness === 'none' ? null : 0,
    graph_hash_at_run,
    current_graph_hash,
    computed_at: null,
  };
}

const FRESH = fresh('fresh', 'graph_hash_match', 'h_run', 'h_run');
const NONE = fresh('none', 'no_successful_run_analysis_fact');
const STALE = fresh('stale', 'graph_hash_diverged', 'h_run', 'h_now');
const UNKNOWN_LEGACY = fresh('unknown', 'legacy_fact_missing_hash', null, 'h_now');
const UNKNOWN_NO_HASH = fresh('unknown', 'current_graph_hash_unavailable', 'h_run', null);

/** A run_analysis fact, optionally carrying decision_review.evidence_enhancements. */
function makeRunAnalysisFact(
  evidence: 'none' | 'absent' | 'empty' | Record<string, unknown>,
): HandlerFact {
  const enrichment: Record<string, unknown> = { analysis_status: 'computed' };
  if (evidence !== 'none') {
    const decisionReview: Record<string, unknown> = { produced_at: '2026-06-01T00:00:00Z' };
    if (evidence === 'empty') decisionReview.evidence_enhancements = {};
    else if (evidence !== 'absent') decisionReview.evidence_enhancements = evidence;
    enrichment.decision_review = decisionReview;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    turn_id: 't1',
    noop: false,
    result: { graph_hash_at_run: 'h_run', computed_at: '2026-06-01T00:00:00Z', enrichment },
  } as unknown as HandlerFact;
}

function base(overrides: Partial<Parameters<typeof deriveCoachingState>[0]> = {}) {
  return deriveCoachingState({
    decisionContext: dc('populated'),
    freshness: FRESH,
    priorFacts: [],
    graphHash: 'h_now',
    persistedGraph: null,
    ...overrides,
  });
}

function ids(state: CoachingState): string[] {
  return state.signals.map((s) => s.signal_id).sort();
}

function signalOf(state: CoachingState, kind: CoachingStateSignal['kind']): CoachingStateSignal | undefined {
  return state.signals.find((s) => s.kind === kind);
}

// ---------------------------------------------------------------------------
// 1. Container always present
// ---------------------------------------------------------------------------

describe('deriveCoachingState — container', () => {
  it('EMPTY_COACHING_STATE is the canonical empty shape', () => {
    expect(EMPTY_COACHING_STATE).toEqual({
      version: 'v1',
      status: 'empty',
      graph_hash: null,
      analysis_graph_hash: null,
      signals: [],
      summary: { active_count: 0, stale_count: 0, unavailable_count: 0 },
    });
  });

  it('always returns a versioned container with a summary', () => {
    const state = base();
    expect(state.version).toBe('v1');
    expect(state.summary).toBeDefined();
    expect(state.graph_hash).toBe('h_now');
    expect(state.analysis_graph_hash).toBe('h_run'); // from FRESH.graph_hash_at_run
  });

  // 2 (positive empty): everything healthy → empty, zero signals.
  it('is empty when decision context is populated, analysis fresh, no blockers/defaults/evidence-gap', () => {
    const state = base({ decisionContext: dc('populated'), freshness: FRESH, persistedGraph: null });
    expect(state.status).toBe('empty');
    expect(state.signals).toHaveLength(0);
    expect(state.summary).toEqual({ active_count: 0, stale_count: 0, unavailable_count: 0 });
  });

  // 2 (cold start): not_populated + no analysis → exactly these two, container active.
  it('cold start: not_populated context + no analysis → exactly [analysis_missing, decision_context_missing] active', () => {
    const state = base({ decisionContext: dc('not_populated'), freshness: NONE, persistedGraph: null });
    expect(state.status).toBe('active');
    expect(ids(state)).toEqual([
      'analysis_missing:no_successful_run_analysis_fact',
      'decision_context_missing:not_populated',
    ]);
    expect(state.summary).toEqual({ active_count: 2, stale_count: 0, unavailable_count: 0 });
  });

  // 2 (degraded): malformed input fails closed.
  it('degrades safely when an input is malformed (never throws)', () => {
    const state = deriveCoachingState({
      decisionContext: dc('populated'),
      // @ts-expect-error — deliberately malformed to exercise the fail-closed path
      freshness: null,
      priorFacts: [],
      graphHash: 'h_x',
      persistedGraph: null,
    });
    expect(state.status).toBe('degraded');
    expect(state.signals).toHaveLength(0);
    expect(state.graph_hash).toBe('h_x');
  });
});

// ---------------------------------------------------------------------------
// 3 + 4. Determinism + stable IDs
// ---------------------------------------------------------------------------

describe('deriveCoachingState — determinism & stable IDs', () => {
  it('is deterministic (same input → deep-equal output)', () => {
    const input = {
      decisionContext: dc('not_populated'),
      freshness: STALE,
      priorFacts: [makeRunAnalysisFact({ a: { confidence_defaulted: true } })],
      graphHash: 'h_now',
      persistedGraph: buildD1Fixture(),
    } as const;
    expect(deriveCoachingState({ ...input })).toEqual(deriveCoachingState({ ...input }));
  });

  it('signal_id is exactly `${kind}:${reason_code}` and stable', () => {
    const state = base({ decisionContext: dc('not_populated'), freshness: STALE });
    for (const s of state.signals) {
      expect(s.signal_id).toBe(`${s.kind}:${s.reason_code}`);
    }
    expect(signalOf(state, 'analysis_stale')!.signal_id).toBe('analysis_stale:graph_hash_diverged');
    expect(signalOf(state, 'decision_context_missing')!.signal_id).toBe(
      'decision_context_missing:not_populated',
    );
  });
});

// ---------------------------------------------------------------------------
// 5 + 6. Status semantics: active / stale / unavailable via real producers; no resolved
// ---------------------------------------------------------------------------

describe('deriveCoachingState — statuses', () => {
  it('only ever uses active | stale | unavailable (no resolved/dismissed/…) and created_from is current-turn', () => {
    const state = base({
      decisionContext: dc('not_populated'),
      freshness: STALE,
      priorFacts: [makeRunAnalysisFact({ f1: {} })],
      persistedGraph: buildD1Fixture(),
    });
    expect(state.signals.length).toBeGreaterThan(0);
    for (const s of state.signals) {
      expect(['active', 'stale', 'unavailable']).toContain(s.status);
      expect(s.created_from).toBe('derived_current_turn');
    }
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain('resolved');
    expect(serialised).not.toContain('dismissed');
    expect(serialised).not.toContain('superseded');
  });

  it('stale: ONLY via evidence_gap_available when decision_review present and analysis stale', () => {
    const state = base({ freshness: STALE, priorFacts: [makeRunAnalysisFact({ f1: { gap: true } })] });
    const ev = signalOf(state, 'evidence_gap_available');
    expect(ev?.status).toBe('stale');
    expect(ev?.reason_code).toBe('evidence_enhancements_present');
    expect(ev?.analysis_graph_hash).toBe('h_run');
    // exactly one stale signal, and it is the evidence-gap one
    expect(state.summary.stale_count).toBe(1);
    expect(state.signals.filter((s) => s.status === 'stale').map((s) => s.kind)).toEqual([
      'evidence_gap_available',
    ]);
  });

  it('unavailable: analysis_stale when freshness unknown (hash compare impossible)', () => {
    const legacy = base({ freshness: UNKNOWN_LEGACY });
    const a = signalOf(legacy, 'analysis_stale');
    expect(a?.status).toBe('unavailable');
    expect(a?.reason_code).toBe('legacy_fact_missing_hash');

    const noHash = base({ freshness: UNKNOWN_NO_HASH });
    expect(signalOf(noHash, 'analysis_stale')?.reason_code).toBe('current_graph_hash_unavailable');
  });

  it('unavailable: evidence_gap_available when decision_review present but evidence empty', () => {
    const state = base({ freshness: FRESH, priorFacts: [makeRunAnalysisFact('empty')] });
    const ev = signalOf(state, 'evidence_gap_available');
    expect(ev?.status).toBe('unavailable');
    expect(ev?.reason_code).toBe('evidence_enhancements_absent');
  });
});

// ---------------------------------------------------------------------------
// 7 + 8. Freshness-driven analysis signals
// ---------------------------------------------------------------------------

describe('deriveCoachingState — analysis freshness', () => {
  it('fresh analysis → no analysis_missing and no analysis_stale', () => {
    const state = base({ freshness: FRESH });
    expect(signalOf(state, 'analysis_missing')).toBeUndefined();
    expect(signalOf(state, 'analysis_stale')).toBeUndefined();
  });

  it('distinguishes analysis_missing (none) from analysis_stale (diverged)', () => {
    const missing = base({ freshness: NONE });
    expect(signalOf(missing, 'analysis_missing')?.status).toBe('active');
    expect(signalOf(missing, 'analysis_stale')).toBeUndefined();

    const stale = base({ freshness: STALE });
    expect(signalOf(stale, 'analysis_stale')?.status).toBe('active');
    expect(signalOf(stale, 'analysis_stale')?.reason_code).toBe('graph_hash_diverged');
    expect(signalOf(stale, 'analysis_stale')?.analysis_graph_hash).toBe('h_run');
    expect(signalOf(stale, 'analysis_missing')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Readiness blockers — only from structured (GraphV3-parseable) data
// ---------------------------------------------------------------------------

describe('deriveCoachingState — readiness blockers', () => {
  it('emits readiness_blocker signals from a parseable graph with open items', () => {
    // buildD1Fixture: goal + 1 unmapped option, no goal_threshold → too_few_options,
    // option_needs_mapping, goal_threshold_missing.
    const state = base({ freshness: FRESH, persistedGraph: buildD1Fixture() });
    const blockers = state.signals.filter((s) => s.kind === 'readiness_blocker');
    const reasons = blockers.map((s) => s.reason_code).sort();
    expect(reasons).toContain('too_few_options');
    expect(reasons).toContain('option_needs_mapping');
    expect(reasons).toContain('goal_threshold_missing');
    for (const b of blockers) {
      expect(b.status).toBe('active');
      expect(b.source).toBe('analysis_readiness');
    }
  });

  it('emits goal_node_missing when a parseable graph has no goal node', () => {
    const graph = buildD1Fixture();
    const noGoal = { ...graph, nodes: graph.nodes.filter((n) => n.kind !== 'goal') };
    const state = base({ freshness: FRESH, persistedGraph: noGoal });
    const blockers = state.signals.filter((s) => s.kind === 'readiness_blocker');
    expect(blockers.map((s) => s.reason_code)).toEqual(['goal_node_missing']);
  });

  it('emits NO readiness signals from an unparseable graph (fail closed)', () => {
    const state = base({ freshness: FRESH, persistedGraph: { nodes: 'not-an-array' } });
    expect(state.signals.filter((s) => s.kind === 'readiness_blocker')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. evidence_gap_available — only from a genuinely present structured field
// ---------------------------------------------------------------------------

describe('deriveCoachingState — evidence gap honesty', () => {
  it('does NOT emit when decision_review is absent (gated-off default)', () => {
    const state = base({ freshness: FRESH, priorFacts: [makeRunAnalysisFact('none')] });
    expect(signalOf(state, 'evidence_gap_available')).toBeUndefined();
  });

  it('does NOT emit when there is no run_analysis fact at all', () => {
    const state = base({ freshness: NONE, priorFacts: [] });
    expect(signalOf(state, 'evidence_gap_available')).toBeUndefined();
  });

  it('active when decision_review present with a non-empty evidence_enhancements record (fresh analysis)', () => {
    const state = base({ freshness: FRESH, priorFacts: [makeRunAnalysisFact({ f1: { x: 1 } })] });
    const ev = signalOf(state, 'evidence_gap_available');
    expect(ev?.status).toBe('active');
    expect(ev?.source).toBe('existing_enrichment');
  });

  it('treats evidence_enhancements as a Record, not an array (array shape → unavailable)', () => {
    // Defensive: an array in that slot is not the real Record shape → not "present".
    const fact = makeRunAnalysisFact('absent');
    const state = base({ freshness: FRESH, priorFacts: [fact] });
    expect(signalOf(state, 'evidence_gap_available')?.status).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// 11. No semantic inference from free text / labels
// ---------------------------------------------------------------------------

describe('deriveCoachingState — projection not inference', () => {
  it('never echoes graph labels or decision content into signals (only closed-enum codes/hashes)', () => {
    const graph = buildD1Fixture(); // labels: "Revenue", "Customer churn", "Marketing budget", …
    const state = base({
      decisionContext: dc('not_populated'),
      freshness: STALE,
      priorFacts: [makeRunAnalysisFact({ secretFactor: { note: 'Customer churn' } })],
      persistedGraph: graph,
    });
    const serialised = JSON.stringify(state);
    expect(serialised).not.toContain('Revenue');
    expect(serialised).not.toContain('Customer churn');
    expect(serialised).not.toContain('Marketing budget');
    expect(serialised).not.toContain('secretFactor');
  });

  it('defaulted_or_unknown_value fires only from a structured edge.defaulted === true', () => {
    const withDefault = base({
      freshness: FRESH,
      persistedGraph: { nodes: [], edges: [{ from: 'a', to: 'b', defaulted: true }] },
    });
    expect(signalOf(withDefault, 'defaulted_or_unknown_value')?.reason_code).toBe(
      'edge_strength_defaulted',
    );

    const noDefault = base({
      freshness: FRESH,
      persistedGraph: { nodes: [], edges: [{ from: 'a', to: 'b', defaulted: false }] },
    });
    expect(signalOf(noDefault, 'defaulted_or_unknown_value')).toBeUndefined();
  });
});
