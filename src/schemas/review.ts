/**
 * Review endpoint schemas for /assist/v1/review
 *
 * M1 CEE Orchestrator - Shape-complete response with blocks and readiness assessment
 */

import { z } from "zod";
import { Graph } from "./graph.js";
import { SAFE_REQUEST_ID_PATTERN, isValidRequestId } from "../utils/request-id.js";

// Re-export for consumers that import from this module
export { SAFE_REQUEST_ID_PATTERN, isValidRequestId };

// =============================================================================
// Request Schemas
// =============================================================================

export const SafeRequestId = z.string().min(1).max(64).regex(SAFE_REQUEST_ID_PATTERN, {
  message: "Request ID must be 1-64 chars, alphanumeric with ._-",
});

/**
 * ISL Robustness payload - optional sensitivity/uncertainty analysis from ISL
 */
export const ISLRobustnessPayload = z.object({
  /** Status of the robustness analysis */
  status: z.enum(["computed", "degraded", "not_run", "failed"]),

  /** Reason for status (especially if not 'computed') */
  status_reason: z.string().optional(),

  /** Overall robustness score (0-1, higher = more robust) */
  overall_score: z.number().min(0).max(1).optional(),

  /** Confidence in the robustness assessment */
  confidence: z.number().min(0).max(1).optional(),

  /** Key sensitivity findings */
  sensitivities: z.array(z.object({
    node_id: z.string(),
    label: z.string(),
    sensitivity_score: z.number().min(0).max(1),
    classification: z.enum(["low", "medium", "high"]),
    description: z.string().optional(),
  })).optional(),

  /** Prediction intervals from conformal analysis */
  prediction_intervals: z.array(z.object({
    node_id: z.string(),
    lower_bound: z.number(),
    upper_bound: z.number(),
    confidence_level: z.number().min(0).max(1),
    well_calibrated: z.boolean(),
  })).optional(),

  /** Critical assumptions that most affect the decision */
  critical_assumptions: z.array(z.object({
    node_id: z.string(),
    label: z.string(),
    impact: z.number().min(0).max(1),
    recommendation: z.string().optional(),
  })).optional(),

  /** ISL request metadata */
  isl_request_id: z.string().optional(),
  isl_latency_ms: z.number().optional(),
});

export type ISLRobustnessPayloadT = z.infer<typeof ISLRobustnessPayload>;

// =============================================================================
// PLoT Robustness Data (for synthesis generation)
// =============================================================================

/**
 * Fragile edge - an edge where alternative winner could emerge
 */
export const FragileEdge = z.object({
  edge_id: z.string(),
  from_label: z.string(),
  to_label: z.string(),
  alternative_winner_id: z.string().optional(),
  alternative_winner_label: z.string().optional(),
  switch_probability: z.number().min(0).max(1).optional(),
});

/**
 * Robust edge - an edge that is stable across scenarios
 */
export const RobustEdge = z.object({
  edge_id: z.string(),
  from_label: z.string(),
  to_label: z.string(),
});

/**
 * Factor sensitivity data
 */
export const FactorSensitivity = z.object({
  factor_id: z.string(),
  factor_label: z.string(),
  elasticity: z.number(),
  importance_rank: z.number().int().min(1).optional(),
  interpretation: z.string().optional(),
});

/**
 * PLoT Robustness data - enriched sensitivity analysis from PLoT
 */
export const PLoTRobustnessData = z.object({
  /** Overall recommendation stability (0-1, higher = more stable) */
  recommendation_stability: z.number().min(0).max(1).optional(),

  /** The currently recommended option */
  recommended_option: z.object({
    id: z.string(),
    label: z.string(),
  }).optional(),

  /** Edges where the recommendation could change */
  fragile_edges: z.array(FragileEdge).optional(),

  /** Edges that are stable across scenarios */
  robust_edges: z.array(RobustEdge).optional(),

  /** Factor sensitivity rankings */
  factor_sensitivity: z.array(FactorSensitivity).optional(),
});

export type PLoTRobustnessDataT = z.infer<typeof PLoTRobustnessData>;

