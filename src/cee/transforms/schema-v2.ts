/**
 * Schema V2 Transformer
 *
 * Transforms CEE draft-graph v1 responses to v2.2 schema format.
 * Adds effect_direction, strength_std, and renames node.data to observed_state.
 *
 * v2.2 Schema Changes:
 * - Edges: Add effect_direction ("positive" | "negative")
 * - Edges: Add strength_std (derived parametric uncertainty)
 * - Nodes: Rename data → observed_state (for factor nodes)
 * - Response: Add schema_version: "2.2"
 */

import { deriveStrengthStd, type ProvenanceObject } from "./strength-derivation.js";
import {
  ensureEffectDirection,
  type EffectDirection,
  type NodeInfo,
} from "./effect-direction-inference.js";
import {
  deriveValueUncertainty,
  type ExtractionType,
} from "./value-uncertainty-derivation.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";

// ============================================================================
// V1 Types (Input)
// ============================================================================

/**
 * FactorData structure for factor nodes (ISL integration)
 */
export interface V1FactorData {
  value?: number;
  baseline?: number;
  unit?: string;
  range?: { min: number; max: number };
  /** Extraction metadata for uncertainty derivation */
  extractionType?: ExtractionType;
  confidence?: number;
  rangeMin?: number;
  rangeMax?: number;
}

/**
 * OptionData structure for option nodes (V4 prompt format)
 * Maps factor IDs to their intervention values
 */
export interface V1OptionData {
  interventions: Record<string, number>;
}

/**
 * V1 Node data - can be either FactorData or OptionData depending on node kind
 */
export type V1NodeData = V1FactorData | V1OptionData;

/**
 * Type guard to check if node data is FactorData (has 'value' or no 'interventions')
 */
export function isFactorData(data: V1NodeData | undefined): data is V1FactorData {
  if (!data) return false;
  // OptionData has 'interventions' key, FactorData does not
  return !('interventions' in data);
}

/**
 * Type guard to check if node data is OptionData (has 'interventions')
 */
export function isOptionData(data: V1NodeData | undefined): data is V1OptionData {
  if (!data) return false;
  return 'interventions' in data;
}

export interface V1Node {
  id: string;
  kind: string;
  label?: string;
  body?: string;
  data?: V1NodeData;
}

export interface V1Edge {
  id?: string;
  from: string;
  to: string;
  weight?: number;
  belief?: number;
  provenance?: string | ProvenanceObject;
  provenance_source?: string;
  // LLM may output this if prompt is updated
  effect_direction?: EffectDirection;
  // V4 fields (populated by normalisation.ts from V4 LLM output)
  // These take precedence over legacy weight/belief when present
  strength_mean?: number;
  strength_std?: number;
  belief_exists?: number;
}

export interface V1Graph {
  version?: string;
  default_seed?: number;
  nodes: V1Node[];
  edges: V1Edge[];
  meta?: {
    roots?: string[];
    leaves?: string[];
    suggested_positions?: Record<string, { x: number; y: number }>;
    source?: string;
  };
}

export interface V1DraftGraphResponse {
  graph: V1Graph;
  quality?: {
    overall: number;
    structure?: number;
    coverage?: number;
    causality?: number;
    safety?: number;
  };
  trace?: {
    request_id?: string;
    correlation_id?: string;
    engine?: Record<string, unknown>;
  };
  validation_issues?: Array<Record<string, unknown>>;
  draft_warnings?: Array<{
    type: string;
    message: string;
    severity?: string;
  }>;
  [key: string]: unknown;
}

// ============================================================================
// V2 Types (Output)
// ============================================================================

/** Valid node types in v2.2 contract */
export type V2NodeType = "factor" | "option" | "outcome" | "goal" | "risk";

export interface V2ObservedState {
  value: number;
  baseline?: number;
  unit?: string;
  source?: string;
  range?: { min: number; max: number };
  /** Derived uncertainty (standard deviation) for the value */
  value_std?: number;
}

export interface V2Node {
  id: string;
  /** v2: Changed from "kind" to "type" per contract */
  type: V2NodeType;
  /** v2: Required (was optional in v1) - uses id as fallback */
  label: string;
  /** v2: Renamed from "body" to "description" */
  description?: string;
  /** v2: Renamed from "data" - for factor nodes with extracted values */
  observed_state?: V2ObservedState;
}

export interface V2Edge {
  id: string;
  from: string;
  to: string;
  /** Magnitude (unchanged from v1) */
  weight: number;
  /** Structural uncertainty - maps to exists_probability (unchanged from v1) */
  belief: number;
  /** v2: Effect direction */
  effect_direction: EffectDirection;
  /** v2: Derived parametric uncertainty */
  strength_std: number;
  /** v2: String only (not object) per contract */
  provenance?: string;
  // Note: provenance_source intentionally omitted from v2 contract
}

