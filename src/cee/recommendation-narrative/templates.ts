/**
 * CEE Recommendation Narrative Templates
 *
 * Template-based prose generation for recommendation narratives.
 * Uses sanitiseLabel() for clean, question-mark-free output.
 */

import { labelForDisplay, labelForSentence, sanitiseLabel } from "../../utils/label-sanitiser.js";
import type {
  Tone,
  Confidence,
  RankedAction,
  Condition,
  PolicyStep,
} from "./types.js";

// Confidence thresholds
const HIGH_SCORE_GAP = 15; // Clear winner
const MEDIUM_SCORE_GAP = 5; // Moderate advantage

/**
 * Generate a headline for the recommendation.
 */
export function generateHeadline(
  winner: RankedAction,
  runnerUp: RankedAction | undefined,
  tone: Tone,
): string {
  const winnerLabel = labelForDisplay(winner.label);
  const scoreGap = runnerUp ? winner.score - runnerUp.score : 100;

  if (scoreGap >= HIGH_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} is the recommended course of action`
      : `${winnerLabel} is your best bet`;
  }

  if (scoreGap >= MEDIUM_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} emerges as the stronger option`
      : `${winnerLabel} looks like the better choice`;
  }

  // Close call
  return tone === "formal"
    ? `${winnerLabel} holds a slight advantage`
    : `${winnerLabel} edges ahead, but it's close`;
}

/**
 * Generate the main recommendation narrative.
 */
export function generateNarrative(
  winner: RankedAction,
  runnerUp: RankedAction | undefined,
  goalLabel: string | undefined,
  tone: Tone,
): string {
  const winnerAction = labelForSentence(winner.label, "subject");
  const goalPhrase = goalLabel
    ? ` toward ${sanitiseLabel(goalLabel)}`
    : "";

  if (!runnerUp) {
    return tone === "formal"
      ? `${winnerAction} represents the optimal path${goalPhrase}. With no competing alternatives, this option provides a clear direction for decision-making.`
      : `${winnerAction} is the way to go${goalPhrase}. Since there's only one option on the table, the choice is straightforward.`;
  }

  const runnerUpLabel = sanitiseLabel(runnerUp.label);
  const scoreGap = winner.score - runnerUp.score;

  if (scoreGap >= HIGH_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerAction} significantly outperforms ${runnerUpLabel}${goalPhrase}. The analysis indicates a substantial advantage, making this the clear recommendation.`
      : `${winnerAction} beats ${runnerUpLabel} by a wide margin${goalPhrase}. This one's not a close call.`;
  }

  if (scoreGap >= MEDIUM_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerAction} demonstrates meaningful advantages over ${runnerUpLabel}${goalPhrase}. While differences exist, the evidence favors this direction.`
      : `${winnerAction} has the edge over ${runnerUpLabel}${goalPhrase}. The gap is real, though not enormous.`;
  }

  // Close call
  return tone === "formal"
    ? `${winnerAction} and ${runnerUpLabel} present comparable value${goalPhrase}. The margin between them is narrow, warranting careful consideration of contextual factors.`
    : `${winnerAction} and ${runnerUpLabel} are neck and neck${goalPhrase}. You'll want to think carefully here.`;
}

/**
 * Generate a confidence statement based on score distribution.
 */
export function generateConfidenceStatement(
  winner: RankedAction,
  actions: RankedAction[],
  tone: Tone,
): { statement: string; confidence: Confidence } {
  if (actions.length <= 1) {
    return {
      statement: tone === "formal"
        ? "Limited options constrain confidence assessment. A single alternative provides no basis for comparative evaluation."
        : "Hard to be confident with only one option to consider.",
      confidence: "low",
    };
  }

  const sorted = [...actions].sort((a, b) => b.score - a.score);
  const topScore = sorted[0].score;
  const secondScore = sorted[1]?.score ?? 0;
  const gap = topScore - secondScore;

  if (gap >= HIGH_SCORE_GAP && topScore >= 70) {
    return {
      statement: tone === "formal"
        ? "High confidence in this recommendation. The analysis shows a decisive advantage with strong supporting evidence."
        : "This recommendation comes with high confidence. The winner stands out clearly.",
      confidence: "high",
    };
  }

  if (gap >= MEDIUM_SCORE_GAP && topScore >= 50) {
    return {
      statement: tone === "formal"
        ? "Moderate confidence in this recommendation. The leading option shows meaningful advantages, though some uncertainty remains."
        : "Medium confidence here. The top choice has real advantages, but it's not a slam dunk.",
      confidence: "medium",
    };
  }

  return {
    statement: tone === "formal"
      ? "Lower confidence in this recommendation. The alternatives are closely matched, suggesting additional analysis may be valuable."
      : "Lower confidence on this one. The options are pretty close together, so you might want to dig deeper.",
    confidence: "low",
  };
}

/**
 * Generate a summary of alternative options.
 */
