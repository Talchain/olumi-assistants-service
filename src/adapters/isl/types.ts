/**
 * ISL (Inference & Structure Learning) Client Types
 *
 * Types for communicating with the ISL service for causal validation
 * of bias findings.
 */

import type { GraphV1 } from '../../contracts/plot/engine.js';

/**
 * Request to validate bias findings using causal inference
 */
export interface ISLBiasValidateRequest {
  /** Canonical graph structure from Engine */
  graph: GraphV1;

  /** Bias findings to validate */
  bias_findings: Array<{
    /** Canonical bias code (e.g., "CONFIRMATION_BIAS") */
    code: string;

    /** Graph elements affected by this bias */
    targets: {
      node_ids: string[];
      edge_ids?: string[];
    };

    /** Severity level of the bias */
    severity: 'low' | 'medium' | 'high';
  }>;

  /** Optional validation configuration */
  validation_config?: {
    /** Enable counterfactual analysis */
    enable_counterfactuals?: boolean;

    /** Evidence nodes to analyze for causal support */
    evidence_nodes?: string[];
  };
}

/**
 * Causal validation result for a single bias finding
 */
export interface CausalValidation {
  /** Whether the bias effect is causally identifiable */
  identifiable: boolean;

  /** Strength of causal impact (0-1 scale) */
  strength: number;

  /** Confidence level in the validation */
  confidence: 'low' | 'medium' | 'high';

  /** Detailed analysis (optional) */
  details?: {
    /** Causal paths identified in the graph */
    affected_paths?: string[];

    /** Counterfactual impact measurement */
    counterfactual_delta?: {
      /** Metric being measured (e.g., "outcome_range") */
      metric: string;

      /** Percentage change (e.g., 30 = "widens by 30%") */
      change_percent: number;
    };
  };
}

/**
 * Evidence strength classification for a node
 */
export interface EvidenceStrength {
  /** Node ID being analyzed */
  node_id: string;

  /** Level of causal support this evidence provides */
  causal_support: 'none' | 'weak' | 'moderate' | 'strong';

  /** Optional reasoning for the classification */
  reasoning?: string;
}

/**
 * Validated bias finding with causal analysis
 */
export interface ValidatedBiasFinding {
  /** Original bias code */
  bias_code: string;

  /** Causal validation result */
  causal_validation: CausalValidation;

  /** Evidence strength analysis (if requested) */
  evidence_strength?: EvidenceStrength[];
}

/**
 * Response from ISL bias validation
 */
export interface ISLBiasValidateResponse {
  /** Validation results for each bias finding */
  validations: ValidatedBiasFinding[];

  /** Request ID for tracing */
  request_id: string;

  /** Total processing time in milliseconds */
  latency_ms: number;
}

/**
 * Error response from ISL service
 */
export interface ISLError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * ISL client configuration
 */
export interface ISLClientConfig {
  /** Base URL for ISL service */
  baseUrl: string;

  /** Request timeout in milliseconds (default: 5000ms - production canary setting) */
  timeout?: number;

  /** Maximum retry attempts (default: 1 - production canary setting) */
  maxRetries?: number;

  /** API key for ISL service (if required) */
  apiKey?: string;
}

// ============================================================================
// Sensitivity Analysis Types
// ============================================================================

/**
 * Request for detailed sensitivity analysis
 */
export interface ISLSensitivityRequest {
  /** Canonical graph structure from Engine */
  graph: GraphV1;

  /** Node IDs to analyze for sensitivity */
  target_nodes: string[];

  /** Optional configuration */
  config?: {
    /** Include causal path analysis */
    include_paths?: boolean;
    /** Threshold for high sensitivity (0-1, default 0.7) */
    high_threshold?: number;
  };
}

/**
 * Sensitivity analysis for a single node
 */
export interface NodeSensitivity {
  /** Node ID */
  node_id: string;

  /** Overall sensitivity score (0-1) */
  sensitivity_score: number;

  /** Classification based on threshold */
  classification: 'low' | 'medium' | 'high';

  /** Factors contributing to sensitivity */
  contributing_factors: Array<{
    /** Factor type (e.g., "evidence_gap", "assumption_chain") */
    type: string;
    /** Impact on sensitivity (0-1) */
    impact: number;
    /** Human-readable description */
    description: string;
  }>;

  /** Causal paths affected (if requested) */
  affected_paths?: string[];
}

/**
 * Response from sensitivity analysis
 */
export interface ISLSensitivityResponse {
  /** Sensitivity results for each target node */
  sensitivities: NodeSensitivity[];

  /** Overall graph sensitivity summary */
  summary: {
    /** Average sensitivity across analyzed nodes */
    avg_sensitivity: number;
    /** Count of high sensitivity nodes */
    high_sensitivity_count: number;
    /** Most critical node */
    most_critical_node?: string;
  };

  /** Request ID for tracing */
  request_id: string;

  /** Processing time in milliseconds */
  latency_ms: number;
}

// ============================================================================
// Contrastive Explanation Types
// ============================================================================

/**
 * Request for contrastive explanation
 */
export interface ISLContrastiveRequest {
  /** Canonical graph structure from Engine */
  graph: GraphV1;

  /** The decision/conclusion node to explain */
  decision_node_id: string;

  /** Alternative outcome to contrast against */
  alternative?: {
    /** Description of the alternative outcome */
    outcome: string;
    /** Key differences from actual decision */
    key_differences?: string[];
  };

