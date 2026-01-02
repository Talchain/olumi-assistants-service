/**
 * CEE Transforms Module
 *
 * Contains transformation utilities for schema versioning and derived fields.
 */

export {
  deriveStrengthStd,
  deriveStrengthStdBatch,
  type ProvenanceObject,
} from "./strength-derivation.js";

export {
  inferEffectDirection,
  ensureEffectDirection,
  ensureEffectDirectionBatch,
  type EffectDirection,
  type NodeInfo,
} from "./effect-direction-inference.js";

export {
  transformNodeToV2,
  transformEdgeToV2,
  transformGraphToV2,
  transformResponseToV2,
  isValidSchemaVersion,
  parseSchemaVersion,
  isFactorData,
  isOptionData,
  type SchemaVersion,
  type V1Node,
  type V1Edge,
  type V1Graph,
  type V1DraftGraphResponse,
  type V1FactorData,
  type V1OptionData,
  type V1NodeData,
  type V2Node,
  type V2NodeType,
  type V2Edge,
  type V2Graph,
  type V2DraftGraphResponse,
  type V2ObservedState,
} from "./schema-v2.js";

export {
  transformNodeToV3,
  transformEdgeToV3,
  transformGraphToV3,
  transformResponseToV3,
  validateStrictModeV3,
  needsUserMapping,
  getV3ResponseSummary,
  type V3DraftGraphResponse,
  type V3TransformContext,
  type V3ResponseSummary,
} from "./schema-v3.js";

// Re-export retry helpers for route handlers
export {
  hasPriceRelatedUnresolvedTargets,
  generatePriceFactorHint,
} from "../extraction/intervention-extractor.js";

export {
  transformOptionToAnalysisReady,
  buildAnalysisReadyPayload,
  validateAnalysisReadyPayload,
  validateAndLogAnalysisReady,
  getAnalysisReadySummary,
  type AnalysisReadyContext,
  type AnalysisReadyValidationError,
  type AnalysisReadyValidationResult,
  type AnalysisReadySummary,
} from "./analysis-ready.js";
