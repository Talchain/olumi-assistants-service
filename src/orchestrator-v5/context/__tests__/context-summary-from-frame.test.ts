/**
 * T4 Slice 2 — `contextSummaryFromFrame` projection + parity tests.
 *
 * The first live frame consumer: the route's flag-gated context-summary
 * diagnostic reads the FRAME ALONE. These tests prove:
 *   1. every base field is projected from the frame (no re-derivation),
 *   2. PARITY: for the same authority outputs, the frame-projected summary
 *      matches the legacy part-assembled `buildV5ContextSummary` on every
 *      previously-populated field — the migration changes no observed value,
 *   3. the two previously-null "not threaded" fields (M5 gap) are now real,
 *   4. the coaching sub-block stays opt-in and projects from the same
 *      canonical state the frame wrapped.
 */
import { describe, expect, it } from 'vitest';

import { buildFrame } from '../frame/build-frame.js';
import { projectRecentChangesToFrame } from '../frame/project-recent-changes.js';
import { contextSummaryFromFrame } from '../context-summary-from-frame.js';
import {
  buildV5ContextSummary,
  type V5ContextSummary,
  type ContextSummaryPending,
  type ContextSummaryPendingLifecycle,
} from '../build-context-summary.js';
import { deriveAnalysisFreshness } from '../freshness.js';
import {
  canonicalStateFromFreshness,
  summariseCoachingStatePack,
} from '../canonical-analysis-state.js';
import type { RecentMutation } from '../recent-changes.js';

// Real authority outputs (single derivation), mirroring build-frame.test.ts.
const freshness = deriveAnalysisFreshness([], 'graph-hash-current');
const canonicalState = canonicalStateFromFreshness(freshness);
const CHANGES: readonly RecentMutation[] = [
  { action: 'factor_value_updated', summary: 'Updated Customer churn.', target_label: 'Customer churn' },
];
const COUNTS = { nodes: 4, edges: 2, options: 2, goals: 1 } as const;

const frame = buildFrame({
  freshness,
  canonicalState,
  canonicalStateSource: 'turn_executor',
  recentChanges: projectRecentChangesToFrame(CHANGES),
  graphCounts: COUNTS,
  priorTurnCount: 5,
});

