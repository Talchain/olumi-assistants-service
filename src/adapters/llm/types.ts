/**
 * Provider-agnostic LLM adapter interface for multi-provider orchestration.
 *
 * All adapters (Anthropic, OpenAI, etc.) must implement this interface to ensure
 * consistent behavior across providers while respecting spec v04 constraints.
 */

import type { GraphT } from "../../schemas/graph.js";
import type { DocPreview } from "../../services/docProcessing.js";
import type { CorrectionCollector } from "../../cee/corrections.js";
import type { ObservabilityCollector } from "../../cee/observability/index.js";

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
  /**
   * Pre-formatted BriefSignals context header string (e.g. `[BRIEF_SIGNALS v1] options=2 ...`).
   * Includes the `[BRIEF_SIGNALS v1]` prefix and leading newlines.
   * Must be appended after the compliance reminder in the user message.
   * Already sanitised and bounded — safe to append directly.
   * Populated by the route handler from the preflight decision result;
   * undefined when signals are unavailable (rejected briefs, flag disabled).
   */
  briefSignalsHeader?: string;
  /**
   * Pre-formatted currency context instruction (e.g. `[CURRENCY_CONTEXT] ...`).
   * Includes leading newlines. Appended after briefSignalsHeader in the user message.
   * Built by `buildCurrencyInstruction()` from the detected currency signal;
   * undefined when currency detection is disabled.
   */
  currencyInstruction?: string;
  /**
   * System-side corrective directive appended to the draft prompt OUTSIDE the
   * untrusted-user-content markers (system authority, not user text). Used by
   * the lean-retry backstop and the strength-default nudge. Threaded here —
   * rather than concatenated into `brief` — so it lands after the
   * `[END_UNTRUSTED_USER_CONTENT]` marker at the adapter (#595 review P2: a
   * corrective instruction spliced into the brief rides INSIDE the untrusted
   * markers, telling the model to treat its own retry instruction as untrusted
   * user input). Undefined on a normal first attempt.
   */
  systemDirective?: string;
  /**
   * Extended thinking configuration. Anthropic only — non-Anthropic adapters ignore this.
   * When enabled, temperature is automatically set to 1 and structured outputs are disabled.
   */
  thinking?: ThinkingConfig;
}

/**
 * Result from drafting a decision graph.
 */
