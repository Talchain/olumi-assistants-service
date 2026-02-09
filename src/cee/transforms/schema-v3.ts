/**
 * Schema V3 Transformer
 *
 * Transforms CEE draft-graph responses to v3.0 schema format.
 *
 * V3 Key Changes:
 * - Options are separate from graph nodes (top-level options[] array)
 * - Options include interventions mapping to factor nodes
 * - Options have status: 'ready' | 'needs_user_mapping'
 * - goal_node_id is required at top level
 * - Edge strength uses strength_mean (unconstrained) instead of weight (0-1)
 */

import type {
  CEEGraphResponseV3T,
  NodeV3T,
  EdgeV3T,
  OptionV3T,
  GraphV3T,
  ValidationWarningV3T,
} from "../../schemas/cee-v3.js";
import { deriveEffectDirection } from "../../schemas/cee-v3.js";
import { deriveStrengthStd, type ProvenanceObject } from "./strength-derivation.js";
import type { V1DraftGraphResponse, V1Node, V1Edge, V1Graph } from "./schema-v2.js";
import { isFactorData, isOptionData } from "./schema-v2.js";
import {
  extractOptionsFromNodes,
  toOptionsV3,
  getExtractionStatistics,
  hasPriceRelatedUnresolvedTargets,
  type EdgeHint,
} from "../extraction/intervention-extractor.js";
import { normalizeToId } from "../utils/id-normalizer.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { validateV3Response } from "../validation/v3-validator.js";
import { config } from "../../config/index.js";
import type { AnalysisReadyPayloadT } from "../../schemas/analysis-ready.js";
import { buildAnalysisReadyPayload, validateAndLogAnalysisReady } from "./analysis-ready.js";
import { runIntegrityChecks, detectStrengthDefaults } from "../validation/integrity-sentinel.js";
import { DEFAULT_STRENGTH_MEAN } from "../constants.js";

// ============================================================================
// V3 Types
// ============================================================================

/**
 * V3 draft-graph response.
 */
export interface V3DraftGraphResponse extends CEEGraphResponseV3T {
  /** Additional fields from V1 response */
  quality?: {
    overall: number;
    structure?: number;
    coverage?: number;
    causality?: number;
    safety?: number;
  };
  draft_warnings?: Array<{
    type: string;
    message: string;
    severity?: string;
  }>;
  /** P0: Ready-to-use analysis payload for direct PLoT consumption */
  analysis_ready: AnalysisReadyPayloadT;
  /** Retry suggestion when price-related factors are missing */
  _retry_suggestion?: {
    should_retry: boolean;
    reason: string;
    missing_factor_terms: string[];
  };
}

/**
 * Context for V3 transformation.
 */
export interface V3TransformContext {
  /** Original brief text for extraction */
  brief?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Enable strict validation mode */
  strictMode?: boolean;
  /**
   * CIL Phase 0.1: Enable sentinel integrity checks in the response.
   * Should be true when debug bundle capture is active (include_debug=true
   * or observabilityEnabled). This ensures sentinel output lands in bundles.
   */
  includeDebug?: boolean;
}

// ============================================================================
// Node Kind Mapping
// ============================================================================

/** V3 valid node kinds (option is included for graph connectivity) */
const V3_VALID_KINDS = new Set(["goal", "factor", "outcome", "decision", "risk", "action", "option"]);

/**
 * Map V1 node kind to V3 kind.
 * Options remain in graph for connectivity; also extracted to options[] array.
 */
function mapKindToV3(kind: string): NodeV3T["kind"] {
  // constraint maps to factor
  if (kind === "constraint") {
    return "factor";
  }
  // decision, action, goal, factor, outcome, risk, option are all valid V3 kinds
  if (V3_VALID_KINDS.has(kind)) {
    return kind as NodeV3T["kind"];
  }
  log.warn({ kind, defaultedTo: "factor" }, `Unknown node kind "${kind}", defaulting to "factor"`);
  return "factor";
}

// ============================================================================
// Node Transformation
// ============================================================================

/**
 * Transform a V1 node to V3 format.
 */
