import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Agent, setGlobalDispatcher } from "undici";
import { HTTP_CLIENT_TIMEOUT_MS } from "../../config/timeouts.js";
import { config } from "../../config/index.js";
import type { DocPreview } from "../../services/docProcessing.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../config/graphCaps.js";
import { ProvenanceSource, NodeKind, StructuredProvenance, NodeData, FactorCategory } from "../../schemas/graph.js";
import { emit, log, TelemetryEvents } from "../../utils/telemetry.js";
import { withRetry } from "../../utils/retry.js";
import type { LLMAdapter, DraftGraphArgs, DraftGraphResult, SuggestOptionsArgs, SuggestOptionsResult, RepairGraphArgs, RepairGraphResult, ClarifyBriefArgs, ClarifyBriefResult, CritiqueGraphArgs, CritiqueGraphResult, CallOpts, GraphCappedEvent } from "./types.js";
import { UpstreamTimeoutError, UpstreamHTTPError } from "./errors.js";
import { makeIdempotencyKey } from "./idempotency.js";
import { generateDeterministicLayout } from "../../utils/layout.js";
import { normaliseDraftResponse, ensureControllableFactorBaselines } from "./normalisation.js";
import { getMaxTokensFromConfig } from "./router.js";
import { getSystemPrompt, getSystemPromptMeta, invalidatePromptCache } from './prompt-loader.js';
import { formatEdgeId, type CorrectionCollector } from '../../cee/corrections.js';
import { extractJsonFromResponse } from '../../utils/json-extractor.js';

export type DraftArgs = {
  brief: string;
  docs: DocPreview[];
  seed: number;
  model?: string;
  includeDebug?: boolean;
};

// PERF 2.1 - Anthropic prompt caching:
// Extract static system instructions into Anthropic system text blocks and (optionally)
// mark them as cacheable, so Anthropic's prompt cache can reuse them across calls while
// user-specific content (briefs, documents, violations, graphs) remains dynamic.

type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

/**
 * Max size for raw LLM output in debug trace (chars).
 * Truncates large responses to prevent payload bloat.
 */
const RAW_LLM_OUTPUT_MAX_CHARS = 50000;

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

// Zod schemas for Anthropic response validation
const AnthropicNode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
  // Factor category (V12.4+): controllable, observable, external
  category: FactorCategory.optional(),
  // Node data depends on kind: FactorData for factors, OptionData (interventions) for options
  data: NodeData.optional(),
});

// V4 edge strength schema (nested object from LLM)
const EdgeStrength = z.object({
  mean: z.number(),
  std: z.number().positive(),
}).optional();

