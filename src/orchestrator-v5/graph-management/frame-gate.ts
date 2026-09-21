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
 *  - freshness authority unresolved           → FRESHNESS_UNRESOLVED (held)
 *  - otherwise                                → proceed
 *
 * ⭐⭐ RULING A4 (Paul, 2026-08-05) — STALENESS IS A PROPERTY OF THE RESULTS,
 * DISPLAYED HONESTLY, NEVER A LOCK ON THE EDITOR. The freshness rung used to
 * refuse a hash-matching candidate whenever the last analysis was older than
 * the graph — a condition that is TRUE AFTER EVERY APPLIED EDIT, so the second
 * step of any restructure dead-ended. It is now class-independent and trusts
 * `'stale'`, because the two things the rung ABOVE it proves are the only
 * currency an edit needs:
 *   (a) the base-hash rung still proves the candidate was generated against
 *       the CURRENT graph (CAS semantics untouched — divergence still stales
 *       for every class), and
 *   (b) staleness is a property of the ANALYSIS, which the applied receipt's
 *       rerun chip resolves and which the UI displays on the RESULTS.
 * Both were already written in this file by the D-S lane (2026-07-12) as the
 * justification for a TUNABLE-only relaxation; neither is class-dependent.
 * A4 generalises that argument rather than extending it — the gate now has no
 * business knowing the mutation class, and structurally cannot.
 *
 * What A4 does NOT relax: `'unknown'` freshness. That is the derivation having
 * FAILED — a statement about the system's knowledge, not about the analysis
 * being out of date — and it belongs with the two rungs above it. It gets its
 * own outcome kind and HOLDS for confirmation, which is where this ladder puts
 * every other unresolved-authority state. Note the direction: nothing here
 * auto-applies that did not before. A rung that PRE-EMPTED the consent gate is
 * removed, so strictly MORE candidates now reach the confirm chip.
 *
 * The `stale` outcome's `reason` is narrowed to the single literal
 * `'base_hash_diverged'` deliberately: after A4 the COMPILER, not a comment,
 * enforces that no freshness value can produce a `stale` verdict.
 */
import type { FrameFreshness, MutationFrame } from './types.js';

/**
 * Freshness values that permit an apply-eligible outcome, FOR EVERY CLASS.
 *
 * `'fresh'`  — the analysis matches the current graph.
 * `'none'`   — pre-analysis; there is no analysis to be stale against.
 * `'stale'`  — the analysis is older than the graph. A4: that is a fact about
 *              the RESULTS, and the results say so themselves; it is not a
 *              reason to refuse an edit whose base hash matches.
 *
 * `'unknown'` is deliberately absent and is NOT a staleness case — see
 * `FrameGateOutcome['freshness_unresolved']`.
 */
const TRUSTWORTHY_FRESHNESS: ReadonlySet<FrameFreshness> = new Set<FrameFreshness>([
  'fresh',
  'none',
  'stale',
]);

export type FrameGateOutcome =
  | { readonly kind: 'frame_unavailable' }
  | { readonly kind: 'unreadable' }
  /** A4: the freshness AUTHORITY could not be resolved → held, never stale. */
  | { readonly kind: 'freshness_unresolved' }
  | { readonly kind: 'stale'; readonly reason: 'base_hash_diverged' }
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
    // Class-independent, and UNTOUCHED by A4: CAS semantics are the whole
    // currency requirement an edit has, and this rung is where they live.
    return { outcome: { kind: 'stale', reason: 'base_hash_diverged' }, baseHashMatch };
  }
  if (!TRUSTWORTHY_FRESHNESS.has(frame.freshness)) {
    // 'unknown' (or any unexpected value) → the freshness AUTHORITY is
    // unresolved. Fail closed to a HOLD, alongside the two rungs above; never
    // to `stale`, whose copy would tell the user the model has moved while
    // `base_hash_match` says, in the same payload, that it has not.
    return { outcome: { kind: 'freshness_unresolved' }, baseHashMatch };
  }
  return { outcome: { kind: 'proceed' }, baseHashMatch };
}

/**
 * ⭐ WOULD A STALE ANALYSIS BLOCK AN APPLY? — ASKED OF THE GATE, never restated
 * from its trust set.
 *
 * ROADMAP 2.474 / A3. The structural-edit split disclosure has to tell the user
 * whether a re-run is needed between step 1 and step 2, and the answer is
 * entirely a property of the freshness rung above: once part 1 is confirmed and
 * applied the graph hash moves, so a scenario that already carries a successful
 * analysis flips to `freshness: 'stale'` by construction, and whether the NEXT
 * part is then apply-eligible is exactly what this gate decides.
 *
 * The alternative — a comment in the disclosure module saying "structural
 * candidates trust only fresh/none" — would be a mirror of the trust set above,
 * green the day it is written and silently over-warning the day the set moves.
 * ⭐ AND THE SET MOVED: RULING A4 (2026-08-05) made the rung class-independent,
 * so this now answers `false` and the split disclosure retires its re-run
 * copy AUTOMATICALLY, with no sentence left behind. That is the whole reason
 * #829 asked the gate instead of restating it — the derivation earned its keep
 * within a day.
 *
 * The `mutationClass` parameter is GONE with the class-conditional it fed: a
 * parameter the gate can no longer act on is a dead hook, and a dead hook is
 * the drift vector this estate keeps paying for.
 *
 * The probe frame is a REACHABLE state, not an invented one: base hash matching
 * its own frame with `freshness: 'stale'` is the post-apply state the D-S
 * commit message names ("the first auto-applied edit flips freshness to
 * stale"). The hash value is irrelevant and cancels — it is compared only with
 * itself, which is what isolates the freshness rung from the base-hash rung.
 */
export function staleAnalysisBlocksApply(): boolean {
  const SAME_HASH = 'frame-gate-stale-probe';
  const result = evaluateFrameGate(SAME_HASH, {
    currentGraphHash: SAME_HASH,
    graphReadable: true,
    freshness: 'stale',
  });
  return result.outcome.kind !== 'proceed';
}
