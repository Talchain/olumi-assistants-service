/**
 * V5 state-trust — internal turn-outcome contract.
 *
 * Computed by turn-executor after handler dispatch and used by:
 *   - response composition (drives analysis_ready freshness wire fields,
 *     drives the "Rerun analysis" chip when analysis is stale)
 *   - the analysis_freshness.derived telemetry event
 *   - future invariant checks ("if previous turn fresh and graph not
 *     mutated, current must remain fresh")
 *
 * NOT exposed on the wire. Wire consumers read freshness via the
 * additive analysis_ready.* fields — never import TurnOutcome.
 */

import type { AnalysisFreshness, FreshnessReason } from './context/freshness.js';

/**
 * Per-turn outcome contract.
 *
 * `graph_mutated` is true when a graph-mutating handler dispatched on
 * this turn (draft_graph / edit_graph), regardless of whether the
 * proposed mutation was accepted by the user. The actual graph-state
 * change becomes observable on the NEXT turn via the freshness
 * derivation comparing hashes — that's where invalidation lives.
 *
 * `analysis_run` is true only when run_analysis dispatched and produced
 * a non-noop fact (i.e. a fresh analysis was just computed).
 *
 * `analysis_selected_fact_index` is the position-in-array of the fact
 * the freshness derivation selected (newest-first per loader). Null
 * when no successful fact was selected. Used as a stable identifier
 * inside a single turn's telemetry.
 */
export interface TurnOutcome {
  readonly graph_mutated: boolean;
  readonly analysis_run: boolean;
  readonly analysis_selected_fact_index: number | null;
  readonly analysis_freshness: AnalysisFreshness;
  readonly freshness_reason: FreshnessReason;
}