const AnthropicEdge = z.object({
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

const AnthropicDraftResponse = z.object({
  nodes: z.array(AnthropicNode),
  edges: z.array(AnthropicEdge),
  rationales: z.array(z.object({ target: z.string(), why: z.string() })).optional(),
});

const AnthropicOptionsResponse = z.object({
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

const AnthropicClarifyResponse = z.object({
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

const AnthropicCritiqueResponse = z.object({
  issues: z.array(
    z.object({
      level: z.enum(["BLOCKER", "IMPROVEMENT", "OBSERVATION"]),
      note: z.string().min(10).max(280),
      target: z.string().optional(),
    })
  ),
  suggested_fixes: z.array(z.string()).max(5),
  overall_quality: z.enum(["poor", "fair", "good", "excellent"]).optional(),
});

const AnthropicExplainDiffResponse = z.object({
  rationales: z.array(
    z.object({
      target: z.string().min(1),
      why: z.string().min(10).max(280),
      provenance_source: z.string().optional(),
    })
  ).min(1),
});

// Use centralized config for API key (lazy access via getter)
function getApiKey(): string | undefined {
  return config.llm.anthropicApiKey;
}

// V04: Undici dispatcher with production-grade timeouts
// - connectTimeout: 3s (fail fast on connection issues)
// - headers/body timeout: HTTP_CLIENT_TIMEOUT_MS (central config)
// Note: Anthropic SDK uses fetch API, so we set global undici dispatcher
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
let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required but not set");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

const TIMEOUT_MS = 45_000; // 45 seconds

const RAW_LLM_TEXT_MAX_CHARS = 10_000;
const RAW_LLM_PREVIEW_MAX_CHARS = 500;

function isAnthropicPromptCacheEnabled(): boolean {
  return config.promptCache.anthropicEnabled;
}

function buildSystemBlocks(text: string, opts?: { operation?: string }): AnthropicSystemBlock[] {
  if (isAnthropicPromptCacheEnabled()) {
    emit(TelemetryEvents.AnthropicPromptCacheHint, {
      provider: "anthropic",
      operation: opts?.operation ?? "unknown",
    });
    return [
      {
        type: "text",
        text,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  return [
    {
      type: "text",
      text,
    },
  ];
}

const _DRAFT_SYSTEM_PROMPT = `You are an expert at drafting small decision graphs from plain-English briefs.

## Your Task
Draft a small decision graph with:
- ≤${GRAPH_MAX_NODES} nodes using ONLY these allowed kinds: goal, decision, option, outcome, risk, action, factor
  (Do NOT use kinds like "evidence", "constraint", "benefit" - these are NOT valid)
- ≤${GRAPH_MAX_EDGES} edges
- For each decision node, when you connect it to 2+ option nodes, treat the belief values on those decision→option edges as probabilities that must sum to 1.0 across that set (within normal rounding error). If this is not true for any decision node, your graph is incorrect and you must adjust the belief values so they form a proper probability distribution before responding.

## NODE KIND DISTINCTIONS
- **factor**: External variables OUTSIDE user control (market demand, competitor actions, economic conditions)
- **action**: Steps the user CAN take (hire contractor, buy insurance, run pilot, train team)

- Every edge with belief or weight MUST have structured provenance:
  - source: document filename, metric name, or "hypothesis"
  - quote: short citation or statement (≤100 chars)
  - location: extract from document markers ([PAGE N], [ROW N], line N:) when citing documents
  - provenance_source: "document" | "metric" | "hypothesis"
- Documents include location markers:
  - PDFs: [PAGE 1], [PAGE 2], etc. marking page boundaries
  - CSVs: [ROW 1] for header, [ROW 2], [ROW 3], etc. for data rows
  - TXT/MD: Line numbers like "1:", "2:", "3:", etc. at start of each line
- When citing documents, use these markers to determine the correct location value
- Node IDs: lowercase with underscores (e.g., "goal_1", "opt_extend_trial")
- Stable topology: goal → decision → options → outcomes

## Output Format (JSON)
{
  "nodes": [
    { "id": "goal_1", "kind": "goal", "label": "Increase Pro upgrades" },
    { "id": "dec_1", "kind": "decision", "label": "Which levers?" },
    { "id": "opt_1", "kind": "option", "label": "Extend trial" },
    { "id": "out_upgrade", "kind": "outcome", "label": "Upgrade rate" }
  ],
  "edges": [
    {
      "from": "opt_1",
      "to": "out_upgrade",
      "belief": 0.7,
      "weight": 0.2,
      "provenance": {
        "source": "hypothesis",
        "quote": "Trial users convert at higher rates"
      },
      "provenance_source": "hypothesis"
    },
    {
      "from": "opt_1",
      "to": "out_upgrade",
      "belief": 0.8,
      "provenance": {
        "source": "metrics.csv",
        "quote": "14-day trial users convert at 23% vs 8% baseline",
        "location": "row 42"
      },
      "provenance_source": "document"
    },
    {
      "from": "dec_1",
      "to": "opt_1",
      "provenance": {
        "source": "report.pdf",
        "quote": "Extended trials show 15% conversion lift",
        "location": "page 2"
      },
      "provenance_source": "document"
    }
  ],
  "rationales": [
    { "target": "edge:opt_1::out_upgrade::0", "why": "Experiential value improves conversion" }
  ]
}

Respond ONLY with valid JSON matching this structure.`;

async function buildDraftPrompt(args: DraftArgs, opts?: { forceDefault?: boolean }): Promise<{ system: AnthropicSystemBlock[]; userContent: string }> {
  const docContext = args.docs.length
    ? `\n\n## Attached Documents\n${args.docs
        .map((d) => {
          const locationInfo = d.locationHint ? ` (${d.locationHint})` : "";
          return `**${d.source}** (${d.type}${locationInfo}):\n${d.preview}`;
        })
        .join("\n\n")}`
    : "";

  const userContent = `## Brief\n${args.brief}${docContext}`;

  // Load system prompt from prompt management system (with fallback to registered defaults)
  // If forceDefault is true, skip store/cache and use hardcoded default directly
  const systemPrompt = await getSystemPrompt('draft_graph', { forceDefault: opts?.forceDefault });

  return {
    system: buildSystemBlocks(systemPrompt, { operation: "draft_graph" }),
    userContent,
  };
}

const _SUGGEST_SYSTEM_PROMPT = `You are an expert at generating strategic options for decisions.

## Your Task
Generate 3-5 distinct, actionable options. For each option provide:
- id: short lowercase identifier (e.g., "extend_trial", "in_app_nudges")
- title: concise name (3-8 words)
- pros: 2-3 advantages
- cons: 2-3 disadvantages or risks
- evidence_to_gather: 2-3 data points or metrics to collect

IMPORTANT: Each option must be distinct. Do not duplicate existing options or create near-duplicates.

## Output Format (JSON)
{
  "options": [
    {
      "id": "extend_trial",
      "title": "Extend free trial period",
      "pros": ["Experiential value", "Low dev cost"],
      "cons": ["Cost exposure", "Expiry dip risk"],
      "evidence_to_gather": ["Trial→upgrade funnel", "Usage lift during trial"]
    }
  ]
}

Respond ONLY with valid JSON.`;

async function buildSuggestPrompt(args: {
  goal: string;
  constraints?: Record<string, unknown>;
  existingOptions?: string[];
}): Promise<{ system: AnthropicSystemBlock[]; userContent: string }> {
  const existingContext = args.existingOptions?.length
    ? `\n\n## Existing Options\nAvoid duplicating these:\n${args.existingOptions.map((o) => `- ${o}`).join("\n")}`
    : "";

  const constraintsContext = args.constraints
    ? `\n\n## Constraints\n${JSON.stringify(args.constraints, null, 2)}`
    : "";

  const userContent = `## Goal\n${args.goal}${constraintsContext}${existingContext}`;

  // Load system prompt from prompt management system (with fallback to registered defaults)
  const systemPrompt = await getSystemPrompt('suggest_options');

  return {
    system: buildSystemBlocks(systemPrompt, { operation: "suggest_options" }),
    userContent,
  };
}

/**
 * Generate suggested positions using deterministic topology-aware layout
 * @deprecated - moved to src/utils/layout.ts, this wrapper maintained for migration
 */
function generateSuggestedPositions(
  nodes: NodeT[],
  edges: EdgeT[],
  roots: string[]
): Record<string, { x: number; y: number }> {
  return generateDeterministicLayout(nodes, edges, roots);
}

function assignStableEdgeIds(edges: EdgeT[]): EdgeT[] {
  const edgeGroups = new Map<string, number>();

  return edges.map((edge) => {
    const key = `${edge.from}::${edge.to}`;
    const idx = edgeGroups.get(key) || 0;
    edgeGroups.set(key, idx + 1);

    return {
      ...edge,
      id: edge.id || `${edge.from}::${edge.to}::${idx}`,
    };
  });
}

function sortGraph(graph: GraphT): GraphT {
  const sortedNodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...graph.edges].sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) return fromCmp;
    const toCmp = a.to.localeCompare(b.to);
    if (toCmp !== 0) return toCmp;
    return (a.id || "").localeCompare(b.id || "");
  });

  return { ...graph, nodes: sortedNodes, edges: sortedEdges };
}

export type UsageMetrics = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export async function draftGraphWithAnthropic(
  args: DraftArgs,
  opts?: { collector?: CorrectionCollector; refreshPrompts?: boolean; forceDefault?: boolean }
): Promise<DraftGraphResult> {
  const collector = opts?.collector;

  // X-CEE-Refresh-Prompt support: invalidate cache to force fresh load from Supabase
  if (opts?.refreshPrompts) {
    invalidatePromptCache('draft_graph', 'header_refresh');
    log.info({ taskId: 'draft_graph' }, 'Prompt cache invalidated via X-CEE-Refresh-Prompt header');
  }

  const prompt = await buildDraftPrompt(args, { forceDefault: opts?.forceDefault });
  const promptMeta = getSystemPromptMeta('draft_graph');
  const model = args.model || "claude-3-5-sonnet-20241022";
  const maxTokens = getMaxTokensFromConfig('draft_graph') ?? 4096;

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ brief_chars: args.brief.length, doc_count: args.docs.length, model, idempotency_key: idempotencyKey }, "calling Anthropic for draft");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.userContent }],
          },
          {
            signal: abortController.signal,
            headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
          }
        ),
      {
        adapter: "anthropic",
        model,
        operation: "draft_graph",
      }
    );

    clearTimeout(timeoutId);

    const providerLatencyMs = Date.now() - startTime;

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response using robust extractor
    // Handles: raw JSON, markdown code blocks, conversational preamble/suffix
    const extractionResult = extractJsonFromResponse(content.text, {
      task: "draft_graph",
      model,
      correlationId: idempotencyKey,
      includeRawContent: args.includeDebug, // Preserve full raw text for debugging
    });
    const rawJson = extractionResult.json as Record<string, unknown>;
    // Use full raw text for debug output (preserves preamble/suffix for forensics)
    const jsonText = content.text.trim();
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
    const parseResult = AnthropicDraftResponse.safeParse(withBaselines);

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
      }, "Anthropic response failed schema validation after normalisation");

      // Build detailed error message for debugging
      const fieldIssues = Object.entries(flatErrors.fieldErrors || {})
        .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
        .join('; ');
      const formIssues = (flatErrors.formErrors || []).join('; ');
      const details = [fieldIssues, formIssues].filter(Boolean).join(' | ');

      throw new Error(`anthropic_response_invalid_schema: ${details || 'unknown validation error'}`);
    }

    const parsed = parseResult.data;

    // Validate and cap node/edge counts
    if (parsed.nodes.length > GRAPH_MAX_NODES) {
      log.warn({ count: parsed.nodes.length, max: GRAPH_MAX_NODES }, "node count exceeded, trimming");
      parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES);
    }

    if (parsed.edges.length > GRAPH_MAX_EDGES) {
      log.warn({ count: parsed.edges.length, max: GRAPH_MAX_EDGES }, "edge count exceeded, trimming");
      parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES);
    }

    // Filter edges to only valid node IDs (Stage 5: Dangling Edge Filter #1)
    const nodeIds = new Set(parsed.nodes.map((n) => n.id));
    const danglingEdges = parsed.edges.filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));

    if (danglingEdges.length > 0) {
      log.warn({
        event: 'llm.draft.dangling_edges_removed',
        removed_count: danglingEdges.length,
        dangling_edges: danglingEdges.map(e => ({
          from: e.from,
          to: e.to,
          missing_from: !nodeIds.has(e.from),
          missing_to: !nodeIds.has(e.to),
        })).slice(0, 10),
      }, `Removed ${danglingEdges.length} edge(s) with dangling node references`);

      // Track corrections for each dangling edge removed
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

    // Assign stable edge IDs - preserve V4 fields alongside legacy fields
    const edgesWithIds = assignStableEdgeIds(
      validEdges.map((e) => ({
        from: e.from,
        to: e.to,
        // V4 nested format (from LLM)
        strength: e.strength,
        exists_probability: e.exists_probability,
        // V4 flat format (from normaliseDraftResponse)
        strength_mean: e.strength_mean,
        strength_std: e.strength_std,
        belief_exists: e.belief_exists,
        effect_direction: e.effect_direction,
        // Legacy format (for backwards compatibility)
        weight: e.weight ?? e.strength_mean,
        belief: e.belief ?? e.belief_exists,
        provenance: e.provenance,
        provenance_source: e.provenance_source,
      }))
    );

    // Build graph
    const nodes: NodeT[] = parsed.nodes.map((n) => ({
      id: n.id,
      kind: n.kind as NodeT["kind"],
      label: n.label,
      body: n.body,
      category: n.category,
      data: n.data,
    }));

    // Calculate roots and leaves
    const roots = nodes
      .filter((n) => !edgesWithIds.some((e) => e.to === n.id))
      .map((n) => n.id);
    const leaves = nodes
      .filter((n) => !edgesWithIds.some((e) => e.from === n.id))
      .map((n) => n.id);

    const graph: GraphT = sortGraph({
      version: "1",
      default_seed: args.seed,
      nodes,
      edges: edgesWithIds,
      meta: {
        roots,
        leaves,
        suggested_positions: generateSuggestedPositions(nodes, edgesWithIds, roots),
        source: "assistant" as const,
      },
    });

    log.info(
      { nodes: graph.nodes.length, edges: graph.edges.length, roots: roots.length, leaves: leaves.length },
      "draft complete"
    );

    // Capture raw LLM output for debug tracing (before normalisation)
    const rawOutput = truncateRawOutput(rawJson);

    const unsafeCaptureEnabled = args.includeDebug === true && (args as any).flags?.unsafe_capture === true;
    const rawTextTruncated = jsonText.length > RAW_LLM_TEXT_MAX_CHARS
      ? jsonText.slice(0, RAW_LLM_TEXT_MAX_CHARS)
      : jsonText;
    const rawPreview = jsonText.length > RAW_LLM_PREVIEW_MAX_CHARS
      ? jsonText.slice(0, RAW_LLM_PREVIEW_MAX_CHARS)
      : jsonText;

    const finishReason = (response as any)?.stop_reason || (response as any)?.stopReason;

    return {
      graph,
      rationales: parsed.rationales || [],
      debug: unsafeCaptureEnabled ? {
        raw_llm_output: rawOutput.output,
        raw_llm_output_truncated: rawOutput.truncated,
      } : undefined,
      meta: {
        model,
        prompt_version: promptMeta.prompt_version,
        prompt_hash: promptMeta.prompt_hash,
        // Diagnostic fields for prompt cache debugging
        instance_id: promptMeta.instance_id,
        cache_age_ms: promptMeta.cache_age_ms,
        cache_status: promptMeta.cache_status,
        use_staging_mode: promptMeta.use_staging_mode,
        temperature: 0,
        max_tokens: maxTokens,
        seed: args.seed,
        token_usage: {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        finish_reason: typeof finishReason === 'string' ? finishReason : undefined,
        provider_latency_ms: providerLatencyMs,
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
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error(
          { timeout_ms: TIMEOUT_MS, elapsed_ms: elapsedMs, fallback_reason: "anthropic_timeout", quality_tier: "failed" },
          "Anthropic call timed out and was aborted"
        );
        throw new UpstreamTimeoutError(
          "Anthropic draft_graph timed out",
          "anthropic",
          "draft_graph",
          "body", // Timeout occurred during response body
          elapsedMs,
          error
        );
      }
      if (error.message === "anthropic_response_invalid_schema") {
        log.error(
          { fallback_reason: "schema_validation_failed", quality_tier: "failed" },
          "Anthropic returned response that failed schema validation"
        );
        throw error;
      }

      // V04: Check for Anthropic API errors (non-2xx responses)
      // Anthropic SDK throws errors with status and request_id properties
      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs, fallback_reason: "anthropic_api_error", quality_tier: "failed" },
          "Anthropic API returned non-2xx status"
        );
        throw new UpstreamHTTPError(
          `Anthropic draft_graph failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error(
      { error, fallback_reason: "network_or_api_error", quality_tier: "failed" },
      "Anthropic call failed"
    );
    throw error;
  }
}

export async function suggestOptionsWithAnthropic(args: {
  goal: string;
  constraints?: Record<string, unknown>;
  existingOptions?: string[];
  model?: string;
}): Promise<{ options: Array<{ id: string; title: string; pros: string[]; cons: string[]; evidence_to_gather: string[] }>; usage: UsageMetrics }> {
  const prompt = await buildSuggestPrompt(args);
  const model = args.model || "claude-3-5-sonnet-20241022";
  const maxTokens = getMaxTokensFromConfig('suggest_options') ?? 2048;

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model,
            max_tokens: maxTokens,
            temperature: 0.1, // Low temperature for more deterministic output
            system: prompt.system,
            messages: [{ role: "user", content: prompt.userContent }],
          },
          {
            signal: abortController.signal,
            headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
          }
        ),
      {
        adapter: "anthropic",
        model,
        operation: "suggest_options",
      }
    );

    clearTimeout(timeoutId);
    const _elapsedMs = Date.now() - startTime;

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response using robust extractor
    const extractionResult = extractJsonFromResponse(content.text, {
      task: "suggest_options",
      model,
      correlationId: idempotencyKey,
    });
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicOptionsResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten() }, "Anthropic options response failed schema validation");
      throw new Error("anthropic_response_invalid_schema");
    }

    let options = parseResult.data.options;

    // De-duplicate against existing options (case-insensitive title match)
    if (args.existingOptions?.length) {
      const existingLower = new Set(args.existingOptions.map((o) => o.toLowerCase()));
      options = options.filter((opt) => !existingLower.has(opt.title.toLowerCase()));
    }

    // De-duplicate within returned options (by ID and title)
    const seen = new Set<string>();
    options = options.filter((opt) => {
      const key = `${opt.id}::${opt.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Ensure 3-5 options after de-duplication
    if (options.length < 3) {
      log.warn({ count: options.length, after_dedup: true }, "too few options after de-duplication");
      // This shouldn't happen with good prompts, but log it
    }
    if (options.length > 5) {
      log.warn({ count: options.length }, "too many options, trimming");
      options = options.slice(0, 5);
    }

    return {
      options,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error(
          { timeout_ms: TIMEOUT_MS, elapsed_ms: elapsedMs, fallback_reason: "anthropic_timeout", quality_tier: "failed" },
          "Anthropic suggest-options call timed out and was aborted"
        );
        throw new UpstreamTimeoutError(
          "Anthropic suggest_options timed out",
          "anthropic",
          "suggest_options",
          "body",
          elapsedMs,
          error
        );
      }
      if (error.message === "anthropic_response_invalid_schema") {
        log.error(
          { fallback_reason: "schema_validation_failed", quality_tier: "failed" },
          "Anthropic options response failed schema validation"
        );
        throw error;
      }

      // V04: Check for Anthropic API errors (non-2xx responses)
      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs, fallback_reason: "anthropic_api_error", quality_tier: "failed" },
          "Anthropic API returned non-2xx status"
        );
        throw new UpstreamHTTPError(
          `Anthropic suggest_options failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error(
      { error, fallback_reason: "network_or_api_error", quality_tier: "failed" },
      "Anthropic suggest-options call failed"
    );
    throw error;
  }
}

export type RepairArgs = {
  graph: GraphT;
  violations: string[];
  model?: string;
  requestId?: string;
};

const _REPAIR_SYSTEM_PROMPT = `You are an expert at fixing decision graph violations.

## Your Task
Fix the graph to resolve ALL violations. Common fixes:
- Remove cycles (decision graphs must be DAGs)
- Remove isolated nodes (all nodes must be connected)
- Ensure edge endpoints reference valid node IDs
- Ensure belief values are between 0 and 1
- Ensure node kinds are valid (goal, decision, option, outcome, risk, action, factor)
- Maintain graph topology where possible

## Output Format (JSON)
{
  "nodes": [
    { "id": "goal_1", "kind": "goal", "label": "..." },
    { "id": "dec_1", "kind": "decision", "label": "..." }
  ],
  "edges": [
    {
      "from": "goal_1",
      "to": "dec_1",
      "provenance": {
        "source": "hypothesis",
        "quote": "..."
      },
      "provenance_source": "hypothesis"
    }
  ],
  "rationales": []
}

Respond ONLY with valid JSON matching this structure.`;

async function buildRepairPrompt(args: RepairArgs): Promise<{ system: AnthropicSystemBlock[]; userContent: string }> {
  const graphJson = JSON.stringify(
    {
      nodes: args.graph.nodes,
      edges: args.graph.edges,
    },
    null,
    2
  );

  const violationsText = args.violations.map((v, i) => `${i + 1}. ${v}`).join("\n");

  const userContent = `## Current Graph (INVALID)
${graphJson}

## Violations Found
${violationsText}`;

  // Load system prompt from prompt management system (with fallback to registered defaults)
  const systemPrompt = await getSystemPrompt('repair_graph');

  return {
    system: buildSystemBlocks(systemPrompt, { operation: "repair_graph" }),
    userContent,
  };
}

export async function repairGraphWithAnthropic(
  args: RepairArgs
): Promise<{ graph: GraphT; rationales: { target: string; why: string }[]; usage: UsageMetrics }> {
  const prompt = await buildRepairPrompt(args);
  const model = args.model || "claude-3-5-sonnet-20241022";
  const maxTokens = getMaxTokensFromConfig('repair_graph') ?? 4096;

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ violation_count: args.violations.length, model, idempotency_key: idempotencyKey }, "calling Anthropic for graph repair");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.userContent }],
          },
          {
            signal: abortController.signal,
            headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
          }
        ),
      {
        adapter: "anthropic",
        model,
        operation: "repair_graph",
      }
    );

    clearTimeout(timeoutId);
    const _elapsedMs = Date.now() - startTime;

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type, fallback_reason: "unexpected_response_type", quality_tier: "failed" }, "unexpected Anthropic repair response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response using robust extractor
    const extractionResult = extractJsonFromResponse(content.text, {
      task: "repair_graph",
      model,
      correlationId: idempotencyKey,
    });
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Normalise non-standard node kinds, ensure factor baselines, then validate with Zod
    const normalised = normaliseDraftResponse(rawJson);
    const { response: withBaselines, defaultedFactors: repairDefaultedFactors } = ensureControllableFactorBaselines(normalised);
    if (repairDefaultedFactors.length > 0) {
      log.info({ defaultedFactors: repairDefaultedFactors }, `Defaulted baseline values for ${repairDefaultedFactors.length} controllable factor(s) in repair`);
    }
    const parseResult = AnthropicDraftResponse.safeParse(withBaselines);

    if (!parseResult.success) {
      const flatErrors = parseResult.error.flatten();
      log.error({
        errors: flatErrors,
        raw_node_kinds: Array.isArray(rawJson?.nodes)
          ? rawJson.nodes.map((n: any) => n?.kind).filter(Boolean)
          : [],
        event: 'llm.validation.repair_schema_failed',
        fallback_reason: "schema_validation_failed",
        quality_tier: "failed"
      }, "Anthropic repair response failed schema validation after normalisation");

      const fieldIssues = Object.entries(flatErrors.fieldErrors || {})
        .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
        .join('; ');
      const formIssues = (flatErrors.formErrors || []).join('; ');
      const details = [fieldIssues, formIssues].filter(Boolean).join(' | ');

      throw new Error(`anthropic_repair_invalid_schema: ${details || 'unknown validation error'}`);
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
        adapter: 'anthropic',
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
        request_id: args.requestId,
        idempotency_key: idempotencyKey,
      };
      log.warn(cappedEvent, "Anthropic repair graph capped to limits");
    }

    // Filter edges to only valid node IDs (Stage 5: Dangling Edge Filter #1 - repair path)
    const nodeIds = new Set(parsed.nodes.map((n) => n.id));
    const danglingEdges = parsed.edges.filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));

    if (danglingEdges.length > 0) {
      log.warn({
        event: 'llm.repair.dangling_edges_removed',
        removed_count: danglingEdges.length,
        dangling_edges: danglingEdges.map(e => ({
          from: e.from,
          to: e.to,
          missing_from: !nodeIds.has(e.from),
          missing_to: !nodeIds.has(e.to),
        })).slice(0, 10),
      }, `Repair: Removed ${danglingEdges.length} edge(s) with dangling node references`);
    }

    const validEdges = parsed.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

    // Assign stable edge IDs - preserve V4 fields alongside legacy fields
    const edgesWithIds = assignStableEdgeIds(
      validEdges.map((e) => ({
        from: e.from,
        to: e.to,
        // V4 nested format (from LLM)
        strength: e.strength,
        exists_probability: e.exists_probability,
        // V4 flat format (from normaliseDraftResponse)
        strength_mean: e.strength_mean,
        strength_std: e.strength_std,
        belief_exists: e.belief_exists,
        effect_direction: e.effect_direction,
        // Legacy format (for backwards compatibility)
        weight: e.weight ?? e.strength_mean,
        belief: e.belief ?? e.belief_exists,
        provenance: e.provenance,
        provenance_source: e.provenance_source,
      }))
    );

    const graph: GraphT = sortGraph({
      version: args.graph.version || "1",
      default_seed: args.graph.default_seed || 17,
      nodes: parsed.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        body: n.body,
        category: n.category,
        data: n.data,
      })),
      edges: edgesWithIds,
      meta: args.graph.meta || {
        roots: [],
        leaves: [],
        suggested_positions: {},
        source: "assistant",
      },
    });

    return {
      graph,
      rationales: parsed.rationales || [],
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error(
          { timeout_ms: TIMEOUT_MS, elapsed_ms: elapsedMs, fallback_reason: "anthropic_repair_timeout", quality_tier: "failed" },
          "Anthropic repair call timed out"
        );
        throw new UpstreamTimeoutError(
          "Anthropic repair_graph timed out",
          "anthropic",
          "repair_graph",
          "body",
          elapsedMs,
          error
        );
      }
      if (error.message === "ANTHROPIC_API_KEY environment variable is required but not set") {
        log.error(
          { fallback_reason: "missing_api_key", quality_tier: "failed" },
          "Anthropic API key not configured"
        );
        throw error;
      }
      if (error.message === "anthropic_repair_invalid_schema") {
        log.error(
          { fallback_reason: "schema_validation_failed", quality_tier: "failed" },
          "Anthropic repair response failed schema validation"
        );
        throw error;
      }

      // V04: Check for Anthropic API errors (non-2xx responses)
      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs, fallback_reason: "anthropic_api_error", quality_tier: "failed" },
          "Anthropic API returned non-2xx status"
        );
        throw new UpstreamHTTPError(
          `Anthropic repair_graph failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error(
      { error, fallback_reason: "network_or_api_error", quality_tier: "failed" },
      "Anthropic repair call failed"
    );
    throw error;
  }
}