/**
 * Inference result from PLoT - ranked actions and drivers
 */
export const InferenceResult = z.object({
  /** Ranked actions from PLoT inference */
  ranked_actions: z.array(z.object({
    node_id: z.string().min(1),
    label: z.string().min(1),
    expected_utility: z.number(),
    rank: z.number().int().min(1),
    dominant: z.boolean().optional(),
  })).optional(),

  /** Top drivers from PLoT inference */
  top_drivers: z.array(z.object({
    node_id: z.string().min(1),
    label: z.string().min(1),
    impact_pct: z.number().min(0).max(100).optional(),
    direction: z.enum(["positive", "negative", "neutral"]).optional(),
  })).optional(),

  /** Inference summary from PLoT */
  summary: z.string().optional(),

  /** Model card metadata */
  model_card: z.record(z.unknown()).optional(),

  /** Seed used for inference */
  seed: z.string().optional(),

  /** Response hash for reproducibility */
  response_hash: z.string().optional(),
});

/**
 * Review request input schema
 */
export const ReviewRequest = z.object({
  /** Request ID - optional in body, can come from X-Request-Id header */
  request_id: SafeRequestId.optional(),

  /** Graph snapshot to review */
  graph: Graph,

  /** Original decision brief */
  brief: z.string().min(10).max(10000),

  /** Inference result from PLoT (optional for pre-inference reviews) */
  inference: InferenceResult.optional(),

  /** ISL robustness analysis (optional - enriches review with sensitivity/uncertainty) */
  robustness: ISLRobustnessPayload.optional(),

  /** PLoT robustness data (optional - for generating natural language synthesis) */
  robustness_data: PLoTRobustnessData.optional(),

  /** Context ID for session continuity */
  context_id: z.string().optional(),

  /** Archetype hint for specialized reviews */
  archetype_hint: z.string().optional(),

  /** Seed for deterministic output */
  seed: z.string().optional(),

  /** Feature flags for per-request overrides */
  flags: z.record(z.boolean()).optional(),
}).strict();

export type ReviewRequestT = z.infer<typeof ReviewRequest>;

// =============================================================================
// Response Schemas
// =============================================================================

/**
 * Block ID type - unique identifier for review blocks
 */
export const BlockId = z.string().uuid();

/**
 * Review block types - aligned with UI expectations
 */
export const ReviewBlockType = z.enum([
  "biases",
  "recommendation",
  "drivers",
  "gaps",
  "prediction",
  "risks",
  "next_steps",
  "robustness",
]);

export type ReviewBlockTypeT = z.infer<typeof ReviewBlockType>;

/**
 * Base block structure
 */
export const BaseBlock = z.object({
  id: BlockId,
  type: ReviewBlockType,
  /** Block generation timestamp */
  generated_at: z.string(),
  /** Whether this block contains placeholder content (M1) */
  placeholder: z.boolean().default(true),
});

/**
 * Bias finding structure
 */
export const BiasFinding = z.object({
  id: z.string().min(1),
  bias_type: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string().min(1),
  affected_nodes: z.array(z.string()).optional(),
  mitigation_hint: z.string().optional(),
});

/**
 * Biases block (formerly bias_check)
 */
export const BiasesBlock = BaseBlock.extend({
  type: z.literal("biases"),
  findings: z.array(BiasFinding),
  confidence: z.number().min(0).max(1),
});

/**
 * Option suggestion structure
 */
export const OptionSuggestion = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  pros: z.array(z.string()).optional(),
  cons: z.array(z.string()).optional(),
});

/**
 * Recommendation block (formerly options)
 */
export const RecommendationBlock = BaseBlock.extend({
  type: z.literal("recommendation"),
  suggestions: z.array(OptionSuggestion),
  confidence: z.number().min(0).max(1),
});

/**
 * Sensitivity suggestion structure
 */
export const SensitivitySuggestion = z.object({
  node_id: z.string().min(1),
  label: z.string().min(1),
  sensitivity: z.number(),
  direction: z.enum(["positive", "negative"]).optional(),
  impact_description: z.string().optional(),
});

