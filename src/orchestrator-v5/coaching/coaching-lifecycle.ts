/**
 * V5 Coaching State Spine — Stage 2B-2: pure, internal coaching LIFECYCLE derivation.
 *
 * Compares the PRIOR pre-dispatch coaching snapshot (read by 2B-1b) against the CURRENT
 * pre-dispatch `coaching_state`, with per-source EVALUABILITY evidence, and labels each
 * signal `active | resolved | stale | unavailable`. It answers the cross-turn question
 * Stage 2A deliberately could not: did a prior signal genuinely go away?
 *
 * Discipline:
 *   - PURE + TOTAL. No DB read, no LLM, no network, no `Date.now()`/randomness, never
 *     throws (any internal fault collapses to `EMPTY_COACHING_LIFECYCLE` with `degraded`).
 *   - LIKE-FOR-LIKE. Prior is always a `pre_dispatch` snapshot (the parser rejects any
 *     other timing) and current is derived pre-dispatch — never post-handler/post-mutation.
 *   - POSITIVE EVIDENCE ONLY for `resolved`. A prior signal absent from the current
 *     derivation is `resolved` ONLY when its source was SUCCESSFULLY evaluated this turn
 *     (the evaluability flag). Absence alone is NEVER `resolved` — it degrades to `stale`
 *     (context demonstrably moved) or `unavailable` (cannot establish either).
 *   - CONTENT-FREE. Items carry closed-enum codes + SHA-prefix hashes only. No labels,
 *     node/option/factor ids, monetary values, timelines, brief text, or free text.
 *   - INTERNAL ONLY. Attached to `EnrichedTurnContext`; never serialised on the wire,
 *     the ContextPack, the routing prompt, or DGAI output. No consumer in 2B-2.
 *
 * `superseded` is intentionally DEFERRED to Stage 2B-3 (no simple, safe, testable
 * definition; it would overlap `stale`). The status union is exactly four values.
 */

import type {
  CoachingState,
  CoachingStateSignal,
  CoachingStateSignalKind,
  CoachingStateSignalSource,
  CoachingStateReasonCode,
} from './coaching-state.js';
import {
  evaluateReadiness,
  hasEvaluableDecisionReview,
  isAnalysisFreshnessEvaluable,
  isGraphProjectionEvaluable,
} from './coaching-state.js';
import type { CoachingStateSnapshot } from './coaching-state-snapshot.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle standing of a signal across turns. Distinct from Stage-2A signal `status`. */
export type CoachingLifecycleStatus = 'active' | 'resolved' | 'stale' | 'unavailable';

/** Closed reason for an item's lifecycle status — derived purely from the decision branch. */
export type CoachingLifecycleReason =
  | 'present_in_current' //                active: prior signal still present this turn
  | 'new_in_current' //                    active: current signal with no prior counterpart
  | 'source_evaluable_condition_absent' // resolved: source re-evaluated, condition gone
  | 'source_unevaluable_context_moved' //  stale: not re-evaluable + context hash diverged
  | 'source_unevaluable_indeterminate'; // unavailable: cannot establish resolution or movement

/** Per-source evaluability for THIS turn (ephemeral — never persisted). */
export interface CoachingEvaluability {
  readonly decision_context: boolean;
  readonly analysis_freshness: boolean;
  readonly analysis_readiness: boolean;
  readonly graph_projection: boolean;
  readonly existing_enrichment: boolean;
}

export interface CoachingLifecycleItem {
  readonly signal_id: string;
  readonly kind: CoachingStateSignalKind;
  readonly reason_code: CoachingStateReasonCode;
  readonly source: CoachingStateSignalSource;
  readonly lifecycle_status: CoachingLifecycleStatus;
  /** Provenance (SHA prefixes only): prior vs current graph + analysis-graph hashes. */
  readonly prior_graph_hash: string | null;
  readonly current_graph_hash: string | null;
  readonly prior_analysis_graph_hash: string | null;
  readonly current_analysis_graph_hash: string | null;
  readonly reason: CoachingLifecycleReason;
}

