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
 * - Edge strength uses nested strength: { mean, std } + exists_probability (canonical v2.2)
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
import { runIntegrityChecks, detectStrengthDefaults, detectStrengthMeanDominant } from "../validation/integrity-sentinel.js";
import { DEFAULT_STRENGTH_MEAN, EDGE_STRENGTH_LOW_THRESHOLD, EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD } from "../constants.js";
import { CIL_WARNING_CODES, DEFAULT_EXISTS_PROBABILITY } from "@talchain/schemas";
import { classifyEdgeByKind } from "../utils/structural-edge-classifier.js";
import { synthesiseDisplayValue, synthesiseRangeDisplayValue } from "../factor-extraction/display-value.js";
import { nodeProvenanceDisplay, edgeProvenanceDisplay } from "./provenance-display.js";

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
    structural_proxy?: number;
    safety?: number;
  };
  draft_warnings?: Array<{
    id: string;
    severity: string;
    node_ids?: string[];
    edge_ids?: string[];
    affected_node_ids: string[];
    affected_edge_ids: string[];
    explanation?: string;
    fix_hint?: string;
  }>;
  /** P0: Ready-to-use analysis payload for direct PLoT consumption */
  analysis_ready: AnalysisReadyPayloadT;
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
  // "constraint" is normalised to "risk" in adapter normalisation (normalisation.ts:45).
  // This function should never see "constraint" under normal flow, but if it does
  // (e.g. rawOutput re-processing), align with the adapter mapping.
  if (kind === "constraint") {
    return "risk";
  }
  // decision, action, goal, factor, outcome, risk, option are all valid V3 kinds
  if (V3_VALID_KINDS.has(kind)) {
    return kind as NodeV3T["kind"];
  }
  log.warn({ kind, defaultedTo: "factor" }, `Unknown node kind "${kind}", defaulting to "factor"`);
  return "factor";
}

// ============================================================================
// Label Cleaning
// ============================================================================

/**
 * Normalisation annotations injected by the LLM into factor labels.
 * Stripped at the V3 boundary so the UI receives clean display labels.
 *
 * LABEL_NORMALISATION_RE matches patterns that start with `(0` + separator
 * AND contain normalisation-specific tokens (scale, normali[sz]ed, share,
 * cap, proportion, ratio, index, score, bounded, capped) or are exactly
 * a bare range like `(0–1)`, `(0/1)`, `(0-1)`.
 *
 * LABEL_SCALE_RE matches `(normalised)`, `(normalized)`, `(scale 0 to 1)` etc.
 *
 * Legitimate parentheticals like `(0-100 range)`, `(Q4)`, `(UK)` survive.
 */
const LABEL_NORMALISATION_RE = /\s*\(0[–\-/]1(?:\s*(?:,\s*)?(?:scale|normali[sz]ed|share|cap|proportion|ratio|index|score|bounded|capped)[^)]*|)\)\s*/gi;
const LABEL_SCALE_RE = /\s*\((normali[sz]ed|scale\s+\d[^)]*)\)\s*/gi;

export interface LabelCleaningEntry {
  node_id: string;
  original: string;
  cleaned: string;
}

/**
 * Strip normalisation annotations from a node label.
 * Returns the cleaned label and, if stripping occurred, the before/after pair.
 */
export function cleanNodeLabel(
  nodeId: string,
  rawLabel: string,
): { label: string; entry: LabelCleaningEntry | null } {
  let cleaned = rawLabel.replace(LABEL_NORMALISATION_RE, " ").trim();
  cleaned = cleaned.replace(LABEL_SCALE_RE, " ").trim();

  // Collapse any double internal whitespace left after stripping
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  // Guard: never produce an empty label
  if (cleaned.length === 0) cleaned = rawLabel;

  if (cleaned !== rawLabel) {
    return { label: cleaned, entry: { node_id: nodeId, original: rawLabel, cleaned } };
  }
  return { label: rawLabel, entry: null };
}

// ============================================================================
// Node Transformation
// ============================================================================

/**
 * Transform a V1 node to V3 format.
 *
 * @param labelCleaningTrace - Optional array; cleaning entries are pushed when annotations are stripped.
 */
