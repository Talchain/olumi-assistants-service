import OpenAI from "openai";
import { z } from "zod";
import { Agent, setGlobalDispatcher } from "undici";
import type { DocPreview } from "../../services/docProcessing.js";
import { HTTP_CLIENT_TIMEOUT_MS, REASONING_MODEL_TIMEOUT_MS } from "../../config/timeouts.js";
import { config } from "../../config/index.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import { ProvenanceSource, NodeKind, StructuredProvenance, NodeData } from "../../schemas/graph.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../config/graphCaps.js";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { formatEdgeId } from "../../cee/corrections.js";
import { withRetry } from "../../utils/retry.js";
import type { LLMAdapter, DraftGraphArgs, DraftGraphResult, SuggestOptionsArgs, SuggestOptionsResult, RepairGraphArgs, RepairGraphResult, CallOpts, GraphCappedEvent } from "./types.js";
import { UpstreamTimeoutError, UpstreamHTTPError } from "./errors.js";
import { makeIdempotencyKey } from "./idempotency.js";
import { generateDeterministicLayout } from "../../utils/layout.js";
import { normaliseDraftResponse, ensureControllableFactorBaselines } from "./normalisation.js";
import { getMaxTokensFromConfig } from "./router.js";
import { getSystemPrompt, getSystemPromptMeta } from './prompt-loader.js';
import { isReasoningModel } from "../../config/models.js";

// ============================================================================
// Zod schemas for OpenAI response validation (same as Anthropic)
const OpenAINode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
  // Node data depends on kind: FactorData for factors, OptionData (interventions) for options
  data: NodeData.optional(),
});

// V4 edge strength schema (nested object from LLM)
const EdgeStrength = z.object({
  mean: z.number(),
  std: z.number().positive(),
}).optional();

const OpenAIEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  // V4 format (preferred) - from v4 prompt (nested)
  strength: EdgeStrength,
  exists_probability: z.number().min(0).max(1).optional(),
  // V4 format (flat) - added by normaliseDraftResponse()
  strength_mean: z.number().optional(),
  strength_std: z.number().optional(),
  belief_exists: z.number().optional(),
  effect_direction: z.enum(["positive", "negative"]).optional(),
  // Legacy format (deprecated, for backwards compatibility during transition)
  weight: z.number().optional(),
  belief: z.number().min(0).max(1).optional(),
  provenance: StructuredProvenance.optional(),
  provenance_source: ProvenanceSource.optional(),
});

const OpenAIDraftResponse = z.object({
  nodes: z.array(OpenAINode),
  edges: z.array(OpenAIEdge),
  rationales: z.array(z.object({ target: z.string(), why: z.string() })).optional(),
});

const OpenAIOptionsResponse = z.object({
  options: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(3),
      pros: z.array(z.string()).min(2).max(3),
      cons: z.array(z.string()).min(2).max(3),
      evidence_to_gather: z.array(z.string()).min(2).max(3),
    })
  ),
});

const OpenAIClarifyResponse = z.object({
  questions: z.array(
    z.object({
      question: z.string().min(10),
      choices: z.array(z.string()).optional(),
      why_we_ask: z.string().min(20),
      impacts_draft: z.string().min(20),
    })
  ).min(1).max(5),
  confidence: z.number().min(0).max(1),
  should_continue: z.boolean(),
});

// Use centralized config for API key (lazy access via getter)
function getApiKey(): string | undefined {
  return config.llm.openaiApiKey;
}

// V04: Undici dispatcher with production-grade timeouts
// - connectTimeout: 3s (fail fast on connection issues)
// - headers/body timeout: HTTP_CLIENT_TIMEOUT_MS (central config)
// Note: OpenAI SDK v6 uses fetch API, so we set global undici dispatcher
const undiciAgent = new Agent({
  connect: {
    timeout: 3000, // 3s
  },
  headersTimeout: HTTP_CLIENT_TIMEOUT_MS,
  bodyTimeout: HTTP_CLIENT_TIMEOUT_MS,
});

// Set global dispatcher for fetch API (affects all fetch calls in this module)
setGlobalDispatcher(undiciAgent);

// Lazy initialization to allow testing without API key
let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required but not set");
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

const TIMEOUT_MS = HTTP_CLIENT_TIMEOUT_MS;

/**
 * Get the appropriate timeout for a model.
 * Reasoning models get extended timeout (180s), standard models get default (110s).
 */
function getTimeoutForModel(model: string): number {
  return isReasoningModel(model) ? REASONING_MODEL_TIMEOUT_MS : TIMEOUT_MS;
}

/**
 * Build model-specific parameters for OpenAI API calls.
 * Reasoning models require different parameters than standard models.
 *
 * @param model - The model ID being used
 * @param temperature - The temperature value for non-reasoning models
 * @param maxTokens - The max tokens value
 * @returns Object with appropriate parameters for the model type
 */
