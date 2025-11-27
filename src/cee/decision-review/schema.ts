/**
 * Enhanced Decision Review Schema
 *
 * Zod schemas for ISL-enhanced decision review critiques with
 * graceful degradation support. All ISL-enriched fields include
 * `available: boolean` to indicate whether the analysis succeeded.
 */

import { z } from 'zod';

// ============================================================================
// Node Kind (matches existing PLoT graph node kinds)
// ============================================================================

export const NodeKindSchema = z.enum([
  'decision',
  'option',
  'criterion',
  'evidence',
  'assumption',
  'constraint',
  'stakeholder',
  'risk',
  'outcome',
  'milestone',
  'unknown',
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

// ============================================================================
// ISL Sensitivity Analysis (Gracefully Degraded)
// ============================================================================

/**
 * Sensitivity analysis result from ISL
 * Available flag indicates if ISL call succeeded
 */
export const ISLSensitivityResultSchema = z.object({
  /** Whether ISL sensitivity analysis was available */
  available: z.boolean(),
  /** Sensitivity score (0-1) - only present if available */
  score: z.number().min(0).max(1).optional(),
  /** Classification based on threshold */
  classification: z.enum(['low', 'medium', 'high']).optional(),
  /** Factors contributing to sensitivity */
  factors: z.array(z.string()).optional(),
  /** Affected causal paths */
  affectedPaths: z.array(z.string()).optional(),
  /** Error message if unavailable */
  error: z.string().optional(),
});
export type ISLSensitivityResult = z.infer<typeof ISLSensitivityResultSchema>;

// ============================================================================
// ISL Contrastive Explanation (Gracefully Degraded)
// ============================================================================

/**
 * Contrastive explanation result from ISL
 */
export const ISLContrastiveResultSchema = z.object({
  /** Whether ISL contrastive analysis was available */
  available: z.boolean(),
  /** Main explanation for why this decision was made */
  explanation: z.string().optional(),
  /** Key factors that differentiate this decision */
  keyFactors: z.array(z.string()).optional(),
  /** Counterfactual scenarios */
  counterfactuals: z
    .array(
      z.object({
        change: z.string(),
        predictedImpact: z.string(),
      }),
    )
    .optional(),
  /** Error message if unavailable */
  error: z.string().optional(),
});
export type ISLContrastiveResult = z.infer<typeof ISLContrastiveResultSchema>;

// ============================================================================
// ISL Conformal Prediction (Gracefully Degraded)
// ============================================================================

/**
 * Conformal prediction interval from ISL
 */
export const ISLConformalResultSchema = z.object({
  /** Whether ISL conformal prediction was available */
  available: z.boolean(),
  /** Prediction interval bounds */
  interval: z
    .object({
      lower: z.number(),
      upper: z.number(),
    })
    .optional(),
  /** Confidence level for the interval */
  confidence: z.number().min(0).max(1).optional(),
  /** Whether the interval is well-calibrated */
  wellCalibrated: z.boolean().optional(),
  /** Factors affecting interval width */
  widthFactors: z.array(z.string()).optional(),
  /** Error message if unavailable */
  error: z.string().optional(),
});
export type ISLConformalResult = z.infer<typeof ISLConformalResultSchema>;

// ============================================================================
// ISL Analysis Bundle
// ============================================================================

/**
 * Combined ISL analysis results for a node
 * Each analysis type has its own availability flag for graceful degradation
 */
export const ISLAnalysisSchema = z.object({
  /** Sensitivity analysis (how much this node affects outcomes) */
  sensitivity: ISLSensitivityResultSchema.optional(),
  /** Contrastive explanation (why this vs alternatives) */
  contrastive: ISLContrastiveResultSchema.optional(),
  /** Conformal prediction intervals (uncertainty bounds) */
  conformal: ISLConformalResultSchema.optional(),
});
export type ISLAnalysis = z.infer<typeof ISLAnalysisSchema>;

// ============================================================================
// Validation Suggestions (Gracefully Degraded)
// ============================================================================

/**
 * Validation strategy suggestion from ISL
 */
export const ValidationSuggestionSchema = z.object({
  /** Strategy ID */
  id: z.string(),
  /** Human-readable title */
  title: z.string(),
  /** Detailed description */
  description: z.string(),
  /** Priority level */
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  /** Effort estimate */
  effort: z.enum(['minimal', 'moderate', 'significant']),
  /** Expected impact on decision confidence (0-1) */
  expectedImpact: z.number().min(0).max(1),
  /** Specific actions to take */
  actions: z.array(z.string()),
});
export type ValidationSuggestion = z.infer<typeof ValidationSuggestionSchema>;

/**
 * Aggregated validation suggestions bundle
 */
export const ValidationSuggestionsSchema = z.object({
  /** Whether ISL validation strategies were available */
  available: z.boolean(),
  /** Recommended validation strategies */
  strategies: z.array(ValidationSuggestionSchema).optional(),
  /** Overall priority for validation */
  overallPriority: z.enum(['low', 'medium', 'high']).optional(),
  /** Coverage metrics */
  coverage: z
    .object({
      nodeCoverage: z.number().min(0).max(1),
      riskCoverage: z.number().min(0).max(1),
    })
    .optional(),
  /** Error message if unavailable */
  error: z.string().optional(),
});
export type ValidationSuggestions = z.infer<typeof ValidationSuggestionsSchema>;

// ============================================================================
// LLM-Generated Critique
// ============================================================================

/**
 * Core critique content from LLM
 */
export const LLMCritiqueSchema = z.object({
  /** One-line summary of the critique */
  summary: z.string(),
  /** List of specific concerns identified */
  concerns: z.array(z.string()),
  /** Actionable suggestions for improvement */
  suggestions: z.array(z.string()),
});
export type LLMCritique = z.infer<typeof LLMCritiqueSchema>;

// ============================================================================
// Enhanced Node Critique
// ============================================================================

/**
 * Enhanced critique combining LLM analysis with ISL enrichment
 */
export const EnhancedNodeCritiqueSchema = z.object({
  /** Node identifier */
  nodeId: z.string(),
  /** Type of node being critiqued */
  kind: NodeKindSchema,
  /** Node title/label */
  title: z.string(),

  /** LLM-generated critique content */
  critique: LLMCritiqueSchema,

  /** ISL-enhanced analysis (gracefully degraded) */
  islAnalysis: ISLAnalysisSchema.optional(),

  /** Aggregated validation suggestions */
  validationSuggestions: ValidationSuggestionsSchema.optional(),

  /** Overall critique severity */
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),

  /** Confidence in this critique (0-1) */
  confidence: z.number().min(0).max(1),
});
export type EnhancedNodeCritique = z.infer<typeof EnhancedNodeCritiqueSchema>;

// ============================================================================
// Decision Review Request
// ============================================================================

/**
 * Request for enhanced decision review
 */
export const DecisionReviewRequestSchema = z.object({
  /** Correlation ID for tracing */
  correlationId: z.string().optional(),

  /** Node IDs to analyze (if empty, analyzes all decision-relevant nodes) */
  targetNodes: z.array(z.string()).optional(),

  /** Configuration options */
  config: z
    .object({
      /** Enable ISL sensitivity analysis */
      enableSensitivity: z.boolean().default(true),
      /** Enable ISL contrastive explanations */
      enableContrastive: z.boolean().default(true),
      /** Enable ISL conformal predictions */
      enableConformal: z.boolean().default(false),
      /** Enable ISL validation strategies */
      enableValidationStrategies: z.boolean().default(true),
      /** Timeout for ISL calls (ms) */
      islTimeoutMs: z.number().positive().default(5000),
      /** Maximum nodes to analyze */
      maxNodes: z.number().positive().default(20),
    })
    .optional(),
});
export type DecisionReviewRequest = z.infer<typeof DecisionReviewRequestSchema>;

// ============================================================================
// Decision Review Response
// ============================================================================

/**
 * ISL availability summary
 */
export const ISLAvailabilitySummarySchema = z.object({
  /** Whether ISL service was reachable */
  serviceAvailable: z.boolean(),
  /** Count of successful sensitivity analyses */
  sensitivitySuccessCount: z.number().int().min(0),
  /** Count of successful contrastive analyses */
  contrastiveSuccessCount: z.number().int().min(0),
  /** Count of successful conformal predictions */
  conformalSuccessCount: z.number().int().min(0),
  /** Whether validation strategies were available */
  validationStrategiesAvailable: z.boolean(),
  /** Overall degradation reason (if any) */
  degradationReason: z.string().optional(),
});
export type ISLAvailabilitySummary = z.infer<typeof ISLAvailabilitySummarySchema>;

/**
 * Enhanced decision review response
 */
export const DecisionReviewResponseSchema = z.object({
  /** Node-level critiques with ISL enrichment */
  critiques: z.array(EnhancedNodeCritiqueSchema),

  /** Graph-level validation suggestions */
  globalValidationSuggestions: ValidationSuggestionsSchema.optional(),

  /** Summary of ISL availability/degradation */
  islAvailability: ISLAvailabilitySummarySchema,

  /** Overall review summary */
  summary: z.object({
    /** Total nodes analyzed */
    nodesAnalyzed: z.number().int().min(0),
    /** Count by severity */
    bySeverity: z.object({
      info: z.number().int().min(0),
      low: z.number().int().min(0),
      medium: z.number().int().min(0),
      high: z.number().int().min(0),
      critical: z.number().int().min(0),
    }),
    /** Top concerns across all nodes */
    topConcerns: z.array(z.string()),
    /** Most impactful validation strategies */
    priorityStrategies: z.array(z.string()),
  }),

  /** Trace information */
  trace: z.object({
    requestId: z.string(),
    correlationId: z.string().optional(),
    latencyMs: z.number().int().min(0),
    islLatencyMs: z.number().int().min(0).optional(),
  }),
});
export type DecisionReviewResponse = z.infer<typeof DecisionReviewResponseSchema>;

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a degraded ISL sensitivity result (when ISL fails)
 */
export function createDegradedSensitivity(error?: string): ISLSensitivityResult {
  return {
    available: false,
    error: error ?? 'ISL sensitivity analysis unavailable',
  };
}

/**
 * Create a degraded ISL contrastive result (when ISL fails)
 */
export function createDegradedContrastive(error?: string): ISLContrastiveResult {
  return {
    available: false,
    error: error ?? 'ISL contrastive analysis unavailable',
  };
}

/**
 * Create a degraded ISL conformal result (when ISL fails)
 */
export function createDegradedConformal(error?: string): ISLConformalResult {
  return {
    available: false,
    error: error ?? 'ISL conformal prediction unavailable',
  };
}

/**
 * Create a degraded validation suggestions result (when ISL fails)
 */
export function createDegradedValidationSuggestions(error?: string): ValidationSuggestions {
  return {
    available: false,
    error: error ?? 'ISL validation strategies unavailable',
  };
}

/**
 * Create an ISL availability summary for full degradation
 */
export function createFullyDegradedAvailability(reason: string): ISLAvailabilitySummary {
  return {
    serviceAvailable: false,
    sensitivitySuccessCount: 0,
    contrastiveSuccessCount: 0,
    conformalSuccessCount: 0,
    validationStrategiesAvailable: false,
    degradationReason: reason,
  };
}
