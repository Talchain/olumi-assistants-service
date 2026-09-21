/**
 * CEE Preference Answer Processor
 *
 * Processes user answers to preference questions and updates their preference profile.
 * Each answer incrementally refines the preference parameters.
 */

import type { PreferenceQuestionT, PreferenceQuestionTypeT, UserPreferencesT } from "../../schemas/cee.js";
import type { AnswerProcessingResult } from "./types.js";
import { DEFAULT_PREFERENCES } from "./types.js";

/**
 * Clamp a value to a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Get confidence level based on number of questions answered
 */
function getConfidenceLevel(questionsAnswered: number): "low" | "medium" | "high" {
  if (questionsAnswered >= 3) return "high";
  if (questionsAnswered >= 1) return "medium";
  return "low";
}

/**
 * Process a risk/reward answer
 * A = risky option (higher potential, uncertain)
 * B = certain option (lower, guaranteed)
 */
function processRiskRewardAnswer(
  answer: "A" | "B",
  current: UserPreferencesT
): { risk_aversion: number; impact: string } {
  if (answer === "A") {
    // Chose risky option → lower risk aversion
    return {
      risk_aversion: clamp(current.risk_aversion - 0.15, 0, 1),
      impact: "You prefer higher potential returns even with uncertainty.",
    };
  } else {
    // Chose certain option → higher risk aversion
    return {
      risk_aversion: clamp(current.risk_aversion + 0.15, 0, 1),
      impact: "You prefer certainty over potential upside.",
    };
  }
}

/**
 * Process a loss aversion answer
 * A = concerned about missing gains (opportunity cost)
 * B = concerned about direct losses
 */
function processLossAversionAnswer(
  answer: "A" | "B",
  current: UserPreferencesT
): { loss_aversion: number; impact: string } {
  if (answer === "A") {
    // More concerned about missing gains → lower loss aversion
    return {
      loss_aversion: clamp(current.loss_aversion - 0.2, 1, 3),
      impact: "You focus more on opportunities than avoiding losses.",
    };
  } else {
    // More concerned about direct losses → higher loss aversion
    return {
      loss_aversion: clamp(current.loss_aversion + 0.3, 1, 3),
      impact: "Losses weigh more heavily in your decisions.",
    };
  }
}

/**
 * Process a goal trade-off answer
 * Updates goal weights based on the chosen goal
 */
function processGoalTradeoffAnswer(
  answer: "A" | "B",
  question: PreferenceQuestionT,
  current: UserPreferencesT
): { goal_weights: Record<string, number>; impact: string } {
  const goalIds = question.context_node_ids || [];
  if (goalIds.length < 2) {
    return {
      goal_weights: current.goal_weights,
      impact: "Goal preferences recorded.",
    };
  }

  const [goalA, goalB] = goalIds;
  const updatedWeights = { ...current.goal_weights };

  // Initialise weights if not present
  if (updatedWeights[goalA] === undefined) updatedWeights[goalA] = 0.5;
  if (updatedWeights[goalB] === undefined) updatedWeights[goalB] = 0.5;

  const adjustmentAmount = 0.15;

  if (answer === "A") {
    // Prioritise goal A
    updatedWeights[goalA] = clamp(updatedWeights[goalA] + adjustmentAmount, 0, 1);
    updatedWeights[goalB] = clamp(updatedWeights[goalB] - adjustmentAmount, 0, 1);
    return {
      goal_weights: updatedWeights,
      impact: `You prioritise "${goalA}" over "${goalB}".`,
    };
  } else {
    // Prioritise goal B
    updatedWeights[goalB] = clamp(updatedWeights[goalB] + adjustmentAmount, 0, 1);
    updatedWeights[goalA] = clamp(updatedWeights[goalA] - adjustmentAmount, 0, 1);
    return {
      goal_weights: updatedWeights,
      impact: `You prioritise "${goalB}" over "${goalA}".`,
    };
  }
}

/**
 * Process a time preference answer
 * A = prefer now (smaller, immediate)
 * B = prefer later (larger, delayed)
 */
