/**
 * V5 Coaching State Spine — Stage 2B-2: pure lifecycle derivation tests.
 *
 * Covers the decision tree (active/resolved/stale/unavailable), the honesty rules
 * (`resolved` only on positive evaluability evidence; decision_review absence never
 * resolves; readiness fail-closed), source-aware stale detection, malformed/missing/
 * version-mismatched prior handling, pre_dispatch symmetry, determinism, `superseded`
 * deferral, summary reconciliation, and evaluability↔producer divergence.
 */

import { describe, it, expect } from 'vitest';

import {
  deriveCoachingLifecycle,
  deriveCoachingEvaluability,
  EMPTY_COACHING_LIFECYCLE,
  type CoachingEvaluability,
  type CoachingLifecycleStatus,
} from '../coaching-lifecycle.js';
import {
  deriveCoachingState,
  evaluateReadiness,
  isAnalysisFreshnessEvaluable,
  isGraphProjectionEvaluable,
  type CoachingState,
  type CoachingStateSignal,
} from '../coaching-state.js';
import type { CoachingStateSnapshot } from '../coaching-state-snapshot.js';
import type { FreshnessDerivation } from '../../context/freshness.js';
import { EMPTY_DECISION_CONTEXT } from '@talchain/schemas/orchestrator';

// ── builders ────────────────────────────────────────────────────────────────

const ALL_FALSE: CoachingEvaluability = {
  decision_context: false,
  analysis_freshness: false,
  analysis_readiness: false,
  graph_projection: false,
  existing_enrichment: false,
};
const evalWith = (o: Partial<CoachingEvaluability>): CoachingEvaluability => ({ ...ALL_FALSE, ...o });

function sig(
  o: Pick<CoachingStateSignal, 'kind' | 'source' | 'reason_code'> & Partial<CoachingStateSignal>,
): CoachingStateSignal {
  return {
    signal_id: o.signal_id ?? `${o.kind}:${o.reason_code}`,
    kind: o.kind,
    status: o.status ?? 'active',
    source: o.source,
    graph_hash: o.graph_hash ?? null,
    analysis_graph_hash: o.analysis_graph_hash ?? null,
    reason_code: o.reason_code,
    created_from: 'derived_current_turn',
  };
}

function summarise(signals: readonly CoachingStateSignal[]) {
  let active = 0,
    stale = 0,
    unavailable = 0;
  for (const s of signals) {
    if (s.status === 'active') active += 1;
    else if (s.status === 'stale') stale += 1;
    else unavailable += 1;
  }
  return { active_count: active, stale_count: stale, unavailable_count: unavailable };
}

function current(
  signals: CoachingStateSignal[],
  opts: { status?: CoachingState['status']; graph_hash?: string | null; analysis_graph_hash?: string | null } = {},
): CoachingState {
  return {
    version: 'v1',
    status: opts.status ?? (signals.length ? 'active' : 'empty'),
    graph_hash: opts.graph_hash ?? null,
    analysis_graph_hash: opts.analysis_graph_hash ?? null,
    signals,
    summary: summarise(signals),
  };
}

function priorOf(state: CoachingState, version = 'v1'): CoachingStateSnapshot {
  return { snapshot_timing: 'pre_dispatch', coaching_state_version: version, coaching_state: state };
}

const READINESS = sig({ kind: 'readiness_blocker', source: 'analysis_readiness', reason_code: 'goal_threshold_missing' });
const ANALYSIS_STALE = sig({ kind: 'analysis_stale', source: 'analysis_freshness', reason_code: 'graph_hash_diverged' });
const ANALYSIS_MISSING = sig({ kind: 'analysis_missing', source: 'analysis_freshness', reason_code: 'no_successful_run_analysis_fact' });
const EVIDENCE_GAP = sig({ kind: 'evidence_gap_available', source: 'existing_enrichment', reason_code: 'evidence_enhancements_present' });

const LIFECYCLE_STATUSES: ReadonlySet<string> = new Set<CoachingLifecycleStatus>([
  'active',
  'resolved',
  'stale',
  'unavailable',
]);

// ── 1-2: active ───────────────────────────────────────────────────────────────

