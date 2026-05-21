/**
 * Shared sensitivity → prose-fragment translator.
 *
 * Converts a raw sensitivity coefficient into a sentence-fragment that
 * keeps the leading-option frame the deterministic prose paths share.
 * Composes after a driver label — "..., which {fragment}." or "Today it
 * {fragment}." — so the result reads as "Cost moderately weakens the
 * lead." rather than the more abstract "Cost has a moderate negative
 * influence."
 *
 * Single source of truth for sensitivity-direction vocabulary. Used by:
 *   - the deterministic fallback composers for `explain_results` /
 *     `what_would_flip` handlers (`tools/handlers/explanation-fallback.ts`)
 *   - the post-analysis advice gate's enriched composers
 *     (`routing/post-analysis-advice-gate.ts`)
 *
 * Bands (single source of truth: `format/influence-bands.ts`):
 *   |v| < 0.05         → "has little effect on the lead"      (NEAR_ZERO)
 *   |v| in [0.05, 0.3) → "slightly {strengthens|weakens} the lead"
 *   |v| in [0.3, 0.7)  → "moderately ..."
 *   |v| in [0.7, 0.95) → "strongly ..."
 *   |v| ≥ 0.95         → "very strongly ..."
 *
 * Vocabulary differs from `influencePhrase` by design: that helper
 * composes nouns ("moderate positive influence") for the display-safe
 * projection, while this fragment composes adverbs paired with the
 * lead-framing verbs the surrounding prose uses ("moderately
 * strengthens the lead"). The lowest band uses "slightly" rather than
 * "weakly" — "weakly weakens" reads awkwardly in English.
 *
 * Telemetry (where it exists) retains the raw number; this helper only
 * governs USER-FACING prose.
 */

import {
  bandFromMagnitude,
  NEAR_ZERO_INFLUENCE_THRESHOLD,
} from './influence-bands.js';

export function formatSensitivityDirection(value: number): string {
  if (!Number.isFinite(value)) return 'has little effect on the lead';
  const absV = Math.abs(value);
  if (absV < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'has little effect on the lead';
  const band = bandFromMagnitude(absV);
  const adverb =
    band === 'weak'
      ? 'slightly'
      : band === 'moderate'
        ? 'moderately'
        : band === 'strong'
          ? 'strongly'
          : 'very strongly';
  const direction = value < 0 ? 'weakens' : 'strengthens';
  return `${adverb} ${direction} the lead`;
}
