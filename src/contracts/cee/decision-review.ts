import type { components } from "../../generated/openapi.d.ts";

/**
 * CeeDecisionReviewBundle
 *
 * UI-friendly bundle summarising CEE envelopes as story/journey/uiFlags.
 * This is a derived view for frontend consumption, not the wire contract.
 */
export type CeeDecisionReviewBundle = components["schemas"]["CeeDecisionReviewBundle"];

/**
 * CeeDecisionReviewPayloadV1
 *
 * Frozen v1 contract for CEE decision review. Additive-only evolution.
 * This is the wire contract for the `/assist/v1/decision-review` endpoint.
 *
 * See schemas/cee-decision-review.v1.json for the authoritative JSON Schema.
 */
export type CeeDecisionReviewPayloadV1 = components["schemas"]["CeeDecisionReviewPayloadV1"];

// Re-export review sub-types for convenience
export type CeeReviewV1 = components["schemas"]["CeeReviewV1"];
export type CeeRecommendationV1 = components["schemas"]["CeeRecommendationV1"];
export type CeeBiasFindingV1 = components["schemas"]["CeeBiasFindingV1"];
export type CeeStructuralIssueV1 = components["schemas"]["CeeStructuralIssueV1"];
export type CeeReviewTraceV1 = components["schemas"]["CeeReviewTraceV1"];
export type CeeReviewMetaV1 = components["schemas"]["CeeReviewMetaV1"];
