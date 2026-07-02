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
import { buildV5ContextSummary } from '../build-context-summary.js';
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
    expect(summary!.version).toBe('1.0.0');
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

  it('coaching_state_pack: omitted by default; opt-in projects from the same canonical state', () => {
    expect(contextSummaryFromFrame(frame)).not.toHaveProperty('coaching_state_pack');
    expect(
      contextSummaryFromFrame(frame, { includeCoachingState: true }),
    ).not.toHaveProperty('coaching_state_pack'); // no source supplied → still omitted
    const withPack = contextSummaryFromFrame(frame, {
      includeCoachingState: true,
      coachingPackSource: canonicalState,
    })!;
    expect(withPack.coaching_state_pack).toEqual(summariseCoachingStatePack(canonicalState));
  });

  it('null graph counts in the frame → honest null graph_counts', () => {
    const noCounts = buildFrame({
      freshness,
      canonicalState,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame([]),
    });
    expect(contextSummaryFromFrame(noCounts)!.graph_counts).toBeNull();
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
