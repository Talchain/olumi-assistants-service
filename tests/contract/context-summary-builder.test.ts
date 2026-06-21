/**
 * M3 — `_context_summary` builder + redaction (pure, in-process).
 *
 * Proves the redacted summary shape carries ONLY statuses / predicates /
 * counts / hashes (key allowlist), never raw blocker messages or labels;
 * that un-threaded fields are emitted as `null` (honest "not observed
 * here", per hardening #4); and that `canonicalStateFromFreshness` (the
 * route-seam adapter) produces the same predicate verdicts as the
 * fact-based selector, including the hardening-#2 advisory-blocker case.
 */
import { describe, it, expect } from 'vitest';

import { canonicalStateFromFreshness } from '../../src/orchestrator-v5/context/canonical-analysis-state.js';
import {
  buildV5ContextSummary,
  summariseGraphCounts,
  V5_CONTEXT_SUMMARY_VERSION,
} from '../../src/orchestrator-v5/context/build-context-summary.js';
import type { FreshnessDerivation } from '../../src/orchestrator-v5/context/freshness.js';

function derivation(over: Partial<FreshnessDerivation> = {}): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: 'HASH',
    current_graph_hash: 'HASH',
    computed_at: '2026-05-01T00:00:00.000Z',
    ...over,
  };
}

const ANALYSIS_STATE_KEYS = [
  'actionable_blocker_count',
  'blocked_unusable',
  'blocker_count',
  'contradiction_codes',
  'current_graph_hash',
  'degraded_fact_status',
  'freshness',
  'freshness_reason',
  'graph_hash_at_run',
  'requires_rerun',
  'selected_fact_index',
  'status',
  'usable_for_chips',
  'usable_for_followup_context',
  'usable_for_prose',
].sort();

describe('canonicalStateFromFreshness (route-seam adapter)', () => {
  it('fresh + ready → usable for prose/chips/followup, no rerun, no degraded (facts absent)', () => {
    const s = canonicalStateFromFreshness(derivation(), { readiness: { status: 'ready' } });
    expect(s.freshness).toBe('fresh');
    expect(s.usableForProse).toBe(true);
    expect(s.usableForChips).toBe(true);
    expect(s.usableForFollowupContext).toBe(true);
    expect(s.requiresRerun).toBe(false);
    expect(s.degraded_fact_status).toBeNull();
  });

  it('stale → requires rerun, chips off, prose on', () => {
    const s = canonicalStateFromFreshness(
      derivation({ freshness: 'stale', reason: 'graph_hash_diverged', current_graph_hash: 'HASH2' }),
      { readiness: { status: 'ready' } },
    );
    expect(s.requiresRerun).toBe(true);
    expect(s.usableForChips).toBe(false);
    expect(s.usableForProse).toBe(true);
  });

  it('none → nothing usable', () => {
    const s = canonicalStateFromFreshness(
      derivation({
        freshness: 'none',
        reason: 'no_successful_run_analysis_fact',
        selected_fact_index: null,
        graph_hash_at_run: null,
        computed_at: null,
      }),
      {},
    );
    expect(s.usableForProse).toBe(false);
    expect(s.usableForFollowupContext).toBe(false);
  });

  it('ready + ACTIONABLE blocker → contradiction + chips off (even via the derivation path)', () => {
    const s = canonicalStateFromFreshness(derivation(), {
      readiness: { status: 'ready', blockers: [{ blocker_type: 'missing_value' }] },
    });
    expect(s.contradictions).toContain('status_ready_with_actionable_blockers');
    expect(s.usableForChips).toBe(false);
    expect(s.requiresRerun).toBe(true);
  });

  it('HARDENING #2: ready + advisory constraint_dropped only → NO contradiction, chips stay usable', () => {
    const s = canonicalStateFromFreshness(derivation(), {
      readiness: { status: 'ready', blockers: [{ blocker_type: 'constraint_dropped' }] },
    });
    expect(s.contradictions).toEqual([]);
    expect(s.usableForChips).toBe(true);
  });
});

describe('summariseGraphCounts', () => {
  it('null graph → null', () => {
    expect(summariseGraphCounts(null)).toBeNull();
    expect(summariseGraphCounts(undefined)).toBeNull();
  });

  it('counts nodes/edges and options/goals by kind', () => {
    const graph = {
      nodes: [{ kind: 'goal' }, { kind: 'option' }, { kind: 'option' }, { kind: 'factor' }],
      edges: [{}, {}, {}],
    };
    expect(summariseGraphCounts(graph)).toEqual({ nodes: 4, edges: 3, options: 2, goals: 1 });
  });
});

describe('buildV5ContextSummary — redaction + honest nullability', () => {
  it('emits only the redacted key allowlist; un-threaded fields are null (not 0/false)', () => {
    const cs = canonicalStateFromFreshness(derivation(), { readiness: { status: 'ready' } });
    const summary = buildV5ContextSummary({
      canonicalState: cs,
      graphCounts: { nodes: 3, edges: 2, options: 2, goals: 1 },
    });
    expect(summary.version).toBe(V5_CONTEXT_SUMMARY_VERSION);
    // Honest nullability — these populate only when threaded (M5/M6).
    expect(summary.recent_turn_count).toBeNull();
    expect(summary.recent_change_count).toBeNull();
    expect(summary.capabilities_present).toBeNull();
    // Top-level key allowlist.
    expect(Object.keys(summary).sort()).toEqual(
      [
        'analysis_state',
        'capabilities_present',
        'graph_counts',
        'recent_change_count',
        'recent_turn_count',
        'version',
      ].sort(),
    );
    // analysis_state key allowlist — counts/statuses/hashes/predicates only.
    expect(Object.keys(summary.analysis_state).sort()).toEqual(ANALYSIS_STATE_KEYS);
    expect(summary.analysis_state.freshness).toBe('fresh');
    expect(summary.analysis_state.usable_for_chips).toBe(true);
  });

  it('blocker objects do NOT leak (counts only, no message/label content)', () => {
    const cs = canonicalStateFromFreshness(derivation(), {
      readiness: {
        status: 'ready',
        blockers: [
          { blocker_type: 'missing_value', message: 'SECRET-MESSAGE', factor_label: 'SECRET-LABEL' },
          { blocker_type: 'constraint_dropped', message: 'ADVISORY-SECRET' },
        ],
      },
    });
    const summary = buildV5ContextSummary({ canonicalState: cs });
    const json = JSON.stringify(summary);
    expect(json).not.toContain('SECRET-MESSAGE');
    expect(json).not.toContain('SECRET-LABEL');
    expect(json).not.toContain('ADVISORY-SECRET');
    expect(summary.analysis_state.blocker_count).toBe(2);
    expect(summary.analysis_state.actionable_blocker_count).toBe(1); // missing_value only
  });

  it('graph_counts null when no graph', () => {
    const cs = canonicalStateFromFreshness(derivation(), {});
    const summary = buildV5ContextSummary({ canonicalState: cs });
    expect(summary.graph_counts).toBeNull();
  });
});