describe('contextSummaryFromFrame (T4 Slice 2)', () => {
  it('projects every base field from the frame alone', () => {
    const summary = contextSummaryFromFrame(frame);
    expect(summary).not.toBeNull();
    expect(summary!.version).toBe('1.1.0');
    expect(summary!.analysis_state).toEqual(frame.diagnostics.analysisStateSummary);
    expect(summary!.graph_counts).toEqual(COUNTS);
    expect(summary!.canonical_state_source).toBe('turn_executor');
  });

  it('closes the M5 gap: recent_turn_count / recent_change_count are now REAL, from the frame', () => {
    const summary = contextSummaryFromFrame(frame)!;
    expect(summary.recent_turn_count).toBe(5);
    expect(summary.recent_change_count).toBe(1);
  });

  it('capabilities_present stays an honest null (not threaded into the frame yet — M6)', () => {
    expect(contextSummaryFromFrame(frame)!.capabilities_present).toBeNull();
  });

  it('PARITY: matches the legacy part-assembled summary on every previously-populated field', () => {
    const legacy = buildV5ContextSummary({
      canonicalState,
      graphCounts: COUNTS,
      canonicalStateSource: 'turn_executor',
      includeCoachingState: false,
    });
    const fromFrame = contextSummaryFromFrame(frame)!;
    // Identical on everything the legacy path populated…
    expect(fromFrame.version).toBe(legacy.version);
    expect(fromFrame.analysis_state).toEqual(legacy.analysis_state);
    expect(fromFrame.graph_counts).toEqual(legacy.graph_counts);
    expect(fromFrame.canonical_state_source).toBe(legacy.canonical_state_source);
    expect(fromFrame.capabilities_present).toBe(legacy.capabilities_present);
    // …and strictly MORE observed on the two previously-null M5 fields.
    expect(legacy.recent_turn_count).toBeNull();
    expect(legacy.recent_change_count).toBeNull();
    expect(fromFrame.recent_turn_count).toBe(5);
    expect(fromFrame.recent_change_count).toBe(1);
  });

  it('coaching_state_pack: omitted by default; supplying the source IS the opt-in (single parameter — the include-without-source divergence is unrepresentable)', () => {
    expect(contextSummaryFromFrame(frame)).not.toHaveProperty('coaching_state_pack');
    expect(contextSummaryFromFrame(frame, undefined)).not.toHaveProperty('coaching_state_pack');
    const withPack = contextSummaryFromFrame(frame, canonicalState)!;
    expect(withPack.coaching_state_pack).toEqual(summariseCoachingStatePack(canonicalState));
  });

  it('null graph counts in the frame → honest null graph_counts', () => {
    const noCounts = buildFrame({
      freshness,
      canonicalState,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame([]),
      priorTurnCount: 0,
    });
    expect(contextSummaryFromFrame(noCounts)!.graph_counts).toBeNull();
  });

  it('Track 2 — pending block: omitted when the frame carries none (honest absence)', () => {
    // The module-level `frame` was built without a pending input.
    expect(contextSummaryFromFrame(frame)).not.toHaveProperty('pending');
  });

  it('Track 2 — pending block: projected from the frame (camelCase → wire snake_case), pending_confirmation mirrors the gated seam', () => {
    const withPending = buildFrame({
      freshness,
      canonicalState,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame([]),
      graphCounts: COUNTS,
      priorTurnCount: 2,
      pendingConfirmation: true,
      pending: {
        liveCount: 2,
        expiredCount: 1,
        kinds: { apply_proposed_change: 1, run_analysis: 1 },
        confirmationExpectingLiveCount: 1,
        threaded: true,
        lifecycle: {
          priorCount: 3,
          consumedCount: 1,
          supersededCount: 0,
          expiredWallCount: 1,
          expiredTurnsCount: 0,
          hashInvalidatedCount: 0,
          capDroppedCount: 0,
          survivedCount: 1,
        },
      },
    });
    const summary = contextSummaryFromFrame(withPending)!;
    expect(summary.pending).toEqual({
      pending_confirmation: true,
      live_count: 2,
      expired_count: 1,
      kinds: { apply_proposed_change: 1, run_analysis: 1 },
      confirmation_expecting_live_count: 1,
      threaded: true,
      lifecycle: {
        prior_count: 3,
        consumed_count: 1,
        superseded_count: 0,
        expired_wall_count: 1,
        expired_turns_count: 0,
        hash_invalidated_count: 0,
        cap_dropped_count: 0,
        survived_count: 1,
      },
    });
  });

  it('Track 2 — rerun readiness: omitted when the frame carries none; projected (camelCase → snake_case) when present', () => {
    expect(contextSummaryFromFrame(frame)).not.toHaveProperty('rerun');
    const withRerun = buildFrame({
      freshness,
      canonicalState,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame([]),
      priorTurnCount: 0,
      rerunReadiness: { priorSuccessfulRunCount: 3, comparisonCandidatesReady: false },
    });
    expect(contextSummaryFromFrame(withRerun)!.rerun).toEqual({
      prior_successful_run_count: 3,
      comparison_candidates_ready: false,
    });
  });

  it('ANTI-DRIFT (pending): the hand-written camelCase→snake_case re-map projects EVERY ContextSummaryPending key', () => {
    // The pending projection re-maps fields one at a time (frame camelCase →
    // wire snake_case). A field added to ContextSummaryPending / …Lifecycle but
    // forgotten in the projection would silently drop from the wire. This
    // compile-time pin makes any new wire key a tsc error here, and the runtime
    // key-set check fails if the projection omits one for a fully-populated
    // frame — mirroring the top-level PINNED discipline.
    const PENDING_PINNED: Record<keyof Required<ContextSummaryPending>, true> = {
      pending_confirmation: true,
      live_count: true,
      expired_count: true,
      kinds: true,
      confirmation_expecting_live_count: true,
      threaded: true,
      lifecycle: true,
    };
    const LIFECYCLE_PINNED: Record<keyof Required<ContextSummaryPendingLifecycle>, true> = {
      prior_count: true,
      consumed_count: true,
      superseded_count: true,
      expired_wall_count: true,
      expired_turns_count: true,
      hash_invalidated_count: true,
      cap_dropped_count: true,
      survived_count: true,
    };
    const fullyPopulated = buildFrame({
      freshness,
      canonicalState,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame([]),
      priorTurnCount: 0,
      pendingConfirmation: true,
      pending: {
        liveCount: 1,
        expiredCount: 0,
        kinds: { apply_proposed_change: 1 },
        confirmationExpectingLiveCount: 1,
        threaded: true,
        lifecycle: {
          priorCount: 1, consumedCount: 0, supersededCount: 0, expiredWallCount: 0,
          expiredTurnsCount: 0, hashInvalidatedCount: 0, capDroppedCount: 0, survivedCount: 1,
        },
      },
    });
    const pending = contextSummaryFromFrame(fullyPopulated)!.pending!;
    expect(Object.keys(pending).sort()).toEqual(Object.keys(PENDING_PINNED).sort());
    expect(Object.keys(pending.lifecycle!).sort()).toEqual(Object.keys(LIFECYCLE_PINNED).sort());
  });

  it('Track 2 — pending_confirmation follows the GATED seam, not the raw count (kill-switch off ⇒ false despite a live confirmation-expecting pending)', () => {
    const flagOff = buildFrame({
      freshness,
      canonicalState,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame([]),
      priorTurnCount: 1,
      // Gated seam false (kill-switch off) …
      pendingConfirmation: false,
      pending: {
        liveCount: 1,
        expiredCount: 0,
        kinds: { apply_proposed_change: 1 },
        // … while the ungated derived count still records the live proposal.
        confirmationExpectingLiveCount: 1,
        threaded: false,
      },
    });
    const summary = contextSummaryFromFrame(flagOff)!;
    expect(summary.pending!.pending_confirmation).toBe(false);
    expect(summary.pending!.confirmation_expecting_live_count).toBe(1);
    expect(summary.pending!.threaded).toBe(false);
  });

  it('ANTI-DRIFT: the frame-built summary carries every legacy key (no silent drop), plus exactly the frame-only `pending` and `rerun` blocks', () => {
    // Both shapes maximal: coaching pack ON and provenance supplied on both
    // sides, and the frame ALSO carries pending + rerun blocks (frame-only —
    // the legacy parts path has no frame to source them from). The frame path
    // must be a strict SUPERSET of the legacy key set, differing by exactly the
    // two documented frame-only keys `pending` and `rerun`. Any future field
    // added to the legacy literal but not the frame projection makes `fromFrame`
    // MISSING a legacy key → the superset check fails; any frame-only field
    // beyond `pending`/`rerun` → the difference check fails. Neither omission
    // can ship silently.
    const maximalFrame = buildFrame({
      freshness,
      canonicalState,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame(CHANGES),
      graphCounts: COUNTS,
      priorTurnCount: 5,
      pendingConfirmation: true,
      pending: {
        liveCount: 1,
        expiredCount: 0,
        kinds: { apply_proposed_change: 1 },
        confirmationExpectingLiveCount: 1,
        threaded: true,
      },
      rerunReadiness: { priorSuccessfulRunCount: 2, comparisonCandidatesReady: true },
    });
    const fromFrame = contextSummaryFromFrame(maximalFrame, canonicalState)!;
    const legacy = buildV5ContextSummary({
      canonicalState,
      graphCounts: COUNTS,
      canonicalStateSource: 'turn_executor',
      includeCoachingState: true,
    });
    const frameKeys = new Set(Object.keys(fromFrame));
    for (const k of Object.keys(legacy)) {
      expect(frameKeys.has(k), `frame path silently dropped legacy key '${k}'`).toBe(true);
    }
    const frameOnly = Object.keys(fromFrame).filter((k) => !(k in legacy)).sort();
    expect(frameOnly).toEqual(['pending', 'rerun']);
  });

  it('ANTI-DRIFT (compile-time): the wire type has no keys beyond the pinned set', () => {
    // Exhaustive key pin: adding ANY key to V5ContextSummary makes this
    // Record literal a tsc error in this file, forcing the author to extend
    // the frame projection (or consciously exempt the key) rather than let
    // the frame path silently omit it.
    const PINNED: Record<keyof Required<V5ContextSummary>, true> = {
      version: true,
      analysis_state: true,
      graph_counts: true,
      recent_turn_count: true,
      recent_change_count: true,
      capabilities_present: true,
      canonical_state_source: true,
      coaching_state_pack: true,
      pending: true,
      rerun: true,
    };
    expect(Object.keys(PINNED).length).toBe(10);
  });

  it('is pure: same frame → deeply-equal summaries; frame not mutated', () => {
    const before = JSON.stringify(frame);
    expect(contextSummaryFromFrame(frame)).toEqual(contextSummaryFromFrame(frame));
    expect(JSON.stringify(frame)).toBe(before);
  });

  it('source-scan guard: context-summary-from-frame.ts imports only pure projection modules (allowlist)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../context-summary-from-frame.ts', import.meta.url)),
      'utf8',
    );
    const ALLOWED = new Set([
      './canonical-analysis-state.js', // summariseCoachingStatePack (pure redacted projection) + type
      './build-context-summary.js', // wire type + version constant only
      './frame/index.js', // the frame type
    ]);
    const specifiers = [...src.matchAll(/import[\s\S]*?'([^']+)'\s*;/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(ALLOWED.has(spec), `non-allowlisted import: ${spec}`).toBe(true);
    }
    // No derivation authority may be imported — the consumer READS the frame;
    // it never re-derives freshness / canonical state / graph counts / changes.
    const allNamedImports = (src.match(/import[\s\S]*?from\s*'[^']+';/g) ?? []).join('\n');
    for (const forbidden of [
      'deriveAnalysisFreshness',
      'selectCanonicalAnalysisState',
      'canonicalStateFromFreshness',
      'summariseGraphCounts',
      'projectRecentChanges',
      'buildV5ContextSummary',
      'buildFrame',
    ]) {
      expect(allNamedImports, `must not import ${forbidden}`).not.toContain(forbidden);
    }
    expect(src, 'no namespace import').not.toMatch(/import\s+\*\s+as\s/);
    expect(src, 'no dynamic import()').not.toMatch(/\bimport\s*\(/);
    expect(src, 'no require()').not.toMatch(/\brequire\s*\(/);
  });
});
