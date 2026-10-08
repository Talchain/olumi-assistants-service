import { keepMeanProjectionWhenSizeUnchanged } from '../cee/magnitude/link-sizing.js';
import { userFigureMovedRefusal } from '../cee/magnitude/user-figure-held.js';
/**
 * Pure Patch Applier
 *
 * Applies PatchOperations to a GraphV3T, producing a candidate graph.
 * Pure function — no side effects, deep-clones graph before mutation.
 *
 * Throws PatchApplyError on invalid operations (e.g. remove non-existent node).
 * Never silently skips or repairs.
 */

import { EdgeV3, NodeV3, type GraphV3T } from "../schemas/cee-v3.js";
import {
  EDGE_REQUIRED_NESTED_FIELDS,
  NODE_REQUIRED_NESTED_FIELDS,
  describeNonObjectWrite,
  isPlainObjectWrite,
  mergeRequiredNestedWrite,
  readNestedField,
  requiredNestedMemberNames,
} from "../schemas/required-nested-merge.js";
import type { PatchOperation } from "./types.js";
import { preconditionRiskLinkViolations } from './graph-structure-validator.js';
import { hasReliesOnRiskWrite } from '../orchestrator-v5/graph-management/field-safety.js';

// ============================================================================
// Error
// ============================================================================

export type PatchApplyErrorCode =
  | 'NODE_NOT_FOUND'
  | 'EDGE_NOT_FOUND'
  | 'NODE_ALREADY_EXISTS'
  | 'EDGE_ALREADY_EXISTS'
  | 'INVALID_OPERATION'
  | 'PRECONDITION_RISK_LINKED'
  /** F1 (#87 6006627551): the write would move the strength of a link holding the user's own figure (`user-figure-held.ts`). */
  | 'USER_FIGURE_HELD';

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
  // A server-approved Add owns the initial stamp. No update writer may
  // manufacture, rebind or remove it, even outside the model/referee doors.
  if (hasReliesOnRiskWrite(operations.filter((op) => op.op === 'update_node'))) {
    throw new PatchApplyError('INVALID_OPERATION', "A precondition risk's option link is managed by its Add approval; I haven't changed it.");
  }
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

  // Enforce the central precondition rule after the WHOLE atomic batch: an
  // explicit removal can repair a bad stored link, but no writer can persist
  // an incident link by bypassing edit_graph's optional structural preflight.
  const preconditionViolation = preconditionRiskLinkViolations(candidate)[0];
  if (preconditionViolation !== undefined) {
    throw new PatchApplyError('PRECONDITION_RISK_LINKED', preconditionViolation.detail);
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
  // Guard: prevent overwriting the node's identity field.
  const { id: _id, ...rest } = updates;
  // ROADMAP 2.380 — structurally identical to `applyUpdateEdge`, over NodeV3's
  // OWN derived set. That set is EMPTY today (every object-typed NodeV3 field —
  // observed_state, prior — is `.optional()`, which is precisely why node edits
  // survived the whole-object replace that killed edge edits), so this loop is
  // a no-op at present and the behaviour is unchanged. It is here so that a
  // future required nested object on NodeV3 cannot reopen the same defect on
  // the node path: the derived set, the merge semantics, and the referee's
  // matching builder all move together.
  const scalarUpdates: Record<string, unknown> = {};
  const nestedUpdates: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rest)) {
    if (NODE_REQUIRED_NESTED_FIELDS.has(key)) nestedUpdates[key] = val;
    else scalarUpdates[key] = val;
  }
  Object.assign(node, scalarUpdates);

  for (const [field, incoming] of Object.entries(nestedUpdates)) {
    if (incoming === undefined) continue;
    if (!isPlainObjectWrite(incoming)) {
      const members = requiredNestedMemberNames(NodeV3, field).join(' and/or ');
      throw new PatchApplyError(
        'INVALID_OPERATION',
        `update_node "${nodeId}" requires ${field} to be an object with ${members}; got ${describeNonObjectWrite(incoming)}`,
      );
    }
    Object.assign(node, {
      [field]: mergeRequiredNestedWrite(readNestedField(node, field), incoming),
    });
  }
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

  const before = structuredClone(edge);
  const updates = op.value as Record<string, unknown>;
  // Guard: prevent overwriting edge identity fields. Required NESTED OBJECT
  // fields are pulled out separately because a shallow Object.assign would
  // drop members the patch does not mention (a patch carrying only {mean}
  // would silently strip the existing std, producing an edge that fails
  // GraphV3.safeParse downstream).
  //
  // ROADMAP 2.380: the field set and the merge semantics now come from
  // `schemas/required-nested-merge.ts`, DERIVED from EdgeV3 rather than
  // spelled `strength` here. The graph-management referee's candidate builder
  // imports the SAME module. It previously carried its own, replacing
  // (non-merging) write, and — because the referee's candidate is ADOPTED as
  // the applied view for tunable mutations — it overwrote this correct result
  // and killed every live edge-strength edit. Sharing the semantics is what
  // stops that recurring; the applier↔referee parity test
  // (graph-management/__tests__/applier-referee-tunable-parity.test.ts) is
  // what proves it.
  const { from: _from, to: _to, ...rest } = updates;
  const scalarUpdates: Record<string, unknown> = {};
  const nestedUpdates: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rest)) {
    if (EDGE_REQUIRED_NESTED_FIELDS.has(key)) nestedUpdates[key] = val;
    else scalarUpdates[key] = val;
  }
  Object.assign(edge, scalarUpdates);

  for (const [field, incoming] of Object.entries(nestedUpdates)) {
    // `strength: undefined` is treated as "no change to strength" — a
    // legitimate partial update touching other fields only. Any other
    // non-plain-object value (`null`, array, primitive) is incoherent: the
    // patch claims to update the field but cannot. UpdateEdgeValue in
    // patch-validation.ts is permissive (`z.record(z.string(), z.unknown())`),
    // so these shapes survive patch-validation. Refusing here avoids a
    // false-success path where the candidate matches the base graph
    // unchanged but the assistant narrates "Updated edge…".
    if (incoming === undefined) continue;
    if (!isPlainObjectWrite(incoming)) {
      const members = requiredNestedMemberNames(EdgeV3, field).join(' and/or ');
      throw new PatchApplyError(
        'INVALID_OPERATION',
        `update_edge "${from}" → "${to}" requires ${field} to be an object with ${members}; got ${describeNonObjectWrite(incoming)}`,
      );
    }
    // Explicit `undefined` members are a no-op, never a wipe — see
    // `mergeRequiredNestedWrite`.
    Object.assign(edge, {
      [field]: mergeRequiredNestedWrite(readNestedField(edge, field), incoming),
    });
  }
  // R8: generic patches cannot clear the un-hashed carrier while retaining the size.
  Object.assign(edge, keepMeanProjectionWhenSizeUnchanged(before, edge));
  // ⭐ F1 (#87 6006627551; DL Review Desk class check): this merge keeps `natural_effect` while the strength moves, so on a
  // link holding the user's own figure it would leave a figure that no longer describes the link — and it cannot carry
  // the user's replace. Refused, on the candidate clone (nothing is written), in the link writer's own words.
  const figureMoved = userFigureMovedRefusal(before, edge);
  if (figureMoved !== null) throw new PatchApplyError('USER_FIGURE_HELD', figureMoved);
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
