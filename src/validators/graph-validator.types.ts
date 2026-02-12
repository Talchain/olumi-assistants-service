/**
 * Graph Validator Types
 *
 * Type definitions for deterministic graph validation.
 * Runs after Zod schema validation, before enrichment.
 *
 * @module validators/graph-validator.types
 */

import type { GraphT, NodeT, EdgeT } from "../schemas/graph.js";

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Tier 1: Structural validation errors
 */
export type StructuralErrorCode =
  | "MISSING_GOAL"
  | "MISSING_DECISION"
  | "INSUFFICIENT_OPTIONS"
  | "MISSING_BRIDGE"
  | "NODE_LIMIT_EXCEEDED"
  | "EDGE_LIMIT_EXCEEDED"
  | "INVALID_EDGE_REF";

/**
 * Tier 2: Topology validation errors (V12.3 aligned)
 */
export type TopologyErrorCode =
  | "INVALID_EDGE_TYPE"
  | "GOAL_HAS_OUTGOING"
  | "DECISION_HAS_INCOMING"
  | "CYCLE_DETECTED";

/**
 * Tier 3: Reachability validation errors
 */
export type ReachabilityErrorCode =
  | "UNREACHABLE_FROM_DECISION"
  | "NO_PATH_TO_GOAL";

/**
 * Tier 4: Factor data consistency errors
 */
export type FactorDataErrorCode =
  | "CONTROLLABLE_MISSING_DATA"
  | "OBSERVABLE_MISSING_DATA"
  | "OBSERVABLE_EXTRA_DATA"
  | "EXTERNAL_HAS_DATA"
  | "CATEGORY_MISMATCH";

/**
 * Tier 5: Semantic integrity errors
 */
export type SemanticErrorCode =
  | "NO_EFFECT_PATH"
  | "OPTIONS_IDENTICAL"
  | "INVALID_INTERVENTION_REF"
  | "GOAL_NUMBER_AS_FACTOR"
  | "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR";

/**
 * Tier 6: Numeric validation errors
 */
export type NumericErrorCode = "NAN_VALUE";

/**
 * Post-normalisation validation errors
 */
export type PostNormErrorCode = "SIGN_MISMATCH";

/**
 * All error codes
 */
export type ValidationErrorCode =
  | StructuralErrorCode
  | TopologyErrorCode
  | ReachabilityErrorCode
  | FactorDataErrorCode
  | SemanticErrorCode
  | NumericErrorCode
  | PostNormErrorCode;

// =============================================================================
// Warning Codes
// =============================================================================

export type ValidationWarningCode =
  | "STRENGTH_OUT_OF_RANGE"
  | "PROBABILITY_OUT_OF_RANGE"
  | "OUTCOME_NEGATIVE_POLARITY"
  | "RISK_POSITIVE_POLARITY"
  | "LOW_EDGE_CONFIDENCE"
  | "EMPTY_UNCERTAINTY_DRIVERS"
  | "STRUCTURAL_EDGE_NOT_CANONICAL"
  | "LOW_STD_NON_STRUCTURAL"
  | "ENUM_VALUE_CORRECTED"
  | "SIGN_CORRECTED";

// =============================================================================
// Info Codes (non-blocking observability hints)
// =============================================================================

export type ValidationInfoCode =
  | "EDGE_ORIGIN_DEFAULTED"
  | "CATEGORY_OVERRIDE"
  | "CONTROLLABLE_DATA_FILLED"
  | "EXEMPT_UNREACHABLE_OUTCOME_RISK"
  | "CONSTRAINT_NODE_REMAPPED"
  | "CONSTRAINT_DROPPED_NO_TARGET";

// =============================================================================
// Validation Issue
// =============================================================================

export type ValidationSeverity = "error" | "warn" | "info";

export interface ValidationIssue {
  /** Error/warning/info code */
  code: ValidationErrorCode | ValidationWarningCode | ValidationInfoCode;
  /** Severity level */
  severity: ValidationSeverity;
  /** Human-readable message */
  message: string;
  /** JSON path to the issue location (e.g., 'edges[17]', 'nodesById.fac_price') */
  path?: string;
  /** Additional context for debugging */
  context?: Record<string, unknown>;
}

// =============================================================================
// Factor Category
// =============================================================================

/**
 * Inferred factor category based on graph structure.
 * - controllable: Has incoming edge from option node
 * - observable: No option edge but has data.value
 * - external: No option edge, no data.value
 */
export type FactorCategory = "controllable" | "observable" | "external";

