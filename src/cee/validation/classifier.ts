import type { components } from "../../generated/openapi.d.ts";
import { log } from "../../utils/telemetry.js";

// Shared CEE types from OpenAPI
export type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

export type CeeSeverity = "error" | "warning" | "info";

/**
 * Structural warning severity levels for CEEStructuralWarningV1.
 * Used for draft_warnings[] in the response.
 */
export type StructuralWarningSeverity = "low" | "medium" | "high" | "blocker";

/**
 * Canonical severity rank for structural warnings.
 * Use this for all severity comparisons to ensure consistent ordering.
 * blocker > high > medium > low
 */
export function severityRank(severity: StructuralWarningSeverity): number {
  switch (severity) {
    case "blocker": return 3;
    case "high": return 2;
    case "medium": return 1;
    case "low": return 0;
    default: {
      // Exhaustive check - this ensures we handle all cases
      const _exhaustive: never = severity;
      return 0;
    }
  }
}

/**
 * Compare two structural warning severities.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function compareSeverity(a: StructuralWarningSeverity, b: StructuralWarningSeverity): number {
  return severityRank(a) - severityRank(b);
}

// ERROR - Blocks engine execution
const ERROR_CODES = [
  "LIMIT_EXCEEDED",
  "CIRCULAR_DEPENDENCY",
  "GRAPH_CONTAINS_CYCLE", // Spec-aligned cycle detection code
  "SELF_LOOP_DETECTED",
  "BIDIRECTIONAL_EDGE",
  "MISSING_REQUIRED_NODE",
  "INVALID_WEIGHT_RANGE",
  "INVALID_BELIEF_RANGE",
  "INVALID_STRENGTH_STD",
  "INVALID_BELIEF_EXISTS",
  "SCHEMA_VALIDATION_ERROR",
  "GOAL_NODE_MISSING",
  "DUPLICATE_NODE_ID",
  "INVALID_NODE_ID",
  "EDGE_FROM_NOT_FOUND",
  "EDGE_TO_NOT_FOUND",
  "DUPLICATE_OPTION_ID",
  "INVALID_OPTION_ID",
  "OPTION_NOT_READY",
  "INVALID_INTERVENTION_TARGET",
  // Topology errors - always block execution per spec
  "INVALID_EDGE_TYPE",
  "INVALID_FACTOR_TO_CONTROLLABLE",
  "STRENGTH_OUT_OF_RANGE",
] as const;

// WARNING - Degrades quality but runs
const WARNING_CODES = [
  "MISSING_EVIDENCE",
  "LOW_CONFIDENCE",
  "POTENTIAL_COLLIDER",
  "OUTCOME_ORPHAN",
  "HIGH_EDGE_DENSITY",
  "STALE_EVIDENCE", // Evidence is too old but still usable
  // V6.0.2 structural warnings
  "GOAL_NODE_WRONG_KIND",
  "DECISION_HAS_INCOMING_EDGES",
  "OUTCOME_NO_OUTGOING_EDGE",
  "RISK_NO_OUTGOING_EDGE",
  "OUTCOME_NOT_CONNECTED_TO_GOAL",
  "RISK_NOT_CONNECTED_TO_GOAL",
  "EFFECT_DIRECTION_MISMATCH",
  "UNIFORM_STRENGTHS",
  "OPTION_ID_MISMATCH",
  "IDENTICAL_OPTION_INTERVENTIONS",
  "EMPTY_INTERVENTIONS_READY",
  "INTERVENTION_TARGET_NO_PATH",
  "INTERVENTION_NO_EDGE",
  "EDGE_NO_INTERVENTION",
  "INTERVENTION_KEY_MISMATCH",
  // Pre-analysis validation warnings
  "STRENGTH_CLUSTERING", // Edge strengths have low variance (CV < 0.3)
  "SAME_LEVER_OPTIONS", // Options share >60% intervention targets
  "MISSING_BASELINE", // No status quo option detected
  "GOAL_NO_BASELINE_VALUE", // Goal node has no observed_state.value
  "GOAL_DISCONNECTED", // No path from options to goal
  "GOAL_CONNECTIVITY_NONE", // No options connected to goal (blocker severity)
  "NORMALISATION_INPUT_INSUFFICIENT", // Insufficient data for intervention normalisation
  "RANGE_DEGENERATE", // Intervention range is degenerate (min == max)
] as const;

// INFO - Suggestions for improvement
const INFO_CODES = [
  "CONSIDER_CONFOUNDER",
  "ASYMMETRIC_OPTIONS",
  "MISSING_RISK_NODE",
  "COULD_ADD_FACTOR",
  // V4 quality suggestions
  "NEGLIGIBLE_STRENGTH",
  "UNIFORM_DIRECTION",
  "OUTCOME_MULTIPLE_OUTGOING_EDGES",
  "RISK_MULTIPLE_OUTGOING_EDGES",
  "MISSING_USER_QUESTIONS",
  // Observability info codes
  "EDGE_ORIGIN_DEFAULTED", // Edge origin was not set, defaulted to 'ai'
] as const;

const ERROR_CODE_SET = new Set<string>(ERROR_CODES);
const WARNING_CODE_SET = new Set<string>(WARNING_CODES);
const INFO_CODE_SET = new Set<string>(INFO_CODES);

export function classifyIssueSeverity(code: string | undefined | null): CeeSeverity {
  const normalized = typeof code === "string" ? code.toUpperCase() : "";

  if (ERROR_CODE_SET.has(normalized)) return "error";
  if (WARNING_CODE_SET.has(normalized)) return "warning";
  if (INFO_CODE_SET.has(normalized)) return "info";

  // Defensive default: unknown codes are treated as warnings so they do not block execution.
  if (normalized) {
    log.warn({ code: normalized }, "Unknown validation code encountered in CEE");
  }
  return "warning";
}

export interface CeeValidationResult {
  validation_issues: CEEValidationIssue[];
  has_errors: boolean;
  has_warnings: boolean;
  error_count: number;
  warning_count: number;
  info_count: number;
}

export function summariseValidationIssues(issues: CEEValidationIssue[]): CeeValidationResult {
  let error_count = 0;
  let warning_count = 0;
  let info_count = 0;

  for (const issue of issues) {
    const sev = issue?.severity as CeeSeverity | undefined;
    if (sev === "error") {
      error_count += 1;
    } else if (sev === "warning") {
      warning_count += 1;
    } else if (sev === "info") {
      info_count += 1;
    }
  }

  return {
    validation_issues: issues,
    has_errors: error_count > 0,
    has_warnings: warning_count > 0,
    error_count,
    warning_count,
    info_count,
  };
}

/**
 * Deterministic suggestion mappings for validation codes.
 * These provide actionable fix guidance for common issues.
 */