export function transformNodeToV3(
  node: V1Node,
  existingIds: Set<string> = new Set()
): NodeV3T {
  const id = normalizeToId(node.id, existingIds);
  existingIds.add(id);

  const v3Node: NodeV3T = {
    id,
    kind: mapKindToV3(node.kind),
    label: node.label ?? node.id,
    description: node.body,
    // Preserve category field (V12.4+) for factor nodes
    category: node.category,
    // Preserve goal threshold fields (V14+) for goal nodes
    ...(node.goal_threshold !== undefined && { goal_threshold: node.goal_threshold }),
    ...(node.goal_threshold_raw !== undefined && { goal_threshold_raw: node.goal_threshold_raw }),
    ...(node.goal_threshold_unit !== undefined && { goal_threshold_unit: node.goal_threshold_unit }),
    ...(node.goal_threshold_cap !== undefined && { goal_threshold_cap: node.goal_threshold_cap }),
  };

  // Transform data to observed_state (only if it's FactorData with value defined)
  // OptionData (with interventions) is handled separately in options extraction
  if (isFactorData(node.data) && node.data.value !== undefined) {
    // Map extractionType to V3 source format
    const source: "brief_extraction" | "cee_inference" =
      node.data.extractionType === "inferred" ? "cee_inference" : "brief_extraction";

    v3Node.observed_state = {
      value: node.data.value,
      baseline: node.data.baseline,
      unit: node.data.unit,
      source,
      // Pass through factor metadata fields
      ...(node.data.raw_value !== undefined && { raw_value: node.data.raw_value }),
      ...(node.data.cap !== undefined && { cap: node.data.cap }),
      ...(node.data.extractionType !== undefined && { extractionType: node.data.extractionType }),
      ...(node.data.factor_type !== undefined && { factor_type: node.data.factor_type }),
      ...(node.data.uncertainty_drivers !== undefined && { uncertainty_drivers: node.data.uncertainty_drivers }),
    };
  }

  return v3Node;
}

// ============================================================================
// Edge Transformation
// ============================================================================

// ============================================================================
// Edge Strength Bounds (P1-CEE-2)
// ============================================================================

/** Min/Max bounds for strength_mean coefficient */
// Canonical strength range: [-1, +1] (standardised coefficients)
const STRENGTH_MEAN_MIN = -1;
const STRENGTH_MEAN_MAX = 1;

/** Minimum floor for strength_std */
const STRENGTH_STD_FLOOR = 1e-6;

/**
 * Clamp strength_mean to valid range and emit telemetry if clamped.
 */
function clampStrengthMean(
  value: number,
  edgeFrom: string,
  edgeTo: string
): { clamped: number; wasClamped: boolean } {
  if (value < STRENGTH_MEAN_MIN) {
    log.info(
      { edgeFrom, edgeTo, original: value, clamped: STRENGTH_MEAN_MIN },
      "Clamped strength_mean below minimum"
    );
    return { clamped: STRENGTH_MEAN_MIN, wasClamped: true };
  }
  if (value > STRENGTH_MEAN_MAX) {
    log.info(
      { edgeFrom, edgeTo, original: value, clamped: STRENGTH_MEAN_MAX },
      "Clamped strength_mean above maximum"
    );
    return { clamped: STRENGTH_MEAN_MAX, wasClamped: true };
  }
  return { clamped: value, wasClamped: false };
}

/**
 * Apply bounds to strength_std:
 * - Floor at 1e-6 (must be > 0)
 * - Cap at max(0.5, 2×|mean|)
 */
function boundStrengthStd(
  std: number,
  strengthMean: number,
  edgeFrom: string,
  edgeTo: string
): number {
  // Floor at 1e-6
  let bounded = Math.max(STRENGTH_STD_FLOOR, std);

  // Cap at max(0.5, 2×|mean|)
  const cap = Math.max(0.5, 2 * Math.abs(strengthMean));
  if (bounded > cap) {
    log.debug(
      { edgeFrom, edgeTo, original: std, capped: cap },
      "Capped strength_std to max bound"
    );
    bounded = cap;
  }

  return bounded;
}

