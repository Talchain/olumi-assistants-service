/**
 * Shared analysis_ready computation from graph structure.
 *
 * Single source of truth for computing GraphPatchBlockData.analysis_ready
 * from a GraphV3T. Used by both draft_graph (fallback) and edit_graph
 * (primary) to avoid implementation drift.
 *
 * Lighter than the full pipeline in src/cee/transforms/analysis-ready.ts —
 * checks structural readiness from graph nodes only, not pipeline context.
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { GraphPatchBlockData } from "../types.js";

// ============================================================================
// Types
// ============================================================================

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

// ============================================================================
// Readiness Computation
// ============================================================================

/**
 * Compute structural analysis readiness from a graph.
 *
 * Returns undefined if no goal node exists (cannot determine readiness).
 *
 * Status logic (mirrors src/cee/transforms/analysis-ready.ts):
 * - "ready": all options have at least one numeric intervention
 * - "needs_user_mapping": some options lack numeric interventions
 * - "needs_user_input": fewer than 2 options
 */
export function computeStructuralReadiness(
  graph: GraphV3T,
): AnalysisReadyPayload | undefined {
  const goalNode = graph.nodes.find((n) => n.kind === 'goal');
  if (!goalNode) return undefined;

  const optionNodes = graph.nodes.filter((n) => n.kind === 'option');

  // Build edge map from options to factors for intervention lookup
  const optionToFactors = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    // Edges from option nodes to factor/goal nodes represent interventions
    const sourceNode = graph.nodes.find((n) => n.id === edge.from);
    if (sourceNode?.kind === 'option') {
      if (!optionToFactors.has(edge.from)) {
        optionToFactors.set(edge.from, new Set());
      }
      optionToFactors.get(edge.from)!.add(edge.to);
    }
  }

  const options: AnalysisReadyPayload['options'] = [];

  for (const opt of optionNodes) {
    // Check for interventions via passthrough fields on the node
    const nodeAny = opt as Record<string, unknown>;
    const interventions = nodeAny.interventions as Record<string, number> | undefined;
    const connectedFactors = optionToFactors.get(opt.id) ?? new Set<string>();

    // Option is ready if it has numeric interventions or connected factors
    const hasNumericInterventions = interventions != null
      && Object.keys(interventions).length > 0
      && Object.values(interventions).every((v) => typeof v === 'number');

    let status: string;
    if (hasNumericInterventions) {
      status = 'ready';
    } else if (connectedFactors.size > 0) {
      // Connected but no encoded interventions yet
      status = 'needs_encoding';
    } else {
      status = 'needs_user_mapping';
    }

    options.push({
      option_id: opt.id,
      label: opt.label,
      status,
      interventions: interventions ?? {},
    });
  }

  // Determine overall status
  let payloadStatus: string;
  if (options.length < 2) {
    payloadStatus = 'needs_user_input';
  } else if (options.some((o) => o.status === 'needs_user_mapping')) {
    payloadStatus = 'needs_user_mapping';
  } else if (options.some((o) => o.status === 'needs_encoding')) {
    payloadStatus = 'needs_encoding';
  } else {
    payloadStatus = 'ready';
  }

  return {
    options,
    goal_node_id: goalNode.id,
    status: payloadStatus,
    ...(goalNode.goal_threshold != null && { goal_threshold: goalNode.goal_threshold }),
  };
}