export interface CoachingLifecycle {
  readonly version: 'v1';
  readonly snapshot_timing: 'pre_dispatch';
  readonly status: 'empty' | 'active' | 'degraded';
  /** True only when a USABLE prior snapshot was compared (present, version-matched, non-degraded). */
  readonly prior_snapshot_available: boolean;
  /** True when a prior snapshot existed but its `coaching_state_version` differed from current. */
  readonly version_mismatch: boolean;
  readonly items: readonly CoachingLifecycleItem[];
  readonly summary: {
    readonly active_count: number;
    readonly resolved_count: number;
    readonly stale_count: number;
    readonly unavailable_count: number;
  };
}

export const EMPTY_COACHING_LIFECYCLE: CoachingLifecycle = Object.freeze({
  version: 'v1',
  snapshot_timing: 'pre_dispatch',
  status: 'empty',
  prior_snapshot_available: false,
  version_mismatch: false,
  items: [],
  summary: { active_count: 0, resolved_count: 0, stale_count: 0, unavailable_count: 0 },
});

// Runtime allow-lists for malformed-prior hardening (the snapshot parser intentionally
// does NOT validate inner signal entries — see coaching-state-snapshot.ts). A prior signal
// is only trusted if its identity fields are all valid closed-enum members; otherwise it is
// skipped (never throws, never emits raw malformed data, never yields `resolved`).
const VALID_KINDS: ReadonlySet<string> = new Set<CoachingStateSignalKind>([
  'decision_context_missing',
  'analysis_missing',
  'analysis_stale',
  'readiness_blocker',
  'defaulted_or_unknown_value',
  'evidence_gap_available',
]);
const VALID_SOURCES: ReadonlySet<string> = new Set<CoachingStateSignalSource>([
  'decision_context',
  'analysis_freshness',
  'analysis_readiness',
  'graph_projection',
  'existing_enrichment',
]);
const VALID_REASON_CODES: ReadonlySet<string> = new Set<CoachingStateReasonCode>([
  'not_populated',
  'no_successful_run_analysis_fact',
  'graph_hash_diverged',
  'legacy_fact_missing_hash',
  'current_graph_hash_unavailable',
  'staleness_indeterminate',
  'too_few_options',
  'option_needs_mapping',
  'option_needs_encoding',
  'goal_threshold_missing',
  'goal_node_missing',
  'edge_strength_defaulted',
  'evidence_enhancements_present',
  'evidence_enhancements_absent',
]);

// Sources whose context is the ANALYSIS run (compare analysis_graph_hash first); all other
// sources are GRAPH-context (compare graph_hash). See `hasContextMoved`.
const ANALYSIS_CONTEXT_SOURCES: ReadonlySet<string> = new Set<CoachingStateSignalSource>([
  'analysis_freshness',
  'existing_enrichment',
]);

// ---------------------------------------------------------------------------
// Evaluability — single source of truth with the producers (coaching-state.ts)
// ---------------------------------------------------------------------------

export interface DeriveCoachingEvaluabilityInput {
  readonly freshness: FreshnessDerivation;
  readonly priorFacts: readonly HandlerFact[];
  readonly persistedGraph: unknown | null;
}

/**
 * Compute per-source evaluability for the current turn, reusing the EXACT predicates the
 * Stage-2A producers gate on, so "source evaluable + signal absent ⇒ resolved" is honest:
 *   - decision_context: `deriveDecisionContext` is pure+total → ALWAYS evaluated this turn.
 *   - analysis_freshness: the verdict is decisive iff `freshness !== 'unknown'`.
 *   - analysis_readiness: the producer's full path (parse + structural recompute) ran
 *     without bailing (fail-closed — shared `evaluateReadiness`, NOT a bare safeParse).
 *   - graph_projection: graph is a readable object with an `edges` array (shared predicate).
 *   - existing_enrichment: a structured `decision_review` is genuinely present. Its ABSENCE
 *     (the normal staging state) means NOT evaluable — never "resolved".
 * Pure + total (never throws).
 */
