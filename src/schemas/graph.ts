/**
 * Graph Schema — single source of truth for graph node/edge structures.
 *
 * .passthrough() policy:
 *   Every schema that parses LLM output or inter-stage pipeline data uses
 *   .passthrough() to preserve additive fields the LLM or upstream stages
 *   may produce. This prevents silent field stripping at Zod parse boundaries.
 *
 *   Schemas that SHOULD use .passthrough():
 *   - Node, EdgeInput, Graph, StructuredProvenance, FactorData, OptionData,
 *     ConstraintNodeData, ConstraintMetadata, ConstraintObservedState
 *     — all internal pipeline schemas (this file)
 *   - LLMNode, LLMEdge, LLMDraftResponse, LLMOptionsResponse,
 *     LLMClarifyResponse, LLMCritiqueResponse, LLMExplainDiffResponse
 *     (shared-schemas.ts)
 *   - NodeV3, EdgeV3, CEEGraphResponseV3 (cee-v3.ts)
 *   - DraftGraphOutput, GoalConstraintSchema (assist.ts)
 *
 *   Schemas that SHOULD NOT use .passthrough():
 *   - Inbound API request validation schemas (security boundary)
 *
 * @see src/adapters/llm/shared-schemas.ts  — LLM adapter Zod schemas
 * @see src/schemas/cee-v3.ts              — V3 output schemas
 * @see src/schemas/assist.ts              — route I/O schemas
 */
import { z } from "zod";
import { GoalThresholdFrame } from "@talchain/schemas";

export const ProvenanceSource = z.enum([
  "document", "metric", "hypothesis", "engine", "synthetic",
  // Extended set: LLM legitimately produces these for edge provenance
  "structural",        // structural edges (decision→option, option→factor)
  "domain_knowledge",  // inferred from domain expertise
  "inferred",          // inferred from context (also used in goal_constraints)
  "explicit",          // goal_constraints provenance (from prompt examples)
]);
export const NodeKind = z.enum(["goal", "decision", "option", "outcome", "risk", "action", "factor", "constraint"]);

/**
 * Factor type classification for downstream enrichment.
 * Shared across all prompts for consistent factor categorization.
 */
export const FactorType = z.enum(["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"]);

/**
 * How a factor's value was extracted. Hoisted out of `FactorData` (2026-07-25) so
 * the SENT draft grammar can DERIVE its enum from this one declaration rather
 * than re-typing the member list — `anthropic-graph-schema.ts` reads `.options`
 * off it.
 *
 * ⚠ "EXACTLY ONE HOME" WAS OVERCLAIMED, CORRECTED 2026-07-25 (F8). This is one
 * home for the DRAFT LLM BOUNDARY, which validates through `shared-schemas.ts` →
 * `NodeData` → here, so the grammar and its validator do agree. The V3 WIRE
 * schema keeps its own unpinned copy (`cee-v3.ts` — a byte-identical
 * `z.enum([...])` for extractionType, and `FactorTypeV3` beside `FactorType`).
 * Those are not derived from this and will not fail loud if they drift. Do not
 * inherit the stronger claim.
 */
export const ExtractionType = z.enum(["explicit", "inferred", "range", "observed"]);

/**
 * Prior distribution family for external factors.
 *
 * ONE member, deliberately. The served prompt states the invariant itself —
 * draft_graph "distribution is always \"uniform\" in current version" — and every
 * worked example in every prompt version emits it; measured 35/35 "uniform" over
 * a 20-draft live corpus (2026-07-25). Declaring it here lets the draft grammar
 * enforce what the prompt already promises, at a cost of one enum value.
 *
 * ⚠ COUPLED TO THE PROMPT BY DESIGN. If a future prompt teaches a second family,
 * it must be added HERE in the same change — the grammar would otherwise make the
 * new value ungrammatical. That coupling is the point: today the field is free
 * text that nothing constrains, and the prompt's promise is unenforced.
 */
export const PriorDistribution = z.enum(["uniform"]);

/**
 * Is `value` a distribution family this build's grammar can express?
 *
 * ⚠ THE COUPLING ABOVE HAS NO COMPILE-TIME ALARM, AND CANNOT HAVE ONE (F4,
 * /code-review 2026-07-25). `PriorDistribution` reads like the other two hoisted
 * enums, but it is NOT the same shape:
 *
 *   * `ExtractionType` / `FactorType` are read by the downstream validator, so
 *     the grammar and the validator genuinely cannot disagree.
 *   * `prior.distribution` is validated by `cee-v3.ts` as `z.string()` — FREE
 *     TEXT. Nothing reads this enum except the grammar. It is therefore a
 *     hand-typed mirror of a PMS-SERVED PROMPT, and that prompt is re-pinnable
 *     WITHOUT A CEE DEPLOY. No test in this repo can see the served prompt.
 *
 * So the drift alarm has to be a RUNTIME one, at the boundary where a real
 * emitted value arrives. Called from the V3 transform (`transforms/schema-v3.ts`)
 * for every prior that reaches the pipeline. Deliberately a DETECTOR, not a
 * rejector: a second distribution family is a prompt decision, and silently 400ing
 * live drafts is a worse failure than loudly passing the value through.
 *
 * Derived from `PriorDistribution.options`, so adding a member here retires the
 * alarm for that member automatically — never re-type the list.
 */