/**
 * Transform a V1 edge to V3 format.
 *
 * V3 Changes:
 * - weight → strength_mean (can be negative for negative effects)
 * - Uses signed coefficient model: range [-1, +1]
 * - effect_direction derived from strength_mean sign
 * - strength_std: floor 1e-6, cap max(0.5, 2×|mean|)
 */
export function transformEdgeToV3(
  edge: V1Edge,
  _index: number,
  _nodes: V1Node[]
): EdgeV3T {
  // V4 fields take precedence, fallback to legacy for backwards compatibility
  const rawStrength = edge.strength_mean ?? edge.weight ?? DEFAULT_STRENGTH_MEAN;
  const beliefExists = edge.belief_exists ?? edge.belief ?? 0.5;

  // In V3, strength_mean is a signed coefficient
  // If effect_direction is negative, strength_mean should be negative
  const existingDirection = edge.effect_direction;
  let strengthMean = rawStrength;

  // Apply sign based on effect direction (only if not already signed from V4)
  if (existingDirection === "negative" && rawStrength > 0) {
    strengthMean = -Math.abs(rawStrength);
  }

  // P1-CEE-2: Clamp strength_mean to [-1, +1]
  const { clamped: clampedMean, wasClamped } = clampStrengthMean(
    strengthMean,
    edge.from,
    edge.to
  );
  strengthMean = clampedMean;

  // Emit telemetry if clamped
  if (wasClamped) {
    emit(TelemetryEvents.EdgeStrengthClamped ?? "cee.edge.strength_clamped", {
      edgeFrom: edge.from,
      edgeTo: edge.to,
      originalMean: rawStrength * (existingDirection === "negative" ? -1 : 1),
      clampedMean: strengthMean,
    });
  }

  // Use V4 strength_std if present, otherwise derive from strength and belief
  let strengthStd = edge.strength_std;
  if (strengthStd === undefined) {
    strengthStd = deriveStrengthStd(Math.abs(rawStrength), beliefExists, edge.provenance);
  }

  // P1-CEE-2: Apply std bounds (floor 1e-6, cap max(0.5, 2×|mean|))
  strengthStd = boundStrengthStd(strengthStd, strengthMean, edge.from, edge.to);

  // Derive effect direction from strength_mean
  const effectDirection = deriveEffectDirection(strengthMean);

  // Extract provenance
  const provenance = extractProvenanceForV3(edge.provenance);

  return {
    from: edge.from,
    to: edge.to,
    strength_mean: strengthMean,
    strength_std: strengthStd,
    belief_exists: beliefExists,
    effect_direction: effectDirection,
    provenance,
  };
}

/**
 * Valid V3 provenance sources.
 */
type V3ProvenanceSource = "brief_extraction" | "cee_hypothesis" | "domain_knowledge" | "user_specified";

/**
 * Map provenance string to V3 source.
 */
function mapToV3ProvenanceSource(source: string): V3ProvenanceSource {
  const normalized = source.toLowerCase();
  if (normalized.includes("user") || normalized.includes("specified") || normalized.includes("manual")) {
    return "user_specified";
  }
  if (normalized.includes("hypothesis")) return "cee_hypothesis";
  if (normalized.includes("document") || normalized.includes("brief") || normalized.includes("evidence")) {
    return "brief_extraction";
  }
  if (normalized.includes("domain") || normalized.includes("knowledge")) {
    return "domain_knowledge";
  }
  // Default to cee_hypothesis for unknown sources
  return "cee_hypothesis";
}

/**
 * Extract provenance as V3 format.
 */
function extractProvenanceForV3(
  prov?: string | ProvenanceObject
): { source: V3ProvenanceSource; reasoning?: string } | undefined {
  if (!prov) return undefined;

  if (typeof prov === "string") {
    return { source: mapToV3ProvenanceSource(prov) };
  }

  return {
    source: mapToV3ProvenanceSource(prov.source),
    reasoning: prov.quote,
  };
}

// ============================================================================
// Graph Transformation
// ============================================================================

/**
 * Find the goal node in a graph.
 */
