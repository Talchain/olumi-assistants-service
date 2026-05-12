/**
 * Pure Patch Applier
 *
 * Applies PatchOperations to a GraphV3T, producing a candidate graph.
 * Pure function — no side effects, deep-clones graph before mutation.
 *
 * Throws PatchApplyError on invalid operations (e.g. remove non-existent node).
 * Never silently skips or repairs.
 */

import type { GraphV3T } from "../schemas/cee-v3.js";
import type { PatchOperation } from "./types.js";

// ============================================================================
// Error
// ============================================================================

export type PatchApplyErrorCode =
  | 'NODE_NOT_FOUND'
  | 'EDGE_NOT_FOUND'
  | 'NODE_ALREADY_EXISTS'
  | 'EDGE_ALREADY_EXISTS'
  | 'INVALID_OPERATION';

export class PatchApplyError extends Error {
  constructor(
    public readonly code: PatchApplyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PatchApplyError';
  }
}

// ============================================================================
// Patch Applier
// ============================================================================

/**
 * Apply PatchOperations to a graph, producing a new candidate graph.
 *
 * Pure function: deep-clones graph before mutation. Does not modify the input.
 * Operations are applied in order. Invalid operations throw PatchApplyError.
 *
 * remove_node also removes all edges connected to that node.
 */
export function applyPatchOperations(
  graph: GraphV3T,
  operations: PatchOperation[],
): GraphV3T {
  // Deep clone to guarantee purity — structuredClone handles nested objects
  // (observed_state, strength, provenance) that spread would share by reference
  const candidate: GraphV3T = structuredClone({ nodes: graph.nodes, edges: graph.edges }) as GraphV3T;

  for (const op of operations) {
    switch (op.op) {
      case 'add_node':
        applyAddNode(candidate, op);
        break;
      case 'remove_node':
        applyRemoveNode(candidate, op);
        break;
      case 'update_node':
        applyUpdateNode(candidate, op);
        break;
      case 'add_edge':
        applyAddEdge(candidate, op);
        break;
      case 'remove_edge':
        applyRemoveEdge(candidate, op);
        break;
      case 'update_edge':
        applyUpdateEdge(candidate, op);
        break;
      default:
        throw new PatchApplyError(
          'INVALID_OPERATION',
          `Unknown operation type: ${(op as PatchOperation).op}`,
        );
    }
  }

  return candidate;
}

// ============================================================================
// Operation Handlers
// ============================================================================

function applyAddNode(graph: GraphV3T, op: PatchOperation): void {
  const nodeId = op.path;
  if (graph.nodes.some((n) => n.id === nodeId)) {
    throw new PatchApplyError('NODE_ALREADY_EXISTS', `Node "${nodeId}" already exists`);
  }

  const value = op.value as Record<string, unknown>;
  graph.nodes.push({
    ...value,
    id: nodeId, // op.path is authoritative — override any id in value
    kind: value.kind as string,
    label: value.label as string,
  } as GraphV3T['nodes'][number]);
}

function applyRemoveNode(graph: GraphV3T, op: PatchOperation): void {
  const nodeId = op.path;
  const idx = graph.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) {
    throw new PatchApplyError('NODE_NOT_FOUND', `Node "${nodeId}" not found`);
  }

  // Remove the node
  graph.nodes.splice(idx, 1);

  // Remove all connected edges (implicit, not counted against edge budget)
  graph.edges = graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
}

function applyUpdateNode(graph: GraphV3T, op: PatchOperation): void {
  const nodeId = op.path;
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    throw new PatchApplyError('NODE_NOT_FOUND', `Node "${nodeId}" not found`);
  }

  const updates = op.value as Record<string, unknown>;
  // Guard: prevent overwriting the node's identity field
  const { id: _id, ...safeUpdates } = updates;
  Object.assign(node, safeUpdates);
}

