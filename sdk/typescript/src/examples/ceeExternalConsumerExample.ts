/**
 * CEE External / IDE Consumer Example (TypeScript)
 *
 * This example shows how an IDE extension or other external tool can consume a
 * metadata-only CEE review bundle handed to it by an engine or service layer.
 *
 * The external tool:
 * - Never calls CEE directly.
 * - Never sees prompts, graphs, or LLM outputs.
 * - Works purely with a compact review payload and engine/trace metadata.
 *
 * In production, the engine/PLoT layer would typically expose a shape similar
 * to CeeIntegrationReviewBundle on its own APIs. The IDE-side code would treat
 * that as read-only input.
 */

import type {
  CeeDecisionReviewPayload,
  CeeEngineStatus,
  CeeTraceSummary,
} from "../index.js";

/**
 * Minimal bundle an external tool might receive from an engine service.
 *
 * This is intentionally close to CeeIntegrationReviewBundle, but flattened and
 * simplified for IDE-style consumers.
 */
export interface ExternalCeeReviewBundle {
  review: CeeDecisionReviewPayload | null;
  trace: CeeTraceSummary | null;
  engineStatus?: CeeEngineStatus | null;
  errorCode?: string | null;
}

/**
 * Minimal, metadata-only view model suitable for an IDE panel.
 *
 * UI code can bind directly to this shape without needing to understand the
 * full CEE envelope structure.
 */
export interface IdeDecisionReviewViewModel {
  title: string;
  headline: string;
  healthStatus: CeeDecisionReviewPayload["journey"]["health"]["overallStatus"];
  healthTone: CeeDecisionReviewPayload["journey"]["health"]["overallTone"];
  hasHighRiskEnvelopes: boolean;
  hasTruncationSomewhere: boolean;
  hasTeamDisagreement: boolean;
  isJourneyComplete: boolean;
  missingEnvelopes: string[];
  traceId?: string;
  engineLabel?: string;
  errorCode?: string | null;
}

export interface IdeDecisionContext {
  /**
   * Human-friendly decision title from the host app (never from CEE itself).
   */
  decisionTitle: string;
}

/**
 * Pure helper: project an engine-provided, metadata-only CEE review bundle into
 * a small view model for an IDE or external tool.
 */
export function renderDecisionReviewForIDE(
  bundle: ExternalCeeReviewBundle,
  context: IdeDecisionContext,
): IdeDecisionReviewViewModel {
  const { review, trace, engineStatus, errorCode } = bundle;

  if (!review) {
    return {
      title: context.decisionTitle,
      headline: "CEE review unavailable",
      healthStatus: "risk",
      healthTone: "danger",
      hasHighRiskEnvelopes: false,
      hasTruncationSomewhere: false,
      hasTeamDisagreement: false,
      isJourneyComplete: false,
      missingEnvelopes: [],
      traceId: trace?.requestId,
      engineLabel: engineStatus
        ? `${engineStatus.provider ?? "-"} / ${engineStatus.model ?? "-"}`
        : undefined,
      errorCode: errorCode ?? null,
    };
  }

  const { story, journey, uiFlags } = review;

  return {
    title: context.decisionTitle,
    headline: story.headline,
    healthStatus: journey.health.overallStatus,
    healthTone: journey.health.overallTone,
    hasHighRiskEnvelopes: uiFlags.has_high_risk_envelopes,
    hasTruncationSomewhere: uiFlags.has_truncation_somewhere,
    hasTeamDisagreement: uiFlags.has_team_disagreement,
    isJourneyComplete: journey.is_complete,
    missingEnvelopes: journey.missing_envelopes,
    traceId: trace?.requestId,
    engineLabel: engineStatus
      ? `${engineStatus.provider ?? "-"} / ${engineStatus.model ?? "-"}`
      : undefined,
    errorCode: errorCode ?? null,
  };
}
