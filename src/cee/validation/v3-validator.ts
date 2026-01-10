/**
 * V3 Schema Validator
 *
 * Validates CEE V3 responses for structural correctness and consistency.
 * Used for both runtime validation and strict mode enforcement.
 */

import type {
  CEEGraphResponseV3T,
  ValidationWarningV3T,
} from "../../schemas/cee-v3.js";
import { CEEGraphResponseV3 } from "../../schemas/cee-v3.js";
import { hasPathToGoal } from "../extraction/factor-matcher.js";

/**
 * Validation result with detailed findings.
 */
export interface V3ValidationResult {
  /** Whether validation passed (no errors) */
  valid: boolean;
  /** All validation warnings (including errors) */
  warnings: ValidationWarningV3T[];
  /** Just errors */
  errors: ValidationWarningV3T[];
  /** Just warnings (non-errors) */
  warningsOnly: ValidationWarningV3T[];
  /** Just info messages */
  info: ValidationWarningV3T[];
}

/**
 * Validation options.
 */
export interface V3ValidationOptions {
  /** Require all options to be 'ready' */
  requireReadyOptions?: boolean;
  /** Require all interventions to have path to goal */
  requirePathToGoal?: boolean;
  /** Require all intervention values to be numeric */
  requireNumericValues?: boolean;
  /** Skip certain checks */
  skipChecks?: string[];
}

/**
 * Validate a V3 response against the schema and semantic rules.
 *
 * @param response - V3 response to validate
 * @param options - Validation options
 * @returns Validation result
 */
export function validateV3Response(
  response: unknown,
  options: V3ValidationOptions = {}
): V3ValidationResult {
  const warnings: ValidationWarningV3T[] = [];

  // Schema validation first
  const schemaResult = CEEGraphResponseV3.safeParse(response);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      warnings.push({
        code: "SCHEMA_VALIDATION_ERROR",
        severity: "error",
        message: `Schema validation error at ${issue.path.join(".")}: ${issue.message}`,
      });
    }

    return categorizeWarnings(warnings);
  }

  const v3Response = schemaResult.data;

  // Semantic validations
  warnings.push(...validateGoalNode(v3Response));
  warnings.push(...validateNodes(v3Response));
  warnings.push(...validateEdges(v3Response));
  warnings.push(...validateOptions(v3Response, options));
  warnings.push(...validateInterventions(v3Response, options));

  return categorizeWarnings(warnings);
}

/**
 * Categorize warnings by severity.
 */
function categorizeWarnings(warnings: ValidationWarningV3T[]): V3ValidationResult {
  const errors = warnings.filter((w) => w.severity === "error");
  const warningsOnly = warnings.filter((w) => w.severity === "warning");
  const info = warnings.filter((w) => w.severity === "info");

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    warningsOnly,
    info,
  };
}

/**
 * Validate goal node.
 */
function validateGoalNode(response: CEEGraphResponseV3T): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const nodeIds = new Set(response.nodes.map((n) => n.id));

  // goal_node_id must reference an existing node
  if (!nodeIds.has(response.goal_node_id)) {
    warnings.push({
      code: "GOAL_NODE_MISSING",
      severity: "error",
      message: `goal_node_id "${response.goal_node_id}" does not reference an existing node`,
      affected_node_id: response.goal_node_id,
      suggestion: "Ensure goal_node_id references a node in the graph",
    });
    return warnings;
  }

  // goal_node_id must reference a node with kind='goal'
  const goalNode = response.nodes.find((n) => n.id === response.goal_node_id);
  if (goalNode && goalNode.kind !== "goal") {
    warnings.push({
      code: "GOAL_NODE_WRONG_KIND",
      severity: "warning",
      message: `goal_node_id "${response.goal_node_id}" references a node with kind="${goalNode.kind}", expected "goal"`,
      affected_node_id: response.goal_node_id,
      suggestion: "Set the node kind to 'goal' or use a different goal_node_id",
    });
  }

  return warnings;
}

/**
 * Validate nodes.
 */
function validateNodes(response: CEEGraphResponseV3T): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const seenIds = new Set<string>();

  for (const node of response.nodes) {
    // Check for duplicate IDs
    if (seenIds.has(node.id)) {
      warnings.push({
        code: "DUPLICATE_NODE_ID",
        severity: "error",
        message: `Duplicate node ID: "${node.id}"`,
        affected_node_id: node.id,
      });
    }
    seenIds.add(node.id);

    // Check ID format
    if (!/^[a-z0-9_:-]+$/.test(node.id)) {
      warnings.push({
        code: "INVALID_NODE_ID",
        severity: "error",
        message: `Invalid node ID format: "${node.id}" (must be lowercase alphanumeric with underscores, colons, or hyphens)`,
        affected_node_id: node.id,
        suggestion: "Use only lowercase letters, numbers, underscores, colons, and hyphens",
      });
    }

    // Note: 'option' IS now a valid node kind in V3 for graph connectivity
    // Options exist in both nodes[] AND options[] array
  }

  return warnings;
}

