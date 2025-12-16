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

// ============================================================================
// V1 Types (Input)
// ============================================================================

export interface V1Node {
  id: string;
  kind: string;
  label?: string;
  body?: string;
  data?: {
    value?: number;
    baseline?: number;
    unit?: string;
    range?: { min: number; max: number };
  };
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
export type V2NodeType = "factor" | "option" | "outcome" | "goal" | "risk" | "constraint";

export interface V2ObservedState {
  value: number;
  baseline?: number;
  unit?: string;
  source?: string;
  range?: { min: number; max: number };
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

export interface V2Graph {
  version: string;
  default_seed?: number;
  nodes: V2Node[];
  edges: V2Edge[];
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
 * - Unknown kinds default to "factor"
 */
function mapKindToType(kind: string): V2NodeType {
  const mapping: Record<string, V2NodeType> = {
    goal: "goal",
    outcome: "outcome",
    factor: "factor",
    option: "option",
    risk: "risk",
    constraint: "constraint",
    decision: "option", // Map decision → option
    action: "option", // Map action → option
  };
  return mapping[kind] ?? "factor"; // Default to factor for unknown kinds
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
 */
export function transformNodeToV2(node: V1Node): V2Node {
  const v2Node: V2Node = {
    id: node.id,
    type: mapKindToType(node.kind),
    label: node.label ?? node.id, // Required - use id as fallback
    description: node.body,
  };

  // Move data to observed_state ONLY if value is defined
  // (baseline alone is not sufficient per contract)
  if (node.data && node.data.value !== undefined) {
    v2Node.observed_state = {
      value: node.data.value,
      baseline: node.data.baseline,
      unit: node.data.unit,
      source: "brief_extraction",
      range: node.data.range,
    };
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

  return {
    version: graph.version ?? "1",
    default_seed: graph.default_seed,
    nodes: v2Nodes,
    edges: v2Edges,
    meta: graph.meta,
  };
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

  return {
    ...rest,
    schema_version: "2.2",
    graph: transformGraphToV2(graph),
  };
}

/**
 * Check if a schema version is valid.
 */
export function isValidSchemaVersion(version: unknown): version is "v1" | "v2" {
  return version === "v1" || version === "v2";
}

/**
 * Parse schema version from query parameter.
 * Returns "v1" if not specified or invalid.
 */
export function parseSchemaVersion(
  queryParam: unknown
): "v1" | "v2" {
  if (queryParam === "v2" || queryParam === "2" || queryParam === "2.2") {
    return "v2";
  }
  return "v1";
}
