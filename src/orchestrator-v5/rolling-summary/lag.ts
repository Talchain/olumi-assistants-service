/**
 * Context Architecture v2 — S4 rolling summary: the STALENESS INVARIANT
 * (design pack 01 §4 / 07 Attack 1). PURE.
 *
 *   INVARIANT: window_depth ≥ summary_lag_turns + 1, else the injector discloses.
 *
 * `summary_lag_turns` = the number of committed turns AFTER the summary's
 * watermark (updated_turn_created_at). Because the verbatim window always
 * covers the most-recent `window_depth` turns, everything after the watermark
 * is verbatim-visible for any lag ≤ window_depth − 1. A summariser outage can
 * only ever DEGRADE freshness (older summary), never open a MEMORY HOLE — the
 * window overlaps the gap. When lag exceeds that bound (a real outage, not a
 * race — turns arrive every ~20s+, summarisation completes in ~2–4s off-path),
 * the injector still shows the stale summary but DISCLOSES it and emits
 * v5.summary.lag.
 *
 * This module ships in the S4 maintain (shadow) half so the boundary is proven
 * and unit-pinned NOW; the injector that consumes `isSummaryStale` at assembly
 * time lands with the S4 injection follow-up.
 */

import type { RollingSummary } from './summary-types.js';

/** The minimal turn shape the lag computation needs — a structural slice of
 *  SessionTurnWithContent (created_at + the stable turn_id tiebreak). */
export interface LagTurn {
  readonly turn_id: string;
  readonly created_at: string;
}

/**
 * Turns AFTER the watermark, counted from the assembly window (newest-first,
 * as `readRecent` returns). CONSERVATIVE at timestamp ties: a turn sharing the
 * watermark's `created_at` but not being the watermark turn itself is counted
 * as unabsorbed — over-disclosing is safe; under-counting would risk a hole.
 *
 * A null summary means nothing has been absorbed → every window turn is lag
 * (bounded by the window size the caller passed).
 */
export function computeSummaryLag(
  summary: RollingSummary | null,
  windowTurnsNewestFirst: readonly LagTurn[],
): number {
  if (summary === null) return windowTurnsNewestFirst.length;

  const watermark = Date.parse(summary.updated_turn_created_at);
  if (!Number.isFinite(watermark)) {
    // A summary with an unparseable watermark cannot be trusted to cover
    // anything — treat the whole window as unabsorbed (safe/degraded).
    return windowTurnsNewestFirst.length;
  }

  let lag = 0;
  for (const turn of windowTurnsNewestFirst) {
    const ts = Date.parse(turn.created_at);
    if (!Number.isFinite(ts)) {
      lag += 1; // cannot place it relative to the watermark → assume newer
      continue;
    }
    if (ts > watermark) {
      lag += 1;
    } else if (ts === watermark && turn.turn_id !== summary.updated_turn_id) {
      // Same-ms sibling of the watermark turn — count as unabsorbed (safe).
      lag += 1;
    }
    // ts < watermark, or the watermark turn itself → absorbed, not counted.
  }
  return lag;
}

/**
 * The disclosure decision. `windowDepth` is the assembler's current verbatim
 * window cap (CONTEXT_PACK_RECENT_TURNS_CAP — 5 today, 8 after the S5 flip).
 * Stale ⇔ the invariant window_depth ≥ lag + 1 is violated ⇔ lag ≥ window_depth
 * ⇔ lag > window_depth − 1. The injector discloses and emits v5.summary.lag.
 */
export function isSummaryStale(lag: number, windowDepth: number): boolean {
  return lag >= windowDepth;
}
