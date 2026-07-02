/**
 * T4 Slice 2 — `V5ContextSummary` projected FROM the canonical context frame.
 *
 * The first live frame CONSUMER. When the turn-executor threads a
 * `CanonicalContextFrame`, the route builds the flag-gated context-summary
 * diagnostic from the FRAME ALONE via this function — it does not re-assemble
 * the summary from parts (`summariseGraphCounts(ctx.graph)`,
 * `ctx.canonicalState`, …). That is the slice-2 no-re-derivation contract made
 * structural: the only non-optional input is the frame, so a caller cannot
 * feed this path a second, divergent derivation of anything the frame already
 * carries.
 *
 * WRAP, NEVER RE-DERIVE (same rule as `frame/build-frame.ts`):
 *   - `analysis_state`     ← `frame.diagnostics.analysisStateSummary` (the
 *     redacted projection the builder made from the canonical state it
 *     wrapped) — with a pure `summariseCanonicalAnalysisState`-shape fallback
 *     never needed in practice (the builder always sets it); we surface the
 *     builder's copy verbatim.
 *   - `graph_counts`       ← `frame.model.counts` (integer counts only).
 *   - `recent_turn_count`  ← `frame.conversation.priorTurnCount`. This (and
 *     `recent_change_count`) closes the documented M5 observability gap: the
 *     route seam previously emitted `null` ("not threaded"), because it could
 *     not see the assembled context. The frame carries it now.
 *   - `recent_change_count`← `frame.conversation.recentChangeCount` (single
 *     source: the projected changes array's length).
 *   - `canonical_state_source` ← `frame.analysis.source` (provenance verbatim).
 *   - `capabilities_present` stays `null` — capabilities are NOT threaded into
 *     the frame yet (M6); emitting `null` remains the honest "not observed"
 *     value, exactly as before.
 *
 * The optional `coaching_state_pack` sub-block (double-gated staging
 * diagnostic) still projects from the full `CanonicalAnalysisState` — the
 * frame deliberately carries only the REDACTED analysis summary, not the full
 * verdict object. The caller passes the SAME canonical state the frame
 * wrapped (`ctx.canonicalState`); `summariseCoachingStatePack` is a pure
 * redacted projection, not a derivation. Threading the pack through the frame
 * itself is a later increment.
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

export interface ContextSummaryFromFrameOptions {
  /**
   * Opt-in for the redacted `coaching_state_pack` sub-block (the route gates
   * on `coachingStatePackEnabled` AND the enclosing `contextSummaryEnabled`).
   * When true, `coachingPackSource` must be the SAME canonical state the frame
   * wrapped; when falsy or the source is absent, the sub-block is OMITTED.
   */
  readonly includeCoachingState?: boolean;
  /**
   * The full canonical state the frame was built from — required only for the
   * coaching pack projection (the frame carries the redacted analysis summary,
   * not the full verdict). Never used for any other field.
   */
  readonly coachingPackSource?: CanonicalAnalysisState;
}

/**
 * Build the redacted context summary from the canonical frame alone. Pure.
 * Every base field reads the frame; nothing is re-derived at this seam.
 */
export function contextSummaryFromFrame(
  frame: CanonicalContextFrame,
  options: ContextSummaryFromFrameOptions = {},
): V5ContextSummary | null {
  // The builder always sets the redacted summary; a frame without it cannot
  // honestly populate `analysis_state`, so surface "no summary" to the caller
  // (which then simply does not attach the diagnostic) rather than fabricate.
  const analysisState = frame.diagnostics.analysisStateSummary;
  if (analysisState === undefined) return null;
  return {
    version: V5_CONTEXT_SUMMARY_VERSION,
    analysis_state: analysisState,
    graph_counts: frame.model.counts ?? null,
    recent_turn_count: frame.conversation.priorTurnCount,
    recent_change_count: frame.conversation.recentChangeCount,
    // Capabilities are not threaded into the frame yet (M6) — honest null.
    capabilities_present: null,
    canonical_state_source: frame.analysis.source,
    ...(options.includeCoachingState && options.coachingPackSource
      ? {
          coaching_state_pack: summariseCoachingStatePack(
            options.coachingPackSource,
          ),
        }
      : {}),
  };
}