export interface FactorCategoryInfo {
  nodeId: string;
  category: FactorCategory;
  hasOptionEdge: boolean;
  hasValue: boolean;
  /** Explicit category from node.category field (V12.4+) */
  explicitCategory?: FactorCategory;
}

// =============================================================================
// Input/Output Types
// =============================================================================

export interface GraphValidationInput {
  /** The graph to validate */
  graph: GraphT;
  /** Optional request ID for telemetry */
  requestId?: string;
}

export interface ConstraintNormalisationResult {
  /** Normalised constraints (valid + remapped, dropped ones removed) */
  constraints: Array<{ node_id: string; [key: string]: unknown }>;
  /** Info issues for observability */
  issues: ValidationIssue[];
  /** Counts */
  constraints_total: number;
  constraints_valid: number;
  constraints_remapped: number;
  constraints_dropped: number;
}

export interface ControllabilitySummary {
  total_outcome_risk_nodes: number;
  with_controllable_ancestry: number;
  without_controllable_ancestry: number;
  /** Subset of without_controllable_ancestry that were exempted from UNREACHABLE_FROM_DECISION */
  exempt_count: number;
  exempt_node_ids: string[];
}

export interface GraphValidationResult {
  /** Whether the graph is valid (no errors) */
  valid: boolean;
  /** Blocking errors that prevent processing */
  errors: ValidationIssue[];
  /** Non-blocking warnings */
  warnings: ValidationIssue[];
  /** Controllability metrics for outcome/risk nodes (metadata only) */
  controllability_summary?: ControllabilitySummary;
}

// =============================================================================
// Internal Types
// =============================================================================

export interface NodeMap {
  byId: Map<string, NodeT>;
  byKind: Map<string, NodeT[]>;
}

export interface EdgeInfo {
  edge: EdgeT;
  index: number;
  fromNode?: NodeT;
  toNode?: NodeT;
}

export interface AdjacencyLists {
  /** Forward adjacency: nodeId -> [target nodeIds] */
  forward: Map<string, string[]>;
  /** Reverse adjacency: nodeId -> [source nodeIds] */
  reverse: Map<string, string[]>;
}

/**
 * Allowed edge matrix entry.
 * Used to validate edge types based on node kinds.
 */
export interface AllowedEdgeRule {
  fromKind: string;
  toKind: string;
  /** Optional constraint for factor edges */
  fromFactorCategory?: FactorCategory;
  toFactorCategory?: FactorCategory;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * CEE graph validation limits.
 *
 * Platform defaults from @talchain/schemas LIMITS: MAX_NODES=50, MAX_EDGES=100, MAX_OPTIONS=10.
 * CEE intentionally diverges on EDGE_LIMIT and MAX_OPTIONS:
 *
 * - EDGE_LIMIT (200 vs platform 100): CEE causal graphs are more densely connected
 *   than typical platform graphs. Factor→outcome and cross-factor edges can easily
 *   exceed 100 in complex decision models with 5+ options.
 *
 * - MAX_OPTIONS (6 vs platform 10): CEE caps options lower because each option
 *   generates a full intervention bundle with factor mappings. More than 6 options
 *   degrades LLM output quality and response time without improving decision value.
 *
 * NODE_LIMIT matches the platform standard (50).
 */
export const NODE_LIMIT = 50;
export const EDGE_LIMIT = 200;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

/**
 * Allowed edge matrix (V12.3 aligned).
 * Each entry defines a valid edge type.
 */
export const ALLOWED_EDGES: AllowedEdgeRule[] = [
  { fromKind: "decision", toKind: "option" },
  { fromKind: "option", toKind: "factor", toFactorCategory: "controllable" },
  { fromKind: "factor", toKind: "factor", toFactorCategory: "observable" },
  { fromKind: "factor", toKind: "factor", toFactorCategory: "external" },
  { fromKind: "factor", toKind: "outcome" },
  { fromKind: "factor", toKind: "risk" },
  { fromKind: "outcome", toKind: "goal" },
  { fromKind: "risk", toKind: "goal" },
];

/**
 * Canonical edge defaults for structural edges.
 * T2: Strict canonical std - exactly 0.01, undefined triggers repair.
 */
export const CANONICAL_EDGE = {
  mean: 1,
  std: 0.01,        // Strict canonical value (not a max)
  stdMax: 0.05,     // Legacy tolerance (kept for backwards compat in warnings)
  prob: 1,
  direction: "positive" as const,
};
