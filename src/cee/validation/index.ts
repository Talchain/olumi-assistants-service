/**
 * CEE Validation Module
 *
 * Public API for validation utilities and severity classification.
 */

// Severity types and utilities
export {
  // Types
  type CeeSeverity,
  type StructuralWarningSeverity,
  type CanonicalSeverity,
  type CEEValidationIssue,
  type CeeValidationResult,

  // Functions
  toCanonicalSeverity,
  severityRank,
  compareSeverity,
  classifyIssueSeverity,
  getSuggestionForCode,
  createValidationIssue,
  summariseValidationIssues,
} from "./classifier.js";

// V3 Validator
export {
  validateV3Response,
  type V3ValidationResult,
  type V3ValidationOptions,
} from "./v3-validator.js";
