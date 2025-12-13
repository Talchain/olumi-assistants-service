/**
 * CEE Preference Question Selector
 *
 * Selects preference questions to maximise information gain about user preferences.
 * Uses uncertainty-based prioritisation to ask the most valuable questions first.
 */

import type { PreferenceQuestionT, PreferenceQuestionTypeT, UserPreferencesT } from "../../schemas/cee.js";
import type { SelectionContext, ScoredQuestion, QuestionContext } from "./types.js";
import { generateAllQuestions, generateRefinedRiskQuestion } from "./question-generator.js";

/**
 * Calculate the uncertainty for a given preference dimension
 * Higher uncertainty = more information gain potential
 */
function getUncertaintyForType(
  type: PreferenceQuestionTypeT,
  preferences: UserPreferencesT
): number {
  switch (type) {
    case "risk_reward": {
      // Uncertainty is highest near 0.5 (neutral), lower at extremes
      const deviation = Math.abs(preferences.risk_aversion - 0.5);
      // If we've answered few questions, uncertainty is still high
      const answerBonus = preferences.derived_from.questions_answered < 2 ? 0.3 : 0;
      return Math.max(0.2, 1 - deviation * 1.5) + answerBonus;
    }
    case "loss_aversion": {
      // Loss aversion typically ranges 1-3, neutral at 1.5
      const deviation = Math.abs(preferences.loss_aversion - 1.5) / 1.5;
      const answerBonus = preferences.derived_from.questions_answered < 2 ? 0.3 : 0;
      return Math.max(0.2, 1 - deviation) + answerBonus;
    }
    case "goal_tradeoff": {
      // High uncertainty if we have few goal weights defined
      const weightCount = Object.keys(preferences.goal_weights).length;
      return weightCount === 0 ? 1.0 : Math.max(0.3, 1 - weightCount * 0.2);
    }
    case "time_preference": {
      // Uncertainty based on how extreme the time discount is
      const deviation = Math.abs(preferences.time_discount - 0.1);
      const answerBonus = preferences.derived_from.questions_answered < 3 ? 0.2 : 0;
      return Math.max(0.2, 1 - deviation * 2) + answerBonus;
    }
    default:
      return 0.5;
  }
}

/**
 * Calculate information gain score for a question
 */
function calculateInformationGain(
  question: PreferenceQuestionT,
  currentPreferences?: UserPreferencesT
): number {
  // Base score from the question's estimated value
  const baseScore = question.estimated_value;

  // If no current preferences, all questions have high value
  if (!currentPreferences) {
    return baseScore;
  }

  // Multiply by uncertainty in this dimension
  const uncertainty = getUncertaintyForType(question.type, currentPreferences);
  return baseScore * uncertainty;
}

/**
 * Score and rank all candidate questions
 */
function scoreQuestions(
  questions: PreferenceQuestionT[],
  currentPreferences?: UserPreferencesT
): ScoredQuestion[] {
  return questions.map((question) => ({
    question,
    score: calculateInformationGain(question, currentPreferences),
  }));
}

/**
 * Select the best questions to ask based on information gain
 */
export function selectQuestions(
  ctx: SelectionContext,
  maxQuestions: number
): PreferenceQuestionT[] {
  // Build question context
  const questionCtx: QuestionContext = {
    goalLabels: new Map(),
    optionLabels: new Map(),
    decisionScale: ctx.decisionScale,
  };

  // Generate all candidate questions
  const candidates = generateAllQuestions(questionCtx, ctx.graphGoals);

  // If we have current preferences with some risk data, maybe add a refined question
  if (ctx.currentPreferences && ctx.currentPreferences.derived_from.questions_answered >= 1) {
    const refinedRisk = generateRefinedRiskQuestion(
      questionCtx,
      ctx.currentPreferences.risk_aversion
    );
    candidates.push(refinedRisk);
  }

  // Score all questions
  const scored = scoreQuestions(candidates, ctx.currentPreferences);

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by type (take only the highest-scoring question per type)
  const seenTypes = new Set<PreferenceQuestionTypeT>();
  const deduplicated: ScoredQuestion[] = [];

  for (const item of scored) {
    if (!seenTypes.has(item.question.type)) {
      seenTypes.add(item.question.type);
      deduplicated.push(item);
    }
  }

  // Return top N questions
  return deduplicated.slice(0, maxQuestions).map((s) => s.question);
}

/**
 * Select the single best next question based on current preferences
 */
export function selectNextQuestion(
  ctx: SelectionContext
): PreferenceQuestionT | null {
  const questions = selectQuestions(ctx, 1);
  return questions.length > 0 ? questions[0] : null;
}

/**
 * Calculate the total estimated value of information from selected questions
 */
export function calculateTotalEstimatedValue(
  questions: PreferenceQuestionT[],
  currentPreferences?: UserPreferencesT
): number {
  if (questions.length === 0) {
    return 0;
  }

  // Sum up information gain from all questions, with diminishing returns
  let total = 0;
  let diminishingFactor = 1.0;

  for (const question of questions) {
    const gain = calculateInformationGain(question, currentPreferences);
    total += gain * diminishingFactor;
    diminishingFactor *= 0.8; // Each subsequent question has less marginal value
  }

  // Normalize to 0-1 range
  return Math.min(1, total);
}

/**
 * Determine how many more questions would be valuable to ask
 */
export function getRemainingQuestionsCount(
  currentPreferences?: UserPreferencesT,
  targetConfidence: "low" | "medium" | "high" = "high"
): number {
  const questionsNeeded: Record<"low" | "medium" | "high", number> = {
    low: 0,
    medium: 1,
    high: 3,
  };

  const targetCount = questionsNeeded[targetConfidence];
  const currentCount = currentPreferences?.derived_from.questions_answered ?? 0;

  return Math.max(0, targetCount - currentCount);
}
