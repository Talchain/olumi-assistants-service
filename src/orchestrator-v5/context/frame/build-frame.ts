/**
 * V6 Context Management — CanonicalContextFrame builder (Increment 2).
 *
 * PURE PROJECTION. `buildFrame` composes the single V6 context frame from
 * already-resolved authority OUTPUTS ({@link BuildFrameInput}). It WRAPS, never
 * re-derives: every field is a pass-through, a `.length`/lookup on a value we
 * already hold, or a pure projection of an input
 * (`summariseCanonicalAnalysisState`). It calls NO derivation authority
 * (`deriveAnalysisFreshness` / `selectCanonicalAnalysisState` /
 * `projectRecentChanges` / `computeAnalysisAffectingGraphHash`).
 *
 * LIVE as of T4 Slice 2: the turn-executor builds the frame once per turn at
 * its finalise seam (`finalizeRun`), and the route's flag-gated
 * context-summary diagnostic is the first consumer
 * (`../context-summary-from-frame.ts`). Changes here alter the live per-turn
 * frame — review accordingly. See
 * `Docs/v6/increment-2-frame-builder-brief.md` for the original inert brief.
 *
 * SIDE-EFFECT-FREE / TOTAL. No I/O, no throw, deterministic (same input → same
 * output). `model.graphHash` is single-sourced from `freshness.current_graph_hash`
 * (the freshness authority the frame's staleness logic already trusts), so there
 * is no second graph-hash input to reconcile and no need to assert-and-throw.
 * Cross-input parity — that `freshness` and `canonicalState` were derived from
 * one graph — is a live-seam invariant enforced in Increment 2b, not here.
 *
 * F.6 / CLAIM PERMISSIONS. Surfaces no held science; `evidence` carries only
 * annotation booleans (here omitted); claim permissions default HELD via
 * {@link DEFAULT_CLAIM_PERMISSIONS} when the caller omits them.
 */

import { summariseCanonicalAnalysisState } from '../canonical-analysis-state.js';
import { DEFAULT_CLAIM_PERMISSIONS } from './claim-permissions.js';
import {
  CANONICAL_CONTEXT_FRAME_VERSION,
  type BuildFrameInput,
  type CanonicalContextFrame,
} from './types.js';

/**
 * Compose the read-only V6 {@link CanonicalContextFrame} from already-resolved
 * authority outputs. Pure; see the module header for the invariants it holds.
 */
export function buildFrame(input: BuildFrameInput): CanonicalContextFrame {
  return {
    version: CANONICAL_CONTEXT_FRAME_VERSION,
    model: {
      // Both hashes single-sourced from the freshness authority — the field the
      // frame's staleness logic already trusts — so `model` and `freshness` stay
      // internally consistent with no second graph-hash input to diverge from.
      // (`CanonicalAnalysisState.current_graph_hash` is itself copied from this
      // same derivation upstream; that the two inputs share one derivation is a
      // live-seam invariant for Increment 2b.)
      graphHash: input.freshness.current_graph_hash,
      graphHashAtRun: input.freshness.graph_hash_at_run,
      counts: input.graphCounts ?? null,
    },
    analysis: {
      status: input.canonicalState.status,
      usableForProse: input.canonicalState.usableForProse,
      usableForChips: input.canonicalState.usableForChips,
      usableForFollowupContext: input.canonicalState.usableForFollowupContext,
      requiresRerun: input.canonicalState.requiresRerun,
      blockedUnusable: input.canonicalState.blockedUnusable,
      source: input.canonicalStateSource,
    },
    freshness: {
      verdict: input.freshness.freshness,
      reason: input.freshness.reason,
      computedAt: input.freshness.computed_at,
    },
    // Already the projected FrameChanges (projected once upstream) — pass through.
    changes: input.recentChanges,
    conversation: {
      // Required input — no default. A misleading 0 for "not supplied" is
      // unconstructible (honest-null rule; see BuildFrameInput.priorTurnCount).
      priorTurnCount: input.priorTurnCount,
      // Single source: the projected changes array. Never a separate count.
      recentChangeCount: input.recentChanges.length,
      // Honest default: the builder NEVER invents confirmation state. When the
      // caller does not thread it, `false` means "not supplied", and must not be
      // read as a positive "no pending action" claim (see BuildFrameInput doc).
      pendingConfirmation: input.pendingConfirmation ?? false,
    },
    intent: {
      deterministicMatch: input.intent?.deterministicMatch ?? false,
      preRouteClass: input.intent?.preRouteClass ?? null,
    },
    // Annotation-only (F.6); no provenance source threaded yet ⇒ omit the
    // optional booleans rather than fabricate them.
    evidence: {},
    claimPermissions: input.claimPermissions ?? DEFAULT_CLAIM_PERMISSIONS,
    // Affordance scaffold — no authority wired yet (Increment 6).
    actions: {},
    uiTargets: {},
    diagnostics: {
      // Pure redacted projection of the canonical state we already hold — not a
      // second derivation.
      analysisStateSummary: summariseCanonicalAnalysisState(input.canonicalState),
      canonicalStateSource: input.canonicalStateSource,
    },
  };
}
