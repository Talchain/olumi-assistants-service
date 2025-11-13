/**
 * Olumi Assistants SDK
 *
 * Official TypeScript SDK for Olumi Assistants Service
 *
 * @packageDocumentation
 */

export { OlumiClient } from "./client.js";
export type { ApiResponse, ResponseMetadata } from "./client.js";
export {
  OlumiError,
  OlumiAPIError,
  OlumiNetworkError,
  OlumiConfigError,
  OlumiValidationError,
} from "./errors.js";
export type {
  OlumiConfig,
  RequestOptions,
  Graph,
  GraphNode,
  GraphEdge,
  Attachment,
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
  ShareRequest,
  ShareResponse,
  ShareRevokeResponse,
  StatusResponse,
  ErrorResponse,
  // SSE Resume types (v1.8.0)
  ResumeToken,
  SseEventType,
  SseEvent,
  SseStageEvent,
  SseResumeEvent,
  SseCompleteEvent,
  SseHeartbeatEvent,
  ResumeOptions,
  ResumeResult,
} from "./types.js";

// HMAC authentication utilities
export { sign, generateNonce, verifyResponseHash } from "./hmac.js";
export type { HmacHeaders, HmacSignOptions } from "./hmac.js";

// SSE Resume utilities (v1.8.0)
export {
  streamDraftGraph,
  resumeDraftGraph,
  extractResumeTokenFromEvent,
} from "./sse.js";
export type { SseStreamConfig } from "./sse.js";