/** @internal Exported for testing only */
export function buildModelParams(
  model: string,
  temperature: number,
  maxTokens?: number
): {
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
} {
  if (isReasoningModel(model)) {
    // Reasoning models: use reasoning_effort, omit temperature, use max_completion_tokens
    return {
      reasoning_effort: "medium",
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
    };
  } else {
    // Standard models: use temperature and max_tokens
    return {
      temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    };
  }
}

function buildRepairPrompt(graph: GraphT, violations: string[]): string {
  return `You are fixing validation errors in a decision graph.

## Current Graph (INVALID)
${JSON.stringify(graph, null, 2)}

## Validation Errors
${violations.map((v, i) => `${i + 1}. ${v}`).join("\n")}

## Your Task
Fix ALL violations while preserving as much structure as possible:
- Remove cycles (make it a DAG)
- Remove edges referencing non-existent nodes
- Cap at ${GRAPH_MAX_NODES} nodes and ${GRAPH_MAX_EDGES} edges
- Maintain structured provenance on all edges
- Keep stable node IDs (don't change IDs unless necessary)

## CRITICAL: Edge Direction Rules
Edges represent CAUSAL influence: "from" node CAUSES or INFLUENCES "to" node.

**The goal node MUST be a TERMINAL SINK with ZERO outgoing edges.**

Correct directions:
- decision → option (frames options)
- option → outcome (leads to outcome)
- outcome → goal (contributes to goal)
- factor → option (affects viability)
- risk → goal (detracts from goal)

**WRONG directions to FIX:**
- goal → anything (reverse these edges or remove)
- outcome → option (reverse or remove)

## Output Format (JSON)
Return ONLY the repaired graph as valid JSON:
{
  "nodes": [...],
  "edges": [...],
  "rationales": [{"target": "node_id", "why": "why this fix was needed"}]
}

IMPORTANT: Return ONLY the JSON object, no markdown formatting`;
}

function buildSuggestOptionsPrompt(goal: string, constraints?: Record<string, unknown>, existingOptions?: string[]): string {
  const existingContext = existingOptions?.length
    ? `\n\n## Existing Options\nAvoid duplicating these:\n${existingOptions.map((o) => `- ${o}`).join("\n")}`
    : "";

  const constraintsContext = constraints
    ? `\n\n## Constraints\n${JSON.stringify(constraints, null, 2)}`
    : "";

  return `You are an expert at generating strategic options for decisions.

## Goal
${goal}
${constraintsContext}${existingContext}

## Your Task
Generate 3-5 distinct, actionable options. For each option provide:
- id: short lowercase identifier (e.g., "extend_trial", "in_app_nudges")
- title: concise name (3-8 words)
- pros: 2-3 advantages
- cons: 2-3 disadvantages or risks
- evidence_to_gather: 2-3 data points or metrics to collect

IMPORTANT: Each option must be distinct. Do not duplicate existing options or create near-duplicates.

## Output Format (JSON)
Return ONLY valid JSON:
{
  "options": [
    {
      "id": "opt_1",
      "title": "Option Title",
      "pros": ["Pro 1", "Pro 2"],
      "cons": ["Con 1", "Con 2"],
      "evidence_to_gather": ["Metric 1", "Metric 2"]
    }
  ]
}

Return ONLY the JSON object, no markdown formatting`;
}

function buildClarifyBriefPrompt(
  brief: string,
  round: number,
  previousAnswers?: Array<{ question: string; answer: string }>
): string {
  const previousContext = previousAnswers?.length
    ? `\n\n## Previous Q&A (Round ${round - 1})\n${previousAnswers
        .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`)
        .join("\n\n")}`
    : "";

  const roundContext = round > 1
    ? `This is clarification round ${round}. Build on previous answers to deepen understanding.`
    : "This is the first round of clarification.";

  return `You are an expert decision coach helping to clarify a decision brief before drafting a decision graph.

## User's Brief
${brief}
${previousContext}

## Context
${roundContext}

## Your Task
Generate 1-5 clarifying questions to help understand:
1. The decision context and constraints
2. Key stakeholders and their interests
3. Success criteria and priorities
4. Available options and alternatives
5. Risks and uncertainties

For each question:
- question: A clear, specific question (at least 10 characters)
- choices: Optional array of 2-4 suggested answers (if applicable)
- why_we_ask: Explain why this information matters (at least 20 characters)
- impacts_draft: How the answer will improve the decision graph (at least 20 characters)

Also assess:
- confidence: 0-1 score indicating how well you understand the decision (1.0 = fully clear)
- should_continue: boolean - true if more rounds are needed, false if ready to draft

## Guidelines
- Ask specific questions, not vague ones
- Prioritize questions that will most impact the decision graph quality
- If confidence is high (>0.8) or after round 3, set should_continue to false
- Avoid repeating questions already answered

