/**
 * Validators module
 *
 * Exports deterministic validation utilities for graphs and other data structures.
 */

export {
  validateGraph,
  validateGraphPostNormalisation,
} from './graph-validator.js';

export {
  zodToValidationErrors,
  isZodError,
} from './zod-error-mapper.js';

export {
  type GraphValidationInput,
  type GraphValidationResult,
  type ValidationIssue,
  type ValidationErrorCode,
  type ValidationWarningCode,
  type ValidationSeverity,
  type StructuralErrorCode,
  type TopologyErrorCode,
  type ReachabilityErrorCode,
  type FactorDataErrorCode,
  type SemanticErrorCode,
  type NumericErrorCode,
  type PostNormErrorCode,
  type FactorCategory,
  type FactorCategoryInfo,
  type NodeMap,
  type AdjacencyLists,
  type EdgeInfo,
  type AllowedEdgeRule,
  NODE_LIMIT,
  EDGE_LIMIT,
  MIN_OPTIONS,
  MAX_OPTIONS,
  ALLOWED_EDGES,
  CANONICAL_EDGE,
} from './graph-validator.types.js';
