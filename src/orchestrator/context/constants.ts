/**
 * Shared constants for orchestrator context management.
 *
 * Centralised here to prevent drift when multiple modules need the same value.
 */

/**
 * Default value for exists_probability when the field is absent from a graph edge.
 * Matches the PLoT server default.
 */
export const DEFAULT_EXISTS_PROBABILITY = 0.8;
