/**
 * Global graph caps configuration.
 *
 * Centralizes node/edge limits so that schemas, guards, adapters,
 * share limits, and the /v1/limits endpoint stay in sync.
 *
 * Platform defaults from @talchain/schemas: MAX_NODES=50, MAX_EDGES=100.
 * CEE defaults now match PLoT canonical limits (Decision Model Schema v2.8 D.1).
 * CEE should never produce graphs PLoT will reject.
 *
 * Can be overridden via GRAPH_MAX_NODES / GRAPH_MAX_EDGES env vars.
 */

import { LIMITS as PLATFORM_LIMITS } from "@talchain/schemas";

// CEE defaults: both match PLoT canonical limits (Decision Model Schema v2.8 D.1).
// CEE should never produce graphs PLoT will reject.
const DEFAULT_MAX_NODES = PLATFORM_LIMITS.MAX_NODES; // 50 — matches platform
const DEFAULT_MAX_EDGES = 100; // Aligned with PLoT canonical limit (Decision Model Schema v2.8 D.1)

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
