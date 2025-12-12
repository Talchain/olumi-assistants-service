/**
 * CEE Preference Elicitation Module
 *
 * Captures user risk preferences and goal trade-offs through intuitive pairwise
 * comparisons, feeding ISL's utility aggregation.
 */

// Re-export types
export type {
  PreferenceQuestionTypeT,
  PreferenceOptionT,
  PreferenceQuestionT,
  UserPreferencesT,
  CEEElicitPreferencesInputT,
  CEEElicitPreferencesAnswerInputT,
  CEEExplainTradeoffInputT,
  CEEElicitPreferencesResponseV1T,
  CEEElicitPreferencesAnswerResponseV1T,
  CEEExplainTradeoffResponseV1T,
  QuestionContext,
  SelectionContext,
  ScoredQuestion,
  AnswerProcessingResult,
  KeyFactor,
  PreferenceAlignment,
  TradeoffExplanation,
  ISLUtilityContract,
} from "./types.js";

export { DEFAULT_PREFERENCES } from "./types.js";

// Question generation
export {
  generateRiskRewardQuestion,
  generateGoalTradeoffQuestion,
  generateLossAversionQuestion,
  generateTimePreferenceQuestion,
  generateAllQuestions,
  generateRefinedRiskQuestion,
} from "./question-generator.js";

// Question selection
export {
  selectQuestions,
  selectNextQuestion,
  calculateTotalEstimatedValue,
  getRemainingQuestionsCount,
} from "./question-selector.js";

// Contextual framing
export {
  frameQuestionInContext,
  frameQuestionsInContext,
  buildQuestionContext,
  estimateDecisionScale,
  generateQuestionIntro,
} from "./contextual-framer.js";

// Answer processing
export {
  processAnswer,
  generateRecommendationImpact,
  createDefaultPreferences,
} from "./answer-processor.js";

// ISL mapping
export {
  mapToISLContract,
  createDefaultISLContract,
  calculateRiskAdjustedValue,
  calculateProspectValue,
  discountFutureValue,
  aggregateGoalUtility,
  describeISLContract,
} from "./isl-mapper.js";

// Trade-off explanations
export {
  explainTradeoff,
  generateTradeoffSummary,
} from "./tradeoff-explainer.js";
