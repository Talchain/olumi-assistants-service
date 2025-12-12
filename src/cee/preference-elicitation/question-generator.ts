/**
 * CEE Preference Question Generator
 *
 * Generates pairwise comparison questions for eliciting user preferences.
 * Four question types cover: risk/reward, goal trade-offs, loss aversion, and time preference.
 */

import type { PreferenceQuestionT, PreferenceQuestionTypeT } from "../../schemas/cee.js";
import type { QuestionContext } from "./types.js";

/**
 * Format a number as a currency-like amount (e.g., 10000 -> "10,000")
 */
function formatAmount(amount: number): string {
  return amount.toLocaleString("en-GB");
}

/**
 * Generate a unique question ID
 */
function generateQuestionId(type: PreferenceQuestionTypeT): string {
  return `pref_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Type 1: Risk vs Reward Trade-off Question
 *
 * Presents a choice between a risky higher-value option and a certain lower-value option.
 * Used to assess risk aversion coefficient.
 */
export function generateRiskRewardQuestion(ctx: QuestionContext): PreferenceQuestionT {
  const scaledHigh = Math.round(ctx.decisionScale * 1.5);
  const scaledCertain = Math.round(ctx.decisionScale * 0.9);

  return {
    id: generateQuestionId("risk_reward"),
    type: "risk_reward",
    question: "Which outcome would you prefer?",
    options: [
      {
        id: "A",
        label: `70% chance of gaining ${formatAmount(scaledHigh)}`,
        description: "Higher potential gain with uncertainty",
        probability: 0.7,
        outcome_value: scaledHigh,
      },
      {
        id: "B",
        label: `100% chance of gaining ${formatAmount(scaledCertain)}`,
        description: "Guaranteed gain with certainty",
        probability: 1.0,
        outcome_value: scaledCertain,
      },
    ],
    estimated_value: 0.4, // High information gain for risk aversion
  };
}

/**
 * Type 2: Goal Trade-off Question (Multi-Goal)
 *
 * Presents a choice between prioritising different goals.
 * Used to assess goal weights when multiple objectives exist.
 */
export function generateGoalTradeoffQuestion(
  ctx: QuestionContext,
  goalIds: string[]
): PreferenceQuestionT | null {
  if (goalIds.length < 2) {
    return null;
  }

  const goalA = goalIds[0];
  const goalB = goalIds[1];
  const labelA = ctx.goalLabels.get(goalA) || "Primary goal";
  const labelB = ctx.goalLabels.get(goalB) || "Secondary goal";

  return {
    id: generateQuestionId("goal_tradeoff"),
    type: "goal_tradeoff",
    question: "If you had to choose, which would you prioritise?",
    options: [
      {
        id: "A",
        label: `Optimise for: ${labelA}`,
        description: "Focus resources on this objective",
      },
      {
        id: "B",
        label: `Optimise for: ${labelB}`,
        description: "Focus resources on this objective",
      },
    ],
    estimated_value: 0.35, // Moderate information gain for goal weights
    context_node_ids: [goalA, goalB],
  };
}

/**
 * Type 3: Loss Aversion Question
 *
 * Presents a choice that reveals sensitivity to losses vs gains.
 * Used to assess loss aversion coefficient (typically 1.5-2.5 in behavioral economics).
 */
export function generateLossAversionQuestion(ctx: QuestionContext): PreferenceQuestionT {
  const amount = Math.round(ctx.decisionScale * 0.5);

  return {
    id: generateQuestionId("loss_aversion"),
    type: "loss_aversion",
    question: "Which concerns you more?",
    options: [
      {
        id: "A",
        label: `Missing out on a potential gain of ${formatAmount(amount)}`,
        description: "Opportunity cost - not capturing potential upside",
      },
      {
        id: "B",
        label: `Suffering a direct loss of ${formatAmount(amount)}`,
        description: "Actual loss - reduction from current position",
      },
    ],
    estimated_value: 0.35, // Good information gain for loss aversion
  };
}

/**
 * Type 4: Time Preference Question
 *
 * Presents a choice between immediate vs delayed rewards.
 * Used to assess time discount rate.
 */
export function generateTimePreferenceQuestion(ctx: QuestionContext): PreferenceQuestionT {
  const nowAmount = Math.round(ctx.decisionScale * 0.8);
  const laterAmount = ctx.decisionScale;

  return {
    id: generateQuestionId("time_preference"),
    type: "time_preference",
    question: "Which would you prefer?",
    options: [
      {
        id: "A",
        label: `${formatAmount(nowAmount)} this year`,
        description: "Smaller benefit available immediately",
        timeframe: "immediate",
        outcome_value: nowAmount,
      },
      {
        id: "B",
        label: `${formatAmount(laterAmount)} next year`,
        description: "Larger benefit after 12 months",
        timeframe: "12_months",
        outcome_value: laterAmount,
      },
    ],
    estimated_value: 0.25, // Lower information gain but still valuable
  };
}

/**
 * Generate all candidate questions for the given context
 */
export function generateAllQuestions(
  ctx: QuestionContext,
  goalIds: string[]
): PreferenceQuestionT[] {
  const questions: PreferenceQuestionT[] = [];

  // Always add risk/reward and loss aversion questions
  questions.push(generateRiskRewardQuestion(ctx));
  questions.push(generateLossAversionQuestion(ctx));

  // Add goal trade-off if multiple goals exist
  const goalQuestion = generateGoalTradeoffQuestion(ctx, goalIds);
  if (goalQuestion) {
    questions.push(goalQuestion);
  }

  // Always add time preference question
  questions.push(generateTimePreferenceQuestion(ctx));

  return questions;
}

/**
 * Generate a follow-up risk question with different parameters
 * Used for refining risk aversion estimates
 */
export function generateRefinedRiskQuestion(
  ctx: QuestionContext,
  currentRiskAversion: number
): PreferenceQuestionT {
  // Adjust probabilities based on current estimate to maximise information gain
  const probability = currentRiskAversion > 0.5 ? 0.6 : 0.8;
  const scaledHigh = Math.round(ctx.decisionScale * (currentRiskAversion > 0.5 ? 1.3 : 1.7));
  const scaledCertain = Math.round(ctx.decisionScale * (currentRiskAversion > 0.5 ? 0.85 : 0.95));

  return {
    id: generateQuestionId("risk_reward"),
    type: "risk_reward",
    question: "For this next comparison, which would you prefer?",
    options: [
      {
        id: "A",
        label: `${Math.round(probability * 100)}% chance of gaining ${formatAmount(scaledHigh)}`,
        description: "Higher potential gain with some uncertainty",
        probability,
        outcome_value: scaledHigh,
      },
      {
        id: "B",
        label: `100% chance of gaining ${formatAmount(scaledCertain)}`,
        description: "Guaranteed gain with certainty",
        probability: 1.0,
        outcome_value: scaledCertain,
      },
    ],
    estimated_value: 0.3, // Still valuable for refinement
  };
}
