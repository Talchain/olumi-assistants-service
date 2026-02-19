/**
 * Shared edge format utility
 *
 * Detects and patches edges in the correct format (V1_FLAT or LEGACY).
 * Used by the deterministic sweep, unreachable factor handling, and status quo fix
 * to prevent cross-stage format mixing.
 *
 * V1_FLAT: strength_mean, strength_std, belief_exists (current internal + V3 external)
 * LEGACY:  weight, belief (deprecated fields from older pipelines)
 * NONE:    no numeric fields detected
 */

import type { EdgeT } from "../../../schemas/graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgeFormat = "V1_FLAT" | "LEGACY" | "NONE";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the edge format used in a set of edges.
 * Checks V1_FLAT first (strength_mean/strength_std/belief_exists), then LEGACY (weight/belief).
 * Returns NONE if no edges or no numeric fields detected.
 */
export function detectEdgeFormat(edges: readonly EdgeT[]): EdgeFormat {
  if (!edges || edges.length === 0) return "NONE";

  for (const edge of edges) {
    if (
      edge.strength_mean !== undefined ||
      edge.strength_std !== undefined ||
      edge.belief_exists !== undefined
    ) {
      return "V1_FLAT";
    }
  }

  for (const edge of edges) {
    const e = edge as Record<string, unknown>;
    if (e.weight !== undefined || e.belief !== undefined) {
      return "LEGACY";
    }
  }

  return "NONE";
}

// ---------------------------------------------------------------------------
// Patching
// ---------------------------------------------------------------------------

export interface PatchParams {
  mean?: number;
  std?: number;
  existence?: number;
}

/**
 * Spread-and-patch an edge with numeric values in the correct format.
 * Never mutates the input edge — returns a new object.
 */
export function patchEdgeNumeric(
  edge: EdgeT,
  format: EdgeFormat,
  params: PatchParams,
): EdgeT {
  const patched = { ...edge };

  if (format === "LEGACY") {
    if (params.mean !== undefined) (patched as any).weight = params.mean;
    if (params.existence !== undefined) (patched as any).belief = params.existence;
    // LEGACY has no std equivalent
  } else {
    // V1_FLAT or NONE (default to V1_FLAT for new edges)
    if (params.mean !== undefined) patched.strength_mean = params.mean;
    if (params.std !== undefined) patched.strength_std = params.std;
    if (params.existence !== undefined) patched.belief_exists = params.existence;
  }

  return patched;
}

// ---------------------------------------------------------------------------
// Canonical structural edge
// ---------------------------------------------------------------------------

/**
 * Create canonical structural edge params (option→factor).
 * mean=1, std=0.01, existence=1.0 in the correct format.
 * Preserves all other fields on the edge.
 */
export function canonicalStructuralEdge(
  edge: EdgeT,
  format: EdgeFormat,
): EdgeT {
  return patchEdgeNumeric(edge, format, { mean: 1, std: 0.01, existence: 1.0 });
}

// ---------------------------------------------------------------------------
// Neutral causal edge
// ---------------------------------------------------------------------------

export interface NeutralCausalParams {
  from: string;
  to: string;
  sign?: "positive" | "negative";
}

/**
 * Create neutral causal edge params for a new edge.
 * existence=0.7, |mean|=0.3 (signed), std=0.2 in correct format.
 */
export function neutralCausalEdge(
  format: EdgeFormat,
  params: NeutralCausalParams,
): EdgeT {
  const mean = params.sign === "negative" ? -0.3 : 0.3;

  const edge: EdgeT = {
    from: params.from,
    to: params.to,
    effect_direction: params.sign ?? "positive",
    origin: "repair" as const,
    provenance: {
      source: "synthetic",
      quote: "Repair edge (structural connectivity)",
    },
    provenance_source: "synthetic" as const,
  };

  return patchEdgeNumeric(edge, format, { mean, std: 0.2, existence: 0.7 });
}
