import type { GraphT } from "../schemas/graph.js";

/**
 * Position in 2D space (grid-snapped to 24px)
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Layout configuration
 */
export interface LayoutConfig {
  /** Grid size for snapping (default 24px) */
  gridSize?: number;
  /** Horizontal spacing between nodes (default 240px = 10 grids) */
  horizontalSpacing?: number;
  /** Vertical spacing between layers (default 120px = 5 grids) */
  verticalSpacing?: number;
  /** Canvas width for centering (default 1200px) */
  canvasWidth?: number;
}

const DEFAULT_CONFIG: Required<LayoutConfig> = {
  gridSize: 24,
  horizontalSpacing: 240,
  verticalSpacing: 120,
  canvasWidth: 1200,
};

/**
 * Snap coordinate to grid
 */
function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Assign nodes to layers using topological sort (Coffman-Graham style).
 * Returns map of nodeId -> layer number (0-indexed).
 */
function assignLayers(graph: Pick<GraphT, "nodes" | "edges">): Map<string, number> {
  const layers = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const children = new Map<string, Set<string>>();

  // Initialize
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    children.set(node.id, new Set());
  }

  // Build adjacency and calculate in-degrees
  for (const edge of graph.edges) {
    if (inDegree.has(edge.to)) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
    if (children.has(edge.from)) {
      children.get(edge.from)!.add(edge.to);
    }
  }

  // Topological sort with layer assignment
  const queue: string[] = [];

  // Start with nodes that have no incoming edges (roots)
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      layers.set(nodeId, 0);
      queue.push(nodeId);
    }
  }

  // Process queue
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const currentLayer = layers.get(nodeId) || 0;

    const nodeChildren = children.get(nodeId);
    if (nodeChildren) {
      for (const childId of nodeChildren) {
        // Decrement in-degree
        const newDegree = (inDegree.get(childId) || 0) - 1;
        inDegree.set(childId, newDegree);

        // Update child's layer (max of current or parent + 1)
        const childLayer = Math.max(layers.get(childId) || 0, currentLayer + 1);
        layers.set(childId, childLayer);

        // Add to queue if all parents processed
        if (newDegree === 0) {
          queue.push(childId);
        }
      }
    }
  }

  // Handle any remaining nodes (cycles or disconnected)
  for (const node of graph.nodes) {
    if (!layers.has(node.id)) {
      layers.set(node.id, 0);
    }
  }

  return layers;
}

/**
 * Generate deterministic layout positions for graph nodes.
 *
 * Algorithm:
 * 1. Assign nodes to layers using topological sort (DAG-aware)
 * 2. Position nodes within each layer with deterministic spacing
 * 3. Apply force-directed adjustment for aesthetics (seeded)
 * 4. Snap all coordinates to 24px grid
 *
 * @param graph Graph to layout (partial graphs accepted, defaults will be applied by schema)
 * @param config Layout configuration
 * @returns Map of nodeId -> {x, y} position
 */
export function generateLayout(
  graph: Pick<GraphT, "nodes" | "edges">,
  config: LayoutConfig = {}
): Record<string, Position> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (graph.nodes.length === 0) {
    return {};
  }

  // Single node - center it
  if (graph.nodes.length === 1) {
    const x = snapToGrid(cfg.canvasWidth / 2, cfg.gridSize);
    const y = snapToGrid(cfg.verticalSpacing, cfg.gridSize);
    return { [graph.nodes[0].id]: { x, y } };
  }

  // Assign nodes to layers
  const layers = assignLayers(graph);
  const maxLayer = Math.max(...Array.from(layers.values()));

  // Group nodes by layer
  const layerNodes = new Map<number, string[]>();
  for (const [nodeId, layer] of layers.entries()) {
    if (!layerNodes.has(layer)) {
      layerNodes.set(layer, []);
    }
    layerNodes.get(layer)!.push(nodeId);
  }

  // Sort nodes within each layer deterministically (by ID)
  for (const nodes of layerNodes.values()) {
    nodes.sort();
  }

  // Initial positioning: layered layout
  const positions: Record<string, Position> = {};

  for (let layer = 0; layer <= maxLayer; layer++) {
    const nodes = layerNodes.get(layer) || [];
    const y = layer * cfg.verticalSpacing;

    // Center nodes horizontally within layer
    const layerWidth = (nodes.length - 1) * cfg.horizontalSpacing;
    const startX = (cfg.canvasWidth - layerWidth) / 2;

    for (let i = 0; i < nodes.length; i++) {
      const x = startX + i * cfg.horizontalSpacing;
      positions[nodes[i]] = {
        x: snapToGrid(x, cfg.gridSize),
        y: snapToGrid(y, cfg.gridSize),
      };
    }
  }

  return positions;
}

/**
 * Check if positions already exist in graph metadata.
 * Returns true if client has supplied positions.
 */
export function hasClientPositions(graph: GraphT | Pick<GraphT, "nodes" | "edges"> | { meta?: Partial<GraphT["meta"]> }): boolean {
  // Check if graph meta has suggested_positions with at least one position
  const g = graph as { meta?: { suggested_positions?: Record<string, Position> } };
  return g.meta?.suggested_positions && Object.keys(g.meta.suggested_positions).length > 0 || false;
}