export interface DraftGraphResult {
  graph: GraphT;
  rationales?: Array<{ target: string; why: string }>;
  questions?: Array<{ question: string; context?: string }>;
  /** Goal constraints emitted by the LLM (from structured outputs).
   *  Merged with regex-extracted constraints in Stage 4 compound-goals. */
  goal_constraints?: Array<Record<string, unknown>>;
  /** v0.11.0 schema amendment: LLM coaching block, validated against the
   *  canonical CoachingSchema after the legacy ingress normaliser converts
   *  v192b array shapes to canonical objects. Required at the LLM boundary;
   *  optional here so legacy callers that pre-date v0.11.0 still compile. */
  coaching?: unknown;
  /** v0.11.0 schema amendment: LLM causal claims discriminated union. */
  causal_claims?: unknown;
  /** v0.11.0 schema amendment: LLM topology plan (string[]). */
  topology_plan?: unknown;
  debug?: {
    influence_scores?: Array<{ node_id: string; score: number }>;
    [key: string]: unknown;
  };
  /**
   * Provider/prompt observability metadata.
   * Safe fields should always be populated when available.
   * Unsafe fields must only be populated when explicitly gated by the caller.
   */
  meta?: {
    // Safe
    model: string;
    prompt_version?: string;
    prompt_text_version?: string;
    prompt_hash?: string;
    temperature?: number;
    max_tokens?: number;
    seed?: number;
    reasoning_effort?: "low" | "medium" | "high";
    token_usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    finish_reason?: string;
    provider_latency_ms?: number;

    // 2026-07-23 firefight: true when this draft was recovered from a max_tokens
    // truncation by closing the partial JSON (salvage) instead of re-drafted.
    salvaged_from_truncation?: boolean;

    // Lane C (2026-07-23): the Anthropic draft call is STREAMED with early
    // runaway detection + cheap abort-retry. runaway_abort_count = how many
    // doomed attempts were aborted before this draft succeeded (0 on a clean
    // first try); time_to_edges_ms = stream time to the first edge, which
    // validates the runaway-detection deadline live.
    streamed?: boolean;
    runaway_abort_count?: number;
    time_to_edges_ms?: number | null;

    // Safe diagnostics
    node_kinds_raw_json?: string[];

    // Prompt cache diagnostics (for debugging multi-instance cache issues)
    instance_id?: string;
    cache_age_ms?: number;
    cache_status?: 'fresh' | 'stale' | 'expired' | 'miss';
    use_staging_mode?: boolean;

    // Pipeline checkpoint / provenance fields (for debug bundles)
    prompt_source?: 'store' | 'default';
    prompt_store_version?: number | null;
    pipeline_checkpoints?: unknown[];

    // Structured outputs telemetry
    structured_outputs_used?: boolean;

    // Unsafe (admin-gated)
    raw_output_preview?: string;
    raw_llm_text?: string;
    raw_llm_json?: unknown;
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
 * Arguments for explaining a graph patch.
 */
export interface ExplainDiffArgs {
  patch: {
    adds: {
      nodes: Array<{ id?: string; kind?: string; label?: string; [key: string]: unknown }>;
      edges: Array<{ id?: string; from: string; to: string; [key: string]: unknown }>;
    };
    updates: Array<unknown>;
    removes: Array<unknown>;
  };
  brief?: string;
  graph_summary?: {
    node_count: number;
    edge_count: number;
  };
}

/**
 * A rationale explaining why a change was made.
 */
export interface DiffRationale {
  target: string;
  why: string;
  provenance_source?: string;
}

/**
 * Result from explaining a patch.
 */
export interface ExplainDiffResult {
  rationales: DiffRationale[];
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
  /** Pre-formatted currency context instruction to append to repair prompt. */
  currencyInstruction?: string;
}

/**
 * Rationale entry from the repair prompt (repair_graph_v8+).
 * Different from draft rationales ({target, why}) — repair rationales
 * describe which violation was fixed and how.
 */
export interface RepairRationale {
  violation_code: string;
  node_or_edge: string;
  action: string;
  elements_changed: number;
}

/**
 * Result from repairing a graph.
 */
export interface RepairGraphResult {
  graph: GraphT;
  rationales?: RepairRationale[];
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
  /** Pre-formatted currency context instruction to append to clarify prompt. */
  currencyInstruction?: string;
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
  docs?: DocPreview[];
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
 * Extended thinking configuration for Anthropic models.
 * Only supported by claude-sonnet-4-6 and later.
 * Non-Anthropic adapters ignore this field.
 */
export type ThinkingConfig =
  | { type: 'enabled'; budget_tokens: number }
  | { type: 'disabled' };

export interface ChatArgs {
  /** System prompt for the conversation */
  system: string;
  /** User message content */
  userMessage: string;
  /** Temperature for response generation (0-1, default: 0 for determinism) */
  temperature?: number;
  /** Maximum tokens to generate (default: 4096) */
  maxTokens?: number;
  /** When 'json_object', instructs the provider to return valid JSON only.
   *  OpenAI: sets response_format. Anthropic: no-op (prompt must enforce). */
  responseFormat?: 'json_object';
  /**
   * Extended thinking configuration. Anthropic only — non-Anthropic adapters ignore this.
   * When enabled, temperature is automatically set to 1 (Anthropic requirement).
   */
  thinking?: ThinkingConfig;
  /**
   * JSON Schema for Anthropic Structured Outputs (output_config.format).
   * When provided and the model supports it, guarantees the response matches this schema.
   * Incompatible with extended thinking — automatically skipped when thinking is enabled.
   * Non-Anthropic adapters ignore this field.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Text appended to `userMessage` ONLY when `outputSchema` is actually
   * active (flag on + model in the structured-outputs allowlist + thinking
   * disabled) — the caller decides whether structured mode needs extra
   * instruction (e.g. "emit these fields as JSON-encoded strings") without
   * the adapter needing to know per-call-site schema semantics. Mirrors
   * the `STRUCTURED_OUTPUTS_AUX_STRING_REMINDER` pattern already used by
   * the draft_graph path (Lane 26). Non-Anthropic adapters ignore this field.
   */
  structuredOutputsUserReminder?: string;
  /**
   * Per-call EXTENSION of the structured-outputs model allowlist: models the
   * CALLER has verified as structured-outputs-capable, consulted for this
   * call only. Exists so one call path (the V6 dual-draft M2 review, which is
   * structured-outputs-only by design) can use structured outputs on a model
   * that is deliberately kept OUT of the adapter's shared allowlist —
   * shared-set membership is also consulted by strict tool calling
   * (buildStrictAnthropicTools) for every live /orchestrate/v2/turn with NO
   * env gate, and flips the edit_graph/draft prompt-only fallbacks when
   * CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true. This field changes NOTHING for
   * call sites that do not pass it. Still subject to
   * CEE_ANTHROPIC_STRUCTURED_OUTPUTS and the thinking-disabled requirement.
   * Non-Anthropic adapters ignore this field.
   */
  structuredOutputsAdditionalModels?: readonly string[];
}

/**
 * Result from a generic chat completion.
 */
export interface ChatResult {
  /** The generated text content */
  content: string;
  /** Token usage metrics for cost tracking */
  usage: UsageMetrics;
  /** Model that was used */
  model: string;
  /** Provider-side latency in milliseconds */
  latencyMs: number;
  /**
   * Raw provider stop/finish reason for the terminal completion (Anthropic
   * `stop_reason`, OpenAI `finish_reason`). Additive and optional — `null`
   * when the provider/path does not expose it. Surfaced for per-turn
   * observability (R7 edit_graph turn event); existing consumers ignore it.
   */
  stopReason?: string | null;
}

/**
 * Call options passed to all adapter methods for request tracking and timeouts.
 */
export interface CallOpts {
  requestId: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  /** External abort signal (e.g. client disconnect / budget cancellation).
   *  Preferred over abortSignal — both are supported for backward compatibility. */
  signal?: AbortSignal;
  bypassCache?: boolean; // Bypass prompt cache: invalidates cache and forces fresh load from Supabase (?supa=1 or X-CEE-Refresh-Prompt header)
  forceDefault?: boolean; // Force use of hardcoded default prompt instead of store prompt (?default=1 URL param)
  /**
   * Upper bound on the draft call's derived max_tokens (the "runaway sentinel").
   * When set, the adapter caps the timeout-derived affordable budget at this
   * value (`resolveDraftMaxTokens` ceiling arg) — it can only ever LOWER the
   * budget, never raise it past what the timeout affords. Anthropic draft path
   * only; other adapters ignore it. See DRAFT_ATTEMPT1_MAX_TOKENS_SENTINEL.
   */
  maxTokensCeiling?: number;
  collector?: CorrectionCollector; // Graph corrections tracking
  observabilityCollector?: ObservabilityCollector; // LLM call observability tracking
}

/**
 * Provider-agnostic LLM adapter interface.
 *
 * All methods must:
 * - Respect graph caps from centralized configuration (default: ≤50 nodes, ≤200 edges, DAG only)
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

  /**
   * Explain why changes were made in a graph patch.
   *
   * @param args - Patch (adds/updates/removes), optional brief/graph summary
   * @param opts - Request ID, timeout, abort signal
   * @returns Rationales explaining each change with provenance
   * @throws Error on timeout or API failure
   */
  explainDiff(args: ExplainDiffArgs, opts: CallOpts): Promise<ExplainDiffResult>;

  /**
   * Generic chat completion for non-graph-specific LLM calls.
   *
   * This method provides a standard way to make LLM calls that don't fit
   * the graph-specific methods (draftGraph, critiqueGraph, etc.). It uses
   * the same infrastructure: retry logic, timeout handling, telemetry, and
   * error classification.
   *
   * @param args - System prompt, user message, optional temperature/maxTokens
   * @param opts - Request ID, timeout, abort signal
   * @returns Generated text content with usage metrics
   * @throws UpstreamTimeoutError on timeout
   * @throws UpstreamHTTPError on API errors
   */
  chat(args: ChatArgs, opts: CallOpts): Promise<ChatResult>;

  /**
   * Native tool calling for multi-turn orchestration.
   *
   * Uses Anthropic native tool_use content blocks rather than structured JSON output.
   * Optional — only implemented by adapters that support native tool calling.
   *
   * @param args - System prompt, messages, tool definitions, optional tool_choice/temperature/maxTokens
   * @param opts - Request ID, timeout, abort signal
   * @returns Content blocks (text + tool_use), stop reason, usage metrics
   * @throws UpstreamTimeoutError on timeout
   * @throws UpstreamHTTPError on API errors
   * @throws UnsupportedOperationError if adapter does not support tool calling
   */
  chatWithTools?(args: ChatWithToolsArgs, opts: CallOpts): Promise<ChatWithToolsResult>;

  /**
   * Optional: Stream chat with tools for incremental SSE delivery.
   * Text deltas emit immediately. Tool input accumulates until complete.
   * Final message_complete carries the full ChatWithToolsResult.
   *
   * If not implemented, callers should fall back to chatWithTools().
   */
  streamChatWithTools?(args: ChatWithToolsArgs, opts: CallOpts): AsyncIterable<ChatWithToolsStreamEvent>;
}

/**
 * Tool definition for native tool calling (Anthropic format).
 * input_schema follows JSON Schema structure.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * A content block in a tool-calling response.
 */
export type ToolResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/**
 * ROADMAP 1.55(b) — a VERBATIM extended-thinking block captured for
 * API-BOUND REPLAY ONLY.
 *
 * Anthropic's extended-thinking + tool-use protocol requires the complete,
 * unmodified thinking block(s) to be echoed on the assistant message that
 * carries the tool_use when tool_results are returned (400
 * invalid_request_error otherwise — "`thinking` or `redacted_thinking`
 * blocks in the latest assistant message cannot be modified"). The
 * REPAIR_ONCE path prepends these to the API-bound repair message.
 *
 * `signature` / `data` are Anthropic's opaque replay tokens — NOT reasoning
 * content. These blocks must NEVER be pushed into
 * {@link ChatWithToolsResult.content}, joined into orientationText /
 * assistant_text, or serialised onto any client-facing wire. The only legal
 * destination is the `messages` array of a follow-up Anthropic call.
 */
export type ReplayThinkingBlock =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

/**
 * Arguments for chat with native tool calling.
 */
/**
 * A system content block for prompt caching. The static prefix block is marked
 * with cache_control so Anthropic can cache the KV vectors across turns.
 */
export interface SystemCacheBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ChatWithToolsArgs {
  /** System prompt for the conversation */
  system: string;
  /**
   * Full message history (multi-turn). Assistant-message content may carry
   * {@link ReplayThinkingBlock}s ONLY when echoing a prior thinking-bearing
   * Anthropic response (REPAIR_ONCE protocol replay — ROADMAP 1.55b). The
   * Anthropic adapter passes them through verbatim; non-Anthropic adapters
   * skip unknown block types.
   */
  messages: Array<{ role: 'user' | 'assistant'; content: string | Array<ToolResponseBlock | ReplayThinkingBlock> }>;
  /** Tool definitions available to the model */
  tools: ToolDefinition[];
  /** Tool choice strategy */
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  /** Temperature for response generation (0-1, default: 0 for determinism) */
  temperature?: number;
  /** Maximum tokens to generate (default: 4096) */
  maxTokens?: number;
  /**
   * Pre-split system blocks for prompt caching. When provided, the Anthropic adapter
   * uses these blocks (with cache_control markers) instead of the plain `system` string.
   * The first block should be the static prefix (Zone 1), marked with cache_control.
   * Non-Anthropic adapters ignore this field and fall back to `system`.
   */
  system_cache_blocks?: SystemCacheBlock[];
  /**
   * Extended thinking configuration. Anthropic only — non-Anthropic adapters ignore this.
   * When enabled, temperature is automatically set to 1 (Anthropic requirement).
   */
  thinking?: ThinkingConfig;
}

/**
 * Result from chat with native tool calling.
 */
export interface ChatWithToolsResult {
  /** Array of text and/or tool_use content blocks */
  content: ToolResponseBlock[];
  /** Why the model stopped generating */
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  /** Token usage metrics for cost tracking */
  usage: UsageMetrics;
  /** Model that was used */
  model: string;
  /** Provider-side latency in milliseconds */
  latencyMs: number;
  /**
   * ROADMAP 1.42 — captured extended-thinking text, VERBATIM, when
   * CEE_REASONING_CAPTURE_ENABLED is on and the model emitted `thinking`
   * blocks. Never populated with `signature` or `redacted_thinking`
   * content. Absent (undefined) when the flag is off or no thinking
   * blocks were emitted — existing drop+warn behaviour is unchanged.
   *
   * Deliberately NOT part of `content` / `ToolResponseBlock`: `content` is
   * echoed back to Anthropic on the REPAIR_ONCE path (see
   * route-with-tool-use.ts buildRepairMessages) and joined into
   * orientationText. Putting reasoning there would recreate the #385 leak
   * and risk a protocol-echo 400 from Anthropic (thinking blocks require a
   * signature to be replayed validly).
   */
  reasoning?: string;
  /**
   * ROADMAP 1.55(b) — VERBATIM thinking / redacted_thinking blocks from the
   * response, captured UNCONDITIONALLY (no flag) for API-BOUND REPLAY ONLY.
   * The REPAIR_ONCE path prepends these to the assistant echo so the repair
   * call satisfies Anthropic's thinking-with-tool-use protocol.
   *
   * Contains `signature` (opaque replay token) — this field must never be
   * serialised to any client-facing surface (assistant_text, orientation
   * text, SSE frames, debug wire payloads). See {@link ReplayThinkingBlock}.
   * Absent when the response carried no thinking blocks.
   */
  replay_thinking_blocks?: ReplayThinkingBlock[];
}

/**
 * Stream event types for chat-with-tools streaming.
 * Text deltas emit immediately. Tool input accumulates until content_block_stop.
 * Final message_complete carries the full assembled ChatWithToolsResult.
 */
export type ChatWithToolsStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_input_start'; tool_id: string; tool_name: string }
  | { type: 'tool_input_complete'; tool_id: string; tool_name: string; input: Record<string, unknown> }
  | { type: 'message_complete'; result: ChatWithToolsResult };

/**
 * Stream event types for SSE-based draft generation.
 */
export type DraftStreamEvent =
  | { type: 'stage'; stage: string; data?: unknown }
  | { type: 'partial'; graph: Partial<GraphT> }
  | { type: 'complete'; result: DraftGraphResult }
  | { type: 'error'; error: string };

/**
 * Structured event for graph capping telemetry.
 * Used by both OpenAI and Anthropic adapters for consistent log aggregation.
 */
export interface GraphCappedEvent {
  event: 'cee.repair.graph_capped';
  adapter: 'openai' | 'anthropic';
  path: 'repair' | 'draft';
  nodes: {
    before: number;
    after: number;
    max: number;
    capped: boolean;
  };
  edges: {
    before: number;
    after: number;
    max: number;
    capped: boolean;
  };
  /** Caller-provided request ID for distributed tracing */
  request_id?: string;
  /** Anthropic API idempotency key (adapter-specific) */
  idempotency_key?: string;
}