/**
 * Parameter uncertainty for ISL sampling.
 * Specifies uncertainty distribution for factor nodes.
 */
export interface ParameterUncertainty {
  /** Factor node ID */
  node_id: string;
  /** Standard deviation for the value */
  std: number;
  /** Distribution type (default: normal for derived uncertainties) */
  distribution: "normal" | "uniform" | "point_mass";
}

export interface V2Graph {
  version: string;
  default_seed?: number;
  nodes: V2Node[];
  edges: V2Edge[];
  /** Parameter uncertainties for ISL factor sampling */
  parameter_uncertainties?: ParameterUncertainty[];
  meta?: {
    roots?: string[];
    leaves?: string[];
    suggested_positions?: Record<string, { x: number; y: number }>;
    source?: string;
  };
}

export interface V2DraftGraphResponse {
  /** v2: Schema version marker */
  schema_version: "2.2";
  graph: V2Graph;
  quality?: {
    overall: number;
    structure?: number;
    coverage?: number;
    causality?: number;
    safety?: number;
  };
  trace?: {
    request_id?: string;
    correlation_id?: string;
    engine?: Record<string, unknown>;
  };
  validation_issues?: Array<Record<string, unknown>>;
  draft_warnings?: Array<{
    type: string;
    message: string;
    severity?: string;
  }>;
  [key: string]: unknown;
}

// ============================================================================
// Transformers
// ============================================================================

/**
 * Map v1 kind values to v2 type values.
 * - decision → option (decisions are choices between options)
 * - action → option (actions are a type of option)
 * - constraint → factor (UI cannot create constraint nodes; deprecated)
 * - Unknown kinds default to "factor" with warning logged
 */
function mapKindToType(kind: string): V2NodeType {
  const mapping: Record<string, V2NodeType> = {
    goal: "goal",
    outcome: "outcome",
    factor: "factor",
    option: "option",
    risk: "risk",
    decision: "option", // Map decision → option
    action: "option", // Map action → option
    constraint: "factor", // Deprecated: UI cannot create constraint nodes
  };
  const mapped = mapping[kind];
  if (mapped === undefined) {
    // Log unknown kind for observability
    log.warn({
      kind,
      defaultedTo: "factor",
      event: "cee.schema_v2.unknown_node_kind",
    }, `Unknown node kind "${kind}", defaulting to "factor"`);
    return "factor";
  }
  return mapped;
}

/**
 * Extract provenance as string only (v2 contract requirement).
 * Converts ProvenanceObject to string if needed.
 */
function extractProvenanceString(
  prov?: string | ProvenanceObject
): string | undefined {
  if (!prov) return undefined;
  if (typeof prov === "string") return prov;
  // Extract meaningful string from object - prefer quote, then source
  return prov.quote ?? prov.source ?? undefined;
}

/**
 * Transform a v1 node to v2 format.
 *
 * Changes from v1:
 * - kind → type (with mapping)
 * - label is required (uses id as fallback)
 * - body → description
 * - data → observed_state (only when value is defined)
 * - value_std derived from extraction metadata (v2.2+)
 */
export function transformNodeToV2(node: V1Node): V2Node {
  const v2Node: V2Node = {
    id: node.id,
    type: mapKindToType(node.kind),
    label: node.label ?? node.id, // Required - use id as fallback
    description: node.body,
  };

  // Move data to observed_state ONLY if it's FactorData with value defined
  // (baseline alone is not sufficient per contract)
  // OptionData (with interventions) is handled separately in V3 transformation
  if (isFactorData(node.data) && node.data.value !== undefined) {
    // Derive range from rangeMin/rangeMax if not present (canonical representation)
    const range = node.data.range ?? (
      node.data.rangeMin !== undefined && node.data.rangeMax !== undefined
        ? { min: node.data.rangeMin, max: node.data.rangeMax }
        : undefined
    );

    const observedState: V2ObservedState = {
      value: node.data.value,
      baseline: node.data.baseline,
      unit: node.data.unit,
      source: "brief_extraction",
      range,
    };

    // Derive value_std if extraction metadata is available
    if (node.data.extractionType && node.data.confidence !== undefined) {
      const uncertaintyResult = deriveValueUncertainty({
        value: node.data.value,
        extractionType: node.data.extractionType,
        confidence: node.data.confidence,
        rangeMin: node.data.rangeMin,
        rangeMax: node.data.rangeMax,
      });
      observedState.value_std = uncertaintyResult.valueStd;
    }

    v2Node.observed_state = observedState;
  }

  return v2Node;
}

