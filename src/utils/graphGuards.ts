/**
 * Graph Guards - Spec v04 Compliance Enforcement
 *
 * Ensures all graph outputs meet v04 requirements:
 * - Stable edge IDs: ${from}::${to}::${index}
 * - Deterministic sorting: nodes by id asc, edges by (from, to, id) asc
 * - DAG enforcement (no cycles)
 * - Prune isolated nodes
 * - Include version, default_seed, meta fields
 */

import type { GraphT, NodeT, EdgeT } from "../schemas/graph.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../config/graphCaps.js";
import { log } from "./telemetry.js";

/**
 * Normalize edge IDs to stable format: ${from}::${to}::${index}
 */
export function normalizeEdgeIds(edges: EdgeT[]): EdgeT[] {
  // Group edges by from->to pair
  const edgeGroups = new Map<string, EdgeT[]>();

  for (const edge of edges) {
    const key = `${edge.from}::${edge.to}`;
    if (!edgeGroups.has(key)) {
      edgeGroups.set(key, []);
    }
    edgeGroups.get(key)!.push(edge);
  }

  // Assign stable IDs within each group
  const normalized: EdgeT[] = [];
  for (const [_key, group] of edgeGroups) {
    group.forEach((edge, idx) => {
      normalized.push({
        ...edge,
        id: `${edge.from}::${edge.to}::${idx}`,
      });
    });
  }

  return normalized;
}

/**
 * Sort nodes by id (ascending)
 */
export function sortNodes(nodes: NodeT[]): NodeT[] {
  return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Sort edges by (from, to, id) triple (ascending)
 */
export function sortEdges(edges: EdgeT[]): EdgeT[] {
  return [...edges].sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) return fromCmp;

    const toCmp = a.to.localeCompare(b.to);
    if (toCmp !== 0) return toCmp;

    return (a.id || "").localeCompare(b.id || "");
  });
}

/**
 * Detect cycles in graph using DFS
 * Returns array of cycle paths if found
 */
export function detectCycles(nodes: NodeT[], edges: EdgeT[]): string[][] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const adjList = new Map<string, string[]>();

  // Build adjacency list
  for (const node of nodes) {
    adjList.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue; // Skip invalid edges
    }
    adjList.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = adjList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStart), neighbor]);
      }
    }

    recStack.delete(node);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return cycles;
}

/**
 * Check if graph is a DAG (no cycles)
 */
export function isDAG(nodes: NodeT[], edges: EdgeT[]): boolean {
  return detectCycles(nodes, edges).length === 0;
}

/**
 * Remove cycles by breaking edges
 * Strategy: Remove the last edge in each cycle
 *
 * For dense graphs with multiple edges between same nodes,
 * only remove the specific offending edge ID, not all edges for the pair.
 */
export function breakCycles(nodes: NodeT[], edges: EdgeT[]): EdgeT[] {
  const cycles = detectCycles(nodes, edges);
  if (cycles.length === 0) return edges;

  const edgeIdsToRemove = new Set<string>();

  for (const cycle of cycles) {
    // Identify the from::to pair to break (last edge in cycle)
    if (cycle.length >= 2) {
      const from = cycle[cycle.length - 2];
      const to = cycle[cycle.length - 1];

      // Find all edges with this from::to pair
      const matchingEdges = edges.filter(e => e.from === from && e.to === to);

      // Remove only the first edge (by ID sort order) to be deterministic
      if (matchingEdges.length > 0) {
        matchingEdges.sort((a, b) => (a.id || "").localeCompare(b.id || ""));
        const edgeToRemove = matchingEdges[0];
        edgeIdsToRemove.add(edgeToRemove.id || `${from}::${to}::0`);
      }
    }
  }

  const filtered = edges.filter(e => {
    const edgeId = e.id || `${e.from}::${e.to}::0`;
    return !edgeIdsToRemove.has(edgeId);
  });

  log.warn({
    cycles_detected: cycles.length,
    edges_removed: edgeIdsToRemove.size,
    cycles: cycles.map(c => c.join(" -> ")),
    removed_edge_ids: Array.from(edgeIdsToRemove)
  }, "Removed specific edge IDs to break cycles");

  return filtered;
}

/**
 * Find isolated nodes (no incoming or outgoing edges)
 */
export function findIsolatedNodes(nodes: NodeT[], edges: EdgeT[]): string[] {
  const connected = new Set<string>();

  for (const edge of edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }

  return nodes
    .filter(n => !connected.has(n.id))
    .map(n => n.id);
}

/**
 * Node kinds that should never be pruned, even if isolated.
 * Goals and decisions are essential structural nodes that must be preserved.
 */
const PROTECTED_KINDS = new Set(["goal", "decision"]);

/**
 * Prune isolated nodes from graph.
 * Protected kinds (goal, decision) are never pruned regardless of connectivity.
 */