describe('coaching-lifecycle — active', () => {
  it('(1) prior signal still present in current → active / present_in_current', () => {
    const s = sig({ kind: 'readiness_blocker', source: 'analysis_readiness', reason_code: 'goal_threshold_missing', graph_hash: 'h1' });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([s])),
      current: current([{ ...s, graph_hash: 'h1' }], { graph_hash: 'h1' }),
      evaluability: ALL_FALSE,
      currentGraphHash: 'h1',
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ lifecycle_status: 'active', reason: 'present_in_current', prior_graph_hash: 'h1', current_graph_hash: 'h1' });
    expect(out.summary.active_count).toBe(1);
    expect(out.prior_snapshot_available).toBe(true);
  });

  it('(2) current signal with no prior counterpart → active / new_in_current', () => {
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([])),
      current: current([READINESS]),
      evaluability: ALL_FALSE,
      currentGraphHash: null,
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ lifecycle_status: 'active', reason: 'new_in_current', prior_graph_hash: null });
  });
});

// ── 3-5: resolved / stale / unavailable ───────────────────────────────────────

describe('coaching-lifecycle — resolved/stale/unavailable decision tree', () => {
  it('(3) prior absent + source evaluable → resolved (canonical analysis_stale→fresh rerun)', () => {
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([ANALYSIS_STALE])),
      current: current([]), // rerun cleared it
      evaluability: evalWith({ analysis_freshness: true }),
      currentGraphHash: 'h_new',
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ lifecycle_status: 'resolved', reason: 'source_evaluable_condition_absent' });
    expect(out.summary.resolved_count).toBe(1);
  });

  it('(4) prior absent + unevaluable + graph hash diverged → stale', () => {
    const prior = sig({ kind: 'readiness_blocker', source: 'analysis_readiness', reason_code: 'goal_threshold_missing', graph_hash: 'h_old' });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([prior])),
      current: current([], { graph_hash: 'h_new' }),
      evaluability: ALL_FALSE, // analysis_readiness false
      currentGraphHash: 'h_new',
    });
    expect(out.items[0]).toMatchObject({ lifecycle_status: 'stale', reason: 'source_unevaluable_context_moved' });
    expect(out.summary.stale_count).toBe(1);
  });

  it('(5) prior absent + unevaluable + no hash movement → unavailable', () => {
    const prior = sig({ kind: 'readiness_blocker', source: 'analysis_readiness', reason_code: 'goal_threshold_missing', graph_hash: 'h_same' });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([prior])),
      current: current([], { graph_hash: 'h_same' }),
      evaluability: ALL_FALSE,
      currentGraphHash: 'h_same',
    });
    expect(out.items[0]).toMatchObject({ lifecycle_status: 'unavailable', reason: 'source_unevaluable_indeterminate' });
  });

  it('positive evaluation beats stale: evaluable + hash moved → resolved (not stale)', () => {
    const prior = sig({ kind: 'readiness_blocker', source: 'analysis_readiness', reason_code: 'goal_threshold_missing', graph_hash: 'h_old' });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([prior])),
      current: current([], { graph_hash: 'h_new' }),
      evaluability: evalWith({ analysis_readiness: true }),
      currentGraphHash: 'h_new',
    });
    expect(out.items[0].lifecycle_status).toBe('resolved');
  });
});

// ── 6: existing_enrichment honesty (keystone) ─────────────────────────────────

describe('coaching-lifecycle — honesty: absence never resolves', () => {
  it('(6) decision_review absent (existing_enrichment unevaluable) → evidence_gap is unavailable, NEVER resolved', () => {
    const prior = sig({ kind: 'evidence_gap_available', source: 'existing_enrichment', reason_code: 'evidence_enhancements_present', analysis_graph_hash: 'a_old' });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([prior])),
      current: current([]),
      evaluability: ALL_FALSE, // existing_enrichment false (decision_review absent)
      currentGraphHash: null,
    });
    expect(out.items[0].lifecycle_status).not.toBe('resolved');
    expect(out.items[0].lifecycle_status).toBe('unavailable'); // no hashes to move
    expect(out.summary.resolved_count).toBe(0);
  });

  it('(8) freshness none→unknown: prior analysis_missing absent + freshness unevaluable → unavailable, not resolved', () => {
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([ANALYSIS_MISSING])),
      current: current([]),
      evaluability: ALL_FALSE, // analysis_freshness false (verdict became unknown)
      currentGraphHash: null,
    });
    expect(out.items[0].lifecycle_status).toBe('unavailable');
    expect(out.summary.resolved_count).toBe(0);
  });
});

