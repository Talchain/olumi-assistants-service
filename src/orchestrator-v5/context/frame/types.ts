/**
 * V6 Context Management — typed CanonicalContextFrame (Increment 1).
 *
 * TYPES ONLY. This module defines the V6 context-frame contract: a single
 * per-turn, read-only projection of the existing CEE context authorities. It
 * adds NO runtime wiring, NO call sites and NO behaviour. The frame builder
 * (`BuildFrame`) is declared here as a *type contract only*; its
 * implementation, the diagnostic projection, and any consumer migration are
 * separate, separately-reviewed increments — see
 * `Docs/v6/context-management-authoritative-state-map.md` §6.
 *
 * Design rules (state map §3.1):
 *   - WRAP, NEVER RE-DERIVE. The frame is composed from the *outputs* of the
 *     existing single authorities (freshness, canonical analysis state,
 *     recent-changes, graph-hash). The builder INPUT ({@link BuildFrameInput})
 *     is typed as those authorities' resolved outputs — freshness as
 *     `FreshnessDerivation`, analysis bound to `CanonicalAnalysisState` via
 *     `Pick<>`, and recent-changes as the ALREADY-projected {@link FrameChanges}
 *     — so a builder can only pass already-resolved values through; it cannot
 *     introduce a second freshness / canonical-state / recent-change derivation.
 *   - READ-ONLY PROJECTIONS. What consumers read ({@link CanonicalContextFrame})
 *     is a set of narrow, read-only per-domain projection interfaces — the
 *     formalised version of the existing `AdviceGateCanonicalState` /
 *     `AdviceGateRecentChange` mirror pattern in the post-analysis advice gate.
 *   - F.6 ANNOTATION-ONLY. Evidence/provenance fields annotate provenance,
 *     freshness and permission; they never derive or reinterpret
 *     producer-owned science.
 *   - CLAIM PERMISSIONS DEFAULT-HELD. See `./claim-permissions.ts`. No
 *     held-science values are surfaced by any projection defined here.
 */

import type { FreshnessDerivation } from '../freshness.js';
import type {
  AnalysisStateSummary,
  CanonicalAnalysisState,
} from '../canonical-analysis-state.js';
import type { RecentMutation } from '../recent-changes.js';
import type { CanonicalStateSource } from '../build-context-summary.js';
import type {
  PendingActionKind,
  PendingLifecycleSummary,
} from '../../session/pending-action.js';
import type { ClaimPermissionTable } from './claim-permissions.js';

export type { CanonicalStateSource } from '../build-context-summary.js';

/**
 * Frame schema version. Bumped when the frame contract changes shape.
 * 0.2.0 — Track 2: additive optional `pending` diagnostics block +
 * threaded `conversation.pendingConfirmation` truth.
 */
export const CANONICAL_CONTEXT_FRAME_VERSION = '0.2.0';
export type CanonicalContextFrameVersion =
  typeof CANONICAL_CONTEXT_FRAME_VERSION;

// ── Enum aliases, reused verbatim from the authorities (no re-declaration) ──

/** Freshness verdict (`fresh`/`stale`/`unknown`/`none`), from the freshness authority. */
export type FrameFreshnessVerdict = FreshnessDerivation['freshness'];
/** Stable freshness reason code, from the freshness authority. */
export type FrameFreshnessReason = FreshnessDerivation['reason'];
/** Structural readiness status (or null), from the canonical analysis state. */
export type FrameAnalysisStatus = CanonicalAnalysisState['status'];
/** Recent-change discriminator, from the recent-changes authority. */
export type FrameChangeAction = RecentMutation['action'];

// ── Per-domain read-only projection interfaces ──

/** Integer counts of analysis-relevant graph entities. No node/edge content. */
export interface FrameGraphCounts {
  readonly nodes: number;
  readonly edges: number;
  readonly options: number;
  readonly goals: number;
}

/** model / graph projection — hashes + optional entity counts. No graph content. */
export interface FrameModel {
  /** Hash of the current turn's analysis-affecting graph fields, or null. */
  readonly graphHash: string | null;
  /** Hash of the graph at the time the selected analysis ran, or null. */
  readonly graphHashAtRun: string | null;
  /** Integer entity counts when available; null/absent otherwise. */
  readonly counts?: FrameGraphCounts | null;
}

