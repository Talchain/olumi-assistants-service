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
 *     is typed as those authorities' return types, so a builder can only pass
 *     already-resolved values through — it cannot introduce a second
 *     freshness / canonical-state / recent-change derivation.
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
import type { ClaimPermissionTable } from './claim-permissions.js';

export type { CanonicalStateSource } from '../build-context-summary.js';

/** Frame schema version. Bumped when the frame contract changes shape. */
export const CANONICAL_CONTEXT_FRAME_VERSION = '0.1.0';
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
 */
export interface FrameAnalysis {
  readonly status: FrameAnalysisStatus;
  /** Provenance: full turn-executor verdict vs partial route fallback. */
  readonly source: CanonicalStateSource;
  readonly usableForProse: boolean;
  readonly usableForChips: boolean;
  readonly usableForFollowupContext: boolean;
  readonly requiresRerun: boolean;
  readonly blockedUnusable: boolean;
}

/** changes projection — decision-language summaries, no identifiers. */
export interface FrameChange {
  readonly action: FrameChangeAction;
  readonly summary: string;
  readonly targetLabel: string;
}
export type FrameChanges = readonly FrameChange[];

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
 * provenance and freshness; NEVER held-science values (no sensitivity /
 * fragility / driver / flip / robustness / EVPI prose or numbers).
 */
export interface FrameEvidence {
  readonly freshnessVerdict: FrameFreshnessVerdict;
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
 * diagnostics projection — references the existing redacted summary. Diagnostic
 * only; never product logic (mirrors the `_context_summary` discipline).
 */
export interface FrameDiagnostics {
  readonly analysisStateSummary?: AnalysisStateSummary;
  readonly canonicalStateSource?: CanonicalStateSource;
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
}

// ── Builder contract (TYPE ONLY — implementation is a later increment) ──

/**
 * INPUT to the (future) frame builder — the wrap-never-re-derive contract.
 *
 * Every field is an already-resolved authority OUTPUT taken from the current
 * turn's call path. A builder constructed against this type cannot introduce a
 * second derivation: it is handed the freshness verdict, the canonical state,
 * the assembled recent-changes and the graph hash, and may only project them.
 * In particular, the builder MUST read `recentChanges` (already projected once
 * per turn) and MUST NOT call `projectRecentChanges` again. See state map §3.1.
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
   * The assembled recent-changes (`contextPack.recent_changes`) — already
   * projected once per turn. The builder MUST NOT re-project.
   */
  readonly recentChanges: readonly RecentMutation[];
  /** The current turn's analysis-affecting graph hash. */
  readonly graphHash: string | null;
  /** Optional graph entity counts, when the caller has them. */
  readonly graphCounts?: FrameGraphCounts | null;
  /** Prior-turn count from the assembled context. */
  readonly priorTurnCount?: number;
  /** Deterministic pre-route verdict, when a gate matched. */
  readonly intent?: FrameIntent;
  /**
   * Claim-permission table. When omitted, the builder is expected to default to
   * the held table (`DEFAULT_CLAIM_PERMISSIONS`). No relaxation here.
   */
  readonly claimPermissions?: ClaimPermissionTable;
}

/**
 * The frame builder CONTRACT — a type only. The implementation (Increment 2,
 * `build-frame.ts`) must be a pure projection over {@link BuildFrameInput}.
 */
export type BuildFrame = (input: BuildFrameInput) => CanonicalContextFrame;
