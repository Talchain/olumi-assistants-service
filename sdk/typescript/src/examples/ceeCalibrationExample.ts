/**
 * CEE SDK Calibration Snapshot Example (TypeScript)
 *
 * This module demonstrates how to collapse one or more CEE envelopes into a
 * small, metadata-only snapshot that focuses on calibration signals:
 *
 * - Overall quality score and band (low / medium / high).
 * - Whether any truncation flags were set across envelopes.
 * - Whether any validation issues were reported.
 *
 * It is intended for use in diagnostics, calibration dashboards, or smoke
 * tests. Callers should treat it as an example rather than a hard API
 * contract.
 */

import {
  buildCeeJourneySummary,
  buildCeeUiFlags,
  type CeeJourneyEnvelopes,
} from "../ceeHelpers.js";
import { CEE_QUALITY_HIGH_MIN, CEE_QUALITY_MEDIUM_MIN } from "../ceePolicy.js";

export type CeeCalibrationBand = "low" | "medium" | "high";

export interface CeeCalibrationSnapshot {
  quality_overall?: number;
  quality_band?: CeeCalibrationBand;
  any_truncated: boolean;
  has_validation_issues: boolean;
}

/**
 * Build a compact calibration snapshot from one or more CEE envelopes.
 *
 * The function only uses structured metadata already present on the envelopes
 * (quality scores, truncation flags, validation issues) and never inspects
 * raw briefs, graphs, or LLM text.
 */
export function buildCeeCalibrationSnapshot(
  envelopes: CeeJourneyEnvelopes,
): CeeCalibrationSnapshot {
  const journey = buildCeeJourneySummary(envelopes);
  const uiFlags = buildCeeUiFlags(journey);

  const qualityOverall = journey.story.quality_overall;

  let band: CeeCalibrationBand | undefined;
  if (typeof qualityOverall === "number") {
    if (qualityOverall >= CEE_QUALITY_HIGH_MIN) band = "high";
    else if (qualityOverall >= CEE_QUALITY_MEDIUM_MIN) band = "medium";
    else band = "low";
  }

  const anyTruncated =
    journey.health.any_truncated ||
    journey.story.any_truncated ||
    uiFlags.has_truncation_somewhere;

  const hasValidationIssues = journey.health.has_validation_issues;

  return {
    quality_overall: qualityOverall,
    quality_band: band,
    any_truncated: Boolean(anyTruncated),
    has_validation_issues: hasValidationIssues,
  };
}
