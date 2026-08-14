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
import type { ValidationMetadata } from "../cee/validation-pipeline/types.js";
import { GoalConstraintSchema } from "./assist.js";
import { CausalClaimsArraySchema } from "./causal-claims.js";
import { ValidationWarningSchema as SharedValidationWarningSchema, CIL_WARNING_CODES, GoalThresholdFrame, OBSERVED_STATE_SOURCE_LITERALS } from "@talchain/schemas";
import { CAUSAL_CLAIMS_WARNING_CODES } from "./causal-claims.js";
import { CANONICAL_ID_REGEX } from "../cee/utils/id-normalizer.js";

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
  /** How the value was determined.
   *
   *  PRODUCER members: `brief_extraction` / `cee_inference` (CEE's own
   *  extraction/inference writers).
   *
   *  USER-OWNED members (2.396(b), P4 transport 2026-08-05): the literals the
   *  estate's user-edit writers actually stamp — CEE's own chat-edit seams
   *  write `user_override` (stampUserEditProvenance / set_factor_value), and
   *  the UI's edit surfaces write `user_override` / `user_confirmed` /
   *  `user` (+ `user_assumption` / `user_edited` recognised forward-compat by
   *  its REVIEWED_SOURCES predicate, DecisionGuideAI isReviewedByUser.ts —
   *  the acknowledged cross-repo source of this list). Before this widening
   *  the enum was structurally incapable of carrying ANY user stamp, so every
   *  chat-set value rendered as "Olumi estimate", and a UI-stamped stored
   *  graph FAILED this parse at every edit seam.
   *
   *  The pill-earning wire literal is `user_override` (witnessed runE2,
   *  journey-witness-final-2026-08-04). The shared contract types this field
   *  as a free string (`ObservedStateSchema.source: z.string()`), and ISL as
   *  `Optional[str]` — this enum is the narrowest validator in the chain, so
   *  it is the one that must name every legitimate writer.
   *
   *  ⭐ 0.40.0 — THIS LIST IS NO LONGER HAND-MAINTAINED. It is DERIVED from the
   *  shared contract's `OBSERVED_STATE_SOURCE_LITERALS`, which 0.40.0 minted as
   *  the single owner of this vocabulary precisely so the two mirrors it names
   *  (this enum, and the UI's `SOURCE_CLASSES`) stop drifting. The contract's
   *  own instruction: "consumers should DERIVE their classifier/validator
   *  membership from this list at their >=0.40.0 re-vendor". CLAUDE.md trap 12
   *  — a list a human must remember to sync WILL drift, and the drift reads
   *  green. `observed-state-source-derivation.test.ts` asserts SET EQUALITY
   *  with the canonical list, so this fails loud in BOTH directions.
   *
   *  ⚠ MEASURED CONSEQUENCE, disclosed rather than glossed. The derivation
   *  WIDENS this validator from 7 literals to 12. The five newly-accepted are
   *  `explicit`, `inferred`, `cee_repair`, `user_calibration`, `panel_elicited`.
   *  Four of those five were ALREADY writable somewhere in the estate — they
   *  are members of the UI's 11-literal `SOURCE_CLASSES`, which the paragraph
   *  above names as "the acknowledged cross-repo source of this list" — and so
   *  were already capable of failing this parse. The widening closes latent
   *  refusals; it does not open a new hole. Nothing in CEE BRANCHES on any
   *  `source` value other than `brief_extraction` (complete non-test sweep at
   *  this tip: `cee/decision-review/graph-normalizer.ts:122` and
   *  `cee/provenance/money-invariant.ts`, both testing only for
   *  `brief_extraction`, whose behaviour is byte-unchanged), so a wider accept
   *  set cannot redirect an existing decision.
   *
   *  `panel_elicited` is the one genuinely NEW member, and CEE is its ONLY
   *  stamper — `set_factor_value`, and only after `verifyAppliedFrom` has
   *  checked the client's claim against CEE's own collab store. Without it
   *  here CEE REJECTS ITS OWN STAMP: the post-mutation `GraphV3.safeParse` in
   *  `system-events/factor-value-edit.ts` fails and the user is told "I
   *  couldn't save that change." Derived BY EXECUTION at this tip, with a
   *  `user_override` positive control, before this line was written. */
  source: z.enum(OBSERVED_STATE_SOURCE_LITERALS).optional(),
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
  /** Node ID - canonical pattern: lowercase alphanumeric, underscores, colons, hyphens */
  id: z.string().regex(CANONICAL_ID_REGEX, "Node ID must contain only lowercase alphanumeric, underscores, colons, or hyphens"),
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
  /**
   * The FRAME `goal_threshold` is stated in (ROADMAP 2.258, schemas 0.31.0).
   * Always `'level'` from CEE — see `CEE_GOAL_THRESHOLD_FRAME`.
   *
   * ⚠ THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION. `NodeV3` is a plain
   * `z.object` — "declared fields only — unknown fields stripped" (see the
   * closing comment on this object). An undeclared `goal_threshold_frame`
   * would be SILENTLY DELETED by `GraphV3.safeParse` on the run path
   * (build-turn-context.ts), so the stamp would reach nothing and the goal
   * probability would stay absent with no error anywhere. Derived from the
   * contract's own enum rather than restated as a local literal union.
   */
  goal_threshold_frame: GoalThresholdFrame.optional(),
  /** Encoding map for categorical factor labels (v191+). Maps encoded integer keys to display strings.
   * e.g. { "0": "Developers", "1": "Tech Lead" } for "Team Structure (0=Developers, 1=Tech Lead)".
   * Node-level field (not in observed_state) — describes label encoding, not observed state. */
  encoding_map: z.record(z.string(), z.string()).optional(),
  /** Prior distribution data for external factors (set by LLM or synthesised by unreachable-factors repair).
   *  ISL needs prior ranges to run Monte Carlo sampling on external factors. */
  prior: z.object({ distribution: z.string(), range_min: z.number(), range_max: z.number() }).passthrough().optional(),
  /** Factor type classification (e.g. "continuous", "categorical") — promoted to node level by repair stages */
  factor_type: z.string().optional(),
  /** Extraction type: "extracted" or "inferred" — promoted to node level by repair stages */
  extractionType: z.string().optional(),
  /** Uncertainty driver labels for controllable factors — promoted to node level by repair stages */
  uncertainty_drivers: z.array(z.string()).optional(),
  /** Prior mean / base rate for root nodes in ISL inference (v191+) */
  intercept: z.number().optional(),
  /** Human-readable value string for UI rendering (e.g. "£40,000", "18 months") */
  display_value: z.string().optional(),
  /** Intervention bundle copied from options[] for canvas display (option-kind nodes only).
   *  options[] remains the canonical source for analysis; graph nodes carry this for ConnRow rendering.
   *  Typed as z.any() per-value to avoid forward reference to InterventionV3; canonical shape lives on OptionV3. */
  interventions: z.record(z.string(), z.any()).optional(),
  /** Marks the status-quo / baseline option node (option-kind nodes only, v191+). */
  is_baseline: z.boolean().optional(),
  /** UI display vocabulary for the node's origin. Set by the V3 transform from
   *  `extractionType`: `explicit`/`observed` → `from_brief`,
   *  `inferred`/`range` → `ai_inferred`, absent/unknown → `ai_inferred`.
   *  RESPONSE-ONLY: recomputed deterministically by `transformResponseToV3`
   *  on every response. Not read by analysis, repair, or PLoT pipelines.
   *  Safe to ignore on round-tripped graphs — value is regenerated. */
  provenance: z.enum(["from_brief", "ai_inferred", "user_set"]).optional(),
}); // CIL Phase 1: declared fields only — unknown fields stripped with warning
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
  /** UI display vocabulary for the edge's origin. Set by the V3 transform
   *  from `provenance.source`: `brief_extraction` → `from_brief`,
   *  `user_specified` → `user_set`, otherwise `ai_inferred`. Sibling of the
   *  structured `provenance` enum so existing consumers of `provenance.source`
   *  are unaffected. RESPONSE-ONLY: recomputed deterministically by
   *  `transformResponseToV3` on every response. Not read by analysis, repair,
   *  or PLoT pipelines. Safe to ignore on round-tripped edges. */
  provenance_display: z.enum(["from_brief", "ai_inferred", "user_set"]).optional(),
  /** Edge creation source: ai, user, repair, enrichment, default */
  origin: z.string().optional(),
  /** Edge type: directed (default) or bidirected (unmeasured confounder). Phase 3A-trust. */
  edge_type: z.enum(["directed", "bidirected"]).optional(),
  /** Per-edge validation metadata from the two-pass parameter review pipeline.
   *  Absent when the pipeline is disabled, skipped, or failed gracefully.
   *  Full type definition: ValidationMetadata (src/cee/validation-pipeline/types.ts). */
  validation: z.any().optional(),
  /** CIL flag: true when default strength was applied (no LLM differentiation) */
  defaulted: z.boolean().optional(),
}); // CIL Phase 1: declared fields only — unknown fields stripped with warning
/** EdgeV3 with full ValidationMetadata typing (superset of Zod schema). */
export type EdgeV3T = z.infer<typeof EdgeV3> & {
  /** Per-edge validation metadata from the two-pass parameter review pipeline.
   *  Absent when the pipeline is disabled, skipped, or failed gracefully. */
  validation?: ValidationMetadata;
};

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
  /**
   * Presentation-only human-readable string for the intervention value.
   * Populated either by the LLM/draft prompt or deterministically by the
   * analysis-ready transformer via synthesiseDisplayValue(). Must NEVER
   * be read by inference, readiness, or flattening logic — those paths
   * read `value` (and optionally `raw_value`) only.
   */
  display_value: z.string().optional(),
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
  /** Option ID - canonical pattern: lowercase alphanumeric, underscores, colons, hyphens */
  id: z.string().regex(CANONICAL_ID_REGEX, "Option ID must contain only lowercase alphanumeric, underscores, colons, or hyphens"),
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
  /** Marks the status-quo / baseline option (v191+). Exactly one option should be true.
   * Set by the LLM; preserved through extraction and assembly. PLoT handles deduplication. */
  is_baseline: z.boolean().optional(),
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
  // An AI-drafted option was absorbed into the user-authored option it restates.
  // Registered here for consistency with the other transform-stage codes
  // (`ValidationWarningV3.code` is the shared `z.string()`, so an unregistered
  // code was never at risk of being stripped — this is legibility, not a fix).
  "OPTION_REPHRASE_ABSORBED",
  // CIL warning codes from @talchain/schemas
  CIL_WARNING_CODES.STRENGTH_DEFAULT_APPLIED,
  CIL_WARNING_CODES.STRENGTH_MEAN_DEFAULT_DOMINANT,
  CIL_WARNING_CODES.EDGE_STRENGTH_LOW,
  CIL_WARNING_CODES.EDGE_STRENGTH_NEGLIGIBLE,
  // STRP constraint direction heuristic (Rule 3b)
  "CONSTRAINT_DIRECTION_HEURISTIC",
  // WS-A item 1(b) — the commit-time money invariant. A factor the extractor
  // stamped `brief_extraction`, denominated in a currency the brief uses,
  // whose encoding (`level × cap`) reproduces NO magnitude the brief states.
  // Disclosure only: the graph commits unchanged and no magnitude is ever
  // rewritten (see cee/provenance/money-invariant.ts for why that direction is
  // a ruling and not a preference). Additive at every hop — the shared
  // contract types `code` as `z.string()` with `.passthrough()`.
  "STATED_MAGNITUDE_UNRECONCILED",
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
  /**
   * Goal constraints attached to the scenario. Optional top-level array
   * mirroring CEEGraphResponseV3.goal_constraints — keeps the in-memory
   * GraphV3T as the single canonical persistence surface for V5 D1
   * `add_constraint` mutations. PLoT already merges this field with
   * compiled constraint nodes when present.
   */
  goal_constraints: z.array(GoalConstraintSchema).optional(),
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
  /** LLM coaching output. v0.11.0 schema amendment: Stage 6 V3 transform
   *  ALWAYS emits a coaching block (canonical-empty when V1 omits it),
   *  so production responses always carry the field. The Zod schema
   *  keeps `.optional()` so existing consumer tests that construct V3
   *  payloads without coaching still parse — the runtime contract
   *  ("V3 output carries coaching") is enforced by the transform, not
   *  by Zod rejection. The wire-facing `coaching` field on
   *  /assist/v1/draft-graph is narrowed to typed display shapes at the
   *  Stage 5 boundary by `narrowCoachingForResponse` in
   *  src/orchestrator/draft-coaching.ts. The wrapper is `.passthrough()`
   *  so additive future coaching fields reach downstream consumers. */
  coaching: z.object({
    // Nullable so that a coaching block with widening_log / bias_signals but
    // no LLM-produced summary still reaches the UI. The UI renders null as
    // "no summary" rather than dropping the entire panel.
    summary: z.string().nullable(),
    strengthen_items: z.array(z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      action_type: z.string(),
      bias_category: z.string().optional(),
    })), // strict — matches DraftGraphResult.strengthenItems contract
    // v0.11.0 schema amendment: widening_log is the canonical OBJECT
    // shape. Inner sub-fields use permissive types here so V3 validation
    // accepts what narrowCoachingForResponse produces; the canonical
    // shape is enforced at @talchain/schemas/CoachingSchema for cross-
    // service consumers.
    widening_log: z.object({
      elements_added: z.array(z.string()),
      elements_considered_but_excluded: z.array(z.string()),
      brief_completeness: z.enum(["complete", "partial", "thin"]),
    }).passthrough().optional(),
    bias_signals: z.array(z.unknown()).optional(),
  }).passthrough().optional(),
  /** LLM causal claims — stated reasoning about direct effects, mediations, confounders.
   *  v0.11.0 schema amendment: Stage 6 V3 transform ALWAYS emits this
   *  field (defaulting absent V1 input to []), so production responses
   *  always carry it. Zod schema keeps `.optional()` so consumer tests
   *  constructing V3 payloads without it still parse — the runtime
   *  contract is enforced by the transform, not by Zod rejection. The
   *  Phase 2B provenance distinction (undefined vs [] meaning "LLM
   *  didn't emit" vs "emitted but dropped") is preserved internally on
   *  ctx.causalClaims for analytics. */
  causal_claims: CausalClaimsArraySchema.optional(),
  /** v0.11.0 schema amendment: topology_plan — string array describing
   *  graph layout. Required at the canonical contract; preserved
   *  V1 → V3 with deep-equality (length + order + string contents). */
  topology_plan: z.array(z.string()).optional(),
  /**
   * ⭐⭐ WHAT THE PROJECTOR REFUSED TO ASSERT, AND WHY — the R1 disclosure channel.
   *
   * The record projector deliberately declines to invent: it will not guess a
   * constraint's direction, it will not silently pick between two contradictory
   * intervention levels, and it will not pretend a stated target became a goal
   * threshold. Every one of those refusals was already recorded internally in
   * `projection.dropped[]` — and **`projection.dropped[]` had no reader anywhere
   * downstream**, so a user saw a graph quietly weaker than their brief with no
   * indication why. The projector's honesty had improved; the product's had not
   * moved at all. This field is the carrier that closes that.
   *
   * ⚠⚠ `node_id` IS OPTIONAL, AND THE FIRST CUT OF THIS FIELD GOT THAT WRONG IN
   * THE MOST EXPENSIVE WAY AVAILABLE. It required an anchor in `nodes[]` and
   * dropped anything it could not anchor. Measured on both real banked B3
   * captures: **the projector produced 56 disclosures, 1 reached the wire, and 55
   * were discarded with no log, no counter and no field.**
   *
   * The reason is structural, not a bug in the matching. The dominant class —
   * `unconnected_to_goal`, 51 of the 56 — describes a record that was
   * **WITHDRAWN FROM THE GRAPH**. Its label can never appear in `nodes[]`,
   * because not appearing in `nodes[]` is precisely what it is disclosing. So the
   * anchoring rule silently deleted the disclosures a user most needs — *"you
   * told me this and it is not in the model"* — and kept only the ones about
   * things they could already see. A channel delivering 2% of its own volume,
   * silently, is the guarantee-theatre class this estate exists to kill.
   *
   * ⭐ SO: `withdrawn` carries the fact the anchor cannot. `node_id` is the
   * projector's OWN minted id, present whenever it knew one — it is an identity,
   * not a promise that the node survived, and a consumer must check `withdrawn`
   * before looking it up in `nodes[]`. NOTHING IS DROPPED: see
   * `record_disclosures_omitted`.
   *
   * ⚠ THE TOP LEVEL OF THIS SCHEMA IS PLAIN `z.object` — undeclared fields are
   * STRIPPED, silently, with only a warn log. That is precisely why this must be
   * declared here and not left to ride a passthrough.
   */
  record_disclosures: z
    .array(
      z.object({
        /** The projector's own reason vocabulary — one string, not a sentence. */
        reason: z.string(),
        /** The user-facing label, which is the user's own words for stated items. */
        label: z.string(),
        /**
         * TRUE when the subject is NOT on the final graph — the "you gave me this
         * and it is not in the model" case. Read this BEFORE resolving `node_id`.
         */
        withdrawn: z.boolean(),
        /** The projector's minted id. Resolvable in `nodes[]` only when `withdrawn` is false. */
        node_id: z.string().optional(),
        /**
         * ⭐ THE MAGNITUDE THE USER STATED, when the withdrawn record carried one.
         *
         * Present on `unconnected_to_goal` disclosures about STATED records — the
         * class this channel exists for. Measured on the banked live emission: 12
         * of 12 stated magnitudes were destroyed by the withdrawal that produced
         * these very disclosures, so the notice reached the wire with the user's
         * words and without their number.
         *
         * ⚠ IT IS THE STATED MAGNITUDE, NEVER A NORMALISED LEVEL. £7.2m is
         * disclosed as `7200000`, not as the `0.72` the graph computes on. A
         * consumer may render it verbatim beside `label` (which is the user's own
         * quote) without rescaling anything.
         */
        value: z.number().optional(),
        /** The unit the user stated, alongside `value` (e.g. `"£"`, `"%"`). */
        unit: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * ⭐ HOW MANY DISCLOSURES COULD NOT BE REPRESENTED AT ALL — normally absent.
   *
   * The rule this field enforces is "no silent drops, ever". If the transform
   * ever meets an entry it cannot express (a non-object, or a record with no
   * reason or no label), the count surfaces here rather than the entry
   * evaporating. A channel that quietly loses part of its payload is
   * indistinguishable from one that had nothing to say, and that is exactly how
   * 55 of 56 went missing.
   *
   * ⚠⚠ SCOPED TO ONE FUNCTION, AND THE DISTINCTION IS LOAD-BEARING.
   * `omitted: 0` means **"the transform expressed everything it was handed"**. It
   * does NOT mean "the user received everything", and it cannot: this counter is
   * blind to every hop downstream of `transformResponseToV3`. A measured example
   * is live today — the v5 turn payload rebuilds its graph block FIELD BY FIELD
   * (`orchestrator/tools/draft-graph.ts`, a closed `GraphPatchBlockData`
   * interface, no spread), so `record_disclosures` reaches the CEE V3 wire and
   * then **56 → 0** on that path, while this counter still reads zero and the
   * `emitted === produced` invariant upstream still passes.
   * ROADMAP 2.1094. Say "reaches the CEE V3 wire", never "reaches the user".
   */
  record_disclosures_omitted: z.number().optional(),
  /** Draft warnings from the pipeline — CEEStructuralWarningV1 shape from structure detection.
   *  Fields: id (warning type), severity, affected_node_ids, affected_edge_ids, explanation, fix_hint. */
  draft_warnings: z.array(z.object({
    id: z.string(),
    severity: z.string(),
    node_ids: z.array(z.string()).optional(),
    edge_ids: z.array(z.string()).optional(),
    affected_node_ids: z.array(z.string()).default([]),
    affected_edge_ids: z.array(z.string()).default([]),
    explanation: z.string().optional(),
    fix_hint: z.string().optional(),
  })).optional(),
  /** Pre-computed analysis-ready payload for PLoT (complex nested structure) */
  analysis_ready: z.any().optional(),
  /** Per-node LLM reasoning from Stage 1 (parse). Carried through V1→V3 boundary. */
  rationales: z.array(z.object({
    target: z.string(),
    why: z.string(),
    provenance_source: z.string().optional(),
  })).optional(),
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
  }).passthrough().optional(), // Keep passthrough: trace is internal/extensible
}); // CIL Phase 1: declared fields only — unknown fields stripped with warning
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