// ── 7: readiness fail-closed ──────────────────────────────────────────────────

describe('coaching-lifecycle — readiness fail-closed', () => {
  it('(7) prior readiness_blocker absent + analysis_readiness NOT evaluable → NOT resolved', () => {
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([READINESS])),
      current: current([]),
      evaluability: ALL_FALSE, // analysis_readiness false (e.g. recompute would have thrown)
      currentGraphHash: null,
    });
    expect(out.items[0].lifecycle_status).not.toBe('resolved');
  });

  it('evaluateReadiness fails closed (evaluable=false) on null / unparseable graph', () => {
    expect(evaluateReadiness(null, null).evaluable).toBe(false);
    expect(evaluateReadiness({ not: 'a graph' }, null).evaluable).toBe(false);
    expect(evaluateReadiness('nonsense', null).evaluable).toBe(false);
  });
});

// ── 9-11: missing / malformed / version-mismatch prior ────────────────────────

describe('coaching-lifecycle — degraded/absent prior handling', () => {
  it('(9) missing prior (null) → prior_snapshot_available false, current-only all active', () => {
    const out = deriveCoachingLifecycle({ prior: null, current: current([READINESS, ANALYSIS_MISSING]), evaluability: ALL_FALSE, currentGraphHash: null });
    expect(out.prior_snapshot_available).toBe(false);
    expect(out.items).toHaveLength(2);
    expect(out.items.every((i) => i.lifecycle_status === 'active')).toBe(true);
    expect(out.summary.resolved_count).toBe(0);
  });

  it('(10) malformed prior signal entries are skipped; never throw, never resolved; current still works', () => {
    const malformedPrior = {
      snapshot_timing: 'pre_dispatch' as const,
      coaching_state_version: 'v1',
      coaching_state: {
        ...current([]),
        // inner signals deliberately malformed (parser does not validate entries)
        signals: [
          { signal_id: '', kind: 'analysis_missing', source: 'analysis_freshness', reason_code: 'no_successful_run_analysis_fact' }, // empty id
          { kind: 'analysis_missing', source: 'analysis_freshness', reason_code: 'no_successful_run_analysis_fact' }, // missing id
          { signal_id: 'x:y', kind: 'bogus_kind', source: 'analysis_freshness', reason_code: 'no_successful_run_analysis_fact' }, // bad kind
          { signal_id: 'x:y', kind: 'analysis_missing', source: 'not_a_source', reason_code: 'no_successful_run_analysis_fact' }, // bad source
          { signal_id: 'x:y', kind: 'analysis_missing', source: 'analysis_freshness', reason_code: 'not_a_reason' }, // bad reason
          null,
          'garbage',
        ] as unknown as CoachingStateSignal[],
      } as CoachingState,
    };
    const run = () =>
      deriveCoachingLifecycle({ prior: malformedPrior, current: current([READINESS]), evaluability: evalWith({ analysis_freshness: true }), currentGraphHash: null });
    expect(run).not.toThrow();
    const out = run();
    // Only the one CURRENT signal survives as active; no malformed prior produced a resolved.
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ signal_id: 'readiness_blocker:goal_threshold_missing', lifecycle_status: 'active' });
    expect(out.summary.resolved_count).toBe(0);
  });

  it('invalid source on a prior signal does not crash and is skipped', () => {
    const prior = {
      snapshot_timing: 'pre_dispatch' as const,
      coaching_state_version: 'v1',
      coaching_state: { ...current([]), signals: [{ signal_id: 'k:r', kind: 'analysis_missing', source: 'WUT', reason_code: 'no_successful_run_analysis_fact', graph_hash: null, analysis_graph_hash: null, created_from: 'derived_current_turn', status: 'active' }] as unknown as CoachingStateSignal[] } as CoachingState,
    };
    const out = deriveCoachingLifecycle({ prior, current: current([]), evaluability: evalWith({ analysis_freshness: true }), currentGraphHash: null });
    expect(out.items).toHaveLength(0);
    expect(out.summary.resolved_count).toBe(0);
  });

  it('(11) version mismatch → version_mismatch true, status degraded, current-only active facts kept', () => {
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([ANALYSIS_STALE]), 'v0'),
      current: current([READINESS]),
      evaluability: evalWith({ analysis_freshness: true }),
      currentGraphHash: null,
    });
    expect(out.version_mismatch).toBe(true);
    expect(out.status).toBe('degraded');
    expect(out.prior_snapshot_available).toBe(false);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ signal_id: 'readiness_blocker:goal_threshold_missing', lifecycle_status: 'active' });
    expect(out.summary.resolved_count).toBe(0); // no resolved derived from the incompatible prior
  });

  it('non-pre_dispatch prior is unusable: NO resolved/stale, degraded, current-only (timing symmetry guard)', () => {
    // A post_dispatch prior would mix post-mutation prior state with pre-dispatch current —
    // the function must reject it itself, not rely on the 2B-1b parser. The prior signal
    // WOULD resolve if compared (source evaluable), so this proves the guard fires.
    const postPrior = {
      snapshot_timing: 'post_dispatch' as unknown as 'pre_dispatch',
      coaching_state_version: 'v1',
      coaching_state: current([ANALYSIS_STALE]),
    };
    const out = deriveCoachingLifecycle({
      prior: postPrior,
      current: current([]),
      evaluability: evalWith({ analysis_freshness: true }),
      currentGraphHash: 'h_new',
    });
    expect(out.prior_snapshot_available).toBe(false);
    expect(out.status).toBe('degraded');
    expect(out.items).toHaveLength(0); // the post_dispatch prior produced NO item
    expect(out.summary.resolved_count).toBe(0);
    expect(out.summary.stale_count).toBe(0);
  });

  it('inner coaching_state.version mismatch (envelope v1, inner v0) → version_mismatch, current-only', () => {
    const prior = {
      snapshot_timing: 'pre_dispatch' as const,
      coaching_state_version: 'v1', // envelope matches current
      coaching_state: { ...current([ANALYSIS_STALE]), version: 'v0' } as unknown as CoachingState, // inner drifts
    };
    const out = deriveCoachingLifecycle({
      prior,
      current: current([READINESS]),
      evaluability: evalWith({ analysis_freshness: true }),
      currentGraphHash: null,
    });
    expect(out.version_mismatch).toBe(true);
    expect(out.status).toBe('degraded');
    expect(out.prior_snapshot_available).toBe(false);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ signal_id: 'readiness_blocker:goal_threshold_missing', lifecycle_status: 'active' });
    expect(out.summary.resolved_count).toBe(0);
  });
});