/** freshness projection — the single freshness authority's verdict, read-only. */
export interface FrameFreshness {
  readonly verdict: FrameFreshnessVerdict;
  readonly reason: FrameFreshnessReason;
  /** ISO timestamp of the selected fact's run, or null. */
  readonly computedAt: string | null;
}

/**
 * analysis projection — narrow usability predicates (formalises the
 * `AdviceGateCanonicalState` mirror). Carries the provenance `source`; never
 * the full internal blocker/adjustment objects.
 *
 * The projected fields are **bound to the authority** via
 * `Pick<CanonicalAnalysisState, …>` rather than hand-restated, so a rename or
 * retype of any predicate on the canonical analysis state breaks this interface
 * at compile time (no silent drift; `readonly` carries through `Pick`). The only
 * member the frame adds is `source` (provenance), which the authority does not
 * own. The public `FrameAnalysisStatus` alias is kept as a consumer convenience.
 */
export interface FrameAnalysis
  extends Pick<
    CanonicalAnalysisState,
    | 'status'
    | 'usableForProse'
    | 'usableForChips'
    | 'usableForFollowupContext'
    | 'requiresRerun'
    | 'blockedUnusable'
  > {
  /** Provenance: full turn-executor verdict vs partial route fallback. */
  readonly source: CanonicalStateSource;
}

/** changes projection — decision-language summaries, no identifiers. */
export interface FrameChange {
  readonly action: FrameChangeAction;
  readonly summary: string;
  readonly targetLabel: string;
}
export type FrameChanges = readonly FrameChange[];

/**
 * The single, named `RecentMutation` → {@link FrameChanges} projection (TYPE
 * ONLY). This is the *one* place the authority output is mapped into the frame's
 * changes shape — it runs once per turn, at the seam that owns
 * `contextPack.recent_changes`, and its output is what {@link BuildFrameInput}
 * receives. Because the builder is handed the already-projected `FrameChanges`
 * (not raw `RecentMutation[]`), "project once per turn" is structural rather than
 * comment-only: there is no `RecentMutation[]` in scope for the builder to
 * re-project. Implementation lands with the upstream seam in a later increment.
 */
export type ProjectRecentChangesToFrame = (
  changes: readonly RecentMutation[],
) => FrameChanges;

/** conversation projection — counts + pending flag. No raw turn content. */
export interface FrameConversation {
  readonly priorTurnCount: number;
  readonly recentChangeCount: number;
  readonly pendingConfirmation: boolean;
}

/**
 * intent projection — the DETERMINISTIC pre-route verdict only. The post-route
 * LLM intent is intentionally excluded (F.6: prompt output is not source).
 */
export interface FrameIntent {
  /** True when a deterministic pre-route gate matched (e.g. state-query). */
  readonly deterministicMatch: boolean;
  /** Closed, structural label of the matched deterministic gate, when any. */
  readonly preRouteClass?: string | null;
}

/**
 * evidence projection — annotation only (F.6). Booleans/refs that attest to
 * provenance; NEVER held-science values (no sensitivity / fragility / driver /
 * flip / robustness / EVPI prose or numbers).
 *
 * Freshness is intentionally NOT duplicated here: the single freshness verdict
 * lives on {@link FrameFreshness} (`frame.freshness.verdict`). There is exactly
 * one freshness-verdict concept in the frame.
 */
export interface FrameEvidence {
  /** Whether a decision-review enrichment was attached to the selected fact. */
  readonly hasDecisionReview?: boolean;
  /** Whether edge-level provenance metadata is present. Boolean only. */
  readonly provenancePresent?: boolean;
}

// ── actions projection — affordance scaffold (shapes only; a later increment fills it) ──

export interface FrameCommittedRef {
  readonly graphHash: string | null;
}
export interface FrameProposedRef {
  /** Structural kind of the proposed change. No held-science. */
  readonly kind: string;
}
export interface FrameRejectedRef {
  /** Structural rejection reason class (e.g. reachability). No held-science. */
  readonly reasonClass: string;
}
export interface FramePendingRef {
  readonly kind: string;
}

/** actions projection — committed/proposed/rejected/pending affordance scaffold. */
export interface FrameActions {
  readonly committed?: FrameCommittedRef | null;
  readonly proposed?: readonly FrameProposedRef[];
  readonly rejected?: readonly FrameRejectedRef[];
  readonly pending?: readonly FramePendingRef[];
}