  /** Optional configuration */
  config?: {
    /** Maximum number of contrast points to return */
    max_contrasts?: number;
    /** Include counterfactual analysis */
    include_counterfactuals?: boolean;
  };
}

/**
 * A single contrast point explaining why decision differs from alternative
 */
export interface ContrastPoint {
  /** Type of contrast (e.g., "evidence", "assumption", "weighting") */
  type: 'evidence' | 'assumption' | 'weighting' | 'methodology';

  /** Node ID most relevant to this contrast */
  node_id: string;

  /** Why the actual decision was made */
  actual_reason: string;

  /** What would need to change for alternative */
  alternative_condition: string;

  /** Confidence in this contrast point */
  confidence: number;

  /** Counterfactual scenario (if requested) */
  counterfactual?: {
    /** What would change */
    change: string;
    /** Predicted impact on outcome */
    predicted_impact: string;
  };
}

/**
 * Response from contrastive explanation
 */
export interface ISLContrastiveResponse {
  /** The decision node being explained */
  decision_node_id: string;

  /** Main contrast points */
  contrasts: ContrastPoint[];

  /** Summary explanation */
  summary: {
    /** One-sentence explanation */
    explanation: string;
    /** Key differentiating factors */
    key_factors: string[];
  };

  /** Request ID for tracing */
  request_id: string;

  /** Processing time in milliseconds */
  latency_ms: number;
}

// ============================================================================
// Conformal Prediction Types
// ============================================================================

/**
 * Request for conformal prediction intervals
 */
export interface ISLConformalRequest {
  /** Canonical graph structure from Engine */
  graph: GraphV1;

  /** Node IDs containing quantitative predictions */
  prediction_nodes: string[];

  /** Desired confidence level (0-1, default 0.9) */
  confidence_level?: number;

  /** Optional configuration */
  config?: {
    /** Method for interval calculation */
    method?: 'quantile' | 'conformalized' | 'adaptive';
    /** Historical calibration data ID (if available) */
    calibration_id?: string;
  };
}

/**
 * Conformal prediction interval for a single node
 */
export interface PredictionInterval {
  /** Node ID */
  node_id: string;

  /** Point estimate (if available) */
  point_estimate?: number;

  /** Lower bound of interval */
  lower_bound: number;

  /** Upper bound of interval */
  upper_bound: number;

  /** Confidence level for this interval */
  confidence_level: number;

  /** Interval width (upper - lower) */
  interval_width: number;

  /** Whether interval is well-calibrated based on historical data */
  well_calibrated: boolean;

  /** Factors affecting interval width */
  width_factors?: Array<{
    /** Factor name */
    factor: string;
    /** Contribution to width (percentage) */
    contribution: number;
  }>;
}

/**
 * Response from conformal prediction
 */
export interface ISLConformalResponse {
  /** Prediction intervals for each node */
  intervals: PredictionInterval[];

  /** Calibration quality metrics */
  calibration: {
    /** Overall calibration score (0-1) */
    score: number;
    /** Whether results are reliable */
    is_reliable: boolean;
    /** Warning if calibration is poor */
    warning?: string;
  };

  /** Request ID for tracing */
  request_id: string;

  /** Processing time in milliseconds */
  latency_ms: number;
}

// ============================================================================
// Validation Strategies Types
// ============================================================================

/**
 * Request for validation strategy recommendations
 */
export interface ISLValidationStrategiesRequest {
  /** Canonical graph structure from Engine */
  graph: GraphV1;

  /** Specific areas of concern (optional) */
  areas_of_concern?: Array<{
    /** Node IDs in this area */
    node_ids: string[];
    /** Type of concern */
    concern_type: 'evidence_quality' | 'logic_gap' | 'assumption_risk' | 'data_quality';
  }>;

  /** Optional configuration */
  config?: {
    /** Maximum number of strategies to return */
    max_strategies?: number;
    /** Prioritize by effort level */
    prioritize_by?: 'impact' | 'effort' | 'coverage';
  };
}

/**
 * A recommended validation strategy
 */
export interface ValidationStrategy {
  /** Unique strategy ID */
  id: string;

  /** Human-readable title */
  title: string;

  /** Detailed description */
  description: string;

  /** Priority level */
  priority: 'low' | 'medium' | 'high' | 'critical';

  /** Estimated effort */
  effort: 'minimal' | 'moderate' | 'significant';

  /** Expected impact on decision confidence */
  expected_impact: number;

  /** Node IDs this strategy addresses */
  target_nodes: string[];

  /** Specific actions to take */
  actions: Array<{
    /** Action description */
    action: string;
    /** Action type */
    type: 'gather_data' | 'expert_review' | 'sensitivity_test' | 'alternative_analysis';
  }>;

  /** Success criteria */
  success_criteria: string;
}

/**
 * Response from validation strategies
 */
export interface ISLValidationStrategiesResponse {
  /** Recommended strategies ordered by priority */
  strategies: ValidationStrategy[];

  /** Coverage analysis */
  coverage: {
    /** Percentage of graph nodes addressed by strategies */
    node_coverage: number;
    /** Percentage of high-risk areas addressed */
    risk_coverage: number;
  };

  /** Request ID for tracing */
  request_id: string;

  /** Processing time in milliseconds */
  latency_ms: number;
}
