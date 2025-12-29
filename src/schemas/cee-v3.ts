/**
 * CEE V3 Schema Types
 *
 * V3 introduces a canonical intervention model where options are separate from
 * graph nodes and include explicit intervention mappings to factor nodes.
 *
 * Key changes from V2:
 * - Options moved from graph.nodes to top-level options[] array
 * - Options include interventions: { factor_id: { value, source, target_match } }
 * - Options have status: 'ready' | 'needs_user_mapping'
 * - goal_node_id is required at top level
 * - Edge strength uses strength_mean (unconstrained) instead of weight (0-1)
 */

import { z } from "zod";

// ============================================================================
// Node Types
// ============================================================================

/**
 * Valid node kinds in V3.
 * Note: 'option' is NOT a valid node kind - options are separate.
 */
export const NodeKindV3 = z.enum([
  "goal",
  "factor",
  "outcome",
  "decision",
  "risk",
  "action",
]);
export type NodeKindV3T = z.infer<typeof NodeKindV3>;

/**
 * Observed state for factor nodes with quantitative values.
 */
export const ObservedStateV3 = z.object({
  /** Current or proposed value */
  value: z.number(),
  /** Baseline/original value */
  baseline: z.number().optional(),
  /** Unit of measurement (e.g., 'GBP', 'USD', 'percent', 'count', 'months') */
  unit: z.string().optional(),
  /** How the value was determined */
  source: z.enum(["brief_extraction", "cee_inference"]).optional(),
});
export type ObservedStateV3T = z.infer<typeof ObservedStateV3>;

/**
 * V3 node schema.
 */
export const NodeV3 = z.object({
  /** Node ID - pattern: ^[a-z0-9_:-]+$ */
  id: z.string().regex(/^[a-z0-9_:-]+$/, "Node ID must be lowercase alphanumeric with underscores, colons, or hyphens"),
  /** Node kind - NOT 'option' */
  kind: NodeKindV3,
  /** Human-readable label */
  label: z.string(),
  /** Optional description */
  description: z.string().optional(),
  /** Quantitative data for factor nodes */
  observed_state: ObservedStateV3.optional(),
});
export type NodeV3T = z.infer<typeof NodeV3>;

// ============================================================================
// Edge Types
// ============================================================================

/**
 * Edge provenance in V3.
 */
export const EdgeProvenanceV3 = z.object({
  /** Source of the relationship */
  source: z.enum(["brief_extraction", "cee_hypothesis", "domain_knowledge", "user_specified"]),
  /** Optional reasoning */
  reasoning: z.string().optional(),
});
export type EdgeProvenanceV3T = z.infer<typeof EdgeProvenanceV3>;

/**
 * V3 edge schema with strength coefficients.
 */
export const EdgeV3 = z.object({
  /** Source node ID */
  from: z.string(),
  /** Target node ID */
  to: z.string(),
  /** Signed linear coefficient (NOT constrained to 0-1) */
  strength_mean: z.number(),
  /** Parametric uncertainty, must be > 0 */
  strength_std: z.number().positive(),
  /** Existence probability [0, 1] */
  belief_exists: z.number().min(0).max(1),
  /** Effect direction (derived from strength_mean sign) */
  effect_direction: z.enum(["positive", "negative"]),
  /** Provenance */
  provenance: EdgeProvenanceV3.optional(),
});
export type EdgeV3T = z.infer<typeof EdgeV3>;

// ============================================================================
// Intervention Types
// ============================================================================

/**
 * How an intervention target was matched to a graph node.
 */
export const TargetMatch = z.object({
  /** The matched node ID */
  node_id: z.string(),
  /** How the match was determined */
  match_type: z.enum(["exact_id", "exact_label", "semantic"]),
  /** Confidence in the match */
  confidence: z.enum(["high", "medium", "low"]),
});
export type TargetMatchT = z.infer<typeof TargetMatch>;

/**
 * A single intervention on a factor.
 */
export const InterventionV3 = z.object({
  /** Numeric value (MUST be numeric, no strings) */
  value: z.number(),
  /** Unit (should match target factor's observed_state.unit) */
  unit: z.string().optional(),
  /** How this intervention was determined */
  source: z.enum(["brief_extraction", "cee_hypothesis", "user_specified"]),
  /** How the target was matched */
  target_match: TargetMatch,
  /** Confidence in the value itself */
  value_confidence: z.enum(["high", "medium", "low"]).optional(),
  /** Explanation for transparency */
  reasoning: z.string().optional(),
});
export type InterventionV3T = z.infer<typeof InterventionV3>;

/**
 * Option provenance.
 */
export const OptionProvenanceV3 = z.object({
  /** Source of the option */
  source: z.enum(["brief_extraction", "cee_hypothesis", "user_specified"]),
  /** The text this was extracted from (dev only) */
  brief_quote: z.string().optional(),
});
export type OptionProvenanceV3T = z.infer<typeof OptionProvenanceV3>;

/**
 * V3 option schema - decision paths with intervention bundles.
 */
