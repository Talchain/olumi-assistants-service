import type { GraphT } from "../schemas/graph.js";
import { enforceGraphCompliance } from "../utils/graphGuards.js";

/**
 * Stabilise graph by enforcing v04 compliance
 * Uses comprehensive guards: IDs, sorting, DAG, pruning, meta
 */
export function stabiliseGraph(g: GraphT): GraphT {
  return enforceGraphCompliance(g, {
    maxNodes: 12,
    maxEdges: 24,
  });
}

/**
 * Ensure DAG and prune isolated nodes
 * Now handled by enforceGraphCompliance
 */
export function ensureDagAndPrune(g: GraphT): GraphT {
  return stabiliseGraph(g);
}
