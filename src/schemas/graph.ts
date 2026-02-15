import { z } from "zod";

export const ProvenanceSource = z.enum(["document", "metric", "hypothesis", "engine", "synthetic"]);
export const NodeKind = z.enum(["goal", "decision", "option", "outcome", "risk", "action", "factor", "constraint"]);

/**
 * Factor type classification for downstream enrichment.
 * Shared across all prompts for consistent factor categorization.
 */
export const FactorType = z.enum(["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"]);

/**
 * Factor category classification (V12.4+).
 * - controllable: Has incoming edge from option node, options set this value
 * - observable: No option edge but has known current state (data.value)
 * - external: No option edge, unknown/variable state (no data field)
 */
export const FactorCategory = z.enum(["controllable", "observable", "external"]);

export const Position = z.object({ x: z.number(), y: z.number() });

/**
 * Quantitative data for factor nodes.
 * Enables ISL sensitivity, VoI, and tipping point analysis.
 */
export const FactorData = z.object({
  /** Current or proposed value */
  value: z.number(),
  /** Baseline/original value (e.g., "from X to Y" → baseline is X) */
  baseline: z.number().optional(),
  /** Unit of measurement (£, $, %, etc.) */
  unit: z.string().optional(),
  /** Raw value before normalization (preserves original extraction) */
  raw_value: z.number().optional(),
  /** Upper bound/cap for the value (e.g., "up to £500k" → cap is 500000) */
  cap: z.number().optional(),
  /** Valid range for sensitivity analysis */
  range: z.object({
    min: z.number(),
    max: z.number()
  }).optional(),
  /** How the value was extracted (explicit, inferred, range, observed) */
  extractionType: z.enum(["explicit", "inferred", "range", "observed"]).optional(),
  /** Extraction confidence (0-1) for uncertainty derivation */
  confidence: z.number().min(0).max(1).optional(),
  /** For range extractions: minimum bound */
  rangeMin: z.number().optional(),
  /** For range extractions: maximum bound */
  rangeMax: z.number().optional(),
  /**
   * Factor type classification for downstream enrichment (V12+).
   * One of: cost, price, time, probability, revenue, demand, quality, other
   */
  factor_type: FactorType.optional(),
  /**
   * 1-2 short phrases explaining sources of epistemic uncertainty (V12+).
   * Observations only — describe what makes the value uncertain.
   * Must not contain duplicate entries.
   */
  uncertainty_drivers: z.array(z.string()).max(2).refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "uncertainty_drivers must not contain duplicates" }
  ).optional(),
}).passthrough();

/**
 * Intervention data for option nodes.
 * V4 prompt instructs LLM to include interventions directly on option nodes.
 * Maps factor IDs to their intervention values (numeric only).
 */
export const OptionData = z.object({
  interventions: z.record(z.string(), z.number()),
}).passthrough();

/**
 * Constraint operator for threshold comparisons.
 * PLoT requires ASCII operators only - no unicode.
 */
export const ConstraintOperator = z.enum([">=", "<="]);

/**
 * Metadata for constraint observed_state.
 * PLoT looks for operator in this location.
 */
export const ConstraintMetadata = z.object({
  /** Comparison operator - REQUIRED by PLoT */
  operator: ConstraintOperator,
  /** Original value before any normalization (for round-trip) */
  original_value: z.number().optional(),
  /** Unit of measurement if known */
  unit: z.string().optional(),
  /** Deadline date for temporal constraints (ISO format) */
  deadline_date: z.string().optional(),
  /** Reference date used for temporal computation */
  reference_date: z.string().optional(),
  /** Whether reference date was assumed vs explicit */
  assumed_reference_date: z.boolean().optional(),
});

/**
 * Observed state for constraint nodes.
 * Contains the threshold value and operator metadata.
 */
export const ConstraintObservedState = z.object({
  /** Threshold value in user units - PLoT normalises */
  value: z.number(),
  /** Metadata including the explicit operator */
  metadata: ConstraintMetadata,
});

/**
 * Data field for constraint nodes (redundant operator for PLoT compatibility).
 * PLoT checks both observed_state.metadata.operator and data.operator.
 */
export const ConstraintNodeData = z.object({
  /** Redundant operator - ensures PLoT finds it */
  operator: ConstraintOperator,
}).passthrough();

/**
 * Union type for node data — order matters for Zod union matching:
 * 1. OptionData first: requires 'interventions' (won't false-match factor/constraint)
 * 2. ConstraintNodeData: requires 'operator' (won't false-match factor/option)
 * 3. FactorData last: permissive fallback (only requires 'value')
 *
 * FactorData was previously first, causing it to match option nodes that had
 * both 'value' and 'interventions', silently stripping 'interventions'.
 */
export const NodeData = z.union([OptionData, ConstraintNodeData, FactorData]);

export const Node = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
  /**
   * Factor category classification (V12.4+).
   * Only applies to factor nodes. Optional for backward compatibility.
   * - controllable: Has incoming edge from option node
   * - observable: No option edge but has data.value
   * - external: No option edge, no data.value
   */
  category: FactorCategory.optional(),
  /**
   * Node data - type depends on node kind:
   * - factor nodes: FactorData (quantitative values for ISL)
   * - option nodes: OptionData (intervention mappings from V4 prompt)
   * - constraint nodes: ConstraintNodeData (redundant operator for PLoT)
   */
  data: NodeData.optional(),
  /**
   * Observed state for constraint nodes (PLoT Phase 1 T6).
   * Contains threshold value and explicit operator.
   * PLoT requires operator in observed_state.metadata.operator.
   */
  observed_state: ConstraintObservedState.optional(),
  /**
   * Goal threshold fields (V14+).
   * Only applies to goal nodes. Extracted from explicit numeric targets in brief.
   * See prompt v14 lines 150-162 for extraction rules.
   */
  /** Normalised threshold in model units (0-1), computed as goal_threshold_raw / goal_threshold_cap */
  goal_threshold: z.number().optional(),
  /** Raw threshold value from brief for UI display (e.g., 800 for "target 800 customers") */
  goal_threshold_raw: z.number().optional(),
  /** Unit of measurement for display (e.g., "customers", "%", "£") */
  goal_threshold_unit: z.string().optional(),
  /** Normalisation denominator (e.g., 1000 for "800/1000 = 0.8") */
  goal_threshold_cap: z.number().optional(),
}).passthrough();

