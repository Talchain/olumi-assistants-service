import type { GraphT } from "../schemas/graph.js";
import { log } from "../utils/telemetry.js";

/**
 * Allowed edge patterns (closed-world).
 * These match the v4 prompt EDGE_TABLE.
 */
const ALLOWED_EDGE_PATTERNS: Array<{ from: string; to: string }> = [
  { from: "decision", to: "option" },
  { from: "option", to: "factor" },
  { from: "factor", to: "outcome" },
  { from: "factor", to: "risk" },
  { from: "factor", to: "factor" },
  { from: "outcome", to: "goal" },
  { from: "risk", to: "goal" },
];

/**
 * Check if an edge pattern is allowed.
 */
function isEdgeAllowed(fromKind: string, toKind: string): boolean {
  return ALLOWED_EDGE_PATTERNS.some(
    (p) => p.from === fromKind && p.to === toKind
  );
}

/**
 * Simple repair that trims counts to caps and filters prohibited edges.
 * Emits telemetry when edges are dropped for monitoring.
 */
export function simpleRepair(g: GraphT): GraphT {
  const nodes = g.nodes.slice(0, 12);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeKindMap = new Map(nodes.map((node) => [node.id, node.kind]));

  // Track dropped edges for telemetry
  const droppedEdges: Array<{ from: string; to: string; fromKind: string; toKind: string; reason: string }> = [];

  const validEdges = g.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  const edges = validEdges
    // Filter out prohibited edge patterns (closed-world validation)
    .filter((edge) => {
      const fromKind = nodeKindMap.get(edge.from);
      const toKind = nodeKindMap.get(edge.to);
      if (!fromKind || !toKind) {
        droppedEdges.push({ from: edge.from, to: edge.to, fromKind: fromKind || "unknown", toKind: toKind || "unknown", reason: "missing_node_kind" });
        return false;
      }
      if (!isEdgeAllowed(fromKind, toKind)) {
        droppedEdges.push({ from: edge.from, to: edge.to, fromKind, toKind, reason: "closed_world_violation" });
        return false;
      }
      return true;
    })
    .slice(0, 24)
    .map((edge, idx) => ({ ...edge, id: edge.id || `${edge.from}::${edge.to}::${idx}` }))
    .sort((a, b) => a.id!.localeCompare(b.id!));

  // Emit telemetry if edges were dropped
  if (droppedEdges.length > 0) {
    log.info({
      event: "cee.simple_repair.edges_dropped",
      dropped_count: droppedEdges.length,
      original_edge_count: g.edges.length,
      final_edge_count: edges.length,
      dropped_patterns: droppedEdges.map((e) => `${e.fromKind}→${e.toKind}`),
      dropped_edges: droppedEdges,
    }, "simpleRepair dropped prohibited edges");
  }

  return { ...g, nodes, edges };
}
