/**
 * Compound Goal Extraction Module (Phase 3)
 *
 * Extracts compound goals from natural language briefs and emits:
 * - goal_constraints[] array for direct PLoT consumption
 * - constraint nodes with explicit operators for graph integration
 *
 * Follows PLoT Phase 1 T6 requirements:
 * - Constraint nodes have kind: 'constraint'
 * - Threshold in observed_state.value
 * - Explicit operator in observed_state.metadata.operator AND data.operator
 * - ASCII operators only: >= and <=
 */

export {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
  remapConstraintTargets,
  CONSTRAINT_ALIASES,
  type CompoundGoalExtractionResult,
  type ExtractedGoalConstraint,
  type RemapResult,
} from "./extractor.js";

export {
  generateConstraintNodes,
  generateConstraintEdge,
  generateConstraintEdges,
  constraintNodesToGraphNodes,
  constraintEdgesToGraphEdges,
  isConstraintNodeId,
  getConstraintTargetId,
  type ConstraintNode,
  type ConstraintEdge,
} from "./node-generator.js";

export {
  extractDeadline,
  type DeadlineExtractionResult,
} from "./deadline-extractor.js";

export {
  mapQualitativeToProxy,
  type QualitativeProxyResult,
  QUALITATIVE_PROXY_MAPPINGS,
} from "./qualitative-proxy.js";