/**
 * Drivers block (formerly sensitivity_coach)
 */
export const DriversBlock = BaseBlock.extend({
  type: z.literal("drivers"),
  suggestions: z.array(SensitivitySuggestion),
  confidence: z.number().min(0).max(1),
});

/**
 * Evidence suggestion structure
 */
export const EvidenceSuggestion = z.object({
  id: z.string().min(1),
  type: z.enum(["experiment", "user_research", "market_data", "expert_opinion", "other"]),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]).optional(),
  target_nodes: z.array(z.string()).optional(),
});

/**
 * Gaps block (formerly evidence_helper)
 */
export const GapsBlock = BaseBlock.extend({
  type: z.literal("gaps"),
  suggestions: z.array(EvidenceSuggestion),
  confidence: z.number().min(0).max(1),
});

/**
 * Prediction block (formerly key_insight)
 */
export const PredictionBlock = BaseBlock.extend({
  type: z.literal("prediction"),
  headline: z.string().min(1),
  explanation: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

/**
 * Structural warning structure
 */
export const StructuralWarning = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  affected_nodes: z.array(z.string()).optional(),
  affected_edges: z.array(z.string()).optional(),
});

/**
 * Risks block (formerly structural_warnings)
 */
export const RisksBlock = BaseBlock.extend({
  type: z.literal("risks"),
  warnings: z.array(StructuralWarning),
});

/**
 * Readiness level
 */
export const ReadinessLevel = z.enum(["ready", "caution", "not_ready"]);

/**
 * Readiness factors breakdown
 */
export const ReadinessFactors = z.object({
  completeness: z.number().min(0).max(1),
  structure: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
  bias_risk: z.number().min(0).max(1),
});

/**
 * Next steps block (formerly readiness)
 */
export const NextStepsBlock = BaseBlock.extend({
  type: z.literal("next_steps"),
  level: ReadinessLevel,
  score: z.number().min(0).max(1),
  factors: ReadinessFactors,
  summary: z.string().min(1),
  recommendations: z.array(z.string()).optional(),
});

/**
 * Robustness block status - indicates data availability
 */
export const RobustnessStatus = z.enum([
  "computed",       // Full robustness analysis available
  "cannot_compute", // ISL data missing or unavailable
  "requires_run",   // ISL analysis needs to be triggered
  "degraded",       // Partial data available
]);

/**
 * Robustness finding - sensitivity or uncertainty insight
 */
export const RobustnessFinding = z.object({
  id: z.string().min(1),
  finding_type: z.enum(["sensitivity", "uncertainty", "assumption", "calibration"]),
  severity: z.enum(["low", "medium", "high"]),
  node_id: z.string().optional(),
  label: z.string().min(1),
  description: z.string().min(1),
  recommendation: z.string().optional(),
  impact_score: z.number().min(0).max(1).optional(),
});

/**
 * Robustness block - ISL sensitivity/uncertainty synthesis
 */
export const RobustnessBlock = BaseBlock.extend({
  type: z.literal("robustness"),
  /** Block computation status */
  status: RobustnessStatus,
  /** Reason for non-computed status */
  status_reason: z.string().optional(),
  /** Overall robustness score (0-1, higher = more robust) */
  overall_score: z.number().min(0).max(1).optional(),
  /** Key findings from robustness analysis */
  findings: z.array(RobustnessFinding).optional(),
  /** Summary headline */
  summary: z.string().optional(),
  /** Confidence in the assessment */
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * Union of all block types
 */
export const ReviewBlock = z.discriminatedUnion("type", [
  BiasesBlock,
  RecommendationBlock,
  DriversBlock,
  GapsBlock,
  PredictionBlock,
  RisksBlock,
  NextStepsBlock,
  RobustnessBlock,
]);

export type ReviewBlockT = z.infer<typeof ReviewBlock>;

/**
 * Trace metadata for request tracking
 */
export const TraceMeta = z.object({
  /** Authoritative request ID */
  request_id: z.string(),
  /** Processing latency in ms */
  latency_ms: z.number(),
  /** Model identifier */
  model: z.string(),
  /** Correlation ID for distributed tracing (optional, backwards compat) */
  correlation_id: z.string().optional(),
  /** Engine metadata (optional, backwards compat) */
  engine: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
    degraded: z.boolean().optional(),
  }).optional(),
  /** Processing timestamp (optional, backwards compat) */
  timestamp: z.string().optional(),
});