const SUGGESTION_MAP: Record<string, string> = {
  // ERROR codes
  LIMIT_EXCEEDED: "Reduce graph complexity — split into sub-models or remove less critical nodes",
  CIRCULAR_DEPENDENCY: "Break the dependency cycle by removing one edge in the loop",
  GRAPH_CONTAINS_CYCLE: "Break cycle by removing one edge — CEE graphs must be DAGs",
  SELF_LOOP_DETECTED: "Remove self-referential edge — nodes cannot influence themselves",
  BIDIRECTIONAL_EDGE: "Remove one direction to maintain DAG structure",
  MISSING_REQUIRED_NODE: "Add the required node type to complete the graph structure",
  INVALID_WEIGHT_RANGE: "Adjust weight to be within valid range",
  INVALID_BELIEF_RANGE: "Ensure belief value is between 0 and 1",
  INVALID_STRENGTH_STD: "strength_std must be positive (> 0)",
  INVALID_BELIEF_EXISTS: "belief_exists must be in [0, 1] range",
  SCHEMA_VALIDATION_ERROR: "Fix the schema violation — check field types and required properties",
  GOAL_NODE_MISSING: "Add a goal node or ensure goal_node_id references an existing node",
  DUPLICATE_NODE_ID: "Ensure all node IDs are unique",
  INVALID_NODE_ID: "Use IDs starting with a letter followed by alphanumeric characters, underscores, or hyphens",
  EDGE_FROM_NOT_FOUND: "Ensure the edge 'from' node exists in the graph",
  EDGE_TO_NOT_FOUND: "Ensure the edge 'to' node exists in the graph",
  DUPLICATE_OPTION_ID: "Ensure all option IDs are unique",
  INVALID_OPTION_ID: "Use option IDs with only lowercase letters, numbers, underscores, colons, and hyphens",
  OPTION_NOT_READY: "Complete the option configuration or set status to 'needs_user_mapping'",
  INVALID_INTERVENTION_TARGET: "Ensure intervention targets an existing factor node",
  INVALID_EDGE_TYPE: "Use only allowed edge patterns: decision→option, option→factor, factor→outcome/risk/factor, outcome/risk→goal",
  INVALID_FACTOR_TO_CONTROLLABLE: "Controllable factors should only be set by interventions, not influenced by other factors",
  STRENGTH_OUT_OF_RANGE: "Clamp value to [-1, +1] range",

  // WARNING codes
  MISSING_EVIDENCE: "Add supporting evidence or data sources for the causal relationship",
  LOW_CONFIDENCE: "Review the relationship — consider adding more evidence or adjusting strength",
  POTENTIAL_COLLIDER: "Review node structure — colliders can bias causal inference if not handled correctly",
  OUTCOME_ORPHAN: "Connect the outcome node to the goal or remove if unused",
  HIGH_EDGE_DENSITY: "Consider simplifying the graph — high density may indicate redundant relationships",
  STALE_EVIDENCE: "Update evidence with more recent data if available",
  GOAL_NODE_WRONG_KIND: "Set the goal node kind to 'goal' or update goal_node_id",
  DECISION_HAS_INCOMING_EDGES: "Remove incoming edges from decision nodes — decisions should be root nodes",
  OUTCOME_NO_OUTGOING_EDGE: "Connect outcome node to the goal node",
  RISK_NO_OUTGOING_EDGE: "Connect risk node to the goal node",
  OUTCOME_NOT_CONNECTED_TO_GOAL: "Ensure outcome nodes connect directly to the goal",
  RISK_NOT_CONNECTED_TO_GOAL: "Ensure risk nodes connect directly to the goal",
  EFFECT_DIRECTION_MISMATCH: "Ensure effect_direction matches the sign of strength_mean",
  UNIFORM_STRENGTHS: "Review edge strengths — different relationships should have different effect sizes",
  OPTION_ID_MISMATCH: "Ensure options[] IDs match option node IDs in the graph",
  IDENTICAL_OPTION_INTERVENTIONS: "Options must differ in at least one intervention value",
  EMPTY_INTERVENTIONS_READY: "Add interventions or change status to 'needs_user_mapping'",
  INTERVENTION_TARGET_NO_PATH: "Ensure intervention target has a path to the goal node",
  INTERVENTION_NO_EDGE: "Remove intervention or add option→factor edge — interventions must have structural support",
  EDGE_NO_INTERVENTION: "Add intervention for this edge target or remove the option→factor edge",
  INTERVENTION_KEY_MISMATCH: "Ensure intervention key matches target_match.node_id — they must be identical",
  INTERVENTION_TARGET_NOT_FOUND: "Ensure intervention target node exists in the graph",
  INTERVENTION_TARGET_NOT_FACTOR: "Interventions should target factor nodes",
  INTERVENTION_TARGET_DISCONNECTED: "Connect intervention target to the goal via causal path",
  INTERVENTION_VALUE_NOT_NUMERIC: "Intervention values must be numeric",

  // INFO codes
  CONSIDER_CONFOUNDER: "Consider whether unmeasured confounders affect this relationship",
  ASYMMETRIC_OPTIONS: "Options have unbalanced intervention counts — consider equalizing",
  MISSING_RISK_NODE: "Consider adding risk nodes to model potential negative outcomes",
  COULD_ADD_FACTOR: "Consider adding intermediate factors for more nuanced modeling",
  NEGLIGIBLE_STRENGTH: "Edge has minimal effect — consider removing to simplify the model",
  UNIFORM_DIRECTION: "All edges are same direction — verify this reflects real relationships",
  OUTCOME_MULTIPLE_OUTGOING_EDGES: "Outcome nodes should have exactly one outgoing edge to goal",
  RISK_MULTIPLE_OUTGOING_EDGES: "Risk nodes should have exactly one outgoing edge to goal",
  MISSING_USER_QUESTIONS: "Add user_questions to guide data collection for unresolved targets",
  UNIT_MISMATCH_SUSPECTED: "Verify intervention and target units are compatible",
  LOW_CONFIDENCE_MATCH: "Review the target mapping for accuracy",
  DISCONNECTED_NODE: "Connect node to graph or remove it",
  // Pre-analysis validation warnings
  STRENGTH_CLUSTERING: "Review edge strengths — low variance suggests estimates may be rough approximations",
  SAME_LEVER_OPTIONS: "Options share most intervention targets — consider differentiating approaches",
  MISSING_BASELINE: "Add a status quo option to enable comparison with no action",
  GOAL_NO_BASELINE_VALUE: "Set goal node's observed_state.value to establish baseline for comparison",
  GOAL_DISCONNECTED: "Ensure all options have a causal path to the goal node",
  GOAL_CONNECTIVITY_NONE: "Connect each option to the goal via at least one factor or edge",
  NORMALISATION_INPUT_INSUFFICIENT: "Provide explicit ranges for interventions to enable normalisation",
  RANGE_DEGENERATE: "Intervention min equals max — provide a valid range for sensitivity analysis",
  // Observability info codes
  EDGE_ORIGIN_DEFAULTED: "Edge origin was not specified — defaulted to 'ai' for LLM-generated edges",
};

