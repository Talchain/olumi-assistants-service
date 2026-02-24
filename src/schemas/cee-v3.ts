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
import { GoalConstraintSchema } from "./assist.js";
import { CausalClaimsArraySchema } from "./causal-claims.js";
import { ValidationWarningSchema as SharedValidationWarningSchema, CIL_WARNING_CODES } from "@talchain/schemas";
import { CAUSAL_CLAIMS_WARNING_CODES } from "./causal-claims.js";

// ============================================================================
// Node Types
// ============================================================================

/**
 * Valid node kinds in V3.
 * Options are included for graph connectivity (decision→option→factor).
 * Options also exist in the separate options[] array with intervention metadata.
 */
export const NodeKindV3 = z.enum([
  "goal",
  "factor",
  "outcome",
  "decision",
  "risk",
  "action",
  "option",
]);
export type NodeKindV3T = z.infer<typeof NodeKindV3>;

/**
 * Factor type classification for downstream enrichment.
 */
export const FactorTypeV3 = z.enum(["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"]);
export type FactorTypeV3T = z.infer<typeof FactorTypeV3>;

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
  /** Raw value before normalization (preserves original extraction) */
  raw_value: z.number().optional(),
  /** Upper bound/cap for the value (e.g., "up to £500k" → cap is 500000) */
  cap: z.number().optional(),
  /** How the value was extracted (explicit, inferred, range, observed) */
  extractionType: z.enum(["explicit", "inferred", "range", "observed"]).optional(),
  /** Factor type classification for downstream enrichment */
  factor_type: FactorTypeV3.optional(),
  /** 1-2 short phrases explaining sources of epistemic uncertainty */
  uncertainty_drivers: z.array(z.string()).max(2).refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "uncertainty_drivers must not contain duplicates" }
  ).optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
export type ObservedStateV3T = z.infer<typeof ObservedStateV3>;

/**
 * Factor category classification (V12.4+).
 * - controllable: Has incoming edge from option node, options set this value
 * - observable: No option edge but has known current state (data.value)
 * - external: No option edge, unknown/variable state (no data field)
 */
export const FactorCategoryV3 = z.enum(["controllable", "observable", "external"]);
export type FactorCategoryV3T = z.infer<typeof FactorCategoryV3>;

/**
 * V3 node schema.
 */
export const NodeV3 = z.object({
  /** Node ID - must start with letter, contain only alphanumeric, underscores, or hyphens */
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "Node ID must start with letter and contain only alphanumeric, underscores, or hyphens"),
  /** Node kind */
  kind: NodeKindV3,
  /** Human-readable label */
  label: z.string(),
  /** Optional description */
  description: z.string().optional(),
  /** Quantitative data for factor nodes */
  observed_state: ObservedStateV3.optional(),
  /** Factor category (V12.4+): controllable, observable, external - only for factor nodes */
  category: FactorCategoryV3.optional(),
  /**
   * Goal threshold fields (V14+).
   * Only applies to goal nodes. Extracted from explicit numeric targets in brief.
   */
  /** Normalised threshold in model units (0-1), computed as goal_threshold_raw / goal_threshold_cap */
  goal_threshold: z.number().optional(),
  /** Raw threshold value from brief for UI display (e.g., 800 for "target 800 customers") */
  goal_threshold_raw: z.number().optional(),
  /** Unit of measurement for display (e.g., "customers", "%", "£") */
  goal_threshold_unit: z.string().optional(),
  /** Normalisation denominator (e.g., 1000 for "800/1000 = 0.8") */
  goal_threshold_cap: z.number().optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
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
}).passthrough(); // CIL Phase 0: preserve additive fields
export type EdgeProvenanceV3T = z.infer<typeof EdgeProvenanceV3>;

/**
 * V3 edge strength — nested { mean, std } format (canonical Schema v2.2).
 */
export const EdgeStrengthV3 = z.object({
  /** Signed linear coefficient [-1, +1] */
  mean: z.number(),
  /** Parametric uncertainty, must be > 0 */
  std: z.number().positive(),
});
export type EdgeStrengthV3T = z.infer<typeof EdgeStrengthV3>;

/**
 * V3 edge schema with strength coefficients.
 * Canonical Schema v2.2: nested strength + exists_probability.
 */
export const EdgeV3 = z.object({
  /** Source node ID */
  from: z.string(),
  /** Target node ID */
  to: z.string(),
  /** Strength coefficient: { mean, std } (canonical nested format) */
  strength: EdgeStrengthV3,
  /** Existence probability [0, 1] */
  exists_probability: z.number().min(0).max(1),
  /** Effect direction (derived from strength.mean sign) */
  effect_direction: z.enum(["positive", "negative"]),
  /** Provenance */
  provenance: EdgeProvenanceV3.optional(),
  /** Edge creation source: ai, user, repair, enrichment, default */
  origin: z.string().optional(),
  /** Edge type: directed (default) or bidirected (unmeasured confounder). Phase 3A-trust. */
  edge_type: z.enum(["directed", "bidirected"]).optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
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
}).passthrough(); // CIL Phase 0: preserve additive fields
export type TargetMatchT = z.infer<typeof TargetMatch>;