/**
 * Allowed edge patterns (closed-world validation).
 * Only these kind-to-kind combinations are permitted.
 *
 * V4 topology: decision→option→factor→outcome/risk→goal
 * Options exist in BOTH nodes[] AND options[] array.
 */
const ALLOWED_EDGE_PATTERNS: Array<{ from: string; to: string }> = [
  { from: "decision", to: "option" },  // Decision branches to options
  { from: "option", to: "factor" },    // Options set controllable factors
  { from: "factor", to: "outcome" },
  { from: "factor", to: "risk" },
  { from: "factor", to: "factor" },    // Target must be exogenous (checked separately)
  { from: "outcome", to: "goal" },
  { from: "risk", to: "goal" },
];

// Canonical strength range for CEE edges
const MIN_STRENGTH = -1.0;
const MAX_STRENGTH = 1.0;
const NEGLIGIBLE_THRESHOLD = 0.05;

/**
 * Validate edges.
 */
function validateEdges(response: CEEGraphResponseV3T): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const nodeIds = new Set(response.nodes.map((n) => n.id));
  const nodeKindMap = new Map(response.nodes.map((n) => [n.id, n.kind]));

  // Track which factors are controllable (targeted by interventions in options[])
  // In V3, options are in a separate array (as well as in nodes[] for graph connectivity)
  const controllableFactors = new Set<string>();
  for (const option of response.options) {
    for (const intervention of Object.values(option.interventions)) {
      controllableFactors.add(intervention.target_match.node_id);
    }
  }

  // Collect strength values for uniformity check (exclude structural edges)
  const causalStrengths: number[] = [];
  const structuralEdgeTypes = new Set(["decision-option", "option-factor"]);

  for (const edge of response.edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    const edgeType = `${fromKind}-${toKind}`;

    // Skip structural edges for strength variation analysis
    if (!structuralEdgeTypes.has(edgeType)) {
      causalStrengths.push(edge.strength_mean);
    }
  }

  // Check for uniform strengths (P1-CEE-1)
  if (causalStrengths.length > 2) {
    const uniqueStrengths = new Set(causalStrengths.map((v) => v.toFixed(2)));
    if (uniqueStrengths.size === 1) {
      warnings.push({
        code: "UNIFORM_STRENGTHS",
        severity: "warning",
        message: `All ${causalStrengths.length} causal edges have identical strength (${causalStrengths[0].toFixed(2)}). This will produce undifferentiated results.`,
        suggestion: "Review edge strengths — different relationships should have different effect sizes.",
      });
    }
  }

  // Check for all-same-direction (unlikely in real models)
  if (causalStrengths.length > 3) {
    const allPositive = causalStrengths.every((v) => v >= 0);
    const allNegative = causalStrengths.every((v) => v <= 0);
    if (allPositive || allNegative) {
      warnings.push({
        code: "UNIFORM_DIRECTION",
        severity: "info",
        message: `All ${causalStrengths.length} causal edges are ${allPositive ? "positive" : "negative"}. Most real-world models have mixed directions.`,
        suggestion: "Consider whether any relationships are inverse (e.g., cost reduces profit).",
      });
    }
  }

  for (let i = 0; i < response.edges.length; i++) {
    const edge = response.edges[i];

    // Check from node exists
    if (!nodeIds.has(edge.from)) {
      warnings.push({
        code: "EDGE_FROM_NOT_FOUND",
        severity: "error",
        message: `Edge ${i}: 'from' node "${edge.from}" not found in graph`,
        affected_node_id: edge.from,
      });
    }

    // Check to node exists
    if (!nodeIds.has(edge.to)) {
      warnings.push({
        code: "EDGE_TO_NOT_FOUND",
        severity: "error",
        message: `Edge ${i}: 'to' node "${edge.to}" not found in graph`,
        affected_node_id: edge.to,
      });
    }

    // Closed-world edge validation: check kind-to-kind pattern is allowed
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    if (fromKind && toKind) {
      const isAllowed = ALLOWED_EDGE_PATTERNS.some(
        (p) => p.from === fromKind && p.to === toKind
      );
      if (!isAllowed) {
        // Using "warning" severity to maintain backwards compatibility with existing graphs
        // TODO: Promote to "error" once all fixtures are updated to V4 topology
        warnings.push({
          code: "INVALID_EDGE_TYPE",
          severity: "warning",
          message: `Edge ${edge.from} → ${edge.to}: ${fromKind} → ${toKind} is not allowed (closed-world violation)`,
          suggestion: `Valid patterns: ${ALLOWED_EDGE_PATTERNS.map((p) => `${p.from}→${p.to}`).join(", ")}`,
        });
      }

      // Additional check: factor→factor only allowed if target is exogenous (not controllable)
      if (fromKind === "factor" && toKind === "factor") {
        if (controllableFactors.has(edge.to)) {
          // Using "warning" severity for backwards compatibility
          warnings.push({
            code: "INVALID_FACTOR_TO_CONTROLLABLE",
            severity: "warning",
            message: `Edge ${edge.from} → ${edge.to}: factor cannot target controllable factor (targeted by option interventions)`,
            suggestion: "Controllable factors should only be set by option interventions, not influenced by other factors",
          });
        }
      }
    }

    // Check effect_direction matches strength_mean sign
    const expectedDirection = edge.strength_mean >= 0 ? "positive" : "negative";
    if (edge.effect_direction !== expectedDirection) {
      warnings.push({
        code: "EFFECT_DIRECTION_MISMATCH",
        severity: "warning",
        message: `Edge ${edge.from} → ${edge.to}: effect_direction="${edge.effect_direction}" but strength_mean=${edge.strength_mean} suggests "${expectedDirection}"`,
        suggestion: "Ensure effect_direction matches the sign of strength_mean",
      });
    }

    // Check strength_std is positive
    if (edge.strength_std <= 0) {
      warnings.push({
        code: "INVALID_STRENGTH_STD",
        severity: "error",
        message: `Edge ${edge.from} → ${edge.to}: strength_std must be positive, got ${edge.strength_std}`,
      });
    }

    // Check belief_exists is in [0, 1]
    if (edge.belief_exists < 0 || edge.belief_exists > 1) {
      warnings.push({
        code: "INVALID_BELIEF_EXISTS",
        severity: "error",
        message: `Edge ${edge.from} → ${edge.to}: belief_exists must be in [0, 1], got ${edge.belief_exists}`,
      });
    }

    // Check strength_mean is in canonical [-1, +1] range (P1-CEE-2)
    if (edge.strength_mean < MIN_STRENGTH || edge.strength_mean > MAX_STRENGTH) {
      warnings.push({
        code: "STRENGTH_OUT_OF_RANGE",
        severity: "warning",
        message: `Edge ${edge.from} → ${edge.to}: strength_mean ${edge.strength_mean.toFixed(2)} outside canonical range [-1, +1]`,
        suggestion: "Standardised coefficients should be in [-1, +1] range.",
      });
    }

    // Check for negligible strength (P1-CEE-3) - skip structural edges
    const fromKindCheck = nodeKindMap.get(edge.from);
    const toKindCheck = nodeKindMap.get(edge.to);
    const isStructuralEdge =
      (fromKindCheck === "decision" && toKindCheck === "option") ||
      (fromKindCheck === "option" && toKindCheck === "factor");

    if (!isStructuralEdge && Math.abs(edge.strength_mean) < NEGLIGIBLE_THRESHOLD) {
      warnings.push({
        code: "NEGLIGIBLE_STRENGTH",
        severity: "info",
        message: `Edge ${edge.from} → ${edge.to}: negligible effect (${edge.strength_mean.toFixed(2)}). Consider removing.`,
        suggestion: "Edges with |strength| < 0.05 have minimal impact on outcomes.",
      });
    }
  }

  return warnings;
}

