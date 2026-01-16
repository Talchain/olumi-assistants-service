import type { GraphT } from "../schemas/graph.js";
import { enforceGraphCompliance } from "../utils/graphGuards.js";
import type { CorrectionCollector } from "../cee/corrections.js";

export interface StabiliseOptions {
  collector?: CorrectionCollector;
}

/**
 * Stabilise graph by enforcing v04 compliance
 * Uses comprehensive guards: IDs, sorting, DAG, pruning, meta
 *
 * Graph size limits:
 * - 20 nodes allows: 1 goal + 1 decision + 5 options + 8 outcomes + 5 factors
 * - 40 edges allows: dense connectivity between nodes
 * These limits balance model richness with UI/performance constraints.
 */
export function stabiliseGraph(g: GraphT, opts?: StabiliseOptions): GraphT {
  return enforceGraphCompliance(g, {
    maxNodes: 20,
    maxEdges: 40,
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
