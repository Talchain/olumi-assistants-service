/**
 * CEE Preference Contextual Framer
 *
 * Frames preference questions using the user's actual decision context,
 * making questions more relevant and easier to answer.
 */

import type { PreferenceQuestionT, PreferenceOptionT } from "../../schemas/cee.js";
import type { QuestionContext } from "./types.js";

/**
 * Frame a question in the context of the user's decision
 */
export function frameQuestionInContext(
  question: PreferenceQuestionT,
  graphContext: QuestionContext
): PreferenceQuestionT {
  const framed: PreferenceQuestionT = {
    ...question,
    options: question.options.map((opt) => ({ ...opt })),
  };

  // Add decision context to the question if available
  if (graphContext.decisionLabel) {
    framed.question = `For your decision about ${graphContext.decisionLabel}: ${question.question}`;
  }

  // Contextualise goal trade-off questions with actual goal labels
  if (question.type === "goal_tradeoff" && question.context_node_ids) {
    const [goalAId, goalBId] = question.context_node_ids;
    const goalALabel = graphContext.goalLabels.get(goalAId);
    const goalBLabel = graphContext.goalLabels.get(goalBId);

    if (goalALabel && goalBLabel) {
      framed.options = [
        {
          ...framed.options[0],
          label: `Optimise for: ${goalALabel}`,
        },
        {
          ...framed.options[1],
          label: `Optimise for: ${goalBLabel}`,
        },
      ];
    }
  }

  return framed;
}

/**
 * Frame multiple questions for the given context
 */
export function frameQuestionsInContext(
  questions: PreferenceQuestionT[],
  graphContext: QuestionContext
): PreferenceQuestionT[] {
  return questions.map((q) => frameQuestionInContext(q, graphContext));
}

/**
 * Build question context from graph data
 */
export function buildQuestionContext(
  goalIds: string[],
  goalLabels: string[],
  optionIds: string[],
  optionLabels: string[],
  decisionScale: number,
  decisionLabel?: string
): QuestionContext {
  const goalLabelsMap = new Map<string, string>();
  for (let i = 0; i < goalIds.length && i < goalLabels.length; i++) {
    goalLabelsMap.set(goalIds[i], goalLabels[i]);
  }

  const optionLabelsMap = new Map<string, string>();
  for (let i = 0; i < optionIds.length && i < optionLabels.length; i++) {
    optionLabelsMap.set(optionIds[i], optionLabels[i]);
  }

  return {
    goalLabels: goalLabelsMap,
    optionLabels: optionLabelsMap,
    decisionScale,
    decisionLabel,
  };
}

/**
 * Extract decision scale from options (estimate magnitude of decision)
 */
export function estimateDecisionScale(
  options: Array<{ expected_value?: number; risk_level?: number }>
): number {
  // Try to infer scale from option expected values
  const values = options
    .map((o) => o.expected_value)
    .filter((v): v is number => v !== undefined);

  if (values.length > 0) {
    // Use the maximum expected value as a proxy for decision scale
    return Math.max(...values);
  }

  // Default to a moderate decision scale
  return 10000;
}

/**
 * Create a contextualised intro for the preference questions
 */
export function generateQuestionIntro(
  decisionLabel?: string,
  questionsCount: number = 1
): string {
  const plural = questionsCount > 1 ? "questions" : "question";

  if (decisionLabel) {
    return `To better understand your preferences for the "${decisionLabel}" decision, please answer ${questionsCount === 1 ? "this" : "these"} ${plural}:`;
  }

  return `To personalise recommendations, please answer ${questionsCount === 1 ? "this" : "these"} quick ${plural}:`;
}