export function isKnownPriorDistribution(value: unknown): boolean {
  return typeof value === "string" && (PriorDistribution.options as readonly string[]).includes(value);
}

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
  extractionType: ExtractionType.optional(),
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
}).passthrough();

/**
 * Observed state for constraint nodes.
 * Contains the threshold value and operator metadata.
 */
export const ConstraintObservedState = z.object({
  /** Threshold value in user units - PLoT normalises */
  value: z.number(),
  /** Metadata including the explicit operator */
  metadata: ConstraintMetadata,
}).passthrough();

/**
 * Observed state for FACTOR nodes (F4 — graph-readiness↔run scaffold parity).
 *
 * A factor's stored position: `value` on the model 0-1 scale, plus an optional
 * display-scale magnitude `raw_value` (raw user units). This is the exact
 * provenance the run-path scaffolder reads to compute neutral placeholder
 * interventions for unconfigured options (`buildNeutralFactorValues`, the
 * `observed_state` rung). Before this, the /assist/v1/graph-readiness `Graph`
 * input accepted ONLY the constraint-shaped observed_state (below), so a factor
 * observed_state 400'd and readiness could not see the provenance the run path
 * uses — the pre-run panel under-reported a runnable graph as "blocked".
 *
 * Additive by construction: it is a UNION MEMBER alongside ConstraintObservedState
 * (see NodeObservedState), tried SECOND, so a valid constraint observed_state is
 * validated byte-identically to before. Distinguished from the constraint shape
 * by the ABSENCE of constraint `metadata`. The `.passthrough()` preserves
 * additive factor fields (e.g. `cap`, `unit`), but the refinement REJECTS any
 * `metadata` key so a MALFORMED constraint observed_state (metadata present but
 * operator invalid/missing) still fails BOTH branches → still a 400. Constraint
 * validation is therefore not loosened: you cannot slip a broken operator
 * through by shedding the constraint shape.
 */
export const FactorObservedState = z.object({
  /** The factor's current position on the model 0-1 scale (PLoT normalises). */
  value: z.number(),
  /** Optional display-scale magnitude in raw user units (for round-trip). */
  raw_value: z.number().optional(),
}).passthrough().refine(
  (o) => !("metadata" in o),
  { message: "factor observed_state must not carry constraint metadata (operator)" },
);

/**
 * A node's observed_state is EITHER constraint-shaped (threshold `value` +
 * `metadata.operator`, for constraint nodes — PLoT Phase 1 T6) OR factor-shaped
 * (`{ value, raw_value? }`, for factor nodes — F4 readiness parity).
 *
 * Order is load-bearing: ConstraintObservedState is tried FIRST, so a valid
 * constraint observed_state parses exactly as it did before this union existed
 * (identical output bytes). A factor observed_state (no `metadata`) fails the
 * constraint branch and matches the factor branch. A malformed constraint
 * (metadata present but invalid) matches NEITHER branch and still 400s — the
 * factor branch's refinement forbids any `metadata` key. Both branches
 * `.passthrough()`, so additive fields on either shape survive.
 */
