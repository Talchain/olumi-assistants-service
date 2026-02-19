/**
 * Stage 2 (Normalise) — field preservation contract.
 *
 * Rule: "Fields present at stage input must be present at stage output
 * unless the stage's contract explicitly declares the drop."
 *
 * Populated by reading reconcileStructuralTruth() and normaliseRiskCoefficients().
 */

export const STAGE_CONTRACT = {
  name: "normalise",

  /**
   * Fields that the stage is allowed to DELETE from the output.
   * Any field drop NOT listed here is a contract violation.
   */
  allowedDrops: {
    topLevel: [] as string[],
    node: [] as string[],
    edge: [] as string[],
    option: [] as string[],
    nodeData: [
      /** WHY: STRP Rule 1 (reconcileStructuralTruth) drops factor_type when reclassifying controllable → observable/external */
      "factor_type",
      /** WHY: STRP Rule 1 (reconcileStructuralTruth) drops uncertainty_drivers when reclassifying controllable → observable/external */
      "uncertainty_drivers",
    ] as string[],
  },

  /**
   * Fields that the stage may MODIFY (change value but still present).
   * Presence is still required — only the value may differ.
   */
  allowedModifications: {
    topLevel: [] as string[],
    node: ["category"] as string[],
    edge: ["strength_mean", "effect_direction"] as string[],
    option: [] as string[],
    nodeData: ["factor_type", "extractionType", "uncertainty_drivers"] as string[],
  },

  /**
   * Whether entire nodes or edges can be removed (count decrease).
   * Normalise does NOT remove nodes or edges — only mutates field values.
   */
  allowedRemovals: {
    nodes: false,
    edges: false,
  },
} as const;
