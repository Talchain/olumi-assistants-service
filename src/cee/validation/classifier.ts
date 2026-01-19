import type { components } from "../../generated/openapi.d.ts";
import { log } from "../../utils/telemetry.js";

// Shared CEE types from OpenAPI
export type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

export type CeeSeverity = "error" | "warning" | "info";

// ERROR - Blocks engine execution
const ERROR_CODES = [
  "LIMIT_EXCEEDED",
  "CIRCULAR_DEPENDENCY",
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
] as const;

// WARNING - Degrades quality but runs
const WARNING_CODES = [
  "MISSING_EVIDENCE",
  "LOW_CONFIDENCE",
  "POTENTIAL_COLLIDER",
  "OUTCOME_ORPHAN",
  "HIGH_EDGE_DENSITY",
  "STALE_EVIDENCE", // Evidence is too old but still usable
  // V4 topology warnings (promoted to ERROR when strictTopologyValidation enabled)
  "INVALID_EDGE_TYPE",
  "INVALID_FACTOR_TO_CONTROLLABLE",
  "STRENGTH_OUT_OF_RANGE",
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

export function createValidationIssue(input: {
  code: string;
  message?: string;
  field?: string;
  details?: Record<string, unknown>;
  // Optional explicit severity override; when omitted we derive it from the code.
  severityOverride?: CeeSeverity;
}): CEEValidationIssue {
  const severity = input.severityOverride ?? classifyIssueSeverity(input.code);

  const issue: CEEValidationIssue = {
    code: input.code,
    severity,
    ...(input.field ? { field: input.field } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(input.details ? { details: input.details } : {}),
  };

  return issue;
}
