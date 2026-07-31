/**
 * CEE Recommendation Narrative Templates
 *
 * Template-based prose generation for the two ACTIVE narrative routes —
 * `/assist/v1/narrate-conditions` and `/assist/v1/explain-policy`.
 * Uses sanitiseLabel() for clean, question-mark-free output.
 *
 * ROADMAP 2.213 (no-recommendations doctrine): the generate-recommendation
 * template family that used to live above this point was DELETED with the
 * `/assist/v1/generate-recommendation` route it served. Those templates
 * crowned a winner in the advisory register ("{X} is your best bet", "{X}
 * is the way to go", "{X} is advisable"); the route had no caller in UI
 * `src/**` or CEE `src/**`, and its own egress-guard note recorded it as
 * dead pending the V4 retirement decision. The surviving templates state
 * conditions and policy steps supplied by the caller; they crown nothing.
 */

import { labelForDisplay, sanitiseLabel } from "../../utils/label-sanitiser.js";
import type {
  Condition,
  PolicyStep,
} from "./types.js";

/**
 * Generate a conditional narrative from conditions.
 *
 * The `primaryRecommendation` parameter name is the wire-level input field
 * (`primary_recommendation` on the route request body). Surface copy uses
 * neutral framing — "primary action" / "primary outcome" — so the
 * user-facing string contains no banned token.
 */
export function generateConditionalNarrative(
  conditions: Condition[],
  primaryRecommendation: string | undefined,
): string {
  if (conditions.length === 0) {
    return primaryRecommendation
      ? `The primary action is to ${sanitiseLabel(primaryRecommendation)}.`
      : "No conditional logic to narrate.";
  }

  const parts: string[] = [];

  // Start with primary action if provided
  if (primaryRecommendation) {
    parts.push(
      `The primary action is to ${sanitiseLabel(primaryRecommendation)}.`,
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
