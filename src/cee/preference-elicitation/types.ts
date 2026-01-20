/**
 * CEE Preference Elicitation Types
 *
 * TypeScript interfaces for preference elicitation, including question
 * generation, answer processing, and ISL utility contract mapping.
 */

// Re-export Zod-inferred types from schemas
export type {
  PreferenceQuestionTypeT,
  PreferenceOptionT,
  PreferenceQuestionT,
  UserPreferencesT,
  CEEElicitPreferencesInputT,
  CEEElicitPreferencesAnswerInputT,
  CEEExplainTradeoffInputT,
} from "../../schemas/cee.js";

export type {
  CEEElicitPreferencesResponseV1T,
  CEEElicitPreferencesAnswerResponseV1T,
  CEEExplainTradeoffResponseV1T,
  CEEKeyFactorV1T,
  CEEPreferenceAlignmentV1T,
} from "../../schemas/ceeResponses.js";

/**
 * Context for generating preference questions
 */
export interface QuestionContext {
  /** Map of goal IDs to their labels */
  goalLabels: Map<string, string>;
  /** Map of option IDs to their labels */
  optionLabels: Map<string, string>;
  /** Scale of the decision (e.g., 10000 for £10k decision) */
  decisionScale: number;
  /** Optional label for the overall decision */
  decisionLabel?: string;
}

/**
 * Context for selecting which questions to ask
 */
export interface SelectionContext {
  /** Current user preferences (if available) */
  currentPreferences?: UserPreferencesT;
  /** Goal IDs from the decision graph */
  graphGoals: string[];
  /** Option IDs from the decision graph */
  graphOptions: string[];
  /** Scale of the decision */
  decisionScale: number;
}

/**
 * Question with information gain score
 */
export interface ScoredQuestion {
  question: PreferenceQuestionT;
  score: number;
}

/**
 * Result of processing a preference answer
 */
export interface AnswerProcessingResult {
  /** Updated user preferences */
  updated: UserPreferencesT;
  /** Human-readable impact statement */
  impact: string;
}

/**
 * Key factor in a trade-off explanation
 */
export interface KeyFactor {
  factor: string;
  impact: string;
}

/**
 * Preference alignment between two options
 */
export interface PreferenceAlignment {
  option_a_score: number;
  option_b_score: number;
  recommended: "A" | "B" | "neutral";
}

/**
 * Trade-off explanation result
 */
export interface TradeoffExplanation {
  explanation: string;
  key_factors: KeyFactor[];
  preference_alignment: PreferenceAlignment;
}

/**
 * ISL Utility Contract - parameters for ISL's utility aggregation
 */
export interface ISLUtilityContract {
  /** Method for aggregating utility across outcomes */
  aggregation_method: "expected_value" | "cvar" | "prospect_theory" | "weighted_sum";
  /** Risk-related parameters */
  risk_parameters: {
    /** Risk aversion coefficient (0 = risk-seeking, 1 = risk-averse) */
    risk_aversion: number;
    /** Loss aversion coefficient (1 = neutral, >1 = loss averse) */
    loss_aversion: number;
    /** Reference point for gains/losses (typically 0 for status quo) */
    reference_point: number;
  };
  /** Goal-related parameters */
  goal_parameters: {
    /** Weights for each goal (goal_id -> weight) */
    weights: Record<string, number>;
    /** Time discount rate (0 = patient, 1 = impatient) */
    discount_rate: number;
  };
}

/**
 * Default preferences for users who haven't answered questions
 */
export const DEFAULT_PREFERENCES: UserPreferencesT = {
  risk_aversion: 0.5, // Neutral
  loss_aversion: 1.5, // Moderate loss aversion
  goal_weights: {}, // Equal weights
  time_discount: 0.1, // 10% annual discount
  confidence: "low",
  derived_from: {
    questions_answered: 0,
    last_updated: new Date().toISOString(),
  },
};

// Import type for re-export
import type { UserPreferencesT, PreferenceQuestionT } from "../../schemas/cee.js";
