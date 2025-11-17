/**
 * Type definitions for Olumi Assistants Service API
 *
 * Mirrors server types for type-safe API calls
 */

// Graph Types
export interface GraphNode {
  id: string;
  kind?: "question" | "option" | "info" | "concern" | "goal";
  type?: "question" | "option" | "info" | "concern" | "goal";
  label: string;
  body?: string;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Graph {
  schema: "graph.v1";
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// API Request Types
export interface DraftGraphRequest {
  brief: string;
  attachments?: Attachment[];
}

export interface SuggestOptionsRequest {
  graph: Graph;
  question_id: string;
}

export interface ClarifyBriefRequest {
  brief: string;
  previous_answers?: Record<string, string>;
}

export interface CritiqueGraphRequest {
  graph: Graph;
  brief?: string;
  focus_areas?: string[];
}

export interface ExplainDiffRequest {
  before: Graph;
  after: Graph;
}

export interface EvidencePackRequest {
  graph: Graph;
  node_id: string;
}

// Attachment Types
export interface Attachment {
  filename: string;
  content_type: string;
  data: string; // Base64 encoded
}

// API Response Types
export interface DraftGraphResponse {
  schema: "draft-graph.v1";
  graph: Graph;
  confidence?: number;
  issues?: string[];
  rationales?: Array<{
    target: string;
    why: string;
    provenance_source?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  diagnostics?: Diagnostics;
}

export interface SuggestOptionsResponse {
  schema: "suggest-options.v1";
  suggestions: string[];
}

export interface ClarifyBriefResponse {
  schema: "clarify-brief.v1";
  questions?: Array<{
    id: string;
    question: string;
    reason: string;
  }>;
  ready: boolean;
  confidence: number;
}

export interface CritiqueGraphResponse {
  schema: "critique.v1";
  overall_quality: "excellent" | "good" | "fair" | "poor";
  issues: Array<{
    severity: "blocker" | "improvement" | "observation";
    category: string;
    message: string;
    node_ids?: string[];
  }>;
}

export interface ExplainDiffResponse {
  schema: "diff-explanation.v1";
  summary: string;
  changes: Array<{
    type: "node_added" | "node_removed" | "node_modified" | "edge_added" | "edge_removed";
    node_id?: string;
    before?: string;
    after?: string;
  }>;
}

export interface EvidencePackResponse {
  schema: "evidence-pack.v1";
  node_id: string;
  evidence: Array<{
    type: "pro" | "con" | "context";
    text: string;
    confidence: number;
  }>;
}

export interface Diagnostics {
  resumes: number;
  trims: number;
  recovered_events: number;
  correlation_id: string;
}

export interface LimitsResponse {
  schema: "limits.v1";
  key_id: string;
  rate_limit_rpm: number;
  sse_rate_limit_rpm: number;
  quota_backend: "redis" | "memory";
  graph_max_nodes: number;
  graph_max_edges: number;
  max_nodes: number;
  max_edges: number;
  standard_quota?: {
    capacity_rpm: number;
    tokens?: number;
    refill_rate_per_sec?: number;
    retry_after_seconds?: number;
  };
  sse_quota?: {
    capacity_rpm: number;
    tokens?: number;
    refill_rate_per_sec?: number;
    retry_after_seconds?: number;
  };
}

// Error Response
export interface ErrorResponse {
  schema: "error.v1";
  code: "BAD_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "QUOTA_EXCEEDED" | "INTERNAL";
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

// Health Check Response
export interface HealthCheckResponse {
  ok: boolean;
  service: string;
  version: string;
  provider: string;
  model: string;
  limits_source: string;
  feature_flags: Record<string, unknown>;
}

// SDK Config
export interface OlumiConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

// Request options for individual API calls
export interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  retries?: number;
}

// Resume token for reconnecting to interrupted SSE streams
export type ResumeToken = string;

// SSE event types
export type SseEventType = "stage" | "resume" | "complete" | "heartbeat";

export interface SseStageEvent {
  type: "stage";
  data: {
    stage: "DRAFTING" | "COMPLETE";
    payload?: DraftGraphResponse | ErrorResponse;
  };
}

export interface SseResumeEvent {
  type: "resume";
  data: {
    token: ResumeToken;
  };
}

export interface SseCompleteEvent {
  type: "complete";
  data: DraftGraphResponse | ErrorResponse;
}

export interface SseHeartbeatEvent {
  type: "heartbeat";
  data: null;
}

export type SseEvent =
  | SseStageEvent
  | SseResumeEvent
  | SseCompleteEvent
  | SseHeartbeatEvent;

// Options for resuming an interrupted stream
export interface ResumeOptions {
  token: ResumeToken;
  signal?: AbortSignal;
  timeout?: number;
}

// Result from resume operation
export interface ResumeResult {
  events: SseEvent[];
  completed: boolean;
  replayedCount: number;
}