/**
 * Get deterministic suggestion for a validation code.
 */
export function getSuggestionForCode(code: string): string | undefined {
  return SUGGESTION_MAP[code.toUpperCase()];
}

export function createValidationIssue(input: {
  code: string;
  message?: string;
  field?: string;
  details?: Record<string, unknown>;
  suggestion?: string;
  affected_node_id?: string;
  affected_edge_id?: string;
  stage?: string;
  // Optional explicit severity override; when omitted we derive it from the code.
  severityOverride?: CeeSeverity;
}): CEEValidationIssue {
  const severity = input.severityOverride ?? classifyIssueSeverity(input.code);

  // Use provided suggestion or fall back to deterministic mapping
  const suggestion = input.suggestion ?? getSuggestionForCode(input.code);

  const issue: CEEValidationIssue = {
    code: input.code,
    severity,
    ...(input.field ? { field: input.field } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(suggestion ? { suggestion } : {}),
    ...(input.details ? { details: input.details } : {}),
    // Store affected_node_id, affected_edge_id, stage in meta for API compatibility
    meta: {
      ...(input.affected_node_id ? { affected_node_id: input.affected_node_id } : {}),
      ...(input.affected_edge_id ? { affected_edge_id: input.affected_edge_id } : {}),
      ...(input.stage ? { stage: input.stage } : {}),
    },
  };

  // Clean up empty meta object
  if (issue.meta && Object.keys(issue.meta).length === 0) {
    delete issue.meta;
  }

  return issue;
}