/** ui_targets projection — scaffold only; no authority exists today. */
export type FrameUiTargets = Record<string, never>;

/**
 * rerun / what-changed readiness (Track 2) — counts + a boolean readiness
 * predicate for the harness to see WHY a before/after comparison would or
 * would not be available. NOT the comparison itself (that stays the
 * run-comparison gate's job); this is a read-only diagnostic derived from the
 * SAME authorities the gate consults (`isSuccessfulRunAnalysisFact` over the
 * prior facts + the freshness verdict). `comparisonCandidatesReady` means the
 * PRECONDITIONS the gate checks hold (fresh analysis + ≥2 successful prior
 * runs) — the projection / diff can still decline downstream, so the name says
 * "candidates", not "will compare".
 */
export interface FrameRerunReadiness {
  /** Successful run_analysis facts observed in the prior-fact chain. */
  readonly priorSuccessfulRunCount: number;
  /** Freshness is `fresh` AND ≥2 successful prior runs exist. */
  readonly comparisonCandidatesReady: boolean;
}

/**
 * diagnostics projection — references the existing redacted summary. Diagnostic
 * only; never product logic (mirrors the redacted diagnostic-summary discipline).
 */
export interface FrameDiagnostics {
  readonly analysisStateSummary?: AnalysisStateSummary;
  readonly canonicalStateSource?: CanonicalStateSource;
  /**
   * Track 2 — rerun / what-changed readiness (optional, additive). Present
   * only when the caller threads it (already computed outside the builder —
   * the wrap-never-re-derive contract forbids the builder importing the
   * fact-selection authorities).
   */
  readonly rerun?: FrameRerunReadiness;
}

// ── pending projection (Track 2) — redacted pending-action observability ──

/**
 * Per-turn pending-action lifecycle outcome, tallied by the commit-time
 * carry-forward pass (`computeSurvivingPriorPendingsDetailed` in commit.ts).
 * Single source of truth is the session leaf's {@link PendingLifecycleSummary}
 * so the commit producer and this frame consumer cannot drift. Integer counts
 * only; present only when this turn committed (honest absence otherwise).
 */
export type FramePendingLifecycle = PendingLifecycleSummary;

/**
 * pending projection — read-time pending-action truth as derived ONCE at
 * ORIENT from `most_recent_pending_actions` via the shared liveness
 * predicate (`session/pending-action.ts`). Counts and closed-enum kind keys
 * only; never labels, messages, ids or patch payloads. Populated
 * REGARDLESS of the pending-confirmation kill-switch so manual testers can
 * see the derived truth even when threading is disabled — `threaded`
 * records the flag state that governed `conversation.pendingConfirmation`.
 */
export interface FramePendingDiagnostics {
  /** Live (non-expired) pending actions from the most recent prior turn. */
  readonly liveCount: number;
  /** Entries present in the persisted read but expired (wall or turn TTL). */
  readonly expiredCount: number;
  /** Live counts by kind (closed enum keys; absent kind ⇒ zero). */
  readonly kinds: Partial<Record<PendingActionKind, number>>;
  /** Live entries whose kind is in CONFIRMATION_EXPECTING_ACTION_TYPES. */
  readonly confirmationExpectingLiveCount: number;
  /** Whether CEE_PENDING_CONFIRMATION_TRUTH_ENABLED threaded the truth. */
  readonly threaded: boolean;
  /** Commit-time lifecycle tallies, when this turn committed. */
  readonly lifecycle?: FramePendingLifecycle;
}

/** The single composed, read-only V6 context frame. */
export interface CanonicalContextFrame {
  readonly version: CanonicalContextFrameVersion;
  readonly model: FrameModel;
  readonly analysis: FrameAnalysis;
  readonly freshness: FrameFreshness;
  readonly changes: FrameChanges;
  readonly conversation: FrameConversation;
  readonly intent: FrameIntent;
  readonly evidence: FrameEvidence;
  readonly claimPermissions: ClaimPermissionTable;
  readonly actions: FrameActions;
  readonly uiTargets: FrameUiTargets;
  readonly diagnostics: FrameDiagnostics;
  /**
   * Track 2 — pending-action observability (optional, additive). Distinct
   * from the inert `actions` affordance scaffold above (Increment 6 owns
   * that); this block is counts-only diagnostics.
   */
  readonly pending?: FramePendingDiagnostics;
}

