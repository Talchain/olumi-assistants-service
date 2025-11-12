/**
 * Type definitions for Olumi Assistants Service API
 *
 * Mirrors server types for type-safe API calls
 */

// Graph Types
export interface GraphNode {
  id: string;
  type: "question" | "option" | "info" | "concern";
  label: string;
  body?: string;
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
  confidence: number;
  issues?: string[];
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

// Error Response
export interface ErrorResponse {
  schema: "error.v1";
  code: "BAD_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "RATE_LIMITED" | "QUOTA_EXCEEDED" | "INTERNAL";
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

// SDK Config
export interface OlumiConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}
