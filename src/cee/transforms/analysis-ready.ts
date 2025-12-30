/**
 * Analysis-Ready Transformer
 *
 * Transforms V3 options to analysis-ready format for direct PLoT consumption.
 *
 * Key transformation:
 * - V3: interventions: Record<string, InterventionV3> (objects with metadata)
 * - Analysis-ready: interventions: Record<string, number> (plain numbers)
 *
 * @see CEE Workstream — Analysis-Ready Output (Complete Specification)
 */

import type {
  OptionV3T,
  NodeV3T,
  GraphV3T,
} from "../../schemas/cee-v3.js";
import type {
  OptionForAnalysisT,
  AnalysisReadyPayloadT,
  ExtractionMetadataT,
} from "../../schemas/analysis-ready.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Validation error for analysis-ready payload.
 */
export interface AnalysisReadyValidationError {
  code: string;
  message: string;
  field?: string;
}

/**
 * Validation result for analysis-ready payload.
 */
export interface AnalysisReadyValidationResult {
  valid: boolean;
  errors: AnalysisReadyValidationError[];
}

// ============================================================================
// Option Transformation
// ============================================================================

/**
 * Transform a V3 option to analysis-ready format.
 * Flattens InterventionV3 objects to plain numeric values.
 */
export function transformOptionToAnalysisReady(option: OptionV3T): OptionForAnalysisT {
  // Flatten interventions: Record<string, InterventionV3> -> Record<string, number>
  const interventions: Record<string, number> = {};

  for (const [factorId, intervention] of Object.entries(option.interventions)) {
    // Extract just the numeric value
    interventions[factorId] = intervention.value;
  }

  // Build extraction metadata from first intervention's source/confidence
  let extractionMetadata: ExtractionMetadataT | undefined;
  const firstIntervention = Object.values(option.interventions)[0];
  if (firstIntervention) {
    extractionMetadata = {
      source: firstIntervention.source,
      confidence: firstIntervention.value_confidence ?? firstIntervention.target_match.confidence,
      reasoning: firstIntervention.reasoning,
    };
  } else if (option.provenance) {
    // Fallback to option provenance
    extractionMetadata = {
      source: option.provenance.source,
      confidence: "low",
      reasoning: option.provenance.brief_quote,
    };
  }

  // Determine status: ready if has interventions, otherwise needs_user_mapping
  // Interventions are the source of truth - if we extracted values, it's ready
  const status: "ready" | "needs_user_mapping" =
    Object.keys(interventions).length > 0
      ? "ready"
      : (option.status ?? "needs_user_mapping");

  return {
    id: option.id,
    label: option.label,
    status,
    interventions,
    extraction_metadata: extractionMetadata,
  };
}

// ============================================================================
// Payload Transformation
// ============================================================================

/**
 * Context for building analysis-ready payload.
 */
export interface AnalysisReadyContext {
  /** Suggested seed for reproducibility */
  seed?: string;
  /** Request ID for tracing */
  requestId?: string;
}

/**
 * Build analysis-ready payload from V3 options and graph.
 *
 * @param options - V3 options array
 * @param goalNodeId - Goal node ID
 * @param graph - V3 graph (for validation)
 * @param context - Optional context
 * @returns Analysis-ready payload
 */