/**
 * Quality metadata
 */
export const QualityMeta = z.object({
  overall: z.number().min(0).max(10),
  completeness: z.number().min(0).max(10).optional(),
  structure: z.number().min(0).max(10).optional(),
  evidence: z.number().min(0).max(10).optional(),
});

/**
 * Intent classification for review
 */
export const ReviewIntent = z.enum(["selection", "prediction", "validation"]);

/**
 * Analysis state for review
 */
export const AnalysisState = z.enum(["not_run", "ran", "partial", "stale"]);

/**
 * Readiness factor with label and status
 */
export const ReadinessFactor = z.object({
  label: z.string(),
  status: z.enum(["ok", "warning", "blocking"]),
});

// =============================================================================
// Robustness Synthesis (generated from PLoT robustness_data)
// =============================================================================

/**
 * Assumption explanation - generated from fragile edges
 */
export const AssumptionExplanation = z.object({
  edge_id: z.string(),
  explanation: z.string(),
  severity: z.enum(["fragile", "moderate", "robust"]),
});

/**
 * Investigation suggestion - generated from factor sensitivity
 */
export const InvestigationSuggestion = z.object({
  factor_id: z.string(),
  suggestion: z.string(),
  elasticity: z.number(),
});

/**
 * Robustness synthesis - natural language explanations from PLoT data
 */
export const RobustnessSynthesis = z.object({
  /** Main headline summarizing confidence level */
  headline: z.string().optional(),

  /** Explanations of fragile assumptions */
  assumption_explanations: z.array(AssumptionExplanation).optional(),

  /** Suggestions for factors to investigate */
  investigation_suggestions: z.array(InvestigationSuggestion).optional(),
});

export type RobustnessSynthesisT = z.infer<typeof RobustnessSynthesis>;

// =============================================================================
// Decision Quality (simplified quality level for Results Panel)
// =============================================================================

/**
 * Decision quality level - simplified assessment for UI
 */
export const DecisionQualityLevel = z.enum([
  "incomplete",
  "needs_strengthening",
  "good",
  "solid",
]);

/**
 * Decision quality assessment for Results Panel
 */
export const DecisionQuality = z.object({
  /** Simplified quality level */
  level: DecisionQualityLevel,
  /** Human-readable summary (1-2 sentences) */
  summary: z.string(),
});

export type DecisionQualityT = z.infer<typeof DecisionQuality>;

// =============================================================================
// Insights (aggregated observations for Results Panel)
// =============================================================================

/**
 * Insight type classification
 */
export const InsightType = z.enum([
  "fragile_assumption",
  "potential_bias",
  "information_gap",
]);

/**
 * Insight severity level
 */
export const InsightSeverity = z.enum(["low", "medium", "high"]);

/**
 * Single insight for Results Panel
 */
export const Insight = z.object({
  /** Type of insight */
  type: InsightType,
  /** Human-readable content */
  content: z.string(),
  /** Severity level */
  severity: InsightSeverity.optional(),
});

export type InsightT = z.infer<typeof Insight>;

// =============================================================================
// Improvement Guidance Schema
// =============================================================================

/**
 * Source of improvement recommendation
 */
export const ImprovementSource = z.enum([
  "missing_baseline",
  "fragile_edge",
  "bias",
  "structure",
]);

export type ImprovementSourceT = z.infer<typeof ImprovementSource>;

/**
 * Single improvement guidance item for Results Panel
 */
export const ImprovementGuidanceItem = z.object({
  /** Priority (1 = highest, 5 = lowest) */
  priority: z.number().int().min(1).max(5),
  /** Actionable recommendation */
  action: z.string(),
  /** Why this improvement matters */
  reason: z.string(),
  /** Source of this recommendation */
  source: ImprovementSource,
});

