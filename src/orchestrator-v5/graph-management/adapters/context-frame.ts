/**
 * Graph Management — CanonicalContextFrame → MutationFrame adapter.
 *
 * The referee consumes a `MutationFrame` (already-resolved authorities —
 * hash + freshness + readability; anti-rederivation pin, Paul #1). The live
 * V5 turn path resolves those authorities into the V6 `CanonicalContextFrame`
 * (src/orchestrator-v5/context/frame). This adapter is the ONE sanctioned
 * projection between the two — a pure, total function so the wiring seams
 * (turn-executor finalise seam; future M2 producer) never hand-roll the
 * mapping.
 *
 * Import direction (enforced by isolation-guards.test.ts): graph-management
 * may import the context/frame TYPES; the frame module never imports
 * graph-management. Type-only import — no runtime coupling.
 *
 * Fail-closed rules:
 *  - null/undefined frame → null (referee's frame gate resolves
 *    FRAME_UNAVAILABLE → held);
 *  - absent/empty `model.graphHash` → graphReadable=false (referee resolves
 *    CURRENT_GRAPH_UNREADABLE → held);
 *  - any freshness verdict outside the known vocabulary → 'unknown'
 *    (frame gate fails closed to stale — never would_apply).
 */
import type { CanonicalContextFrame } from '../../context/frame/types.js';
import type { FrameFreshness, MutationFrame } from '../types.js';

/** The freshness vocabulary the MutationFrame carries (mirrors deriveAnalysisFreshness). */
const KNOWN_FRESHNESS: ReadonlySet<string> = new Set<FrameFreshness>([
  'fresh',
  'stale',
  'unknown',
  'none',
]);

/**
 * Narrow an arbitrary freshness verdict string to the MutationFrame
 * vocabulary. Unknown values → 'unknown' (fail-closed: the frame gate treats
 * anything other than 'fresh'/'none' as stale).
 */
export function narrowFrameFreshness(verdict: unknown): FrameFreshness {
  return typeof verdict === 'string' && KNOWN_FRESHNESS.has(verdict)
    ? (verdict as FrameFreshness)
    : 'unknown';
}

/**
 * Project a CanonicalContextFrame into the referee's MutationFrame.
 * Pure and total; never throws. Returns null when no frame exists so the
 * referee's own FRAME_UNAVAILABLE path (held) handles absence uniformly.
 */
export function contextFrameToMutationFrame(
  frame: CanonicalContextFrame | null | undefined,
): MutationFrame | null {
  if (frame === null || frame === undefined) return null;
  const rawHash = frame.model?.graphHash;
  const currentGraphHash =
    typeof rawHash === 'string' && rawHash.length > 0 ? rawHash : null;
  return {
    currentGraphHash,
    graphReadable: currentGraphHash !== null,
    freshness: narrowFrameFreshness(frame.freshness?.verdict),
    // Diagnostic passthrough only (does not gate in the referee).
    canonicalReady: frame.analysis?.status === 'ready',
  };
}
