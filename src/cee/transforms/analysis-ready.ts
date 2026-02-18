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
  GraphV3T,
  NodeV3T,
} from "../../schemas/cee-v3.js";
import type {
  OptionForAnalysisT,
  AnalysisReadyPayloadT,
  AnalysisReadyStatusT,
  AnalysisBlockerT,
  ModelAdjustmentT,
  ExtractionMetadataT,
} from "../../schemas/analysis-ready.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { computeAnalysisReadyStatusWithReason } from "./option-status.js";

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
 *
 * Supports the Raw+Encoded pattern:
 * - Extracts raw_value from InterventionV3 to build raw_interventions
 * - Status logic: needs_encoding when raw values exist but aren't fully encoded
 */
export function transformOptionToAnalysisReady(option: OptionV3T): OptionForAnalysisT {
  // Flatten interventions: Record<string, InterventionV3> -> Record<string, number>
  const interventions: Record<string, number> = {};
  // Build raw_interventions from raw_value fields (Raw+Encoded pattern)
  const rawInterventions: Record<string, number | string | boolean> = {};
  let hasRawValues = false;
  let hasNonNumericRaw = false;

  for (const [factorId, intervention] of Object.entries(option.interventions ?? {})) {
    // Extract the encoded numeric value (always required)
    interventions[factorId] = intervention.value;

    // Check for raw_value in the intervention (Raw+Encoded pattern)
    if (intervention.raw_value !== undefined) {
      rawInterventions[factorId] = intervention.raw_value;
      hasRawValues = true;
      // Track if we have non-numeric raw values (categorical/boolean)
      if (typeof intervention.raw_value !== "number") {
        hasNonNumericRaw = true;
      }
    }
  }

  // Also carry through raw_interventions from option level if present
  if (option.raw_interventions) {
    for (const [factorId, rawValue] of Object.entries(option.raw_interventions)) {
      if (rawInterventions[factorId] === undefined) {
        rawInterventions[factorId] = rawValue;
        hasRawValues = true;
        if (typeof rawValue !== "number") {
          hasNonNumericRaw = true;
        }
      }
    }
  }

  // Build extraction metadata from first intervention's source/confidence
  let extractionMetadata: ExtractionMetadataT | undefined;
  const firstIntervention = Object.values(option.interventions ?? {})[0];
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

  // Determine status using shared utility for consistency across endpoints
  // Uses computeAnalysisReadyStatusWithReason() from option-status.ts
  //
  // Status rules:
  // - "ready": has interventions, no non-numeric raw values needing encoding
  // - "needs_encoding": has non-numeric raw values awaiting user encoding
  // - "needs_user_mapping": no interventions or option explicitly needs mapping
  const { status, reason: statusReason } = computeAnalysisReadyStatusWithReason(
    Object.keys(interventions).length,
    option.status,
    hasNonNumericRaw
  );

  const result: OptionForAnalysisT = {
    id: option.id,
    label: option.label,
    status,
    status_reason: statusReason,
    interventions,
    extraction_metadata: extractionMetadata,
  };

  // Only include raw_interventions if we have any (additive field)
  if (hasRawValues) {
    result.raw_interventions = rawInterventions;
  }

  return result;
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
 * Supports the Raw+Encoded pattern:
 * - Payload status is "needs_encoding" when any option needs encoding
 * - This is separate from "needs_user_mapping" (missing values)
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

  // === Task 2A+2B: Factor value fallback + blocker emission ===
  // For qualitative briefs, V3 options may have empty interventions because
  // enrichment didn't set data.value on factor nodes. We recover values from
  // the V3 factor node's observed_state or V1 data field (preserved via passthrough).
  const blockers: AnalysisBlockerT[] = [];
  let fallbackCount = 0;
  // Task 9: Track provenance of each fallback intervention
  const fallbackSources: Array<{ optionId: string; factorId: string; source: string }> = [];

  // Build factor node lookup and node kind map
  const factorNodeMap = new Map<string, NodeV3T>();
  const nodeKindLookup = new Map<string, string>();
  for (const node of graph.nodes) {
    nodeKindLookup.set(node.id, node.kind);
    if (node.kind === "factor") {
      factorNodeMap.set(node.id, node);
    }
  }

  // Build option→factor adjacency from V3 graph edges
  const optionFactorAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (nodeKindLookup.get(edge.from) === "option" && nodeKindLookup.get(edge.to) === "factor") {
      const list = optionFactorAdj.get(edge.from) ?? [];
      list.push(edge.to);
      optionFactorAdj.set(edge.from, list);
    }
  }

  // For each analysis option, fill missing interventions from factor node values
  for (let i = 0; i < analysisOptions.length; i++) {
    const analysisOpt = analysisOptions[i];
    const v3Option = options[i]; // Parallel array — same index
    const connectedFactors = optionFactorAdj.get(v3Option.id) ?? [];

    for (const factorId of connectedFactors) {
      // Skip if option already has an intervention for this factor
      if (analysisOpt.interventions[factorId] !== undefined) continue;

      const factorNode = factorNodeMap.get(factorId);
      if (!factorNode) continue;

      // Task 6: Only skip if category is explicitly set to a non-controllable value.
      // When category is undefined but an option→factor edge exists, treat as
      // potentially controllable (the edge IS the signal).
      if (factorNode.category && factorNode.category !== "controllable") continue;

      // Fallback chain: observed_state.value → data.value (V1 passthrough)
      const observedValue = factorNode.observed_state?.value;
      const rawData = (factorNode as Record<string, unknown>).data;
      const dataValue =
        typeof rawData === "object" && rawData !== null && "value" in rawData
          ? (rawData as { value: unknown }).value
          : undefined;

      if (typeof observedValue === "number") {
        analysisOpt.interventions[factorId] = observedValue;
        fallbackCount++;
        // Task 9: Track provenance of fallback source
        fallbackSources.push({ optionId: analysisOpt.id, factorId, source: "observed_state" });
      } else if (typeof dataValue === "number") {
        analysisOpt.interventions[factorId] = dataValue;
        fallbackCount++;
        // Task 9: Track provenance of fallback source
        fallbackSources.push({ optionId: analysisOpt.id, factorId, source: "data.value" });
      } else {
        // No computable value — emit blocker (Task 2B)
        // Task 5: factor_label fallback chain
        const factorLabel = factorNode.label ?? factorId ?? "Unknown factor";
        blockers.push({
          option_id: analysisOpt.id,
          option_label: analysisOpt.label,
          factor_id: factorId,
          factor_label: factorLabel,
          blocker_type: "missing_value",
          message: `Factor "${factorLabel}" needs a numeric value for option "${analysisOpt.label}"`,
          suggested_action: "add_value",
        });
      }
    }

    // Re-evaluate option status after fallback may have added interventions.
    // The original status may have been "needs_user_mapping" because there were
    // no interventions. Now that fallback recovered values, re-compute properly.
    if (
      analysisOpt.status === "needs_user_mapping" &&
      Object.keys(analysisOpt.interventions).length > 0
    ) {
      analysisOpt.status = "ready";
      analysisOpt.status_reason = "Resolved via factor node value fallback";
    }
  }

  // Task 7: Deduplicate blockers by (option_id, factor_id) pair
  const blockerKeys = new Set<string>();
  const dedupedBlockers: AnalysisBlockerT[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.option_id ?? "_all_"}::${blocker.factor_id}`;
    if (!blockerKeys.has(key)) {
      blockerKeys.add(key);
      dedupedBlockers.push(blocker);
    }
  }

  if (fallbackCount > 0 || dedupedBlockers.length > 0) {
    log.info({
      event: "cee.analysis_ready.fallback_applied",
      request_id: context.requestId,
      fallback_count: fallbackCount,
      blocker_count: dedupedBlockers.length,
      // Task 9: Provenance source marker for data.value fallbacks
      fallback_sources: fallbackSources,
    }, `analysis-ready: resolved ${fallbackCount} intervention(s) via factor node fallback, ${dedupedBlockers.length} blocker(s)`);
  }
  // === End Task 2A+2B ===

  // Determine status based on transformed options (Raw+Encoded pattern)
  // Priority: needs_user_mapping > needs_encoding > ready
  const hasIncompleteOptions = analysisOptions.some(
    (o) => o.status === "needs_user_mapping" || Object.keys(o.interventions).length === 0
  );
  const hasEncodingNeeded = analysisOptions.some(
    (o) => o.status === "needs_encoding"
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
    const incompleteOptionLabels = analysisOptions
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

  // Count options by status for telemetry
  const readyOptionsCount = analysisOptions.filter(
    (o) => o.status === "ready"
  ).length;
  const optionsNeedingEncoding = analysisOptions.filter(
    (o) => o.status === "needs_encoding"
  ).length;
  const optionsNeedingMapping = analysisOptions.filter(
    (o) => o.status === "needs_user_mapping" || Object.keys(o.interventions).length === 0
  ).length;

  // === Unreachable controllable factor check ===
  // Check if any factor nodes in the graph have zero inbound option→factor edges
  // AND zero factor→factor inbound edges from a factor that does have option edges.
  // Only controllable factors (not external) trigger this blocker.
  const optionEdgeTargets = new Set<string>();
  for (const edge of graph.edges) {
    if (nodeKindLookup.get(edge.from) === "option" && nodeKindLookup.get(edge.to) === "factor") {
      optionEdgeTargets.add(edge.to);
    }
  }

  // BFS through factor→factor edges to find transitively reachable factors
  const factorForwardAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (nodeKindLookup.get(edge.from) === "factor" && nodeKindLookup.get(edge.to) === "factor") {
      const list = factorForwardAdj.get(edge.from) ?? [];
      list.push(edge.to);
      factorForwardAdj.set(edge.from, list);
    }
  }
  const transitivelyReachableFactors = new Set<string>(optionEdgeTargets);
  const bfsQueue = [...optionEdgeTargets];
  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!;
    for (const next of factorForwardAdj.get(current) ?? []) {
      if (!transitivelyReachableFactors.has(next)) {
        transitivelyReachableFactors.add(next);
        bfsQueue.push(next);
      }
    }
  }

  // Build set of factors that already have interventions in the options
  const factorsWithInterventions = new Set<string>();
  for (const opt of analysisOptions) {
    for (const factorId of Object.keys(opt.interventions ?? {})) {
      factorsWithInterventions.add(factorId);
    }
  }

  // Find unreachable controllable factors
  const unreachableControllableBlockers: AnalysisBlockerT[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "factor") continue;
    // Exclude constraint nodes by ID prefix (compound-goals creates constraint_* nodes with kind=constraint,
    // but guard against any that might be mis-tagged as factor)
    if (node.id.startsWith("constraint_")) continue;
    if (transitivelyReachableFactors.has(node.id)) continue;
    // Skip factors that already have mapped interventions (reachable via V3 option data)
    if (factorsWithInterventions.has(node.id)) continue;
    // Only controllable factors (or undefined category) trigger this blocker.
    // External and observable factors are contextual — they influence outcomes but
    // aren't intervention targets, so they're legitimate without option connections.
    const category = (node as any).category;
    if (category === "external") continue;
    if (category === "observable") continue;
    // Only category === "controllable" or category === undefined triggers blocker
    unreachableControllableBlockers.push({
      factor_id: node.id,
      factor_label: node.label ?? node.id,
      blocker_type: "missing_value" as const,
      message: `Factor "${node.label ?? node.id}" is not connected to any option`,
      suggested_action: "add_value" as const,
    });
  }
  // === End unreachable controllable factor check ===

  // Determine payload status (priority: needs_user_input > needs_user_mapping > needs_encoding > ready)
  let payloadStatus: AnalysisReadyStatusT;
  if (dedupedBlockers.length > 0) {
    payloadStatus = "needs_user_input";
  } else if (unreachableControllableBlockers.length > 0) {
    payloadStatus = "needs_user_mapping";
  } else if (hasIncompleteOptions) {
    payloadStatus = "needs_user_mapping";
  } else if (hasEncodingNeeded) {
    payloadStatus = "needs_encoding";
  } else {
    payloadStatus = "ready";
  }

  // Look up goal node for threshold fields
  const goalNode = graph.nodes.find((n) => n.id === goalNodeId);

  const payload: AnalysisReadyPayloadT = {
    options: analysisOptions,
    goal_node_id: goalNodeId,
    status: payloadStatus,
    ...(goalNode?.goal_threshold !== undefined && { goal_threshold: goalNode.goal_threshold }),
    ...(goalNode?.goal_threshold_raw !== undefined && { goal_threshold_raw: goalNode.goal_threshold_raw }),
    ...(goalNode?.goal_threshold_unit !== undefined && { goal_threshold_unit: goalNode.goal_threshold_unit }),
    ...(goalNode?.goal_threshold_cap !== undefined && { goal_threshold_cap: goalNode.goal_threshold_cap }),
  };

  // Add user_questions when status is needs_user_mapping
  // (uniqueQuestions is guaranteed to be non-empty due to fallback above)
  if (payload.status === "needs_user_mapping") {
    // Generate questions for unreachable factors if needed
    if (unreachableControllableBlockers.length > 0 && uniqueQuestions.length === 0) {
      const factorLabels = unreachableControllableBlockers
        .map((b) => b.factor_label)
        .slice(0, 3);
      uniqueQuestions.push(
        `Which options should affect: ${factorLabels.join(", ")}?`
      );
    }
    payload.user_questions = uniqueQuestions;
  }

  // Add blockers when status is needs_user_input (Task 2B, deduplicated per Task 7)
  if (dedupedBlockers.length > 0) {
    payload.blockers = dedupedBlockers;
  }

  // Add unreachable controllable factor blockers (informational, alongside existing blockers)
  if (unreachableControllableBlockers.length > 0) {
    if (!payload.blockers) payload.blockers = [];
    payload.blockers.push(...unreachableControllableBlockers);
  }

  // Emit telemetry with option status breakdown for observability
  emit(TelemetryEvents.AnalysisReadyBuilt ?? "cee.analysis_ready.built", {
    optionCount: analysisOptions.length,
    status: payload.status,
    userQuestionCount: uniqueQuestions.length,
    goalNodeId,
    requestId: context.requestId,
    // Option status breakdown (P0 observability)
    readyOptionsCount,
    optionsNeedingEncoding,
    optionsNeedingMapping,
    // Task 2A+2B observability
    fallbackCount,
    blockerCount: dedupedBlockers.length,
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
    for (const factorId of Object.keys(option.interventions ?? {})) {
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
    for (const [factorId, value] of Object.entries(option.interventions ?? {})) {
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
    (o) => Object.keys(o.interventions ?? {}).length === 0
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

  // Rule 5b: needs_user_input requires blockers (Phase 2B)
  if (payload.status === "needs_user_input" && (!payload.blockers || payload.blockers.length === 0)) {
    errors.push({
      code: "NEEDS_USER_INPUT_WITHOUT_BLOCKERS",
      message: "Status is 'needs_user_input' but no blockers provided",
      field: "blockers",
    });
  }

  // Rule 6: needs_encoding status consistency (Raw+Encoded pattern)
  // When status is "needs_encoding", at least one option should have raw_interventions
  // with non-numeric values that justify the encoding requirement
  if (payload.status === "needs_encoding") {
    const hasRawInterventions = payload.options.some(
      (o) => o.raw_interventions && Object.keys(o.raw_interventions).length > 0
    );

    if (!hasRawInterventions) {
      errors.push({
        code: "NEEDS_ENCODING_WITHOUT_RAW",
        message: "Status is 'needs_encoding' but no options have raw_interventions",
        field: "status",
      });
    }

    // Check that at least one raw value is non-numeric (categorical/boolean)
    const hasNonNumericRaw = payload.options.some((o) => {
      if (!o.raw_interventions) return false;
      return Object.values(o.raw_interventions).some((v) => typeof v !== "number");
    });

    if (hasRawInterventions && !hasNonNumericRaw) {
      // All raw values are numeric - should be "ready" not "needs_encoding"
      errors.push({
        code: "NEEDS_ENCODING_ALL_NUMERIC",
        message: "Status is 'needs_encoding' but all raw_interventions are already numeric",
        field: "status",
      });
    }
  }

  // Rule 7: Option-level status consistency with raw_interventions
  for (const option of payload.options) {
    if (option.status === "needs_encoding") {
      // Option claims to need encoding, should have raw_interventions
      if (!option.raw_interventions || Object.keys(option.raw_interventions).length === 0) {
        errors.push({
          code: "OPTION_NEEDS_ENCODING_WITHOUT_RAW",
          message: `Option "${option.id}" has status 'needs_encoding' but no raw_interventions`,
          field: `options[${option.id}].raw_interventions`,
        });
      }
    }
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
  status: "ready" | "needs_user_mapping" | "needs_encoding" | "needs_user_input";
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

// ============================================================================
// Model Adjustments Mapping (Task 2C)
// ============================================================================

/**
 * STRP mutation code → user-facing ModelAdjustment code.
 * Only codes with a mapping are surfaced; unmapped codes are internal-only.
 */
const STRP_CODE_MAP: Record<string, ModelAdjustmentT["code"]> = {
  CATEGORY_OVERRIDE: "category_reclassified",
  SIGN_CORRECTED: "risk_coefficient_corrected",
  CONTROLLABLE_DATA_FILLED: "data_filled",
  ENUM_VALUE_CORRECTED: "enum_corrected",
};

/**
 * Graph correction type → user-facing ModelAdjustment code.
 * Only the `edge_added` type from goal wiring/enrichment is surfaced.
 */
const CORRECTION_TYPE_MAP: Record<string, ModelAdjustmentT["code"]> = {
  edge_added: "connectivity_repaired",
};

/**
 * Minimal shape of an STRP mutation for mapping purposes.
 * Avoids coupling to the full STRPMutation interface.
 */
interface MutationInput {
  code: string;
  node_id?: string;
  edge_id?: string;
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
}

/**
 * Minimal shape of a graph correction for mapping purposes.
 */
interface CorrectionInput {
  type: string;
  target: { node_id?: string; edge_id?: string };
  before?: unknown;
  after?: unknown;
  reason: string;
}

/**
 * Map STRP mutations and graph corrections to user-facing model adjustments.
 *
 * Only mutations with a known mapping are surfaced. Unmapped internal codes
 * (e.g., CONSTRAINT_REMAPPED) remain in trace.strp only.
 *
 * Task 10B: Malformed entries (missing code/type/reason) are skipped with a warning.
 *
 * @param strpMutations - STRP mutation records (from trace.strp.mutations)
 * @param corrections - Graph correction records (from trace.corrections)
 * @param nodeLabels - Optional lookup map from node ID → label for enrichment (Task 10A)
 * @returns Model adjustments for the analysis_ready payload
 */
export function mapMutationsToAdjustments(
  strpMutations?: MutationInput[],
  corrections?: CorrectionInput[],
  nodeLabels?: Map<string, string>,
): ModelAdjustmentT[] {
  const adjustments: ModelAdjustmentT[] = [];

  for (const m of strpMutations ?? []) {
    // Task 10B: Skip malformed entries
    if (!m || typeof m.code !== "string" || typeof m.reason !== "string") {
      log.warn({ mutation: m }, "Skipping malformed STRP mutation (missing code or reason)");
      continue;
    }
    const code = STRP_CODE_MAP[m.code];
    if (code) {
      // Task 10A: Enrich with node label if available
      const label = m.node_id ? nodeLabels?.get(m.node_id) : undefined;
      const reason = label ? `${m.reason} (${label})` : m.reason;
      adjustments.push({
        code,
        node_id: m.node_id,
        edge_id: m.edge_id,
        field: m.field,
        before: m.before,
        after: m.after,
        reason,
      });
    } else {
      log.debug({ strp_code: m.code, node_id: m.node_id }, "STRP mutation code not mapped to user-facing adjustment (internal-only)");
    }
  }

  for (const c of corrections ?? []) {
    // Task 10B: Skip malformed entries
    if (!c || typeof c.type !== "string" || typeof c.reason !== "string") {
      log.warn({ correction: c }, "Skipping malformed graph correction (missing type or reason)");
      continue;
    }
    const code = CORRECTION_TYPE_MAP[c.type];
    if (code) {
      // Task 10A: Enrich with node label if available
      const label = c.target?.node_id ? nodeLabels?.get(c.target.node_id) : undefined;
      const reason = label ? `${c.reason} (${label})` : c.reason;
      adjustments.push({
        code,
        node_id: c.target?.node_id,
        edge_id: c.target?.edge_id,
        field: c.type,
        before: c.before,
        after: c.after,
        reason,
      });
    }
  }

  return adjustments;
}

// ============================================================================
// Constraint-Drop Blocker Extraction
// ============================================================================

/**
 * Extract STRP constraint-drop mutations as analysis_ready blockers.
 *
 * When STRP drops a constraint because the target node doesn't exist in the
 * graph, the mutation has code "CONSTRAINT_DROPPED". This function converts
 * those mutations into properly typed AnalysisBlocker entries so users see
 * that their constraints were silently removed.
 *
 * Note: These blockers are informational — they do NOT change analysis_ready.status.
 * The status is computed before constraint-drop blockers are injected, and is not
 * recomputed afterwards. This is by design: dropped constraints mean the graph is
 * still runnable, it just won't enforce those constraints.
 *
 * Field mapping:
 * - factor_id: The target node_id the constraint referenced (from mutation.before)
 * - factor_label: Same as factor_id (the node doesn't exist, so we have no label)
 * - message: Includes constraint_id for traceability
 *
 * @param mutations - STRP mutation records (from trace.strp.mutations)
 * @returns Deduplicated blocker entries for dropped constraints
 */
export function extractConstraintDropBlockers(
  mutations: Array<{ code?: string; constraint_id?: string; before?: unknown; reason?: string }>,
): AnalysisBlockerT[] {
  const seen = new Set<string>();
  const blockers: AnalysisBlockerT[] = [];

  for (const m of mutations) {
    if (m.code !== "CONSTRAINT_DROPPED") continue;

    // Dedup by constraint_id (or target node_id if no constraint_id)
    const dedupKey = m.constraint_id ?? (typeof m.before === "string" ? m.before : "");
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // factor_id = target node_id (matches AnalysisBlocker schema: "Factor node ID")
    const targetNodeId = typeof m.before === "string" ? m.before : "unknown";
    const constraintLabel = m.constraint_id ? ` (${m.constraint_id})` : "";

    blockers.push({
      factor_id: targetNodeId,
      factor_label: targetNodeId,
      blocker_type: "constraint_dropped" as const,
      message: `Constraint dropped${constraintLabel}: ${m.reason ?? "target node not found in graph"}`,
      suggested_action: "review_constraint" as const,
    });
  }

  return blockers;
}
