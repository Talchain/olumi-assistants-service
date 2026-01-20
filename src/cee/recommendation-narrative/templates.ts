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
  GenerateRecommendationInput,
} from "./types.js";

// Confidence thresholds
const HIGH_SCORE_GAP = 15; // Clear winner
const MEDIUM_SCORE_GAP = 5; // Moderate advantage

// Goal context extraction settings
const MAX_GOAL_CONTEXT_LENGTH = 50;

// =============================================================================
// Goal Context Extraction
// =============================================================================

/**
 * Extract a concise goal context from the user's brief.
 * Looks for patterns like "to achieve X", "for Y", "goal is Z".
 * Falls back to first sentence, truncated to ~50 chars.
 */
export function extractGoalContext(brief: string | undefined, goalLabel: string | undefined): string | undefined {
  // Prefer explicit goal label if provided
  if (goalLabel) {
    return truncateContext(sanitiseLabel(goalLabel));
  }

  if (!brief || brief.trim().length === 0) {
    return undefined;
  }

  const normalised = brief.trim();

  // Pattern 1: "to achieve X" / "to maximize X" / "to improve X"
  const achieveMatch = normalised.match(/\bto\s+(achieve|maximize|maximise|improve|increase|reduce|minimize|minimise|ensure|optimize|optimise)\s+([^.,;]+)/i);
  if (achieveMatch?.[2]) {
    return truncateContext(sanitiseLabel(achieveMatch[2].trim()));
  }

  // Pattern 2: "goal is X" / "objective is X" / "aim is X"
  const goalMatch = normalised.match(/\b(goal|objective|aim|target)\s+(?:is|:)\s*([^.,;]+)/i);
  if (goalMatch?.[2]) {
    return truncateContext(sanitiseLabel(goalMatch[2].trim()));
  }

  // Pattern 3: "for X" at end of first sentence
  const forMatch = normalised.match(/\bfor\s+([^.,;]+)(?:\.|,|;|$)/i);
  if (forMatch?.[1] && forMatch[1].split(/\s+/).length <= 8) {
    return truncateContext(sanitiseLabel(forMatch[1].trim()));
  }

  // Pattern 4: "deciding whether to X" / "decision about X"
  const decisionMatch = normalised.match(/\b(?:deciding|decision)\s+(?:whether\s+to|about|on)\s+([^.,;]+)/i);
  if (decisionMatch?.[1]) {
    return truncateContext(sanitiseLabel(decisionMatch[1].trim()));
  }

  // Fallback: No clear goal pattern found
  return undefined;
}

/**
 * Truncate context to max length, adding ellipsis if needed.
 */
function truncateContext(text: string): string {
  if (text.length <= MAX_GOAL_CONTEXT_LENGTH) {
    return text;
  }
  // Try to break at word boundary
  const truncated = text.slice(0, MAX_GOAL_CONTEXT_LENGTH - 3);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > MAX_GOAL_CONTEXT_LENGTH * 0.6) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

// =============================================================================
// Driver Impact Templates
// =============================================================================

/**
 * Generate a "why" explanation including driver impact.
 */
export function generateWhyExplanation(
  winner: RankedAction,
  drivers: GenerateRecommendationInput["drivers"],
  goalLabel: string | undefined,
): string | undefined {
  if (!drivers || drivers.length === 0) {
    return undefined;
  }

  const topDriver = drivers[0];
  const driverLabel = sanitiseLabel(topDriver.label);

  // Build impact phrase
  let impactPhrase = "";
  if (topDriver.impact_pct !== undefined && topDriver.impact_pct > 0) {
    impactPhrase = ` (${Math.round(topDriver.impact_pct)}% of the decision)`;
  }

  // Build direction phrase
  let directionPhrase = "positively influences";
  if (topDriver.direction === "negative") {
    directionPhrase = "significantly affects";
  }

  // With goal context
  if (goalLabel) {
    return `${labelForDisplay(winner.label)} ${directionPhrase} ${driverLabel}${impactPhrase}, which is the key factor for achieving ${sanitiseLabel(goalLabel)}.`;
  }

  // Without goal context
  return `${labelForDisplay(winner.label)} ${directionPhrase} ${driverLabel}${impactPhrase}, which is the most influential factor in this decision.`;
}

/**
 * Patterns that indicate a baseline/status quo option.
 * These should be framed as "maintaining current state" rather than "negative impact".
 */
