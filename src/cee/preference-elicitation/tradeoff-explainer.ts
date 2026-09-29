/**
 * CEE Trade-off Explainer
 *
 * Generates natural language explanations of trade-offs between options
 * based on user preferences. Helps users understand why one option might
 * align better with their stated preferences.
 */

import type { UserPreferencesT } from "../../schemas/cee.js";
import type { KeyFactor, PreferenceAlignment, TradeoffExplanation } from "./types.js";

/**
 * Analyse risk-related factors
 */
function analyseRiskFactor(preferences: UserPreferencesT): KeyFactor | null {
  if (preferences.risk_aversion > 0.6) {
    return {
      factor: "Risk preference",
      impact: "You tend to prefer safer options with more certain outcomes.",
    };
  } else if (preferences.risk_aversion < 0.4) {
    return {
      factor: "Risk tolerance",
      impact: "You're comfortable with uncertainty for higher potential returns.",
    };
  }
  return null;
}

/**
 * Analyse loss aversion factors
 */
function analyseLossAversionFactor(preferences: UserPreferencesT): KeyFactor | null {
  if (preferences.loss_aversion > 2) {
    return {
      factor: "Loss sensitivity",
      impact: "Potential losses weigh heavily in your evaluation. You prefer to avoid downside risk.",
    };
  } else if (preferences.loss_aversion < 1.3) {
    return {
      factor: "Opportunity focus",
      impact: "You weight potential gains and losses more equally, focusing on net outcomes.",
    };
  }
  return null;
}

/**
 * Analyse time preference factors
 */
function analyseTimePreferenceFactor(preferences: UserPreferencesT): KeyFactor | null {
  if (preferences.time_discount > 0.15) {
    return {
      factor: "Time preference",
      impact: "You prefer nearer-term results. Immediate benefits matter more to you.",
    };
  } else if (preferences.time_discount < 0.05) {
    return {
      factor: "Long-term thinking",
      impact: "You're patient and willing to wait for better long-term outcomes.",
    };
  }
  return null;
}

/**
 * Analyse goal weight factors
 */
function analyseGoalWeightFactors(preferences: UserPreferencesT): KeyFactor[] {
  const factors: KeyFactor[] = [];
  const weights = Object.entries(preferences.goal_weights);

  if (weights.length > 0) {
    // Find dominant goals (weight > 0.4)
    const dominantGoals = weights.filter(([, w]) => w > 0.4);
    if (dominantGoals.length > 0) {
      factors.push({
        factor: "Goal priorities",
        impact: `You prioritise ${dominantGoals.map(([g]) => g).join(" and ")} in your decisions.`,
      });
    }
  }

  return factors;
}

/**
 * Calculate preference alignment scores for two options
 * This is a simplified scoring - in practice would use more sophisticated analysis
 */
function calculateAlignment(
  optionA: string,
  optionB: string,
  preferences: UserPreferencesT
): PreferenceAlignment {
  // For now, return neutral unless we have more context about the options
  // In a full implementation, this would parse option descriptions and score them
  // against preference dimensions

  // Simple heuristic: check for keywords that indicate risk/certainty
  const aLower = optionA.toLowerCase();
  const bLower = optionB.toLowerCase();

  let aScore = 50;
  let bScore = 50;

  // Risk-related keywords
  const riskyKeywords = ["risk", "uncertain", "potential", "might", "could", "chance"];
  const safeKeywords = ["certain", "guaranteed", "safe", "secure", "stable"];

  const aIsRisky = riskyKeywords.some((k) => aLower.includes(k));
  const bIsRisky = riskyKeywords.some((k) => bLower.includes(k));
  const aIsSafe = safeKeywords.some((k) => aLower.includes(k));
  const bIsSafe = safeKeywords.some((k) => bLower.includes(k));

  // Adjust scores based on risk aversion
  if (preferences.risk_aversion > 0.5) {
    if (aIsRisky) aScore -= 10;
    if (bIsRisky) bScore -= 10;
    if (aIsSafe) aScore += 10;
    if (bIsSafe) bScore += 10;
  } else {
    if (aIsRisky) aScore += 5;
    if (bIsRisky) bScore += 5;
    if (aIsSafe) aScore -= 5;
    if (bIsSafe) bScore -= 5;
  }

  // Normalise scores to 0-100 range
  aScore = Math.max(0, Math.min(100, aScore));
  bScore = Math.max(0, Math.min(100, bScore));

  // Determine recommendation
  let recommended: "A" | "B" | "neutral" = "neutral";
  const scoreDiff = aScore - bScore;
  if (scoreDiff > 5) {
    recommended = "A";
  } else if (scoreDiff < -5) {
    recommended = "B";
  }

  return {
    option_a_score: aScore,
    option_b_score: bScore,
    recommended,
  };
}