function processTimePreferenceAnswer(
  answer: "A" | "B",
  current: UserPreferencesT
): { time_discount: number; impact: string } {
  if (answer === "A") {
    // Prefer immediate → higher time discount
    return {
      time_discount: clamp(current.time_discount + 0.1, 0, 1),
      impact: "You value near-term results more highly.",
    };
  } else {
    // Prefer delayed → lower time discount
    return {
      time_discount: clamp(current.time_discount - 0.05, 0, 1),
      impact: "You're willing to wait for better outcomes.",
    };
  }
}

/**
 * Process a preference question answer and update preferences
 */
export function processAnswer(
  question: PreferenceQuestionT,
  answer: "A" | "B",
  currentPreferences?: UserPreferencesT
): AnswerProcessingResult {
  const current: UserPreferencesT = currentPreferences
    ? { ...currentPreferences, goal_weights: { ...currentPreferences.goal_weights } }
    : { ...DEFAULT_PREFERENCES, goal_weights: {} };

  let impact = "";

  switch (question.type) {
    case "risk_reward": {
      const result = processRiskRewardAnswer(answer, current);
      current.risk_aversion = result.risk_aversion;
      impact = result.impact;
      break;
    }
    case "loss_aversion": {
      const result = processLossAversionAnswer(answer, current);
      current.loss_aversion = result.loss_aversion;
      impact = result.impact;
      break;
    }
    case "goal_tradeoff": {
      const result = processGoalTradeoffAnswer(answer, question, current);
      current.goal_weights = result.goal_weights;
      impact = result.impact;
      break;
    }
    case "time_preference": {
      const result = processTimePreferenceAnswer(answer, current);
      current.time_discount = result.time_discount;
      impact = result.impact;
      break;
    }
    default: {
      impact = "Preference recorded.";
    }
  }

  // Update metadata
  current.derived_from = {
    questions_answered: (currentPreferences?.derived_from.questions_answered ?? 0) + 1,
    last_updated: new Date().toISOString(),
  };
  current.confidence = getConfidenceLevel(current.derived_from.questions_answered);

  return {
    updated: current,
    impact,
  };
}

/**
 * Generate a recommendation impact statement based on preference changes
 */
export function generateRecommendationImpact(
  oldPreferences: UserPreferencesT | undefined,
  newPreferences: UserPreferencesT,
  _questionType: PreferenceQuestionTypeT
): string {
  const changes: string[] = [];

  if (!oldPreferences) {
    return "Your preferences are now being used to personalise recommendations.";
  }

  // Check what changed
  const riskDelta = newPreferences.risk_aversion - oldPreferences.risk_aversion;
  const lossDelta = newPreferences.loss_aversion - oldPreferences.loss_aversion;
  const timeDelta = newPreferences.time_discount - oldPreferences.time_discount;

  if (Math.abs(riskDelta) > 0.01) {
    if (riskDelta > 0) {
      changes.push("safer options will now rank higher");
    } else {
      changes.push("higher-risk/higher-reward options will now rank higher");
    }
  }

  if (Math.abs(lossDelta) > 0.01) {
    if (lossDelta > 0) {
      changes.push("options that avoid potential losses will be prioritised");
    } else {
      changes.push("opportunity-focused options will be considered more favourably");
    }
  }

  if (Math.abs(timeDelta) > 0.01) {
    if (timeDelta > 0) {
      changes.push("near-term benefits will be weighted more heavily");
    } else {
      changes.push("long-term benefits will be valued more");
    }
  }

  if (changes.length === 0) {
    return "Recommendations refined based on your preference.";
  }

  return `Based on your answer, ${changes.join(" and ")}.`;
}

/**
 * Create default preferences for a new user
 */
export function createDefaultPreferences(): UserPreferencesT {
  return {
    ...DEFAULT_PREFERENCES,
    goal_weights: {},
    derived_from: {
      questions_answered: 0,
      last_updated: new Date().toISOString(),
    },
  };
}
