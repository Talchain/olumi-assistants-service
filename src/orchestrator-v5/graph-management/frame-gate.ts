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
 *
 * D-S RELAXATION (ROADMAP §D, Paul 2026-07-12 — ruled together with tunable
 * auto-apply): TUNABLE-class candidates additionally trust `'stale'`.
 * Rationale: once the first tunable edit auto-applies, the graph hash moves
 * and freshness flips to `'stale'` by construction — under the old rule every
 * CONSECUTIVE tunable tweak before a rerun would be blocked, a strictly
 * worse-feeling flow than the propose-confirm it replaces. A stale-freshness
 * tunable is safe to apply because (a) the base-hash rung ABOVE this one
 * still proves the candidate was generated against the CURRENT graph (CAS
 * semantics untouched — divergence still stales for every class), and (b)
 * staleness is a property of the ANALYSIS, which the applied receipt's rerun
 * chip resolves. `'unknown'` (authority unresolved) still fails closed for
 * every class, and STRUCTURAL/non-mutating candidates keep the strict set.
 */
import type { FrameFreshness, MutationClass, MutationFrame } from './types.js';

/** Freshness values trustworthy enough to permit a would_apply-eligible outcome. */
const TRUSTWORTHY_FRESHNESS: ReadonlySet<FrameFreshness> = new Set<FrameFreshness>(['fresh', 'none']);

/** D-S: the tunable-class trust set — additionally allows 'stale' (see header). */
const TUNABLE_TRUSTWORTHY_FRESHNESS: ReadonlySet<FrameFreshness> = new Set<FrameFreshness>([
  'fresh',
  'none',
  'stale',
]);

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
  /**
   * D-S relaxation hook: 'tunable' widens the freshness trust set to include
   * 'stale' (see header). Omitted/null/any other class keeps the strict set —
   * callers that don't know the class get the pre-D-S fail-closed behaviour.
   */
  mutationClass?: MutationClass | null,
): FrameGateResult {
  if (frame === null || frame === undefined) {
    return { outcome: { kind: 'frame_unavailable' }, baseHashMatch: false };
  }
  if (!frame.graphReadable || frame.currentGraphHash === null) {
    return { outcome: { kind: 'unreadable' }, baseHashMatch: false };
  }
  const baseHashMatch = baseGraphHash === frame.currentGraphHash;
  if (!baseHashMatch) {
    // Class-independent: CAS semantics are untouched by the D-S relaxation.
    return { outcome: { kind: 'stale', reason: 'base_hash_diverged' }, baseHashMatch };
  }
  const trusted =
    mutationClass === 'tunable' ? TUNABLE_TRUSTWORTHY_FRESHNESS : TRUSTWORTHY_FRESHNESS;
  if (!trusted.has(frame.freshness)) {
    // 'unknown' (or any unexpected value) → fail closed; 'stale' also fails
    // closed for every non-tunable class.
    return { outcome: { kind: 'stale', reason: 'freshness_not_fresh' }, baseHashMatch };
  }
  return { outcome: { kind: 'proceed' }, baseHashMatch };
}

/**
 * ⭐ WOULD A STALE ANALYSIS BLOCK AN APPLY FOR THIS CLASS? — ASKED OF THE GATE,
 * never restated from its trust set.
 *
 * ROADMAP 2.474 / A3. The structural-edit split disclosure has to tell the user
 * whether a re-run is needed between step 1 and step 2, and the answer is
 * entirely a property of rung 3 above: once part 1 is confirmed and applied the
 * graph hash moves, so a scenario that already carries a successful analysis
 * flips to `freshness: 'stale'` by construction, and whether the NEXT part is
 * then apply-eligible is exactly what this gate decides.
 *
 * The alternative — a comment in the disclosure module saying "structural
 * candidates trust only fresh/none" — is a mirror of the two sets above, green
 * the day it is written and silently over-warning (or silently under-warning)
 * the day either set moves. The staleness-editability ruling under
 * consideration (ROADMAP 2.474/A4) proposes moving exactly that set. Deriving
 * the answer means that ruling changes the copy automatically, and a lane that
 * changes the trust set cannot leave a stale sentence behind.
 *
 * The probe frame is a REACHABLE state, not an invented one: base hash matching
 * its own frame with `freshness: 'stale'` is the post-apply state the D-S
 * commit message names ("the first auto-applied edit flips freshness to
 * stale"). The hash value is irrelevant and cancels — it is compared only with
 * itself, which is what isolates rung 3 from rung 2.
 */
export function staleAnalysisBlocksApply(mutationClass: MutationClass | null): boolean {
  const SAME_HASH = 'frame-gate-stale-probe';
  const result = evaluateFrameGate(
    SAME_HASH,
    { currentGraphHash: SAME_HASH, graphReadable: true, freshness: 'stale' },
    mutationClass,
  );
  return result.outcome.kind !== 'proceed';
}
