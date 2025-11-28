import {
  isRetryableCEEError,
  getCeeErrorMetadata,
  buildCeeErrorViewModel,
  getCeeErrorCategory,
  getCeeRecoveryHints,
  isCeeEmptyGraphError,
  shouldRetry,
  type CeeErrorMetadata,
  type CeeErrorViewModel,
  type CeeErrorCategory,
  type CeeRecoveryHints,
} from "./ceeHelpers.js";

// Focused re-export surface for CEE error helpers.
//
// This module exists so that PLoT/Scenario and other integrations can
// depend only on error-related helpers without pulling in the entire
// ceeHelpers bundle. All implementations continue to live in
// ceeHelpers.ts; this file is a thin facade.

export {
  isRetryableCEEError,
  getCeeErrorMetadata,
  buildCeeErrorViewModel,
  getCeeErrorCategory,
  getCeeRecoveryHints,
  isCeeEmptyGraphError,
  shouldRetry,
};

export type {
  CeeErrorMetadata,
  CeeErrorViewModel,
  CeeErrorCategory,
  CeeRecoveryHints,
};
