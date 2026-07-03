/**
 * `_context_summary` redaction proof — DISCRIMINATING fixtures (T4 accel, Payload 4).
 *
 * The existing suite proves projection/parity/anti-drift but never feeds the
 * pipeline REAL sensitive content. A redaction test that passes without a
 * live leak candidate proves nothing. Here, known sentinel strings are
 * planted in every prose-capable input field the frame consumes:
 *
 *   - `CanonicalAnalysisState.blockers[]` (unknown[] — carries user-facing
 *     messages and labels in production),
 *   - `CanonicalAnalysisState.model_adjustments[]` (same class),
 *   - `CanonicalAnalysisState.goal_node_id` (entity id),
 *   - recent-change `summary` / `target_label` (decision-language prose).
 *
 * The proof then has BOTH halves of the discriminating property:
 *   1. LIVENESS — the sentinels demonstrably travel INTO the pipeline
 *      (present in the state / the frame's internal `changes`), and the
 *      summary's counts prove the hostile objects were SEEN (counted);
 *   2. REDACTION — the wire-bound projections (`_context_summary` with the
 *      coaching pack ON — the maximal surface — and the frame's
 *      `analysisStateSummary` diagnostic) contain NO sentinel.
 *
 * If any projection ever passes blocker/adjustment objects or labels through
 * wholesale, this file goes RED naming the sentinel.
 *
 * Pass-through BY DESIGN (deliberately not sentinel-tested): graph hashes,
 * `computed_at`, `degraded_fact_status`, freshness/status enums — closed
 * enums, hashes and timestamps at source, not user prose.
 */
import { describe, expect, it } from 'vitest';

import { buildFrame } from '../frame/build-frame.js';
import { projectRecentChangesToFrame } from '../frame/project-recent-changes.js';
import { contextSummaryFromFrame } from '../context-summary-from-frame.js';
import { deriveAnalysisFreshness } from '../freshness.js';
import {
  canonicalStateFromFreshness,
  type CanonicalAnalysisState,
} from '../canonical-analysis-state.js';
import type { RecentMutation } from '../recent-changes.js';

// Unique, grep-safe sentinels — anything carrying one of these into a
// wire-bound projection is a leak.
const SENTINELS = {
  blockerMessage: 'XQSENTINEL_BLOCKER_MESSAGE_user_typed_this',
  blockerLabel: 'XQSENTINEL_BLOCKER_NODE_LABEL',
  rawStringBlocker: 'XQSENTINEL_RAW_STRING_BLOCKER',
  adjustmentNote: 'XQSENTINEL_ADJUSTMENT_NOTE',
  adjustmentLabel: 'XQSENTINEL_ADJUSTED_FACTOR_LABEL',
  goalNodeId: 'node_XQSENTINEL_GOAL_ID',
  changeSummary: 'XQSENTINEL_CHANGE_SUMMARY_prose',
  changeLabel: 'XQSENTINEL_CHANGE_TARGET_LABEL',
} as const;

const freshness = deriveAnalysisFreshness([], 'graph-hash-current');

/** A canonical state whose prose-capable fields ALL carry sentinels. */
const HOSTILE_STATE: CanonicalAnalysisState = {
  ...canonicalStateFromFreshness(freshness),
  blockers: [
    {
      type: 'missing_goal',
      message: SENTINELS.blockerMessage,
      node_label: SENTINELS.blockerLabel,
    },
    SENTINELS.rawStringBlocker,
  ],
  model_adjustments: [
    { note: SENTINELS.adjustmentNote, factor_label: SENTINELS.adjustmentLabel },
  ],
  goal_node_id: SENTINELS.goalNodeId,
};

const HOSTILE_CHANGES: readonly RecentMutation[] = [
  {
    action: 'factor_value_updated',
    summary: `Updated ${SENTINELS.changeSummary}.`,
    target_label: SENTINELS.changeLabel,
  },
];

const frame = buildFrame({
  freshness,
  canonicalState: HOSTILE_STATE,
  canonicalStateSource: 'turn_executor',
  recentChanges: projectRecentChangesToFrame(HOSTILE_CHANGES),
  graphCounts: { nodes: 4, edges: 2, options: 2, goals: 1 },
  priorTurnCount: 3,
});

const allSentinels = Object.values(SENTINELS);