export type ClarifyArgs = {
  brief: string;
  round: number;
  previous_answers?: Array<{ question: string; answer: string }>;
  seed?: number;
  model?: string;
};

const _CLARIFY_SYSTEM_PROMPT = `You are an expert at identifying ambiguities in decision briefs and generating clarifying questions.

## Your Task
Analyze this brief and generate 1-5 clarifying questions to refine the decision graph. Focus on:
- Missing context about goals, constraints, or success criteria
- Ambiguous stakeholders or decision-makers
- Unclear timelines or resource availability
- Missing data sources or provenance hints

**MCQ-First Rule:** Prefer multiple-choice questions when possible (limit 3-5 choices). Use open-ended questions only when MCQ is impractical.

For each question provide:
- question: The question text (10+ chars)
- choices: Array of 3-5 options (optional, omit for open-ended questions)
- why_we_ask: Why this question matters (20+ chars)
- impacts_draft: How the answer will affect the graph structure or content (20+ chars)

Also provide:
- confidence: Your confidence that the current brief is sufficient (0.0-1.0)
- should_continue: Whether another clarification round would be helpful (stop if confidence ≥0.8 or no material improvement possible)

## Output Format (JSON)
{
  "questions": [
    {
      "question": "Who is the primary decision-maker?",
      "choices": ["CEO", "Board", "Product team", "Engineering team"],
      "why_we_ask": "Determines which stakeholder perspectives to prioritize",
      "impacts_draft": "Shapes the goal node and outcome evaluation criteria"
    },
    {
      "question": "What is the timeline for this decision?",
      "why_we_ask": "Affects feasibility of certain options",
      "impacts_draft": "Influences which options are viable and how outcomes are measured"
    }
  ],
  "confidence": 0.65,
  "should_continue": true
}

Respond ONLY with valid JSON.`;