// ── 12-14: invariants ─────────────────────────────────────────────────────────

describe('coaching-lifecycle — invariants', () => {
  it('(12) snapshot_timing is always pre_dispatch on the output', () => {
    expect(deriveCoachingLifecycle({ prior: null, current: current([]), evaluability: ALL_FALSE, currentGraphHash: null }).snapshot_timing).toBe('pre_dispatch');
    expect(EMPTY_COACHING_LIFECYCLE.snapshot_timing).toBe('pre_dispatch');
  });

  it('(13) deterministic + degraded prior yields current-only (no post-dispatch / phantom prior)', () => {
    const input = { prior: priorOf(current([])), current: current([READINESS]), evaluability: ALL_FALSE, currentGraphHash: 'h' } as const;
    expect(deriveCoachingLifecycle(input)).toEqual(deriveCoachingLifecycle(input));
    const degradedPrior = priorOf({ ...current([ANALYSIS_STALE]), status: 'degraded' });
    const out = deriveCoachingLifecycle({ prior: degradedPrior, current: current([READINESS]), evaluability: evalWith({ analysis_freshness: true }), currentGraphHash: null });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].lifecycle_status).toBe('active');
    expect(out.summary.resolved_count).toBe(0);
  });

  it('(14) superseded never appears; statuses are exactly the four-value union', () => {
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([ANALYSIS_STALE, READINESS, EVIDENCE_GAP])),
      current: current([READINESS]),
      evaluability: evalWith({ analysis_freshness: true }),
      currentGraphHash: 'h_new',
    });
    for (const it of out.items) {
      expect(LIFECYCLE_STATUSES.has(it.lifecycle_status)).toBe(true);
      expect(it.lifecycle_status).not.toBe('superseded');
    }
  });

  it('current degraded → degraded container, no items', () => {
    const out = deriveCoachingLifecycle({ prior: priorOf(current([READINESS])), current: current([], { status: 'degraded' }), evaluability: ALL_FALSE, currentGraphHash: null });
    expect(out.status).toBe('degraded');
    expect(out.items).toHaveLength(0);
    // No comparison happens on the degraded-current path, so the flag is false even though a
    // prior envelope was supplied (the flag means "a usable prior was compared").
    expect(out.prior_snapshot_available).toBe(false);
  });
});