export const OptionV3 = z.object({
  /** Option ID - pattern: ^[a-z0-9_:-]+$ */
  id: z.string().regex(/^[a-z0-9_:-]+$/, "Option ID must be lowercase alphanumeric with underscores, colons, or hyphens"),
  /** Human-readable label */
  label: z.string(),
  /** Optional description */
  description: z.string().optional(),
  /** Option readiness status */
  status: z.enum(["ready", "needs_user_mapping"]),
  /** Intervention bundle: factor_id -> intervention */
  interventions: z.record(z.string(), InterventionV3),
  /** Concepts mentioned but not matched to factors */
  unresolved_targets: z.array(z.string()).optional(),
  /** Specific questions for the user */
  user_questions: z.array(z.string()).optional(),
  /** Provenance */
  provenance: OptionProvenanceV3.optional(),
});
export type OptionV3T = z.infer<typeof OptionV3>;

// ============================================================================
// Validation Warning Types
// ============================================================================

/**
 * Validation warning codes.
 */
export const ValidationWarningCode = z.enum([
  "INTERVENTION_TARGET_DISCONNECTED",
  "INTERVENTION_TARGET_NOT_FOUND",
  "UNIT_MISMATCH_SUSPECTED",
  "MISSING_UNIT",
  "LOW_CONFIDENCE_MATCH",
  "EMPTY_INTERVENTIONS_READY",
  "GOAL_NODE_MISSING",
  "OPTION_NODE_IN_GRAPH",
  "DUPLICATE_NODE_ID",
  "INVALID_NODE_ID",
]);
export type ValidationWarningCodeT = z.infer<typeof ValidationWarningCode>;

/**
 * Validation warning.
 */
export const ValidationWarningV3 = z.object({
  /** Warning code */
  code: z.string(),
  /** Severity level */
  severity: z.enum(["info", "warning", "error"]),
  /** Human-readable message */
  message: z.string(),
  /** Affected option ID */
  affected_option_id: z.string().optional(),
  /** Affected node ID */
  affected_node_id: z.string().optional(),
  /** Suggested fix */
  suggestion: z.string().optional(),
});
export type ValidationWarningV3T = z.infer<typeof ValidationWarningV3>;

// ============================================================================
// Graph Types
// ============================================================================

/**
 * V3 graph structure (without options - they're separate).
 */
export const GraphV3 = z.object({
  /** Graph nodes */
  nodes: z.array(NodeV3),
  /** Graph edges */
  edges: z.array(EdgeV3),
});
export type GraphV3T = z.infer<typeof GraphV3>;

/**
 * Graph metadata.
 */
export const GraphMetaV3 = z.object({
  /** Root node IDs */
  roots: z.array(z.string()).optional(),
  /** Leaf node IDs */
  leaves: z.array(z.string()).optional(),
  /** Graph source */
  source: z.enum(["assistant", "user", "imported"]).optional(),
});
export type GraphMetaV3T = z.infer<typeof GraphMetaV3>;

// ============================================================================
// Response Types
// ============================================================================

/**
 * Complete CEE V3 response schema.
 */
export const CEEGraphResponseV3 = z.object({
  /** Schema version marker */
  schema_version: z.literal("3.0"),
  /** Causal graph (no option nodes) */
  graph: GraphV3,
  /** Decision paths with intervention bundles */
  options: z.array(OptionV3),
  /** Goal node ID - must reference a node with kind='goal' */
  goal_node_id: z.string(),
  /** Validation warnings */
  validation_warnings: z.array(ValidationWarningV3).optional(),
  /** Graph metadata */
  meta: GraphMetaV3.optional(),
  /** Quality metrics (carried from V2) */
  quality: z.object({
    overall: z.number().min(0).max(1),
    structure: z.number().min(0).max(1).optional(),
    coverage: z.number().min(0).max(1).optional(),
    causality: z.number().min(0).max(1).optional(),
    safety: z.number().min(0).max(1).optional(),
  }).optional(),
  /** Trace information */
  trace: z.object({
    request_id: z.string().optional(),
    correlation_id: z.string().optional(),
    engine: z.record(z.unknown()).optional(),
  }).optional(),
});
export type CEEGraphResponseV3T = z.infer<typeof CEEGraphResponseV3>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an option is ready for analysis.
 */
export function isOptionReady(option: OptionV3T): boolean {
  return (
    option.status === "ready" &&
    Object.keys(option.interventions).length > 0
  );
}

/**
 * Get all intervention target node IDs for an option.
 */
export function getInterventionTargets(option: OptionV3T): string[] {
  return Object.values(option.interventions).map((i) => i.target_match.node_id);
}

/**
 * Check if a node is a valid intervention target (must be a factor).
 */
export function isValidInterventionTarget(node: NodeV3T): boolean {
  return node.kind === "factor";
}

/**
 * Derive effect_direction from strength_mean.
 */
export function deriveEffectDirection(
  strengthMean: number
): "positive" | "negative" {
  return strengthMean >= 0 ? "positive" : "negative";
}