async function buildClarifyPrompt(args: ClarifyArgs): Promise<{ system: AnthropicSystemBlock[]; userContent: string }> {
  const previousContext = args.previous_answers?.length
    ? `\n\n## Previous Q&A (Round ${args.round})\n${args.previous_answers.map((qa, i) => `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`).join("\n")}`
    : "";

  const userContent = `## Brief
${args.brief}
${previousContext}`;

  // Load system prompt from prompt management system (with fallback to registered defaults)
  const systemPrompt = await getSystemPrompt('clarify_brief');

  return {
    system: buildSystemBlocks(systemPrompt, { operation: "clarify_brief" }),
    userContent,
  };
}

export async function clarifyBriefWithAnthropic(
  args: ClarifyArgs
): Promise<{ questions: Array<{ question: string; choices?: string[]; why_we_ask: string; impacts_draft: string }>; confidence: number; should_continue: boolean; usage: UsageMetrics }> {
  const prompt = await buildClarifyPrompt(args);
  const model = args.model || "claude-3-5-sonnet-20241022";
  const maxTokens = getMaxTokensFromConfig('clarify_brief') ?? 2048;

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ brief_chars: args.brief.length, round: args.round, model, idempotency_key: idempotencyKey }, "calling Anthropic for clarification");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model,
            max_tokens: maxTokens,
            temperature: args.seed ? 0 : 0.1,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.userContent }],
          },
          {
            signal: abortController.signal,
            headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
          }
        ),
      {
        adapter: "anthropic",
        model,
        operation: "clarify_brief",
      }
    );

    clearTimeout(timeoutId);
    const _elapsedMs = Date.now() - startTime;

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response using robust extractor
    const extractionResult = extractJsonFromResponse(content.text, {
      task: "clarify_brief",
      model,
      correlationId: idempotencyKey,
    });
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicClarifyResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten() }, "Anthropic clarify response failed schema validation");
      throw new Error("anthropic_clarify_invalid_schema");
    }

    const parsed = parseResult.data;

    log.info(
      { question_count: parsed.questions.length, confidence: parsed.confidence, should_continue: parsed.should_continue },
      "clarification complete"
    );

    return {
      questions: parsed.questions,
      confidence: parsed.confidence,
      should_continue: parsed.should_continue,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error({ timeout_ms: TIMEOUT_MS, elapsed_ms: elapsedMs }, "Anthropic clarify call timed out");
        throw new UpstreamTimeoutError(
          "Anthropic clarify_brief timed out",
          "anthropic",
          "clarify_brief",
          "body",
          elapsedMs,
          error
        );
      }
      if (error.message === "anthropic_clarify_invalid_schema") {
        log.error({}, "Anthropic clarify response failed schema validation");
        throw error;
      }

      // V04: Check for Anthropic API errors (non-2xx responses)
      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
          "Anthropic API returned non-2xx status"
        );
        throw new UpstreamHTTPError(
          `Anthropic clarify_brief failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error({ error }, "Anthropic clarify call failed");
    throw error;
  }
}

export type CritiqueArgs = {
  graph: GraphT;
  brief?: string;
  focus_areas?: Array<"structure" | "completeness" | "feasibility" | "provenance">;
  model?: string;
};

const _CRITIQUE_SYSTEM_PROMPT = `You are an expert at critiquing decision graphs for quality and feasibility.

## Your Task
Analyze this graph and identify issues across these dimensions:
- **Structure**: Cycles, isolated nodes, missing connections, topology problems
- **Completeness**: Missing nodes, incomplete options, lacking provenance
- **Feasibility**: Unrealistic timelines, resource constraints, implementation risks
- **Provenance**: Missing or weak provenance on beliefs/weights, citation quality

For each issue provide:
- level: Severity ("BLOCKER" | "IMPROVEMENT" | "OBSERVATION")
  - BLOCKER: Critical issues that prevent using the graph (cycles, isolated nodes, invalid structure)
  - IMPROVEMENT: Quality issues that reduce utility (missing provenance, weak rationales)
  - OBSERVATION: Minor suggestions or best-practice recommendations
- note: Description of the issue (10-280 chars)
- target: (optional) Node or edge ID affected

Also provide:
- suggested_fixes: 0-5 actionable recommendations (brief, <100 chars each)
- overall_quality: Assessment of graph quality ("poor" | "fair" | "good" | "excellent")

**Important:** This is a non-mutating pre-flight check. Do NOT modify the graph.

**Consistency:** Return issues in a stable order (BLOCKERs first, then IMPROVEMENTs, then OBSERVATIONs).

## Output Format (JSON)
{
  "issues": [
    {
      "level": "BLOCKER",
      "note": "Cycle detected between nodes dec_1 and opt_2",
      "target": "dec_1"
    },
    {
      "level": "IMPROVEMENT",
      "note": "Edge goal_1::dec_1 lacks provenance source",
      "target": "goal_1::dec_1::0"
    }
  ],
  "suggested_fixes": [
    "Remove edge from opt_2 to dec_1 to break cycle",
    "Add provenance to edges with belief values"
  ],
  "overall_quality": "fair"
}

Respond ONLY with valid JSON.`;

async function buildCritiquePrompt(args: CritiqueArgs): Promise<{ system: AnthropicSystemBlock[]; userContent: string }> {
  const graphJson = JSON.stringify(
    {
      nodes: args.graph.nodes,
      edges: args.graph.edges,
    },
    null,
    2
  );

  const briefContext = args.brief ? `\n\n## Original Brief\n${args.brief}` : "";
  const focusContext = args.focus_areas?.length
    ? `\n\n## Focus Areas\nPrioritize issues in: ${args.focus_areas.join(", ")}`
    : "";

  const userContent = `## Graph to Critique
${graphJson}
${briefContext}${focusContext}`;

  // Load system prompt from prompt management system (with fallback to registered defaults)
  const systemPrompt = await getSystemPrompt('critique_graph');

  return {
    system: buildSystemBlocks(systemPrompt, { operation: "critique_graph" }),
    userContent,
  };
}

