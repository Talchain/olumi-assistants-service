/**
 * Edge Identity Stability Module
 *
 * Dual-key edge field stash that survives goal merge.
 * Solves RISK-06: from::to-based stash keys break when enforceSingleGoal()
 * redirects edges from merged goal IDs to the primary goal.
 *
 * Stash strategy:
 *  1. Primary: edge.id (stable through goal merge if enforceStableEdgeIds ran first)
 *  2. Fallback: from::to key with nodeRenames reversal
 *
 * Restoration order:
 *  1. Match by edge.id in byEdgeId map
 *  2. Match by current from::to in byFromTo map
 *  3. Match by reversed from::to (undo nodeRenames) in byFromTo map
 *
 * Uses plain objects (not Maps) so Object.freeze() prevents mutation.
 */

/** V4 edge fields that may be stripped by external validation (PLoT). */
const V4_EDGE_FIELDS = [
  "strength_mean",
  "strength_std",
  "belief_exists",
  "effect_direction",
  "provenance",
  "provenance_source",
] as const;

export interface EdgeFieldStash {
  /** Primary lookup: edge.id → V4 field values */
  byEdgeId: Record<string, Record<string, unknown>>;
  /** Fallback lookup: "from::to" → V4 field values */
  byFromTo: Record<string, Record<string, unknown>>;
}

/**
 * Create a dual-key stash of V4 edge fields for later restoration.
 * Call BEFORE any pipeline step that might strip fields (PLoT validation, goal merge).
 */
export function createEdgeFieldStash(edges: any[]): EdgeFieldStash {
  const byEdgeId: Record<string, Record<string, unknown>> = {};
  const byFromTo: Record<string, Record<string, unknown>> = {};

  if (!Array.isArray(edges)) {
    return { byEdgeId, byFromTo };
  }

  for (const edge of edges) {
    if (!edge) continue;

    const fields: Record<string, unknown> = {};
    let hasAnyField = false;

    for (const field of V4_EDGE_FIELDS) {
      if ((edge as any)[field] !== undefined) {
        fields[field] = (edge as any)[field];
        hasAnyField = true;
      }
    }

    if (!hasAnyField) continue;

    // Primary key: edge.id
    const edgeId = typeof (edge as any).id === "string" ? (edge as any).id as string : undefined;
    if (edgeId) {
      byEdgeId[edgeId] = fields;
    }

    // Fallback key: from::to
    const from = typeof (edge as any).from === "string" ? (edge as any).from as string : undefined;
    const to = typeof (edge as any).to === "string" ? (edge as any).to as string : undefined;
    if (from && to) {
      byFromTo[`${from}::${to}`] = fields;
    }
  }

  return { byEdgeId, byFromTo };
}

/**
 * Restore V4 edge fields from the stash.
 * Handles goal merge by reversing nodeRenames when from::to lookup fails.
 *
 * @param edges - Current edges (potentially with redirected from/to after goal merge)
 * @param stash - The stash created before field-stripping operations
 * @param nodeRenames - Map of mergedGoalId → primaryGoalId from enforceSingleGoal
 * @returns Updated edges and count of restorations performed
 */
export function restoreEdgeFields(
  edges: any[],
  stash: EdgeFieldStash,
  nodeRenames: Map<string, string>,
): { edges: any[]; restoredCount: number } {
  if (!Array.isArray(edges)) {
    return { edges: edges ?? [], restoredCount: 0 };
  }

  // Build reverse map: primaryGoalId → [mergedGoalId1, mergedGoalId2, ...]
  const reverseRenames = new Map<string, string[]>();
  for (const [merged, primary] of nodeRenames) {
    const existing = reverseRenames.get(primary) ?? [];
    existing.push(merged);
    reverseRenames.set(primary, existing);
  }

  let restoredCount = 0;

  const restored = edges.map(edge => {
    if (!edge) return edge;

    // Check if ALL V4 fields already present — skip if so
    const allPresent = V4_EDGE_FIELDS.every(f => (edge as any)[f] !== undefined);
    if (allPresent) return edge;

    let stashedFields: Record<string, unknown> | undefined;

    // Strategy 1: edge.id lookup
    const edgeId = typeof (edge as any).id === "string" ? (edge as any).id as string : undefined;
    if (edgeId) {
      stashedFields = stash.byEdgeId[edgeId];
    }

    // Strategy 2: current from::to lookup
    if (!stashedFields) {
      const from = typeof (edge as any).from === "string" ? (edge as any).from as string : undefined;
      const to = typeof (edge as any).to === "string" ? (edge as any).to as string : undefined;
      if (from && to) {
        stashedFields = stash.byFromTo[`${from}::${to}`];

        // Strategy 3: reverse nodeRenames to find original from::to
        if (!stashedFields) {
          const originalFromCandidates = reverseRenames.get(from) ?? [from];
          const originalToCandidates = reverseRenames.get(to) ?? [to];

          for (const origFrom of originalFromCandidates) {
            for (const origTo of originalToCandidates) {
              const key = `${origFrom}::${origTo}`;
              stashedFields = stash.byFromTo[key];
              if (stashedFields) break;
            }
            if (stashedFields) break;
          }
        }
      }
    }

    if (!stashedFields) return edge;

    // Apply stashed fields only where the edge is missing them
    const patched = { ...edge };
    let anyRestored = false;

    for (const [field, value] of Object.entries(stashedFields)) {
      if ((patched as any)[field] === undefined && value !== undefined) {
        (patched as any)[field] = value;
        anyRestored = true;
      }
    }

    if (anyRestored) {
      restoredCount++;
    }

    return patched;
  });

  return { edges: restored, restoredCount };
}