/**
 * Validate options.
 */
function validateOptions(
  response: CEEGraphResponseV3T,
  options: V3ValidationOptions
): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const seenIds = new Set<string>();

  for (const option of response.options) {
    // Check for duplicate option IDs
    if (seenIds.has(option.id)) {
      warnings.push({
        code: "DUPLICATE_OPTION_ID",
        severity: "error",
        message: `Duplicate option ID: "${option.id}"`,
        affected_option_id: option.id,
      });
    }
    seenIds.add(option.id);

    // Check ID format
    if (!/^[a-z0-9_:-]+$/.test(option.id)) {
      warnings.push({
        code: "INVALID_OPTION_ID",
        severity: "error",
        message: `Invalid option ID format: "${option.id}"`,
        affected_option_id: option.id,
        suggestion: "Use only lowercase letters, numbers, underscores, colons, and hyphens",
      });
    }

    // Check status consistency
    const hasInterventions = Object.keys(option.interventions).length > 0;
    if (option.status === "ready" && !hasInterventions) {
      warnings.push({
        code: "EMPTY_INTERVENTIONS_READY",
        severity: "warning",
        message: `Option "${option.id}" has status='ready' but no interventions`,
        affected_option_id: option.id,
        suggestion: "Add interventions or change status to 'needs_user_mapping'",
      });
    }

    // Check if ready is required
    if (options.requireReadyOptions && option.status !== "ready") {
      warnings.push({
        code: "OPTION_NOT_READY",
        severity: "error",
        message: `Option "${option.id}" has status='${option.status}' but ready is required`,
        affected_option_id: option.id,
      });
    }

    // Check user_questions present when needs_user_mapping
    if (
      option.status === "needs_user_mapping" &&
      (!option.user_questions || option.user_questions.length === 0) &&
      (!option.unresolved_targets || option.unresolved_targets.length === 0)
    ) {
      warnings.push({
        code: "MISSING_USER_QUESTIONS",
        severity: "info",
        message: `Option "${option.id}" needs user mapping but has no user_questions or unresolved_targets`,
        affected_option_id: option.id,
        suggestion: "Add user_questions to guide the user on what to provide",
      });
    }
  }

  return warnings;
}