export async function critiqueGraphWithAnthropic(
  args: CritiqueArgs
): Promise<{ issues: Array<{ level: "BLOCKER" | "IMPROVEMENT" | "OBSERVATION"; note: string; target?: string }>; suggested_fixes: string[]; overall_quality?: "poor" | "fair" | "good" | "excellent"; usage: UsageMetrics }> {
  const prompt = await buildCritiquePrompt(args);
  const model = args.model || "claude-3-5-sonnet-20241022";
  const maxTokens = getMaxTokensFromConfig('critique_graph') ?? 2048;

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ node_count: args.graph.nodes.length, edge_count: args.graph.edges.length, model, idempotency_key: idempotencyKey }, "calling Anthropic for critique");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.userContent }],
          },
          {
            signal: abortController.signal,
            headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
          }
        ),
      {
        adapter: "anthropic",
        model,
        operation: "critique_graph",
      }
    );

    clearTimeout(timeoutId);
    const _elapsedMs = Date.now() - startTime;

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response using robust extractor
    const extractionResult = extractJsonFromResponse(content.text, {
      task: "critique_graph",
      model,
      correlationId: idempotencyKey,
    });
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicCritiqueResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten() }, "Anthropic critique response failed schema validation");
      throw new Error("anthropic_critique_invalid_schema");
    }

    const parsed = parseResult.data;

    // Sort issues by severity for consistent ordering: BLOCKER → IMPROVEMENT → OBSERVATION
    const severityOrder: Record<string, number> = {
      BLOCKER: 0,
      IMPROVEMENT: 1,
      OBSERVATION: 2,
    };
    const sortedIssues = [...parsed.issues].sort((a, b) => {
      const aOrder = severityOrder[a.level] ?? 999;
      const bOrder = severityOrder[b.level] ?? 999;
      return aOrder - bOrder;
    });

    log.info(
      { issue_count: sortedIssues.length, quality: parsed.overall_quality },
      "critique complete"
    );

    return {
      issues: sortedIssues,
      suggested_fixes: parsed.suggested_fixes,
      overall_quality: parsed.overall_quality,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error({ timeout_ms: TIMEOUT_MS, elapsed_ms: elapsedMs }, "Anthropic critique call timed out");
        throw new UpstreamTimeoutError(
          "Anthropic critique_graph timed out",
          "anthropic",
          "critique_graph",
          "body",
          elapsedMs,
          error
        );
      }
      if (error.message === "anthropic_critique_invalid_schema") {
        log.error({}, "Anthropic critique response failed schema validation");
        throw error;
      }

      // V04: Check for Anthropic API errors (non-2xx responses)
      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
          "Anthropic API returned non-2xx status"
        );
        throw new UpstreamHTTPError(
          `Anthropic critique_graph failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error({ error }, "Anthropic critique call failed");
    throw error;
  }
}

/**
 * Helper function for explaining graph patches with Anthropic.
 */
export async function explainDiffWithAnthropic(
  args: { patch: any; brief?: string; graph_summary?: { node_count: number; edge_count: number }; model?: string }
): Promise<{ rationales: Array<{ target: string; why: string; provenance_source?: string }>; usage: UsageMetrics }> {
  const model = args.model || "claude-3-5-sonnet-20241022";
  // No specific config key for explain_diff, use default
  const maxTokens = 2048;

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  // Build prompt
  const prompt = `You are explaining why changes were made to a decision graph.

Given this patch:
${JSON.stringify(args.patch, null, 2)}

${args.brief ? `Context: ${args.brief}` : ""}
${args.graph_summary ? `Graph has ${args.graph_summary.node_count} nodes and ${args.graph_summary.edge_count} edges.` : ""}

Generate a JSON array of rationales explaining why each change was made. Each rationale should have:
- target: the node/edge ID being explained
- why: a concise explanation (≤280 chars)
- provenance_source: optional source indicator (e.g., "user_brief", "hypothesis")

Return ONLY valid JSON in this format:
{
  "rationales": [
    {"target": "node_1", "why": "explanation here", "provenance_source": "user_brief"}
  ]
}`;

  log.info({ change_count: (args.patch.adds?.nodes?.length || 0) + (args.patch.adds?.edges?.length || 0), model, idempotency_key: idempotencyKey }, "calling Anthropic for explain-diff");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model,
            max_tokens: maxTokens,
            temperature: 0,
            messages: [{ role: "user", content: prompt }],
          },
          {
            signal: abortController.signal,
            headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
          }
        ),
      {
        adapter: "anthropic",
        model,
        operation: "explain_diff",
      }
    );

    clearTimeout(timeoutId);
    const _elapsedMs = Date.now() - startTime;

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response using robust extractor
    const extractionResult = extractJsonFromResponse(content.text, {
      task: "explain_diff",
      model,
      correlationId: idempotencyKey,
    });
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicExplainDiffResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten() }, "Anthropic explain-diff response failed schema validation");
      throw new Error("anthropic_explain_diff_invalid_schema");
    }

    const parsed = parseResult.data;

    // Sort rationales by target for consistent ordering
    const sortedRationales = [...parsed.rationales].sort((a, b) => a.target.localeCompare(b.target));

    log.info({ rationale_count: sortedRationales.length }, "explain-diff complete");

    return {
      rationales: sortedRationales,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error({ timeout_ms: TIMEOUT_MS, elapsed_ms: elapsedMs }, "Anthropic explain-diff call timed out");
        throw new UpstreamTimeoutError(
          "Anthropic explain_diff timed out",
          "anthropic",
          "explain_diff",
          "body",
          elapsedMs,
          error
        );
      }
      if (error.message === "anthropic_explain_diff_invalid_schema") {
        throw error;
      }

      // V04: Check for Anthropic API errors (non-2xx responses)
      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
          "Anthropic API returned non-2xx status"
        );
        throw new UpstreamHTTPError(
          `Anthropic explain_diff failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error({ error }, "Anthropic explain-diff call failed");
    throw error;
  }
}