export function buildAnalysisReadyPayload(
  options: OptionV3T[],
  goalNodeId: string,
  graph: GraphV3T,
  context: AnalysisReadyContext = {}
): AnalysisReadyPayloadT {
  // Transform all options
  const analysisOptions = options.map(transformOptionToAnalysisReady);

  // Determine status based on options
  // Status is "ready" if all options have at least one intervention
  // Status is "needs_user_mapping" if any option has empty interventions OR status is needs_user_mapping
  const hasIncompleteOptions = options.some(
    (o) => o.status === "needs_user_mapping" || Object.keys(o.interventions).length === 0
  );

  // Collect user questions from options that need mapping
  const userQuestions: string[] = [];
  for (const option of options) {
    if (option.user_questions) {
      userQuestions.push(...option.user_questions);
    }
  }

  // Deduplicate user questions
  const uniqueQuestions = [...new Set(userQuestions)];

  // Generate fallback questions for incomplete options without explicit questions
  // This ensures the payload passes validation (needs_user_mapping requires user_questions)
  if (hasIncompleteOptions && uniqueQuestions.length === 0) {
    const incompleteOptionLabels = options
      .filter((o) => o.status === "needs_user_mapping" || Object.keys(o.interventions).length === 0)
      .map((o) => o.label)
      .slice(0, 3); // Limit to first 3 for readability

    if (incompleteOptionLabels.length > 0) {
      uniqueQuestions.push(
        `Which factors and values should be specified for: ${incompleteOptionLabels.join(", ")}?`
      );
    } else {
      // Fallback if somehow we have no labels
      uniqueQuestions.push("What factor values should be used for the incomplete options?");
    }
  }

  const payload: AnalysisReadyPayloadT = {
    options: analysisOptions,
    goal_node_id: goalNodeId,
    suggested_seed: context.seed ?? "42",
    status: hasIncompleteOptions ? "needs_user_mapping" : "ready",
  };

  // Add user_questions when status is needs_user_mapping
  // (uniqueQuestions is guaranteed to be non-empty due to fallback above)
  if (payload.status === "needs_user_mapping") {
    payload.user_questions = uniqueQuestions;
  }

  // Emit telemetry
  emit(TelemetryEvents.AnalysisReadyBuilt ?? "cee.analysis_ready.built", {
    optionCount: analysisOptions.length,
    status: payload.status,
    userQuestionCount: uniqueQuestions.length,
    goalNodeId,
    requestId: context.requestId,
  });

  return payload;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate analysis-ready payload against graph and V3 options.
 *
 * Rules from spec:
 * 1. All option IDs in payload must match V3 options (cross-check)
 * 2. Goal node must exist in graph where kind="goal"
 * 3. All intervention factor IDs must exist in graph nodes where kind="factor"
 * 4. Intervention values must be numbers (enforced by type)
 * 5. Status consistency: needs_user_mapping requires user_questions
 *
 * @param payload - Analysis-ready payload to validate
 * @param graph - V3 graph for node validation
 * @param v3Options - Optional V3 options for cross-checking option IDs
 */
export function validateAnalysisReadyPayload(
  payload: AnalysisReadyPayloadT,
  graph: GraphV3T,
  v3Options?: OptionV3T[]
): AnalysisReadyValidationResult {
  const errors: AnalysisReadyValidationError[] = [];

  // Build lookup sets for efficient validation
  const factorNodeIds = new Set(
    graph.nodes.filter((n) => n.kind === "factor").map((n) => n.id)
  );
  const goalNodeIds = new Set(
    graph.nodes.filter((n) => n.kind === "goal").map((n) => n.id)
  );
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));
  const nodeKindMap = new Map(graph.nodes.map((n) => [n.id, n.kind]));

  // Rule 1: Option IDs must match V3 options (if provided)
  if (v3Options) {
    const v3OptionIds = new Set(v3Options.map((o) => o.id));
    for (const option of payload.options) {
      if (!v3OptionIds.has(option.id)) {
        errors.push({
          code: "OPTION_ID_MISMATCH",
          message: `Option "${option.id}" in analysis_ready not found in V3 options`,
          field: `options[${option.id}].id`,
        });
      }
    }
  }

  // Rule 2: Goal node must exist with kind="goal"
  if (!goalNodeIds.has(payload.goal_node_id)) {
    // Check if it exists at all but with wrong kind
    if (allNodeIds.has(payload.goal_node_id)) {
      const nodeKind = nodeKindMap.get(payload.goal_node_id);
      errors.push({
        code: "GOAL_NODE_WRONG_KIND",
        message: `Goal node "${payload.goal_node_id}" exists but has kind="${nodeKind}" instead of "goal"`,
        field: "goal_node_id",
      });
    } else {
      errors.push({
        code: "GOAL_NODE_NOT_FOUND",
        message: `Goal node "${payload.goal_node_id}" not found in graph`,
        field: "goal_node_id",
      });
    }
  }

  // Rule 3: All intervention factor IDs must exist with kind="factor"
  for (const option of payload.options) {
    for (const factorId of Object.keys(option.interventions)) {
      if (!factorNodeIds.has(factorId)) {
        // Check if it exists at all but with wrong kind
        if (allNodeIds.has(factorId)) {
          const nodeKind = nodeKindMap.get(factorId);
          errors.push({
            code: "INTERVENTION_TARGET_WRONG_KIND",
            message: `Intervention target "${factorId}" in option "${option.id}" has kind="${nodeKind}" instead of "factor"`,
            field: `options[${option.id}].interventions.${factorId}`,
          });
        } else {
          errors.push({
            code: "INTERVENTION_FACTOR_NOT_FOUND",
            message: `Factor "${factorId}" in option "${option.id}" not found in graph`,
            field: `options[${option.id}].interventions.${factorId}`,
          });
        }
      }
    }
  }

  // Rule 4: Intervention values must be numbers
  for (const option of payload.options) {
    for (const [factorId, value] of Object.entries(option.interventions)) {
      if (typeof value !== "number") {
        errors.push({
          code: "INTERVENTION_NOT_NUMBER",
          message: `Intervention "${factorId}" in option "${option.id}" is not a number: ${typeof value}`,
          field: `options[${option.id}].interventions.${factorId}`,
        });
      }
      if (value === null || value === undefined || Number.isNaN(value)) {
        errors.push({
          code: "INTERVENTION_INVALID_NUMBER",
          message: `Intervention "${factorId}" in option "${option.id}" has invalid number: ${value}`,
          field: `options[${option.id}].interventions.${factorId}`,
        });
      }
    }
  }

  // Rule 5: Status consistency
  const hasEmptyInterventions = payload.options.some(
    (o) => Object.keys(o.interventions).length === 0
  );

  if (hasEmptyInterventions && payload.status === "ready") {
    errors.push({
      code: "STATUS_INCONSISTENT",
      message: "Status is 'ready' but some options have empty interventions",
      field: "status",
    });
  }

  if (payload.status === "needs_user_mapping" && (!payload.user_questions || payload.user_questions.length === 0)) {
    errors.push({
      code: "MISSING_USER_QUESTIONS",
      message: "Status is 'needs_user_mapping' but no user_questions provided",
      field: "user_questions",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate and log results, emitting telemetry on failure.
 *
 * @param payload - Analysis-ready payload to validate
 * @param graph - V3 graph for node validation
 * @param v3Options - Optional V3 options for cross-checking option IDs
 * @param requestId - Optional request ID for tracing
 */
export function validateAndLogAnalysisReady(
  payload: AnalysisReadyPayloadT,
  graph: GraphV3T,
  v3Options?: OptionV3T[],
  requestId?: string
): AnalysisReadyValidationResult {
  const result = validateAnalysisReadyPayload(payload, graph, v3Options);

  if (!result.valid) {
    // Emit telemetry event for observability
    emit(TelemetryEvents.AnalysisReadyValidationFailed, {
      request_id: requestId,
      error_count: result.errors.length,
      error_codes: result.errors.map((e) => e.code),
      option_count: payload.options.length,
      goal_node_id: payload.goal_node_id,
    });

    // Log warning with full error details
    log.warn({
      request_id: requestId,
      error_count: result.errors.length,
      errors: result.errors,
    }, `Analysis-ready validation failed with ${result.errors.length} error(s)`);
  }

  return result;
}

// ============================================================================
// Summary Statistics
// ============================================================================

/**
 * Summary statistics for analysis-ready payload.
 */
export interface AnalysisReadySummary {
  optionCount: number;
  totalInterventions: number;
  averageInterventionsPerOption: number;
  status: "ready" | "needs_user_mapping";
  userQuestionCount: number;
  readyOptions: number;
  incompleteOptions: number;
}

/**
 * Get summary statistics for analysis-ready payload.
 */
export function getAnalysisReadySummary(payload: AnalysisReadyPayloadT): AnalysisReadySummary {
  const totalInterventions = payload.options.reduce(
    (sum, o) => sum + Object.keys(o.interventions).length,
    0
  );

  const incompleteOptions = payload.options.filter(
    (o) => Object.keys(o.interventions).length === 0
  ).length;

  return {
    optionCount: payload.options.length,
    totalInterventions,
    averageInterventionsPerOption:
      payload.options.length > 0 ? totalInterventions / payload.options.length : 0,
    status: payload.status,
    userQuestionCount: payload.user_questions?.length ?? 0,
    readyOptions: payload.options.length - incompleteOptions,
    incompleteOptions,
  };
}
