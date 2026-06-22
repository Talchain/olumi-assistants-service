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
} from './canonical-analysis-state.js';
import { summariseCanonicalAnalysisState } from './canonical-analysis-state.js';

export const V5_CONTEXT_SUMMARY_VERSION = '1.0.0';

/** Integer counts of the analysis-relevant graph entities. No content. */
export interface ContextSummaryGraphCounts {
  readonly nodes: number;
  readonly edges: number;
  readonly options: number;
  readonly goals: number;
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
    if (node.kind === 'option') options += 1;
    else if (node.kind === 'goal') goals += 1;
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
  };
}
