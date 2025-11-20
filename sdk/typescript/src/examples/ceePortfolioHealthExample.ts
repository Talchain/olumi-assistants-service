/**
 * CEE Portfolio / Batch Health Example (TypeScript)
 *
 * This example shows how a downstream service might summarise the health of a
 * portfolio of decisions based on existing CeeDecisionReviewPayload objects.
 *
 * Notes:
 * - This file is not executed automatically in CI; it is example code only.
 * - When consuming the published SDK, replace "../index.js" with
 *   "@olumi/assistants-sdk".
 */

import { type CeeDecisionReviewPayload } from "../index.js";

/**
 * Minimal shape for a decision review entry in a portfolio. The CEE layer
 * never needs to see raw prompts or graphs – only this metadata.
 */
export interface PortfolioDecisionReviewItem {
  decisionId: string;
  createdAt: string;
  cee: CeeDecisionReviewPayload;
}

export interface PortfolioHealthSummary {
  total_decisions: number;
  ok_count: number;
  warning_count: number;
  risk_count: number;
  has_truncation_count: number;
  has_disagreement_count: number;
  incomplete_journeys_count: number;
}

/**
 * Compute a simple portfolio-level health summary from a batch of
 * CeeDecisionReviewPayloads. This helper is metadata-only: it uses only health
 * bands, truncation flags, disagreement flags, and completeness.
 */
export function computePortfolioHealthSummary(
  items: PortfolioDecisionReviewItem[],
): PortfolioHealthSummary {
  let ok = 0;
  let warning = 0;
  let risk = 0;
  let trunc = 0;
  let disagreement = 0;
  let incomplete = 0;

  for (const item of items) {
    const { journey, uiFlags } = item.cee;
    const status = journey.health.overallStatus;

    if (status === "ok") ok += 1;
    else if (status === "warning") warning += 1;
    else if (status === "risk") risk += 1;

    if (uiFlags.has_truncation_somewhere) trunc += 1;
    if (uiFlags.has_team_disagreement) disagreement += 1;
    if (!uiFlags.is_journey_complete) incomplete += 1;
  }

  return {
    total_decisions: items.length,
    ok_count: ok,
    warning_count: warning,
    risk_count: risk,
    has_truncation_count: trunc,
    has_disagreement_count: disagreement,
    incomplete_journeys_count: incomplete,
  };
}
