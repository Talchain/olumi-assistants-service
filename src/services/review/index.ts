/**
 * Review service module
 *
 * Provides block builders and readiness assessment for /assist/v1/review
 */

export {
  buildAllBlocks,
  buildBlock,
  buildBiasCheckBlock,
  buildOptionsBlock,
  buildSensitivityCoachBlock,
  buildEvidenceHelperBlock,
  buildKeyInsightBlock,
  buildStructuralWarningsBlock,
  type BlockBuilderContext,
  type BlockBuilderResult,
} from "./blockBuilders.js";

export {
  assessReadiness,
  buildReadinessBlock,
  type ReadinessLevel,
  type ReadinessFactors,
  type ReadinessAssessment,
  type ReadinessContext,
} from "./readinessAssessor.js";

export {
  generateRobustnessSynthesis,
} from "./robustnessSynthesis.js";

export {
  computeDecisionQuality,
  countMissingBaselines,
  type DecisionQualityResult,
  type DecisionQualityLevel,
  type DecisionQualityInputs,
} from "./decisionQuality.js";

export {
  aggregateInsights,
  type Insight,
  type InsightType,
  type InsightSeverity,
  type InsightsContext,
} from "./insights.js";

export {
  generateImprovementGuidance,
  generateImprovementGuidanceItems,
  type ImprovementGuidanceItem,
  type ImprovementGuidanceResult,
  type ImprovementSource,
  type ImprovementGuidanceContext,
} from "./improvementGuidance.js";

export {
  generateRationale,
  type RationaleResult,
  type RationaleContext,
} from "./rationale.js";

export {
  enrichFactors,
  buildEnrichFactorsInput,
  extractGoalLabel,
  extractOutcomeLabels,
  extractRiskLabels,
  extractControllableFactors,
  FACTOR_TYPE_GUIDANCE,
  type EnrichFactorsOptions,
  type EnrichFactorsResult,
} from "./enrichFactors.js";
