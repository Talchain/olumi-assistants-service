/**
 * Type definitions for Olumi Assistants Service API
 *
 * Mirrors server types for type-safe API calls
 */

export interface GraphNode {
  id: string;
  kind: "question" | "option" | "info" | "concern" | "goal";
  label: string;
  body?: string;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
}

export interface Graph {
  schema: "graph.v1";
  nodes: GraphNode[];
  edges: GraphEdge[];
  roots?: string[];
}

export interface Attachment {
  id: string;
  kind: "document";
  name: string;
}

export interface DraftGraphRequest {
  brief: string;
  attachments?: Attachment[];
  attachment_payloads?: Record<string, string>; // base64 encoded
}

export interface SuggestOptionsRequest {
  graph: Graph;
  question_id: string;
}

export interface ClarifyBriefRequest {
  brief: string;
  round?: number;
  previous_answers?: Record<string, string>;
}

export interface CritiqueGraphRequest {
  graph: Graph;
  brief?: string;
  focus_areas?: string[];
}

export interface ExplainDiffRequest {
  brief?: string;
  patch: {
    adds?: {
      nodes?: GraphNode[];
      edges?: GraphEdge[];
    };
    removes?: {
      nodes?: string[];
      edges?: string[];
    };
    updates?: {
      nodes?: Array<{ id: string; label?: string; body?: string }>;
    };
  };
}

export interface EvidencePackRequest {
  graph: Graph;
  brief?: string;
  request_id?: string;
}

export interface ShareRequest {
  graph: Graph;
  brief?: string;
  redaction_mode?: "minimal" | "full";
}

export interface DraftGraphResponse {
  schema: "draft-graph.v1";
  graph: Graph;
  rationales: Array<{
    target: string;
    why: string;
    provenance_source?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface SuggestOptionsResponse {
  schema: "suggest-options.v1";
  options: Array<{
    id: string;
    title: string;
    pros: string[];
    cons: string[];
    evidence_to_gather: string[];
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClarifyBriefResponse {
  schema: "clarify-brief.v1";
  questions: Array<{
    question: string;
    choices: string[];
    why_we_ask: string;
    impacts_draft: string;
  }>;
  confidence: number;
  should_continue: boolean;
  round: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface CritiqueGraphResponse {
  schema: "critique.v1";
  overall_quality: "excellent" | "good" | "fair" | "poor";
  issues: Array<{
    level: "BLOCKER" | "IMPROVEMENT" | "OBSERVATION";
    note: string;
    nodes?: string[];
  }>;
  suggested_fixes: Array<{
    type: "add_node" | "add_edge" | "update_node" | "remove_node" | "remove_edge";
    reason: string;
    node?: Partial<GraphNode>;
    edge?: Partial<GraphEdge>;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ExplainDiffResponse {
  schema: "diff-explanation.v1";
  rationales: Array<{
    target: string;
    why: string;
    provenance_source?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface EvidencePackResponse {
  schema: "evidence-pack.v1";
  graph: Graph;
  rationales: Array<{
    target: string;
    why: string;
    provenance_source?: string;
  }>;
  metadata: {
    brief?: string;
    request_id?: string;
    version: string;
    generated_at: string;
  };
}

export interface ShareResponse {
  schema: "share.v1";
  share_id: string;
  share_url: string;
  expires_at: string;
  redaction_mode: "minimal" | "full";
}

export interface ShareRevokeResponse {
  schema: "share-revoke.v1";
  share_id: string;
  revoked: boolean;
}

export interface StatusResponse {
  service: string;
  version: string;
  uptime_seconds: number;
  timestamp: string;
  requests: {
    total: number;
    client_errors_4xx: number;
    server_errors_5xx: number;
    error_rate_5xx: number;
  };
  llm: {
    provider: string;
    model: string;
    cache_enabled: boolean;
    cache_stats?: {
      size: number;
      capacity: number;
      ttlMs: number; // Note: camelCase from server
      enabled: boolean;
    };
    failover_enabled: boolean;
    failover_providers?: string[];
  };
  share: {
    enabled: boolean;
    total_shares: number;
    active_shares: number;
    revoked_shares: number;
  };
  feature_flags: {
    grounding: boolean;
    critique: boolean;
    clarifier: boolean;
    pii_guard: boolean;
    share_review: boolean;
    prompt_cache: boolean;
  };
}

export interface ErrorResponse {
  schema: "error.v1";
  code:
    | "BAD_INPUT"
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "QUOTA_EXCEEDED"
    | "INTERNAL";
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

export interface OlumiConfig {
  /** API key for authentication (can be empty string if using HMAC) */
  apiKey: string;
  /** Base URL for the API (defaults to production) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
  /**
   * HMAC secret for request signing (optional)
   * When provided, requests will be signed with HMAC-SHA256
   * instead of using API key authentication
   */
  hmacSecret?: string;
}

/**
 * Request options for individual API calls
 */
export interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  retries?: number;
}

// ===== SSE Resume Types (v1.8.0) =====

/**
 * Resume token for reconnecting to interrupted SSE streams
 *
 * Format: <base64url-payload>.<base64url-signature>
 *
 * Payload contains:
 * - request_id: Unique stream identifier
 * - step: Current processing step (DRAFTING, COMPLETE)
 * - seq: Last received event sequence number
 * - expires_at: Unix timestamp (15-minute TTL)
 */
export type ResumeToken = string;

/**
 * SSE event types emitted by the streaming API
 */
export type SseEventType = "stage" | "resume" | "complete" | "heartbeat";

/**
 * SSE stage event payload
 */
export interface SseStageEvent {
  type: "stage";
  data: {
    stage: "DRAFTING" | "COMPLETE";
    payload?: DraftGraphResponse | ErrorResponse;
  };
}

/**
 * SSE resume token event payload
 */
export interface SseResumeEvent {
  type: "resume";
  data: {
    token: ResumeToken;
  };
}

/**
 * SSE complete event payload (used in resume endpoint for snapshots)
 */
export interface SseCompleteEvent {
  type: "complete";
  data: DraftGraphResponse | ErrorResponse;
}

/**
 * SSE heartbeat event (no data payload)
 */
export interface SseHeartbeatEvent {
  type: "heartbeat";
  data: null;
}

/**
 * Union of all SSE event types
 */
export type SseEvent =
  | SseStageEvent
  | SseResumeEvent
  | SseCompleteEvent
  | SseHeartbeatEvent;

/**
 * Options for resuming an interrupted stream
 */
export interface ResumeOptions {
  /** The resume token from the previous stream */
  token: ResumeToken;
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Result from resume operation
 */
export interface ResumeResult {
  /** All events replayed from the buffer */
  events: SseEvent[];
  /** Whether the stream was completed */
  completed: boolean;
  /** Number of events replayed */
  replayedCount: number;
}