function findGoalNode(nodes: V1Node[]): V1Node | undefined {
  return nodes.find((n) => n.kind === "goal");
}

/**
 * Extract option nodes from graph (to be converted to V3 options).
 * Note: Only "option" nodes are extracted; "decision" nodes remain in the graph.
 */
function extractOptionNodes(nodes: V1Node[]): V1Node[] {
  return nodes.filter((n) => n.kind === "option");
}

/**
 * Extract edge hints from V1 graph - edges from option nodes to factor nodes.
 * These provide structural hints for intervention targeting.
 * Note: Only "option" nodes, not "decision" nodes.
 */
function extractEdgeHints(graph: V1Graph): EdgeHint[] {
  const optionNodeIds = new Set(
    graph.nodes
      .filter((n) => n.kind === "option")
      .map((n) => n.id)
  );
  const factorNodeIds = new Set(
    graph.nodes
      .filter((n) => n.kind === "factor" || n.kind === "constraint" || n.kind === "action")
      .map((n) => n.id)
  );

  return graph.edges
    .filter((edge) => optionNodeIds.has(edge.from) && factorNodeIds.has(edge.to))
    .map((edge) => ({
      from_option_id: edge.from,
      to_factor_id: edge.to,
      weight: edge.weight,
    }));
}

interface OptionIdMismatchSummary {
  optionNodeIds: string[];
  optionIds: string[];
  missingOptionIds: string[];
  extraOptionIds: string[];
}

function getOptionIdMismatchSummary(
  graph: GraphV3T,
  options: OptionV3T[]
): OptionIdMismatchSummary {
  const optionNodeIds = graph.nodes.filter((n) => n.kind === "option").map((n) => n.id);
  const optionIds = options.map((option) => option.id);
  const optionIdSet = new Set(optionIds);
  const optionNodeIdSet = new Set(optionNodeIds);

  return {
    optionNodeIds,
    optionIds,
    missingOptionIds: optionNodeIds.filter((id) => !optionIdSet.has(id)),
    extraOptionIds: optionIds.filter((id) => !optionNodeIdSet.has(id)),
  };
}

/**
 * Transform V1 graph to V3 format.
 * Keeps ALL nodes including options for graph connectivity (decision→option→factor).
 * Options are also extracted to the separate options[] array with intervention metadata.
 */
export function transformGraphToV3(graph: V1Graph): GraphV3T {
  // Keep ALL nodes including options (for PLoT connectivity and canvas visualization)
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));

  // Transform all nodes
  const usedNodeIds = new Set<string>();
  const v3Nodes = graph.nodes.map((node) => transformNodeToV3(node, usedNodeIds));

  // Keep ALL valid edges (including decision→option and option→factor)
  const validEdges = graph.edges.filter(
    (edge) => allNodeIds.has(edge.from) && allNodeIds.has(edge.to)
  );

  // Transform edges
  const v3Edges = validEdges.map((edge, index) =>
    transformEdgeToV3(edge, index, graph.nodes)
  );

  return {
    nodes: v3Nodes,
    edges: v3Edges,
  };
}

// ============================================================================
// Response Transformation
// ============================================================================

/**
 * Transform a V1 draft-graph response to V3 format.
 *
 * @param v1Response - V1 draft-graph response
 * @param context - Transformation context
 * @returns V3 draft-graph response
 */
