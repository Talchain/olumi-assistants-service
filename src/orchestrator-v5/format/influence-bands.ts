/**
 * Shared influence-band thresholds for sensitivity → decision-language
 * translation. Single source of truth: both the upstream display-safe
 * projection (`format-analysis-for-context.ts`) and the post-compose
 * defence-in-depth rewriter (`numeric-prose-formatter.ts`) read these
 * thresholds and the `bandFromMagnitude` classifier so band boundaries
 * cannot drift between the two layers.
 *
 * Bands are defined by absolute sensitivity:
 *   |v| < 0.3        → "weak"
 *   |v| in [0.3, 0.7) → "moderate"
 *   |v| in [0.7, 0.95) → "strong"
 *   |v| ≥ 0.95       → "very strong"
 *
 * Near-zero sensitivities (|v| < NEAR_ZERO_INFLUENCE_THRESHOLD) are
 * treated as "no material influence" by the upstream projection — sign
 * is not meaningful at that scale. The post-compose rewriter does not
 * use this short-circuit because it operates on text that already
 * contains a phrase the model emitted ("sensitivity of 0.02") and
 * preserving the model's framing is safer than rewriting it to a
 * neutral phrase.
 */

export type InfluenceBand = 'weak' | 'moderate' | 'strong' | 'very strong';

export const INFLUENCE_BAND_THRESHOLDS = {
  veryStrong: 0.95,
  strong: 0.7,
  moderate: 0.3,
} as const;

export const NEAR_ZERO_INFLUENCE_THRESHOLD = 0.05;

export function bandFromMagnitude(absValue: number): InfluenceBand {
  if (absValue >= INFLUENCE_BAND_THRESHOLDS.veryStrong) return 'very strong';
  if (absValue >= INFLUENCE_BAND_THRESHOLDS.strong) return 'strong';
  if (absValue >= INFLUENCE_BAND_THRESHOLDS.moderate) return 'moderate';
  return 'weak';
}