export type ImprovementGuidanceItemT = z.infer<typeof ImprovementGuidanceItem>;

// =============================================================================
// Rationale Schema
// =============================================================================

/**
 * Plain English rationale explaining the recommendation
 */
export const Rationale = z.object({
  /** 2-3 sentence summary of why this option is recommended */
  summary: z.string(),
  /** The most influential factor driving the recommendation */
  key_driver: z.string().optional(),
  /** How the recommended option aligns with the stated goal */
  goal_alignment: z.string().optional(),
});

export type RationaleT = z.infer<typeof Rationale>;

/**
 * Review response schema
 */
export const ReviewResponse = z.object({
  /** Intent classification */
  intent: ReviewIntent,

  /** Analysis state */
  analysis_state: AnalysisState,

  /** Trace metadata - request_id is authoritative */
  trace: TraceMeta,

  /** Overall readiness assessment */
  readiness: z.object({
    level: ReadinessLevel,
    headline: z.string(),
    factors: z.array(ReadinessFactor),
    score: z.number().min(0).max(1).optional(), // Optional for backwards compat
  }),

  /** Review blocks */
  blocks: z.array(ReviewBlock),

  /** Quality assessment (optional, backwards compat) */
  quality: QualityMeta.optional(),

  /** Archetype classification (if detected) */
  archetype: z.object({
    decision_type: z.string(),
    match: z.enum(["exact", "fuzzy", "generic"]),
    confidence: z.number().min(0).max(1),
  }).optional(),

  /** Response limits applied */
  response_limits: z.object({
    blocks_max: z.number(),
    blocks_truncated: z.boolean(),
  }).optional(),

  /** Guidance for next steps */
  guidance: z.object({
    headline: z.string(),
    next_steps: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  }).optional(),

  /** Robustness synthesis - natural language explanations from PLoT data */
  robustness_synthesis: RobustnessSynthesis.nullable().optional(),

  /** Decision quality assessment for Results Panel */
  decision_quality: DecisionQuality.optional(),

  /** Aggregated insights for Results Panel */
  insights: z.array(Insight).optional(),

  /** Prioritized improvement actions for Results Panel */
  improvement_guidance: z.array(ImprovementGuidanceItem).optional(),

  /** Plain English rationale for the recommendation */
  rationale: Rationale.optional(),
});

export type ReviewResponseT = z.infer<typeof ReviewResponse>;

// =============================================================================
// Error Schemas
// =============================================================================

/**
 * Review-specific error codes
 */
export const ReviewErrorCode = z.enum([
  "CEE_REVIEW_INVALID_GRAPH",
  "CEE_REVIEW_MISSING_CONTEXT",
  "CEE_REVIEW_RATE_LIMITED",
  "CEE_REVIEW_INTERNAL_ERROR",
  "CEE_REVIEW_TIMEOUT",
  "CEE_REVIEW_VALIDATION_FAILED",
]);

export type ReviewErrorCodeT = z.infer<typeof ReviewErrorCode>;

/**
 * Review error response schema
 */
export const ReviewErrorResponse = z.object({
  /** Trace with request_id */
  trace: z.object({
    request_id: z.string(),
    correlation_id: z.string().optional(),
  }),

  /** Error details */
  error: z.object({
    code: ReviewErrorCode,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ReviewErrorResponseT = z.infer<typeof ReviewErrorResponse>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate review request and return parsed result or error
 */
export function validateReviewRequest(body: unknown): {
  success: true;
  data: ReviewRequestT;
} | {
  success: false;
  error: { code: ReviewErrorCodeT; message: string; details: unknown };
} {
  const result = ReviewRequest.safeParse(body);

  if (!result.success) {
    return {
      success: false,
      error: {
        code: "CEE_REVIEW_VALIDATION_FAILED",
        message: "Invalid review request",
        details: result.error.flatten(),
      },
    };
  }

  return { success: true, data: result.data };
}