export function transformResponseToV3(
  v1Response: V1DraftGraphResponse,
  context: V3TransformContext = {}
): V3DraftGraphResponse {
  const { graph } = v1Response;

  // [V3-CAT-INPUT] Log category on V1 input (before any transform)
  // Gated behind CEE_DEBUG_CATEGORY_TRACE feature flag
  if (config.cee.debugCategoryTrace) {
    const v1InputFactors = graph.nodes.filter((n) => n.kind === "factor");
    const v1InputWithCategory = v1InputFactors.filter((n) => n.category);
    log.info({
      requestId: context.requestId,
      v1_input_factor_count: v1InputFactors.length,
      v1_input_with_category: v1InputWithCategory.length,
      v1_input_sample: v1InputWithCategory.slice(0, 5).map((n) => ({ id: n.id, category: n.category })),
      all_input_node_ids: graph.nodes.map((n) => n.id),
      event: "cee.v3_transform.input_category_check",
    }, "[V3-CAT-INPUT] V1 input category status at transform entry");
  }

  // Find goal node
  const goalNode = findGoalNode(graph.nodes);
  if (!goalNode) {
    log.warn({ requestId: context.requestId }, "No goal node found in graph");
  }
  const goalNodeId = goalNode?.id ?? "goal";

  // Extract option nodes for conversion
  const optionNodes = extractOptionNodes(graph.nodes);

  // Extract edge hints from V1 graph (option→factor edges)
  const edgeHints = extractEdgeHints(graph);

  // Transform graph (without option nodes)
  const v3Graph = transformGraphToV3(graph);

  // [V3-CAT-TRACE] Log category field status through V3 transform
  // Gated behind CEE_DEBUG_CATEGORY_TRACE feature flag
  if (config.cee.debugCategoryTrace) {
    const v1FactorsWithCategory = graph.nodes.filter((n) => n.kind === "factor" && n.category);
    const v3FactorsWithCategory = v3Graph.nodes.filter((n) => n.kind === "factor" && n.category);
    log.info({
      requestId: context.requestId,
      v1_factor_count: graph.nodes.filter((n) => n.kind === "factor").length,
      v1_factors_with_category: v1FactorsWithCategory.length,
      v1_category_sample: v1FactorsWithCategory.slice(0, 3).map((n) => ({ id: n.id, cat: n.category })),
      v3_factor_count: v3Graph.nodes.filter((n) => n.kind === "factor").length,
      v3_factors_with_category: v3FactorsWithCategory.length,
      v3_category_sample: v3FactorsWithCategory.slice(0, 3).map((n) => ({ id: n.id, cat: n.category })),
      event: "cee.v3_transform.category_trace",
    }, "[V3-CAT-TRACE] Category field status in V3 transform");
  }

  const v3NodeIdByV1Id = new Map(
    graph.nodes.map((node, index) => [node.id, v3Graph.nodes[index]?.id ?? node.id])
  );

  // Convert option nodes to V3 options with intervention extraction
  const v3NodesTyped = v3Graph.nodes as NodeV3T[];
  const v3EdgesTyped = v3Graph.edges as EdgeV3T[];

  const extractedOptions = extractOptionsFromNodes(
    optionNodes.map((n) => ({
      id: v3NodeIdByV1Id.get(n.id) ?? n.id,
      label: n.label ?? n.id,
      description: n.body,
      // V4 prompt outputs interventions directly on option nodes - use them if present
      v4Interventions: isOptionData(n.data) ? n.data.interventions : undefined,
    })),
    v3NodesTyped,
    v3EdgesTyped,
    goalNodeId,
    edgeHints
  );

  const v3Options = toOptionsV3(extractedOptions);

  const optionIdSummary = getOptionIdMismatchSummary(v3Graph, v3Options);
  if (optionIdSummary.missingOptionIds.length > 0) {
    log.warn(
      {
        requestId: context.requestId,
        missingOptionIds: optionIdSummary.missingOptionIds,
        optionNodeIds: optionIdSummary.optionNodeIds,
      },
      "Option node IDs missing from options[]"
    );
  }
  if (optionIdSummary.extraOptionIds.length > 0) {
    log.warn(
      {
        requestId: context.requestId,
        extraOptionIds: optionIdSummary.extraOptionIds,
        optionIds: optionIdSummary.optionIds,
      },
      "Options[] contains IDs not present in graph option nodes"
    );
  }

  // Generate validation warnings
  const validationWarnings = generateValidationWarnings(
    v3Graph,
    v3Options,
    goalNodeId
  );

  // P0: Build analysis-ready payload for direct PLoT consumption
  const analysisReady = buildAnalysisReadyPayload(
    v3Options,
    goalNodeId,
    v3Graph,
    {
      seed: (v1Response as any).seed ?? "42",
      requestId: context.requestId,
    }
  );

  // Validate analysis-ready payload (log warnings but don't fail)
  validateAndLogAnalysisReady(analysisReady, v3Graph, v3Options, context.requestId);

  // Check for price-related unresolved targets (for retry suggestion)
  const priceCheck = hasPriceRelatedUnresolvedTargets(extractedOptions);

  // Emit telemetry
  const stats = getExtractionStatistics(extractedOptions);
  emit(TelemetryEvents.SchemaV3TransformComplete ?? "cee.schema_v3.transform_complete", {
    nodeCount: v3Graph.nodes.length,
    edgeCount: v3Graph.edges.length,
    optionCount: v3Options.length,
    ...stats,
    validationWarningCount: validationWarnings.length,
    analysisReadyStatus: analysisReady.status,
    priceRelatedUnresolved: priceCheck.detected,
    priceRelatedTerms: priceCheck.terms,
    requestId: context.requestId,
  });

  // Build response - V3.1: nodes and edges at root level (not nested under graph)
  const v3Response: V3DraftGraphResponse = {
    schema_version: "3.0",
    nodes: v3Graph.nodes,
    edges: v3Graph.edges,
    options: v3Options,
    goal_node_id: goalNodeId,
    analysis_ready: analysisReady,
    quality: v1Response.quality,
    trace: {
      request_id: context.requestId ?? v1Response.trace?.request_id,
      correlation_id: context.correlationId ?? v1Response.trace?.correlation_id,
      engine: v1Response.trace?.engine,
      goal_handling: v1Response.trace?.goal_handling,
      // P0: Pipeline diagnostics for debug panel
      pipeline: v1Response.trace?.pipeline,
    },
    draft_warnings: v1Response.draft_warnings,
  };

  // CIL Phase 0: Carry goal_constraints from V1 pipeline into V3 response.
  // These are generated during compound goal extraction (Phase 3) and were
  // previously dropped during V1→V3 reconstruction.
  const v1GoalConstraints = (v1Response as any).goal_constraints;
  if (Array.isArray(v1GoalConstraints) && v1GoalConstraints.length > 0) {
    v3Response.goal_constraints = v1GoalConstraints;
  }

  // CIL Phase 1: Strength default detection (production-enabled, not debug-gated)
  // Run unconditionally so user-facing warning appears in all responses
  const strengthDefaults = detectStrengthDefaults(
    v3Graph.nodes as any[],
    v3Graph.edges as any[]
  );

  // Add STRENGTH_DEFAULT_APPLIED to validation_warnings if threshold exceeded
  if (strengthDefaults.detected) {
    validationWarnings.push({
      code: "STRENGTH_DEFAULT_APPLIED",
      message: `Detected ${strengthDefaults.defaulted_count} of ${strengthDefaults.total_edges} edges (${Math.round((strengthDefaults.defaulted_count / strengthDefaults.total_edges) * 100)}%) with default strength value ${strengthDefaults.default_value}. This indicates the LLM may not have output varied strength coefficients.`,
      severity: "warning" as const,
    });
  }

  // Add validation warnings if any
  if (validationWarnings.length > 0) {
    v3Response.validation_warnings = validationWarnings;
  }

  // Add retry suggestion if price-related factors are missing
  if (priceCheck.detected && analysisReady.status === "needs_user_mapping") {
    v3Response._retry_suggestion = {
      should_retry: true,
      reason: "LLM did not create factor nodes for quantitative dimensions",
      missing_factor_terms: priceCheck.terms,
    };

    log.info({
      requestId: context.requestId,
      missingTerms: priceCheck.terms,
      event: "cee.v3.retry_suggestion",
    }, `Retry suggested: missing factor nodes for ${priceCheck.terms.join(", ")}`);
  }

  // Add meta if present
  if (graph.meta) {
    v3Response.meta = {
      roots: graph.meta.roots,
      leaves: graph.meta.leaves,
      source: graph.meta.source as "assistant" | "user" | "imported" | undefined,
    };
  }

  // CIL Phase 0.2: Sentinel integrity checks — compare post-pipeline V1 nodes
  // against final V3 output to detect silent data loss in the V3 transform.
  // Gated on debug bundle mode (includeDebug) OR debugLoggingEnabled so
  // sentinel output lands in bundles. Zero cost in production when both flags are off.
  const sentinelEnabled = context.includeDebug || config.cee.debugLoggingEnabled;
  if (sentinelEnabled) {
    try {
      const sentinelOutput = runIntegrityChecks(
        graph.nodes as any[],
        v3Response.nodes as any[],
        v3Response.options as any[],
        graph.edges as any[],
        v3Response.edges as any[],
      );
      // Always attach when debug is active (even if warnings is []).
      // This ensures bundles contain the evidence structure for verification.
      if (!v3Response.trace) {
        v3Response.trace = {};
      }
      // Guard: ensure pipeline is a plain object before mutation.
      // If upstream set it to a non-object (string/array), start fresh.
      const existing = v3Response.trace.pipeline;
      const pipeline: Record<string, unknown> =
        existing !== null && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      // CIL Phase 0.2: Backward compatibility shim for raw_counts → input_counts rename.
      // Include both keys during deprecation window so existing debug tooling doesn't break.
      pipeline.integrity_warnings = {
        ...sentinelOutput,
        raw_counts: sentinelOutput.input_counts, // Deprecated: use input_counts
      };
      v3Response.trace.pipeline = pipeline;
    } catch (err) {
      // Sentinel must never block the response
      log.warn(
        { error: err, requestId: context.requestId },
        "Integrity sentinel check failed (non-blocking)",
      );
    }
  }

  return v3Response;
}

