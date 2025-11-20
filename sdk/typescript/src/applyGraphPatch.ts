import type { GraphV1, GraphPatchV1 } from "./graphTypes.js";

/**
 * Apply a GraphPatchV1 to a base GraphV1, returning a new graph instance.
 *
 * This helper is:
 * - Pure and deterministic (no side effects, does not mutate the base graph).
 * - Metadata-only: it operates on graph structure (nodes/edges) without
 *   inspecting or logging any free-text content.
 *
 * Patch semantics (best-effort, forward compatible with engine contracts):
 * - Adds:
 *   - `adds.nodes`: appended to the node list, replacing any existing node with
 *     the same `id`.
 *   - `adds.edges`: appended to the edge list.
 * - Updates:
 *   - Node updates are objects with `id: string`; their properties are shallow-
 *     merged into the matching node.
 *   - Edge updates are objects with `id: string`; their properties are shallow-
 *     merged into the matching edge when edges carry IDs.
 * - Removes:
 *   - Node removals: objects with `node_id` / `nodeId` / `id` remove the node
 *     and any incident edges.
 *   - Edge removals: objects with `edge_id` / `edgeId` / `id` remove matching
 *     edges by ID; as a fallback, objects with `from` + `to` remove matching
 *     edges by endpoints.
 */
export function applyGraphPatch(base: GraphV1, patch: GraphPatchV1 | null | undefined): GraphV1 {
  if (!patch || typeof patch !== "object") {
    return base;
  }

  const baseNodes = Array.isArray(base.nodes) ? base.nodes : [];
  const baseEdges = Array.isArray(base.edges) ? base.edges : [];

  const nodes = baseNodes.map((node) => ({ ...node }));
  const edges = baseEdges.map((edge) => ({ ...edge }));

  const result: GraphV1 = {
    ...base,
    nodes,
    edges,
  };

  const patchAny = patch as any;

  // Apply additions
  const adds = patchAny.adds ?? {};
  if (Array.isArray(adds.nodes)) {
    for (const node of adds.nodes as any[]) {
      if (!node || typeof node !== "object") continue;
      const id = typeof (node as any).id === "string" ? (node as any).id : undefined;
      if (id) {
        const existingIndex = result.nodes.findIndex((n: any) => n && n.id === id);
        if (existingIndex !== -1) {
          result.nodes.splice(existingIndex, 1);
        }
      }
      result.nodes.push(node as any);
    }
  }

  if (Array.isArray(adds.edges)) {
    for (const edge of adds.edges as any[]) {
      if (!edge || typeof edge !== "object") continue;
      result.edges.push(edge as any);
    }
  }

  // Apply updates
  if (Array.isArray(patchAny.updates)) {
    for (const update of patchAny.updates as any[]) {
      if (!update || typeof update !== "object") continue;

      const id = typeof update.id === "string" ? update.id : undefined;
      if (!id) continue;

      // Prefer node updates when a matching node exists; fall back to edge
      // updates when a matching edge with the same id is present.
      const nodeIndex = result.nodes.findIndex((n: any) => n && n.id === id);
      if (nodeIndex !== -1) {
        result.nodes[nodeIndex] = { ...result.nodes[nodeIndex], ...update } as any;
        continue;
      }

      const edgeIndex = result.edges.findIndex((e: any) => e && e.id === id);
      if (edgeIndex !== -1) {
        result.edges[edgeIndex] = { ...result.edges[edgeIndex], ...update } as any;
      }
    }
  }

  // Apply removals
  if (Array.isArray(patchAny.removes)) {
    for (const removal of patchAny.removes as any[]) {
      if (!removal || typeof removal !== "object") continue;

      const nodeId =
        typeof removal.node_id === "string"
          ? (removal.node_id as string)
          : typeof removal.nodeId === "string"
          ? (removal.nodeId as string)
          : typeof removal.id === "string"
          ? (removal.id as string)
          : undefined;

      const edgeId =
        typeof removal.edge_id === "string"
          ? (removal.edge_id as string)
          : typeof removal.edgeId === "string"
          ? (removal.edgeId as string)
          : typeof removal.id === "string"
          ? (removal.id as string)
          : undefined;

      if (nodeId) {
        // Remove the node and any incident edges.
        result.nodes = result.nodes.filter((n: any) => !n || n.id !== nodeId);
        result.edges = result.edges.filter(
          (e: any) => !e || (e.from !== nodeId && e.to !== nodeId),
        );
        continue;
      }

      if (edgeId) {
        result.edges = result.edges.filter((e: any) => !e || e.id !== edgeId);
        continue;
      }

      // Fallback: remove edge by from/to endpoints when provided.
      const from = typeof removal.from === "string" ? (removal.from as string) : undefined;
      const to = typeof removal.to === "string" ? (removal.to as string) : undefined;
      if (from && to) {
        result.edges = result.edges.filter(
          (e: any) => !e || e.from !== from || e.to !== to,
        );
      }
    }
  }

  return result;
}