const BASELINE_PATTERNS = [
  /^(do\s+)?nothing$/i,
  /^no\s+action$/i,
  /^status\s+quo$/i,
  /^keep\s+(current|existing)/i,
  /^maintain\s+(current|existing)/i,
  /^stay\s+(the\s+)?(course|same)/i,
  /^current\s+(state|approach|strategy)/i,
  /^don't\s+change/i,
  /^wait(\s+and\s+see)?$/i,
  /^defer\s+decision/i,
  /^hold\s+(off|steady)/i,
];

/**
 * Check if an option label represents a baseline/status quo choice.
 */
function isBaselineOption(label: string): boolean {
  const normalised = label.trim().toLowerCase();
  return BASELINE_PATTERNS.some((pattern) => pattern.test(normalised));
}

/**
 * Reframe baseline option label for more neutral phrasing.
 * "Do nothing" → "Maintaining current state"
 * "Status quo" → "Current approach"
 */
function reframeBaselineLabel(label: string): string {
  const lower = label.toLowerCase().trim();

  if (/^(do\s+)?nothing$/i.test(lower)) {
    return "maintaining current state";
  }
  if (/^no\s+action$/i.test(lower)) {
    return "deferring action";
  }
  if (/^status\s+quo$/i.test(lower)) {
    return "the current approach";
  }
  if (/^wait(\s+and\s+see)?$/i.test(lower)) {
    return "waiting for more information";
  }

  // Return original if no specific reframe
  return sanitiseLabel(label);
}

/**
 * Generate a headline for the recommendation.
 *
 * IMPORTANT: Checks outcome_quality to avoid contradictory messaging.
 * If outcome is negative, uses cautionary phrasing instead of recommending.
 * Baseline options (do nothing, status quo) are reframed neutrally.
 *
 * @param winner - The winning ranked action
 * @param runnerUp - The second-place option (if any)
 * @param tone - "formal" or "conversational"
 * @param goalContext - Optional goal context extracted from brief (e.g., "maximizing Q4 revenue")
 * @param confidence - Optional confidence level for inclusion in headline
 */
export function generateHeadline(
  winner: RankedAction,
  runnerUp: RankedAction | undefined,
  tone: Tone,
  goalContext?: string,
  confidence?: Confidence,
): string {
  // Check if winner is a baseline option - use neutral reframing
  const winnerIsBaseline = isBaselineOption(winner.label);
  const winnerLabel = winnerIsBaseline
    ? capitaliseFirst(reframeBaselineLabel(winner.label))
    : labelForDisplay(winner.label);

  const scoreGap = runnerUp ? winner.score - runnerUp.score : 100;

  // Build goal phrase if context available
  const goalPhrase = goalContext ? ` for ${goalContext}` : "";

  // Build confidence phrase if available
  const confidencePhrase = confidence
    ? ` with ${confidence} confidence`
    : "";

  // Special handling for baseline winners - avoid negative framing
  if (winnerIsBaseline) {
    return generateBaselineHeadline(winnerLabel, runnerUp, scoreGap, tone, goalPhrase, confidencePhrase);
  }

  // Check for negative outcome - avoid recommending options with poor expected results
  if (winner.outcome_quality === "negative") {
    return generateNegativeOutcomeHeadline(winnerLabel, runnerUp, scoreGap, tone, goalPhrase);
  }

  // Check for mixed outcomes with risks
  if (winner.outcome_quality === "mixed" || winner.has_risks) {
    return generateCautiousHeadline(winnerLabel, runnerUp, scoreGap, tone, goalPhrase);
  }

  // Standard positive/neutral outcome handling with context
  if (scoreGap >= HIGH_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} is recommended${goalPhrase}${confidencePhrase}`
      : `${winnerLabel} is your best bet${goalPhrase}${confidencePhrase}`;
  }

  if (scoreGap >= MEDIUM_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} emerges as the stronger option${goalPhrase}${confidencePhrase}`
      : `${winnerLabel} looks like the better choice${goalPhrase}${confidencePhrase}`;
  }

  // Close call
  return tone === "formal"
    ? `${winnerLabel} holds a slight advantage${goalPhrase}${confidencePhrase}`
    : `${winnerLabel} edges ahead${goalPhrase}, but it's close`;
}

/**
 * Capitalise first letter of a string.
 */
function capitaliseFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generate headline when winner is a baseline/status quo option.
 * Frames as "maintaining current state is advisable" rather than "do nothing has impact".
 */
function generateBaselineHeadline(
  winnerLabel: string,
  runnerUp: RankedAction | undefined,
  scoreGap: number,
  tone: Tone,
  goalPhrase: string = "",
  confidencePhrase: string = "",
): string {
  if (scoreGap >= HIGH_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} is the recommended approach${goalPhrase}${confidencePhrase}`
      : `${winnerLabel} is your best move${goalPhrase}${confidencePhrase}`;
  }

  if (scoreGap >= MEDIUM_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} is advisable${goalPhrase}${confidencePhrase}`
      : `${winnerLabel} makes sense for now${goalPhrase}${confidencePhrase}`;
  }

  // Close call - suggest waiting may be appropriate
  const runnerUpLabel = runnerUp ? labelForDisplay(runnerUp.label) : "";
  return tone === "formal"
    ? `${winnerLabel} is marginally preferred to ${runnerUpLabel}${goalPhrase}`
    : `${winnerLabel} slightly edges out ${runnerUpLabel}${goalPhrase}`;
}

/**
 * Generate headline when winner has negative expected outcome.
 * Avoids contradictory "proceed with X" when X leads to bad results.
 */
function generateNegativeOutcomeHeadline(
  winnerLabel: string,
  runnerUp: RankedAction | undefined,
  scoreGap: number,
  tone: Tone,
  goalPhrase: string = "",
): string {
  if (!runnerUp) {
    return tone === "formal"
      ? `${winnerLabel} is the only option${goalPhrase}, though outcomes carry risk`
      : `${winnerLabel} is your only option${goalPhrase}, but expect some challenges`;
  }

  if (scoreGap >= HIGH_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} minimises negative impact${goalPhrase} compared to alternatives`
      : `${winnerLabel} is the least bad option here${goalPhrase}`;
  }

  if (scoreGap >= MEDIUM_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} offers relatively better outcomes${goalPhrase} despite risks`
      : `${winnerLabel} looks better than the alternatives${goalPhrase}, though neither is great`;
  }

  return tone === "formal"
    ? `${winnerLabel} and alternatives both carry significant risk${goalPhrase}`
    : `${winnerLabel} edges ahead${goalPhrase}, but all options have downsides`;
}

/**
 * Generate headline when winner has mixed outcomes or known risks.
 * Uses cautionary phrasing with plain English trade-off descriptions.
 */
function generateCautiousHeadline(
  winnerLabel: string,
  runnerUp: RankedAction | undefined,
  scoreGap: number,
  tone: Tone,
  goalPhrase: string = "",
): string {
  if (scoreGap >= HIGH_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} is recommended${goalPhrase}, though outcomes are less predictable`
      : `${winnerLabel} is your best bet${goalPhrase}, but expect some ups and downs`;
  }

  if (scoreGap >= MEDIUM_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerLabel} emerges as the stronger option${goalPhrase} with higher potential but less certainty`
      : `${winnerLabel} looks better${goalPhrase}—more upside potential, though less predictable`;
  }

  const runnerUpLabel = runnerUp ? labelForDisplay(runnerUp.label) : "";
  return tone === "formal"
    ? `${winnerLabel} holds a slight advantage${goalPhrase}; both options balance reward against predictability`
    : `${winnerLabel} edges ahead of ${runnerUpLabel}${goalPhrase}—both have pros and cons to weigh`;
}

/**
 * Generate the main recommendation narrative.
 *
 * Handles negative outcomes by using cautionary language.
 * Baseline options are reframed neutrally.
 */
