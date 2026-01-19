import type { components } from "../../generated/openapi.d.ts";
import { log } from "../../utils/telemetry.js";

// Shared CEE types from OpenAPI
export type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

export type CeeSeverity = "error" | "warning" | "info";

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
  STRENGTH_OUT_OF_RANGE: "Clamp value to [-1, +1] range",
  SELF_LOOP_DETECTED: "Remove self-referential edge",
  GRAPH_CONTAINS_CYCLE: "Break cycle by removing one edge",
  DISCONNECTED_NODE: "Connect node to graph or remove it",
  BIDIRECTIONAL_EDGE: "Remove one direction to maintain DAG structure",
  INVALID_EDGE_TYPE: "Use only allowed edge patterns: decision→option, option→factor, factor→outcome/risk/factor, outcome/risk→goal",
  INVALID_FACTOR_TO_CONTROLLABLE: "Controllable factors should only be set by interventions, not influenced by other factors",
  DUPLICATE_NODE_ID: "Ensure all node IDs are unique",
  INVALID_NODE_ID: "Use IDs starting with a letter followed by alphanumeric characters, underscores, or hyphens",
  GOAL_NODE_MISSING: "Add a goal node or ensure goal_node_id references an existing node",
  EMPTY_INTERVENTIONS_READY: "Add interventions or change status to 'needs_user_mapping'",
  UNIFORM_STRENGTHS: "Review edge strengths — different relationships should have different effect sizes",
  EFFECT_DIRECTION_MISMATCH: "Ensure effect_direction matches the sign of strength_mean",
  INVALID_STRENGTH_STD: "strength_std must be positive",
  INVALID_BELIEF_EXISTS: "belief_exists must be in [0, 1] range",
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