/**
 * Transform a v1 edge to v2 format.
 *
 * Changes from v1:
 * - Adds effect_direction (inferred if not provided by LLM)
 * - Adds strength_std (derived from belief/provenance)
 * - provenance is string only (not object)
 * - provenance_source is omitted from v2
 */
export function transformEdgeToV2(
  edge: V1Edge,
  index: number,
  nodes: NodeInfo[]
): V2Edge {
  // Ensure required fields have defaults
  const weight = edge.weight ?? 0.5;
  const belief = edge.belief ?? 0.5;

  // Get effect_direction from LLM output or infer
  const effectDirection = ensureEffectDirection(edge, nodes);

  // Derive strength_std from weight, belief, and provenance
  const strengthStd = deriveStrengthStd(weight, belief, edge.provenance);

  return {
    id: edge.id ?? `edge_${index}`,
    from: edge.from,
    to: edge.to,
    weight,
    belief,
    effect_direction: effectDirection,
    strength_std: strengthStd,
    provenance: extractProvenanceString(edge.provenance),
    // Note: provenance_source intentionally omitted from v2
  };
}

/**
 * Transform a v1 graph to v2 format.
 */
export function transformGraphToV2(graph: V1Graph): V2Graph {
  // Transform nodes first (needed for effect direction inference)
  const v2Nodes = graph.nodes.map(transformNodeToV2);

  // Create node info for effect direction inference
  const nodeInfos: NodeInfo[] = graph.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label ?? n.id,
  }));

  // Transform edges
  const v2Edges = graph.edges.map((edge, index) =>
    transformEdgeToV2(edge, index, nodeInfos)
  );

  // Build parameter_uncertainties from factor nodes with value_std
  const parameterUncertainties: ParameterUncertainty[] = [];
  for (const node of v2Nodes) {
    if (node.observed_state?.value_std !== undefined) {
      parameterUncertainties.push({
        node_id: node.id,
        std: node.observed_state.value_std,
        distribution: "normal",
      });
    }
  }

  const v2Graph: V2Graph = {
    version: graph.version ?? "1",
    default_seed: graph.default_seed,
    nodes: v2Nodes,
    edges: v2Edges,
    meta: graph.meta,
  };

  // Only include parameter_uncertainties if there are any
  if (parameterUncertainties.length > 0) {
    v2Graph.parameter_uncertainties = parameterUncertainties;
  }

  return v2Graph;
}

/**
 * Transform a complete v1 draft-graph response to v2 format.
 *
 * @param v1Response - V1 draft-graph response
 * @returns V2 draft-graph response with schema_version: "2.2"
 */
export function transformResponseToV2(
  v1Response: V1DraftGraphResponse
): V2DraftGraphResponse {
  const { graph, ...rest } = v1Response;
  const v2Graph = transformGraphToV2(graph);

  // Count factor nodes with value_std for telemetry
  const factorNodesWithValueStd = v2Graph.nodes.filter(
    (n) => n.type === "factor" && n.observed_state?.value_std !== undefined
  ).length;

  // Emit telemetry for transform completion
  emit(TelemetryEvents.SchemaV2TransformComplete, {
    nodeCount: v2Graph.nodes.length,
    edgeCount: v2Graph.edges.length,
    parameterUncertaintiesCount: v2Graph.parameter_uncertainties?.length ?? 0,
    hasParameterUncertainties: (v2Graph.parameter_uncertainties?.length ?? 0) > 0,
    factorNodesWithValueStd,
  });

  return {
    ...rest,
    schema_version: "2.2",
    graph: v2Graph,
  };
}

/**
 * Check if a schema version is valid.
 */
export function isValidSchemaVersion(version: unknown): version is "v1" | "v2" | "v3" {
  return version === "v1" || version === "v2" || version === "v3";
}

/**
 * Schema version type.
 */
export type SchemaVersion = "v1" | "v2" | "v3";

/**
 * Parse schema version from query parameter.
 * Default: V3 (includes analysis_ready payload for run-ready options).
 * V1/V2 are deprecated but still supported via explicit ?schema=v1 or ?schema=v2.
 */
export function parseSchemaVersion(
  queryParam: unknown
): SchemaVersion {
  // Explicit V1 request (deprecated)
  if (queryParam === "v1" || queryParam === "1" || queryParam === "1.0") {
    return "v1";
  }
  // Explicit V2 request (deprecated)
  if (queryParam === "v2" || queryParam === "2" || queryParam === "2.2") {
    return "v2";
  }
  // V3 is now the default - includes analysis_ready for PLoT consumption
  // Accepts: "v3", "3", "3.0", or unspecified/invalid
  return "v3";
}