describe('fixture liveness — the sentinels genuinely enter the pipeline', () => {
  it('every sentinel is present in the hostile canonical state / changes', () => {
    const stateJson = JSON.stringify(HOSTILE_STATE);
    for (const s of [
      SENTINELS.blockerMessage,
      SENTINELS.blockerLabel,
      SENTINELS.rawStringBlocker,
      SENTINELS.adjustmentNote,
      SENTINELS.adjustmentLabel,
      SENTINELS.goalNodeId,
    ]) {
      expect(stateJson, `fixture must carry ${s}`).toContain(s);
    }
    const changesJson = JSON.stringify(HOSTILE_CHANGES);
    expect(changesJson).toContain(SENTINELS.changeSummary);
    expect(changesJson).toContain(SENTINELS.changeLabel);
  });

  it('the frame SAW the hostile inputs (internal changes carry them; summary counts them)', () => {
    // The frame's internal `changes` legitimately carry decision-language
    // prose (the frame itself never reaches the wire) — proving the hostile
    // changes were not silently dropped before projection.
    expect(JSON.stringify(frame.changes)).toContain(SENTINELS.changeLabel);
    // The redacted summary COUNTED the hostile blockers — seen, not leaked.
    expect(frame.diagnostics.analysisStateSummary?.blocker_count).toBe(2);
  });

  it('scanner self-test: the detection mechanism finds a planted leak', () => {
    const deliberatelyLeaky = JSON.stringify({ leak: HOSTILE_STATE.blockers });
    expect(deliberatelyLeaky).toContain(SENTINELS.blockerMessage);
  });
});

describe('redaction — no sentinel reaches a wire-bound projection', () => {
  it('_context_summary (maximal surface: coaching pack ON) carries no sentinel', () => {
    const summary = contextSummaryFromFrame(frame, HOSTILE_STATE);
    expect(summary).not.toBeNull();
    const wire = JSON.stringify(summary);
    for (const s of allSentinels) {
      expect(wire, `LEAK: ${s} surfaced in _context_summary`).not.toContain(s);
    }
  });

  it("the frame's analysisStateSummary diagnostic carries no sentinel", () => {
    const diag = JSON.stringify(frame.diagnostics.analysisStateSummary);
    for (const s of allSentinels) {
      expect(diag, `LEAK: ${s} surfaced in analysisStateSummary`).not.toContain(s);
    }
  });

  it('recent changes reach the summary as a COUNT only', () => {
    const summary = contextSummaryFromFrame(frame, HOSTILE_STATE)!;
    expect(summary.recent_change_count).toBe(1);
    expect(JSON.stringify(summary)).not.toContain(SENTINELS.changeSummary);
    expect(JSON.stringify(summary)).not.toContain(SENTINELS.changeLabel);
  });

  it('not-threaded fields stay honest null even under hostile input', () => {
    const summary = contextSummaryFromFrame(frame, HOSTILE_STATE)!;
    expect(summary.capabilities_present).toBeNull();
  });

  it('Track 2 — the pending block is a pure counts/enum/boolean re-map (structural: no prose leaf types)', () => {
    // The pending block is derived from PendingActions (which DO carry prose:
    // public_label, public_message, inline_patch) at the ORIENT seam, reduced
    // to counts there — that redaction is proven discriminatingly in the
    // executor test. Here we prove the frame→summary PROJECTION adds no prose:
    // every leaf is a number, boolean, or a closed-enum kind KEY, never a
    // free-text string. A future field that smuggles a label/message through
    // fails this structural scan.
    const framedWithPending = buildFrame({
      freshness,
      canonicalState: HOSTILE_STATE,
      canonicalStateSource: 'turn_executor',
      recentChanges: projectRecentChangesToFrame(HOSTILE_CHANGES),
      graphCounts: { nodes: 4, edges: 2, options: 2, goals: 1 },
      priorTurnCount: 3,
      pendingConfirmation: true,
      pending: {
        liveCount: 1,
        expiredCount: 0,
        kinds: { apply_proposed_change: 1 },
        confirmationExpectingLiveCount: 1,
        threaded: true,
        lifecycle: {
          priorCount: 1,
          consumedCount: 0,
          supersededCount: 0,
          expiredWallCount: 0,
          expiredTurnsCount: 0,
          hashInvalidatedCount: 0,
          capDroppedCount: 0,
          survivedCount: 1,
        },
      },
    });
    const pending = contextSummaryFromFrame(framedWithPending, HOSTILE_STATE)!.pending!;
    const KNOWN_ENUM_KEYS = new Set([
      'set_factor_value',
      'run_analysis',
      'what_would_flip',
      'apply_proposed_change',
      'edit_graph_add_risk',
      'proposed_concept',
    ]);
    const scan = (v: unknown, path: string): void => {
      if (v === null) return;
      if (typeof v === 'number' || typeof v === 'boolean') return;
      if (typeof v === 'string') {
        throw new Error(`unexpected string leaf at ${path}: ${v}`);
      }
      if (Array.isArray(v)) {
        v.forEach((el, i) => scan(el, `${path}[${i}]`));
        return;
      }
      if (typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          // Under `kinds`, the KEYS are closed-enum kind literals (safe).
          if (path.endsWith('.kinds')) {
            expect(KNOWN_ENUM_KEYS.has(k), `unknown kind key: ${k}`).toBe(true);
          }
          scan(val, `${path}.${k}`);
        }
        return;
      }
      throw new Error(`unexpected leaf type at ${path}`);
    };
    expect(() => scan(pending, 'pending')).not.toThrow();
  });
});