export const NodeObservedState = z.union([ConstraintObservedState, FactorObservedState]);

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
   * Observed state — kind-dependent (F4):
   * - constraint nodes: ConstraintObservedState (threshold value + explicit
   *   operator; PLoT Phase 1 T6 — PLoT requires observed_state.metadata.operator).
   * - factor nodes: FactorObservedState ({ value, raw_value? }) — the neutral-
   *   value provenance the run-path scaffolder reads.
   * The union is additive: constraint observed_state parses byte-identically to
   * before; the factor shape was previously rejected (400). See NodeObservedState.
   */
  observed_state: NodeObservedState.optional(),
  /**
   * Goal threshold fields (V14+).
   * Only applies to goal nodes. Extracted from explicit numeric targets in brief.
   * See prompt v14 lines 150-162 for extraction rules.
   */
  /** Normalised threshold in model units (0-1), computed as goal_threshold_raw / goal_threshold_cap */
  goal_threshold: z.number().nullable().optional(),
  /** Raw threshold value from brief for UI display (e.g., 800 for "target 800 customers") */
  goal_threshold_raw: z.number().nullable().optional(),
  /** Unit of measurement for display (e.g., "customers", "%", "£") */
  goal_threshold_unit: z.string().nullable().optional(),
  /** Normalisation denominator (e.g., 1000 for "800/1000 = 0.8") */
  goal_threshold_cap: z.number().nullable().optional(),
  /**
   * The FRAME `goal_threshold` is stated in (ROADMAP 2.258, schemas 0.31.0).
   * Always `'level'` from CEE — see `CEE_GOAL_THRESHOLD_FRAME`. Typed here so
   * the draft-path mint site is contextually typed rather than relying on
   * `.passthrough()` to smuggle an unknown key across.
   */
  goal_threshold_frame: GoalThresholdFrame.optional(),
  /**
   * The goal metric's CURRENT LEVEL as stated by the user (ROADMAP 2.273),
   * normalised against `goal_threshold_cap` — the SAME denominator
   * `goal_threshold` uses.
   *
   * ⚠ THE SHARED DENOMINATOR IS THE WHOLE CONTRACT. ISL computes
   * `delta_threshold = goal_threshold − baseline + intercept`. Subtracting a
   * baseline scored against a different cap than the threshold does not fail —
   * it silently returns a WRONG probability, which is the one outcome the
   * whole 2.258/2.273 train exists to prevent. Both numbers are therefore
   * divided by `goal_threshold_cap` at the same mint site, never separately.
   *
   * EXTRACTION ONLY. Present only when the user STATED a current level in the
   * same breath as the target. Never inferred, never defaulted from the
   * target, never derived. Absent means absent: ISL then refuses with
   * `missing_goal_baseline` and renders no probability, which is honest.
   */
  goal_baseline: z.number().nullable().optional(),
  /** The stated current level in RAW user units, for display and round-trip. */
  goal_baseline_raw: z.number().nullable().optional(),
}).passthrough();

// Structured provenance for production trust and traceability
// .passthrough() — preserve additive fields from LLM/enrichment provenance
export const StructuredProvenance = z.object({
  source: z.string().min(1), // File name, metric name, or "hypothesis"
  quote: z.string().max(100), // Short citation or statement
  location: z.string().optional(), // "page 3", "row 42", "line 15", etc.
}).passthrough();

/**
 * Effect direction for causal edges.
 * Indicates whether increasing the source increases or decreases the target.
 * - "positive": Increasing source increases target (e.g., Marketing → Revenue)
 * - "negative": Increasing source decreases target (e.g., Price → Demand)
 */
export const EffectDirection = z.enum(["positive", "negative"]);

/**
 * Edge type classification (Phase 3A-trust).
 * - "directed": Standard causal edge A→B (default, backward compatible)
 * - "bidirected": A↔B — indicates an unmeasured common cause (Pearl's ADMG notation).
 *   Does NOT mean A causes B and B causes A. Used for identifiability checking
 *   and trust warnings only. ISL never sees bidirected edges.
 */
export const EdgeType = z.enum(["directed", "bidirected"]);

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
  origin: EdgeOrigin.optional(),
  // Edge type: directed (default) or bidirected (unmeasured confounder). Phase 3A-trust.
  edge_type: EdgeType.optional(),
  // F5: Whether edge parameters are pipeline-defaulted (true for enrichment-created edges)
  defaulted: z.boolean().optional(),
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

// .passthrough() — internal pipeline boundary, preserves fields added by upstream stages
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
}).passthrough();

export type GraphT = z.infer<typeof Graph>;
export type EdgeT = z.infer<typeof Edge>;
export type NodeT = z.infer<typeof Node>;
export type FactorDataT = z.infer<typeof FactorData>;
export type OptionDataT = z.infer<typeof OptionData>;
export type NodeDataT = z.infer<typeof NodeData>;
export type FactorObservedStateT = z.infer<typeof FactorObservedState>;
export type NodeObservedStateT = z.infer<typeof NodeObservedState>;
export type StructuredProvenanceT = z.infer<typeof StructuredProvenance>;
export type EffectDirectionT = z.infer<typeof EffectDirection>;
export type EdgeOriginT = z.infer<typeof EdgeOrigin>;
export type FactorTypeT = z.infer<typeof FactorType>;
export type FactorCategoryT = z.infer<typeof FactorCategory>;
export type EdgeTypeT = z.infer<typeof EdgeType>;

/**
 * Check if an edge is directed (not bidirected).
 * Treats absent edge_type as 'directed' for backward compatibility.
 */
export function isDirectedEdge(edge: EdgeT): boolean {
  return edge.edge_type !== "bidirected";
}

/**
 * Filter a graph's edges to only directed edges.
 * Returns a new array; does not mutate the input.
 */
export function filterDirectedEdges(edges: EdgeT[]): EdgeT[] {
  return edges.filter(isDirectedEdge);
}

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
