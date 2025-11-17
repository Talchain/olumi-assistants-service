import OpenAI from "openai";
import { z } from "zod";
import { Agent, setGlobalDispatcher } from "undici";
import type { DocPreview } from "../../services/docProcessing.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import { ProvenanceSource, NodeKind, StructuredProvenance } from "../../schemas/graph.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../config/graphCaps.js";
import { log } from "../../utils/telemetry.js";
import type { LLMAdapter, DraftGraphArgs, DraftGraphResult, SuggestOptionsArgs, SuggestOptionsResult, RepairGraphArgs, RepairGraphResult, CallOpts } from "./types.js";
import { UpstreamTimeoutError, UpstreamHTTPError } from "./errors.js";
import { makeIdempotencyKey } from "./idempotency.js";
import { generateDeterministicLayout } from "../../utils/layout.js";

// Zod schemas for OpenAI response validation (same as Anthropic)
const OpenAINode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
});

const OpenAIEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
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

const apiKey = process.env.OPENAI_API_KEY;

// V04: Undici dispatcher with production-grade timeouts
// - connectTimeout: 3s (fail fast on connection issues)
// - headersTimeout: 65s (align with 65s deadline)
// - bodyTimeout: 60s (budget for LLM response)
// Note: OpenAI SDK v6 uses fetch API, so we set global undici dispatcher
const undiciAgent = new Agent({
  connect: {
    timeout: 3000, // 3s
  },
  headersTimeout: 65000, // 65s
  bodyTimeout: 60000, // 60s
});

// Set global dispatcher for fetch API (affects all fetch calls in this module)
setGlobalDispatcher(undiciAgent);

// Lazy initialization to allow testing without API key
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required but not set");
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

const TIMEOUT_MS = 15000;

