/**
 * CEE Shared Constants
 *
 * Centralized constants to avoid circular dependencies between modules.
 */

/**
 * Default strength mean value applied when LLM omits strength data.
 *
 * Used in:
 * - Edge transformation fallback (schema-v3)
 * - Strength default detection (integrity-sentinel)
 *
 * Shared constant prevents drift between fallback application and detection logic.
 *
 * Note: This value may be negated during sign adjustment based on effect_direction.
 * Detection should compare Math.abs(strength_mean) to account for both polarities.
 */
export const DEFAULT_STRENGTH_MEAN = 0.5;

/**
 * Default strength std value derived when LLM omits strength data.
 *
 * Derived from deriveStrengthStd(0.5, 0.5, undefined):
 *   cv = 0.3 * (1 - 0.5) + 0.1 = 0.25
 *   std = 0.25 * 0.5 * 1.0 = 0.125
 *
 * Used in:
 * - Strength default detection signature (integrity-sentinel)
 *
 * Part of the default signature: |strength_mean| === 0.5 AND strength_std === 0.125
 */
export const DEFAULT_STRENGTH_STD = 0.125;

/**
 * Threshold for dominant strength mean default detection (70%).
 *
 * When ≥70% of causal edges have |strength_mean| ≈ 0.5 (regardless of std),
 * this indicates likely uniform defaulting even if belief/provenance vary.
 *
 * Lower threshold than STRENGTH_DEFAULT_APPLIED (80%) to catch cases where
 * some edges have varied std but mean is still defaulted.
 */
export const STRENGTH_MEAN_DOMINANT_THRESHOLD = 0.7;

/**
 * Threshold for EDGE_STRENGTH_LOW warning (v2.7 schema).
 *
 * Edges with |strength_mean| < 0.05 are flagged as informational —
 * the relationship is so weak it may not contribute meaningfully
 * to the causal model.
 */
export const EDGE_STRENGTH_LOW_THRESHOLD = 0.05;
