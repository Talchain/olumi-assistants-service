import type { GraphT } from "../schemas/graph.js";
import { enforceGraphCompliance } from "../utils/graphGuards.js";
import type { CorrectionCollector } from "../cee/corrections.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../config/graphCaps.js";

export interface StabiliseOptions {
  collector?: CorrectionCollector;
}

/**
 * Stabilise graph by enforcing compliance with v2.6 schema limits.
 * Uses comprehensive guards: IDs, sorting, DAG, pruning, meta.
 *
 * Graph size limits are sourced from graphCaps.ts (default: 50 nodes, 200 edges)
 * and can be overridden via LIMIT_MAX_NODES/LIMIT_MAX_EDGES environment variables.
 */
export function stabiliseGraph(g: GraphT, opts?: StabiliseOptions): GraphT {
  return enforceGraphCompliance(g, {
    maxNodes: GRAPH_MAX_NODES,
    maxEdges: GRAPH_MAX_EDGES,
    collector: opts?.collector,
  });
}

/**
 * Ensure DAG and prune isolated nodes
 * Now handled by enforceGraphCompliance
 */
export function ensureDagAndPrune(g: GraphT, opts?: StabiliseOptions): GraphT {
  return stabiliseGraph(g, opts);
}
