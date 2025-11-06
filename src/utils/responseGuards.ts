/**
 * Post-response guards for JSON↔SSE parity (v04 spec)
 *
 * Both JSON and SSE handlers MUST call these guards to ensure:
 * - Node/edge caps (≤12 nodes, ≤24 edges)
 * - cost_usd presence and numeric validation
 * - Cost cap enforcement against $COST_MAX_USD
 *
 * Guards return validation errors that should be surfaced to clients.
 */

import type { GraphT } from "../schemas/graph.js";

const MAX_NODES = 12;
const MAX_EDGES = 24;

export type GuardViolation = {
  code: "CAP_EXCEEDED" | "INVALID_COST";
  message: string;
  details?: unknown;
};

export type GuardResult =
  | { ok: true }
  | { ok: false; violation: GuardViolation };

/**
 * Validate graph against node/edge caps
 */
export function validateGraphCaps(graph: GraphT): GuardResult {
  if (graph.nodes.length > MAX_NODES) {
    return {
      ok: false,
      violation: {
        code: "CAP_EXCEEDED",
        message: `Graph exceeds maximum node count (${graph.nodes.length} > ${MAX_NODES})`,
        details: { nodes: graph.nodes.length, max_nodes: MAX_NODES },
      },
    };
  }

  if (graph.edges.length > MAX_EDGES) {
    return {
      ok: false,
      violation: {
        code: "CAP_EXCEEDED",
        message: `Graph exceeds maximum edge count (${graph.edges.length} > ${MAX_EDGES})`,
        details: { edges: graph.edges.length, max_edges: MAX_EDGES },
      },
    };
  }

  return { ok: true };
}

/**
 * Validate cost_usd field (must be present and numeric)
 */
export function validateCost(cost_usd: unknown): GuardResult {
  if (typeof cost_usd !== "number") {
    return {
      ok: false,
      violation: {
        code: "INVALID_COST",
        message: "cost_usd must be a number",
        details: { cost_usd, type: typeof cost_usd },
      },
    };
  }

  if (!Number.isFinite(cost_usd)) {
    return {
      ok: false,
      violation: {
        code: "INVALID_COST",
        message: "cost_usd must be finite",
        details: { cost_usd },
      },
    };
  }

  if (cost_usd < 0) {
    return {
      ok: false,
      violation: {
        code: "INVALID_COST",
        message: "cost_usd must be non-negative",
        details: { cost_usd },
      },
    };
  }

  return { ok: true };
}

/**
 * Validate cost against maximum allowed budget
 */
export function validateCostCap(cost_usd: number, maxCostUsd: number): GuardResult {
  if (cost_usd > maxCostUsd) {
    return {
      ok: false,
      violation: {
        code: "CAP_EXCEEDED",
        message: `Cost exceeds maximum allowed (${cost_usd.toFixed(4)} > ${maxCostUsd})`,
        details: { cost_usd, max_cost_usd: maxCostUsd },
      },
    };
  }

  return { ok: true };
}

/**
 * Run all post-response guards (parity requirement)
 * Both JSON and SSE handlers MUST call this function.
 */
export function validateResponse(
  graph: GraphT,
  cost_usd: unknown,
  maxCostUsd: number
): GuardResult {
  // Validate graph caps
  const capsResult = validateGraphCaps(graph);
  if (!capsResult.ok) return capsResult;

  // Validate cost presence and type
  const costResult = validateCost(cost_usd);
  if (!costResult.ok) return costResult;

  // Validate cost cap
  const costCapResult = validateCostCap(cost_usd as number, maxCostUsd);
  if (!costCapResult.ok) return costCapResult;

  return { ok: true };
}