/**
 * Generate natural language explanation of the trade-off
 */
function generateNaturalLanguageExplanation(
  optionA: string,
  optionB: string,
  preferences: UserPreferencesT,
  factors: KeyFactor[],
  goalContext?: string
): string {
  const parts: string[] = [];

  // Opening with goal context if provided
  if (goalContext) {
    parts.push(`Given your goal of ${goalContext}, you're comparing "${optionA}" against "${optionB}".`);
  } else {
    parts.push(`You're comparing "${optionA}" against "${optionB}".`);
  }

  // Add preference-based reasoning
  if (preferences.risk_aversion > 0.6) {
    parts.push(`Your preference for safety suggests that options with more certainty may align better with your values, even at the cost of some upside potential.`);
  } else if (preferences.risk_aversion < 0.4) {
    parts.push(`Your comfort with risk suggests that higher-potential options may be worth considering, even with some uncertainty.`);
  }

  if (preferences.loss_aversion > 2) {
    parts.push(`Since losses weigh heavily in your decision-making, options that protect against downside scenarios may be particularly appealing.`);
  }

  if (preferences.time_discount > 0.15) {
    parts.push(`Your preference for near-term results means immediate benefits should be weighted more heavily in your comparison.`);
  }

  // Add confidence caveat
  if (preferences.confidence === "low") {
    parts.push(`(Note: These insights are based on limited preference data. Answer more questions to improve recommendation accuracy.)`);
  }

  return parts.join(" ");
}

/**
 * Generate a complete trade-off explanation
 */
export function explainTradeoff(
  optionA: string,
  optionB: string,
  preferences: UserPreferencesT,
  goalContext?: string
): TradeoffExplanation {
  // Collect all relevant factors
  const factors: KeyFactor[] = [];

  const riskFactor = analyseRiskFactor(preferences);
  if (riskFactor) factors.push(riskFactor);

  const lossFactor = analyseLossAversionFactor(preferences);
  if (lossFactor) factors.push(lossFactor);

  const timeFactor = analyseTimePreferenceFactor(preferences);
  if (timeFactor) factors.push(timeFactor);

  const goalFactors = analyseGoalWeightFactors(preferences);
  factors.push(...goalFactors);

  // Generate explanation
  const explanation = generateNaturalLanguageExplanation(
    optionA,
    optionB,
    preferences,
    factors,
    goalContext
  );

  // Calculate alignment
  const alignment = calculateAlignment(optionA, optionB, preferences);

  return {
    explanation,
    key_factors: factors,
    preference_alignment: alignment,
  };
}

/**
 * Generate a brief summary of how preferences affect the trade-off
 */
export function generateTradeoffSummary(
  preferences: UserPreferencesT
): string {
  const aspects: string[] = [];

  if (preferences.risk_aversion > 0.6) {
    aspects.push("risk-averse");
  } else if (preferences.risk_aversion < 0.4) {
    aspects.push("risk-tolerant");
  }

  if (preferences.loss_aversion > 2) {
    aspects.push("loss-sensitive");
  }

  if (preferences.time_discount > 0.15) {
    aspects.push("short-term focused");
  } else if (preferences.time_discount < 0.05) {
    aspects.push("long-term focused");
  }

  if (aspects.length === 0) {
    return "Your preferences are balanced across risk, loss sensitivity, and time horizon.";
  }

  return `Your preferences indicate a ${aspects.join(", ")} approach to decisions.`;
}
