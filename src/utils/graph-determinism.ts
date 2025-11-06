/**
 * Graph determinism utilities for stable edge IDs and consistent ordering.
 *
 * Ensures that graphs are deterministic across multiple runs:
 * - Stable edge IDs using pattern: ${from}::${to}::${index}
 * - Consistent sorting: nodes by id asc, edges by from→to→id asc
 */

import type { GraphT, NodeT, EdgeT } from "../schemas/graph.js";

/**
 * Enforce stable edge IDs for edges missing IDs.
 *
 * For each edge without an id, assigns: ${from}::${to}::${index}
 * where index is 0-based per unique from→to pair.
 *
 * Also sorts nodes and edges deterministically:
 * - Nodes: by id ascending
 * - Edges: by from ascending, then to ascending, then id ascending
 *
 * @param graph - The graph to process (will be mutated)
 * @returns The same graph with stable IDs and sorted nodes/edges
 */
export function enforceStableEdgeIds(graph: GraphT): GraphT {
  // Track edge counts per from→to pair for index generation
  const edgeIndexMap = new Map<string, number>();

  // First pass: assign missing edge IDs
  for (const edge of graph.edges) {
    if (!edge.id) {
      const key = `${edge.from}::${edge.to}`;
      const index = edgeIndexMap.get(key) || 0;
      edge.id = `${edge.from}::${edge.to}::${index}`;
      edgeIndexMap.set(key, index + 1);
    }
  }

  // Sort nodes by id (ascending, alphabetically)
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));

  // Sort edges by from → to → id (all ascending)
  graph.edges.sort((a, b) => {
    // First by from
    const fromCompare = a.from.localeCompare(b.from);
    if (fromCompare !== 0) return fromCompare;

    // Then by to
    const toCompare = a.to.localeCompare(b.to);
    if (toCompare !== 0) return toCompare;

    // Finally by id
    return (a.id || '').localeCompare(b.id || '');
  });

  return graph;
}

/**
 * Check if a graph has stable, deterministic edge IDs.
 *
 * @param graph - The graph to check
 * @returns True if all edges have IDs matching the stable pattern
 */
export function hasStableEdgeIds(graph: GraphT): boolean {
  const edgeIndexMap = new Map<string, number>();

  for (const edge of graph.edges) {
    if (!edge.id) return false;

    const key = `${edge.from}::${edge.to}`;
    const index = edgeIndexMap.get(key) || 0;
    const expectedId = `${edge.from}::${edge.to}::${index}`;

    // If ID doesn't match expected pattern, it's not stable
    if (edge.id !== expectedId) return false;

    edgeIndexMap.set(key, index + 1);
  }

  return true;
}

/**
 * Verify that nodes and edges are sorted deterministically.
 *
 * @param graph - The graph to check
 * @returns True if nodes and edges are in sorted order
 */
export function isSorted(graph: GraphT): boolean {
  // Check nodes are sorted by id
  for (let i = 1; i < graph.nodes.length; i++) {
    if (graph.nodes[i - 1].id.localeCompare(graph.nodes[i].id) > 0) {
      return false;
    }
  }

  // Check edges are sorted by from → to → id
  for (let i = 1; i < graph.edges.length; i++) {
    const prev = graph.edges[i - 1];
    const curr = graph.edges[i];

    const fromCompare = prev.from.localeCompare(curr.from);
    if (fromCompare > 0) return false;
    if (fromCompare === 0) {
      const toCompare = prev.to.localeCompare(curr.to);
      if (toCompare > 0) return false;
      if (toCompare === 0) {
        const idCompare = (prev.id || '').localeCompare(curr.id || '');
        if (idCompare > 0) return false;
      }
    }
  }

  return true;
}