// ============================================================================
// Validation Warning Generation
// ============================================================================

/**
 * Generate validation warnings for a V3 response.
 */
function generateValidationWarnings(
  graph: GraphV3T,
  options: OptionV3T[],
  goalNodeId: string
): ValidationWarningV3T[] {
  const warnings: ValidationWarningV3T[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const optionIdSummary = getOptionIdMismatchSummary(graph, options);

  // Check goal node exists
  if (!nodeIds.has(goalNodeId)) {
    warnings.push({
      code: "GOAL_NODE_MISSING",
      severity: "error",
      message: `Goal node "${goalNodeId}" not found in graph`,
      suggestion: "Ensure the graph contains a node with kind='goal'",
    });
  }

  // Note: Option nodes ARE now allowed in graph for connectivity (decision→option→factor)
  // Options also exist in the options[] array with intervention metadata

  // Check options
  for (const missingOptionId of optionIdSummary.missingOptionIds) {
    warnings.push({
      code: "OPTION_ID_MISMATCH",
      severity: "warning",
      message: `Option node "${missingOptionId}" has no matching entry in options[]`,
      affected_option_id: missingOptionId,
      suggestion: "Ensure options[] IDs match option node IDs in the graph",
    });
  }

  for (const extraOptionId of optionIdSummary.extraOptionIds) {
    warnings.push({
      code: "OPTION_ID_MISMATCH",
      severity: "warning",
      message: `Option "${extraOptionId}" exists in options[] but no option node matches`,
      affected_option_id: extraOptionId,
      suggestion: "Ensure options[] IDs match option node IDs in the graph",
    });
  }

  for (const option of options) {
    // Check for empty interventions on ready options
    if (option.status === "ready" && Object.keys(option.interventions ?? {}).length === 0) {
      warnings.push({
        code: "EMPTY_INTERVENTIONS_READY",
        severity: "warning",
        message: `Option "${option.id}" has status='ready' but no interventions`,
        affected_option_id: option.id,
        suggestion: "Either add interventions or change status to 'needs_user_mapping'",
      });
    }

    // Check intervention targets exist
    for (const [factorId, intervention] of Object.entries(option.interventions ?? {})) {
      if (!nodeIds.has(intervention.target_match.node_id)) {
        warnings.push({
          code: "INTERVENTION_TARGET_NOT_FOUND",
          severity: "error",
          message: `Intervention target "${intervention.target_match.node_id}" not found in graph`,
          affected_option_id: option.id,
          affected_node_id: intervention.target_match.node_id,
          suggestion: "Ensure the target node exists in the graph",
        });
      }

      // Check for low confidence matches
      if (intervention.target_match.confidence === "low") {
        warnings.push({
          code: "LOW_CONFIDENCE_MATCH",
          severity: "info",
          message: `Intervention for option "${option.id}" has low confidence match to factor "${factorId}"`,
          affected_option_id: option.id,
          affected_node_id: factorId,
          suggestion: "Review the intervention target mapping",
        });
      }
    }
  }

  // Check for duplicate node IDs
  const seenIds = new Set<string>();
  for (const node of graph.nodes) {
    if (seenIds.has(node.id)) {
      warnings.push({
        code: "DUPLICATE_NODE_ID",
        severity: "error",
        message: `Duplicate node ID "${node.id}"`,
        affected_node_id: node.id,
        suggestion: "Ensure all node IDs are unique",
      });
    }
    seenIds.add(node.id);
  }

  // P1-CEE-3: Check for negligible and low strength edges
  for (const edge of graph.edges) {
    const absMean = Math.abs(edge.strength_mean);

    if (absMean < 0.1) {
      // Negligible edge (|mean| < 0.1)
      warnings.push({
        code: "EDGE_STRENGTH_NEGLIGIBLE",
        severity: "info",
        message: `Edge from "${edge.from}" to "${edge.to}" has negligible strength (${edge.strength_mean.toFixed(3)})`,
        affected_node_id: edge.from,
        suggestion: "Consider removing this edge or increasing its strength if the relationship is meaningful",
      });
      emit(TelemetryEvents.EdgeStrengthNegligible ?? "cee.edge.strength_negligible", {
        edgeFrom: edge.from,
        edgeTo: edge.to,
        strengthMean: edge.strength_mean,
      });
    } else if (absMean < 0.5) {
      // Low strength edge (|mean| < 0.5)
      warnings.push({
        code: "EDGE_STRENGTH_LOW",
        severity: "warning",
        message: `Edge from "${edge.from}" to "${edge.to}" has low strength (${edge.strength_mean.toFixed(3)})`,
        affected_node_id: edge.from,
        suggestion: "Review the strength of this relationship",
      });
      emit(TelemetryEvents.EdgeStrengthLow ?? "cee.edge.strength_low", {
        edgeFrom: edge.from,
        edgeTo: edge.to,
        strengthMean: edge.strength_mean,
      });
    }
  }

  return warnings;
}

/**
 * Validate a V3 response in strict mode.
 * Runs the full validator and throws an error if any validation errors are found.
 */
export function validateStrictModeV3(response: V3DraftGraphResponse): void {
  // Run full validation (schema + semantic checks)
  const result = validateV3Response(response);

  if (!result.valid) {
    const messages = result.errors.map((e) => e.message).join("; ");
    throw new Error(`V3 strict mode validation failed: ${messages}`);
  }
}

/**
 * Check if response needs user interaction (has needs_user_mapping options).
 */
export function needsUserMapping(response: V3DraftGraphResponse): boolean {
  return response.options.some((o) => o.status === "needs_user_mapping");
}

/**
 * Get summary statistics for a V3 response.
 */
export interface V3ResponseSummary {
  nodeCount: number;
  edgeCount: number;
  optionCount: number;
  readyOptions: number;
  needsMappingOptions: number;
  totalInterventions: number;
  validationErrorCount: number;
  validationWarningCount: number;
}

export function getV3ResponseSummary(response: V3DraftGraphResponse): V3ResponseSummary {
  const warnings = response.validation_warnings ?? [];

  return {
    nodeCount: response.nodes.length,
    edgeCount: response.edges.length,
    optionCount: response.options.length,
    readyOptions: response.options.filter((o) => o.status === "ready").length,
    needsMappingOptions: response.options.filter((o) => o.status === "needs_user_mapping").length,
    totalInterventions: response.options.reduce(
      (sum, o) => sum + Object.keys(o.interventions).length,
      0
    ),
    validationErrorCount: warnings.filter((w) => w.severity === "error").length,
    validationWarningCount: warnings.filter((w) => w.severity === "warning").length,
  };
}
