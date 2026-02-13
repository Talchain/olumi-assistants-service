/**
 * Risk coefficient normalisation.
 *
 * Extracted from pipeline.ts for reuse in the unified pipeline.
 * Ensures risk→goal and risk→outcome edges have negative strength_mean.
 */

export type RiskCoefficientCorrection = {
  source: string;
  target: string;
  original: number;
  corrected: number;
};

/**
 * Normalise risk coefficients: risk→goal and risk→outcome edges should have negative strength_mean.
 * LLM sometimes generates positive coefficients for risks, which is semantically incorrect.
 * This follows the "trust but verify" pattern used by goal repair.
 */
export function normaliseRiskCoefficients(
  nodes: Array<{ id: string; kind?: string }>,
  edges: Array<{ from?: string; to?: string; strength_mean?: number; strength?: { mean?: number } }>
): { edges: typeof edges; corrections: RiskCoefficientCorrection[] } {
  const nodeKindMap = new Map(nodes.map(n => [n.id, n.kind?.toLowerCase()]));
  const corrections: RiskCoefficientCorrection[] = [];

  const normalisedEdges = edges.map(edge => {
    const sourceKind = nodeKindMap.get(edge.from ?? "");
    const targetKind = nodeKindMap.get(edge.to ?? "");

    // Only process risk→goal and risk→outcome edges
    if (sourceKind === "risk" && (targetKind === "goal" || targetKind === "outcome")) {
      // Get the current strength_mean (checking both flat and nested formats)
      const original = edge.strength_mean ?? edge.strength?.mean ?? 0.5;

      // If positive, make it negative (risks should have negative impact on goals/outcomes)
      if (original > 0) {
        const corrected = -Math.abs(original);
        corrections.push({
          source: edge.from ?? "",
          target: edge.to ?? "",
          original,
          corrected,
        });
        return { ...edge, strength_mean: corrected };
      }
    }
    return edge;
  });

  return { edges: normalisedEdges, corrections };
}
