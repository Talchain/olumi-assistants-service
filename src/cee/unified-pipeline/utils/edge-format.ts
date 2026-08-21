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
 * mean=1, std=0.01, existence=1.0, direction="positive" in the correct format.
 * Preserves all other fields on the edge.
 *
 * effect_direction MUST be set here: since d1628b946 the validator's strict
 * canonical check (STRUCTURAL_EDGE_NOT_CANONICAL_ERROR) requires
 * effect_direction === "positive", so a repair that only patches the numeric
 * fields can never satisfy post-enforcement re-validation and the pipeline
 * fails closed with CEE_GRAPH_INVALID (the mass 422s in the integration suite).
 */
export function canonicalStructuralEdge(
  edge: EdgeT,
  format: EdgeFormat,
): EdgeT {
  const patched = patchEdgeNumeric(edge, format, { mean: 1, std: 0.01, existence: 1.0 });
  patched.effect_direction = "positive";
  return patched;
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

// ---------------------------------------------------------------------------
// Canonical parameter read (shape-agnostic)
// ---------------------------------------------------------------------------

/**
 * The three causal parameters an edge carries, each `undefined` when the edge
 * does not carry a readable (finite, numeric) value for it.
 *
 * ⚠ `undefined` is NOT interchangeable with `0`. `0` is a legitimate strength
 * (`strengthBand(0)` → 'negligible'), so a reader that collapses "absent" into
 * "zero" fabricates a value the model never held — see `readEdgeParams`.
 */
export interface EdgeParams {
  mean: number | undefined;
  std: number | undefined;
  existence: number | undefined;
}

/** Narrow to a finite number, or `undefined`. Never coerces. */
function finite(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Read an edge's causal parameters WHATEVER SHAPE the edge is in.
 *
 * This module is the canonical owner of "which fields on this edge hold its
 * numbers", and this function is the canonical answer to "what values does the
 * model currently use for this edge". Consumers must not re-implement it:
 * a second, shape-specific accessor elsewhere is a hand-maintained mirror
 * (trap 12) whose drift is silent, because the wrong shape reads as *absent*
 * rather than as an error.
 *
 * ⚠ THIS EXISTS BECAUSE THAT DEFECT SHIPPED. The two-pass validation pipeline
 * read `edge.strength?.mean ?? 0` — the canonical NESTED V3 shape — while
 * running at Stage 4b, where the graph is still V1_FLAT. Every read missed,
 * every `?? 0` fired, and `edge.validation.pass1` was written as
 * `{0, 0, 0}` on every edge of every graph. The UI renders that block under
 * the label "What the model currently uses", so the product showed the user
 * zeros for values it was simultaneously using correctly, and the resulting
 * `0 → non-zero` gap then fabricated `strength_band_change` and
 * `existence_boundary_crossing` on edges whose real disagreement was minor.
 * The nested shape is produced by `transformResponseToV3`
 * (`transforms/schema-v3.ts`) AFTER the validation pipeline has already
 * attached its metadata, so the one shape the pipeline knew how to read was
 * the one shape that could not yet exist.
 *
 * Per-field precedence is V1_FLAT → nested V3 → LEGACY, matching
 * `detectEdgeFormat`'s V1_FLAT-first precedence and the existing dual-shape
 * reader in `transforms/risk-normalisation.ts` (`strength_mean ?? strength.mean`).
 * Precedence is applied FIELD BY FIELD because mixed edges are real: a repair
 * that spreads `{...edge, strength_mean}` over a nested edge leaves both.
 *
 * ⚠ Deliberately NOT unified with `readEdgeMean` (`stages/repair/
 * graph-enforcement.ts`): that answers a different question — "read this edge
 * in the format already DETECTED for its batch" — and Stage 4 depends on that
 * batch-level consistency. Merging two different questions under one name is
 * trap 21, so the two stay separate and this note records why.
 */
export function readEdgeParams(edge: unknown): EdgeParams {
  const e = (edge ?? {}) as Record<string, unknown>;
  const nested = (e.strength ?? {}) as Record<string, unknown>;

  return {
    mean: finite(e.strength_mean) ?? finite(nested.mean) ?? finite(e.weight),
    std: finite(e.strength_std) ?? finite(nested.std),
    existence:
      finite(e.belief_exists) ?? finite(e.exists_probability) ?? finite(e.belief),
  };
}
