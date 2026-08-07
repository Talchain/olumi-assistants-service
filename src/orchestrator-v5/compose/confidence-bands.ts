/**
 * Confidence banding — the SINGLE source for mapping a PLoT-provided
 * `factor_sensitivity[].confidence` scalar (0–1) onto the three-band
 * `'high' | 'medium' | 'low'` classification.
 *
 * Extracted so the evidence-block confidence lookup
 * (`buildFactorConfidenceLookup`, phase3-blocks.ts) and the capability-layer
 * lens selector (`lens-selector.ts`) band IDENTICALLY. A second hand-copied
 * threshold pair would be exactly the hand-maintained-mirror defect class the
 * platform has repeatedly been bitten by: a selector whose `'low confidence'`
 * trigger silently drifted from the evidence band would mislabel real state.
 * Both callers derive from HERE — change the thresholds once, both move.
 *
 * Thresholds are the pre-existing evidence-block bands (UNCHANGED — this
 * extraction is behaviour-preserving; the `buildFactorConfidenceLookup` tests
 * are the regression witness):
 *   c >= 0.7 → high · c >= 0.3 → medium · else → low.
 *
 * A non-finite / absent confidence returns `null` ("unknown") — NEVER a silent
 * default band. Absent ≠ a real signal (the enrichment doc: "absent means
 * unavailable, NOT zero"); a defaulted band would mislabel severity.
 */

export const CONFIDENCE_HIGH_MIN = 0.7;
export const CONFIDENCE_MEDIUM_MIN = 0.3;

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function bandConfidence(confidence: unknown): ConfidenceBand | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return null;
  }
  if (confidence >= CONFIDENCE_HIGH_MIN) return 'high';
  if (confidence >= CONFIDENCE_MEDIUM_MIN) return 'medium';
  return 'low';
}
