/**
 * CEE Decision Review Module
 *
 * Provides enhanced decision review capabilities with ISL integration
 * and graceful degradation support.
 */

// Service exports
export {
  executeDecisionReview,
  getDecisionReviewCircuitBreakerStatus,
  __resetDecisionReviewCircuitBreakerForTests,
  type DecisionReviewServiceConfig,
  type ServiceDecisionReviewRequest,
} from './service.js';

// Template exports
export {
  formatSensitivityExplanation,
  formatContrastiveExplanation,
  formatConformalExplanation,
  formatValidationSuggestions,
  formatNodeCritiqueSummary,
  formatDecisionReviewSummary,
  formatISLAvailability,
  formatDegradationNotice,
  explainSeverity,
} from './templates.js';

// Schema exports
export {
  // Node kinds
  NodeKindSchema,
  type NodeKind,
  // ISL analysis schemas
  ISLSensitivityResultSchema,
  ISLContrastiveResultSchema,
  ISLConformalResultSchema,
  ISLAnalysisSchema,
  type ISLSensitivityResult,
  type ISLContrastiveResult,
  type ISLConformalResult,
  type ISLAnalysis,
  // Validation suggestions
  ValidationSuggestionSchema,
  ValidationSuggestionsSchema,
  type ValidationSuggestion,
  type ValidationSuggestions,
  // LLM critique
  LLMCritiqueSchema,
  type LLMCritique,
  // Enhanced critique
  EnhancedNodeCritiqueSchema,
  type EnhancedNodeCritique,
  // Request/Response
  DecisionReviewRequestSchema,
  DecisionReviewResponseSchema,
  ISLAvailabilitySummarySchema,
  type DecisionReviewRequest,
  type DecisionReviewResponse,
  type ISLAvailabilitySummary,
  // Factory functions for graceful degradation
  createDegradedSensitivity,
  createDegradedContrastive,
  createDegradedConformal,
  createDegradedValidationSuggestions,
  createFullyDegradedAvailability,
} from './schema.js';