// ── 15 + source-aware stale + summary + dedup ─────────────────────────────────

describe('coaching-lifecycle — source-aware stale, summary, dedup', () => {
  it('analysis-context movement (analysis_graph_hash diverged) marks an analysis signal stale', () => {
    const prior = sig({ kind: 'evidence_gap_available', source: 'existing_enrichment', reason_code: 'evidence_enhancements_present', graph_hash: 'g_same', analysis_graph_hash: 'a_old' });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([prior])),
      current: current([], { graph_hash: 'g_same', analysis_graph_hash: 'a_new' }),
      evaluability: ALL_FALSE,
      currentGraphHash: 'g_same',
    });
    // graph hash is unchanged, but the ANALYSIS context moved → stale (source-aware).
    expect(out.items[0].lifecycle_status).toBe('stale');
  });

  it('missing analysis + graph hashes → unavailable (never stale from missing hashes)', () => {
    const prior = sig({ kind: 'evidence_gap_available', source: 'existing_enrichment', reason_code: 'evidence_enhancements_present', graph_hash: null, analysis_graph_hash: null });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([prior])),
      current: current([], { analysis_graph_hash: null }),
      evaluability: ALL_FALSE,
      currentGraphHash: null,
    });
    expect(out.items[0].lifecycle_status).toBe('unavailable');
  });

  it('graph-context movement marks a graph signal stale even if analysis hashes are null', () => {
    const prior = sig({ kind: 'defaulted_or_unknown_value', source: 'graph_projection', reason_code: 'edge_strength_defaulted', graph_hash: 'g_old' });
    const out = deriveCoachingLifecycle({ prior: priorOf(current([prior])), current: current([], { graph_hash: 'g_new' }), evaluability: ALL_FALSE, currentGraphHash: 'g_new' });
    expect(out.items[0].lifecycle_status).toBe('stale');
  });

  it('(15) mixed scenario: summary reconciles and only closed-enum/no-content fields appear', () => {
    const priorResolved = ANALYSIS_STALE; // absent in current + evaluable → resolved
    const priorStale = sig({ kind: 'readiness_blocker', source: 'analysis_readiness', reason_code: 'goal_threshold_missing', graph_hash: 'h_old' }); // unevaluable + moved
    const priorUnavail = sig({ kind: 'defaulted_or_unknown_value', source: 'graph_projection', reason_code: 'edge_strength_defaulted', graph_hash: null }); // unevaluable + no movement
    const stillActive = sig({ kind: 'decision_context_missing', source: 'decision_context', reason_code: 'not_populated', graph_hash: 'h_new' });
    const out = deriveCoachingLifecycle({
      prior: priorOf(current([priorResolved, priorStale, priorUnavail, stillActive])),
      current: current([stillActive], { graph_hash: 'h_new' }),
      evaluability: evalWith({ analysis_freshness: true }), // only freshness evaluable
      currentGraphHash: 'h_new',
    });
    expect(out.summary).toEqual({ active_count: 1, resolved_count: 1, stale_count: 1, unavailable_count: 1 });
    const total = out.summary.active_count + out.summary.resolved_count + out.summary.stale_count + out.summary.unavailable_count;
    expect(total).toBe(out.items.length);
    const allowed = new Set(['signal_id', 'kind', 'reason_code', 'source', 'lifecycle_status', 'prior_graph_hash', 'current_graph_hash', 'prior_analysis_graph_hash', 'current_analysis_graph_hash', 'reason']);
    for (const it of out.items) expect(Object.keys(it).every((k) => allowed.has(k))).toBe(true);
  });

  it('dedup: a signal present in BOTH prior and current yields exactly one (active) item', () => {
    const out = deriveCoachingLifecycle({ prior: priorOf(current([READINESS])), current: current([READINESS]), evaluability: ALL_FALSE, currentGraphHash: null });
    expect(out.items.filter((i) => i.signal_id === READINESS.signal_id)).toHaveLength(1);
    expect(out.items[0].lifecycle_status).toBe('active');
  });

  it('duplicate well-formed prior signal_ids (absent from current) are deduped — counts not inflated', () => {
    const dup = sig({ kind: 'analysis_stale', source: 'analysis_freshness', reason_code: 'graph_hash_diverged', analysis_graph_hash: 'a' });
    const priorWithDups = {
      snapshot_timing: 'pre_dispatch' as const,
      coaching_state_version: 'v1',
      coaching_state: { ...current([]), signals: [dup, { ...dup }, { ...dup }] } as CoachingState,
    };
    const out = deriveCoachingLifecycle({
      prior: priorWithDups,
      current: current([]),
      evaluability: evalWith({ analysis_freshness: true }),
      currentGraphHash: null,
    });
    // Three identical prior signal_ids → exactly ONE resolved item, not three.
    expect(out.items).toHaveLength(1);
    expect(out.summary.resolved_count).toBe(1);
  });

  it('empty prior + empty current → empty container, no items', () => {
    const out = deriveCoachingLifecycle({ prior: priorOf(current([])), current: current([]), evaluability: ALL_FALSE, currentGraphHash: null });
    expect(out.status).toBe('empty');
    expect(out.items).toHaveLength(0);
  });
});