export function deriveCoachingEvaluability(
  input: DeriveCoachingEvaluabilityInput,
): CoachingEvaluability {
  try {
    return {
      decision_context: true,
      analysis_freshness: isAnalysisFreshnessEvaluable(input.freshness),
      // graphHash is irrelevant to the evaluable flag (only the produced signals use it).
      analysis_readiness: evaluateReadiness(input.persistedGraph, null).evaluable,
      graph_projection: isGraphProjectionEvaluable(input.persistedGraph),
      existing_enrichment: hasEvaluableDecisionReview(input.priorFacts),
    };
  } catch {
    // Fail closed: an unknowable source must never read as resolvable.
    return {
      decision_context: false,
      analysis_freshness: false,
      analysis_readiness: false,
      graph_projection: false,
      existing_enrichment: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle derivation
// ---------------------------------------------------------------------------

export interface DeriveCoachingLifecycleInput {
  /** The most-recent prior pre-dispatch snapshot (2B-1b), or null. */
  readonly prior: CoachingStateSnapshot | null;
  /** The current-turn coaching_state (Stage 2A, derived pre-dispatch). */
  readonly current: CoachingState;
  /** Per-source evaluability for this turn. */
  readonly evaluability: CoachingEvaluability;
  /** Current canonical persisted-graph hash. */
  readonly currentGraphHash: string | null;
}

/**
 * Derive internal coaching lifecycle by comparing prior vs current signals by `signal_id`.
 * Items = (all CURRENT signals) ∪ (well-formed PRIOR signals absent from current).
 * Pure + total — never throws.
 */
export function deriveCoachingLifecycle(input: DeriveCoachingLifecycleInput): CoachingLifecycle {
  try {
    const { prior, current, evaluability, currentGraphHash } = input;
    const currentAnalysisGraphHash = current.analysis_graph_hash;

    // A degraded CURRENT state is unusable — degrade the whole comparison.
    if (current.status === 'degraded') {
      return { ...EMPTY_COACHING_LIFECYCLE, status: 'degraded', prior_snapshot_available: prior != null };
    }

    const priorState = prior?.coaching_state ?? null;
    const priorExisted = priorState != null;
    const versionMismatch = priorState != null && prior!.coaching_state_version !== current.version;

    // Usable prior signals only when: a prior exists, its version matches, it was not itself
    // degraded, and each entry is well-formed (malformed entries are skipped, NOT trusted).
    const usablePrior: CoachingStateSignal[] =
      priorState != null && !versionMismatch && priorState.status !== 'degraded'
        ? toSignalArray(priorState.signals).filter(isWellFormedPriorSignal)
        : [];

    const priorById = new Map<string, CoachingStateSignal>();
    for (const ps of usablePrior) priorById.set(ps.signal_id, ps);
    const currentIds = new Set<string>(current.signals.map((s) => s.signal_id));

    const items: CoachingLifecycleItem[] = [];

    // (1) Every current signal is active — present_in_current if it also existed in prior,
    //     else new_in_current. Emission order = current derivation order (deterministic).
    for (const cs of current.signals) {
      const priorMatch = priorById.get(cs.signal_id) ?? null;
      items.push({
        signal_id: cs.signal_id,
        kind: cs.kind,
        reason_code: cs.reason_code,
        source: cs.source,
        lifecycle_status: 'active',
        prior_graph_hash: priorMatch?.graph_hash ?? null,
        current_graph_hash: currentGraphHash,
        prior_analysis_graph_hash: priorMatch?.analysis_graph_hash ?? null,
        current_analysis_graph_hash: currentAnalysisGraphHash,
        reason: priorMatch !== null ? 'present_in_current' : 'new_in_current',
      });
    }

    // (2) Prior signals absent from current — resolved (positive evidence) > stale (context
    //     moved) > unavailable. Order is load-bearing; first match wins.
    for (const ps of usablePrior) {
      if (currentIds.has(ps.signal_id)) continue;
      let lifecycle_status: CoachingLifecycleStatus;
      let reason: CoachingLifecycleReason;
      if (evaluability[ps.source]) {
        lifecycle_status = 'resolved';
        reason = 'source_evaluable_condition_absent';
      } else if (hasContextMoved(ps, currentGraphHash, currentAnalysisGraphHash)) {
        lifecycle_status = 'stale';
        reason = 'source_unevaluable_context_moved';
      } else {
        lifecycle_status = 'unavailable';
        reason = 'source_unevaluable_indeterminate';
      }
      items.push({
        signal_id: ps.signal_id,
        kind: ps.kind,
        reason_code: ps.reason_code,
        source: ps.source,
        lifecycle_status,
        prior_graph_hash: ps.graph_hash,
        current_graph_hash: currentGraphHash,
        prior_analysis_graph_hash: ps.analysis_graph_hash,
        current_analysis_graph_hash: currentAnalysisGraphHash,
        reason,
      });
    }

    const summary = summariseLifecycle(items);
    const status: CoachingLifecycle['status'] = versionMismatch
      ? 'degraded' // a prior existed but is version-incompatible — flag, but keep current facts
      : items.length === 0
        ? 'empty'
        : 'active';

    return {
      version: 'v1',
      snapshot_timing: 'pre_dispatch',
      status,
      prior_snapshot_available: priorExisted && !versionMismatch && priorState!.status !== 'degraded',
      version_mismatch: versionMismatch,
      items,
      summary,
    };
  } catch {
    // Internal-only; any unexpected fault collapses to a safe degraded container.
    return { ...EMPTY_COACHING_LIFECYCLE, status: 'degraded' };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Source-aware "did the signal's context move?" — the stale test. Compares the relevant
 * hash for the signal's source: ANALYSIS-context sources (analysis_freshness,
 * existing_enrichment) compare `analysis_graph_hash` first and fall back to `graph_hash`
 * only when the analysis hashes are unavailable; all other sources compare `graph_hash`.
 * Missing hashes are NEVER "moved" (so they degrade to `unavailable`, not `stale`).
 */
function hasContextMoved(
  prior: CoachingStateSignal,
  currentGraphHash: string | null,
  currentAnalysisGraphHash: string | null,
): boolean {
  if (ANALYSIS_CONTEXT_SOURCES.has(prior.source)) {
    if (prior.analysis_graph_hash != null && currentAnalysisGraphHash != null) {
      return prior.analysis_graph_hash !== currentAnalysisGraphHash;
    }
    // Analysis context unavailable on one/both sides → fall back to graph context.
    if (prior.graph_hash != null && currentGraphHash != null) {
      return prior.graph_hash !== currentGraphHash;
    }
    return false;
  }
  if (prior.graph_hash != null && currentGraphHash != null) {
    return prior.graph_hash !== currentGraphHash;
  }
  return false;
}

/** Defensive: prior `signals` arrives from JSONB and may be any shape. */
function toSignalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A prior signal is trusted only if its identity fields are all valid closed-enum members
 * (the snapshot parser does not validate inner entries). Hashes may be null/absent — they
 * default to null at read time and simply yield `unavailable` (never `resolved`).
 */
function isWellFormedPriorSignal(value: unknown): value is CoachingStateSignal {
  if (value == null || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.signal_id === 'string' &&
    s.signal_id.length > 0 &&
    typeof s.kind === 'string' &&
    VALID_KINDS.has(s.kind) &&
    typeof s.source === 'string' &&
    VALID_SOURCES.has(s.source) &&
    typeof s.reason_code === 'string' &&
    VALID_REASON_CODES.has(s.reason_code) &&
    (s.graph_hash == null || typeof s.graph_hash === 'string') &&
    (s.analysis_graph_hash == null || typeof s.analysis_graph_hash === 'string')
  );
}

function summariseLifecycle(items: readonly CoachingLifecycleItem[]): CoachingLifecycle['summary'] {
  let active_count = 0;
  let resolved_count = 0;
  let stale_count = 0;
  let unavailable_count = 0;
  for (const it of items) {
    if (it.lifecycle_status === 'active') active_count += 1;
    else if (it.lifecycle_status === 'resolved') resolved_count += 1;
    else if (it.lifecycle_status === 'stale') stale_count += 1;
    else unavailable_count += 1;
  }
  return { active_count, resolved_count, stale_count, unavailable_count };
}
