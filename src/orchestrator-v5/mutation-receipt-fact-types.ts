import type { HandlerFact } from '@talchain/schemas/orchestrator';

/**
 * Canonical handler-fact types that carry an applied graph-mutation receipt.
 *
 * This dependency-leaf authority is shared by durable session reads and the
 * model-facing recent-change projector. Keep the semantic classification in
 * one place: adding a mutation fact type requires both a receipt projection
 * branch and the existing conformance coverage in `context/recent-changes`.
 */
export const MUTATION_RECEIPT_FACT_TYPES: ReadonlySet<HandlerFact['fact_type']> =
  new Set<HandlerFact['fact_type']>([
    'add_constraint',
    'set_factor_value',
    'adjust_edge_strength',
    'edit_graph',
  ]);