// ── evaluability ↔ producer divergence guard ──────────────────────────────────

describe('coaching-lifecycle — evaluability shares producer logic (divergence guard)', () => {
  const fresh = (v: FreshnessDerivation['freshness']): FreshnessDerivation =>
    ({ freshness: v, graph_hash_at_run: null } as unknown as FreshnessDerivation);

  it('analysis_freshness evaluable ⟺ verdict !== unknown ⟺ producer does NOT emit an unavailable analysis_stale', () => {
    for (const v of ['fresh', 'stale', 'none', 'unknown'] as const) {
      const evaluable = isAnalysisFreshnessEvaluable(fresh(v));
      expect(evaluable).toBe(v !== 'unknown');
      const produced = deriveCoachingState({
        decisionContext: EMPTY_DECISION_CONTEXT,
        freshness: fresh(v),
        priorFacts: [],
        graphHash: 'h',
        persistedGraph: null,
      });
      const hasUnavailableStale = produced.signals.some((s) => s.kind === 'analysis_stale' && s.status === 'unavailable');
      expect(hasUnavailableStale).toBe(!evaluable);
    }
  });

  it('graph_projection evaluable ⟺ object with edges array (the producer gate)', () => {
    expect(isGraphProjectionEvaluable(null)).toBe(false);
    expect(isGraphProjectionEvaluable({})).toBe(false); // no edges array
    expect(isGraphProjectionEvaluable({ edges: 'x' })).toBe(false);
    expect(isGraphProjectionEvaluable({ edges: [] })).toBe(true);
  });

  it('deriveCoachingEvaluability is total and decision_context is always evaluable', () => {
    const e = deriveCoachingEvaluability({ freshness: fresh('unknown'), priorFacts: [], persistedGraph: null });
    expect(e.decision_context).toBe(true);
    expect(e.analysis_freshness).toBe(false);
    expect(e.analysis_readiness).toBe(false);
    expect(e.graph_projection).toBe(false);
    expect(e.existing_enrichment).toBe(false);
  });
});
