/**
 * Stage 4 (Repair) — field preservation contract.
 *
 * Rule: "Fields present at stage input must be present at stage output
 * unless the stage's contract explicitly declares the drop."
 *
 * Populated by reading all 10 repair substeps.
 */

export const STAGE_CONTRACT = {
  name: "repair",

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
      /** WHY: fixExternalHasData (deterministic-sweep.ts) strips value from external factors */
      /** WHY: handleUnreachableFactors (unreachable-factors.ts) strips value when reclassifying to external */
      "value",
      /** WHY: fixExternalHasData + fixObservableExtraData (deterministic-sweep.ts) strip factor_type */
      /** WHY: handleUnreachableFactors (unreachable-factors.ts) strips factor_type when reclassifying to external */
      /** WHY: Late STRP Rule 1 (reconcileStructuralTruth) drops factor_type on reclassification */
      "factor_type",
      /** WHY: fixExternalHasData + fixObservableExtraData (deterministic-sweep.ts) strip uncertainty_drivers */
      /** WHY: handleUnreachableFactors (unreachable-factors.ts) strips uncertainty_drivers when reclassifying */
      /** WHY: Late STRP Rule 1 (reconcileStructuralTruth) drops uncertainty_drivers on reclassification */
      "uncertainty_drivers",
      /** WHY: Collateral drop when node.data is cleared entirely for external factors
       *  (no union-surviving key remains after value/factor_type/uncertainty_drivers are stripped) */
      "baseline",
    ] as string[],
  },

  /**
   * Whether the stage can clear entire `node.data` objects.
   *
   * **Supersedes `allowedDrops.nodeData`**: when `allowedDataClear` applies,
   * ALL data fields (including those not listed in `allowedDrops.nodeData`,
   * e.g. `baseline` or unknown custom fields) are lost as collateral.
   * Contract tests should skip per-field assertions on affected nodes.
   *
   * fixExternalHasData (deterministic-sweep.ts:498-502) and
   * handleUnreachableFactors (unreachable-factors.ts:244-247) both clear
   * `node.data` entirely when remaining fields can't satisfy any NodeData
   * union branch (no `interventions`, `operator`, or `value`).
   *
   * NodeData union branches (schemas/graph.ts):
   *   OptionData requires `interventions`, ConstraintNodeData requires `operator`,
   *   FactorData requires `value`. When none of these keys survive, data is cleared.
   *
   * This only applies to external factors after field stripping.
   */
  allowedDataClear: {
    externalFactors: true,
  },

  /**
   * Fields that the stage may MODIFY (change value but still present).
   * Presence is still required — only the value may differ.
   */
  allowedModifications: {
    topLevel: [] as string[],
    node: ["id", "category", "kind"] as string[],
    edge: [
      "id", "from", "to",
      "strength_mean", "strength_std", "belief_exists",
      "effect_direction", "provenance",
    ] as string[],
    option: [] as string[],
    nodeData: ["value", "factor_type", "uncertainty_drivers", "baseline"] as string[],
  },

  /**
   * Whether entire nodes or edges can be removed (count decrease).
   * Repair CAN remove edges (invalid refs in deterministic sweep)
   * and CAN add nodes/edges (status quo, goal inference, connectivity).
   */
  allowedRemovals: {
    nodes: false,
    edges: true,
  },
} as const;
