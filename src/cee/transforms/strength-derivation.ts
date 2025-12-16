/**
 * Strength Standard Deviation Derivation
 *
 * Derives parametric uncertainty (std) from edge properties for v2.2 schema.
 * This enables ISL to perform sensitivity analysis on effect magnitudes,
 * not just edge existence.
 *
 * Formula:
 *   cv = 0.3 * (1 - belief) + 0.1    // cv ∈ [0.1, 0.4]
 *   sourceMultiplier = provenance includes "hypothesis" ? 1.5 : 1.0
 *   std = max(0.05, cv * |weight| * sourceMultiplier)
 */

export interface ProvenanceObject {
  source: string;
  quote?: string;
  location?: string;
}

/**
 * Derive parametric uncertainty (std) from edge properties.
 *
 * @param weight - Edge weight (magnitude), always positive
 * @param belief - Confidence in relationship (0-1), maps to exists_probability
 * @param provenance - Source of the relationship
 * @returns Derived std for strength distribution
 *
 * @example
 * // High confidence evidence: low std
 * deriveStrengthStd(1.0, 0.9, 'evidence') // ≈ 0.13
 *
 * // Low confidence hypothesis: high std
 * deriveStrengthStd(1.0, 0.5, 'hypothesis') // ≈ 0.38
 */
export function deriveStrengthStd(
  weight: number,
  belief: number,
  provenance?: string | ProvenanceObject
): number {
  // Clamp inputs to valid ranges
  const clampedWeight = Math.abs(weight || 0.5);
  const clampedBelief = Math.max(0, Math.min(1, belief ?? 0.5));

  // Base coefficient of variation inversely proportional to belief
  // Higher belief = more confident = lower cv
  // cv ranges from 0.1 (belief=1.0) to 0.4 (belief=0.0)
  const cv = 0.3 * (1 - clampedBelief) + 0.1;

  // Extract provenance string for hypothesis detection
  const provenanceStr =
    typeof provenance === "string"
      ? provenance
      : (provenance as ProvenanceObject | undefined)?.source ?? "";

  // Increase uncertainty for hypotheses vs evidence-backed relationships
  const isHypothesis = provenanceStr.toLowerCase().includes("hypothesis");
  const sourceMultiplier = isHypothesis ? 1.5 : 1.0;

  // std = cv × |weight| × sourceMultiplier, with minimum floor
  const std = cv * clampedWeight * sourceMultiplier;

  // Minimum floor of 0.05 to avoid zero uncertainty
  return Math.max(0.05, std);
}

/**
 * Batch derive strength_std for an array of edges.
 *
 * @param edges - Array of edges with weight, belief, provenance
 * @returns Array of derived std values (same order as input)
 */
export function deriveStrengthStdBatch(
  edges: Array<{
    weight?: number;
    belief?: number;
    provenance?: string | ProvenanceObject;
  }>
): number[] {
  return edges.map((edge) =>
    deriveStrengthStd(edge.weight ?? 0.5, edge.belief ?? 0.5, edge.provenance)
  );
}
