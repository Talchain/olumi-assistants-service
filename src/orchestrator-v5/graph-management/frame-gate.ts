/**
 * Track 3 — R2 stale gate, FRAME-CONSUMING.
 *
 * Deliberate divergence from PR #300's `base-hash-gate.ts`: that spike recomputed
 * the current graph's hash via `computeAnalysisAffectingGraphHash`. Track 3 (per
 * the T4.0 contract R2 + the anti-rederivation pin + Paul #1) reads the
 * already-resolved hash from the `MutationFrame` and NEVER re-derives it — hence
 * this module imports no hash-derivation function.
 *
 * Fail-closed ladder:
 *  - no frame                               → FRAME_UNAVAILABLE (held)
 *  - frame can't read/hash the graph        → CURRENT_GRAPH_UNREADABLE (held)
 *  - freshness unknown / unconfirmed        → stale (can't confirm currency;
 *                                             global rule "unknown authority → hold",
 *                                             slice4 packet Q4)
 *  - base_graph_hash ≠ frame.currentGraphHash → stale (BASE_HASH_DIVERGED)
 *  - otherwise                              → proceed (hash matches)
 */
import type { MutationFrame } from './types.js';

export type FrameGateOutcome =
  | { readonly kind: 'frame_unavailable' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'stale'; readonly reason: 'freshness_unknown' | 'base_hash_diverged' }
  | { readonly kind: 'proceed' };

export interface FrameGateResult {
  readonly outcome: FrameGateOutcome;
  /** True iff base_graph_hash equals the frame's current hash (false when no frame/unreadable). */
  readonly baseHashMatch: boolean;
}

export function evaluateFrameGate(
  baseGraphHash: string,
  frame: MutationFrame | null,
): FrameGateResult {
  if (frame === null || frame === undefined) {
    return { outcome: { kind: 'frame_unavailable' }, baseHashMatch: false };
  }
  if (!frame.graphReadable || frame.currentGraphHash === null) {
    return { outcome: { kind: 'unreadable' }, baseHashMatch: false };
  }
  const baseHashMatch = baseGraphHash === frame.currentGraphHash;
  if (frame.freshness === 'unknown' || frame.freshness === 'unconfirmed') {
    return { outcome: { kind: 'stale', reason: 'freshness_unknown' }, baseHashMatch };
  }
  if (!baseHashMatch) {
    return { outcome: { kind: 'stale', reason: 'base_hash_diverged' }, baseHashMatch };
  }
  return { outcome: { kind: 'proceed' }, baseHashMatch };
}
