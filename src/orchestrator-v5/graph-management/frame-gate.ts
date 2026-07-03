/**
 * Track 3 — R2 stale gate, FRAME-CONSUMING.
 *
 * Deliberate divergence from PR #300's `base-hash-gate.ts`: that spike recomputed
 * the current graph's hash via `computeAnalysisAffectingGraphHash`. Track 3 (per
 * the T4.0 contract R2 + the anti-rederivation pin + Paul #1) reads the
 * already-resolved hash from the `MutationFrame` and NEVER re-derives it — hence
 * this module imports no hash-derivation function.
 *
 * Fail-closed ladder (conservative, Paul: hold where ambiguous):
 *  - no frame                                 → FRAME_UNAVAILABLE (held)
 *  - frame can't read/hash the graph          → CURRENT_GRAPH_UNREADABLE (held)
 *  - base_graph_hash ≠ frame.currentGraphHash → stale (BASE_HASH_DIVERGED)
 *  - freshness is NOT trustworthy-current     → stale (freshness_not_fresh)
 *  - otherwise                                → proceed
 *
 * Freshness trust: ONLY `'fresh'` (analysis current) and `'none'` (pre-analysis —
 * no analysis to be stale against; a hash-matching edit is legitimate) are
 * apply-trustworthy. Every other verdict — `'stale'` (analysis diverged) and
 * `'unknown'` (authority unresolved) — fails CLOSED to `stale`. This closes the
 * fail-open where a known-not-fresh state fell through to `would_apply`, and it
 * covers any unexpected value uniformly (no reliance on a specific `'unknown'`
 * literal — `deriveAnalysisFreshness` emits `'fresh'|'stale'|'unknown'|'none'`).
 */
import type { FrameFreshness, MutationFrame } from './types.js';

/** Freshness values trustworthy enough to permit a would_apply-eligible outcome. */
const TRUSTWORTHY_FRESHNESS: ReadonlySet<FrameFreshness> = new Set<FrameFreshness>(['fresh', 'none']);

export type FrameGateOutcome =
  | { readonly kind: 'frame_unavailable' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'stale'; readonly reason: 'freshness_not_fresh' | 'base_hash_diverged' }
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
  if (!baseHashMatch) {
    return { outcome: { kind: 'stale', reason: 'base_hash_diverged' }, baseHashMatch };
  }
  if (!TRUSTWORTHY_FRESHNESS.has(frame.freshness)) {
    // 'stale' | 'unknown' (or any unexpected value) → fail closed.
    return { outcome: { kind: 'stale', reason: 'freshness_not_fresh' }, baseHashMatch };
  }
  return { outcome: { kind: 'proceed' }, baseHashMatch };
}
