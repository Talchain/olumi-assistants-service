/**
 * Provider-agnostic LLM adapter interface for multi-provider orchestration.
 *
 * All adapters (Anthropic, OpenAI, etc.) must implement this interface to ensure
 * consistent behavior across providers while respecting spec v04 constraints.
 */

import type { GraphT } from "../../schemas/graph.js";
import type { DocPreview } from "../../services/docProcessing.js";

/**
 * Usage metrics returned by LLM calls for cost tracking and telemetry.
 */
export interface UsageMetrics {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Arguments for drafting a decision graph from a brief.
 */
export interface DraftGraphArgs {
  brief: string;
  docs?: DocPreview[];
  seed: number;
  flags?: Record<string, unknown>;
  includeDebug?: boolean;
}

/**
 * Result from drafting a decision graph.
 */
export interface DraftGraphResult {
  graph: GraphT;
  rationales?: Array<{ target: string; why: string }>;
  questions?: Array<{ question: string; context?: string }>;
  debug?: {
    influence_scores?: Array<{ node_id: string; score: number }>;
    [key: string]: unknown;
  };
  usage: UsageMetrics;
}

/**
 * Arguments for suggesting strategic options for a goal.
 */
export interface SuggestOptionsArgs {
  goal: string;
  constraints?: Record<string, unknown>;
  existingOptions?: string[];
}

/**
 * A strategic option with pros, cons, and evidence to gather.
 */
export interface StrategyOption {
  id: string;
  title: string;
  pros: string[];
  cons: string[];
  evidence_to_gather: string[];
}

/**
 * Result from suggesting strategic options.
 */
export interface SuggestOptionsResult {
  options: StrategyOption[];
  usage: UsageMetrics;
}

/**
 * Arguments for repairing a graph that failed validation.
 */
export interface RepairGraphArgs {
  graph: GraphT;
  violations: string[];
  brief?: string;
  docs?: DocPreview[];
}

/**
 * Result from repairing a graph.
 */
export interface RepairGraphResult {
  graph: GraphT;
  rationales?: Array<{ target: string; why: string }>;
  usage: UsageMetrics;
}

/**
 * A clarification question to refine the brief.
 */
export interface ClarificationQuestion {
  question: string;
  choices?: string[];
  why_we_ask: string;
  impacts_draft: string;
}

/**
 * Arguments for clarifying a brief with follow-up questions.
 */
export interface ClarifyBriefArgs {
  brief: string;
  round: number;
  previous_answers?: Array<{ question: string; answer: string }>;
  seed?: number;
}

/**
 * Result from clarifying a brief.
 */
export interface ClarifyBriefResult {
  questions: ClarificationQuestion[];
  confidence: number;
  should_continue: boolean;
  round: number;
  usage: UsageMetrics;
}

/**
 * Issue severity levels for critique.
 */
export type CritiqueLevel = "BLOCKER" | "IMPROVEMENT" | "OBSERVATION";

/**
 * An issue identified during graph critique.
 */
export interface CritiqueIssue {
  level: CritiqueLevel;
  note: string;
  target?: string;
}

/**
 * Arguments for critiquing a draft graph.
 */
export interface CritiqueGraphArgs {
  graph: GraphT;
  brief?: string;
  focus_areas?: Array<"structure" | "completeness" | "feasibility" | "provenance">;
}

/**
 * Result from critiquing a graph.
 */
export interface CritiqueGraphResult {
  issues: CritiqueIssue[];
  suggested_fixes: string[];
  overall_quality?: "poor" | "fair" | "good" | "excellent";
  usage: UsageMetrics;
}

/**
 * Call options passed to all adapter methods for request tracking and timeouts.
 */
export interface CallOpts {
  requestId: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

/**
 * Provider-agnostic LLM adapter interface.
 *
 * All methods must:
 * - Respect spec v04 constraints (≤12 nodes, ≤24 edges, DAG only)
 * - Return stable, deterministic IDs (e.g., "goal_1", "${from}::${to}::${index}")
 * - Enforce sorted outputs (nodes by ID ascending, edges by from/to/id)
 * - Never fabricate needle-movers/influence scores (only engine can provide these)
 * - Support text-only doc grounding (≤5k chars/file, proper citation format)
 */
export interface LLMAdapter {
  /**
   * Provider name for telemetry and routing.
   */
  readonly name: 'anthropic' | 'openai' | 'fixtures' | string;

  /**
   * Model identifier (provider-specific, e.g., "claude-3-5-sonnet-20241022", "gpt-4o-mini").
   */
  readonly model: string;

  /**
   * Draft a decision graph from a brief with optional document attachments.
   *
   * @param args - Brief, documents, seed, flags, debug options
   * @param opts - Request ID, timeout, abort signal
   * @returns Graph, rationales, questions, debug info, usage metrics
   * @throws Error on timeout, API failure, or validation errors
   */
  draftGraph(args: DraftGraphArgs, opts: CallOpts): Promise<DraftGraphResult>;

  /**
   * Suggest strategic options for a goal with constraints.
   *
   * @param args - Goal, constraints, existing options to avoid
   * @param opts - Request ID, timeout, abort signal
   * @returns 3-5 distinct options with pros, cons, evidence to gather
   * @throws Error on timeout or API failure
   */
  suggestOptions(args: SuggestOptionsArgs, opts: CallOpts): Promise<SuggestOptionsResult>;

  /**
   * Repair a graph that failed validation (cycles, missing nodes, etc.).
   *
   * @param args - Graph, violations, optional context (brief, docs)
   * @param opts - Request ID, timeout, abort signal
   * @returns Repaired graph with rationales and usage metrics
   * @throws Error on timeout or API failure
   */
  repairGraph(args: RepairGraphArgs, opts: CallOpts): Promise<RepairGraphResult>;

  /**
   * Optional: Stream draft graph generation for SSE endpoints.
   *
   * @param args - Brief, documents, seed, flags, debug options
   * @param opts - Request ID, timeout, abort signal
   * @returns Async iterable of draft stream events (partial graphs, stages, etc.)
   */
  streamDraftGraph?(
    args: DraftGraphArgs,
    opts: CallOpts
  ): AsyncIterable<DraftStreamEvent>;

  /**
   * Generate clarification questions to refine a brief (up to 3 rounds).
   *
   * @param args - Brief, round number, previous Q&A, seed for determinism
   * @param opts - Request ID, timeout, abort signal
   * @returns Questions (MCQ-first), confidence, should_continue flag
   * @throws Error on timeout or API failure
   */
  clarifyBrief(args: ClarifyBriefArgs, opts: CallOpts): Promise<ClarifyBriefResult>;

  /**
   * Critique a draft graph for issues (non-mutating, pre-flight check).
   *
   * @param args - Graph, optional brief context, focus areas
   * @param opts - Request ID, timeout, abort signal
   * @returns Issues (BLOCKER/IMPROVEMENT/OBSERVATION), suggested fixes, quality rating
   * @throws Error on timeout or API failure
   */
  critiqueGraph(args: CritiqueGraphArgs, opts: CallOpts): Promise<CritiqueGraphResult>;
}

/**
 * Stream event types for SSE-based draft generation.
 */
export type DraftStreamEvent =
  | { type: 'stage'; stage: string; data?: unknown }
  | { type: 'partial'; graph: Partial<GraphT> }
  | { type: 'complete'; result: DraftGraphResult }
  | { type: 'error'; error: string };
