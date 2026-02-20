/**
 * Stage 4b (Threshold Sweep) — field preservation contract.
 *
 * The sweep only touches goal nodes and only deletes the 4 threshold fields.
 * Everything else must survive unchanged.
 */

export const STAGE_CONTRACT = {
  name: "threshold-sweep",

  /**
   * Fields that the stage is allowed to DELETE from the output.
   * Any field drop NOT listed here is a contract violation.
   */
  allowedDrops: {
    topLevel: [] as string[],
    node: [
      /** WHY: Step 4b (threshold-sweep.ts) strips goal_threshold when goal_threshold_raw is absent */
      /** WHY: Step 4b-iii (threshold-sweep.ts) strips goal_threshold on qualitative goals with fabricated thresholds */
      "goal_threshold",
      /** WHY: Step 4b/4b-iii (threshold-sweep.ts) strips goal_threshold_raw alongside goal_threshold */
      "goal_threshold_raw",
      /** WHY: Step 4b/4b-iii (threshold-sweep.ts) strips goal_threshold_unit alongside goal_threshold */
      "goal_threshold_unit",
      /** WHY: Step 4b/4b-iii (threshold-sweep.ts) strips goal_threshold_cap alongside goal_threshold */
      "goal_threshold_cap",
    ] as string[],
    edge: [] as string[],
    option: [] as string[],
    nodeData: [] as string[],
  },

  /**
   * Fields the stage is allowed to CHANGE in value (but not remove).
   * The sweep never modifies values — it only deletes.
   */
  allowedModifications: {
    topLevel: [] as string[],
    node: [] as string[],
    edge: [] as string[],
    option: [] as string[],
    nodeData: [] as string[],
  },

  /**
   * Fields guaranteed to be PRESENT and UNCHANGED after the stage.
   * Violation of any guarantee is always a bug.
   */
  preservationGuarantees: {
    topLevel: [
      /** WHY: sweep never touches top-level graph metadata */
      "version",
      "default_seed",
    ] as string[],
    node: [
      /** WHY: sweep only strips threshold fields — identity, kind, label are never touched */
      "id",
      "kind",
      "label",
    ] as string[],
    edge: [
      /** WHY: sweep never touches edges */
      "from",
      "to",
      "strength_mean",
      "strength_std",
      "belief_exists",
      "effect_direction",
    ] as string[],
    option: [] as string[],
    nodeData: [] as string[],
  },

  /**
   * Whether the stage is allowed to remove entire nodes or edges.
   * Threshold sweep never removes nodes or edges.
   */
  allowedRemovals: {
    nodes: false,
    edges: false,
  },
} as const;
