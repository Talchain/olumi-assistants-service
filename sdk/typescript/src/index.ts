/**
 * Olumi Assistants SDK
 *
 * Official TypeScript SDK for Olumi Assistants Service
 *
 * @packageDocumentation
 */

export { OlumiClient } from "./client.js";
export {
  OlumiError,
  OlumiAPIError,
  OlumiNetworkError,
  OlumiConfigError,
} from "./errors.js";
export type {
  OlumiConfig,
  Graph,
  GraphNode,
  GraphEdge,
  DraftGraphRequest,
  DraftGraphResponse,
  SuggestOptionsRequest,
  SuggestOptionsResponse,
  ClarifyBriefRequest,
  ClarifyBriefResponse,
  CritiqueGraphRequest,
  CritiqueGraphResponse,
  ExplainDiffRequest,
  ExplainDiffResponse,
  EvidencePackRequest,
  EvidencePackResponse,
  HealthCheckResponse,
  ErrorResponse,
  Attachment,
} from "./types.js";

// CEE v1 client and helpers
export { createCEEClient } from "./ceeClient.js";
export type { CEEClient } from "./ceeClient.js";

export type { GraphV1, GraphPatchV1 } from "./graphTypes.js";

export {
  getCEETrace,
  getCEEQualityOverall,
  getCEEValidationIssues,
  ceeAnyTruncated,
  isRetryableCEEError,
  getCeeErrorMetadata,
  buildCeeErrorViewModel,
  buildCeeEngineStatus,
  buildDecisionStorySummary,
  buildCeeHealthSummary,
  mapCeeHealthStatusToTone,
  buildCeeJourneySummary,
  buildCeeUiFlags,
  buildCeeDecisionReviewPayload,
  buildCeeEvidenceCoverageSummary,
  buildCeeTraceSummary,
  buildCeeErrorView,
  buildCeeIntegrationReviewBundle,
  buildCeeBiasStructureSnapshot,
  buildCeeCausalValidationStats,
  buildCeeDecisionHealthSnapshot,
} from "./ceeHelpers.js";

export { applyGraphPatch } from "./applyGraphPatch.js";

export type {
  CEETraceMeta,
  CEEQualityMeta,
  CEEValidationIssue,
  CEEDraftGraphRequestV1,
  CEEDraftGraphResponseV1,
  CEEExplainGraphRequestV1,
  CEEExplainGraphResponseV1,
  CEEEvidenceHelperRequestV1,
  CEEEvidenceHelperResponseV1,
  CEEOptionsRequestV1,
  CEEOptionsResponseV1,
  CEEBiasCheckRequestV1,
  CEEBiasCheckResponseV1,
  CEESensitivityCoachRequestV1,
  CEESensitivityCoachResponseV1,
  CEETeamPerspectivesRequestV1,
  CEETeamPerspectivesResponseV1,
} from "./ceeTypes.js";

export type {
  DecisionStorySummary,
  CeeHealthSummary,
  CeeHealthTone,
  CeeJourneyEnvelopes,
  CeeJourneyHealth,
  CeeJourneySummary,
  CeeUiFlags,
  CeeDecisionReviewPayload,
  CeeErrorMetadata,
  CeeErrorViewModel,
  CeeEngineStatus,
  CeeEvidenceCoverageSummary,
  CeeTraceSummary,
  CeeErrorView,
  CeeIntegrationReviewBundle,
  CeeError,
  CeeTrace,
  CeeDecisionReviewPayloadV1,
  CeeReviewResult,
  CeeBiasStructureDraftSummary,
  CeeBiasStructureBiasSummary,
  CeeBiasStructureSnapshot,
  CeeCausalValidationStats,
  CeeCausalCoverageLevel,
  CeeDecisionHealthSnapshot,
} from "./ceeHelpers.js";
