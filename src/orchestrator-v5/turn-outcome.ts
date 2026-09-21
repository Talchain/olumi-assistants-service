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
 * `graph_mutated` is true when this turn produced a graph mutation —
 * either because a D1 mutation handler (set_factor_value,
 * add_constraint, adjust_edge_strength, plus any future addition)
 * emitted `mutated_graph` on its outcome, OR because the system-layer
 * draft_graph / edit_graph path was dispatched (those go through a
 * different invocation path that doesn't surface a HandlerOutcome).
 * The actual graph-state change becomes observable on the NEXT turn
 * via the freshness derivation comparing hashes — that's where
 * invalidation lives.
 *
 * `analysis_run` is true only when run_analysis dispatched and produced
 * a non-noop fact (i.e. a fresh analysis was just computed).
 *
 * `analysis_selected_fact_index` is the position-in-array of the fact
 * the freshness derivation selected (newest-first per loader). Null
 * when no successful fact was selected.
 *
 * Note: the brief specified `analysis_selected_fact_id` (a stable row
 * id). Index is used today as a pragmatic substitute because
 * `@talchain/schemas`' `HandlerFact` type does not surface a row id —
 * the session store reads facts via `v5_handler_facts.id` (FK to
 * `v5_conversation_turns.id`) but discards the id when materialising
 * the JSON. Index is deterministic within a single turn (the only
 * scope that consumes it). Plumbing a real id requires extending the
 * session-store `readFactsFor` signature; tracked as a follow-up.
 */
export interface TurnOutcome {
  readonly graph_mutated: boolean;
  readonly analysis_run: boolean;
  readonly analysis_selected_fact_index: number | null;
  readonly analysis_freshness: AnalysisFreshness;
  readonly freshness_reason: FreshnessReason;
}
