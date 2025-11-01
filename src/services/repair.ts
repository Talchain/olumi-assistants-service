import type { GraphT } from "../schemas/graph.js";

// Placeholder: simple repair that trims counts to caps.
export function simpleRepair(g: GraphT): GraphT {
  const nodes = g.nodes.slice(0, 12);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = g.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .slice(0, 24)
    .map((edge, idx) => ({ ...edge, id: edge.id || `${edge.from}::${edge.to}::${idx}` }))
    .sort((a, b) => a.id!.localeCompare(b.id!));
  return { ...g, nodes, edges };
}
