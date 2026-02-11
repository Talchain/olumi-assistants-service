/**
 * CEE Shared Constants
 *
 * Re-exports canonical CIL constants from @talchain/schemas to avoid
 * circular dependencies between modules and prevent definition drift.
 */

import {
  STRENGTH_DEFAULT_SIGNATURE,
  STRENGTH_DEFAULT_THRESHOLD,
  STRENGTH_MEAN_DEFAULT_THRESHOLD,
  STRENGTH_DEFAULT_MIN_EDGES,
  EDGE_STRENGTH_LOW_THRESHOLD as _EDGE_STRENGTH_LOW_THRESHOLD,
  EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD,
} from "@talchain/schemas";

/**
 * Default strength mean value applied when LLM omits strength data.
 * Source: @talchain/schemas STRENGTH_DEFAULT_SIGNATURE.mean
 */
export const DEFAULT_STRENGTH_MEAN = STRENGTH_DEFAULT_SIGNATURE.mean;

/**
 * Default strength std value derived when LLM omits strength data.
 * Source: @talchain/schemas STRENGTH_DEFAULT_SIGNATURE.std
 */
export const DEFAULT_STRENGTH_STD = STRENGTH_DEFAULT_SIGNATURE.std;

/**
 * Threshold for dominant strength mean default detection (70%).
 * Source: @talchain/schemas STRENGTH_MEAN_DEFAULT_THRESHOLD
 */
export const STRENGTH_MEAN_DOMINANT_THRESHOLD = STRENGTH_MEAN_DEFAULT_THRESHOLD;

/**
 * Threshold for EDGE_STRENGTH_LOW warning.
 * Source: @talchain/schemas EDGE_STRENGTH_LOW_THRESHOLD
 */
export const EDGE_STRENGTH_LOW_THRESHOLD = _EDGE_STRENGTH_LOW_THRESHOLD;

// Re-export additional thresholds from shared package for direct use
export {
  STRENGTH_DEFAULT_THRESHOLD,
  STRENGTH_DEFAULT_MIN_EDGES,
  EDGE_STRENGTH_NEGLIGIBLE_THRESHOLD,
};