export function pruneIsolatedNodes(nodes: NodeT[], edges: EdgeT[]): NodeT[] {
  // Don't prune if there's only one node (isolated single nodes are still valid graphs)
  if (nodes.length <= 1) {
    return nodes;
  }

  const isolated = new Set(findIsolatedNodes(nodes, edges));

  if (isolated.size === 0) {
    return nodes;
  }

  // Filter out protected kinds from pruning candidates
  const nodesToPrune = new Set<string>();
  const protectedButIsolated: string[] = [];

  for (const nodeId of isolated) {
    const node = nodes.find(n => n.id === nodeId);
    const kind = (node as any)?.kind?.toLowerCase?.() ?? "";

    if (PROTECTED_KINDS.has(kind)) {
      protectedButIsolated.push(nodeId);
    } else {
      nodesToPrune.add(nodeId);
    }
  }

  if (nodesToPrune.size > 0 || protectedButIsolated.length > 0) {
    log.info({
      isolated_count: isolated.size,
      isolated_ids: Array.from(isolated),
      pruned_count: nodesToPrune.size,
      pruned_ids: Array.from(nodesToPrune),
      protected_count: protectedButIsolated.length,
      protected_ids: protectedButIsolated,
    }, "Pruning isolated nodes (goal/decision protected)");
  }

  return nodes.filter(n => !nodesToPrune.has(n.id));
}

/**
 * Calculate graph metadata (roots, leaves, suggested positions)
 */
export function calculateMeta(nodes: NodeT[], edges: EdgeT[]): {
  roots: string[];
  leaves: string[];
  suggested_positions: Record<string, { x: number; y: number }>;
} {
  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();

  for (const edge of edges) {
    hasIncoming.add(edge.to);
    hasOutgoing.add(edge.from);
  }

  // Roots: nodes with no incoming edges
  const roots = nodes
    .filter(n => !hasIncoming.has(n.id))
    .map(n => n.id)
    .sort();

  // Leaves: nodes with no outgoing edges
  const leaves = nodes
    .filter(n => !hasOutgoing.has(n.id))
    .map(n => n.id)
    .sort();

  // Simple layered layout
  const positions: Record<string, { x: number; y: number }> = {};
  const layers = assignLayers(nodes, edges);

  layers.forEach((layer, layerIdx) => {
    layer.forEach((nodeId, nodeIdx) => {
      const x = 400 + (nodeIdx - layer.length / 2) * 150;
      const y = 100 + layerIdx * 150;
      positions[nodeId] = { x, y };
    });
  });

  return { roots, leaves, suggested_positions: positions };
}

/**
 * Assign nodes to layers for layout
 */
function assignLayers(nodes: NodeT[], edges: EdgeT[]): string[][] {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const node of nodes) {
    adjList.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  // Build adjacency list and in-degrees
  for (const edge of edges) {
    adjList.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  // Topological sort by layers
  const layers: string[][] = [];
  let currentLayer = nodes
    .filter(n => inDegree.get(n.id) === 0)
    .map(n => n.id);

  while (currentLayer.length > 0) {
    layers.push([...currentLayer].sort());

    const nextLayer = new Set<string>();
    for (const nodeId of currentLayer) {
      for (const neighbor of adjList.get(nodeId) || []) {
        const newInDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newInDegree);
        if (newInDegree === 0) {
          nextLayer.add(neighbor);
        }
      }
    }
    currentLayer = Array.from(nextLayer);
  }

  return layers;
}

/**
 * Apply all graph guards to ensure v04 compliance
 */
export function enforceGraphCompliance(
  graph: GraphT,
  options: {
    maxNodes?: number;
    maxEdges?: number;
  } = {}
): GraphT {
  const { maxNodes = GRAPH_MAX_NODES, maxEdges = GRAPH_MAX_EDGES } = options;

  let { nodes, edges } = graph;

  // Observability guard: log and return early for empty graphs.
  // Upstream callers (CEE pipeline and routes) are responsible for enforcing
  // hard invariants such as rejecting empty or structurally invalid graphs.
  if (!Array.isArray(nodes) || nodes.length === 0) {
    log.warn({ nodes: nodes?.length ?? 0, edges: edges?.length ?? 0 }, "enforceGraphCompliance called with empty graph; returning as-is");
    return graph;
  }

  // 1. Cap counts
  if (nodes.length > maxNodes) {
    log.warn({ count: nodes.length, max: maxNodes }, "Capping node count");
    nodes = nodes.slice(0, maxNodes);
  }

  if (edges.length > maxEdges) {
    log.warn({ count: edges.length, max: maxEdges }, "Capping edge count");
    edges = edges.slice(0, maxEdges);
  }

  // 2. Filter edges to valid node IDs
  const nodeIds = new Set(nodes.map(n => n.id));
  edges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

  // 3. Break cycles to enforce DAG
  if (!isDAG(nodes, edges)) {
    edges = breakCycles(nodes, edges);
  }

  // 4. Prune isolated nodes
  nodes = pruneIsolatedNodes(nodes, edges);

  // 5. Normalize edge IDs
  edges = normalizeEdgeIds(edges);

  // 6. Sort deterministically
  nodes = sortNodes(nodes);
  edges = sortEdges(edges);

  // 7. Calculate metadata
  const meta = calculateMeta(nodes, edges);

  return {
    ...graph,
    nodes,
    edges,
    meta: {
      ...graph.meta,
      ...meta,
    },
  };
}
