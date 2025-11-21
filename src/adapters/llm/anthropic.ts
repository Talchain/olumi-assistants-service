import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Agent, setGlobalDispatcher } from "undici";
import type { DocPreview } from "../../services/docProcessing.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../config/graphCaps.js";
import { ProvenanceSource, NodeKind, StructuredProvenance } from "../../schemas/graph.js";
import { emit, log, TelemetryEvents } from "../../utils/telemetry.js";
import { withRetry } from "../../utils/retry.js";
import type { LLMAdapter, DraftGraphArgs, DraftGraphResult, SuggestOptionsArgs, SuggestOptionsResult, RepairGraphArgs, RepairGraphResult, ClarifyBriefArgs, ClarifyBriefResult, CritiqueGraphArgs, CritiqueGraphResult, CallOpts } from "./types.js";
import { UpstreamTimeoutError, UpstreamHTTPError } from "./errors.js";
import { makeIdempotencyKey } from "./idempotency.js";
import { generateDeterministicLayout } from "../../utils/layout.js";

export type DraftArgs = {
  brief: string;
  docs: DocPreview[];
  seed: number;
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

// Zod schemas for Anthropic response validation
const AnthropicNode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
});

const AnthropicEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
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

const apiKey = process.env.ANTHROPIC_API_KEY;

// V04: Undici dispatcher with production-grade timeouts
// - connectTimeout: 3s (fail fast on connection issues)
// - headersTimeout: 65s (align with 65s deadline)
// - bodyTimeout: 60s (budget for LLM response)
// Note: Anthropic SDK uses fetch API, so we set global undici dispatcher
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
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required but not set");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

const TIMEOUT_MS = 15000;
function isAnthropicPromptCacheEnabled(): boolean {
  return process.env.ANTHROPIC_PROMPT_CACHE_ENABLED !== "false";
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

const DRAFT_SYSTEM_PROMPT = `You are an expert at drafting small decision graphs from plain-English briefs.

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

function buildDraftPrompt(args: DraftArgs): { system: AnthropicSystemBlock[]; userContent: string } {
  const docContext = args.docs.length
    ? `\n\n## Attached Documents\n${args.docs
        .map((d) => {
          const locationInfo = d.locationHint ? ` (${d.locationHint})` : "";
          return `**${d.source}** (${d.type}${locationInfo}):\n${d.preview}`;
        })
        .join("\n\n")}`
    : "";

  const userContent = `## Brief\n${args.brief}${docContext}`;

  return {
    system: buildSystemBlocks(DRAFT_SYSTEM_PROMPT, { operation: "draft_graph" }),
    userContent,
  };
}

