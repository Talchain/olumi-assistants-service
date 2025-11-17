/**
 * Global graph caps configuration.
 *
 * Centralizes node/edge limits so that schemas, guards, adapters,
 * share limits, and the /v1/limits endpoint stay in sync.
 *
 * Defaults:
 * - 50 nodes
 * - 200 edges
 *
 * Can be overridden via GRAPH_MAX_NODES / GRAPH_MAX_EDGES env vars.
 */

const DEFAULT_MAX_NODES = 50;
const DEFAULT_MAX_EDGES = 200;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveCap(
  primary: string | undefined,
  secondary: string | undefined,
  fallback: number
): number {
  // Primary env (LIMIT_MAX_*) takes precedence, then legacy GRAPH_MAX_*, then default.
  const primaryParsed = parsePositiveInt(primary, NaN);
  if (Number.isFinite(primaryParsed)) {
    return primaryParsed;
  }

  const secondaryParsed = parsePositiveInt(secondary, NaN);
  if (Number.isFinite(secondaryParsed)) {
    return secondaryParsed;
  }

  return fallback;
}

export const GRAPH_MAX_NODES = resolveCap(
  process.env.LIMIT_MAX_NODES,
  process.env.GRAPH_MAX_NODES,
  DEFAULT_MAX_NODES
);

export const GRAPH_MAX_EDGES = resolveCap(
  process.env.LIMIT_MAX_EDGES,
  process.env.GRAPH_MAX_EDGES,
  DEFAULT_MAX_EDGES
);
