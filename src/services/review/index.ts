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
