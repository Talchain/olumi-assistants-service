/**
 * Validation Pipeline — Topology Utilities
 *
 * Computes topological distances from each node to the goal node.
 * Used by the comparison module to populate ValidationMetadata.distance_to_goal,
 * which drives calibration tray ordering (closer to goal = higher priority).
 *
 * BFS traversal follows directed edges in reverse (target → source), starting
 * from the goal node, so distance reflects causal hops from node to goal.
 */

import { VALIDATION_CONSTANTS } from './constants.js';

const { UNREACHABLE_DISTANCE } = VALIDATION_CONSTANTS;

// ============================================================================
// Types (kept minimal — only what is needed from the pipeline)
// ============================================================================

/** Minimal edge shape needed for distance computation. */
interface GraphEdge {
  from: string;
  to: string;
  /** Only directed edges are traversed; bidirected confounders are excluded. */
  edge_type?: string;
}

// ============================================================================
// Distance computation
// ============================================================================

/**
 * Computes the topological distance (in hops) from every node's
 * outgoing-edge target to the goal node, using reverse-BFS.
 *
 * Returns a Map<nodeId, hops> where:
 * - The goal node itself has distance 0.
 * - A node with a direct edge to goal has distance 1.
 * - Unreachable nodes have distance Infinity.
 *
 * The edge's distance_to_goal is the distance of its *to* node.
 *
 * Bidirected edges (edge_type === 'bidirected') are excluded, matching the
 * precedent set by assignLayers() in src/utils/graphGuards.ts.
 */
export function computeDistancesToGoal(
  nodeIds: string[],
  edges: GraphEdge[],
  goalNodeId: string,
): Map<string, number> {
  // Initialise all nodes as unreachable.
  const distances = new Map<string, number>(
    nodeIds.map((id) => [id, Infinity]),
  );

  // Ensure the goal node is included even if absent from nodeIds.
  distances.set(goalNodeId, 0);

  // Build a reverse adjacency list: target → [sources].
  // This lets us BFS "backwards" from the goal node.
  const reverseAdj = new Map<string, string[]>();
  for (const edge of edges) {
    // Skip bidirected confounders — they are not causal paths.
    if (edge.edge_type === 'bidirected') continue;

    if (!reverseAdj.has(edge.to)) {
      reverseAdj.set(edge.to, []);
    }
    reverseAdj.get(edge.to)!.push(edge.from);
  }

  // BFS from goal, propagating backwards through the graph.
  const queue: string[] = [goalNodeId];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = distances.get(current) ?? Infinity;

    const parents = reverseAdj.get(current) ?? [];
    for (const parent of parents) {
      const existing = distances.get(parent) ?? Infinity;
      const newDist = currentDist + 1;
      if (newDist < existing) {
        distances.set(parent, newDist);
        queue.push(parent);
      }
    }
  }

  return distances;
}

/**
 * Returns the distance-to-goal for a specific edge.
 * The edge's distance is the distance of its *to* (target) node.
 * Falls back to UNREACHABLE_DISTANCE if the target node is unreachable.
 *
 * Uses a finite sentinel (999) instead of Infinity because
 * JSON.stringify(Infinity) → null, which would corrupt the response payload.
 */
export function edgeDistanceToGoal(
  distances: Map<string, number>,
  edgeTo: string,
): number {
  const dist = distances.get(edgeTo) ?? Infinity;
  return Number.isFinite(dist) ? dist : UNREACHABLE_DISTANCE;
}
