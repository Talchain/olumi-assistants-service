/**
 * V5 `_context_summary` — redacted, flag-gated context-state surface.
 *
 * This is the OBSERVABILITY surface for the Golden-Journey Harness v1
 * (A1 coherence / A2 context completeness). It is attached to the turn
 * response ONLY when `config.cee.contextSummaryEnabled` is set, stripped +
 * re-attached at the route seam (`sendFinalised200`) exactly like
 * `_diagnostic_trace`.
 *
 * ## Diagnostic-only — never product logic
 *
 * `_context_summary` MUST NOT be read by any UI / prose / chip / coaching
 * path. It exists for staging diagnostics + the harness only. A static
 * guard test (tests/contract/context-summary-diagnostic-only.guard.test.ts)
 * fails if the `_context_summary` wire key appears outside the allowlisted
 * route / builder / debug-type files. This module produces the value; it
 * does not decide product behaviour.
 *
 * ## Redaction
 *
 * Every field is a status, predicate, count or hash — NEVER raw user text,
 * blocker messages, option/factor labels, prose, or graph node/edge
 * content. The analysis projection reuses {@link AnalysisStateSummary}
 * (counts only). Graph content is reduced to four integer counts.
 *
 * ## Honest observability scope (hardening #4)
 *
 * Fields whose source is not yet threaded to the route seam are nullable
 * and emitted as `null` (NOT a misleading `0` / `false`):
 *   - `recent_turn_count` / `recent_change_count` → populated when the
 *     turn-executor threads the assembled context (M5).
 *   - `capabilities_present` → populated when capabilities are derived and
 *     threaded (M6).
 * `null` means "not observed at this surface yet", distinct from a real
 * zero/false. Pure module — no I/O, no telemetry, no flag check (the
 * caller gates).
 */

import type {
  AnalysisStateSummary,
  CanonicalAnalysisState,
  CoachingStatePack,
} from './canonical-analysis-state.js';
import {
  summariseCanonicalAnalysisState,
  summariseCoachingStatePack,
} from './canonical-analysis-state.js';
import type { PendingActionKind } from '../session/pending-action.js';

/**
 * 1.1.0 — Track 2: additive optional `pending` block (pending-confirmation
 * truth + redacted pending-action observability). Frame-projection only
 * (`contextSummaryFromFrame`); the legacy parts-assembled builder never
 * emits it (no frame ⇒ no pending source).
 */
export const V5_CONTEXT_SUMMARY_VERSION = '1.1.0';

/**
 * Provenance of the canonical state this summary projects. Determined by the
 * route's `ctx.canonicalState ? 'turn_executor' : 'route_fallback'` predicate —
 * i.e. by whether the dispatch path threaded a full verdict, NOT by entry path.
 *   - `turn_executor` — the FULL verdict assembled in turn-executor (execute
 *     post-dispatch OR the non-execute finalize fallback), graph-authority-
 *     consistent, with degraded-fact detection.
 *   - `route_fallback` — the PARTIAL `canonicalStateFromFreshness` verdict the
 *     route composes whenever the dispatch path did NOT thread `canonicalState`
 *     (today: every non-turn-executor exit — chip-click, system-event,
 *     edit-graph recovery, draft, …): freshness/readiness only, NO degraded
 *     detection.
 * A consumer must NOT treat a `route_fallback` summary as full graph-authority
 * state. Diagnostic-only; never product logic.
 */
export type CanonicalStateSource = 'turn_executor' | 'route_fallback';

/** Integer counts of the analysis-relevant graph entities. No content. */
export interface ContextSummaryGraphCounts {
  readonly nodes: number;
  readonly edges: number;
  readonly options: number;
  readonly goals: number;
}

/**
 * Redacted per-turn pending-action lifecycle tallies (Track 2). Integer
 * counts only — no ids, labels, messages, or patch content. Present only
 * when the turn committed and the commit threaded the carry-forward summary.
 */
export interface ContextSummaryPendingLifecycle {
  readonly prior_count: number;
  readonly consumed_count: number;
  readonly superseded_count: number;
  readonly expired_wall_count: number;
  readonly expired_turns_count: number;
  readonly hash_invalidated_count: number;
  readonly survived_count: number;
}

/**
 * Redacted pending-action observability (Track 2). Counts + closed-enum
 * kind keys + booleans only; never labels, messages, ids or patch payloads.
 * `pending_confirmation` mirrors the gated seam value threaded to the
 * ContextPack / frame; `threaded` records whether
 * `CEE_PENDING_CONFIRMATION_TRUTH_ENABLED` governed it, so a `false`
 * pending_confirmation alongside a non-zero
 * `confirmation_expecting_live_count` is legible as "kill-switch off", not
 * "no live proposal".
 */
export interface ContextSummaryPending {
  readonly pending_confirmation: boolean;
  readonly live_count: number;
  readonly expired_count: number;
  readonly kinds: Partial<Record<PendingActionKind, number>>;
  readonly confirmation_expecting_live_count: number;
  readonly threaded: boolean;
  readonly lifecycle?: ContextSummaryPendingLifecycle;
}

/**
 * Redacted rerun / what-changed readiness (Track 2). Count + a readiness
 * boolean; the harness reads WHY a before/after comparison would or would not
 * be available without any run content reaching the wire.
 */
export interface ContextSummaryRerun {
  readonly prior_successful_run_count: number;
  readonly comparison_candidates_ready: boolean;
}

/**
 * The redacted wire shape. Statuses / predicates / counts / hashes only.
 */