/**
 * Provider-agnostic adapter class for Anthropic that implements the LLMAdapter interface.
 * This wraps the existing functions to provide a consistent interface for the router.
 */
export class AnthropicAdapter implements LLMAdapter {
  readonly name = 'anthropic' as const;
  readonly model: string;

  constructor(model?: string) {
    // Default to Claude 3 Haiku for cost-effectiveness
    this.model = model || config.llm.model || 'claude-3-haiku-20240307';
  }

  async draftGraph(args: DraftGraphArgs, opts: CallOpts): Promise<DraftGraphResult> {
    const { brief, docs = [], seed } = args;

    // Call existing function with compatible args, passing model from adapter
    // Pass bypassCache as refreshPrompts to trigger prompt cache invalidation
    // Pass forceDefault to use hardcoded default prompt instead of store prompt
    const result = await draftGraphWithAnthropic(
      {
        brief,
        docs,
        seed,
        model: this.model,
      },
      { collector: opts.collector, refreshPrompts: opts.bypassCache, forceDefault: opts.forceDefault }
    );

    return {
      graph: result.graph,
      rationales: result.rationales,
      usage: result.usage,
    };
  }

  async suggestOptions(args: SuggestOptionsArgs, _opts: CallOpts): Promise<SuggestOptionsResult> {
    const result = await suggestOptionsWithAnthropic({
      ...args,
      model: this.model,
    });

    return {
      options: result.options,
      usage: result.usage,
    };
  }

