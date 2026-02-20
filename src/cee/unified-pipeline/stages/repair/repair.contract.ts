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
    node: [
      // Goal threshold drops moved to Stage 4b (threshold-sweep.contract.ts)
    ] as string[],
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
    node: [
      /** WHY: fixCategoryMismatch (deterministic-sweep.ts:325) and late STRP Rule 1 reclassify factor categories */
      "category",
      /** WHY: connectivity.ts may change kind when inferring missing goal node */
      "kind",
      /** WHY: goal-merge (structure/index.ts:312) combines labels when merging multiple goals into one */
      "label",
    ] as string[],
    edge: [
      /** WHY: enforceStableEdgeIds (graph-determinism.ts:33) assigns deterministic from::to::index IDs */
      "id",
      /** WHY: goal-merge (structure/index.ts:370-376) redirects edges pointing to merged-away goals */
      "from",
      /** WHY: goal-merge (structure/index.ts:370-376) redirects edges pointing to merged-away goals */
      "to",
      /** WHY: fixNanValues (deterministic-sweep.ts:95) replaces NaN with 0.5 */
      /** WHY: fixSignMismatch (deterministic-sweep.ts:143) flips sign to match effect_direction */
      "strength_mean",
      /** WHY: fixNanValues (deterministic-sweep.ts:100) replaces NaN with 0.1 */
      "strength_std",
      /** WHY: fixNanValues (deterministic-sweep.ts:105) replaces NaN with 0.8 */
      "belief_exists",
      /** WHY: late STRP Rule 4 (structural-reconciliation.ts:676) reconciles direction with sign */
      "effect_direction",
      /** WHY: edge-restoration (edge-identity.ts:151) restores provenance from stash */
      "provenance",
    ] as string[],
    option: [] as string[],
    nodeData: [
      /** WHY: fixControllableMissingData (deterministic-sweep.ts:356) fills default value */
      "value",
      /** WHY: fixControllableMissingData (deterministic-sweep.ts:364) fills default factor_type */
      /** WHY: late STRP Rule 1 (structural-reconciliation.ts:178) fills factor_type on reclassification */
      "factor_type",
      /** WHY: fixControllableMissingData (deterministic-sweep.ts:367) fills default uncertainty_drivers */
      /** WHY: late STRP Rule 1 (structural-reconciliation.ts:181) fills uncertainty_drivers on reclassification */
      "uncertainty_drivers",
      /** WHY: Collateral value change when node.data is partially reconstructed */
      "baseline",
    ] as string[],
  },

  /**
   * Critical invariants — cannot be changed or dropped.
   * A violation of any field here is always a contract error regardless of
   * allowedDrops/allowedModifications.
   */
  preservationGuarantees: {
    topLevel: [
      /** graph version and seed are identity fields — repair must not touch them */
      "version",
      "default_seed",
    ] as string[],
    node: [
      /** WHY: no repair substep reassigns existing node IDs — enforceStableEdgeIds only sorts nodes by id */
      "id",
    ] as string[],
    edge: [] as string[],
    option: [] as string[],
    nodeData: [] as string[],
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
