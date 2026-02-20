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
    node: [
      /** WHY: STRP Rule 1 (structural-reconciliation.ts:164) reclassifies factor category based on graph structure */
      "category",
    ] as string[],
    edge: [
      /** WHY: normaliseRiskCoefficients (risk-normalisation.ts:45) flips positive risk→goal/outcome edges to negative */
      "strength_mean",
      /** WHY: STRP Rule 4 (structural-reconciliation.ts:676) and Rule 2 (structural-reconciliation.ts:338) reconcile direction with sign */
      "effect_direction",
    ] as string[],
    option: [] as string[],
    nodeData: [
      /** WHY: STRP Rule 1 (structural-reconciliation.ts:178) fills factor_type when reclassifying TO controllable */
      /** WHY: STRP Rule 2 (structural-reconciliation.ts:283) corrects invalid factor_type enum values */
      "factor_type",
      /** WHY: STRP Rule 2 (structural-reconciliation.ts:298) corrects invalid extractionType enum values */
      /** WHY: STRP Rule 5 (structural-reconciliation.ts:236) fills missing extractionType on controllable factors */
      "extractionType",
      /** WHY: STRP Rule 1 (structural-reconciliation.ts:181) fills uncertainty_drivers when reclassifying TO controllable */
      /** WHY: STRP Rule 5 (structural-reconciliation.ts:251) fills missing uncertainty_drivers on controllable factors */
      "uncertainty_drivers",
    ] as string[],
  },

  /**
   * Critical invariants — cannot be changed or dropped.
   * A violation of any field here is always a contract error regardless of
   * allowedDrops/allowedModifications.
   */
  preservationGuarantees: {
    topLevel: [
      /** graph version and seed are identity fields — normalise must not touch them */
      "version",
      "default_seed",
    ] as string[],
    node: [
      /** WHY: node identity — STRP only changes category, never id/kind/label */
      "id",
      "kind",
      "label",
    ] as string[],
    edge: [
      /** WHY: normalise never rewires edges — only strength_mean and effect_direction are modified */
      "from",
      "to",
      "strength_std",
      "belief_exists",
    ] as string[],
    option: [] as string[],
    nodeData: [] as string[],
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