## Output Format (JSON)
Return ONLY valid JSON:
{
  "questions": [
    {
      "question": "What is your primary goal?",
      "choices": ["Increase revenue", "Reduce costs", "Improve quality", "Other"],
      "why_we_ask": "Understanding the primary goal helps prioritize options",
      "impacts_draft": "This determines which outcomes to optimize for in the graph"
    }
  ],
  "confidence": 0.5,
  "should_continue": true
}

Return ONLY the JSON object, no markdown formatting`;
}

/**
 * Max size for raw LLM output in debug trace (chars).
 * Truncates large responses to prevent payload bloat.
 */
const RAW_LLM_OUTPUT_MAX_CHARS = 50000;

const RAW_LLM_TEXT_MAX_CHARS = 10_000;
const RAW_LLM_PREVIEW_MAX_CHARS = 500;

/**
 * Truncate raw LLM output for debug tracing.
 * Returns the output with a truncation flag if over limit.
 */
function truncateRawOutput(raw: unknown): { output: unknown; truncated: boolean } {
  const jsonStr = JSON.stringify(raw);
  if (jsonStr.length <= RAW_LLM_OUTPUT_MAX_CHARS) {
    return { output: raw, truncated: false };
  }
  // Truncate and add marker
  const truncatedStr = jsonStr.slice(0, RAW_LLM_OUTPUT_MAX_CHARS);
  return {
    output: { _truncated: true, _original_size: jsonStr.length, preview: truncatedStr },
    truncated: true,
  };
}

function sortGraph(graph: { nodes: NodeT[]; edges: EdgeT[] }): { nodes: NodeT[]; edges: EdgeT[] } {
  const nodesSorted = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));

  // Assign stable IDs to edges if missing
  const edgesWithIds = graph.edges.map((edge, idx) => ({
    ...edge,
    id: edge.id || `${edge.from}::${edge.to}::${idx}`,
  }));

  const edgesSorted = [...edgesWithIds].sort((a, b) => {
    const from = a.from.localeCompare(b.from);
    if (from !== 0) return from;
    const to = a.to.localeCompare(b.to);
    if (to !== 0) return to;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });

  return { nodes: nodesSorted, edges: edgesSorted };
}

/**
 * OpenAI adapter implementing the LLMAdapter interface.
 * Uses OpenAI's chat completion API with JSON mode for structured outputs.
 */
export class OpenAIAdapter implements LLMAdapter {
  readonly name = 'openai' as const;
  readonly model: string;

  constructor(model?: string) {
    // Default to gpt-4o-mini; task routing (e.g., draft_graph → gpt-5.2) handled by model-routing.ts
    this.model = model || config.llm.model || 'gpt-4o-mini';
  }

  async draftGraph(args: DraftGraphArgs, opts: CallOpts): Promise<DraftGraphResult> {
    const { brief, docs = [], seed } = args;
    const collector = opts.collector;

    // V4: Use shared prompt management system (same as Anthropic adapter)
    const systemPrompt = getSystemPrompt('draft_graph');
    const promptMeta = getSystemPromptMeta('draft_graph');

    // Build user content with brief and documents
    const docContext = docs.length
      ? `\n\n## Attached Documents\n${docs
          .map((d) => {
            const locationInfo = d.locationHint ? ` (${d.locationHint})` : "";
            return `**${d.source}** (${d.type}${locationInfo}):\n${d.preview}`;
          })
          .join("\n\n")}`
      : "";
    const userContent = `## Brief\n${brief}${docContext}`;

    // V04: Generate idempotency key for request traceability
    const idempotencyKey = makeIdempotencyKey();
    const startTime = Date.now();

    log.info(
      { brief_chars: brief.length, doc_count: docs.length, model: this.model, provider: 'openai', idempotency_key: idempotencyKey },
      "calling OpenAI for draft"
    );

    const abortController = new AbortController();
    const effectiveTimeout = opts.timeoutMs || getTimeoutForModel(this.model);
    const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

    try {
      const apiClient = getClient();
      const maxTokens = getMaxTokensFromConfig('draft_graph');
      const modelParams = buildModelParams(this.model, 0, maxTokens);
      const temperature = 'temperature' in modelParams
        ? (modelParams as any).temperature as number
        : undefined;

      // Debug: Log model parameters for runtime validation
      log.debug({
        model: this.model,
        reasoning: isReasoningModel(this.model),
        params: {
          has_temperature: 'temperature' in modelParams,
          has_reasoning_effort: 'reasoning_effort' in modelParams,
          has_max_completion_tokens: 'max_completion_tokens' in modelParams,
          has_max_tokens: 'max_tokens' in modelParams,
        },
        timeout_ms: effectiveTimeout,
      }, "[OpenAI] draft_graph request parameters");

      const response = await withRetry(
        async () =>
          apiClient.chat.completions.create(
            {
              model: this.model,
              // V4: Use system + user messages (same as Anthropic adapter)
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
              response_format: { type: "json_object" },
              seed: seed, // OpenAI supports deterministic seed
              ...modelParams,
            },
            {
              signal: abortController.signal as any,
              headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
            }
          ),
        {
          adapter: "openai",
          model: this.model,
          operation: "draft_graph",
        }
      );

      clearTimeout(timeoutId);
      const _elapsedMs = Date.now() - startTime;

      const content = response.choices[0]?.message?.content;
      if (!content) {
        log.error({ response }, "OpenAI returned empty content");
        throw new Error("openai_empty_response");
      }

      const finishReason = response.choices[0]?.finish_reason;

      // Parse, normalise non-standard node kinds, ensure factor baselines, then validate with Zod
      const rawJson = JSON.parse(content);
      const rawNodeKinds = Array.isArray((rawJson as any)?.nodes)
        ? ((rawJson as any).nodes as any[])
          .map((n: any) => n?.kind ?? n?.type ?? 'unknown')
          .filter(Boolean)
        : [];
      const normalised = normaliseDraftResponse(rawJson);
      const { response: withBaselines, defaultedFactors } = ensureControllableFactorBaselines(normalised);
      if (defaultedFactors.length > 0) {
        log.info({ defaultedFactors }, `Defaulted baseline values for ${defaultedFactors.length} controllable factor(s)`);
      }
      const parseResult = OpenAIDraftResponse.safeParse(withBaselines);

      if (!parseResult.success) {
        const flatErrors = parseResult.error.flatten();

        // Capture truncated raw output for debugging (before throwing)
        const rawOutputSample = (() => {
          try {
            const serialized = JSON.stringify(rawJson);
            return serialized.length > 500 ? serialized.slice(0, 500) + '...[truncated]' : serialized;
          } catch {
            return '[serialization failed]';
          }
        })();

        log.error({
          errors: flatErrors,
          raw_node_kinds: Array.isArray(rawJson?.nodes)
            ? rawJson.nodes.map((n: any) => n?.kind).filter(Boolean)
            : [],
          raw_output_sample: rawOutputSample,
          event: 'llm.validation.schema_failed'
        }, "OpenAI response failed schema validation after normalisation");

        // Build detailed error message for debugging
        const fieldIssues = Object.entries(flatErrors.fieldErrors || {})
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
          .join('; ');
        const formIssues = (flatErrors.formErrors || []).join('; ');
        const details = [fieldIssues, formIssues].filter(Boolean).join(' | ');

        throw new Error(`openai_response_invalid_schema: ${details || 'unknown validation error'}`);
      }

      const parsed = parseResult.data;

      // Validate and cap node/edge counts
      if (parsed.nodes.length > GRAPH_MAX_NODES) {
        log.warn({ count: parsed.nodes.length, max: GRAPH_MAX_NODES }, "OpenAI returned too many nodes, capping");
        parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES);
      }

      if (parsed.edges.length > GRAPH_MAX_EDGES) {
        log.warn({ count: parsed.edges.length, max: GRAPH_MAX_EDGES }, "OpenAI returned too many edges, capping");
        parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES);
      }

      // Filter edges to only valid node IDs (Stage 5: Dangling Edge Filter #1)
      const nodeIds = new Set(parsed.nodes.map((n) => n.id));
      const danglingEdges = parsed.edges.filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));

      if (danglingEdges.length > 0) {
        log.warn({
          event: "llm.draft.dangling_edges_removed",
          removed_count: danglingEdges.length,
          dangling_edges: danglingEdges.map((e) => ({
            from: e.from,
            to: e.to,
            missing_from: !nodeIds.has(e.from),
            missing_to: !nodeIds.has(e.to),
          })).slice(0, 10),
        }, `Removed ${danglingEdges.length} edge(s) with dangling node references`);

        if (collector) {
          for (const edge of danglingEdges) {
            const missingNode = !nodeIds.has(edge.from) ? edge.from : edge.to;
            collector.addByStage(
              5,
              "edge_removed",
              { edge_id: formatEdgeId(edge.from, edge.to) },
              `Node "${missingNode}" not found`,
              edge,
              null
            );
          }
        }
      }

      const validEdges = parsed.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

      // Sort for determinism
      const sorted = sortGraph({ nodes: parsed.nodes, edges: validEdges });

      // Calculate roots and leaves
      const roots = sorted.nodes
        .filter((n) => !sorted.edges.some((e) => e.to === n.id))
        .map((n) => n.id);
      const leaves = sorted.nodes
        .filter((n) => !sorted.edges.some((e) => e.from === n.id))
        .map((n) => n.id);

      const graph: GraphT = {
        version: "1",
        default_seed: seed,
        nodes: sorted.nodes,
        edges: sorted.edges,
        meta: {
          roots,
          leaves,
          suggested_positions: generateDeterministicLayout(sorted.nodes, sorted.edges, roots),
          source: "assistant",
        },
      };

      // Capture raw LLM output for debug tracing (before normalisation)
      const rawOutput = truncateRawOutput(rawJson);

      const unsafeCaptureEnabled = args.includeDebug === true && args.flags?.unsafe_capture === true;
      const rawTextTruncated = content.length > RAW_LLM_TEXT_MAX_CHARS
        ? content.slice(0, RAW_LLM_TEXT_MAX_CHARS)
        : content;
      const rawPreview = content.length > RAW_LLM_PREVIEW_MAX_CHARS
        ? content.slice(0, RAW_LLM_PREVIEW_MAX_CHARS)
        : content;

      const tokenUsage = {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || ((response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0)),
      };

      return {
        graph,
        rationales: parsed.rationales || [],
        debug: unsafeCaptureEnabled ? {
          raw_llm_output: rawOutput.output,
          raw_llm_output_truncated: rawOutput.truncated,
        } : undefined,
        meta: {
          model: this.model,
          prompt_version: promptMeta.prompt_version,
          prompt_hash: promptMeta.prompt_hash,
          // Diagnostic fields for prompt cache debugging
          instance_id: promptMeta.instance_id,
          cache_age_ms: promptMeta.cache_age_ms,
          cache_status: promptMeta.cache_status,
          use_staging_mode: promptMeta.use_staging_mode,
          temperature,
          max_tokens: maxTokens,
          seed,
          reasoning_effort: isReasoningModel(this.model) ? "medium" : undefined,
          token_usage: tokenUsage,
          finish_reason: typeof finishReason === 'string' ? finishReason : undefined,
          provider_latency_ms: _elapsedMs,
          node_kinds_raw_json: rawNodeKinds,
          // Always include raw output for LLM observability trace (preview + full text for storage)
          raw_output_preview: rawPreview,
          raw_llm_text: rawTextTruncated,
          // Only include parsed JSON when unsafe capture is enabled (admin-gated)
          ...(unsafeCaptureEnabled ? {
            raw_llm_json: rawOutput.output,
          } : {}),
        },
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (error instanceof Error) {
        // V04: Throw typed UpstreamTimeoutError for timeout classification
        if (error.name === "AbortError" || abortController.signal.aborted) {
          log.error({ timeout_ms: effectiveTimeout, elapsed_ms: elapsedMs }, "OpenAI draft call timed out");
          throw new UpstreamTimeoutError(
            "OpenAI draft_graph timed out",
            "openai",
            "draft_graph",
            "body",
            elapsedMs,
            error
          );
        }

        // V04: Check for OpenAI API errors (non-2xx responses)
        // OpenAI SDK throws errors with status and headers properties
        if ('status' in error && typeof error.status === 'number') {
          const apiError = error as any;
          const requestId = apiError.headers?.['x-request-id'] || apiError.request_id;
          log.error(
            { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
            "OpenAI API returned non-2xx status"
          );
          throw new UpstreamHTTPError(
            `OpenAI draft_graph failed: ${apiError.message || 'unknown error'}`,
            "openai",
            apiError.status,
            apiError.code || apiError.type,
            requestId,
            elapsedMs,
            error
          );
        }
      }

      log.error({ error }, "OpenAI draft call failed");
      throw error;
    }
  }

  async suggestOptions(args: SuggestOptionsArgs, opts: CallOpts): Promise<SuggestOptionsResult> {
    const { goal, constraints, existingOptions } = args;
    const prompt = buildSuggestOptionsPrompt(goal, constraints, existingOptions);

    // V04: Generate idempotency key for request traceability
    const idempotencyKey = makeIdempotencyKey();
    const startTime = Date.now();

    log.info({ goal_chars: goal.length, model: this.model, provider: 'openai', idempotency_key: idempotencyKey }, "calling OpenAI for options");

    const abortController = new AbortController();
    const effectiveTimeout = opts.timeoutMs || getTimeoutForModel(this.model);
    const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

    try {
      const apiClient = getClient();
      const maxTokens = getMaxTokensFromConfig('suggest_options');
      const modelParams = buildModelParams(this.model, 0.7, maxTokens); // 0.7 for creativity in options

      // Debug: Log model parameters for runtime validation
      log.debug({
        model: this.model,
        reasoning: isReasoningModel(this.model),
        params: {
          has_temperature: 'temperature' in modelParams,
          has_reasoning_effort: 'reasoning_effort' in modelParams,
          has_max_completion_tokens: 'max_completion_tokens' in modelParams,
          has_max_tokens: 'max_tokens' in modelParams,
        },
        timeout_ms: effectiveTimeout,
      }, "[OpenAI] suggest_options request parameters");

      const response = await withRetry(
        async () =>
          apiClient.chat.completions.create(
            {
              model: this.model,
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
              ...modelParams,
            },
            {
              signal: abortController.signal as any,
              headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
            }
          ),
        {
          adapter: "openai",
          model: this.model,
          operation: "suggest_options",
        }
      );

      clearTimeout(timeoutId);
      const _elapsedMs = Date.now() - startTime;

      const content = response.choices[0]?.message?.content;
      if (!content) {
        log.error({ response }, "OpenAI returned empty content for options");
        throw new Error("openai_empty_response");
      }

      const rawJson = JSON.parse(content);
      const parseResult = OpenAIOptionsResponse.safeParse(rawJson);

      if (!parseResult.success) {
        log.error({ errors: parseResult.error.flatten() }, "OpenAI options response failed schema validation");
        throw new Error("openai_options_invalid_schema");
      }

      return {
        options: parseResult.data.options,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (error instanceof Error) {
        // V04: Throw typed UpstreamTimeoutError for timeout classification
        if (error.name === "AbortError" || abortController.signal.aborted) {
          log.error({ timeout_ms: effectiveTimeout, elapsed_ms: elapsedMs }, "OpenAI options call timed out");
          throw new UpstreamTimeoutError(
            "OpenAI suggest_options timed out",
            "openai",
            "suggest_options",
            "body",
            elapsedMs,
            error
          );
        }

        // V04: Check for OpenAI API errors (non-2xx responses)
        if ('status' in error && typeof error.status === 'number') {
          const apiError = error as any;
          const requestId = apiError.headers?.['x-request-id'] || apiError.request_id;
          log.error(
            { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
            "OpenAI API returned non-2xx status"
          );
          throw new UpstreamHTTPError(
            `OpenAI suggest_options failed: ${apiError.message || 'unknown error'}`,
            "openai",
            apiError.status,
            apiError.code || apiError.type,
            requestId,
            elapsedMs,
            error
          );
        }
      }

      log.error({ error }, "OpenAI options call failed");
      throw error;
    }
  }

  async repairGraph(args: RepairGraphArgs, opts: CallOpts): Promise<RepairGraphResult> {
    const { graph, violations } = args;
    const collector = opts.collector;
    const prompt = buildRepairPrompt(graph, violations);

    // V04: Generate idempotency key for request traceability
    const idempotencyKey = makeIdempotencyKey();
    const startTime = Date.now();

    log.info({ violation_count: violations.length, model: this.model, provider: 'openai', idempotency_key: idempotencyKey }, "calling OpenAI for repair");

    const abortController = new AbortController();
    const effectiveTimeout = opts.timeoutMs || getTimeoutForModel(this.model);
    const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

    try {
      const apiClient = getClient();
      const maxTokens = getMaxTokensFromConfig('repair_graph');
      const modelParams = buildModelParams(this.model, 0, maxTokens);

      // Debug: Log model parameters for runtime validation
      log.debug({
        model: this.model,
        reasoning: isReasoningModel(this.model),
        params: {
          has_temperature: 'temperature' in modelParams,
          has_reasoning_effort: 'reasoning_effort' in modelParams,
          has_max_completion_tokens: 'max_completion_tokens' in modelParams,
          has_max_tokens: 'max_tokens' in modelParams,
        },
        timeout_ms: effectiveTimeout,
      }, "[OpenAI] repair_graph request parameters");

      const response = await withRetry(
        async () =>
          apiClient.chat.completions.create(
            {
              model: this.model,
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
              ...modelParams,
            },
            {
              signal: abortController.signal as any,
              headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
            }
          ),
        {
          adapter: "openai",
          model: this.model,
          operation: "repair_graph",
        }
      );

      clearTimeout(timeoutId);
      const _elapsedMs = Date.now() - startTime;

      const content = response.choices[0]?.message?.content;
      if (!content) {
        log.error({ response }, "OpenAI returned empty content for repair");
        throw new Error("openai_empty_response");
      }

      // Parse, normalise non-standard node kinds, ensure factor baselines, then validate with Zod
      const rawJson = JSON.parse(content);
      const normalised = normaliseDraftResponse(rawJson);
      const { response: withBaselines, defaultedFactors: repairDefaultedFactors } = ensureControllableFactorBaselines(normalised);
      if (repairDefaultedFactors.length > 0) {
        log.info({ defaultedFactors: repairDefaultedFactors }, `Defaulted baseline values for ${repairDefaultedFactors.length} controllable factor(s) in repair`);
      }
      const parseResult = OpenAIDraftResponse.safeParse(withBaselines);

      if (!parseResult.success) {
        const flatErrors = parseResult.error.flatten();
        log.error({
          errors: flatErrors,
          raw_node_kinds: Array.isArray(rawJson?.nodes)
            ? rawJson.nodes.map((n: any) => n?.kind).filter(Boolean)
            : [],
          event: 'llm.validation.repair_schema_failed'
        }, "OpenAI repair response failed schema validation after normalisation");

        const fieldIssues = Object.entries(flatErrors.fieldErrors || {})
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
          .join('; ');
        const formIssues = (flatErrors.formErrors || []).join('; ');
        const details = [fieldIssues, formIssues].filter(Boolean).join(' | ');

        throw new Error(`openai_repair_invalid_schema: ${details || 'unknown validation error'}`);
      }

      const parsed = parseResult.data;

      // Cap node/edge counts with structured telemetry
      const nodesBefore = parsed.nodes.length;
      const edgesBefore = parsed.edges.length;
      const nodesCapped = nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = edgesBefore > GRAPH_MAX_EDGES;

      if (nodesCapped) {
        parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES);
      }
      if (edgesCapped) {
        parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES);
      }

      // Emit single structured event if any capping occurred
      if (nodesCapped || edgesCapped) {
        const cappedEvent: GraphCappedEvent = {
          event: 'cee.repair.graph_capped',
          adapter: 'openai',
          path: 'repair',
          nodes: {
            before: nodesBefore,
            after: parsed.nodes.length,
            max: GRAPH_MAX_NODES,
            capped: nodesCapped,
          },
          edges: {
            before: edgesBefore,
            after: parsed.edges.length,
            max: GRAPH_MAX_EDGES,
            capped: edgesCapped,
          },
          request_id: opts.requestId,
        };
        log.warn(cappedEvent, "OpenAI repair graph capped to limits");
      }

      // Filter edges to only valid node IDs (Stage 5: Dangling Edge Filter #1 - repair path)
      const nodeIds = new Set(parsed.nodes.map((n) => n.id));
      const danglingEdges = parsed.edges.filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));

      if (danglingEdges.length > 0) {
        log.warn({
          event: "llm.repair.dangling_edges_removed",
          removed_count: danglingEdges.length,
          dangling_edges: danglingEdges.map((e) => ({
            from: e.from,
            to: e.to,
            missing_from: !nodeIds.has(e.from),
            missing_to: !nodeIds.has(e.to),
          })).slice(0, 10),
        }, `Repair: Removed ${danglingEdges.length} edge(s) with dangling node references`);

        if (collector) {
          for (const edge of danglingEdges) {
            const missingNode = !nodeIds.has(edge.from) ? edge.from : edge.to;
            collector.addByStage(
              5,
              "edge_removed",
              { edge_id: formatEdgeId(edge.from, edge.to) },
              `Node "${missingNode}" not found`,
              edge,
              null
            );
          }
        }
      }

      const validEdges = parsed.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

      // Sort for determinism
      const sorted = sortGraph({ nodes: parsed.nodes, edges: validEdges });

      const repairedGraph: GraphT = {
        ...graph,
        nodes: sorted.nodes,
        edges: sorted.edges,
      };

      return {
        graph: repairedGraph,
        rationales: parsed.rationales || [],
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (error instanceof Error) {
        // V04: Throw typed UpstreamTimeoutError for timeout classification
        if (error.name === "AbortError" || abortController.signal.aborted) {
          log.error({ timeout_ms: effectiveTimeout, elapsed_ms: elapsedMs }, "OpenAI repair call timed out");
          throw new UpstreamTimeoutError(
            "OpenAI repair_graph timed out",
            "openai",
            "repair_graph",
            "body",
            elapsedMs,
            error
          );
        }

        // V04: Check for OpenAI API errors (non-2xx responses)
        if ('status' in error && typeof error.status === 'number') {
          const apiError = error as any;
          const requestId = apiError.headers?.['x-request-id'] || apiError.request_id;
          log.error(
            { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
            "OpenAI API returned non-2xx status"
          );
          throw new UpstreamHTTPError(
            `OpenAI repair_graph failed: ${apiError.message || 'unknown error'}`,
            "openai",
            apiError.status,
            apiError.code || apiError.type,
            requestId,
            elapsedMs,
            error
          );
        }
      }

      log.error({ error }, "OpenAI repair call failed");
      throw error;
    }
  }

  async clarifyBrief(args: import("./types.js").ClarifyBriefArgs, opts: CallOpts): Promise<import("./types.js").ClarifyBriefResult> {
    const { brief, round, previous_answers, seed } = args;
    const requestId = opts.requestId || `clarify-${Date.now()}`;
    const start = Date.now();

    log.info({ request_id: requestId, round, previous_answers_count: previous_answers?.length ?? 0 }, "Starting OpenAI clarify brief");

    const prompt = buildClarifyBriefPrompt(brief, round, previous_answers);

    const client = getClient();
    const effectiveTimeout = opts.timeoutMs || getTimeoutForModel(this.model);

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(
        () => abortController.abort(),
        effectiveTimeout,
      );

      const maxTokens = getMaxTokensFromConfig('clarify_brief') ?? 1500;
      const modelParams = buildModelParams(this.model, 0.5, maxTokens); // 0.5 for consistent questions

      // Debug: Log model parameters for runtime validation
      log.debug({
        model: this.model,
        reasoning: isReasoningModel(this.model),
        params: {
          has_temperature: 'temperature' in modelParams,
          has_reasoning_effort: 'reasoning_effort' in modelParams,
          has_max_completion_tokens: 'max_completion_tokens' in modelParams,
          has_max_tokens: 'max_tokens' in modelParams,
        },
        timeout_ms: effectiveTimeout,
      }, "[OpenAI] clarify_brief request parameters");

      const response = await withRetry(
        async () =>
          client.chat.completions.create(
            {
              model: this.model,
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
              ...(seed !== undefined ? { seed } : {}),
              ...modelParams,
            },
            {
              signal: abortController.signal as any,
            },
          ),
        {
          adapter: "openai",
          model: this.model,
          operation: "clarify_brief",
        }
      );

      clearTimeout(timeoutId);
      const content = response.choices[0]?.message?.content?.trim() || "";
      const elapsedMs = Date.now() - start;

      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      emit(TelemetryEvents.ClarifierRoundComplete, {
        request_id: requestId,
        round,
        provider: "openai",
        model: this.model,
        duration_ms: elapsedMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });

      // Parse and validate response
      let rawJson: unknown;
      let jsonText = content;

      // Strip markdown code fences if present
      if (jsonText.startsWith("```json")) {
        jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
      } else if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
      }

      try {
        rawJson = JSON.parse(jsonText);
      } catch (parseError) {
        log.error({ error: parseError, content: jsonText.slice(0, 500) }, "Failed to parse OpenAI clarify response as JSON");
        throw new Error("openai_clarify_invalid_json: Response was not valid JSON");
      }

      const parseResult = OpenAIClarifyResponse.safeParse(rawJson);

      if (!parseResult.success) {
        const flatErrors = parseResult.error.flatten();
        log.error({
          errors: flatErrors,
          event: "llm.validation.clarify_schema_failed",
        }, "OpenAI clarify response failed schema validation");

        const fieldIssues = Object.entries(flatErrors.fieldErrors || {})
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
          .join("; ");
        const formIssues = (flatErrors.formErrors || []).join("; ");
        const details = [fieldIssues, formIssues].filter(Boolean).join(" | ");

        throw new Error(`openai_clarify_invalid_schema: ${details || "unknown validation error"}`);
      }

      const parsed = parseResult.data;

      // Build result with properly typed questions
      const questions: import("./types.js").ClarificationQuestion[] = parsed.questions.map(q => ({
        question: q.question,
        choices: q.choices,
        why_we_ask: q.why_we_ask,
        impacts_draft: q.impacts_draft,
      }));

      const result: import("./types.js").ClarifyBriefResult = {
        questions,
        confidence: parsed.confidence,
        should_continue: parsed.should_continue,
        round,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      };

      log.info({
        request_id: requestId,
        round,
        question_count: questions.length,
        confidence: parsed.confidence,
        should_continue: parsed.should_continue,
        elapsed_ms: elapsedMs,
      }, "OpenAI clarify brief completed");

      return result;
    } catch (error) {
      const elapsedMs = Date.now() - start;

      if (error instanceof Error) {
        const isAbort = error.name === "AbortError";

        if (isAbort) {
          log.warn(
            { request_id: requestId, elapsed_ms: elapsedMs },
            "OpenAI clarify call timed out",
          );
          throw new UpstreamTimeoutError(
            `OpenAI clarify timed out after ${elapsedMs}ms`,
            "openai",
            "clarify_brief",
            "body",
            elapsedMs,
            error,
          );
        }

        if ("status" in error) {
          const apiError = error as Error & { status?: number; code?: string; type?: string };
          const isTimeout = apiError.code === "ETIMEDOUT" || apiError.message?.includes("timeout");

          if (isTimeout) {
            log.warn(
              { request_id: requestId, elapsed_ms: elapsedMs },
              "OpenAI clarify call timed out",
            );
            throw new UpstreamTimeoutError(
              `OpenAI clarify timed out after ${elapsedMs}ms`,
              "openai",
              "clarify_brief",
              "body",
              elapsedMs,
              error,
            );
          }

          if (apiError.status && apiError.status >= 400) {
            log.error(
              { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
              "OpenAI API returned non-2xx status",
            );
            throw new UpstreamHTTPError(
              `OpenAI clarify_brief failed: ${apiError.message || "unknown error"}`,
              "openai",
              apiError.status,
              apiError.code || apiError.type,
              requestId,
              elapsedMs,
              error,
            );
          }
        }
      }

      log.error({ error }, "OpenAI clarify call failed");
      throw error;
    }
  }

  async critiqueGraph(_args: import("./types.js").CritiqueGraphArgs, _opts: CallOpts): Promise<import("./types.js").CritiqueGraphResult> {
    // OpenAI provider does not yet support critiqueGraph
    // Switch to LLM_PROVIDER=anthropic to use this feature
    throw new Error("openai_critique_not_supported: Critique endpoint requires LLM_PROVIDER=anthropic (OpenAI implementation pending)");
  }

  async explainDiff(_args: import("./types.js").ExplainDiffArgs, _opts: CallOpts): Promise<import("./types.js").ExplainDiffResult> {
    // OpenAI provider does not yet support explainDiff
    // Switch to LLM_PROVIDER=anthropic to use this feature
    throw new Error("openai_explain_diff_not_supported: ExplainDiff endpoint requires LLM_PROVIDER=anthropic (OpenAI implementation pending)");
  }
}
