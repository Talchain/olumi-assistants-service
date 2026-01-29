/**
 * Graph Diff Computation
 *
 * Computes diffs between graph states for observability.
 * Used to track changes during repair operations.
 *
 * @module cee/observability/graph-diff
 */

import type { GraphDiff, GraphDiffType } from "./types.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import type { RepairRecord } from "../structure/index.js";

// ============================================================================
// Repair Record to Graph Diff Conversion
// ============================================================================

/**
 * Convert RepairRecords to GraphDiffs.
 * RepairRecords track field-level edge repairs; this converts them to the
 * GraphDiff format for observability.
 */
export function repairRecordsToGraphDiffs(repairs: RepairRecord[]): GraphDiff[] {
  const diffs: GraphDiff[] = [];

  for (const repair of repairs) {
    diffs.push({
      type: "edge_modified",
      target_id: repair.edge_id,
      before: {
        field: repair.field,
        value: repair.from_value,
      },
      after: {
        field: repair.field,
        value: repair.to_value,
      },
      repair_reason: `${repair.action}: ${repair.reason}`,
    });
  }

  return diffs;
}

// ============================================================================
// Full Graph Diff Computation
// ============================================================================

/**
 * Compute diffs between two graph states.
 * Used when comparing before/after repair for comprehensive diffing.
 */
export function computeGraphDiffs(
  before: GraphT,
  after: GraphT,
  repairReason?: string
): GraphDiff[] {
  const diffs: GraphDiff[] = [];

  const beforeNodes = new Map<string, NodeT>();
  const afterNodes = new Map<string, NodeT>();
  const beforeEdges = new Map<string, EdgeT>();
  const afterEdges = new Map<string, EdgeT>();

  // Build maps
  for (const node of before.nodes ?? []) {
    beforeNodes.set(node.id, node);
  }
  for (const node of after.nodes ?? []) {
    afterNodes.set(node.id, node);
  }
  for (const edge of before.edges ?? []) {
    // Use edge.id if available, otherwise use from->to as key
    const edgeKey = edge.id ?? `${edge.from}->${edge.to}`;
    beforeEdges.set(edgeKey, edge);
  }
  for (const edge of after.edges ?? []) {
    const edgeKey = edge.id ?? `${edge.from}->${edge.to}`;
    afterEdges.set(edgeKey, edge);
  }

  // Find removed nodes
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) {
      diffs.push({
        type: "node_removed",
        target_id: id,
        before: sanitizeForDiff(node),
        repair_reason: repairReason,
      });
    }
  }

  // Find added nodes
  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) {
      diffs.push({
        type: "node_added",
        target_id: id,
        after: sanitizeForDiff(node),
        repair_reason: repairReason,
      });
    }
  }

  // Find removed edges
  for (const [id, edge] of beforeEdges) {
    if (!afterEdges.has(id)) {
      diffs.push({
        type: "edge_removed",
        target_id: id,
        before: sanitizeForDiff(edge),
        repair_reason: repairReason,
      });
    }
  }

  // Find added edges
  for (const [id, edge] of afterEdges) {
    if (!beforeEdges.has(id)) {
      diffs.push({
        type: "edge_added",
        target_id: id,
        after: sanitizeForDiff(edge),
        repair_reason: repairReason,
      });
    }
  }

  // Find modified edges (same id, different content)
  for (const [id, afterEdge] of afterEdges) {
    const beforeEdge = beforeEdges.get(id);
    if (beforeEdge && !edgesEqual(beforeEdge, afterEdge)) {
      diffs.push({
        type: "edge_modified",
        target_id: id,
        before: sanitizeForDiff(beforeEdge),
        after: sanitizeForDiff(afterEdge),
        repair_reason: repairReason,
      });
    }
  }

  return diffs;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize an object for inclusion in diffs.
 * Removes potentially large or sensitive fields.
 */
function sanitizeForDiff(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  // For arrays, sanitize each element
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForDiff);
  }

  // For objects, create a shallow copy with sanitized values
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip potentially large text fields in diffs
    if (key === "description" || key === "explanation" || key === "rationale") {
      if (typeof value === "string" && value.length > 100) {
        result[key] = value.substring(0, 100) + "...";
        continue;
      }
    }
    result[key] = value;
  }
  return result;
}

/**
 * Check if two edges are equal (for diff detection).
 */
function edgesEqual(a: EdgeT, b: EdgeT): boolean {
  // Compare key fields
  if (a.from !== b.from) return false;
  if (a.to !== b.to) return false;

  // Compare strength if present
  const aStrength = (a as any).strength;
  const bStrength = (b as any).strength;
  if (aStrength || bStrength) {
    if (!aStrength || !bStrength) return false;
    if (aStrength.mean !== bStrength.mean) return false;
    if (aStrength.std !== bStrength.std) return false;
  }

  // Compare effect_direction if present
  const aDirection = (a as any).effect_direction;
  const bDirection = (b as any).effect_direction;
  if (aDirection !== bDirection) return false;

  // Compare exists_probability if present
  const aProb = (a as any).exists_probability;
  const bProb = (b as any).exists_probability;
  if (aProb !== bProb) return false;

  return true;
}