/**
 * Value types supported for interventions.
 * - numeric: Standard quantitative value (e.g., price: 59)
 * - categorical: Named category (e.g., region: "UK")
 * - boolean: Toggle flag (e.g., feature_enabled: true)
 */
export const InterventionValueType = z.enum(["numeric", "categorical", "boolean"]);
export type InterventionValueTypeT = z.infer<typeof InterventionValueType>;

/**
 * Raw intervention value - supports numeric, categorical, or boolean.
 * Used in raw_interventions field for pre-encoding values.
 */
export const RawInterventionValue = z.union([
  z.number(),
  z.string(),
  z.boolean(),
]);
export type RawInterventionValueT = z.infer<typeof RawInterventionValue>;

/**
 * A single intervention on a factor.
 *
 * Supports the Raw+Encoded pattern:
 * - value: REQUIRED numeric value (for PLoT compatibility)
 * - raw_value: OPTIONAL original value before encoding (string/number/boolean)
 * - value_type: OPTIONAL type indicator for non-numeric interventions
 *
 * For numeric interventions: value = raw_value (or raw_value omitted)
 * For categorical: value = encoded integer, raw_value = "UK", value_type = "categorical"
 * For boolean: value = 0|1, raw_value = true|false, value_type = "boolean"
 */
export const InterventionV3 = z.object({
  /** Numeric value (MUST be numeric for PLoT compatibility) */
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
  // --- Raw+Encoded pattern fields (additive, optional) ---
  /** Original value before encoding (for categorical/boolean interventions) */
  raw_value: RawInterventionValue.optional(),
  /** Type of the intervention value */
  value_type: InterventionValueType.optional(),
  /** Encoding map for categorical values: raw_value -> encoded integer */
  encoding_map: z.record(z.string(), z.number()).optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
export type InterventionV3T = z.infer<typeof InterventionV3>;

/**
 * Option provenance.
 */
export const OptionProvenanceV3 = z.object({
  /** Source of the option */
  source: z.enum(["brief_extraction", "cee_hypothesis", "user_specified"]),
  /** The text this was extracted from (dev only) */
  brief_quote: z.string().optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields
export type OptionProvenanceV3T = z.infer<typeof OptionProvenanceV3>;

/**
 * Option status values.
 * - ready: All interventions encoded, ready for analysis
 * - needs_user_mapping: Missing factor matches or values
 * - needs_encoding: Has raw values (categorical/boolean) awaiting numeric encoding
 */
export const OptionStatusV3 = z.enum(["ready", "needs_user_mapping", "needs_encoding"]);
export type OptionStatusV3T = z.infer<typeof OptionStatusV3>;

// Compile-time guard: needs_user_input is payload-level only, never option-level (CIL Step 12)
type _AssertNeedsUserInputNotV3OptionStatus =
  "needs_user_input" extends OptionStatusV3T ? never : true;
const _assertV3OptionStatusExcludesNeedsUserInput: _AssertNeedsUserInputNotV3OptionStatus = true;
void _assertV3OptionStatusExcludesNeedsUserInput;

/**
 * V3 option schema - decision paths with intervention bundles.
 *
 * Supports the Raw+Encoded pattern for categorical/boolean interventions:
 * - interventions: ALWAYS present, contains encoded numeric values
 * - raw_interventions: OPTIONAL, contains original values before encoding
 * - status: "needs_encoding" when raw values exist but aren't yet encoded
 */
export const OptionV3 = z.object({
  /** Option ID - must start with letter, contain only alphanumeric, underscores, or hyphens */
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "Option ID must start with letter and contain only alphanumeric, underscores, or hyphens"),
  /** Human-readable label */
  label: z.string(),
  /** Optional description */
  description: z.string().optional(),
  /** Option readiness status */
  status: OptionStatusV3,
  /** Intervention bundle: factor_id -> intervention (encoded numeric values) */
  interventions: z.record(z.string(), InterventionV3),
  // --- Raw+Encoded pattern: parallel raw values (additive field) ---
  /** Raw intervention values before encoding (for categorical/boolean) */
  raw_interventions: z.record(z.string(), RawInterventionValue).optional(),
  /** Concepts mentioned but not matched to factors */
  unresolved_targets: z.array(z.string()).optional(),
  /** Specific questions for the user */
  user_questions: z.array(z.string()).optional(),
  /** Provenance */
  provenance: OptionProvenanceV3.optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
export type OptionV3T = z.infer<typeof OptionV3>;

// ============================================================================
// Validation Warning Types
// ============================================================================

/**
 * Validation warning codes.
 * Includes CEE-specific intervention/structure codes plus CIL codes from @talchain/schemas.
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
  // CIL warning codes from @talchain/schemas
  CIL_WARNING_CODES.STRENGTH_DEFAULT_APPLIED,
  CIL_WARNING_CODES.STRENGTH_MEAN_DEFAULT_DOMINANT,
  CIL_WARNING_CODES.EDGE_STRENGTH_LOW,
  CIL_WARNING_CODES.EDGE_STRENGTH_NEGLIGIBLE,
  // Causal claims validation warning codes (Phase 2B)
  CAUSAL_CLAIMS_WARNING_CODES.MALFORMED,
  CAUSAL_CLAIMS_WARNING_CODES.DROPPED,
  CAUSAL_CLAIMS_WARNING_CODES.INVALID_REF,
  CAUSAL_CLAIMS_WARNING_CODES.TRUNCATED,
]);
export type ValidationWarningCodeT = z.infer<typeof ValidationWarningCode>;

/**
 * Validation warning.
 * Extends SharedValidationWarningSchema (code, message, severity, details)
 * with CEE-specific fields for affected entities and suggestions.
 */
export const ValidationWarningV3 = SharedValidationWarningSchema.extend({
  /** Affected option ID */
  affected_option_id: z.string().optional(),
  /** Affected node ID */
  affected_node_id: z.string().optional(),
  /** Affected edge ID in format "from_id→to_id" */
  affected_edge_id: z.string().optional(),
  /** Suggested fix */
  suggestion: z.string().optional(),
  /** Pipeline stage that detected this issue */
  stage: z.string().optional(),
}); // SharedValidationWarningSchema already uses .passthrough()
export type ValidationWarningV3T = z.infer<typeof ValidationWarningV3>;

// ============================================================================
// Graph Types
// ============================================================================

/**
 * V3 graph structure.
 * Includes option nodes for connectivity (decision→option→factor).
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
}).passthrough(); // CIL Phase 0: preserve additive fields
export type GraphMetaV3T = z.infer<typeof GraphMetaV3>;

// ============================================================================
// Response Types
// ============================================================================

/**
 * Complete CEE V3 response schema.
 * Note: nodes and edges are at root level (not nested under graph).
 */
export const CEEGraphResponseV3 = z.object({
  /** Schema version marker */
  schema_version: z.literal("3.0"),
  /** Graph nodes at root level */
  nodes: z.array(NodeV3),
  /** Graph edges at root level */
  edges: z.array(EdgeV3),
  /** Decision paths with intervention bundles */
  options: z.array(OptionV3),
  /** Goal node ID - must reference a node with kind='goal' */
  goal_node_id: z.string(),
  /** Validation warnings */
  validation_warnings: z.array(ValidationWarningV3).optional(),
  /**
   * Goal constraints extracted from compound goals (Phase 3).
   * Populated when brief contains multiple quantitative targets.
   * PLoT merges these with compiled constraint nodes (explicit wins on conflict).
   */
  goal_constraints: z.array(GoalConstraintSchema).optional(),
  /** LLM coaching output — optional decision-quality insights */
  coaching: z.object({
    summary: z.string(),
    strengthen_items: z.array(z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      action_type: z.string(),
      bias_category: z.string().optional(),
    }).passthrough()),
  }).passthrough().optional(),
  /** LLM causal claims — stated reasoning about direct effects, mediations, confounders (Phase 2B) */
  causal_claims: CausalClaimsArraySchema,
  /** Graph metadata */
  meta: GraphMetaV3.optional(),
  /** Quality metrics (1–10 integer scale; see computeQuality / openapi.yaml CEEQualityMeta) */
  quality: z.object({
    overall: z.number().min(1).max(10),
    structure: z.number().min(1).max(10).optional(),
    coverage: z.number().min(1).max(10).optional(),
    structural_proxy: z.number().min(1).max(10).optional(),
    safety: z.number().min(1).max(10).optional(),
  }).optional(),
  /** Trace information */
  trace: z.object({
    request_id: z.string().optional(),
    correlation_id: z.string().optional(),
    engine: z.record(z.unknown()).optional(),
    /** Goal handling observability */
    goal_handling: z.object({
      goal_source: z.enum(["llm_generated", "retry_generated", "inferred", "placeholder"]),
      retry_attempted: z.boolean(),
      original_missing_kinds: z.array(z.string()).optional(),
      goal_node_id: z.string().optional(),
    }).optional(),
    /** Pipeline diagnostics (P0) */
    pipeline: z.record(z.unknown()).optional(),
  }).passthrough().optional(), // CIL Phase 0: preserve additive trace fields
}).passthrough(); // CIL Phase 0: preserve additive fields (e.g. goal_constraints, analysis_ready)
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