// ============================================================================
// CIL Phase 1: Unknown field detection for strip-mode schemas
// ============================================================================

/** Known keys for each egress schema (used by warnOnUnknownV3Fields). */
const NODE_V3_KEYS = new Set(Object.keys(NodeV3.shape));
const EDGE_V3_KEYS = new Set(Object.keys(EdgeV3.shape));
const RESPONSE_V3_KEYS = new Set(Object.keys(CEEGraphResponseV3.shape));

/**
 * Log a warning when an egress-facing V3 object contains fields that will be
 * silently stripped by Zod's default strip behaviour.  Call this BEFORE parse
 * so the caller can observe drift without production failures.
 *
 * @param input - Raw object before Zod parse
 * @param schemaName - Human-readable label for log context ("NodeV3" | "EdgeV3" | "CEEGraphResponseV3")
 * @param logFn - Logger callback (receives structured payload)
 */
export function warnOnUnknownV3Fields(
  input: Record<string, unknown>,
  schemaName: "NodeV3" | "EdgeV3" | "CEEGraphResponseV3",
  logFn: (payload: { event: string; schema: string; unknownKeys: string[]; nodeId?: string }) => void,
): void {
  const knownKeys = schemaName === "NodeV3" ? NODE_V3_KEYS
    : schemaName === "EdgeV3" ? EDGE_V3_KEYS
    : RESPONSE_V3_KEYS;

  const unknownKeys = Object.keys(input).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    logFn({
      event: "cee.v3_schema.unknown_fields_stripped",
      schema: schemaName,
      unknownKeys,
      ...(typeof input.id === "string" ? { nodeId: input.id } : {}),
    });
  }
}
