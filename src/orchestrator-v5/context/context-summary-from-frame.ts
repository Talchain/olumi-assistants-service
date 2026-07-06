/**
 * T4 Slice 2 — `V5ContextSummary` projected FROM the canonical context frame.
 *
 * The first live frame CONSUMER. When the turn-executor threads a
 * `CanonicalContextFrame`, the route builds the flag-gated context-summary
 * diagnostic from the FRAME ALONE via this function — it does not re-assemble
 * the summary from parts (`summariseGraphCounts(ctx.graph)`,
 * `ctx.canonicalState`, …). That is the slice-2 no-re-derivation contract made
 * structural: the only frame-shaped input is the frame itself, so a caller
 * cannot feed this path a second, divergent derivation of anything the frame
 * already carries.
 *
 * WRAP, NEVER RE-DERIVE (same rule as `frame/build-frame.ts`):
 *   - `analysis_state`     ← `frame.diagnostics.analysisStateSummary` (the
 *     redacted projection the builder made from the canonical state it
 *     wrapped), surfaced verbatim. If a (future, hand-built) frame omits the
 *     optional field, this function returns `null` — no summary is fabricated
 *     here; the ROUTE then falls back to the legacy parts-assembled builder,
 *     so the diagnostic never silently disappears while the state to build it
 *     is in hand.
 *   - `graph_counts`       ← `frame.model.counts` (integer counts only).
 *   - `recent_turn_count`  ← `frame.conversation.priorTurnCount`. This (and
 *     `recent_change_count`) closes the documented M5 observability gap: the
 *     route seam previously emitted `null` ("not threaded"), because it could
 *     not see the assembled context. The frame carries it now — and
 *     `BuildFrameInput.priorTurnCount` is REQUIRED, so a frame cannot smuggle
 *     a defaulted 0 through a surface whose contract is "never a misleading
 *     zero".
 *   - `recent_change_count`← `frame.conversation.recentChangeCount` (single
 *     source: the projected changes array's length).
 *   - `canonical_state_source` ← `frame.analysis.source` (provenance verbatim).
 *   - `capabilities_present` stays `null` — capabilities are NOT threaded into
 *     the frame yet (M6); `null` remains the honest "not observed" value.
 *
 * The optional `coaching_state_pack` sub-block (double-gated staging
 * diagnostic) still projects from the full `CanonicalAnalysisState` — the
 * frame deliberately carries only the REDACTED analysis summary, not the full
 * verdict object. Passing `coachingPackSource` IS the opt-in (one parameter,
 * no second boolean to disagree with); the caller passes the SAME canonical
 * state the frame wrapped (`ctx.canonicalState`), gated on
 * `coachingStatePackEnabled`. Threading the pack through the frame itself is
 * a later increment.
 *
 * Diagnostic-only — never product logic. Same contract, same static guards
 * (`tests/contract/context-summary-diagnostic-only.guard.test.ts`) as the
 * part-assembled builder in `./build-context-summary.js`.
 */

import type { CanonicalAnalysisState } from './canonical-analysis-state.js';
import { summariseCoachingStatePack } from './canonical-analysis-state.js';
import {
  V5_CONTEXT_SUMMARY_VERSION,
  type V5ContextSummary,
} from './build-context-summary.js';
import type { CanonicalContextFrame } from './frame/index.js';

/**
 * Build the redacted context summary from the canonical frame alone. Pure.
 * Every base field reads the frame; nothing is re-derived at this seam.
 *
 * @param coachingPackSource — supplying it IS the opt-in for the redacted
 * `coaching_state_pack` sub-block; it must be the same canonical state the
 * frame wrapped. Omit it (the route omits it unless
 * `coachingStatePackEnabled`) and the sub-block is omitted.
 */
export function contextSummaryFromFrame(
  frame: CanonicalContextFrame,
  coachingPackSource?: CanonicalAnalysisState,
): V5ContextSummary | null {
  const analysisState = frame.diagnostics.analysisStateSummary;
  if (analysisState === undefined) return null;
  return {
    version: V5_CONTEXT_SUMMARY_VERSION,
    analysis_state: analysisState,
    // Constant label — the frame's hashes are single-sourced from the
    // freshness authority, which is the analysis-affecting family.
    graph_hash_kind: 'analysis_affecting',
    graph_counts: frame.model.counts ?? null,
    recent_turn_count: frame.conversation.priorTurnCount,
    recent_change_count: frame.conversation.recentChangeCount,
    // Capabilities are not threaded into the frame yet (M6) — honest null.
    capabilities_present: null,
    canonical_state_source: frame.analysis.source,
    ...(coachingPackSource
      ? { coaching_state_pack: summariseCoachingStatePack(coachingPackSource) }
      : {}),
    // Track 2 — pending observability, projected from the frame alone (the
    // pending block was tallied ONCE at the ORIENT derivation site;
    // re-mapping frame camelCase → wire snake_case is a pure rename, not a
    // re-derivation). `pending_confirmation` mirrors the gated seam value
    // (`frame.conversation.pendingConfirmation`); the counts / `threaded`
    // come from `frame.pending`. Omitted when the frame carries no pending
    // block (honest absence — a hand-built frame or a future non-executor
    // frame source). `kinds` flows through structurally (same
    // `Partial<Record<PendingActionKind, number>>` shape), so this seam does
    // not import the session leaf (source-scan allowlist stays intact).
    ...(frame.pending
      ? {
          pending: {
            pending_confirmation: frame.conversation.pendingConfirmation,
            live_count: frame.pending.liveCount,
            expired_count: frame.pending.expiredCount,
            kinds: frame.pending.kinds,
            confirmation_expecting_live_count:
              frame.pending.confirmationExpectingLiveCount,
            threaded: frame.pending.threaded,
            ...(frame.pending.lifecycle
              ? {
                  lifecycle: {
                    prior_count: frame.pending.lifecycle.priorCount,
                    consumed_count: frame.pending.lifecycle.consumedCount,
                    superseded_count: frame.pending.lifecycle.supersededCount,
                    expired_wall_count: frame.pending.lifecycle.expiredWallCount,
                    expired_turns_count: frame.pending.lifecycle.expiredTurnsCount,
                    hash_invalidated_count:
                      frame.pending.lifecycle.hashInvalidatedCount,
                    cap_dropped_count: frame.pending.lifecycle.capDroppedCount,
                    survived_count: frame.pending.lifecycle.survivedCount,
                  },
                }
              : {}),
          },
        }
      : {}),
    // Track 2 — rerun / what-changed readiness (frame.diagnostics.rerun →
    // snake_case wire). Omitted when the frame carries no rerun diagnostics.
    ...(frame.diagnostics.rerun
      ? {
          rerun: {
            prior_successful_run_count:
              frame.diagnostics.rerun.priorSuccessfulRunCount,
            comparison_candidates_ready:
              frame.diagnostics.rerun.comparisonCandidatesReady,
          },
        }
      : {}),
    // Mission 1 — chip IDS the composed response carried (pure pass-through
    // of the frame's already-extracted id list; ids are contract
    // identifiers, no user content). Omitted when the frame carries none.
    ...(frame.diagnostics.chipsEmitted !== undefined
      ? { chips_emitted: frame.diagnostics.chipsEmitted }
      : {}),
  };
}