// Structured provenance for production trust and traceability
export const StructuredProvenance = z.object({
  source: z.string().min(1), // File name, metric name, or "hypothesis"
  quote: z.string().max(100), // Short citation or statement
  location: z.string().optional(), // "page 3", "row 42", "line 15", etc.
});

/**
 * Effect direction for causal edges.
 * Indicates whether increasing the source increases or decreases the target.
 * - "positive": Increasing source increases target (e.g., Marketing → Revenue)
 * - "negative": Increasing source decreases target (e.g., Price → Demand)
 */
export const EffectDirection = z.enum(["positive", "negative"]);

/**
 * Edge origin classification for tracking creation source.
 * - "user": Edge was explicitly created by user input
 * - "ai": Edge was generated by the LLM
 * - "default": Edge was added by system defaults or structural rules
 */
export const EdgeOrigin = z.enum(["user", "ai", "default", "repair", "enrichment"]);

/**
 * Raw edge input schema - accepts both from/to and source/target formats.
 * Used for parsing input; see EdgeInput for the flexible input type.
 *
 * V4 Edge Fields:
 * - strength_mean: Effect magnitude [-1, +1], sign indicates direction
 * - strength_std: Parametric uncertainty for sensitivity analysis
 * - belief_exists: Confidence in relationship existence [0, 1]
 *
 * Legacy Fields (deprecated, use V4 equivalents):
 * - weight: @deprecated Use strength_mean instead
 * - belief: @deprecated Use belief_exists instead
 */
const EdgeInput = z.object({
  id: z.string().optional(),
  // Primary format (PLoT convention)
  from: z.string().optional(),
  to: z.string().optional(),
  // Alternative format (common in graph libraries like D3, Cytoscape, vis.js)
  source: z.string().optional(),
  target: z.string().optional(),
  // V4 edge fields (preferred)
  /** Effect magnitude: [-1, +1]. Sign indicates direction (positive/negative). */
  strength_mean: z.number().optional(),
  /** Parametric uncertainty derived from belief and provenance. */
  strength_std: z.number().positive().optional(),
  /** Confidence in relationship existence: [0, 1]. */
  belief_exists: z.number().min(0).max(1).optional(),
  // Legacy fields (deprecated - kept for backwards compatibility)
  /** @deprecated Use strength_mean instead. */
  weight: z.number().optional(),
  /** @deprecated Use belief_exists instead. */
  belief: z.number().min(0).max(1).optional(),
  // Support both structured and legacy string provenance for migration
  provenance: z.union([StructuredProvenance, z.string().min(1)]).optional(),
  provenance_source: ProvenanceSource.optional(),
  // Effect direction: LLM outputs directly, fallback to heuristic inference if missing
  effect_direction: EffectDirection.optional(),
  // Edge origin: tracks whether edge was created by user, AI, or system defaults
  origin: EdgeOrigin.optional()
}).passthrough().refine(
  (edge) => (edge.from && edge.to) || (edge.source && edge.target),
  { message: "Edge must have either from/to or source/target fields" }
);

/**
 * Edge schema with normalization - accepts both formats, outputs from/to.
 *
 * Many graph libraries use source/target by default, so we accept both
 * at the API boundary and normalize to from/to internally.
 */
export const Edge = EdgeInput.transform((edge) => {
  // Normalize to from/to, removing source/target from output
  const { source, target, ...rest } = edge;
  return {
    ...rest,
    from: edge.from ?? source!,
    to: edge.to ?? target!,
  };
});

export const Graph = z.object({
  version: z.string().default("1"),
  default_seed: z.number().default(17),
  nodes: z.array(Node),
  edges: z.array(Edge),
  meta: z
    .object({
      roots: z.array(z.string()).default([]),
      leaves: z.array(z.string()).default([]),
      suggested_positions: z.record(z.string(), Position).default({}),
      source: z.enum(["assistant", "fixtures", "test"]).default("assistant")
    })
    .default({ roots: [], leaves: [], suggested_positions: {}, source: "assistant" })
});

export type GraphT = z.infer<typeof Graph>;
export type EdgeT = z.infer<typeof Edge>;
export type NodeT = z.infer<typeof Node>;
export type FactorDataT = z.infer<typeof FactorData>;
export type OptionDataT = z.infer<typeof OptionData>;
export type NodeDataT = z.infer<typeof NodeData>;
export type StructuredProvenanceT = z.infer<typeof StructuredProvenance>;
export type EffectDirectionT = z.infer<typeof EffectDirection>;
export type EdgeOriginT = z.infer<typeof EdgeOrigin>;
export type FactorTypeT = z.infer<typeof FactorType>;
export type FactorCategoryT = z.infer<typeof FactorCategory>;

/**
 * Check if a graph contains any legacy string provenance (for deprecation tracking)
 * Returns count of edges with string provenance for telemetry
 */
export function hasLegacyProvenance(graph: GraphT): { hasLegacy: boolean; count: number } {
  let count = 0;
  for (const edge of graph.edges) {
    if (edge.provenance && typeof edge.provenance === "string") {
      count++;
    }
  }
  return { hasLegacy: count > 0, count };
}