const SUGGEST_SYSTEM_PROMPT = `You are an expert at generating strategic options for decisions.

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

function buildSuggestPrompt(args: {
  goal: string;
  constraints?: Record<string, unknown>;
  existingOptions?: string[];
}): { system: AnthropicSystemBlock[]; userContent: string } {
  const existingContext = args.existingOptions?.length
    ? `\n\n## Existing Options\nAvoid duplicating these:\n${args.existingOptions.map((o) => `- ${o}`).join("\n")}`
    : "";

  const constraintsContext = args.constraints
    ? `\n\n## Constraints\n${JSON.stringify(args.constraints, null, 2)}`
    : "";

  const userContent = `## Goal\n${args.goal}${constraintsContext}${existingContext}`;

  return {
    system: buildSystemBlocks(SUGGEST_SYSTEM_PROMPT, { operation: "suggest_options" }),
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
  args: DraftArgs
): Promise<{ graph: GraphT; rationales: { target: string; why: string }[]; usage: UsageMetrics }> {
  const prompt = buildDraftPrompt(args);

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ brief_chars: args.brief.length, doc_count: args.docs.length, idempotency_key: idempotencyKey }, "calling Anthropic for draft");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4096,
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
        model: "claude-3-5-sonnet-20241022",
        operation: "draft_graph",
      }
    );

    clearTimeout(timeoutId);

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
    const parseResult = AnthropicDraftResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten() }, "Anthropic response failed schema validation");
      throw new Error("anthropic_response_invalid_schema");
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

    // Filter edges to only valid node IDs
    const nodeIds = new Set(parsed.nodes.map((n) => n.id));
    const validEdges = parsed.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

    // Assign stable edge IDs
    const edgesWithIds = assignStableEdgeIds(
      validEdges.map((e) => ({
        from: e.from,
        to: e.to,
        weight: e.weight,
        belief: e.belief,
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
}): Promise<{ options: Array<{ id: string; title: string; pros: string[]; cons: string[]; evidence_to_gather: string[] }>; usage: UsageMetrics }> {
  const prompt = buildSuggestPrompt(args);

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
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 2048,
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
        model: "claude-3-5-sonnet-20241022",
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

    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
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
};

const REPAIR_SYSTEM_PROMPT = `You are an expert at fixing decision graph violations.

## Your Task
Fix the graph to resolve ALL violations. Common fixes:
- Remove cycles (decision graphs must be DAGs)
- Remove isolated nodes (all nodes must be connected)
- Ensure edge endpoints reference valid node IDs
- Ensure belief values are between 0 and 1
- Ensure node kinds are valid (goal, decision, option, outcome)
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

function buildRepairPrompt(args: RepairArgs): { system: AnthropicSystemBlock[]; userContent: string } {
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

  return {
    system: buildSystemBlocks(REPAIR_SYSTEM_PROMPT, { operation: "repair_graph" }),
    userContent,
  };
}

export async function repairGraphWithAnthropic(
  args: RepairArgs
): Promise<{ graph: GraphT; rationales: { target: string; why: string }[]; usage: UsageMetrics }> {
  const prompt = buildRepairPrompt(args);

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ violation_count: args.violations.length, idempotency_key: idempotencyKey }, "calling Anthropic for graph repair");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await withRetry(
      async () =>
        apiClient.messages.create(
          {
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4096,
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
        model: "claude-3-5-sonnet-20241022",
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

    // Extract JSON from response
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
    const parseResult = AnthropicDraftResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten(), fallback_reason: "schema_validation_failed", quality_tier: "failed" }, "Anthropic repair response failed schema validation");
      throw new Error("anthropic_repair_invalid_schema");
    }

    const parsed = parseResult.data;

    // Cap node/edge counts
    if (parsed.nodes.length > GRAPH_MAX_NODES) {
      parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES);
    }
    if (parsed.edges.length > GRAPH_MAX_EDGES) {
      parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES);
    }

    // Filter edges to only valid node IDs
    const nodeIds = new Set(parsed.nodes.map((n) => n.id));
    const validEdges = parsed.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

    // Assign stable edge IDs
    const edgesWithIds = assignStableEdgeIds(
      validEdges.map((e) => ({
        from: e.from,
        to: e.to,
        weight: e.weight,
        belief: e.belief,
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

const CLARIFY_SYSTEM_PROMPT = `You are an expert at identifying ambiguities in decision briefs and generating clarifying questions.

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

function buildClarifyPrompt(args: ClarifyArgs): { system: AnthropicSystemBlock[]; userContent: string } {
  const previousContext = args.previous_answers?.length
    ? `\n\n## Previous Q&A (Round ${args.round})\n${args.previous_answers.map((qa, i) => `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`).join("\n")}`
    : "";

  const userContent = `## Brief
${args.brief}
${previousContext}`;

  return {
    system: buildSystemBlocks(CLARIFY_SYSTEM_PROMPT, { operation: "clarify_brief" }),
    userContent,
  };
}

export async function clarifyBriefWithAnthropic(
  args: ClarifyArgs
): Promise<{ questions: Array<{ question: string; choices?: string[]; why_we_ask: string; impacts_draft: string }>; confidence: number; should_continue: boolean; usage: UsageMetrics }> {
  const prompt = buildClarifyPrompt(args);
  const model = args.model || "claude-3-5-sonnet-20241022";

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
            max_tokens: 2048,
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

    // Extract JSON from response
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
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

const CRITIQUE_SYSTEM_PROMPT = `You are an expert at critiquing decision graphs for quality and feasibility.

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

function buildCritiquePrompt(args: CritiqueArgs): { system: AnthropicSystemBlock[]; userContent: string } {
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

  return {
    system: buildSystemBlocks(CRITIQUE_SYSTEM_PROMPT, { operation: "critique_graph" }),
    userContent,
  };
}

export async function critiqueGraphWithAnthropic(
  args: CritiqueArgs
): Promise<{ issues: Array<{ level: "BLOCKER" | "IMPROVEMENT" | "OBSERVATION"; note: string; target?: string }>; suggested_fixes: string[]; overall_quality?: "poor" | "fair" | "good" | "excellent"; usage: UsageMetrics }> {
  const prompt = buildCritiquePrompt(args);
  const model = args.model || "claude-3-5-sonnet-20241022";

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
            max_tokens: 2048,
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

    // Extract JSON from response
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
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
            max_tokens: 2048,
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

    // Extract JSON from response
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
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
    this.model = model || process.env.LLM_MODEL || 'claude-3-haiku-20240307';
  }

  async draftGraph(args: DraftGraphArgs, _opts: CallOpts): Promise<DraftGraphResult> {
    const { brief, docs = [], seed } = args;

    // Call existing function with compatible args
    const result = await draftGraphWithAnthropic({
      brief,
      docs,
      seed,
    });

    return {
      graph: result.graph,
      rationales: result.rationales,
      usage: result.usage,
    };
  }

  async suggestOptions(args: SuggestOptionsArgs, _opts: CallOpts): Promise<SuggestOptionsResult> {
    const result = await suggestOptionsWithAnthropic(args);

    return {
      options: result.options,
      usage: result.usage,
    };
  }

  async repairGraph(args: RepairGraphArgs, _opts: CallOpts): Promise<RepairGraphResult> {
    const { graph, violations } = args;

    const result = await repairGraphWithAnthropic({
      graph,
      violations,
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