export function generateNarrative(
  winner: RankedAction,
  runnerUp: RankedAction | undefined,
  goalLabel: string | undefined,
  tone: Tone,
): string {
  // Check if winner is a baseline option - use neutral reframing
  const winnerIsBaseline = isBaselineOption(winner.label);
  const winnerAction = winnerIsBaseline
    ? capitaliseFirst(reframeBaselineLabel(winner.label))
    : labelForSentence(winner.label, "subject");

  const goalPhrase = goalLabel
    ? ` toward ${sanitiseLabel(goalLabel)}`
    : "";

  // Handle baseline options with neutral framing
  if (winnerIsBaseline) {
    return generateBaselineNarrative(winnerAction, runnerUp, goalPhrase, tone);
  }

  // Handle negative outcomes with appropriate caution
  if (winner.outcome_quality === "negative") {
    return generateNegativeOutcomeNarrative(winnerAction, runnerUp, goalPhrase, tone);
  }

  if (!runnerUp) {
    return tone === "formal"
      ? `${winnerAction} represents the optimal path${goalPhrase}. With no competing alternatives, this option provides a clear direction for decision-making.`
      : `${winnerAction} is the way to go${goalPhrase}. Since there's only one option on the table, the choice is straightforward.`;
  }

  const runnerUpLabel = sanitiseLabel(runnerUp.label);
  const scoreGap = winner.score - runnerUp.score;

  // Handle mixed outcomes
  if (winner.outcome_quality === "mixed" || winner.has_risks) {
    return generateCautiousNarrative(winnerAction, runnerUpLabel, scoreGap, goalPhrase, tone);
  }

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
 * Generate narrative when winner has negative expected outcome.
 */
function generateNegativeOutcomeNarrative(
  winnerAction: string,
  runnerUp: RankedAction | undefined,
  goalPhrase: string,
  tone: Tone,
): string {
  if (!runnerUp) {
    return tone === "formal"
      ? `${winnerAction} is the only available option${goalPhrase}, though the analysis indicates challenging outcomes. Proceed with awareness of the risks involved.`
      : `${winnerAction} is your only option${goalPhrase}, but don't expect smooth sailing. Keep the risks in mind.`;
  }

  const runnerUpLabel = sanitiseLabel(runnerUp.label);
  return tone === "formal"
    ? `${winnerAction} presents fewer downsides than ${runnerUpLabel}${goalPhrase}. While neither option shows strongly positive outcomes, this choice minimises potential negative impact.`
    : `${winnerAction} is the better of two tough choices compared to ${runnerUpLabel}${goalPhrase}. Neither is great, but this one hurts less.`;
}

/**
 * Generate narrative when winner has mixed outcomes or risks.
 * Uses plain English to explain trade-offs between options.
 */
function generateCautiousNarrative(
  winnerAction: string,
  runnerUpLabel: string,
  scoreGap: number,
  goalPhrase: string,
  tone: Tone,
): string {
  if (scoreGap >= HIGH_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerAction} outperforms ${runnerUpLabel}${goalPhrase}. It offers higher potential reward but comes with less predictable outcomes. The analysis favors this direction while acknowledging the uncertainty.`
      : `${winnerAction} beats ${runnerUpLabel}${goalPhrase}. More upside potential here, but the path is less predictable.`;
  }

  if (scoreGap >= MEDIUM_SCORE_GAP) {
    return tone === "formal"
      ? `${winnerAction} shows advantages over ${runnerUpLabel}${goalPhrase}. While both options balance reward against predictability, this one offers a better overall profile.`
      : `${winnerAction} has the edge over ${runnerUpLabel}${goalPhrase}. Better upside, even accounting for the bumpier ride.`;
  }

  return tone === "formal"
    ? `${winnerAction} and ${runnerUpLabel} are closely matched${goalPhrase}. Each balances potential reward against predictability differently—${winnerAction} offers slightly more upside but ${runnerUpLabel} provides steadier outcomes.`
    : `${winnerAction} and ${runnerUpLabel} are neck and neck${goalPhrase}. One's got more upside potential, the other's more predictable—your call.`;
}

/**
 * Generate narrative when winner is a baseline/status quo option.
 * Uses neutral framing: "maintaining current state preserves value" rather than
 * "do nothing has negative impact".
 */
function generateBaselineNarrative(
  winnerAction: string,
  runnerUp: RankedAction | undefined,
  goalPhrase: string,
  tone: Tone,
): string {
  if (!runnerUp) {
    return tone === "formal"
      ? `${winnerAction} represents a stable path${goalPhrase}. Without alternative options requiring change, continuing current operations is appropriate.`
      : `${winnerAction} keeps things steady${goalPhrase}. No pressing reason to change course here.`;
  }

  const runnerUpLabel = sanitiseLabel(runnerUp.label);

  return tone === "formal"
    ? `${winnerAction} is advisable compared to ${runnerUpLabel}${goalPhrase}. The analysis suggests that preserving the current approach offers better value than the proposed changes.`
    : `${winnerAction} beats ${runnerUpLabel}${goalPhrase}. Sometimes not rocking the boat is the smart move.`;
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
