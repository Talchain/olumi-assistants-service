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
