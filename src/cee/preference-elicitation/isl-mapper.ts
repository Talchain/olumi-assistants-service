/**
 * CEE Preference to ISL Utility Contract Mapper
 *
 * Maps user preferences from CEE to ISL's utility aggregation parameters.
 * This bridges the gap between user-facing preference elicitation and
 * the mathematical utility functions used in decision analysis.
 */

import type { UserPreferencesT } from "../../schemas/cee.js";
import type { ISLUtilityContract } from "./types.js";

/**
 * Aggregation method selection thresholds
 */
const THRESHOLDS = {
  /** Loss aversion threshold for switching to prospect theory */
  PROSPECT_THEORY_LOSS_THRESHOLD: 1.5,
  /** Risk aversion threshold for switching to CVaR */
  CVAR_RISK_THRESHOLD: 0.7,
  /** Risk aversion threshold for weighted sum (balanced) */
  WEIGHTED_SUM_THRESHOLD: 0.3,
};

/**
 * Determine the optimal aggregation method based on user preferences
 */
function selectAggregationMethod(
  preferences: UserPreferencesT
): ISLUtilityContract["aggregation_method"] {
  // High loss aversion indicates prospect theory is most appropriate
  // (accounts for asymmetric sensitivity to gains vs losses)
  if (preferences.loss_aversion > THRESHOLDS.PROSPECT_THEORY_LOSS_THRESHOLD) {
    return "prospect_theory";
  }

  // High risk aversion suggests CVaR (Conditional Value at Risk)
  // focuses on worst-case outcomes
  if (preferences.risk_aversion > THRESHOLDS.CVAR_RISK_THRESHOLD) {
    return "cvar";
  }

  // Multiple goals with weights suggests weighted sum aggregation
  const goalCount = Object.keys(preferences.goal_weights).length;
  if (goalCount > 1) {
    return "weighted_sum";
  }

  // Default to standard expected value
  return "expected_value";
}

/**
 * Map CEE user preferences to ISL utility contract parameters
 */
export function mapToISLContract(preferences: UserPreferencesT): ISLUtilityContract {
  const method = selectAggregationMethod(preferences);

  return {
    aggregation_method: method,
    risk_parameters: {
      risk_aversion: preferences.risk_aversion,
      loss_aversion: preferences.loss_aversion,
      reference_point: 0, // Default to status quo as reference
    },
    goal_parameters: {
      weights: normaliseGoalWeights(preferences.goal_weights),
      discount_rate: preferences.time_discount,
    },
  };
}

/**
 * Normalise goal weights to sum to 1
 */
function normaliseGoalWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights);
  if (entries.length === 0) {
    return {};
  }

  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total === 0) {
    // Equal weights if all are zero
    const equalWeight = 1 / entries.length;
    return Object.fromEntries(entries.map(([k]) => [k, equalWeight]));
  }

  return Object.fromEntries(entries.map(([k, w]) => [k, w / total]));
}

/**
 * Create a default ISL contract for users without preference data
 */
export function createDefaultISLContract(): ISLUtilityContract {
  return {
    aggregation_method: "expected_value",
    risk_parameters: {
      risk_aversion: 0.5,
      loss_aversion: 1.5,
      reference_point: 0,
    },
    goal_parameters: {
      weights: {},
      discount_rate: 0.1,
    },
  };
}

/**
 * Calculate risk-adjusted expected value based on preferences
 * This can be used by ISL for basic utility calculations
 */
export function calculateRiskAdjustedValue(
  expectedValue: number,
  variance: number,
  preferences: UserPreferencesT
): number {
  // Mean-variance utility: U = E[X] - (risk_aversion/2) * Var[X]
  return expectedValue - (preferences.risk_aversion / 2) * variance;
}

/**
 * Calculate prospect theory value for gains and losses
 * Based on Kahneman & Tversky's prospect theory
 */
export function calculateProspectValue(
  outcome: number,
  referencePoint: number,
  preferences: UserPreferencesT
): number {
  const delta = outcome - referencePoint;

  if (delta >= 0) {
    // Gains: diminishing sensitivity (concave)
    return Math.pow(delta, 0.88);
  } else {
    // Losses: steeper than gains (loss aversion)
    return -preferences.loss_aversion * Math.pow(-delta, 0.88);
  }
}

/**
 * Apply time discount to a future value
 */
export function discountFutureValue(
  futureValue: number,
  yearsInFuture: number,
  preferences: UserPreferencesT
): number {
  // Exponential discounting: PV = FV / (1 + r)^t
  return futureValue / Math.pow(1 + preferences.time_discount, yearsInFuture);
}

/**
 * Aggregate multiple goal outcomes into a single utility value
 */
export function aggregateGoalUtility(
  goalOutcomes: Record<string, number>,
  preferences: UserPreferencesT
): number {
  const normalisedWeights = normaliseGoalWeights(preferences.goal_weights);
  const goalIds = Object.keys(goalOutcomes);

  if (goalIds.length === 0) {
    return 0;
  }

  // If no weights defined, use equal weights
  if (Object.keys(normalisedWeights).length === 0) {
    const equalWeight = 1 / goalIds.length;
    return goalIds.reduce((sum, goalId) => sum + goalOutcomes[goalId] * equalWeight, 0);
  }

  // Weighted sum of goal outcomes
  return goalIds.reduce((sum, goalId) => {
    const weight = normalisedWeights[goalId] ?? 0;
    return sum + (goalOutcomes[goalId] ?? 0) * weight;
  }, 0);
}

/**
 * Describe the ISL contract in human-readable terms
 */
export function describeISLContract(contract: ISLUtilityContract): string {
  const parts: string[] = [];

  // Describe aggregation method
  switch (contract.aggregation_method) {
    case "expected_value":
      parts.push("Standard expected value calculation");
      break;
    case "cvar":
      parts.push("Risk-focused analysis (CVaR) emphasising worst-case outcomes");
      break;
    case "prospect_theory":
      parts.push("Loss-averse analysis where potential losses are weighted more heavily");
      break;
    case "weighted_sum":
      parts.push("Multi-goal weighted aggregation");
      break;
  }

  // Describe risk parameters
  if (contract.risk_parameters.risk_aversion > 0.6) {
    parts.push("with conservative risk assumptions");
  } else if (contract.risk_parameters.risk_aversion < 0.4) {
    parts.push("with risk-tolerant assumptions");
  }

  // Describe time preference
  if (contract.goal_parameters.discount_rate > 0.15) {
    parts.push("favouring near-term outcomes");
  } else if (contract.goal_parameters.discount_rate < 0.05) {
    parts.push("with long-term focus");
  }

  return parts.join(", ");
}
