/**
 * Deterministic Graph Layout Engine
 *
 * Generates consistent, topology-aware node positions for decision graphs.
 *
 * Algorithm:
 * - Layer Assignment: Topological sort + longest path from roots
 * - Horizontal Positioning: Alphabetical sort within layers for determinism
 * - Spacing: Fixed vertical/horizontal gaps to prevent overlaps
 *
 * Characteristics:
 * - Deterministic: Same graph structure always produces same layout
 * - Topology-Aware: Respects parent-child relationships (edges)
 * - Hierarchical: Layers flow from roots to leaves
 * - Cycle-Resistant: Falls back gracefully for graphs with cycles
 *
 * Usage:
 * ```typescript
 * const positions = generateDeterministicLayout(nodes, edges, roots);
 * graph.meta.suggested_positions = positions;
 * ```
 */

import type { NodeT, EdgeT } from "../schemas/graph.js";

export interface Position {
  x: number;
  y: number;
}

// Layout constants (tuned for typical decision graphs with 3-12 nodes)
const LAYER_HEIGHT = 150; // Vertical spacing between layers
const NODE_WIDTH = 180; // Horizontal spacing between nodes in same layer
const CANVAS_WIDTH = 800; // Total canvas width for centering
const START_Y = 80; // Top margin

/**
 * Generate deterministic layout for graph nodes
 *
 * @param nodes - Graph nodes to position
 * @param edges - Graph edges defining parent-child relationships
 * @param roots - Root node IDs (nodes with no incoming edges)
 * @returns Record mapping node IDs to {x, y} positions
 */
export function generateDeterministicLayout(
  nodes: NodeT[],
  edges: EdgeT[],
  roots: string[]
): Record<string, Position> {
  if (nodes.length === 0) {
    return {};
  }

  // Build adjacency list for efficient traversal
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize all nodes
  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  // Build graph structure
  for (const edge of edges) {
    const children = adjacency.get(edge.from);
    if (children) {
      children.push(edge.to);
    }
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  // Assign layers using modified BFS (longest path from any root)
  const layers = assignLayers(nodes, adjacency, inDegree, roots);

  // Position nodes within layers
  return positionLayers(layers);
}

/**
 * Assign each node to a layer based on longest path from roots
 * Uses topological sort to handle DAG structure
 */
function assignLayers(
  nodes: NodeT[],
  adjacency: Map<string, string[]>,
  inDegree: Map<string, number>,
  roots: string[]
): Map<number, string[]> {
  const layers = new Map<number, string[]>();
  const nodeLayer = new Map<string, number>();

  // Start with roots at layer 0
  const queue: Array<{ id: string; layer: number }> = [];

  // Use provided roots, or find nodes with in-degree 0
  const effectiveRoots = roots.length > 0
    ? roots
    : nodes.filter(n => (inDegree.get(n.id) || 0) === 0).map(n => n.id);

  for (const rootId of effectiveRoots) {
    queue.push({ id: rootId, layer: 0 });
    nodeLayer.set(rootId, 0);
  }

  // BFS to assign layers (longest path determines final layer)
  const visited = new Set<string>();
  while (queue.length > 0) {
    const { id, layer } = queue.shift()!;

    // Update layer if we found a longer path
    const currentLayer = nodeLayer.get(id) || 0;
    if (layer > currentLayer) {
      nodeLayer.set(id, layer);
    }

    // Process children (only once per node to avoid infinite loops)
    if (!visited.has(id)) {
      visited.add(id);
      const children = adjacency.get(id) || [];
      for (const childId of children) {
        const childLayer = Math.max(nodeLayer.get(childId) || 0, layer + 1);
        nodeLayer.set(childId, childLayer);
        queue.push({ id: childId, layer: childLayer });
      }
    }
  }

  // Handle disconnected nodes (assign to last layer + 1)
  const maxLayer = Math.max(0, ...Array.from(nodeLayer.values()));
  for (const node of nodes) {
    if (!nodeLayer.has(node.id)) {
      nodeLayer.set(node.id, maxLayer + 1);
    }
  }

  // Group nodes by layer
  for (const node of nodes) {
    const layer = nodeLayer.get(node.id) || 0;
    if (!layers.has(layer)) {
      layers.set(layer, []);
    }
    layers.get(layer)!.push(node.id);
  }

  // Sort nodes within each layer alphabetically for determinism
  for (const nodeIds of layers.values()) {
    nodeIds.sort((a, b) => a.localeCompare(b));
  }

  return layers;
}

/**
 * Position nodes within their assigned layers
 * Centers each layer horizontally and spaces layers vertically
 */
function positionLayers(layers: Map<number, string[]>): Record<string, Position> {
  const positions: Record<string, Position> = {};

  // Sort layer indices for consistent iteration
  const layerIndices = Array.from(layers.keys()).sort((a, b) => a - b);

  for (const layerIndex of layerIndices) {
    const nodeIds = layers.get(layerIndex)!;
    const y = START_Y + layerIndex * LAYER_HEIGHT;

    // Calculate total width needed for this layer
    const totalWidth = nodeIds.length * NODE_WIDTH;
    const startX = (CANVAS_WIDTH - totalWidth) / 2 + NODE_WIDTH / 2;

    // Position each node in the layer
    nodeIds.forEach((nodeId, i) => {
      positions[nodeId] = {
        x: startX + i * NODE_WIDTH,
        y: y,
      };
    });
  }

  return positions;
}

/**
 * Legacy layout function for backward compatibility
 * Uses simple kind-based positioning (non-topology-aware)
 *
 * @deprecated Use generateDeterministicLayout instead
 */
export function generateLegacyLayout(nodes: NodeT[]): Record<string, Position> {
  const positions: Record<string, Position> = {};

  // Simple layered layout by node kind
  const goals = nodes.filter((n) => n.kind === "goal");
  const decisions = nodes.filter((n) => n.kind === "decision");
  const options = nodes.filter((n) => n.kind === "option");
  const outcomes = nodes.filter((n) => n.kind === "outcome");
  const risks = nodes.filter((n) => n.kind === "risk");
  const actions = nodes.filter((n) => n.kind === "action");

  goals.forEach((n, i) => {
    positions[n.id] = { x: 400, y: 50 + i * 100 };
  });

  decisions.forEach((n, i) => {
    positions[n.id] = { x: 400, y: 200 + i * 100 };
  });

  options.forEach((n, i) => {
    positions[n.id] = { x: 200 + i * 200, y: 350 };
  });

  outcomes.forEach((n, i) => {
    positions[n.id] = { x: 200 + i * 200, y: 500 };
  });

  risks.forEach((n, i) => {
    positions[n.id] = { x: 100 + i * 150, y: 650 };
  });

  actions.forEach((n, i) => {
    positions[n.id] = { x: 100 + i * 150, y: 800 };
  });

  return positions;
}
