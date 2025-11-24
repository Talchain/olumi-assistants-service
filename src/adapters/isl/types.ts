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
