/**
 * Shared constants for orchestrator context management.
 *
 * Centralised here to prevent drift when multiple modules need the same value.
 */

/**
 * Default value for exists_probability when the field is absent from a graph edge.
 * Canonical source: @talchain/schemas limits.ts (matches PLoT server default).
 */
export { DEFAULT_EXISTS_PROBABILITY } from "@talchain/schemas";

/**
 * Canonical defaults for structural edges (decision→option, option→factor).
 *
 * These edges represent graph topology, not causal beliefs, so their strength
 * and existence probability are fixed at 1.0. Any handler that emits a
 * structural edge MUST import this constant rather than hand-rolling the values
 * — drift between handlers silently distorts analysis results.
 *
 * Consumed by:
 *   - edit_graph (enforceStructuralEdgeDefaults)
 *   - add_option action (new + repair-redirect paths)
 */
export const STRUCTURAL_EDGE_DEFAULTS = {
  exists_probability: 1.0,
  strength: { mean: 1.0, std: 0.01 },
  effect_direction: 'positive' as const,
};