function buildDraftPrompt(brief: string, docs: DocPreview[]): string {
  const docContext = docs.length
    ? `\n\n## Attached Documents\n${docs
        .map((d) => {
          const locationInfo = d.locationHint ? ` (${d.locationHint})` : "";
          return `**${d.source}** (${d.type}${locationInfo}):\n${d.preview}`;
        })
        .join("\n\n")}`
    : "";

  return `You are an expert at drafting small decision graphs from plain-English briefs.

## Brief
${brief}
${docContext}

## Your Task
Draft a small decision graph with:
- ≤${GRAPH_MAX_NODES} nodes (goal, decision, option, outcome)
- ≤${GRAPH_MAX_EDGES} edges
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
Return ONLY valid JSON matching this schema:
{
  "nodes": [{"id": "goal_1", "kind": "goal", "label": "Your goal here", "body": "Optional description"}],
  "edges": [{"from": "goal_1", "to": "dec_1", "belief": 0.8, "provenance": {"source": "hypothesis", "quote": "reasoning here"}, "provenance_source": "hypothesis"}],
  "rationales": [{"target": "node_id", "why": "explanation"}] // optional
}

IMPORTANT:
- ALL edges must cite provenance (document quotes, metric data, or hypothesis reasoning)
- NEVER fabricate "needle movers" or "influence scores" - these come only from the engine
- Return ONLY the JSON object, no markdown formatting`;
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
    // Default to GPT-4o-mini for cost efficiency
    this.model = model || process.env.LLM_MODEL || 'gpt-4o-mini';
  }

  async draftGraph(args: DraftGraphArgs, opts: CallOpts): Promise<DraftGraphResult> {
    const { brief, docs = [], seed } = args;
    const prompt = buildDraftPrompt(brief, docs);

    // V04: Generate idempotency key for request traceability
    const idempotencyKey = makeIdempotencyKey();
    const startTime = Date.now();

    log.info(
      { brief_chars: brief.length, doc_count: docs.length, model: this.model, provider: 'openai', idempotency_key: idempotencyKey },
      "calling OpenAI for draft"
    );

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), opts.timeoutMs || TIMEOUT_MS);

    try {
      const apiClient = getClient();
      const response = await apiClient.chat.completions.create(
        {
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          response_format: { type: "json_object" },
          seed: seed, // OpenAI supports deterministic seed
        },
        {
          signal: abortController.signal as any,
          headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
        }
      );

      clearTimeout(timeoutId);
      const _elapsedMs = Date.now() - startTime;

      const content = response.choices[0]?.message?.content;
      if (!content) {
        log.error({ response }, "OpenAI returned empty content");
        throw new Error("openai_empty_response");
      }

      // Parse and validate with Zod
      const rawJson = JSON.parse(content);
      const parseResult = OpenAIDraftResponse.safeParse(rawJson);

      if (!parseResult.success) {
        log.error({ errors: parseResult.error.flatten() }, "OpenAI response failed schema validation");
        throw new Error("openai_response_invalid_schema");
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

      // Sort for determinism
      const sorted = sortGraph({ nodes: parsed.nodes, edges: parsed.edges });

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

      return {
        graph,
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
          log.error({ timeout_ms: opts.timeoutMs || TIMEOUT_MS, elapsed_ms: elapsedMs }, "OpenAI draft call timed out");
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
    const timeoutId = setTimeout(() => abortController.abort(), opts.timeoutMs || TIMEOUT_MS);

    try {
      const apiClient = getClient();
      const response = await apiClient.chat.completions.create(
        {
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7, // Slightly higher for creativity in options
          response_format: { type: "json_object" },
        },
        {
          signal: abortController.signal as any,
          headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
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
          log.error({ timeout_ms: opts.timeoutMs || TIMEOUT_MS, elapsed_ms: elapsedMs }, "OpenAI options call timed out");
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
    const prompt = buildRepairPrompt(graph, violations);

    // V04: Generate idempotency key for request traceability
    const idempotencyKey = makeIdempotencyKey();
    const startTime = Date.now();

    log.info({ violation_count: violations.length, model: this.model, provider: 'openai', idempotency_key: idempotencyKey }, "calling OpenAI for repair");

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), opts.timeoutMs || TIMEOUT_MS);

    try {
      const apiClient = getClient();
      const response = await apiClient.chat.completions.create(
        {
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          response_format: { type: "json_object" },
        },
        {
          signal: abortController.signal as any,
          headers: { "Idempotency-Key": idempotencyKey }, // V04: Add idempotency key
        }
      );

      clearTimeout(timeoutId);
      const _elapsedMs = Date.now() - startTime;

      const content = response.choices[0]?.message?.content;
      if (!content) {
        log.error({ response }, "OpenAI returned empty content for repair");
        throw new Error("openai_empty_response");
      }

      const rawJson = JSON.parse(content);
      const parseResult = OpenAIDraftResponse.safeParse(rawJson);

      if (!parseResult.success) {
        log.error({ errors: parseResult.error.flatten() }, "OpenAI repair response failed schema validation");
        throw new Error("openai_repair_invalid_schema");
      }

      const parsed = parseResult.data;

      // Cap node/edge counts
      if (parsed.nodes.length > GRAPH_MAX_NODES) {
        parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES);
      }

      if (parsed.edges.length > GRAPH_MAX_EDGES) {
        parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES);
      }

      // Sort for determinism
      const sorted = sortGraph({ nodes: parsed.nodes, edges: parsed.edges });

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
          log.error({ timeout_ms: opts.timeoutMs || TIMEOUT_MS, elapsed_ms: elapsedMs }, "OpenAI repair call timed out");
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

  async clarifyBrief(_args: import("./types.js").ClarifyBriefArgs, _opts: CallOpts): Promise<import("./types.js").ClarifyBriefResult> {
    // OpenAI provider does not yet support clarifyBrief
    // Switch to LLM_PROVIDER=anthropic to use this feature
    throw new Error("openai_clarify_not_supported: Clarifier endpoint requires LLM_PROVIDER=anthropic (OpenAI implementation pending)");
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