function applyAddEdge(graph: GraphV3T, op: PatchOperation): void {
  const value = op.value as Record<string, unknown>;
  const from = (value.from as string) ?? '';
  const to = (value.to as string) ?? '';

  // Validate referenced nodes exist
  if (!graph.nodes.some((n) => n.id === from)) {
    throw new PatchApplyError('NODE_NOT_FOUND', `Edge source node "${from}" not found`);
  }
  if (!graph.nodes.some((n) => n.id === to)) {
    throw new PatchApplyError('NODE_NOT_FOUND', `Edge target node "${to}" not found`);
  }

  // Check edge doesn't already exist
  if (graph.edges.some((e) => e.from === from && e.to === to)) {
    throw new PatchApplyError('EDGE_ALREADY_EXISTS', `Edge "${from}" → "${to}" already exists`);
  }

  graph.edges.push(value as GraphV3T['edges'][number]);
}

function applyRemoveEdge(graph: GraphV3T, op: PatchOperation): void {
  const [from, to] = parseEdgePath(op.path);
  const idx = graph.edges.findIndex((e) => e.from === from && e.to === to);
  if (idx === -1) {
    throw new PatchApplyError('EDGE_NOT_FOUND', `Edge "${from}" → "${to}" not found`);
  }
  graph.edges.splice(idx, 1);
}

function applyUpdateEdge(graph: GraphV3T, op: PatchOperation): void {
  const [from, to] = parseEdgePath(op.path);
  const edge = graph.edges.find((e) => e.from === from && e.to === to);
  if (!edge) {
    throw new PatchApplyError('EDGE_NOT_FOUND', `Edge "${from}" → "${to}" not found`);
  }

  const updates = op.value as Record<string, unknown>;
  // Guard: prevent overwriting edge identity fields. `strength` is pulled out
  // separately because it is a REQUIRED nested object on EdgeV3 with required
  // {mean, std} members — a shallow Object.assign would drop members the patch
  // does not mention (a patch carrying only {mean} would silently strip the
  // existing std, producing an edge that fails GraphV3.safeParse downstream).
  const { from: _from, to: _to, strength: strengthUpdate, ...scalarUpdates } = updates;
  Object.assign(edge, scalarUpdates);
  if (strengthUpdate !== undefined) {
    // `strength: undefined` is treated as "no change to strength" — a
    // legitimate partial update touching other fields only. Any other
    // non-plain-object value (`null`, array, primitive) is incoherent: the
    // patch claims to update strength but cannot. UpdateEdgeValue in
    // patch-validation.ts is permissive (`z.record(z.string(), z.unknown())`),
    // so these shapes survive patch-validation. Refusing here avoids a
    // false-success path where the candidate matches the base graph
    // unchanged but the assistant narrates "Updated edge…".
    if (strengthUpdate === null || typeof strengthUpdate !== 'object' || Array.isArray(strengthUpdate)) {
      const got = strengthUpdate === null ? 'null' : Array.isArray(strengthUpdate) ? 'array' : typeof strengthUpdate;
      throw new PatchApplyError(
        'INVALID_OPERATION',
        `update_edge "${from}" → "${to}" requires strength to be an object with mean and/or std; got ${got}`,
      );
    }
    const existing = (edge.strength ?? {}) as Record<string, unknown>;
    // Filter out explicit `undefined` subfields. JSON parsing cannot produce
    // an `undefined` own property — the production root-cause path is
    // unaffected — but the applier is also reachable from direct JS callers
    // (tests, future internal use). Treating an explicit `{ std: undefined }`
    // as a wipe would silently re-introduce the staging defect; treating it
    // as a no-op preserves the existing nested value.
    const incoming = strengthUpdate as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(incoming)) {
      if (incoming[key] !== undefined) filtered[key] = incoming[key];
    }
    edge.strength = { ...existing, ...filtered } as typeof edge.strength;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse edge path in format "from::to" (CEE canonical) or "from->to" (v2 format).
 */
function parseEdgePath(path: string): [string, string] {
  if (path.includes('::')) {
    const parts = path.split('::');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new PatchApplyError('INVALID_OPERATION', `Invalid edge path format: "${path}"`);
    }
    return [parts[0], parts[1]];
  }
  if (path.includes('->')) {
    const parts = path.split('->');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new PatchApplyError('INVALID_OPERATION', `Invalid edge path format: "${path}"`);
    }
    return [parts[0], parts[1]];
  }
  throw new PatchApplyError('INVALID_OPERATION', `Invalid edge path format: "${path}"`);
}
