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
 * Simple repair that trims counts to caps.
 *
 * IMPORTANT: Does NOT filter edges by closed-world rules to preserve graph connectivity.
 * Invalid edge patterns are logged for monitoring but kept in the graph.
 * The v3-validator will emit warnings for invalid patterns during validation.
 */
export function simpleRepair(g: GraphT, requestId?: string): GraphT {
  const nodes = g.nodes.slice(0, 12);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeKindMap = new Map(nodes.map((node) => [node.id, node.kind]));

  // Filter only dangling edges (references to nodes outside the trimmed set)
  const validEdges = g.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  // Detect invalid edge patterns for telemetry (but don't drop them)
  const invalidEdges: Array<{ from: string; to: string; fromKind: string; toKind: string }> = [];
  for (const edge of validEdges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    if (fromKind && toKind && !isEdgeAllowed(fromKind, toKind)) {
      invalidEdges.push({ from: edge.from, to: edge.to, fromKind, toKind });
    }
  }

  // Log invalid patterns for monitoring (helps track v4 prompt effectiveness)
  if (invalidEdges.length > 0) {
    log.warn({
      event: "cee.simple_repair.invalid_edges_preserved",
      request_id: requestId,
      invalid_count: invalidEdges.length,
      total_edge_count: validEdges.length,
      invalid_patterns: invalidEdges.map((e) => `${e.fromKind}→${e.toKind}`),
      invalid_edges: invalidEdges,
    }, "simpleRepair detected invalid edge patterns (preserved for connectivity)");
  }

  const edges = validEdges
    .slice(0, 24)
    .map((edge, idx) => ({ ...edge, id: edge.id || `${edge.from}::${edge.to}::${idx}` }))
    .sort((a, b) => a.id!.localeCompare(b.id!));

  return { ...g, nodes, edges };
}
