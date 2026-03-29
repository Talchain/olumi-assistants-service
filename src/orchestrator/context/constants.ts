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
