import { z } from "zod";

export const ProvenanceSource = z.enum(["document", "metric", "hypothesis", "engine"]);
export const NodeKind = z.enum(["goal", "decision", "option", "outcome", "risk", "action", "factor"]);

/**
 * Factor type classification for downstream enrichment.
 * Shared across all prompts for consistent factor categorization.
 */
export const FactorType = z.enum(["cost", "time", "probability", "revenue", "demand", "quality", "other"]);
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
  /** Valid range for sensitivity analysis */
  range: z.object({
    min: z.number(),
    max: z.number()
  }).optional(),
  /** How the value was extracted (explicit, inferred, range) */
  extractionType: z.enum(["explicit", "inferred", "range"]).optional(),
  /** Extraction confidence (0-1) for uncertainty derivation */
  confidence: z.number().min(0).max(1).optional(),
  /** For range extractions: minimum bound */
  rangeMin: z.number().optional(),
  /** For range extractions: maximum bound */
  rangeMax: z.number().optional(),
  /**
   * Factor type classification for downstream enrichment (V12+).
   * One of: cost, time, probability, revenue, demand, quality, other
   */
  factor_type: FactorType.optional(),
  /**
   * 1-2 short phrases explaining sources of epistemic uncertainty (V12+).
   * Observations only — describe what makes the value uncertain.
   */
  uncertainty_drivers: z.array(z.string()).max(2).optional(),
});

/**
 * Intervention data for option nodes.
 * V4 prompt instructs LLM to include interventions directly on option nodes.
 * Maps factor IDs to their intervention values (numeric only).
 */
export const OptionData = z.object({
  interventions: z.record(z.string(), z.number()),
});

/**
 * Union type for node data - can be either:
 * - FactorData: quantitative data for factor nodes (ISL integration)
 * - OptionData: intervention mappings for option nodes (V4 format)
 */
export const NodeData = z.union([FactorData, OptionData]);

export const Node = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
  /**
   * Node data - type depends on node kind:
   * - factor nodes: FactorData (quantitative values for ISL)
   * - option nodes: OptionData (intervention mappings from V4 prompt)
   */
  data: NodeData.optional()
});

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
  effect_direction: EffectDirection.optional()
}).refine(
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
      source: z.enum(["assistant", "fixtures"]).default("assistant")
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
export type FactorTypeT = z.infer<typeof FactorType>;

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
