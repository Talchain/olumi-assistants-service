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
import { detectCycles } from "../../utils/graphGuards.js";

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
        stage: "schema_validation",
      });
    }

    return categorizeWarnings(warnings);
  }

  const v3Response = schemaResult.data;

  // Semantic validations
  warnings.push(...validateGoalNode(v3Response));
  warnings.push(...validateNodes(v3Response));
  warnings.push(...validateEdges(v3Response));
  warnings.push(...validateGraphStructure(v3Response)); // Cycle, self-loop, bidirectional detection
  warnings.push(...validateOptions(v3Response, options));
  warnings.push(...validateInterventions(v3Response, options));
  warnings.push(...validateInterventionEdgeConsistency(v3Response));

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
  const stage = "goal_validation";

  // goal_node_id must reference an existing node
  if (!nodeIds.has(response.goal_node_id)) {
    warnings.push({
      code: "GOAL_NODE_MISSING",
      severity: "error",
      message: `goal_node_id "${response.goal_node_id}" does not reference an existing node`,
      affected_node_id: response.goal_node_id,
      suggestion: "Ensure goal_node_id references a node in the graph",
      stage,
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
      stage,
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
  const stage = "node_validation";

  for (const node of response.nodes) {
    // Check for duplicate IDs
    if (seenIds.has(node.id)) {
      warnings.push({
        code: "DUPLICATE_NODE_ID",
        severity: "error",
        message: `Duplicate node ID: "${node.id}"`,
        affected_node_id: node.id,
        stage,
      });
    }
    seenIds.add(node.id);

    // Check ID format - must start with letter, contain only alphanumeric, underscores, or hyphens
    // Aligned with PRESERVED_ID_REGEX from id-normalizer
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(node.id)) {
      warnings.push({
        code: "INVALID_NODE_ID",
        severity: "error",
        message: `Invalid node ID format: "${node.id}" (must start with letter, contain only alphanumeric, underscores, or hyphens)`,
        affected_node_id: node.id,
        suggestion: "Use IDs starting with a letter followed by alphanumeric characters, underscores, or hyphens",
        stage,
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
  const stage = "edge_validation";

  // Track which factors are controllable (targeted by interventions in options[])
  // In V3, options are in a separate array (as well as in nodes[] for graph connectivity)
  const controllableFactors = new Set<string>();
  for (const option of response.options) {
    for (const intervention of Object.values(option.interventions)) {
      controllableFactors.add(intervention.target_match.node_id);
    }
  }

  // Track incoming/outgoing edges for topology validation (v6.0.2 rules)
  const incomingEdges = new Map<string, string[]>();
  const outgoingEdges = new Map<string, string[]>();

  for (const edge of response.edges) {
    if (!incomingEdges.has(edge.to)) incomingEdges.set(edge.to, []);
    if (!outgoingEdges.has(edge.from)) outgoingEdges.set(edge.from, []);
    incomingEdges.get(edge.to)!.push(edge.from);
    outgoingEdges.get(edge.from)!.push(edge.to);
  }

  // V6.0.2: Decision nodes must have no incoming edges
  for (const node of response.nodes) {
    if (node.kind === "decision") {
      const incoming = incomingEdges.get(node.id) || [];
      if (incoming.length > 0) {
        warnings.push({
          code: "DECISION_HAS_INCOMING_EDGES",
          severity: "warning",
          message: `Decision node "${node.id}" has ${incoming.length} incoming edge(s) but should have none`,
          affected_node_id: node.id,
          suggestion: "Decision nodes should not have any incoming edges",
          stage,
        });
      }
    }

    // V6.0.2: Outcome/risk nodes must have exactly 1 outgoing edge to goal
    if (node.kind === "outcome" || node.kind === "risk") {
      const outgoing = outgoingEdges.get(node.id) || [];
      if (outgoing.length === 0) {
        warnings.push({
          code: `${node.kind.toUpperCase()}_NO_OUTGOING_EDGE`,
          severity: "warning",
          message: `${node.kind} node "${node.id}" has no outgoing edge to goal`,
          affected_node_id: node.id,
          suggestion: `${node.kind} nodes must connect to the goal node`,
          stage,
        });
      } else if (outgoing.length > 1) {
        warnings.push({
          code: `${node.kind.toUpperCase()}_MULTIPLE_OUTGOING_EDGES`,
          severity: "info",
          message: `${node.kind} node "${node.id}" has ${outgoing.length} outgoing edges (expected exactly 1 to goal)`,
          affected_node_id: node.id,
          suggestion: `${node.kind} nodes should have exactly one outgoing edge to the goal`,
          stage,
        });
      } else {
        // Exactly 1 outgoing - verify it goes to goal
        const targetKind = nodeKindMap.get(outgoing[0]);
        if (targetKind !== "goal") {
          warnings.push({
            code: `${node.kind.toUpperCase()}_NOT_CONNECTED_TO_GOAL`,
            severity: "warning",
            message: `${node.kind} node "${node.id}" connects to "${outgoing[0]}" (${targetKind}) instead of goal`,
            affected_node_id: node.id,
            affected_edge_id: `${node.id}→${outgoing[0]}`,
            suggestion: `${node.kind} nodes should only connect to the goal node`,
            stage,
          });
        }
      }
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
        stage,
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
        stage,
      });
    }
  }

  for (let i = 0; i < response.edges.length; i++) {
    const edge = response.edges[i];
    const edgeId = `${edge.from}→${edge.to}`;

    // Check from node exists
    if (!nodeIds.has(edge.from)) {
      warnings.push({
        code: "EDGE_FROM_NOT_FOUND",
        severity: "error",
        message: `Edge ${i}: 'from' node "${edge.from}" not found in graph`,
        affected_node_id: edge.from,
        affected_edge_id: edgeId,
        stage,
      });
    }

    // Check to node exists
    if (!nodeIds.has(edge.to)) {
      warnings.push({
        code: "EDGE_TO_NOT_FOUND",
        severity: "error",
        message: `Edge ${i}: 'to' node "${edge.to}" not found in graph`,
        affected_node_id: edge.to,
        affected_edge_id: edgeId,
        stage,
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
        // Always ERROR per spec - topology violations must block execution
        warnings.push({
          code: "INVALID_EDGE_TYPE",
          severity: "error",
          message: `Edge ${edge.from} → ${edge.to}: ${fromKind} → ${toKind} is not allowed (closed-world violation)`,
          affected_edge_id: edgeId,
          suggestion: `Valid patterns: ${ALLOWED_EDGE_PATTERNS.map((p) => `${p.from}→${p.to}`).join(", ")}`,
          stage,
        });
      }

      // Additional check: factor→factor only allowed if target is exogenous (not controllable)
      if (fromKind === "factor" && toKind === "factor") {
        if (controllableFactors.has(edge.to)) {
          // Always ERROR per spec - topology violations must block execution
          warnings.push({
            code: "INVALID_FACTOR_TO_CONTROLLABLE",
            severity: "error",
            message: `Edge ${edge.from} → ${edge.to}: factor cannot target controllable factor (targeted by option interventions)`,
            affected_edge_id: edgeId,
            suggestion: "Controllable factors should only be set by option interventions, not influenced by other factors",
            stage,
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
        affected_edge_id: edgeId,
        suggestion: "Ensure effect_direction matches the sign of strength_mean",
        stage: "coefficient_normalisation",
      });
    }

    // Check strength_std is positive
    if (edge.strength_std <= 0) {
      warnings.push({
        code: "INVALID_STRENGTH_STD",
        severity: "error",
        message: `Edge ${edge.from} → ${edge.to}: strength_std must be positive, got ${edge.strength_std}`,
        affected_edge_id: edgeId,
        stage: "coefficient_normalisation",
      });
    }

    // Check belief_exists is in [0, 1]
    if (edge.belief_exists < 0 || edge.belief_exists > 1) {
      warnings.push({
        code: "INVALID_BELIEF_EXISTS",
        severity: "error",
        message: `Edge ${edge.from} → ${edge.to}: belief_exists must be in [0, 1], got ${edge.belief_exists}`,
        affected_edge_id: edgeId,
        stage: "coefficient_normalisation",
      });
    }

    // Check strength_mean is in canonical [-1, +1] range (P1-CEE-2)
    if (edge.strength_mean < MIN_STRENGTH || edge.strength_mean > MAX_STRENGTH) {
      // Always ERROR per spec - out of range values must block execution
      warnings.push({
        code: "STRENGTH_OUT_OF_RANGE",
        severity: "error",
        message: `Edge ${edge.from} → ${edge.to}: strength_mean ${edge.strength_mean.toFixed(2)} outside canonical range [-1, +1]`,
        affected_edge_id: edgeId,
        suggestion: "Clamp value to [-1, +1] range",
        stage: "coefficient_normalisation",
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
        affected_edge_id: edgeId,
        suggestion: "Edges with |strength| < 0.05 have minimal impact on outcomes.",
        stage: "coefficient_normalisation",
      });
    }
  }

  return warnings;
}

/**
 * Validate graph structure: cycles, self-loops, bidirectional edges.
 * These are critical structural issues that would break the inference engine.
 */
function validateGraphStructure(response: CEEGraphResponseV3T): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const stage = "connectivity_check";

  // Build edge set for bidirectional detection
  const edgeSet = new Set<string>();
  for (const edge of response.edges) {
    edgeSet.add(`${edge.from}::${edge.to}`);
  }

  // Track which bidirectional pairs we've reported to avoid duplicates
  const reportedBidirectional = new Set<string>();

  // Check for self-loops and bidirectional edges in a single pass
  for (const edge of response.edges) {
    const edgeId = `${edge.from}→${edge.to}`;

    // Self-loop detection: node pointing to itself
    if (edge.from === edge.to) {
      warnings.push({
        code: "SELF_LOOP_DETECTED",
        severity: "error",
        message: `Self-loop detected: ${edge.from} → ${edge.to}`,
        affected_node_id: edge.from,
        affected_edge_id: edgeId,
        suggestion: "Remove self-referential edge. Nodes cannot influence themselves directly.",
        stage,
      });
    }

    // Bidirectional edge detection: A→B and B→A
    const reverseKey = `${edge.to}::${edge.from}`;
    const sortedKey = [edge.from, edge.to].sort().join("::");
    if (edgeSet.has(reverseKey) && !reportedBidirectional.has(sortedKey) && edge.from !== edge.to) {
      reportedBidirectional.add(sortedKey);
      warnings.push({
        code: "BIDIRECTIONAL_EDGE",
        severity: "error",
        message: `Bidirectional edges detected: ${edge.from} ↔ ${edge.to}`,
        affected_node_id: edge.from,
        affected_edge_id: `${edge.from}→${edge.to}`,
        suggestion: "Remove one direction to maintain DAG structure. Bidirectional causality is not supported.",
        stage,
      });
    }
  }

  // Cycle detection using DFS from graphGuards
  // Adapt V3 response to format expected by detectCycles
  const nodes = response.nodes.map((n) => ({ id: n.id, kind: n.kind as any }));
  const edges = response.edges.map((e) => ({ from: e.from, to: e.to }));

  const cycles = detectCycles(nodes, edges);
  for (const cycle of cycles) {
    // Skip self-loops (already reported above with clearer message)
    if (cycle.length === 2 && cycle[0] === cycle[1]) {
      continue;
    }
    warnings.push({
      code: "GRAPH_CONTAINS_CYCLE",
      severity: "error",
      message: `Cycle detected in graph: ${cycle.join(" → ")}`,
      affected_node_id: cycle[0],
      suggestion: "Break cycle by removing one edge. CEE graphs must be DAGs.",
      stage,
    });
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
  const optionNodeIds = response.nodes.filter((n) => n.kind === "option").map((n) => n.id);
  const optionIds = response.options.map((option) => option.id);
  const optionIdSet = new Set(optionIds);
  const optionNodeIdSet = new Set(optionNodeIds);
  const stage = "option_validation";

  for (const optionNodeId of optionNodeIds) {
    if (!optionIdSet.has(optionNodeId)) {
      warnings.push({
        code: "OPTION_ID_MISMATCH",
        severity: "warning",
        message: `Option node "${optionNodeId}" has no matching entry in options[]`,
        affected_option_id: optionNodeId,
        suggestion: "Ensure options[] IDs match option node IDs in the graph",
        stage,
      });
    }
  }

  for (const optionId of optionIds) {
    if (!optionNodeIdSet.has(optionId)) {
      warnings.push({
        code: "OPTION_ID_MISMATCH",
        severity: "warning",
        message: `Option "${optionId}" exists in options[] but no option node matches`,
        affected_option_id: optionId,
        suggestion: "Ensure options[] IDs match option node IDs in the graph",
        stage,
      });
    }
  }

  // Track intervention signatures to detect identical options
  const interventionSignatures = new Map<string, string>();

  for (const option of response.options) {
    // Check for duplicate option IDs
    if (seenIds.has(option.id)) {
      warnings.push({
        code: "DUPLICATE_OPTION_ID",
        severity: "error",
        message: `Duplicate option ID: "${option.id}"`,
        affected_option_id: option.id,
        stage,
      });
    }
    seenIds.add(option.id);

    // Check for identical interventions (v6.0.2 rule: options must differ)
    // Normalize by sorting keys to make comparison order-insensitive
    const interventionEntries = Object.entries(option.interventions)
      .map(([_k, v]) => `${v.target_match.node_id}:${v.value}`)
      .sort()
      .join("|");

    if (interventionSignatures.has(interventionEntries)) {
      const existingOptionId = interventionSignatures.get(interventionEntries);
      warnings.push({
        code: "IDENTICAL_OPTION_INTERVENTIONS",
        severity: "warning",
        message: `Options "${option.id}" and "${existingOptionId}" have identical interventions`,
        affected_option_id: option.id,
        suggestion: "Options must differ in at least one intervention value",
        stage,
      });
    } else {
      interventionSignatures.set(interventionEntries, option.id);
    }

    // Check ID format
    if (!/^[a-z0-9_:-]+$/.test(option.id)) {
      warnings.push({
        code: "INVALID_OPTION_ID",
        severity: "error",
        message: `Invalid option ID format: "${option.id}"`,
        affected_option_id: option.id,
        suggestion: "Use only lowercase letters, numbers, underscores, colons, and hyphens",
        stage,
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
        stage,
      });
    }

    // Check if ready is required
    if (options.requireReadyOptions && option.status !== "ready") {
      warnings.push({
        code: "OPTION_NOT_READY",
        severity: "error",
        message: `Option "${option.id}" has status='${option.status}' but ready is required`,
        affected_option_id: option.id,
        stage,
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
        stage,
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
  const stage = "intervention_validation";

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
          stage,
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
          stage,
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
            stage,
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
          stage,
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
          stage,
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
          stage,
        });
      }
    }
  }

  return warnings;
}

/**
 * Validate that option interventions have corresponding option→factor edges.
 *
 * Per V4 Rule 11: keys(data.interventions) must EXACTLY match outgoing option→factor edges.
 * This validates both directions:
 * 1. Every intervention must have a corresponding edge (INTERVENTION_NO_EDGE)
 * 2. Every edge must have a corresponding intervention (EDGE_NO_INTERVENTION)
 * 3. Intervention key must match target_match.node_id (INTERVENTION_KEY_MISMATCH)
 */
function validateInterventionEdgeConsistency(
  response: CEEGraphResponseV3T
): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const stage = "intervention_edge_validation";

  // Build map: optionId -> Set of factor IDs connected by edges
  const optionToFactorEdges = new Map<string, Set<string>>();
  const factorNodes = new Set(
    response.nodes.filter((n) => n.kind === "factor").map((n) => n.id)
  );
  const optionNodes = new Set(
    response.nodes.filter((n) => n.kind === "option").map((n) => n.id)
  );

  for (const edge of response.edges) {
    if (optionNodes.has(edge.from) && factorNodes.has(edge.to)) {
      if (!optionToFactorEdges.has(edge.from)) {
        optionToFactorEdges.set(edge.from, new Set());
      }
      optionToFactorEdges.get(edge.from)!.add(edge.to);
    }
  }

  // For each option, validate intervention-edge consistency
  for (const option of response.options) {
    const edgeTargets = optionToFactorEdges.get(option.id) ?? new Set<string>();
    const interventionTargets = new Set<string>();

    for (const [factorKey, intervention] of Object.entries(option.interventions)) {
      const interventionTarget = intervention.target_match.node_id;
      interventionTargets.add(interventionTarget);

      // Check 1: Intervention key must match target_match.node_id
      if (factorKey !== interventionTarget) {
        warnings.push({
          code: "INTERVENTION_KEY_MISMATCH",
          severity: "warning",
          message: `Option "${option.id}": intervention key "${factorKey}" does not match target_match.node_id "${interventionTarget}"`,
          affected_option_id: option.id,
          affected_node_id: interventionTarget,
          suggestion:
            "Ensure intervention key matches target_match.node_id — they must be identical",
          stage,
        });
      }

      // Check 2: Intervention target must have a corresponding edge
      if (!edgeTargets.has(interventionTarget)) {
        warnings.push({
          code: "INTERVENTION_NO_EDGE",
          severity: "warning",
          message: `Option "${option.id}" has intervention for "${interventionTarget}" but no option→factor edge`,
          affected_option_id: option.id,
          affected_node_id: interventionTarget,
          suggestion:
            "Remove intervention or add option→factor edge — interventions must have structural support",
          stage,
        });
      }
    }

    // Check 3: Every edge target must have a corresponding intervention
    for (const edgeTarget of edgeTargets) {
      if (!interventionTargets.has(edgeTarget)) {
        warnings.push({
          code: "EDGE_NO_INTERVENTION",
          severity: "warning",
          message: `Option "${option.id}" has edge to "${edgeTarget}" but no corresponding intervention`,
          affected_option_id: option.id,
          affected_node_id: edgeTarget,
          suggestion:
            "Add intervention for this edge target or remove the option→factor edge",
          stage,
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