// ── Builder contract (TYPE ONLY — implementation is a later increment) ──

/**
 * INPUT to the (future) frame builder — the wrap-never-re-derive contract.
 *
 * Every field is an already-resolved authority OUTPUT taken from the current
 * turn's call path. A builder constructed against this type cannot introduce a
 * second derivation: it is handed the freshness verdict (which carries the
 * current graph hash), the canonical state, and the already-projected
 * recent-changes, and may only project them. Because `recentChanges` arrives as
 * the frame-projected
 * {@link FrameChanges} (not raw `RecentMutation[]`), the builder structurally
 * cannot re-run `projectRecentChanges`. See state map §3.1.
 */
export interface BuildFrameInput {
  /** The single freshness authority's output (`deriveAnalysisFreshness`). */
  readonly freshness: FreshnessDerivation;
  /**
   * The composed canonical analysis verdict (`selectCanonicalAnalysisState`,
   * or the partial `canonicalStateFromFreshness`).
   */
  readonly canonicalState: CanonicalAnalysisState;
  /** Provenance of `canonicalState`. */
  readonly canonicalStateSource: CanonicalStateSource;
  /**
   * The recent-changes for this turn, ALREADY projected into the frame's
   * {@link FrameChanges} shape upstream (where `contextPack.recent_changes` is
   * owned) via {@link ProjectRecentChangesToFrame}. Taking the projected form
   * here — not raw `RecentMutation[]` — makes "project once per turn" STRUCTURAL:
   * the builder is never handed `RecentMutation[]`, so it cannot call
   * `projectRecentChanges` (or re-apply the cap) a second time.
   */
  readonly recentChanges: FrameChanges;
  /** Optional graph entity counts, when the caller has them. */
  readonly graphCounts?: FrameGraphCounts | null;
  /**
   * Prior-turn count from the ASSEMBLED context (the pack's capped
   * conversation projection). REQUIRED: the frame is only built where the
   * assembled pack exists, and the context-summary contract forbids a
   * misleading defaulted 0 ("honest null" rule, build-context-summary.ts) —
   * so "not supplied" is unconstructible rather than representable.
   */
  readonly priorTurnCount: number;
  /** Deterministic pre-route verdict, when a gate matched. */
  readonly intent?: FrameIntent;
  /**
   * Whether a user-facing confirmation is outstanding this turn. This is a
   * conversation/confirmation-flow fact owned upstream (`confirmation-flow.ts` /
   * `most_recent_pending_actions`), NOT derivable from the four analysis
   * authorities — so the caller supplies it. Optional; the builder defaults to
   * `false` when it is not threaded (the inert/off default). The builder never
   * computes confirmation state; a `false` default is "not supplied", and must
   * not be read as a positive "no pending action" claim.
   */
  readonly pendingConfirmation?: boolean;
  /**
   * Claim-permission table. When omitted, the builder is expected to default to
   * the held table (`DEFAULT_CLAIM_PERMISSIONS`). No relaxation here.
   */
  readonly claimPermissions?: ClaimPermissionTable;
  /**
   * Track 2 — pending-action diagnostics, ALREADY tallied at the ORIENT
   * derivation site (wrap-never-re-derive: the builder receives counts, not
   * `PendingAction[]`, so it structurally cannot re-run the liveness
   * predicate). Optional; omitted ⇒ the frame carries no `pending` block
   * (honest absence, e.g. a hand-built frame in tests).
   */
  readonly pending?: FramePendingDiagnostics;
  /**
   * Track 2 — rerun / what-changed readiness, ALREADY computed outside the
   * builder (the builder must not import the fact-selection authorities per
   * the source-scan allowlist). Placed into `diagnostics.rerun` verbatim.
   * Optional; omitted ⇒ no rerun diagnostics on this frame.
   */
  readonly rerunReadiness?: FrameRerunReadiness;
}

/**
 * The frame builder CONTRACT — a type only. The implementation (Increment 2,
 * `build-frame.ts`) must be a pure projection over {@link BuildFrameInput}.
 */
export type BuildFrame = (input: BuildFrameInput) => CanonicalContextFrame;