export function transformNodeToV3(
  node: V1Node,
  existingIds: Set<string> = new Set(),
  labelCleaningTrace?: LabelCleaningEntry[],
): NodeV3T {
  const id = normalizeToId(node.id, existingIds);
  existingIds.add(id);

  const rawLabel = node.label ?? node.id;
  const { label: cleanedLabel, entry: cleaningEntry } = cleanNodeLabel(id, rawLabel);
  if (cleaningEntry && labelCleaningTrace) {
    labelCleaningTrace.push(cleaningEntry);
  }

  const v3Node: NodeV3T = {
    id,
    kind: mapKindToV3(node.kind),
    label: cleanedLabel,
    description: node.body,
    // Preserve category field (V12.4+) for factor nodes
    category: node.category,
    // Preserve goal threshold fields (V14+) for goal nodes.
    // Use != null (not !== undefined) to exclude both null and undefined —
    // internal schema accepts nullable values from LLM, but V3 output must not contain nulls.
    ...(node.goal_threshold != null && { goal_threshold: node.goal_threshold }),
    ...(node.goal_threshold_raw != null && { goal_threshold_raw: node.goal_threshold_raw }),
    ...(node.goal_threshold_unit != null && { goal_threshold_unit: node.goal_threshold_unit }),
    ...(node.goal_threshold_cap != null && { goal_threshold_cap: node.goal_threshold_cap }),
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
  } else if (isFactorData(node.data)) {
    // Controllable factors without value: preserve factor_type and uncertainty_drivers
    // directly on the node. Required by PLoT's graph validator —
    // stripping them causes CONTROLLABLE_MISSING_DATA errors.
    if (node.data.factor_type !== undefined) {
      v3Node.factor_type = node.data.factor_type;
    }
    if (node.data.uncertainty_drivers !== undefined) {
      v3Node.uncertainty_drivers = node.data.uncertainty_drivers;
    }
  }

  // Preserve prior distribution data for external factors.
  // prior is set by the LLM (via Anthropic schema) or synthesised by unreachable-factors
  // repair. ISL needs prior ranges to run Monte Carlo sampling on external factors.
  const nodePrior = (node as any).prior;
  if (nodePrior && typeof nodePrior === "object") {
    v3Node.prior = nodePrior;
  }

  // Preserve node-level factor metadata for external factors.
  // The repair stages (deterministic-sweep, unreachable-factors) promote factor_type,
  // extractionType, and uncertainty_drivers from data to node level when stripping
  // data.value from external factors. Pick them up here so they reach the V3 output.
  const anyNode = node as any;
  if (anyNode.factor_type !== undefined && v3Node.factor_type === undefined) {
    v3Node.factor_type = anyNode.factor_type;
  }
  if (anyNode.extractionType !== undefined && v3Node.extractionType === undefined) {
    v3Node.extractionType = anyNode.extractionType;
  }
  if (anyNode.uncertainty_drivers !== undefined && v3Node.uncertainty_drivers === undefined) {
    v3Node.uncertainty_drivers = anyNode.uncertainty_drivers;
  }

  // Preserve intercept as a top-level node field (v191+).
  // intercept is the prior mean for root nodes in ISL inference. It's set by
  // the LLM on node-level (not inside data), so it survives data deletion
  // during reclassification. Must be explicitly forwarded since transformNodeToV3
  // constructs a fresh object (passthrough only preserves fields already on it).
  // graph-data-integrity.ts auto-populates from observed_state.value if absent,
  // but only for root nodes — explicit forwarding ensures LLM-provided intercepts
  // on non-root nodes also survive.
  // Kind-constrained to match INTERCEPT_ELIGIBLE_KINDS in graph-data-integrity.ts.
  const interceptEligible = v3Node.kind === 'factor' || v3Node.kind === 'outcome'
    || v3Node.kind === 'risk' || v3Node.kind === 'goal';
  if (interceptEligible && anyNode.intercept != null && typeof anyNode.intercept === 'number') {
    v3Node.intercept = anyNode.intercept;
    log.debug({ event: 'cee.v3_transform.intercept_forwarded', node_id: id, value: anyNode.intercept }, 'cee.v3_transform.intercept_forwarded');
  }

  // Preserve encoding_map as a top-level node field (v191+).
  // encoding_map describes label encoding (e.g. "0=Developers, 1=Tech Lead"), not
  // observed state, so it lives at node level rather than inside observed_state.
  // Two sources: node.data (controllable/observable factors that still have their data
  // object) or node-level (external factors whose data was deleted by repair stages,
  // which promoted encoding_map alongside factor_type/extractionType/uncertainty_drivers).
  const dataEncodingMap = isFactorData(node.data) ? (node.data as any).encoding_map : undefined;
  const nodeEncodingMap = anyNode.encoding_map;
  const resolvedEncodingMap = dataEncodingMap ?? nodeEncodingMap;
  if (resolvedEncodingMap !== undefined) {
    v3Node.encoding_map = resolvedEncodingMap;
  }

  // Preserve display_value as a top-level node field (v191+).
  // Human-readable value string (e.g. "£40,000", "18 months") for UI rendering.
  // Source: node.data.display_value (all factor kinds that still carry a data object).
  // Only defined when the LLM produced a non-null value.
  const dataDisplayValue = isFactorData(node.data) ? (node.data as any).display_value : undefined;
  if (dataDisplayValue !== undefined) {
    v3Node.display_value = dataDisplayValue;
  }

  // Synthesise display_value for factors that lack an LLM-provided value.
  //
  // Path A (external factors): use prior range via synthesiseRangeDisplayValue.
  // Path B (controllable/observable factors): use observed_state fields via
  //   synthesiseDisplayValue. E.g. value=6, unit="developers" → "6 developers".
  if (v3Node.display_value === undefined && v3Node.kind === "factor") {
    if ((node as any).category === "external" && v3Node.prior) {
      // Path A: external factor — synthesise from prior range
      const priorUnit = anyNode.unit ?? (isFactorData(node.data) ? (node.data as any).unit : undefined);
      const synthesised = synthesiseRangeDisplayValue(
        v3Node.prior,
        priorUnit,
        v3Node.factor_type,
      );
      if (synthesised !== undefined) {
        v3Node.display_value = synthesised;
      }
    } else if (v3Node.observed_state) {
      // Path B: controllable/observable factor — synthesise from observed_state
      const os = v3Node.observed_state;
      const synthesised = synthesiseDisplayValue({
        value: os.value,
        raw_value: os.raw_value,
        unit: os.unit,
        factor_type: os.factor_type ?? v3Node.factor_type,
      });
      if (synthesised !== undefined) {
        v3Node.display_value = synthesised;
      }
    }
  }

  // UI provenance display. Read extractionType from whichever location holds
  // it on this node — observed_state (factor with value), node-level
  // (external/repaired factors), or data (factor without observed_state).
  // Decisions/options/goals fall through to the ai_inferred default.
  const dataExtractionType = isFactorData(node.data) ? node.data.extractionType : undefined;
  const extractionTypeForDisplay =
    v3Node.observed_state?.extractionType
    ?? v3Node.extractionType
    ?? dataExtractionType;
  v3Node.provenance = nodeProvenanceDisplay(extractionTypeForDisplay);

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
 * Classify a V1 edge as structural or causal based on the from/to node kinds.
 * Structural edges (decision→option, option→factor) have hard
 * exists_probability = 1.0 because they are definitional, not probabilistic.
 */
/**
 * Classify an edge as structural or causal by resolving endpoint kinds from nodes.
 * Delegates to the shared classifier — only decision→option and option→factor
 * are structural. Forbidden patterns (option→outcome, etc.) stay visible.
 */
function classifyEdge(
  fromId: string,
  toId: string,
  nodes: V1Node[],
): "structural" | "causal" {
  let fromKind: string | undefined;
  let toKind: string | undefined;
  for (const n of nodes) {
    if (n.id === fromId) fromKind = n.kind;
    if (n.id === toId) toKind = n.kind;
    if (fromKind && toKind) break;
  }
  return classifyEdgeByKind(fromKind, toKind, { edgeFrom: fromId, edgeTo: toId });
}

/**
 * Default exists_probability when neither belief_exists nor belief is present on the edge.
 *
 * - Structural edges (decision→option, option→factor): 1.0 — definitional connections.
 * - Causal edges: DEFAULT_EXISTS_PROBABILITY (0.8) — matches PLoT's normaliser default, making the assumption explicit
 *   in CEE's output so PLoT receives an intentional value rather than an unset field.
 *
 * If the LLM explicitly emitted belief_exists or belief, that value is used as-is
 * (subject only to the boundary repair for structural < 1.0).
 */
const STRUCTURAL_EXISTS_PROBABILITY_DEFAULT = 1.0;
const CAUSAL_EXISTS_PROBABILITY_DEFAULT = DEFAULT_EXISTS_PROBABILITY;

/** Record of a single default applied during V3 edge transform. */
export interface TransformDefaultRecord {
  edge_id: string;
  field: string;
  default_value: number | string;
  reason: string;
}

/** Result of transforming a V1 edge to V3, including any defaults applied. */
export interface EdgeTransformResult {
  edge: EdgeV3T;
  defaults: TransformDefaultRecord[];
}

/**
 * Transform a V1 edge to V3 format.
 *
 * V3 Changes:
 * - weight → strength_mean (can be negative for negative effects)
 * - Uses signed coefficient model: range [-1, +1]
 * - effect_direction derived from strength_mean sign
 * - strength_std: floor 1e-6, cap max(0.5, 2×|mean|)
 * - exists_probability: LLM value if present; else 1.0 for structural, DEFAULT_EXISTS_PROBABILITY for causal
 */
export function transformEdgeToV3(
  edge: V1Edge,
  _index: number,
  _nodes: V1Node[]
): EdgeTransformResult {
  const defaults: TransformDefaultRecord[] = [];
  const edgeId = `${edge.from}->${edge.to}`;
  // V4 fields take precedence, fallback to legacy for backwards compatibility
  const rawStrength = edge.strength_mean ?? edge.weight ?? DEFAULT_STRENGTH_MEAN;
  if (edge.strength_mean === undefined && edge.weight === undefined) {
    defaults.push({ edge_id: edgeId, field: "strength_mean", default_value: DEFAULT_STRENGTH_MEAN, reason: "no LLM value" });
  }

  // exists_probability: use LLM-emitted value if present; otherwise apply
  // class-appropriate default rather than the old fixed 0.5 sentinel.
  // Rationale: 0.5 is indistinguishable from "I know this edge exists with 50%
  // confidence" vs "I forgot to emit the field", causing PLoT to override with DEFAULT_EXISTS_PROBABILITY.
  // Using the class default makes the assumption explicit and auditable.
  const isStructural = classifyEdge(edge.from, edge.to, _nodes) === "structural";
  const beliefExists =
    edge.belief_exists ?? edge.belief ??
    (isStructural
      ? STRUCTURAL_EXISTS_PROBABILITY_DEFAULT
      : CAUSAL_EXISTS_PROBABILITY_DEFAULT);
  if (edge.belief_exists === undefined && edge.belief === undefined) {
    const defaultVal = isStructural ? STRUCTURAL_EXISTS_PROBABILITY_DEFAULT : CAUSAL_EXISTS_PROBABILITY_DEFAULT;
    defaults.push({ edge_id: edgeId, field: "exists_probability", default_value: defaultVal, reason: isStructural ? "structural edge default" : "causal edge default" });
  }

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
    defaults.push({ edge_id: edgeId, field: "strength_std", default_value: strengthStd, reason: "derived from mean/belief" });
  }

  // P1-CEE-2: Apply std bounds (floor 1e-6, cap max(0.5, 2×|mean|))
  strengthStd = boundStrengthStd(strengthStd, strengthMean, edge.from, edge.to);

  // Derive effect direction from strength_mean
  const effectDirection = deriveEffectDirection(strengthMean);

  // Extract provenance — prefer structured edge.provenance, fall back to
  // edge.provenance_source (flat enum from Anthropic structured outputs).
  const provenance = extractProvenanceForV3(edge.provenance)
    ?? (edge.provenance_source ? { source: mapToV3ProvenanceSource(edge.provenance_source) } : undefined);

  return {
    edge: {
      from: edge.from,
      to: edge.to,
      strength: { mean: strengthMean, std: strengthStd },
      exists_probability: beliefExists,
      effect_direction: effectDirection,
      provenance,
      // UI display vocabulary derived from structured provenance.source.
      // Sibling of `provenance` (structured); leaves the structural enum intact.
      provenance_display: edgeProvenanceDisplay(provenance?.source),
      // Edge origin: tracks creation source (ai, user, repair, enrichment, default)
      origin: edge.origin ?? "ai",
      // Bidirected edges represent unmeasured confounding — preserve through pipeline. See 3A-trust.
      ...(edge.edge_type ? { edge_type: edge.edge_type } : {}),
      // F5: Preserve enrichment defaulted flag through V3 transform
      ...((edge as any).defaulted != null ? { defaulted: (edge as any).defaulted } : {}),
      // Preserve validation pipeline metadata (two-pass parameter review)
      ...((edge as any).validation != null ? { validation: (edge as any).validation } : {}),
    },
    defaults,
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
/** Result of transforming a V1 graph to V3, including aggregated defaults. */
export interface GraphTransformResult {
  graph: GraphV3T;
  transform_defaults: TransformDefaultRecord[];
  defaulted_edge_count: number;
  label_cleaning: LabelCleaningEntry[];
}

export function transformGraphToV3(graph: V1Graph): GraphTransformResult {
  // Keep ALL nodes including options (for PLoT connectivity and canvas visualization)
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));

  // Transform all nodes, collecting label cleaning trace
  const usedNodeIds = new Set<string>();
  const labelCleaningTrace: LabelCleaningEntry[] = [];
  const v3Nodes = graph.nodes.map((node) => transformNodeToV3(node, usedNodeIds, labelCleaningTrace));

  // Keep ALL valid edges (including decision→option and option→factor)
  const validEdges = graph.edges.filter(
    (edge) => allNodeIds.has(edge.from) && allNodeIds.has(edge.to)
  );

  // Transform edges, collecting defaults
  const edgeResults = validEdges.map((edge, index) =>
    transformEdgeToV3(edge, index, graph.nodes)
  );
  const v3Edges = edgeResults.map((r) => r.edge);
  const allDefaults = edgeResults.flatMap((r) => r.defaults);
  const edgesWithDefaults = new Set(allDefaults.map((d) => d.edge_id));

  // Log label cleaning trace if any annotations were stripped
  if (labelCleaningTrace.length > 0) {
    log.info({
      event: "cee.v3_transform.label_cleaning",
      count: labelCleaningTrace.length,
      entries: labelCleaningTrace,
    }, `Stripped normalisation annotations from ${labelCleaningTrace.length} node label(s)`);
  }

  return {
    graph: {
      nodes: v3Nodes,
      edges: v3Edges,
    },
    transform_defaults: allDefaults,
    defaulted_edge_count: edgesWithDefaults.size,
    label_cleaning: labelCleaningTrace,
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
  const { graph: v3Graph, transform_defaults: transformDefaults, defaulted_edge_count: defaultedEdgeCount, label_cleaning: labelCleaning } = transformGraphToV3(graph);

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
    optionNodes.map((n) => {
      const dataBaseline = isOptionData(n.data) ? (n.data as any).is_baseline : undefined;
      const nodeBaseline = (n as any).is_baseline;
      const resolved = dataBaseline ?? nodeBaseline;
      // Log when node-level fallback is used (data-level was undefined but node-level had a value)
      if (dataBaseline === undefined && nodeBaseline !== undefined) {
        log.debug({ event: 'cee.v3_transform.is_baseline_fallback', node_id: n.id, value: nodeBaseline }, 'cee.v3_transform.is_baseline_fallback');
      }
      return {
        id: v3NodeIdByV1Id.get(n.id) ?? n.id,
        label: n.label ?? n.id,
        description: n.body,
        v4Interventions: isOptionData(n.data) ? n.data.interventions : undefined,
        is_baseline: resolved,
      };
    }),
    v3NodesTyped,
    v3EdgesTyped,
    goalNodeId,
    edgeHints
  );

  const v3Options = toOptionsV3(extractedOptions);

  // Display-only enrichment: copy interventions and is_baseline from options[] onto
  // the matching option nodes in nodes[]. options[] remains the canonical intervention
  // source for analysis; graph nodes carry the data for canvas display (ConnRow,
  // intervention labels).
  // NodeV3 declares interventions and is_baseline as optional fields (CIL Phase 1).
  const optionById = new Map(v3Options.map((o) => [o.id, o]));
  for (const node of v3NodesTyped) {
    if (node.kind !== "option") continue;
    const opt = optionById.get(node.id);
    if (!opt) continue;
    node.interventions = opt.interventions;
    if (opt.is_baseline !== undefined) {
      node.is_baseline = opt.is_baseline;
    }
  }

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
    // v0.11.0 schema amendment: coaching + causal_claims are required at
    // the V3 boundary. Initialise to canonical defaults; the conditional
    // assignments below overwrite when V1 carries populated values.
    coaching: {
      summary: null,
      strengthen_items: [],
      widening_log: {
        elements_added: [],
        elements_considered_but_excluded: [],
        brief_completeness: "thin",
      },
      bias_signals: [],
    } as unknown as V3DraftGraphResponse["coaching"],
    causal_claims: [] as unknown as V3DraftGraphResponse["causal_claims"],
    analysis_ready: (() => {
      // Strip internal _fallback_meta before sending to client
      const { _fallback_meta, ...cleanPayload } = analysisReady as any;
      return cleanPayload;
    })(),
    quality: v1Response.quality,
    trace: {
      request_id: context.requestId ?? v1Response.trace?.request_id,
      correlation_id: context.correlationId ?? v1Response.trace?.correlation_id,
      engine: v1Response.trace?.engine,
      goal_handling: v1Response.trace?.goal_handling,
      // P0: Pipeline diagnostics for debug panel
      pipeline: v1Response.trace?.pipeline,
      // STRP mutation records for observability
      // v1Response.trace has [key: string]: unknown — direct access via index signature
      ...(v1Response.trace?.strp ? { strp: v1Response.trace.strp } : {}),
      // Enrichment metadata (Pipeline B, Step 12)
      ...(v1Response.trace?.enrich ? { enrich: v1Response.trace.enrich } : {}),
      // Deterministic repair summary for observability.
      // Primary path: trace.pipeline.repair_summary (survives Zod verification in Step 13).
      // Fallback: trace.repair_summary (pre-verification, for backward-compatible fixtures).
      // Always emitted so the UI can depend on the key existing.
      repair_summary:
        (v1Response.trace?.pipeline as Record<string, unknown> | undefined)?.repair_summary
        ?? v1Response.trace?.repair_summary
        ?? { deterministic_repairs_count: 0, deterministic_repairs: [] },
      // F6: Log all defaulted edge parameters applied during V3 transform
      transform_defaults: {
        defaulted_edge_count: defaultedEdgeCount,
        total_defaults: transformDefaults.length,
        defaults: transformDefaults,
      },
      // Label cleaning: normalisation annotations stripped at V3 boundary
      ...(labelCleaning.length > 0 ? {
        label_cleaning: labelCleaning,
      } : {}),
      // F15: Surface analysis_ready fallback count when fallbacks occurred
      // AnalysisReadyPayload uses .passthrough() — _fallback_meta is a runtime-only trace field
      ...((analysisReady as Record<string, unknown>)._fallback_meta
        ? { analysis_ready_fallbacks: (analysisReady as Record<string, unknown>)._fallback_meta }
        : {}),
    },
    draft_warnings: v1Response.draft_warnings,
  };

  // CIL Phase 0: Carry goal_constraints from V1 pipeline into V3 response.
  // These are generated during compound goal extraction (Phase 3) and were
  // previously dropped during V1→V3 reconstruction.
  // V1DraftGraphResponse has [key: string]: unknown index signature —
  // passthrough fields are accessed directly without type assertion.
  const v1GoalConstraints = v1Response.goal_constraints;
  if (Array.isArray(v1GoalConstraints) && v1GoalConstraints.length > 0) {
    v3Response.goal_constraints = v1GoalConstraints;
  }

  // v0.11.0 schema amendment: coaching is required at the V3 boundary
  // per canonical contract. When V1 omits the field (legacy callers,
  // LLM didn't emit, or `hasMeaningfulCoaching` filtered the empty
  // case), default to the canonical empty shape so consumers always
  // see the field. Stage 5 emits a populated coaching when meaningful;
  // this default activates only on the legacy/empty path.
  const v1Coaching = v1Response.coaching;
  if (v1Coaching && typeof v1Coaching === "object") {
    v3Response.coaching = v1Coaching as typeof v3Response.coaching;
  } else {
    v3Response.coaching = {
      summary: null,
      strengthen_items: [],
      widening_log: {
        elements_added: [],
        elements_considered_but_excluded: [],
        brief_completeness: "thin",
      },
      bias_signals: [],
    } as typeof v3Response.coaching;
  }

  // v0.11.0 schema amendment: causal_claims is required at the V3 boundary
  // per canonical contract. When V1 omits the field (legacy callers, LLM
  // didn't emit), default to []. The Phase 2B provenance distinction
  // (undefined vs [] meaning "not emitted" vs "emitted but dropped") is
  // collapsed at the V3 boundary in favour of contract-required presence;
  // upstream pipelines preserve the distinction internally on
  // ctx.causalClaims for analytics.
  const v1CausalClaims = v1Response.causal_claims;
  v3Response.causal_claims = Array.isArray(v1CausalClaims)
    ? (v1CausalClaims as typeof v3Response.causal_claims)
    : ([] as typeof v3Response.causal_claims);

  // v0.11.0 schema amendment: carry topology_plan V1 → V3 with hard
  // deep-equality preservation. When present, the V3 array MUST equal the
  // V1 array — same length, same order, same string contents. No filter,
  // no trim, no reorder. When V1 omits the field, default to [] so the
  // V3 boundary always carries the field per canonical contract intent.
  // Tested at tests/unit/boundary.coaching-preservation.test.ts.
  const v1TopologyPlan = (v1Response as { topology_plan?: unknown }).topology_plan;
  (v3Response as { topology_plan?: unknown[] }).topology_plan = Array.isArray(v1TopologyPlan)
    ? [...v1TopologyPlan]
    : [];

  // Carry rationales from V1 pipeline into V3 response.
  // Rationales are LLM-generated per-node reasoning from Stage 1 (parse).
  // Shape normalised to { target, why } — matches PlanAnnotationCheckpoint pattern.
  // Length capped at 500 chars to prevent unexpectedly long LLM output from bloating responses.
  const v1Rationales = v1Response.rationales;
  if (Array.isArray(v1Rationales) && v1Rationales.length > 0) {
    const normalised = v1Rationales
      .filter((r: any) => r && typeof r === "object")
      .map((r: any) => ({
        target: String(r.target ?? r.node_id ?? r.id ?? ""),
        why: String(r.why ?? r.rationale ?? r.text ?? "").slice(0, 500),
        ...(r.provenance_source ? { provenance_source: String(r.provenance_source) } : {}),
      }))
      .filter((r: { target: string; why: string }) => r.target !== "" && r.why !== "");

    if (normalised.length > 0) {
      v3Response.rationales = normalised;
    }
  }

  // CIL Phase 1: Strength default detection (production-enabled, not debug-gated)
  // Run unconditionally so user-facing warning appears in all responses
  const strengthDefaults = detectStrengthDefaults(
    v3Graph.nodes as Parameters<typeof detectStrengthDefaults>[0],
    v3Graph.edges as Parameters<typeof detectStrengthDefaults>[1]
  );

  // Add STRENGTH_DEFAULT_APPLIED to validation_warnings if threshold exceeded
  if (strengthDefaults.detected) {
    const defaultedPercentage = Number(((strengthDefaults.defaulted_count / strengthDefaults.total_edges) * 100).toFixed(1));
    validationWarnings.push({
      code: CIL_WARNING_CODES.STRENGTH_DEFAULT_APPLIED,
      message: `Detected ${strengthDefaults.defaulted_count} of ${strengthDefaults.total_edges} edges (${defaultedPercentage}%) with default strength value ${strengthDefaults.default_value}. This indicates the LLM may not have output varied strength coefficients.`,
      severity: "warn" as const,
      details: {
        total_edges: strengthDefaults.total_edges,
        structural_edges_excluded: strengthDefaults.structural_edges_excluded,
        defaulted_count: strengthDefaults.defaulted_count,
        defaulted_percentage: defaultedPercentage,
        defaulted_edge_ids: strengthDefaults.defaulted_edge_ids,
      },
    });
  }

  // CIL Phase 1.1: Strength mean dominant detection (production-enabled, not debug-gated)
  // Detects when ≥70% of edges have mean ≈ 0.5 regardless of std. Both warnings can fire.
  const strengthMeanDominant = detectStrengthMeanDominant(
    v3Graph.nodes as any[],
    v3Graph.edges as any[]
  );

  // Add STRENGTH_MEAN_DEFAULT_DOMINANT to validation_warnings if threshold exceeded
  if (strengthMeanDominant.detected) {
    const meanDefaultPercentage = Number(((strengthMeanDominant.mean_default_count / strengthMeanDominant.total_edges) * 100).toFixed(1));
    validationWarnings.push({
      code: CIL_WARNING_CODES.STRENGTH_MEAN_DEFAULT_DOMINANT,
      message: `Detected ${strengthMeanDominant.mean_default_count} of ${strengthMeanDominant.total_edges} edges (${meanDefaultPercentage}%) with mean ≈ ${strengthMeanDominant.default_value} regardless of std. This indicates the LLM may have varied belief/provenance but defaulted strength magnitude.`,
      severity: "warn" as const,
      details: {
        total_edges: strengthMeanDominant.total_edges,
        structural_edges_excluded: strengthMeanDominant.structural_edges_excluded,
        mean_default_count: strengthMeanDominant.mean_default_count,
        mean_default_percentage: meanDefaultPercentage,
        mean_defaulted_edge_ids: strengthMeanDominant.mean_defaulted_edge_ids,
      },
    });
  }

  // Merge V1 pipeline validation_issues (e.g. causal-claim warnings) into V3 validation_warnings.
  // Stage 5 (package) accumulates warnings into validation_issues on the V1 envelope;
  // the V3 transform must surface them so V3 consumers see them.
  const v1ValidationIssues = (v1Response as any).validation_issues;
  if (Array.isArray(v1ValidationIssues)) {
    validationWarnings.push(...v1ValidationIssues);
  }

  // Add validation warnings if any
  if (validationWarnings.length > 0) {
    v3Response.validation_warnings = validationWarnings;
  }

  // CIL Phase 1: removed internal retry-suggestion field that leaked to API clients.
  // priceCheck telemetry is preserved above (line ~860).

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
      severity: "warn",
      message: `Option node "${missingOptionId}" has no matching entry in options[]`,
      affected_option_id: missingOptionId,
      suggestion: "Ensure options[] IDs match option node IDs in the graph",
    });
  }

  for (const extraOptionId of optionIdSummary.extraOptionIds) {
    warnings.push({
      code: "OPTION_ID_MISMATCH",
      severity: "warn",
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
        severity: "warn",
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
    const absMean = Math.abs(edge.strength.mean);

    if (absMean < EDGE_STRENGTH_LOW_THRESHOLD) {
      // Low strength edge (|mean| < 0.05, v2.7 schema)
      warnings.push({
        code: CIL_WARNING_CODES.EDGE_STRENGTH_LOW,
        severity: "info",
        message: `Edge from "${edge.from}" to "${edge.to}" has low strength (${edge.strength.mean.toFixed(3)})`,
        affected_node_id: edge.from,
        suggestion: "Review the strength of this relationship",
        details: {
          edge_id: `${edge.from}->${edge.to}`,
          mean: edge.strength.mean,
        },
      });
      emit(TelemetryEvents.EdgeStrengthLow ?? "cee.edge.strength_low", {
        edgeFrom: edge.from,
        edgeTo: edge.to,
        strengthMean: edge.strength.mean,
      });
    } else if (absMean < EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD) {
      // Negligible edge (0.05 ≤ |mean| < 0.1)
      warnings.push({
        code: CIL_WARNING_CODES.EDGE_STRENGTH_NEGLIGIBLE,
        severity: "info",
        message: `Edge from "${edge.from}" to "${edge.to}" has negligible strength (${edge.strength.mean.toFixed(3)})`,
        affected_node_id: edge.from,
        suggestion: "Consider removing this edge or increasing its strength if the relationship is meaningful",
      });
      emit(TelemetryEvents.EdgeStrengthNegligible ?? "cee.edge.strength_negligible", {
        edgeFrom: edge.from,
        edgeTo: edge.to,
        strengthMean: edge.strength.mean,
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
    validationWarningCount: warnings.filter((w) => w.severity === "warn").length,
  };
}