export function generateAlternativesSummary(
  actions: RankedAction[],
  tone: Tone,
): string | undefined {
  if (actions.length <= 1) {
    return undefined;
  }

  const sorted = [...actions].sort((a, b) => b.score - a.score);
  const alternatives = sorted.slice(1);

  if (alternatives.length === 1) {
    const alt = labelForDisplay(alternatives[0].label);
    return tone === "formal"
      ? `The alternative considered was ${alt}, which scored ${alternatives[0].score} points.`
      : `The other option was ${alt}, scoring ${alternatives[0].score}.`;
  }

  const altLabels = alternatives.map((a) => labelForDisplay(a.label));
  const lastAlt = altLabels.pop();

  return tone === "formal"
    ? `Alternatives considered include ${altLabels.join(", ")} and ${lastAlt}.`
    : `Other options were ${altLabels.join(", ")} and ${lastAlt}.`;
}

/**
 * Generate a caveat for close-call situations.
 */
export function generateCaveat(
  winner: RankedAction,
  runnerUp: RankedAction | undefined,
  tone: Tone,
): string | undefined {
  if (!runnerUp) {
    return undefined;
  }

  const gap = winner.score - runnerUp.score;

  if (gap >= MEDIUM_SCORE_GAP) {
    return undefined; // No caveat needed for clear winners
  }

  const runnerUpLabel = labelForDisplay(runnerUp.label);

  return tone === "formal"
    ? `Note: ${runnerUpLabel} remains a viable alternative. Small changes in assumptions could shift the recommendation.`
    : `Heads up: ${runnerUpLabel} is still a solid option. Things could shift if your assumptions change.`;
}

/**
 * Generate a conditional narrative from conditions.
 */
export function generateConditionalNarrative(
  conditions: Condition[],
  primaryRecommendation: string | undefined,
): string {
  if (conditions.length === 0) {
    return primaryRecommendation
      ? `The recommendation is to ${sanitiseLabel(primaryRecommendation)}.`
      : "No conditional logic to narrate.";
  }

  const parts: string[] = [];

  // Start with primary recommendation if provided
  if (primaryRecommendation) {
    parts.push(
      `The primary recommendation is to ${sanitiseLabel(primaryRecommendation)}.`,
    );
  }

  // Build conditional statements
  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i];
    const conditionText = sanitiseLabel(cond.condition_label);
    const ifTrueAction = sanitiseLabel(cond.if_true.recommendation);
    const ifFalseAction = sanitiseLabel(cond.if_false.recommendation);

    if (i === 0) {
      parts.push(
        `If ${conditionText}, then ${ifTrueAction}. Otherwise, ${ifFalseAction}.`,
      );
    } else {
      parts.push(
        `Additionally, if ${conditionText}, then ${ifTrueAction}; otherwise, ${ifFalseAction}.`,
      );
    }
  }

  return parts.join(" ");
}

/**
 * Generate key decision points from conditions.
 */
export function extractKeyDecisionPoints(conditions: Condition[]): string[] {
  return conditions.map((cond) => labelForDisplay(cond.condition_label));
}

/**
 * Generate a policy narrative from sequential steps.
 */
export function generatePolicyNarrative(
  steps: PolicyStep[],
  goalLabel: string | undefined,
): string {
  if (steps.length === 0) {
    return "No policy steps to explain.";
  }

  const sorted = [...steps].sort((a, b) => a.step_number - b.step_number);
  const parts: string[] = [];

  // Opening
  if (goalLabel) {
    parts.push(`To achieve ${sanitiseLabel(goalLabel)}, follow this sequence:`);
  } else {
    parts.push("Follow this sequence of actions:");
  }

  // Steps
  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];
    const action = labelForDisplay(step.action);
    const connector = getSequenceConnector(i, sorted.length);

    parts.push(`${connector}, ${action.toLowerCase()}.`);
  }

  return parts.join(" ");
}

/**
 * Get sequence connector word (First, Then, Next, Finally).
 */
function getSequenceConnector(index: number, total: number): string {
  if (index === 0) return "First";
  if (index === total - 1) return "Finally";
  if (index === 1) return "Then";
  return "Next";
}

/**
 * Generate step explanations with rationales.
 */
export function generateStepExplanations(
  steps: PolicyStep[],
): Array<{ step: number; action: string; explanation: string }> {
  const sorted = [...steps].sort((a, b) => a.step_number - b.step_number);

  return sorted.map((step, index) => {
    const action = labelForDisplay(step.action);
    let explanation: string;

    if (step.rationale) {
      explanation = step.rationale;
    } else if (step.depends_on && step.depends_on.length > 0) {
      explanation = `This step follows from the previous actions and prepares the groundwork for what comes next.`;
    } else if (index === 0) {
      explanation = `This is the starting point of the policy.`;
    } else if (index === sorted.length - 1) {
      explanation = `This final step completes the policy execution.`;
    } else {
      explanation = `This intermediate step builds on prior actions.`;
    }

    return {
      step: step.step_number,
      action,
      explanation,
    };
  });
}

/**
 * Generate dependencies explanation if steps have dependencies.
 */
export function generateDependenciesExplanation(
  steps: PolicyStep[],
): string | undefined {
  const stepsWithDeps = steps.filter(
    (s) => s.depends_on && s.depends_on.length > 0,
  );

  if (stepsWithDeps.length === 0) {
    return undefined;
  }

  const depCount = stepsWithDeps.length;
  const totalSteps = steps.length;

  if (depCount === totalSteps - 1) {
    return "Each step builds directly on the previous one, creating a strictly sequential flow.";
  }

  if (depCount === 1) {
    return "One step has explicit dependencies on prior actions.";
  }

  return `${depCount} of ${totalSteps} steps have explicit dependencies on prior actions.`;
}
