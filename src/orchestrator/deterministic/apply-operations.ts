/**
 * Apply Operations Shim (T3)
 *
 * Pure, READ-ONLY application of a PatchOperation array to a GraphV3T,
 * returning a new graph. Used by the post-mutation health gate to assess the
 * resulting state of mutating actions whose handlers don't (yet) populate
 * `actionResult.applied_graph` directly.
 *
 * Contract (deliberately narrow):
 *   - Supports: add_node, remove_node, update_node (shallow merge into existing
 *     node value), add_edge, remove_edge, update_edge (shallow merge).
 *   - Unknown ops are NO-OPS — the gate is advisory only, not authoritative
 *     apply. The canonical patch applier (patch-applier.ts) is the source of
 *     truth for the actual mutation.
 *   - Never mutates the input graph. Nodes/edges arrays are reconstructed
 *     from primitives; existing entries are referenced by identity (safe
 *     because downstream readers — validateGraphStructure,
 *     computeStructuralReadiness — only read).
 *
 * What this is NOT:
 *   - Not a replacement for `applyPatchOperations` in patch-applier.ts.
 *   - Not Zod-validated. Callers must already trust the operations array.
 *   - Not a semantic validator. Only structural rearrangement.
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { PatchOperation } from "../types.js";

type GraphNode = GraphV3T['nodes'][number];
type GraphEdge = GraphV3T['edges'][number];

export function applyOperationsToGraph(
  base: GraphV3T,
  ops: PatchOperation[],
): GraphV3T {
  let nodes: GraphNode[] = [...base.nodes];
  let edges: GraphEdge[] = [...base.edges];

  for (const op of ops) {
    switch (op.op) {
      case 'add_node': {
        const v = op.value as Record<string, unknown> | undefined;
        if (!v || typeof v !== 'object') break;
        const id = typeof v.id === 'string' ? v.id : (typeof op.path === 'string' ? op.path : null);
        if (!id) break;
        // Replace if id already exists; otherwise append.
        const existingIdx = nodes.findIndex((n) => (n as { id?: string }).id === id);
        if (existingIdx >= 0) {
          nodes = [
            ...nodes.slice(0, existingIdx),
            v as unknown as GraphNode,
            ...nodes.slice(existingIdx + 1),
          ];
        } else {
          nodes = [...nodes, v as unknown as GraphNode];
        }
        break;
      }
      case 'remove_node': {
        const id = op.path;
        if (!id) break;
        nodes = nodes.filter((n) => (n as { id?: string }).id !== id);
        // Drop any dangling edges that referenced the removed node.
        edges = edges.filter((e) => {
          const ee = e as { from?: string; to?: string };
          return ee.from !== id && ee.to !== id;
        });
        break;
      }
      case 'update_node': {
        const id = op.path;
        const v = op.value as Record<string, unknown> | undefined;
        if (!id || !v) break;
        const idx = nodes.findIndex((n) => (n as { id?: string }).id === id);
        if (idx < 0) break;
        const merged = { ...(nodes[idx] as Record<string, unknown>), ...v } as unknown as GraphNode;
        nodes = [...nodes.slice(0, idx), merged, ...nodes.slice(idx + 1)];
        break;
      }
      case 'add_edge': {
        const v = op.value as Record<string, unknown> | undefined;
        if (!v || typeof v !== 'object') break;
        edges = [...edges, v as unknown as GraphEdge];
        break;
      }
      case 'remove_edge': {
        // Edges identify by from->to or by op.path matching that pattern.
        const path = op.path;
        if (!path) break;
        const arrowMatch = path.match(/([^/]+)->([^/]+)$/);
        if (arrowMatch) {
          const [, from, to] = arrowMatch;
          edges = edges.filter((e) => {
            const ee = e as { from?: string; to?: string };
            return !(ee.from === from && ee.to === to);
          });
        }
        break;
      }
      case 'update_edge': {
        const path = op.path;
        const v = op.value as Record<string, unknown> | undefined;
        if (!path || !v) break;
        const arrowMatch = path.match(/([^/]+)->([^/]+)$/);
        if (!arrowMatch) break;
        const [, from, to] = arrowMatch;
        const idx = edges.findIndex((e) => {
          const ee = e as { from?: string; to?: string };
          return ee.from === from && ee.to === to;
        });
        if (idx < 0) break;
        const merged = { ...(edges[idx] as Record<string, unknown>), ...v } as unknown as GraphEdge;
        edges = [...edges.slice(0, idx), merged, ...edges.slice(idx + 1)];
        break;
      }
      default:
        // Unknown op kinds are no-ops. The advisory health gate must NEVER
        // throw on a mutation it doesn't understand — that would block the
        // entire response.
        break;
    }
  }

  return {
    ...base,
    nodes,
    edges,
  };
}