export interface V5ContextSummary {
  readonly version: typeof V5_CONTEXT_SUMMARY_VERSION;
  /** Canonical analysis state, redacted to counts/statuses/predicates/hashes. */
  readonly analysis_state: AnalysisStateSummary;
  /** Graph entity counts, or null when the turn had no graph. */
  readonly graph_counts: ContextSummaryGraphCounts | null;
  /** Count of recent turns in the assembled context, or null if not threaded. */
  readonly recent_turn_count: number | null;
  /** Count of recent changes in the assembled context, or null if not threaded. */
  readonly recent_change_count: number | null;
  /** Whether capabilities were present in the context, or null if not threaded. */
  readonly capabilities_present: boolean | null;
  /**
   * Provenance of `analysis_state` (and, when present, `coaching_state_pack`):
   * `turn_executor` for the full graph-authority verdict, `route_fallback` for
   * the partial freshness-only fallback. Omitted only when the caller does not
   * thread it (the route always does). See {@link CanonicalStateSource}.
   */
  readonly canonical_state_source?: CanonicalStateSource;
  /**
   * Redacted, hash-free coaching state pack, projected from the SAME canonical
   * state as `analysis_state` (so its provenance is `canonical_state_source` —
   * it is NOT restricted to non-execute turns). OMITTED entirely unless the
   * caller opts in (route gates on `coachingStatePackEnabled` AND the enclosing
   * `contextSummaryEnabled`). Absent → the coaching pack is disabled at this
   * surface; never read by any prompt / chip / product path. Named
   * `coaching_state_pack` (not `coaching_state`) to stay disjoint from the
   * unrelated coaching-lifecycle `coaching_state` feature.
   */
  readonly coaching_state_pack?: CoachingStatePack;
  /**
   * Track 2 — redacted pending-action observability. FRAME-PROJECTION ONLY:
   * present when the turn-executor built a frame carrying the pending block
   * (`contextSummaryFromFrame`); ABSENT on the legacy parts-assembled
   * fallback (chip-click / system-event / draft paths have no frame, so no
   * pending source). Absence here is honest "not observed at this seam",
   * never a "no pending action" claim.
   */
  readonly pending?: ContextSummaryPending;
  /**
   * Track 2 — redacted rerun / what-changed readiness. FRAME-PROJECTION ONLY
   * (same absence rule as `pending`).
   */
  readonly rerun?: ContextSummaryRerun;
}

/** Minimal structural graph view for counting — content is never read. */
interface GraphLike {
  readonly nodes?: ReadonlyArray<{ readonly kind?: unknown }>;
  readonly edges?: ReadonlyArray<unknown>;
}

/**
 * Reduce a graph to four integer counts. Returns null when no graph. Reads
 * only `kind` on nodes — never labels, values, or any content.
 */
export function summariseGraphCounts(
  graph: GraphLike | null | undefined,
): ContextSummaryGraphCounts | null {
  if (graph == null) return null;
  const nodes = graph.nodes ?? [];
  let options = 0;
  let goals = 0;
  for (const node of nodes) {
    // Optional chaining: a null/undefined element in the array must not crash
    // the count (graph content reaches here as permissive passthrough).
    if (node?.kind === 'option') options += 1;
    else if (node?.kind === 'goal') goals += 1;
  }
  return {
    nodes: nodes.length,
    edges: (graph.edges ?? []).length,
    options,
    goals,
  };
}

export interface BuildV5ContextSummaryInput {
  readonly canonicalState: CanonicalAnalysisState;
  readonly graphCounts?: ContextSummaryGraphCounts | null;
  readonly recentTurnCount?: number | null;
  readonly recentChangeCount?: number | null;
  readonly capabilitiesPresent?: boolean | null;
  /**
   * Opt-in for the redacted `coaching_state_pack` sub-block. The caller sets
   * this from `config.cee.coachingStatePackEnabled`; the module performs the
   * (pure) projection. When falsy, `coaching_state_pack` is OMITTED.
   */
  readonly includeCoachingState?: boolean;
  /**
   * Provenance of the supplied `canonicalState` (the route knows whether it
   * threaded the full turn-executor verdict or composed the partial fallback).
   * Surfaced verbatim as `canonical_state_source`; omitted from the output when
   * not provided.
   */
  readonly canonicalStateSource?: CanonicalStateSource;
}

/**
 * Build the redacted context summary. Pure. The caller gates on the flag
 * and supplies whatever fields it can observe at its seam; un-threaded
 * fields default to `null` (honest "not observed here", not zero/false).
 */
export function buildV5ContextSummary(
  input: BuildV5ContextSummaryInput,
): V5ContextSummary {
  return {
    version: V5_CONTEXT_SUMMARY_VERSION,
    analysis_state: summariseCanonicalAnalysisState(input.canonicalState),
    graph_counts: input.graphCounts ?? null,
    recent_turn_count: input.recentTurnCount ?? null,
    recent_change_count: input.recentChangeCount ?? null,
    capabilities_present: input.capabilitiesPresent ?? null,
    // Provenance of the verdict (full turn-executor vs partial route fallback);
    // omitted when the caller does not thread it.
    ...(input.canonicalStateSource
      ? { canonical_state_source: input.canonicalStateSource }
      : {}),
    // Diagnostic-only, double-gated: only present when the caller opts in
    // (route requires BOTH contextSummaryEnabled + coachingStatePackEnabled).
    ...(input.includeCoachingState
      ? { coaching_state_pack: summariseCoachingStatePack(input.canonicalState) }
      : {}),
  };
}
