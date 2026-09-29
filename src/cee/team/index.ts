import type { components } from "../../generated/openapi.d.ts";
import {
  CEE_TEAM_DISAGREEMENT_MIN_PARTICIPANTS,
  CEE_TEAM_DISAGREEMENT_MIN_SCORE,
} from "../policy.js";

type CEETeamPerspectiveItemV1 = components["schemas"]["CEETeamPerspectiveItemV1"];
type CEETeamPerspectivesSummaryV1 = components["schemas"]["CEETeamPerspectivesSummaryV1"];

function getWeight(p: CEETeamPerspectiveItemV1): number {
  const w = (p as any).weight;
  // Only positive, finite explicit weights contribute to weighted sums. When no
  // weight is provided, fall back to an unweighted contribution of 1 so that
  // the common case (no weights) behaves intuitively.
  if (typeof w === "number") {
    if (Number.isFinite(w) && w > 0) return w;
    // Explicit non-positive or non-finite weights have no influence.
    return 0;
  }

  // No explicit weight: treat as 1 for weighting purposes.
  return 1;
}

/**
 * Summarise team perspectives into counts, weighted support, and disagreement score.
 *
 * Heuristics are simple and deterministic, using only stances, weights, and
 * optional self-reported confidences. No free text or identities are used.
 */
export function summariseTeam(
  perspectives: CEETeamPerspectiveItemV1[],
): CEETeamPerspectivesSummaryV1 {
  const participantCount = perspectives.length;

  let forCount = 0;
  let againstCount = 0;
  let neutralCount = 0;

  let weightFor = 0;
  let weightAgainst = 0;
  let weightNeutral = 0;

  for (const p of perspectives) {
    const stance = (p as any).stance as string;
    const weight = getWeight(p);

    if (stance === "for") {
      forCount += 1;
      weightFor += weight;
    } else if (stance === "against") {
      againstCount += 1;
      weightAgainst += weight;
    } else {
      neutralCount += 1;
      weightNeutral += weight;
    }
  }

  const totalWeight = weightFor + weightAgainst + weightNeutral;
  const safeTotalWeight = totalWeight > 0 ? totalWeight : participantCount || 1;

  const weightedForFraction = safeTotalWeight > 0 ? weightFor / safeTotalWeight : 0;

  const forFrac = safeTotalWeight > 0 ? weightFor / safeTotalWeight : 0;
  const againstFrac = safeTotalWeight > 0 ? weightAgainst / safeTotalWeight : 0;
  const neutralFrac = safeTotalWeight > 0 ? weightNeutral / safeTotalWeight : 0;
  const maxFrac = Math.max(forFrac, againstFrac, neutralFrac);

  let disagreementScore = 1 - maxFrac;
  if (!Number.isFinite(disagreementScore)) {
    disagreementScore = 0;
  }
  if (disagreementScore < 0) disagreementScore = 0;
  if (disagreementScore > 1) disagreementScore = 1;

  const hasTeamDisagreement =
    participantCount >= CEE_TEAM_DISAGREEMENT_MIN_PARTICIPANTS &&
    disagreementScore >= CEE_TEAM_DISAGREEMENT_MIN_SCORE;

  return {
    participant_count: participantCount,
    for_count: forCount,
    against_count: againstCount,
    neutral_count: neutralCount,
    weighted_for_fraction: weightedForFraction,
    disagreement_score: disagreementScore,
    has_team_disagreement: hasTeamDisagreement,
  } as CEETeamPerspectivesSummaryV1;
}