  async repairGraph(args: RepairGraphArgs, opts: CallOpts): Promise<RepairGraphResult> {
    const { graph, violations } = args;

    const result = await repairGraphWithAnthropic({
      graph,
      violations,
      model: this.model,
      requestId: opts.requestId,
    });

    return {
      graph: result.graph,
      rationales: result.rationales,
      usage: result.usage,
    };
  }

  async clarifyBrief(args: ClarifyBriefArgs, _opts: CallOpts): Promise<ClarifyBriefResult> {
    const { brief, round, previous_answers, seed } = args;

    const result = await clarifyBriefWithAnthropic({
      brief,
      round,
      previous_answers,
      seed,
      model: this.model,
    });

    return {
      questions: result.questions,
      confidence: result.confidence,
      should_continue: result.should_continue,
      round,
      usage: result.usage,
    };
  }

  async critiqueGraph(args: CritiqueGraphArgs, _opts: CallOpts): Promise<CritiqueGraphResult> {
    const { graph, brief, focus_areas } = args;

    const result = await critiqueGraphWithAnthropic({
      graph,
      brief,
      focus_areas,
      model: this.model,
    });

    return {
      issues: result.issues,
      suggested_fixes: result.suggested_fixes,
      overall_quality: result.overall_quality,
      usage: result.usage,
    };
  }

  async explainDiff(args: import("./types.js").ExplainDiffArgs, _opts: CallOpts): Promise<import("./types.js").ExplainDiffResult> {
    const result = await explainDiffWithAnthropic({
      patch: args.patch,
      brief: args.brief,
      graph_summary: args.graph_summary,
      model: this.model,
    });

    return {
      rationales: result.rationales,
      usage: result.usage,
    };
  }
}

// Test-only exports for verifying prompt composition and cache-control behaviour
export const __test_only = {
  buildSystemBlocks,
  buildDraftPrompt,
  buildSuggestPrompt,
  buildRepairPrompt,
  buildClarifyPrompt,
  buildCritiquePrompt,
};