/**
 * Validate interventions.
 */
function validateInterventions(
  response: CEEGraphResponseV3T,
  options: V3ValidationOptions
): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const nodeIds = new Set(response.nodes.map((n) => n.id));
  const factorNodes = response.nodes.filter((n) => n.kind === "factor");
  const factorIds = new Set(factorNodes.map((n) => n.id));

  for (const option of response.options) {
    for (const [factorId, intervention] of Object.entries(option.interventions)) {
      // Check target node exists
      if (!nodeIds.has(intervention.target_match.node_id)) {
        warnings.push({
          code: "INTERVENTION_TARGET_NOT_FOUND",
          severity: "error",
          message: `Option "${option.id}": intervention target "${intervention.target_match.node_id}" not found`,
          affected_option_id: option.id,
          affected_node_id: intervention.target_match.node_id,
        });
        continue;
      }

      // Check target is a factor node
      if (!factorIds.has(intervention.target_match.node_id)) {
        warnings.push({
          code: "INTERVENTION_TARGET_NOT_FACTOR",
          severity: "warning",
          message: `Option "${option.id}": intervention target "${intervention.target_match.node_id}" is not a factor node`,
          affected_option_id: option.id,
          affected_node_id: intervention.target_match.node_id,
          suggestion: "Interventions should target factor nodes",
        });
      }

      // Check path to goal (if required)
      if (options.requirePathToGoal) {
        const hasPath = hasPathToGoal(
          intervention.target_match.node_id,
          response.edges,
          response.goal_node_id
        );
        if (!hasPath) {
          warnings.push({
            code: "INTERVENTION_TARGET_DISCONNECTED",
            severity: "warning",
            message: `Option "${option.id}": target "${intervention.target_match.node_id}" has no path to goal`,
            affected_option_id: option.id,
            affected_node_id: intervention.target_match.node_id,
            suggestion: "Ensure intervention targets are connected to the goal",
          });
        }
      }

      // Check value is numeric
      if (typeof intervention.value !== "number" || isNaN(intervention.value)) {
        warnings.push({
          code: "INTERVENTION_VALUE_NOT_NUMERIC",
          severity: "error",
          message: `Option "${option.id}": intervention value must be numeric, got ${typeof intervention.value}`,
          affected_option_id: option.id,
          affected_node_id: factorId,
        });
      }

      // Check for unit mismatch (if target has observed_state)
      const targetNode = response.nodes.find(
        (n) => n.id === intervention.target_match.node_id
      );
      if (
        targetNode?.observed_state?.unit &&
        intervention.unit &&
        targetNode.observed_state.unit !== intervention.unit
      ) {
        warnings.push({
          code: "UNIT_MISMATCH_SUSPECTED",
          severity: "info",
          message: `Option "${option.id}": intervention unit "${intervention.unit}" differs from target unit "${targetNode.observed_state.unit}"`,
          affected_option_id: option.id,
          affected_node_id: factorId,
          suggestion: "Verify units are compatible or intended to differ",
        });
      }

      // Check low confidence matches
      if (intervention.target_match.confidence === "low") {
        warnings.push({
          code: "LOW_CONFIDENCE_MATCH",
          severity: "info",
          message: `Option "${option.id}": low confidence match for intervention target`,
          affected_option_id: option.id,
          affected_node_id: factorId,
          suggestion: "Review the target mapping for accuracy",
        });
      }
    }
  }

  return warnings;
}

/**
 * Quick validation check - returns true if valid, false otherwise.
 */
export function isValidV3Response(response: unknown): boolean {
  const result = validateV3Response(response);
  return result.valid;
}

/**
 * Throw an error if validation fails.
 */
export function assertValidV3Response(
  response: unknown,
  options?: V3ValidationOptions
): asserts response is CEEGraphResponseV3T {
  const result = validateV3Response(response, options);
  if (!result.valid) {
    const messages = result.errors.map((e) => e.message).join("; ");
    throw new Error(`V3 validation failed: ${messages}`);
  }
}
