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
 *
 * Writes BOTH `strength_mean` and `effect_direction` — see the comment at the
 * correction site for why writing only the magnitude is silently reverted.
 */
export function normaliseRiskCoefficients(
  nodes: Array<{ id: string; kind?: string }>,
  edges: Array<{ from?: string; to?: string; strength_mean?: number; strength?: { mean?: number }; effect_direction?: string }>
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
        // ⭐ STAMP THE DIRECTION TOO, or this correction gets UNDONE downstream.
        // `effect_direction` is the authority when the two fields disagree
        // (STRP Rule 4, `validators/structural-reconciliation.ts`), and this
        // function runs immediately AFTER that rule in Stage 2 and is seen
        // again by Late STRP in Stage 4 substep 6. Negating the mean while
        // leaving a stale `effect_direction: "positive"` manufactures exactly
        // the disagreement Rule 4 exists to settle — and Rule 4 would settle it
        // by restoring the positive magnitude, silently reverting this
        // correction. Writing both fields leaves nothing to reconcile.
        // Pinned by the Late-STRP round-trip case in
        // `tests/unit/cee.edge-polarity-direction-authority.test.ts`.
        return { ...edge, strength_mean: corrected, effect_direction: "negative" };
      }
    }
    return edge;
  });

  return { edges: normalisedEdges, corrections };
}
