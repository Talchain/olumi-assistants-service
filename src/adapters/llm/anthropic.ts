import Anthropic from "@anthropic-ai/sdk";
import { Agent, fetch as undiciFetch } from "undici";
import { HTTP_CLIENT_TIMEOUT_MS, DRAFT_LLM_TIMEOUT_MS, UNDICI_CONNECT_TIMEOUT_MS, DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S, DRAFT_TTFB_SAFETY_OVERHEAD_S } from "../../config/timeouts.js";
import { config } from "../../config/index.js";
import type { DocPreview } from "../../services/docProcessing.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../config/graphCaps.js";
import { rejectsSamplingParams } from "../../config/models.js";
import { emit, log, TelemetryEvents } from "../../utils/telemetry.js";
import { normaliseLegacyCoachingValues } from "./normalise-legacy-coaching.js";
import { withRetry } from "../../utils/retry.js";
import type { LLMAdapter, DraftGraphArgs, DraftGraphResult, SuggestOptionsArgs, SuggestOptionsResult, RepairGraphArgs, RepairGraphResult, ClarifyBriefArgs, ClarifyBriefResult, CritiqueGraphArgs, CritiqueGraphResult, CallOpts, GraphCappedEvent, ChatArgs, ChatResult, ChatWithToolsArgs, ChatWithToolsResult, ChatWithToolsStreamEvent, ToolResponseBlock, ReplayThinkingBlock, ThinkingConfig } from "./types.js";
import { UpstreamTimeoutError, UpstreamHTTPError, UpstreamNonJsonError } from "./errors.js";
import { makeIdempotencyKey } from "./idempotency.js";
import { generateDeterministicLayout } from "../../utils/layout.js";
import { normaliseDraftResponse, ensureControllableFactorBaselines } from "./normalisation.js";
import { captureCheckpoint, type PipelineCheckpoint } from "../../cee/pipeline-checkpoints.js";
import { getMaxTokensFromConfig } from "./router.js";
import {
  resolveDraftMaxTokens,
  resolveDraftThinking,
  isDraftTruncated,
  DRAFT_RUNAWAY_DETECT_MS,
  DRAFT_RUNAWAY_DETECT_CHARS,
  DRAFT_RUNAWAY_MIN_RETRY_MS,
  DRAFT_MAX_RUNAWAY_RETRIES,
  DRAFT_EDGES_REACHED_RE,
} from "./draft-budget.js";
import { getSystemPrompt, getSystemPromptMeta, invalidatePromptCache } from './prompt-loader.js';
import { formatEdgeId, type CorrectionCollector } from '../../cee/corrections.js';
import { extractJsonFromResponse, closeTruncatedJson, type JsonExtractionOptions, type JsonExtractionResult } from '../../utils/json-extractor.js';
import {
  LLMDraftResponse as AnthropicDraftResponse,
  LLMRepairResponse as AnthropicRepairResponse,
  LLMOptionsResponse as AnthropicOptionsResponse,
  LLMClarifyResponse as AnthropicClarifyResponse,
  LLMCritiqueResponse as AnthropicCritiqueResponse,
  LLMExplainDiffResponse as AnthropicExplainDiffResponse,
} from './shared-schemas.js';
import { extractZodIssues } from '../../schemas/llmExtraction.js';
import { buildDraftGraphSchema } from '../../cee/draft/anthropic-graph-schema.js';

export { FALLBACK_ANTHROPIC_MODEL, resolveAnthropicModel } from "./model-fallback.js";
import { resolveAnthropicModel } from "./model-fallback.js";

// enforceAnthropicSchemaCompliance removed from runtime — schemas are compliant by construction.
// The function is retained in anthropic-schema-compliance.ts as a test-only utility.

export type DraftArgs = {
  brief: string;
  docs: DocPreview[];
  seed: number;
  model?: string;
  includeDebug?: boolean;
  briefSignalsHeader?: string;
  currencyInstruction?: string;
  /**
   * System-side corrective directive (lean-retry / strength-default nudge),
   * appended OUTSIDE the untrusted-user-content markers — see buildDraftPrompt.
   */
  systemDirective?: string;
  /** Extended thinking configuration. When enabled, temperature is forced to 1 and structured outputs are disabled. */
  thinking?: ThinkingConfig;
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

/** Error thrown when the Anthropic response content type is unrecognised. */
const ERR_UNEXPECTED_RESPONSE_TYPE = 'unexpected_response_type';

/**
 * Max size for raw LLM output in debug trace (chars).
 * Truncates large responses to prevent payload bloat.
 */
const RAW_LLM_OUTPUT_MAX_CHARS = 50000;

/**
 * Truncate raw LLM output for debug tracing.
 * Uses a bounded stringify that bails out early to prevent OOM on pathological inputs.
 */
function truncateRawOutput(raw: unknown): { output: unknown; truncated: boolean } {
  const limit = RAW_LLM_OUTPUT_MAX_CHARS;
  // Single-pass: build the string once, bail out via replacer if enormous
  let charCount = 0;
  let bailedOut = false;
  let fullJson: string;
  try {
    fullJson = JSON.stringify(raw, (_key, value) => {
      if (bailedOut) return undefined;
      const fragment = typeof value === 'string' ? value : '';
      charCount += fragment.length + 4;
      if (charCount > limit * 2) {
        bailedOut = true;
        return undefined;
      }
      return value;
    }) ?? '';
  } catch {
    bailedOut = true;
    fullJson = '';
  }

  if (!bailedOut && fullJson.length <= limit) {
    return { output: raw, truncated: false };
  }
  const preview = fullJson.slice(0, limit);
  return {
    output: { _truncated: true, _original_size: fullJson.length, preview },
    truncated: true,
  };
}

/**
 * Safe wrapper around extractJsonFromResponse that throws UpstreamNonJsonError
 * instead of generic Error when JSON extraction fails.
 */
function safeExtractJson(
  content: string,
  opts: JsonExtractionOptions,
  operation: string,
  elapsedMs: number,
  requestId?: string,
): JsonExtractionResult {
  try {
    return extractJsonFromResponse(content, opts);
  } catch (cause) {
    throw new UpstreamNonJsonError(
      `anthropic ${operation} returned non-JSON response`,
      "anthropic",
      operation,
      elapsedMs,
      content.slice(0, 500),
      undefined,
      undefined,
      requestId,
      cause,
    );
  }
}

// Schemas imported from shared-schemas.ts (AnthropicNode, AnthropicEdge, etc.)

// Use centralized config for API key (lazy access via getter)
function getApiKey(): string | undefined {
  return config.llm.anthropicApiKey;
}

// V04: Undici dispatcher with production-grade timeouts (instance-scoped, NOT global)
// - connectTimeout: 3s (fail fast on connection issues)
// - headers/body timeout: HTTP_CLIENT_TIMEOUT_MS (central config)
const anthropicDispatcher = new Agent({
  connect: {
    timeout: UNDICI_CONNECT_TIMEOUT_MS,
  },
  headersTimeout: HTTP_CLIENT_TIMEOUT_MS,
  bodyTimeout: HTTP_CLIENT_TIMEOUT_MS,
});

// Scoped fetch that uses our Anthropic-tuned dispatcher without polluting the global
const anthropicFetch: typeof globalThis.fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...init as Parameters<typeof undiciFetch>[1],
    dispatcher: anthropicDispatcher,
  }) as unknown as Promise<Response>;

// Lazy initialization to allow testing without API key.
// Tracks the key the client was created with so we can detect rotation.
let client: Anthropic | null = null;
let clientApiKey: string | null = null;

function getClient(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required but not set");
  }
  if (!client || clientApiKey !== apiKey) {
    client = new Anthropic({ apiKey, fetch: anthropicFetch });
    clientApiKey = apiKey;
  }
  return client;
}

const TIMEOUT_MS = HTTP_CLIENT_TIMEOUT_MS;

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

// Compliance reminder appended to the user message for initial draft generation only.
// Reinforces critical structural rules at the point of generation (not in the system prompt).
// Controlled by CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED (default: true).
const DRAFT_COMPLIANCE_REMINDER = `\n\nCOMPLIANCE REMINDER:
- Output valid JSON only (no comments, no text outside the JSON object)
- Every outcome and risk needs an inbound path from a controllable factor
- Every option needs a complete path to goal: option → controllable → outcome/risk → goal
- 2–6 options maximum`;

// v12 (2026-07-23, lean-draft contract, ROADMAP 1.197): the draft grammar is
// STRUCTURE ONLY — coaching / causal_claims / topology_plan are dropped from the
// sent schema and the object is additionalProperties:false, so the old v8
// "emit aux fields as stringified JSON" reminder became an empty-string no-op
// and was deleted (simplification F2, 2026-07-24). If a future field is ever
// re-added to the grammar as a stringified aux field, restore the instruction at
// the buildCallParams user-message content site (recoverable from git history).

/**
 * Structural anatomy of a TRUNCATED draft response (v12, 2026-07-23).
 *
 * A max_tokens runaway stores no partial graph, so the corpus could never say
 * whether runaways are a COUNT explosion (many nodes/edges) or a PER-ELEMENT
 * prose blowup (few but huge). These are cheap, NON-SENSITIVE structural
 * metrics from the truncated text — no raw brief content — that distinguish the
 * two and localise the truncation section, resolving the drafting design's #1
 * open evidence limit. Deliberately tolerant of unparseable tails (a truncation
 * is by definition not valid JSON).
 */
function measureTruncatedDraftAnatomy(text: string): {
  approxNodes: number;
  approxEdges: number;
  largestElementBytes: number;
  section: "nodes" | "edges" | "goal_constraints" | "unknown";
} {
  // Node objects carry `"kind":`; edge objects carry `"from":`. One match each
  // per emitted element — a cheap tally of how much structure was produced
  // before the cut.
  const approxNodes = (text.match(/"kind"\s*:/g) || []).length;
  const approxEdges = (text.match(/"from"\s*:/g) || []).length;

  // Largest COMPLETE {...} block (any depth) = the largest fully-emitted element
  // (a node contains its `data`, so the node object is the outer block). The
  // root object never closes on a truncation, so it is excluded automatically.
  // A largest_element_bytes far above the ~330-byte corpus max signals a
  // single-element (per-node/per-edge prose) runaway rather than a count one.
  let largestElementBytes = 0;
  const startStack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") startStack.push(i);
    else if (ch === "}") {
      const s = startStack.pop();
      if (s !== undefined) {
        const len = i - s + 1;
        if (len > largestElementBytes) largestElementBytes = len;
      }
    }
  }

  // Which top-level section was open at the cut (last top-level key seen).
  const nIdx = text.lastIndexOf('"nodes"');
  const eIdx = text.lastIndexOf('"edges"');
  const gIdx = text.lastIndexOf('"goal_constraints"');
  const maxIdx = Math.max(nIdx, eIdx, gIdx);
  let section: "nodes" | "edges" | "goal_constraints" | "unknown" = "unknown";
  if (maxIdx < 0) section = "unknown";
  else if (maxIdx === gIdx) section = "goal_constraints";
  else if (maxIdx === eIdx) section = "edges";
  else section = "nodes";

  return { approxNodes, approxEdges, largestElementBytes, section };
}

// Defense-in-depth cap on total document context chars (grounding module enforces 50k upstream)
const MAX_DOC_CONTEXT_CHARS = 60_000;

async function buildDraftPrompt(args: DraftArgs, opts?: { forceDefault?: boolean }): Promise<{ system: AnthropicSystemBlock[]; userContent: string }> {
  let docContext = "";
  if (args.docs.length) {
    const parts: string[] = [];
    let totalLen = 0;
    for (const d of args.docs) {
      const locationInfo = d.locationHint ? ` (${d.locationHint})` : "";
      const part = `**${d.source}** (${d.type}${locationInfo}):\n${d.preview}`;
      totalLen += part.length;
      if (totalLen > MAX_DOC_CONTEXT_CHARS) {
        log.warn({ totalLen, docCount: args.docs.length }, "Document context exceeded adapter-level cap; truncating");
        break;
      }
      parts.push(part);
    }
    if (parts.length) {
      docContext = `\n\n## Attached Documents\n[BEGIN_UNTRUSTED_USER_CONTENT]\n${parts.join("\n\n")}\n[END_UNTRUSTED_USER_CONTENT]`;
    }
  }

  const complianceReminder = config.cee.draftComplianceReminderEnabled ? DRAFT_COMPLIANCE_REMINDER : "";
  const briefSignalsHeader = args.briefSignalsHeader ?? "";
  const currencyInstruction = args.currencyInstruction ?? "";
  // System-side corrective directive (lean-retry / strength-default nudge) —
  // OUTSIDE the untrusted markers, alongside the other system-authored
  // appendices (compliance reminder, signals header). #595 review P2: when a
  // corrective instruction is concatenated into `args.brief` it lands INSIDE
  // [BEGIN/END]_UNTRUSTED_USER_CONTENT, which tells the model to treat its own
  // retry instruction as untrusted user input. Threading it here keeps the
  // brief itself untouched (still fully bracketed) and gives the directive
  // system authority.
  const systemDirective = args.systemDirective
    ? `\n\n${args.systemDirective}`
    : "";
  const userContent = `## Brief
[BEGIN_UNTRUSTED_USER_CONTENT]
${args.brief}
[END_UNTRUSTED_USER_CONTENT]${docContext}${complianceReminder}${briefSignalsHeader}${currencyInstruction}${systemDirective}`;

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

// Models confirmed to support Anthropic Structured Outputs (GA since Jan 2026).
// Uses output_config.format (GA path), no beta header required.
// Only models listed here will receive the output_config body.
// Add new models here once confirmed via API testing.
// Schema is compliant by construction — no runtime normalisation needed.

const STRUCTURED_OUTPUTS_SUPPORTED_MODELS = new Set([
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-6",
  // claude-sonnet-5 is deliberately NOT in this SHARED set, even though it
  // accepts GA structured outputs (live-probed 2026-07-14, output_config, no
  // beta header). Membership here is consulted by buildStrictAnthropicTools
  // with NO env gate, so listing sonnet-5 — the model staging serves for
  // every live /orchestrate/v2/turn — would switch strict tool calling on
  // for all live turns the moment it deploys (all M2 flags off), and would
  // flip the edit_graph/draft prompt-only fallbacks whenever
  // CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true. The V6 dual-draft M2 review — the
  // one call that needs sonnet-5 structured outputs — opts in per-call via
  // ChatArgs.structuredOutputsAdditionalModels (src/cee/dual-draft/m2-review.ts).
  "claude-opus-4-6",
  "claude-opus-4-20250514",
  "claude-opus-4-5-20251101",
]);

// Models that support extended thinking (budget_tokens reasoning).
// Older Anthropic models reject the `thinking` parameter with a 400.
// Non-Anthropic models ignore it silently via their own adapters.
const THINKING_SUPPORTED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-20250514",
  "claude-opus-4-5-20251101",
]);

/**
 * Guard extended thinking against unsupported Anthropic models.
 * Logs a warning and returns false when the model is not in the allowlist,
 * allowing the call to proceed without thinking rather than failing at the API.
 */
function isThinkingSupported(model: string, context: string): boolean {
  if (THINKING_SUPPORTED_MODELS.has(model)) return true;
  log.warn(
    { model, context, supported_models: Array.from(THINKING_SUPPORTED_MODELS) },
    `[Anthropic] Extended thinking requested but model "${model}" is not in the thinking-supported allowlist — disabling thinking for this call`
  );
  return false;
}

// Affordability derivation + terminal-completion policy now live in the
// provider-independent seam (ROADMAP 2.90) so the OpenAI draft path shares them.
// Re-exported here so `resolveDraftMaxTokens` keeps its existing import path
// (server.ts boot assertion + the #588 value tests import it from this module).
// The `ceilingTokens` "runaway sentinel" arg (#609) travels WITH the function
// into the hoisted seam — see draft-budget.ts — so this re-export preserves the
// attempt-1 max_tokens cap end-to-end (the sentinel would silently no-op if the
// hoisted wrapper kept the old single-arg signature).
export { resolveDraftMaxTokens };

/**
 * Determine if a caught error is a Structured Outputs **capability** rejection
 * (model/version/parameter not supported) — NOT a schema validation error.
 *
 * Capability rejections → safe to fall back to prompt-only JSON.
 * Schema errors (malformed schema, wrong nested keys) → must fail loudly so
 * developers catch broken payloads rather than silently degrading.
 *
 * Classification:
 * - "Unexpected key 'output_config'" or "Unknown parameter: output_config"
 *     → capability rejection (API doesn't know the parameter) → fall back
 * - "output_config.format: Unexpected key 'json_schema'"
 *     → schema shape error (wrong nested key) → fail loudly
 * - "Invalid JSON schema: unsupported keyword '$ref'"
 *     → schema validation error → fail loudly
 */
function isStructuredOutputsRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const apiErr = err as { status?: number; message?: string };
  if (apiErr.status !== 400) return false;
  const msg = (apiErr.message ?? '').toLowerCase();

  // Grammar/compilation capacity limits are safe to fall back from —
  // the schema is valid but too complex for the structured output compiler.
  if (msg.includes('compiled grammar is too large') ||
      msg.includes('too many parameters with union types')) {
    return true;
  }

  // Schema validation errors should NOT trigger fallback — fail loudly.
  const isSchemaError =
    (msg.includes('invalid') && msg.includes('schema')) ||
    (msg.includes('unsupported') && msg.includes('schema'));
  if (isSchemaError) return false;

  // "Unexpected key" inside the structured outputs parameter body (e.g. wrong
  // nested key like 'json_schema' instead of 'schema') is a schema shape error.
  // But "Unexpected key 'output_config'" or "Unexpected key 'output_format'" is
  // a capability rejection (the top-level parameter itself is unknown).
  if (msg.includes('unexpected key')) {
    // Top-level parameter rejection → capability issue → allow fallback
    if (msg.includes("unexpected key 'output_config'") ||
        msg.includes("unexpected key 'output_format'") ||
        msg.includes('unexpected key: output_config') ||
        msg.includes('unexpected key: output_format')) {
      return true;
    }
    // Any other "unexpected key" (nested key errors) → schema shape error → fail loudly
    return false;
  }

  // Only fall back for capability/parameter rejections
  return msg.includes('output_config') ||
    msg.includes('output_format') ||
    msg.includes('not supported');
}

export async function draftGraphWithAnthropic(
  args: DraftArgs,
  opts?: { collector?: CorrectionCollector; refreshPrompts?: boolean; forceDefault?: boolean; signal?: AbortSignal; timeoutMs?: number; maxTokensCeiling?: number }
): Promise<DraftGraphResult> {
  const collector = opts?.collector;

  // X-CEE-Refresh-Prompt support: invalidate cache to force fresh load from Supabase
  if (opts?.refreshPrompts) {
    invalidatePromptCache('draft_graph', 'header_refresh');
    log.info({ taskId: 'draft_graph' }, 'Prompt cache invalidated via X-CEE-Refresh-Prompt header');
  }

  const prompt = await buildDraftPrompt(args, { forceDefault: opts?.forceDefault });
  const promptMeta = getSystemPromptMeta('draft_graph');
  const model = args.model || "claude-sonnet-4-6";
  const draftThinkingRequested = args.thinking?.type === 'enabled';
  const draftThinkingSupported = draftThinkingRequested && isThinkingSupported(model, 'draft_graph');
  const requestedThinkingBudget = draftThinkingSupported ? (args.thinking as { type: 'enabled'; budget_tokens: number }).budget_tokens : 0;

  // Align timeout with DRAFT_LLM_TIMEOUT_MS when not explicitly overridden.
  // Previously fell back to HTTP_CLIENT_TIMEOUT_MS, which reserves NO post-LLM
  // headroom. DRAFT_LLM_TIMEOUT_MS (= DRAFT_REQUEST_BUDGET_MS minus
  // LLM_POST_PROCESSING_HEADROOM_MS, both derived in config/timeouts.ts) is the
  // pipeline-correct window because it leaves room for validation/repair/
  // enrichment inside the request budget — recompute from config, don't pin the
  // number. Stage 1 (Parse) always passes opts.timeoutMs so this fallback only
  // matters for direct calls (e.g. tests, legacy routes). Resolved BEFORE
  // max_tokens because max_tokens is DERIVED from it.
  const effectiveTimeout = opts?.timeoutMs ?? DRAFT_LLM_TIMEOUT_MS;

  // Token budget derived from the timeout (2026-07-20 outage fix) — see
  // resolveDraftMaxTokens above. The effective budget can never exceed what
  // the timeout affords, so a runaway generation returns truncated (typed
  // handling below) instead of hanging to the timeout.
  const {
    configured: configuredDraftMaxTokens,
    affordable: affordableDraftTokens,
    effective: derivedMaxTokens,
  } = resolveDraftMaxTokens(effectiveTimeout, opts?.maxTokensCeiling);
  if (configuredDraftMaxTokens !== null && configuredDraftMaxTokens > affordableDraftTokens) {
    log.warn({
      event: "cee.llm.draft_max_tokens_clamped",
      configured_max_tokens: configuredDraftMaxTokens,
      affordable_tokens: affordableDraftTokens,
      timeout_ms: effectiveTimeout,
      throughput_floor_tok_s: DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
      overhead_s: DRAFT_TTFB_SAFETY_OVERHEAD_S,
    }, "[Anthropic] configured draft max_tokens exceeds what the timeout affords — clamped (2026-07-20 outage class; boot logs the same at ERROR)");
  }

  // THINKING CLAMP (ROADMAP 2.90, Codex #8). Extended thinking is an explicit
  // operator opt-in (CEE_DRAFT_GRAPH_THINKING, default off). The Anthropic API
  // requires max_tokens > budget_tokens, so a thinking budget forces a max_tokens
  // floor. The PRE-2.90 behaviour raised max_tokens to `budget + 1024` and only
  // WARNED when that exceeded affordability — which RESURRECTED the exact
  // unaffordable budget the 2026-07-20 outage fix removed (default budget 10000 +
  // 1024 = 11024 > affordable ~8550, boot warns-but-continues). `resolveDraftThinking`
  // instead clamps the thinking budget DOWN so the TOTAL request (thinking +
  // reserved visible output) is provably ≤ affordable; if affordability cannot fit
  // even the minimum thinking budget plus a real answer, thinking is disabled
  // rather than shipped unaffordable. Boot independently rejects an unaffordable
  // explicit config (validateDraftThinkingAffordability, ERROR level).
  let draftThinkingEnabled = draftThinkingSupported;
  let draftThinkingBudget = requestedThinkingBudget;
  let maxTokens = derivedMaxTokens;
  if (draftThinkingSupported) {
    const clampedThinking = resolveDraftThinking({
      requestedBudget: requestedThinkingBudget,
      affordable: affordableDraftTokens,
      derivedMaxTokens,
    });
    draftThinkingEnabled = clampedThinking.enabled;
    draftThinkingBudget = clampedThinking.budget;
    maxTokens = clampedThinking.maxTokens;
    if (clampedThinking.disabled) {
      log.error({
        event: "cee.llm.draft_thinking_disabled_unaffordable",
        requested_budget_tokens: requestedThinkingBudget,
        affordable_tokens: affordableDraftTokens,
        timeout_ms: effectiveTimeout,
      }, "[Anthropic] affordable draft budget cannot fit the minimum extended-thinking budget plus a real answer — extended thinking DISABLED for this call; the request stays within the affordable budget instead of hanging to the timeout (2026-07-20 outage class). Raise DRAFT_REQUEST_BUDGET_MS to re-enable.");
    } else if (clampedThinking.clamped) {
      log.warn({
        event: "cee.llm.draft_thinking_budget_clamped",
        requested_budget_tokens: requestedThinkingBudget,
        clamped_budget_tokens: draftThinkingBudget,
        max_tokens: maxTokens,
        affordable_tokens: affordableDraftTokens,
        timeout_ms: effectiveTimeout,
      }, "[Anthropic] extended-thinking budget clamped DOWN so the total request fits the affordable draft budget — no longer resurrects the unaffordable 2026-07-20 outage config (Codex #8). Lower CEE_DRAFT_GRAPH_THINKING_BUDGET or raise DRAFT_REQUEST_BUDGET_MS to avoid the clamp.");
    }
  }
  // Anthropic requires temperature=1 when extended thinking is active.
  // Sonnet 5 / Opus 4.7+ / Fable 5 REJECT any explicit sampling param with a 400 —
  // omit temperature entirely for them (undefined is dropped from the request body
  // by the SDK's JSON serialisation). This is the 4th sampling-param call site; it
  // mirrors the chat / chat_with_tools / stream paths (rejectsSamplingParams gate
  // takes precedence over the thinking=1 rule). Future consolidation: the four sites
  // inline the same ternary — a shared helper is the obvious de-mirror.
  const draftTemperature = rejectsSamplingParams(model)
    ? undefined
    : (draftThinkingEnabled ? 1 : 0);

  // Structured Outputs feature flag — only active when both the flag is on AND the
  // selected model is in the supported allowlist AND thinking is not enabled
  // (extended thinking is incompatible with structured outputs).
  const structuredOutputsEnabled =
    !draftThinkingEnabled &&
    config.cee.anthropicStructuredOutputs &&
    STRUCTURED_OUTPUTS_SUPPORTED_MODELS.has(model);

  if (config.cee.anthropicStructuredOutputs && !STRUCTURED_OUTPUTS_SUPPORTED_MODELS.has(model)) {
    log.warn(
      { model, supported_models: Array.from(STRUCTURED_OUTPUTS_SUPPORTED_MODELS) },
      "[Anthropic] CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true but model is not in supported allowlist — falling back to prompt-only JSON mode"
    );
  }

  // v11 (2026-07-21, runaway-draft lane fix b) — UNCONDITIONAL. Drops the
  // zero-reader `topology_plan` key from the grammar (508 output tokens / 8.1%
  // of a measured draft, and closes the live prompt/grammar contradiction).
  // Only meaningful on the structured path: the prompt-only fallback has no
  // grammar to omit it from, and the served prompt v195 already instructs the
  // model not to emit it there.
  const draftGraphSchema = buildDraftGraphSchema();

  if (draftThinkingEnabled && config.cee.anthropicStructuredOutputs) {
    log.info(
      { model, budget_tokens: draftThinkingBudget },
      "[Anthropic] Extended thinking enabled for draft_graph — structured outputs disabled (incompatible)"
    );
  }

  // V04: Generate idempotency key for request traceability. `let` (not `const`)
  // because the structured-outputs→prompt-only rebuild (so_reject) changes the
  // request body and must NOT reuse the key that carried the rejected structured
  // body — a provider that honours Idempotency-Key replay would otherwise replay
  // the 400 and break the graceful degradation (F8, 2026-07-24).
  let idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  // Debug: Log model parameters for runtime validation (mirrors OpenAI adapter pattern)
  log.debug({
    model,
    params: {
      temperature: draftTemperature,
      max_tokens: maxTokens,
      structured_outputs: structuredOutputsEnabled,
      thinking: draftThinkingEnabled ? 'enabled' : 'none',
      timeout_ms: effectiveTimeout,
    },
  }, "[Anthropic] draft_graph request parameters");

  log.info({ brief_chars: args.brief.length, doc_count: args.docs.length, model, idempotency_key: idempotencyKey, prompt_id: promptMeta.taskId, prompt_hash: promptMeta.prompt_hash, prompt_source: promptMeta.source }, "calling Anthropic for draft");

  // CEE_PROMPT_DEBUG_ENABLED: log prompt hash, source metadata, and system prompt preview
  if (config.cee.promptDebugEnabled) {
    const systemText = prompt.system.map((b: any) => (typeof b === 'string' ? b : b.text ?? '')).join('');
    log.info({
      event: "cee.prompt_debug",
      task: "draft_graph",
      prompt_hash: promptMeta.prompt_hash,
      prompt_source: promptMeta.source,
      prompt_id: promptMeta.promptId,
      prompt_version: promptMeta.version,
      is_staging: promptMeta.isStaging,
      use_staging_mode: promptMeta.use_staging_mode,
      cache_status: promptMeta.cache_status,
      cache_age_ms: promptMeta.cache_age_ms,
      instance_id: promptMeta.instance_id,
      structured_outputs_enabled: structuredOutputsEnabled,
      system_prompt_preview: systemText.slice(0, 200),
      system_prompt_chars: systemText.length,
    }, "[CEE_PROMPT_DEBUG] draft_graph prompt delivery");
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

  // Wire external abort signal (e.g. client disconnect / budget cancellation)
  const externalSignal = opts?.signal;
  let onExternalAbort: (() => void) | undefined;
  if (externalSignal && !externalSignal.aborted) {
    onExternalAbort = () => abortController.abort();
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  } else if (externalSignal?.aborted) {
    abortController.abort();
  }

  try {
    const apiClient = getClient();

    /**
     * Build the messages.create params for a given structured-outputs mode.
     * When useStructuredOutputs=true, adds the GA output_config.format body.
     * Shape: output_config: { format: { type: "json_schema", schema: {...} } }
     * No beta header required — structured outputs is GA since Jan 2026.
     * When false, plain call — prompt instructions enforce JSON.
     */
    function buildCallParams(useStructuredOutputs: boolean): {
      body: Anthropic.MessageCreateParamsNonStreaming;
    } {
      const body: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: maxTokens,
        temperature: draftTemperature,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.userContent }],
        ...(useStructuredOutputs
          ? {
              output_config: {
                format: {
                  type: "json_schema",
                  schema: draftGraphSchema as Record<string, unknown>,
                },
              },
            }
          : {}),
        ...(draftThinkingEnabled ? { thinking: { type: 'enabled', budget_tokens: draftThinkingBudget } } : {}),
      };
      // Returns only `{ body }`: the streamed loop constructs its own per-attempt
      // signal + Idempotency-Key header (streamOneDraftAttempt), so the old
      // `options: { signal, headers }` return had no reader — dead remnant of the
      // removed non-streaming messages.create(body, options) path (simplification F1).
      return { body };
    }

    let useStructuredOutputs = structuredOutputsEnabled;
    let { body } = buildCallParams(useStructuredOutputs);

    /**
     * C1 + C2 (Lane C, 2026-07-23): stream ONE draft generation and detect the
     * runaway EARLY. The wave-1 anatomy proved the residual failure class cuts
     * INSIDE the `nodes` array with 0 edges at ~8550 tokens / ~82-91s; a
     * non-streaming call pays that full ~85s for a doomed attempt. Streaming
     * lets us see the model is still in nodes long past when every healthy draft
     * has finished, abort, and retry within the remaining budget.
     *
     * Returns a discriminated result so the caller's retry loop can distinguish:
     *  - complete   : the stream finished; `message` is the SAME shape as
     *                 `messages.create` returns (content/usage/stop_reason), so
     *                 the entire downstream parse/salvage/validate path is
     *                 unchanged (incl. a natural max_tokens truncation).
     *  - runaway    : detected still-in-nodes past the deadline; the attempt was
     *                 aborted — the caller retries a fresh generation.
     *  - so_reject  : the API rejected `output_config` (400) — the caller drops
     *                 to prompt-only JSON mode (unchanged graceful degradation).
     * Any other error (overall timeout / external abort / 429 / 5xx / fatal) is
     * thrown so `withRetry` (transient) or the outer catch (typed) handles it.
     *
     * `detectDeadlineMs === null` disables early abort (the FINAL attempt runs to
     * the full remaining budget). Detection is also inactive when extended
     * thinking is on (a legitimately longer generation; off by default here).
     */
    async function streamOneDraftAttempt(
      attemptBody: Anthropic.MessageStreamParams,
      attemptIdempotencyKey: string,
      detectDeadlineMs: number | null,
    ): Promise<
      | { kind: "complete"; message: Anthropic.Message; timeToEdgesMs: number | null }
      | { kind: "runaway"; chars: number; elapsedMs: number; trigger: "time" | "chars" }
      | { kind: "so_reject"; error: unknown }
    > {
      // Per-attempt controller: aborted either by our runaway detector OR by the
      // overall abortController (timeout / external client disconnect). Only the
      // latter must surface as a real timeout — the runaway abort is swallowed
      // and retried.
      const perAttempt = new AbortController();
      const relayOverallAbort = () => perAttempt.abort();
      if (abortController.signal.aborted) perAttempt.abort();
      else abortController.signal.addEventListener("abort", relayOverallAbort, { once: true });

      const attemptStart = Date.now();
      let acc = "";
      // Start of the not-yet-cleared window for the edges probe. The probe scans
      // only the freshly-appended tail plus an overlap so a `"from"\s*:` match
      // straddling a delta boundary is never missed — O(n) over the whole draft
      // instead of re-scanning the ever-growing accumulator from index 0 on every
      // delta through the long nodes phase (efficiency F1, 2026-07-24). The
      // overlap (32) comfortably exceeds the longest realistic `"from"` + optional
      // whitespace + `:`; a false-negative here would false-abort a healthy draft,
      // so it is deliberately generous.
      let edgesProbeOffset = 0;
      const EDGES_PROBE_OVERLAP = 32;
      let edgesReached = false;
      // Time from stream start to the first edge — the empirical signal that
      // validates DRAFT_RUNAWAY_DETECT_MS live (a healthy draft should reach
      // edges well under the deadline). Recorded on success, surfaced on meta.
      let timeToEdgesMs: number | null = null;
      let runaway: { chars: number; elapsedMs: number; trigger: "time" | "chars" } | null = null;
      // True only when the char gate broke the loop mid-stream (a definite
      // runaway). Distinguishes that from the time gate firing between the last
      // delta and iterator-done on a stream that actually COMPLETED (F5 race,
      // 2026-07-24): the char break is unrecoverable, but a cleanly-finished
      // stream whose finalMessage is available must be preferred over discarding
      // it as a runaway.
      let brokeForChars = false;
      let detectTimer: ReturnType<typeof setTimeout> | undefined;

      // Timer-armed time gate: fires even if the model stops emitting deltas (a
      // silent constrained-decode thrash still burns wall-clock), which an
      // in-loop check alone could not catch.
      const detectionActive = detectDeadlineMs != null && !draftThinkingEnabled;
      if (detectionActive) {
        detectTimer = setTimeout(() => {
          if (!edgesReached && !runaway) {
            runaway = { chars: acc.length, elapsedMs: Date.now() - attemptStart, trigger: "time" };
            perAttempt.abort();
          }
        }, detectDeadlineMs as number);
      }

      try {
        const stream = apiClient.messages.stream(attemptBody, {
          signal: perAttempt.signal,
          headers: { "Idempotency-Key": attemptIdempotencyKey },
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            acc += event.delta.text;
            if (!edgesReached && DRAFT_EDGES_REACHED_RE.test(acc.slice(edgesProbeOffset))) {
              // Past the nodes bottleneck — this is a healthy generation; cancel
              // the detector and let the stream complete.
              edgesReached = true;
              timeToEdgesMs = Date.now() - attemptStart;
              if (detectTimer) { clearTimeout(detectTimer); detectTimer = undefined; }
              // Live validation of DRAFT_RUNAWAY_DETECT_MS: a healthy draft must
              // reach the edges array well under the deadline. Queryable in Render
              // logs (structural metrics only — no brief content).
              log.info({
                event: "cee.llm.draft_edges_reached",
                model,
                time_to_edges_ms: timeToEdgesMs,
                chars: acc.length,
                detect_ms: detectDeadlineMs,
              }, "[Anthropic] draft_graph reached the edges array — healthy generation past the nodes bottleneck");
            } else if (detectionActive && !edgesReached && !runaway && acc.length >= DRAFT_RUNAWAY_DETECT_CHARS) {
              runaway = { chars: acc.length, elapsedMs: Date.now() - attemptStart, trigger: "chars" };
              brokeForChars = true;
              perAttempt.abort();
              break;
            }
            // Advance the edges-probe window, keeping an overlap so the next scan
            // still catches a `"from"\s*:` that straddles this delta boundary.
            if (!edgesReached) {
              edgesProbeOffset = Math.max(edgesProbeOffset, acc.length - EDGES_PROBE_OVERLAP);
            }
          }
        }
        if (detectTimer) clearTimeout(detectTimer);
        abortController.signal.removeEventListener("abort", relayOverallAbort);
        // Char-gate runaway is unrecoverable → return it. A time-gate runaway that
        // fired AFTER the last delta while the iterator still finished cleanly
        // (F5 race) falls through: the stream completed, so prefer its
        // finalMessage over regenerating a draft we already have. If the timer
        // aborted the stream mid-flight, finalMessage() rejects and the catch
        // re-classifies it as a runaway (unchanged).
        if (runaway && brokeForChars) return { kind: "runaway", ...runaway };
        const message = await stream.finalMessage();
        return { kind: "complete", message, timeToEdgesMs };
      } catch (streamErr) {
        if (detectTimer) clearTimeout(detectTimer);
        abortController.signal.removeEventListener("abort", relayOverallAbort);
        // WE aborted this attempt for a runaway (perAttempt aborted, overall
        // still live) — classify as a runaway retry, not an error.
        if (runaway && !abortController.signal.aborted) {
          return { kind: "runaway", ...runaway };
        }
        // Structured Outputs capability rejection (400) → prompt-only fallback.
        // Same single-attempt graceful degradation as the non-streaming path;
        // withRetry handles rate-limit / server-error retries separately.
        if (useStructuredOutputs && isStructuredOutputsRejection(streamErr)) {
          return { kind: "so_reject", error: streamErr };
        }
        throw streamErr;
      }
    }

    let response: Anthropic.Message | undefined;
    let runawayAbortCount = 0;
    let streamTimeToEdgesMs: number | null = null;
    // Last live-clock remaining budget observed inside the attempt closure — used
    // only for the runaway telemetry below (the authoritative window is derived
    // per invocation inside the closure).
    let lastRemainingBudgetMs = effectiveTimeout;
    // Count of stream invocations across the whole draft call (including
    // withRetry's transient inner retries). The FIRST invocation has consumed no
    // budget, so its window ≈ effectiveTimeout and the attempt-1 max_tokens
    // derivation already fits — the F1 cap only LOWERS on a LATER invocation
    // whose predecessors actually burned budget.
    let streamInvocations = 0;
    for (let attempt = 1; response === undefined; attempt++) {
      // Fresh idempotency key per RETRY so the provider RE-GENERATES rather than
      // replaying the doomed generation for the same key (retries would be
      // pointless otherwise); attempt 1 keeps the original key for logging
      // identity, and withRetry's transient retries reuse it (idempotent).
      const attemptIdempotencyKey = attempt === 1 ? idempotencyKey : makeIdempotencyKey();

      const attemptResult = await withRetry(
        () => {
          streamInvocations++;
          // Re-derive the abort authorization AND max_tokens from the LIVE clock
          // on EVERY invocation (F2, 2026-07-24). withRetry's transient retries +
          // backoff consume request budget, so a window computed once at the loop
          // top can authorize an early abort that no longer leaves room for the
          // retry it promised (worst case squeezing the "final" window toward
          // zero). Reading Date.now() here binds the decision to the budget that
          // actually remains at the moment the attempt starts.
          const remainingBudgetMs = effectiveTimeout - (Date.now() - startTime);
          lastRemainingBudgetMs = remainingBudgetMs;
          // Keep early-aborting only while there is budget for a detect PLUS a full
          // healthy retry after it; otherwise this is the FINAL attempt and runs to
          // the whole remaining window (no early abort) so a late completion /
          // salvage is never thrown away.
          const canRetryAgain =
            remainingBudgetMs > DRAFT_RUNAWAY_DETECT_MS + DRAFT_RUNAWAY_MIN_RETRY_MS &&
            runawayAbortCount < DRAFT_MAX_RUNAWAY_RETRIES;
          const attemptDetectDeadlineMs = canRetryAgain ? DRAFT_RUNAWAY_DETECT_MS : null;
          // On the FINAL attempt (no early abort, non-thinking), cap max_tokens to
          // what the LIVE remaining wall can actually generate (F1, 2026-07-24;
          // the A2killer class). Previously max_tokens stayed the attempt-1
          // derivation (~affordable-for-effectiveTimeout), so a persistent
          // pre-edges runaway on a late final attempt needed ~82-91s to reach the
          // cap while < that remained → the overall AbortController fired first
          // (504-class, partial text discarded, salvage/lean-retry unreachable).
          // Capping to the live window makes the runaway truncate AT max_tokens
          // INSIDE the wall → closeTruncatedJson salvage / the lean retry apply.
          // Only ever LOWERS the attempt-1 value (Math.min), never raises past
          // affordability. Thinking keeps its clamped max_tokens (the API requires
          // max_tokens > budget_tokens, and detection is off under thinking so no
          // final-attempt squeeze applies).
          let attemptBody = body as Anthropic.MessageStreamParams;
          if (attemptDetectDeadlineMs === null && !draftThinkingEnabled && streamInvocations > 1) {
            const finalMaxTokens = Math.min(
              maxTokens,
              resolveDraftMaxTokens(Math.max(0, remainingBudgetMs), opts?.maxTokensCeiling).effective,
            );
            if (finalMaxTokens !== (body as { max_tokens?: number }).max_tokens) {
              attemptBody = { ...(body as Anthropic.MessageStreamParams), max_tokens: finalMaxTokens };
            }
          }
          return streamOneDraftAttempt(attemptBody, attemptIdempotencyKey, attemptDetectDeadlineMs);
        },
        { adapter: "anthropic", model, operation: "draft_graph" },
      );

      if (attemptResult.kind === "complete") {
        response = attemptResult.message;
        streamTimeToEdgesMs = attemptResult.timeToEdgesMs;
        break;
      }
      if (attemptResult.kind === "so_reject") {
        // Lane 3 (2026-07-07): the fallback must not be silent — emit a queryable
        // telemetry event alongside the WARN log so dashboards catch a
        // permanently-degraded draft path (every draft paying prompt-only
        // latency, e.g. the "compiled grammar is too large" grammar-capacity 400).
        log.warn(
          { model, error: (attemptResult.error as Error).message },
          "[Anthropic] Structured Outputs rejected by API — falling back to prompt-only JSON mode",
        );
        emit(TelemetryEvents.CeeStructuredOutputsFellBack, {
          operation: "draft_graph",
          model,
          error_snippet: ((attemptResult.error as Error).message ?? "unknown").slice(0, 200),
          schema_bytes: JSON.stringify(draftGraphSchema).length,
        });
        useStructuredOutputs = false;
        // Fresh key for the prompt-only rebuild: the body differs from the
        // rejected structured request, so it must not ride the same
        // Idempotency-Key (F8, 2026-07-24). The next attempt=1 iteration reads
        // this via `attemptIdempotencyKey`, so reassign before it re-enters.
        idempotencyKey = makeIdempotencyKey();
        ({ body } = buildCallParams(false));
        attempt--; // the prompt-only rebuild is not a runaway attempt
        continue;
      }
      // kind === "runaway": early-abort fired (only possible when the attempt's
      // detect deadline was non-null, i.e. canRetryAgain was true at invocation
      // time) → budget for a retry exists.
      runawayAbortCount++;
      log.warn({
        event: "cee.llm.draft_runaway_aborted",
        model,
        attempt,
        elapsed_ms: attemptResult.elapsedMs,
        partial_chars: attemptResult.chars,
        trigger: attemptResult.trigger,
        detect_ms: DRAFT_RUNAWAY_DETECT_MS,
        detect_chars: DRAFT_RUNAWAY_DETECT_CHARS,
        remaining_budget_ms: lastRemainingBudgetMs,
      }, "[Anthropic] draft_graph runaway detected EARLY (still in nodes, no edges emitted) — aborted the doomed attempt and retrying a fresh generation within the remaining budget (Lane C streamed abort-retry)");
    }

    clearTimeout(timeoutId);
    if (onExternalAbort && externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }

    const providerLatencyMs = Date.now() - startTime;

    // Log the actual mode used — differs from the pre-call debug log when a 400 fallback occurred.
    if (structuredOutputsEnabled && !useStructuredOutputs) {
      log.debug({ model, provider_latency_ms: providerLatencyMs },
        "[Anthropic] draft_graph completed in prompt-only mode after Structured Outputs fallback");
    }

    // When thinking is enabled (or on-by-default, e.g. Sonnet 5 adaptive),
    // Anthropic prepends thinking blocks before the text block.
    // Find the first text block rather than assuming index 0 (mirrors #385).
    const content = response.content.find(b => b.type === 'text');
    if (!content || content.type !== "text") {
      log.error({ content_types: response.content.map(b => b.type) }, "unexpected Anthropic response type");
      throw new Error(ERR_UNEXPECTED_RESPONSE_TYPE);
    }

    // Truncation detection (2026-07-20 outage payoff): with max_tokens derived
    // from the timeout, a runaway generation now RETURNS at the token cap
    // (stop_reason=max_tokens) inside the timeout, instead of hanging to the
    // cap and 504ing. Log it loudly either way; if the truncated text still
    // parses, the draft is accepted (truncated-but-parseable), otherwise the
    // failure below is typed as truncation rather than generic non-JSON.
    const stopReason = (response as { stop_reason?: string | null }).stop_reason ?? undefined;
    const truncatedAtMaxTokens = isDraftTruncated(stopReason);

    // LLM metadata for FAILED calls (probe aggravator 2, S-AUDIT-2026-07-20):
    // attached to every parse/validation throw below so Stage 1 (parse.ts)
    // captures it into ctx.llmMeta and `_diagnostic_trace.llm_calls` is
    // populated on failed drafts — previously only the schema-validation path
    // attached `_llm_meta`, so truncation/parse failures were invisible in the
    // response trace and diagnosis required Render log access. Same shape as
    // the existing schema-error `_llm_meta` (consumed by parse.ts:~426 and
    // `extractToolLLMTelemetry`).
    const failedCallLlmMeta = {
      model,
      prompt_version: promptMeta.prompt_version,
      prompt_hash: promptMeta.prompt_hash,
      temperature: draftTemperature,
      provider_latency_ms: providerLatencyMs,
      finish_reason: stopReason,
      token_usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
    if (truncatedAtMaxTokens) {
      // Runaway ANATOMY (v12, 2026-07-23): the corpus could never answer whether
      // a runaway is a COUNT explosion (many nodes/edges) or PER-ELEMENT prose
      // (few but huge) because failure bodies stored no partial text. These are
      // NON-SENSITIVE structural metrics computed from the truncated text (no
      // raw brief content on the wire or in the log) that finally distinguish
      // the two — the mechanism attribution the drafting design flagged as its
      // #1 open evidence limit. Counts are cheap regex tallies of the emitted-
      // so-far structure; largest_element_bytes flags a single-element runaway.
      const anatomy = measureTruncatedDraftAnatomy(content.text);
      log.error({
        event: "cee.llm.draft_truncated_max_tokens",
        model,
        max_tokens: maxTokens,
        output_tokens: response.usage.output_tokens,
        timeout_ms: effectiveTimeout,
        affordable_tokens: affordableDraftTokens,
        provider_latency_ms: providerLatencyMs,
        // ── runaway anatomy (structural metrics only, no brief content) ──
        output_text_length: content.text.length,
        approx_nodes_emitted: anatomy.approxNodes,
        approx_edges_emitted: anatomy.approxEdges,
        largest_element_bytes: anatomy.largestElementBytes,
        truncation_section: anatomy.section,
      }, "[Anthropic] draft_graph generation hit max_tokens — runaway generation truncated by the derived token budget instead of hanging to the timeout (2026-07-20 outage class)");
    }

    // Extract JSON from response.
    // When Structured Outputs was actually used (not fallen back from), the response is
    // guaranteed valid JSON matching our schema — go straight to JSON.parse.
    // When inactive or after a 400 fallback to prompt-only mode, use the robust extractor
    // that handles markdown fences and preamble.
    let rawJson: Record<string, unknown> | undefined;
    // 2026-07-23 firefight — set when a truncated draft was recovered by closing
    // the partial JSON (salvage) rather than thrown. Surfaced on the result meta.
    let salvagedFromTruncation = false;
    try {
      if (useStructuredOutputs) {
        try {
          rawJson = JSON.parse(content.text) as Record<string, unknown>;
        } catch (cause) {
          // Should not happen with Structured Outputs enabled, but guard defensively
          throw Object.assign(
            new UpstreamNonJsonError(
              `anthropic draft_graph structured-outputs returned invalid JSON`,
              "anthropic",
              "draft_graph",
              providerLatencyMs,
              content.text.slice(0, 500),
              undefined,
              undefined,
              idempotencyKey,
              cause,
            ),
            { _llm_meta: failedCallLlmMeta },
          );
        }
      } else {
        const extractionResult = safeExtractJson(content.text, {
          task: "draft_graph",
          model,
          correlationId: idempotencyKey,
          includeRawContent: args.includeDebug, // Preserve full raw text for debugging
        }, "draft_graph", providerLatencyMs, idempotencyKey);
        rawJson = extractionResult.json as Record<string, unknown>;
      }
    } catch (parseErr) {
      if (truncatedAtMaxTokens) {
        // SALVAGE FIRST (2026-07-23 firefight, prefer salvage over a doomed
        // sub-budget retry): the generation was cut at the derived token budget
        // and the tail is unparseable, but the PREFIX may be a complete graph
        // (a truncation AFTER `nodes`+`edges`). Close the truncated JSON around
        // its already-complete data and, if it parses, feed it to the SAME
        // normalisation + schema validation below. The schema is the gate — a
        // partial cut before `edges` (or otherwise incomplete) fails
        // `AnthropicDraftResponse.safeParse` and re-throws the typed truncation
        // error, so salvage can only ever ACCEPT a syntactically- AND
        // schema-valid graph; it never ships a malformed one.
        const repaired = closeTruncatedJson(content.text);
        if (repaired) {
          try {
            const salvaged = JSON.parse(repaired) as Record<string, unknown>;
            if (Array.isArray((salvaged as { nodes?: unknown }).nodes)) {
              rawJson = salvaged;
              salvagedFromTruncation = true;
              log.warn({
                event: "cee.llm.draft_truncation_salvaged",
                model,
                max_tokens: maxTokens,
                output_tokens: response.usage.output_tokens,
                salvaged_bytes: repaired.length,
                original_bytes: content.text.length,
              }, "[Anthropic] draft_graph truncated at max_tokens — recovered a complete graph prefix by closing the partial JSON (salvage); validating against the draft schema");
            }
          } catch {
            // Repaired string did not parse — fall through to the typed throw.
          }
        }
      }
      if (rawJson === undefined) {
        if (truncatedAtMaxTokens) {
          // Fail FAST and TYPED: the generation was cut at the derived token
          // budget and the remainder is unparseable (and unsalvageable).
          // Distinguishing this from generic non-JSON garbage makes the
          // runaway-generation case diagnosable at a glance (pre-fix, these
          // requests never returned at all — they hung to the timeout).
          throw Object.assign(
            new UpstreamNonJsonError(
              `anthropic draft_graph output truncated at max_tokens=${maxTokens} (stop_reason=max_tokens, ` +
              `output_tokens=${response.usage.output_tokens}) — runaway generation returned truncated JSON ` +
              `inside the ${effectiveTimeout}ms timeout instead of hanging to it`,
              "anthropic",
              "draft_graph",
              providerLatencyMs,
              content.text.slice(0, 500),
              undefined,
              undefined,
              idempotencyKey,
              parseErr,
            ),
            // Structured classification + failed-call metadata: the pipeline's
            // recovery-copy selection keys off the FLAG (message-prefix matching
            // breaks anchored regexes), and the meta feeds ctx.llmMeta →
            // _diagnostic_trace.llm_calls on the failure envelope.
            { _llm_meta: failedCallLlmMeta, truncated_at_max_tokens: true },
          );
        }
        // Non-truncated parse failure: still carry the failed call's metadata so
        // the diagnostic trace records the LLM call that produced the bad text.
        if (parseErr instanceof Error && !(parseErr as { _llm_meta?: unknown })._llm_meta) {
          Object.assign(parseErr, { _llm_meta: failedCallLlmMeta });
        }
        throw parseErr;
      }
    }
    // Salvage or normal parse produced a JSON object; a truncation that could
    // not be salvaged already threw above. Narrow the type for the rest.
    if (rawJson === undefined) {
      throw new Error("anthropic_draft_graph_no_parsed_json");
    }
    // Use full raw text for debug output (preserves preamble/suffix for forensics)
    const jsonText = content.text.trim();
    const rawNodeKinds = Array.isArray((rawJson as any)?.nodes)
      ? ((rawJson as any).nodes as any[])
        .map((n: any) => n?.kind ?? n?.type ?? 'unknown')
        .filter(Boolean)
      : [];
    const normalised = normaliseDraftResponse(rawJson);

    // Pipeline checkpoint: post_adapter_normalisation (after normaliseDraftResponse)
    const checkpointsEnabled = config.cee.pipelineCheckpointsEnabled;
    const adapterCheckpoints: PipelineCheckpoint[] = [];
    if (checkpointsEnabled) {
      adapterCheckpoints.push(
        captureCheckpoint('post_adapter_normalisation', normalised, {
          includeNestedStrengthDetection: true,
        }),
      );
    }

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

      // Truncation typing (2026-07-20 outage payoff): a generation cut at the
      // derived token budget can still yield text the robust extractor turns
      // into a partial object — which then fails HERE, at schema validation.
      // Name the truncation so the runaway-generation case stays diagnosable
      // on this path too, not just on the parse-failure path above.
      const truncationPrefix = truncatedAtMaxTokens
        ? `anthropic draft_graph output truncated at max_tokens=${maxTokens} (stop_reason=max_tokens, ` +
          `output_tokens=${response.usage.output_tokens}) — truncated JSON failed schema validation — `
        : '';

      // Attach LLM metadata to the error so Stage 1 parse.ts can capture it
      // even when the adapter throws. Without this, ctx.llmMeta is never set
      // and _diagnostic_trace.llm_calls remains empty on validation failures.
      const schemaError = Object.assign(
        new Error(`${truncationPrefix}anthropic_response_invalid_schema: ${details || 'unknown validation error'}`),
        {
          _llm_meta: {
            model,
            prompt_version: promptMeta.prompt_version,
            prompt_hash: promptMeta.prompt_hash,
            temperature: draftTemperature,
            provider_latency_ms: providerLatencyMs,
            finish_reason: (response as any)?.stop_reason ?? (response as any)?.stopReason,
            token_usage: {
              prompt_tokens: response.usage.input_tokens,
              completion_tokens: response.usage.output_tokens,
              total_tokens: response.usage.input_tokens + response.usage.output_tokens,
            },
          },
          // Structured truncation flag: `truncationPrefix` breaks the
          // pipeline's `^anthropic_response_invalid_schema` message anchor, so
          // without the flag a truncated-then-schema-invalid draft fell
          // through to an untyped 500 with no recovery copy. The pipeline
          // keys its typed 400 + truncation recovery off this flag.
          ...(truncatedAtMaxTokens ? { truncated_at_max_tokens: true } : {}),
        },
      );
      throw schemaError;
    }

    const parsed = parseResult.data;

    // CEE_FIELD_SURVIVAL_TRACE: field-presence snapshot at the LLM output boundary,
    // before any pipeline stage can strip or transform fields.
    if (config.cee.fieldSurvivalTrace) {
      const nodes = (parsed as any).nodes ?? [];
      const optionNodes = nodes.filter((n: any) => n?.kind === 'option');
      const factorNodes = nodes.filter((n: any) => n?.kind === 'factor');
      log.info({
        event: "cee.llm_output.field_presence",
        task: "draft_graph",
        structured_outputs_used: useStructuredOutputs,
        node_count: nodes.length,
        option_count: optionNodes.length,
        factor_count: factorNodes.length,
        fields: {
          // is_baseline: check both data.is_baseline (canonical read path) and node-level
          is_baseline_in_data: optionNodes.map((n: any) => {
            const v = n?.data?.is_baseline;
            return v === null ? 'null' : v === undefined ? 'missing' : v;
          }),
          is_baseline_node_level: optionNodes.map((n: any) => {
            const v = n?.is_baseline;
            return v === null ? 'null' : v === undefined ? 'missing' : v;
          }),
          // display_value: check data.display_value
          display_value_on_factors: factorNodes.map((n: any) => {
            const v = n?.data?.display_value;
            return v === null ? 'null' : v === undefined ? 'missing' : typeof v;
          }),
          // intercept: check node-level intercept
          intercept_on_nodes: nodes.map((n: any) => {
            const v = n?.intercept;
            return v === null ? 'null' : v === undefined ? 'missing' : typeof v;
          }),
          // encoding_map: check data.encoding_map
          encoding_map_on_factors: factorNodes.map((n: any) => {
            const v = n?.data?.encoding_map;
            return v === null ? 'null' : v === undefined ? 'missing' : typeof v;
          }),
          // goal_constraints
          goal_constraints_count: Array.isArray((parsed as any).goal_constraints)
            ? (parsed as any).goal_constraints.length
            : 'missing',
        },
      }, "[CEE_FIELD_SURVIVAL_TRACE] LLM output field presence at adapter boundary");
    }

    // v0.11.0 schema-amendment legacy normaliser. Production-callable.
    normaliseLegacyCoachingValues(
      parsed as { coaching?: unknown },
      (opts as { request_id?: string } | undefined)?.request_id,
    );

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

    // Assign stable edge IDs - spread preserves all fields (V4 + legacy + unknown)
    const edgesWithIds = assignStableEdgeIds(
      validEdges.map((e) => ({
        ...e,
        // Legacy fallbacks (for backwards compatibility)
        weight: e.weight ?? e.strength_mean,
        belief: e.belief ?? e.belief_exists,
      }))
    );

    // Build graph — spread preserves all fields (aligns with OpenAI adapter)
    const nodes: NodeT[] = parsed.nodes.map((n) => ({
      ...n,
      kind: n.kind as NodeT["kind"],
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
    // Full text preserved for debug bundle (no truncation — needed for prompt validation)
    const rawTextFull = jsonText;
    const rawPreview = jsonText.length > RAW_LLM_PREVIEW_MAX_CHARS
      ? jsonText.slice(0, RAW_LLM_PREVIEW_MAX_CHARS)
      : jsonText;

    const finishReason = (response as any)?.stop_reason || (response as any)?.stopReason;

    return {
      graph,
      rationales: parsed.rationales || [],
      // Coaching passthrough: preserved via .passthrough() on LLMDraftResponse.
      // The legacy ingress normaliser at line 884 has already converted any
      // v192b legacy shapes (array widening_log, off-enum bias_category) to
      // the canonical v0.11.0 shape by this point.
      ...((parsed as any).coaching ? { coaching: (parsed as any).coaching } : {}),
      // v0.11.0 schema amendment: causal_claims and topology_plan carried
      // through to Stage 1 Parse → StageContext → Stage 5 Package → Stage 6
      // V1 → V3 transform with deep-equality preservation.
      ...((parsed as any).causal_claims ? { causal_claims: (parsed as any).causal_claims } : {}),
      ...((parsed as any).topology_plan ? { topology_plan: (parsed as any).topology_plan } : {}),
      // Goal constraints passthrough: LLM-emitted constraints have richer metadata
      // (source_quote, confidence, provenance) than the regex extractor.
      ...((parsed as any).goal_constraints ? { goal_constraints: (parsed as any).goal_constraints } : {}),
      debug: unsafeCaptureEnabled ? {
        raw_llm_output: rawOutput.output,
        raw_llm_output_truncated: rawOutput.truncated,
      } : undefined,
      meta: {
        model,
        prompt_version: promptMeta.prompt_version,
        prompt_text_version: promptMeta.source === 'store' && promptMeta.version
          ? `v${promptMeta.version}`
          : 'fallback-v19',
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
        // 2026-07-23 firefight: true when this draft was recovered from a
        // max_tokens truncation by closing the partial JSON (salvage) rather
        // than re-drafted. Observable on the diagnostic trace.
        salvaged_from_truncation: salvagedFromTruncation,
        // Lane C (2026-07-23): the draft call is STREAMED, with early runaway
        // detection + cheap abort-retry. runaway_abort_count = how many doomed
        // attempts were aborted before this one succeeded (0 on a clean first
        // try); time_to_edges_ms validates DRAFT_RUNAWAY_DETECT_MS live (a
        // healthy draft reaches the edges array well under the deadline).
        streamed: true,
        runaway_abort_count: runawayAbortCount,
        time_to_edges_ms: streamTimeToEdgesMs,
        provider_latency_ms: providerLatencyMs,
        node_kinds_raw_json: rawNodeKinds,
        // Structured outputs telemetry — propagated through unified pipeline to diagnostic trace
        structured_outputs_used: useStructuredOutputs,
        // Pipeline checkpoint / provenance fields
        prompt_source: promptMeta.source,
        prompt_store_version: promptMeta.version ?? null,
        pipeline_checkpoints: checkpointsEnabled ? adapterCheckpoints : undefined,
        // Always include raw output for LLM observability trace (preview + full text for storage)
        raw_output_preview: rawPreview,
        raw_llm_text: rawTextFull,
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
    if (onExternalAbort && externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        const isExternalAbort = externalSignal?.aborted === true;
        const phase = isExternalAbort ? "pre_aborted" as const : "body" as const;
        log.error(
          { timeout_ms: effectiveTimeout, elapsed_ms: elapsedMs, fallback_reason: isExternalAbort ? "external_abort" : "anthropic_timeout", quality_tier: "failed", phase },
          isExternalAbort ? "Anthropic draft_graph aborted by external signal" : "Anthropic call timed out and was aborted"
        );
        throw new UpstreamTimeoutError(
          isExternalAbort ? "Anthropic draft_graph aborted by external signal" : "Anthropic draft_graph timed out",
          "anthropic",
          "draft_graph",
          phase,
          elapsedMs,
          error
        );
      }
      if (error.message.startsWith("anthropic_response_invalid_schema")) {
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
  const model = resolveAnthropicModel(args.model);
  const maxTokens = getMaxTokensFromConfig('suggest_options') ?? 2048;
  const suggestPromptMeta = getSystemPromptMeta('suggest_options');

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ model, idempotency_key: idempotencyKey, prompt_id: suggestPromptMeta.taskId, prompt_hash: suggestPromptMeta.prompt_hash, prompt_source: suggestPromptMeta.source }, "calling Anthropic for suggest_options");

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

    // When thinking is enabled (or on-by-default, e.g. Sonnet 5 adaptive),
    // Anthropic prepends thinking blocks before the text block.
    // Find the first text block rather than assuming index 0 (mirrors #385).
    const content = response.content.find(b => b.type === 'text');
    if (!content || content.type !== "text") {
      log.error({ content_types: response.content.map(b => b.type) }, "unexpected Anthropic response type");
      throw new Error(ERR_UNEXPECTED_RESPONSE_TYPE);
    }

    // Extract JSON from response using robust extractor
    const extractionResult = safeExtractJson(content.text, {
      task: "suggest_options",
      model,
      correlationId: idempotencyKey,
    }, "suggest_options", _elapsedMs, idempotencyKey);
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicOptionsResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten(), first_issues: extractZodIssues(parseResult.error, 3) }, "Anthropic options response failed schema validation");
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

// Maximum size for graph JSON in repair prompts (50KB)
const REPAIR_PROMPT_MAX_JSON_SIZE = 50 * 1024;

/**
 * Truncate graph to fit within repair prompt size limit.
 * Prioritizes keeping nodes over edges when truncating.
 */
function truncateGraphForRepairPrompt(graph: GraphT): { graph: GraphT; truncated: boolean; originalNodes: number; originalEdges: number } {
  const originalNodes = graph.nodes?.length ?? 0;
  const originalEdges = graph.edges?.length ?? 0;

  const jsonStr = JSON.stringify(graph, null, 2);
  if (jsonStr.length <= REPAIR_PROMPT_MAX_JSON_SIZE) {
    return { graph, truncated: false, originalNodes, originalEdges };
  }

  log.warn(
    { json_size: jsonStr.length, max_size: REPAIR_PROMPT_MAX_JSON_SIZE, node_count: originalNodes, edge_count: originalEdges },
    "Repair prompt graph too large - truncating"
  );

  // Calculate target sizes (keep 80% of limits to leave room for structure overhead)
  const targetNodes = Math.min(originalNodes, GRAPH_MAX_NODES);
  const targetEdges = Math.min(originalEdges, GRAPH_MAX_EDGES);

  // Iteratively reduce until under limit
  let truncatedGraph = { ...graph };
  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    const testStr = JSON.stringify(truncatedGraph, null, 2);
    if (testStr.length <= REPAIR_PROMPT_MAX_JSON_SIZE) {
      break;
    }

    // Reduce by 20% each iteration, prioritizing edge reduction
    const currentNodes = truncatedGraph.nodes?.length ?? 0;
    const currentEdges = truncatedGraph.edges?.length ?? 0;

    if (currentEdges > Math.ceil(targetEdges * 0.5)) {
      // Reduce edges first
      const newEdgeCount = Math.ceil(currentEdges * 0.8);
      truncatedGraph = {
        ...truncatedGraph,
        edges: truncatedGraph.edges?.slice(0, newEdgeCount),
      };
    } else if (currentNodes > Math.ceil(targetNodes * 0.5)) {
      // Then reduce nodes
      const newNodeCount = Math.ceil(currentNodes * 0.8);
      const keptNodeIds = new Set(truncatedGraph.nodes?.slice(0, newNodeCount).map(n => n.id) ?? []);
      truncatedGraph = {
        ...truncatedGraph,
        nodes: truncatedGraph.nodes?.slice(0, newNodeCount),
        edges: truncatedGraph.edges?.filter(e => keptNodeIds.has(e.from) && keptNodeIds.has(e.to)),
      };
    } else {
      // Already at minimum, break
      break;
    }
    iterations++;
  }

  emit(TelemetryEvents.RepairPromptTruncated ?? "llm.repair_prompt.truncated", {
    original_json_size: jsonStr.length,
    truncated_json_size: JSON.stringify(truncatedGraph, null, 2).length,
    original_nodes: originalNodes,
    truncated_nodes: truncatedGraph.nodes?.length ?? 0,
    original_edges: originalEdges,
    truncated_edges: truncatedGraph.edges?.length ?? 0,
  });

  return {
    graph: truncatedGraph as GraphT,
    truncated: true,
    originalNodes,
    originalEdges,
  };
}

async function buildRepairPrompt(args: RepairArgs): Promise<{ system: AnthropicSystemBlock[]; userContent: string }> {
  const { graph: truncatedGraph, truncated } = truncateGraphForRepairPrompt(args.graph);
  const truncatedNote = truncated ? "\n\n**Note: Graph was truncated for repair due to size.**" : "";

  const graphJson = JSON.stringify(
    {
      nodes: truncatedGraph.nodes,
      edges: truncatedGraph.edges,
    },
    null,
    2
  );

  const violationsText = args.violations.map((v, i) => `${i + 1}. ${v}`).join("\n");

  // Build context sections
  const briefText = (args as any).brief ?? "Not provided";
  const docsRaw = (args as any).docs;
  const docsText = docsRaw ? JSON.stringify(docsRaw.slice(0, 3)) : "None";
  const attempt = (args as any).attempt ?? 1;
  const maxAttempts = (args as any).maxAttempts ?? 1;
  const escalationText = attempt > 1 ? "\nPrevious attempt failed. Try a different approach.\n" : "";

  const currencyInstruction = (args as any).currencyInstruction ?? "";
  const userContent = `Brief:
[BEGIN_UNTRUSTED_USER_CONTENT]
${briefText}
[END_UNTRUSTED_USER_CONTENT]
Docs:
[BEGIN_UNTRUSTED_USER_CONTENT]
${docsText}
[END_UNTRUSTED_USER_CONTENT]
Attempt: ${attempt} of ${maxAttempts}
${escalationText}
## Violations Found
${violationsText}

## Current Graph (INVALID)${truncatedNote}
${graphJson}${currencyInstruction}`;

  // Load system prompt from prompt management system (with fallback to registered defaults)
  const systemPrompt = await getSystemPrompt('repair_graph');

  return {
    system: buildSystemBlocks(systemPrompt, { operation: "repair_graph" }),
    userContent,
  };
}

export async function repairGraphWithAnthropic(
  args: RepairArgs,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<RepairGraphResult> {
  const prompt = await buildRepairPrompt(args);
  const model = resolveAnthropicModel(args.model);
  const maxTokens = getMaxTokensFromConfig('repair_graph') ?? 4096;
  const repairPromptMeta = getSystemPromptMeta('repair_graph');

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ violation_count: args.violations.length, model, idempotency_key: idempotencyKey, prompt_id: repairPromptMeta.taskId, prompt_hash: repairPromptMeta.prompt_hash, prompt_source: repairPromptMeta.source }, "calling Anthropic for graph repair");

  const effectiveTimeout = opts?.timeoutMs || TIMEOUT_MS;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeout);

  // Wire external abort signal (e.g. client disconnect / budget cancellation)
  const externalSignal = opts?.signal;
  let onExternalAbort: (() => void) | undefined;
  if (externalSignal && !externalSignal.aborted) {
    onExternalAbort = () => abortController.abort();
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  } else if (externalSignal?.aborted) {
    abortController.abort();
  }

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
    if (onExternalAbort && externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    const _elapsedMs = Date.now() - startTime;

    // When thinking is enabled (or on-by-default, e.g. Sonnet 5 adaptive),
    // Anthropic prepends thinking blocks before the text block.
    // Find the first text block rather than assuming index 0 (mirrors #385).
    const content = response.content.find(b => b.type === 'text');
    if (!content || content.type !== "text") {
      log.error({ content_types: response.content.map(b => b.type), fallback_reason: "unexpected_response_type", quality_tier: "failed" }, "unexpected Anthropic repair response type");
      throw new Error(ERR_UNEXPECTED_RESPONSE_TYPE);
    }

    // Extract JSON from response using robust extractor
    const extractionResult = safeExtractJson(content.text, {
      task: "repair_graph",
      model,
      correlationId: idempotencyKey,
    }, "repair_graph", _elapsedMs, idempotencyKey);
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Normalise non-standard node kinds, ensure factor baselines, then validate with Zod.
    // Uses LLMRepairResponse (not LLMDraftResponse) — the repair prompt produces rationales
    // with {violation_code, node_or_edge, action, elements_changed}, not {target, why}.
    const normalised = normaliseDraftResponse(rawJson);
    const { response: withBaselines, defaultedFactors: repairDefaultedFactors } = ensureControllableFactorBaselines(normalised);
    if (repairDefaultedFactors.length > 0) {
      log.info({ defaultedFactors: repairDefaultedFactors }, `Defaulted baseline values for ${repairDefaultedFactors.length} controllable factor(s) in repair`);
    }
    const parseResult = AnthropicRepairResponse.safeParse(withBaselines);

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

    // Warn when repair rationales are missing — the repair prompt requests one
    // rationale per violation, so an empty array may indicate the LLM dropped
    // audit output. The graph is still usable, but repair quality is opaque.
    if (!parsed.rationales || parsed.rationales.length === 0) {
      log.warn({
        event: 'llm.repair.rationales_missing',
        adapter: 'anthropic',
        request_id: args.requestId,
      }, "Anthropic repair response contained no rationales — repair audit trail unavailable");
    }

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

    // Assign stable edge IDs - spread preserves all fields (V4 + legacy + unknown)
    const edgesWithIds = assignStableEdgeIds(
      validEdges.map((e) => ({
        ...e,
        // Legacy fallbacks (for backwards compatibility)
        weight: e.weight ?? e.strength_mean,
        belief: e.belief ?? e.belief_exists,
      }))
    );

    const graph: GraphT = sortGraph({
      version: args.graph.version || "1",
      default_seed: args.graph.default_seed || 17,
      nodes: parsed.nodes.map((n) => ({
        ...n,
        kind: n.kind as NodeT["kind"],
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
    if (onExternalAbort && externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        const isExternalAbort = externalSignal?.aborted === true;
        const phase = isExternalAbort ? "pre_aborted" as const : "body" as const;
        log.error(
          { timeout_ms: effectiveTimeout, elapsed_ms: elapsedMs, fallback_reason: isExternalAbort ? "external_abort" : "anthropic_repair_timeout", quality_tier: "failed", phase },
          isExternalAbort ? "Anthropic repair_graph aborted by external signal" : "Anthropic repair call timed out"
        );
        throw new UpstreamTimeoutError(
          isExternalAbort ? "Anthropic repair_graph aborted by external signal" : "Anthropic repair_graph timed out",
          "anthropic",
          "repair_graph",
          phase,
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

  const currencyInstruction = (args as any).currencyInstruction ?? "";
  const userContent = `## Brief
[BEGIN_UNTRUSTED_USER_CONTENT]
${args.brief}
[END_UNTRUSTED_USER_CONTENT]
${previousContext}${currencyInstruction}`;

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
  const model = resolveAnthropicModel(args.model);
  const maxTokens = getMaxTokensFromConfig('clarify_brief') ?? 2048;
  const clarifyPromptMeta = getSystemPromptMeta('clarify_brief');

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ brief_chars: args.brief.length, round: args.round, model, idempotency_key: idempotencyKey, prompt_id: clarifyPromptMeta.taskId, prompt_hash: clarifyPromptMeta.prompt_hash, prompt_source: clarifyPromptMeta.source }, "calling Anthropic for clarification");

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

    // When thinking is enabled (or on-by-default, e.g. Sonnet 5 adaptive),
    // Anthropic prepends thinking blocks before the text block.
    // Find the first text block rather than assuming index 0 (mirrors #385).
    const content = response.content.find(b => b.type === 'text');
    if (!content || content.type !== "text") {
      log.error({ content_types: response.content.map(b => b.type) }, "unexpected Anthropic response type");
      throw new Error(ERR_UNEXPECTED_RESPONSE_TYPE);
    }

    // Extract JSON from response using robust extractor
    const extractionResult = safeExtractJson(content.text, {
      task: "clarify_brief",
      model,
      correlationId: idempotencyKey,
    }, "clarify_brief", _elapsedMs, idempotencyKey);
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicClarifyResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten(), first_issues: extractZodIssues(parseResult.error, 3) }, "Anthropic clarify response failed schema validation");
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

  const briefContext = args.brief ? `\n\n## Original Brief\n[BEGIN_UNTRUSTED_USER_CONTENT]\n${args.brief}\n[END_UNTRUSTED_USER_CONTENT]` : "";
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
  const model = resolveAnthropicModel(args.model);
  const maxTokens = getMaxTokensFromConfig('critique_graph') ?? 2048;
  const critiquePromptMeta = getSystemPromptMeta('critique_graph');

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  log.info({ node_count: args.graph.nodes.length, edge_count: args.graph.edges.length, model, idempotency_key: idempotencyKey, prompt_id: critiquePromptMeta.taskId, prompt_hash: critiquePromptMeta.prompt_hash, prompt_source: critiquePromptMeta.source }, "calling Anthropic for critique");

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

    // When thinking is enabled (or on-by-default, e.g. Sonnet 5 adaptive),
    // Anthropic prepends thinking blocks before the text block.
    // Find the first text block rather than assuming index 0 (mirrors #385).
    const content = response.content.find(b => b.type === 'text');
    if (!content || content.type !== "text") {
      log.error({ content_types: response.content.map(b => b.type) }, "unexpected Anthropic response type");
      throw new Error(ERR_UNEXPECTED_RESPONSE_TYPE);
    }

    // Extract JSON from response using robust extractor
    const extractionResult = safeExtractJson(content.text, {
      task: "critique_graph",
      model,
      correlationId: idempotencyKey,
    }, "critique_graph", _elapsedMs, idempotencyKey);
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicCritiqueResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten(), first_issues: extractZodIssues(parseResult.error, 3) }, "Anthropic critique response failed schema validation");
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
  const model = resolveAnthropicModel(args.model);
  // No specific config key for explain_diff, use default
  const maxTokens = 2048;

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = makeIdempotencyKey();
  const startTime = Date.now();

  // Build prompt
  const prompt = `You are explaining why changes were made to a decision graph.

Given this patch:
${JSON.stringify(args.patch, null, 2)}

${args.brief ? `Context:\n[BEGIN_UNTRUSTED_USER_CONTENT]\n${args.brief}\n[END_UNTRUSTED_USER_CONTENT]` : ""}
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

    // When thinking is enabled (or on-by-default, e.g. Sonnet 5 adaptive),
    // Anthropic prepends thinking blocks before the text block.
    // Find the first text block rather than assuming index 0 (mirrors #385).
    const content = response.content.find(b => b.type === 'text');
    if (!content || content.type !== "text") {
      log.error({ content_types: response.content.map(b => b.type) }, "unexpected Anthropic response type");
      throw new Error(ERR_UNEXPECTED_RESPONSE_TYPE);
    }

    // Extract JSON from response using robust extractor
    const extractionResult = safeExtractJson(content.text, {
      task: "explain_diff",
      model,
      correlationId: idempotencyKey,
    }, "explain_diff", _elapsedMs, idempotencyKey);
    const rawJson = extractionResult.json as Record<string, unknown>;

    // Validate with Zod
    const parseResult = AnthropicExplainDiffResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten(), first_issues: extractZodIssues(parseResult.error, 3) }, "Anthropic explain-diff response failed schema validation");
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

// ============================================================================
// Generic Chat Completion
// ============================================================================

interface ChatWithAnthropicArgs {
  system: string;
  userMessage: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  timeoutMs?: number;
  /**
   * External abort signal (client disconnect / caller-side cancellation /
   * sibling-cancel in fan-out callers). Wired into the internal timeout
   * controller exactly like the draft_graph path: an external abort cancels
   * the in-flight HTTP request — it does not merely abandon the promise.
   */
  signal?: AbortSignal;
  /** Extended thinking configuration. When enabled, temperature is forced to 1. */
  thinking?: ThinkingConfig;
  /**
   * JSON Schema for Anthropic Structured Outputs (output_config.format).
   * When provided and the model supports it, guarantees the response matches this schema.
   * Incompatible with extended thinking — automatically skipped when thinking is enabled.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Appended to `userMessage` only when structured outputs actually engage
   * for this call (schema present + model allowlisted + thinking off).
   * See `ChatArgs.structuredOutputsUserReminder`.
   */
  structuredOutputsUserReminder?: string;
  /**
   * Per-call EXTENSION of the structured-outputs model allowlist — models the
   * caller has verified as structured-outputs-capable, consulted for THIS
   * call only. See `ChatArgs.structuredOutputsAdditionalModels` for why this
   * exists (shared-set membership also keys strict tool calling with no env
   * gate). Still subject to CEE_ANTHROPIC_STRUCTURED_OUTPUTS and the
   * thinking-disabled requirement.
   */
  structuredOutputsAdditionalModels?: readonly string[];
}

/**
 * Generic chat completion with Anthropic.
 * Used for non-graph-specific LLM calls (e.g., Decision Review, edit_graph).
 * Uses the same infrastructure as other adapter methods: retry, timeout, telemetry.
 * Supports Structured Outputs via optional outputSchema parameter.
 */
export async function chatWithAnthropic(
  args: ChatWithAnthropicArgs
): Promise<ChatResult> {
  const model = resolveAnthropicModel(args.model);
  const thinkingRequested = args.thinking?.type === 'enabled';
  const thinkingEnabled = thinkingRequested && isThinkingSupported(model, 'chat');
  // When thinking budget is set, auto-raise max_tokens to budget + 1024 minimum
  const thinkingBudget = thinkingEnabled ? (args.thinking as { type: 'enabled'; budget_tokens: number }).budget_tokens : 0;
  const maxTokens = Math.max(args.maxTokens ?? 4096, thinkingEnabled ? thinkingBudget + 1024 : 0);
  // Anthropic requires temperature=1 when extended thinking is active.
  // Sonnet 5 / Opus 4.7+ / Fable 5 REJECT any explicit sampling param with a 400 —
  // omit temperature entirely for them (undefined is dropped from the request).
  const temperature = rejectsSamplingParams(model)
    ? undefined
    : (thinkingEnabled ? 1 : (args.temperature ?? 0));
  const timeoutMs = args.timeoutMs ?? TIMEOUT_MS;

  // Structured-outputs model capability = the shared allowlist OR the
  // caller's per-call extension (structuredOutputsAdditionalModels). The
  // per-call route exists so a single call site (V6 dual-draft M2 review)
  // can use structured outputs on a model deliberately kept out of the
  // shared set — shared membership also keys strict tool calling for every
  // live turn (no env gate) and the edit_graph/draft fallback behaviour.
  const structuredOutputsModelSupported =
    STRUCTURED_OUTPUTS_SUPPORTED_MODELS.has(model) ||
    (args.structuredOutputsAdditionalModels?.includes(model) ?? false);

  // Structured Outputs — only active when schema provided, model supported, thinking disabled.
  // Mutable: set to false in the fallback path to prevent redundant attempts on retry.
  let useStructuredOutputs =
    !thinkingEnabled &&
    !!args.outputSchema &&
    config.cee.anthropicStructuredOutputs &&
    structuredOutputsModelSupported;

  if (args.outputSchema && thinkingEnabled) {
    log.info(
      { model },
      "[Anthropic] Extended thinking enabled — structured outputs disabled (incompatible)"
    );
  }
  if (args.outputSchema && !structuredOutputsModelSupported) {
    log.warn(
      { model },
      "[Anthropic] outputSchema provided but model not in structured outputs allowlist — falling back to prompt-only JSON"
    );
  }

  // V04: Generate idempotency key for request traceability
  const idempotencyKey = args.requestId || makeIdempotencyKey();
  const startTime = Date.now();

  log.info(
    {
      model,
      max_tokens: maxTokens,
      temperature,
      structured_outputs: useStructuredOutputs,
      system_chars: args.system.length,
      user_chars: args.userMessage.length,
      idempotency_key: idempotencyKey,
    },
    "calling Anthropic for chat completion"
  );

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  // Wire the external abort signal (client disconnect / caller cancellation)
  // into the internal controller — mirrors the draft_graph path above.
  const externalSignal = args.signal;
  let onExternalAbort: (() => void) | undefined;
  if (externalSignal?.aborted) {
    abortController.abort();
  } else if (externalSignal) {
    onExternalAbort = () => abortController.abort();
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const apiClient = getClient();

    // Schema is compliant by construction — no runtime normalisation needed.
    const normalisedOutputSchema = args.outputSchema;

    function buildChatCallParams(withStructuredOutputs: boolean): {
      body: Anthropic.MessageCreateParamsNonStreaming;
      options: { signal: AbortSignal; headers: Record<string, string> };
    } {
      const body: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: maxTokens,
        temperature,
        system: args.system,
        messages: [{
          role: "user",
          content: withStructuredOutputs && args.structuredOutputsUserReminder
            ? args.userMessage + args.structuredOutputsUserReminder
            : args.userMessage,
        }],
        ...(withStructuredOutputs && normalisedOutputSchema
          ? {
              output_config: {
                format: {
                  type: "json_schema",
                  schema: normalisedOutputSchema,
                },
              },
            }
          : {}),
        // {type:'disabled'} must be transmitted, not dropped: models with
        // ADAPTIVE thinking on by default (Sonnet 5) think unless the request
        // explicitly disables it, and adaptive thinking is incompatible with
        // tight caller budgets (the V6 dual-draft M2 review measured ~60s
        // with adaptive thinking vs its 25s timeout). Live-probed 2026-07-14:
        // the API accepts thinking:{type:'disabled'} alongside output_config.
        ...(thinkingEnabled
          ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } }
          : args.thinking?.type === 'disabled'
            ? { thinking: { type: 'disabled' } }
            : {}),
      };
      const headers: Record<string, string> = {
        "Idempotency-Key": idempotencyKey,
      };
      return { body, options: { signal: abortController.signal, headers } };
    }

    let { body: createBody, options: createOptions } = buildChatCallParams(useStructuredOutputs);

    const response = await withRetry(
      async () => {
        try {
          return await apiClient.messages.create(createBody, createOptions);
        } catch (callErr) {
          // If structured outputs rejected by API (capability issue), fall back to prompt-only JSON
          if (useStructuredOutputs && isStructuredOutputsRejection(callErr)) {
            log.warn(
              { model, error: (callErr as Error).message },
              "[Anthropic] Structured Outputs rejected by API — falling back to prompt-only JSON mode"
            );
            // Lane 3 (2026-07-07): non-silent fallback — same event as the
            // draft_graph path, distinguished by `operation`.
            emit(TelemetryEvents.CeeStructuredOutputsFellBack, {
              operation: "chat",
              model,
              error_snippet: ((callErr as Error).message ?? "unknown").slice(0, 200),
              schema_bytes: normalisedOutputSchema
                ? JSON.stringify(normalisedOutputSchema).length
                : 0,
            });
            useStructuredOutputs = false;
            const fallback = buildChatCallParams(false);
            createBody = fallback.body;
            createOptions = fallback.options;
            return await apiClient.messages.create(createBody, createOptions);
          }
          throw callErr;
        }
      },
      {
        adapter: "anthropic",
        model,
        operation: "chat",
      }
    );

    clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    const latencyMs = Date.now() - startTime;

    // When thinking is enabled, Anthropic prepends thinking blocks before the text block.
    // Find the first text block rather than assuming index 0.
    const content = response.content.find(b => b.type === 'text');
    if (!content || content.type !== "text") {
      log.error({ content_types: response.content.map(b => b.type) }, "unexpected Anthropic response type");
      throw new Error(ERR_UNEXPECTED_RESPONSE_TYPE);
    }

    log.info(
      {
        provider: 'anthropic',
        model,
        latency_ms: latencyMs,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        content_chars: content.text.length,
      },
      "Anthropic chat completion successful"
    );

    return {
      content: content.text,
      model,
      latencyMs,
      // R7: surface the raw provider stop reason for per-turn observability.
      stopReason: (response as { stop_reason?: string | null })?.stop_reason ?? null,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      // V04: Throw typed UpstreamTimeoutError for timeout classification
      if (error.name === "AbortError" || abortController.signal.aborted) {
        // Distinguish a caller-initiated abort from a genuine timeout so
        // operators don't read client disconnects as upstream slowness.
        const isExternalAbort = externalSignal?.aborted === true;
        // M2 (Codex r2 pre-merge review): a client/external abort must carry
        // the repo-canonical `pre_aborted` phase — the SAME discriminator the
        // downstream classifiers key on (m2-review.ts, parse.ts) and that every
        // other adapter abort site already uses. Tagging it `body` made a
        // client disconnect indistinguishable from a genuine upstream timeout.
        // A real timeout keeps `body`.
        const phase = isExternalAbort ? "pre_aborted" as const : "body" as const;
        log.error(
          { timeout_ms: timeoutMs, elapsed_ms: elapsedMs, external_abort: isExternalAbort, phase },
          isExternalAbort ? "Anthropic chat call aborted by external signal" : "Anthropic chat call timed out"
        );
        throw new UpstreamTimeoutError(
          isExternalAbort ? "Anthropic chat aborted by external signal" : "Anthropic chat timed out",
          "anthropic",
          "chat",
          phase,
          elapsedMs,
          error
        );
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
          `Anthropic chat failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error({ error }, "Anthropic chat call failed");
    throw error;
  }
}

// ============================================================================
// Native Tool Calling
// ============================================================================

interface ChatWithToolsAnthropicArgs {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string | Array<ToolResponseBlock | ReplayThinkingBlock> }>;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  model?: string;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  timeoutMs?: number;
  /** Pre-split system blocks for prompt caching. When provided, replaces plain system string. */
  system_cache_blocks?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  /** Extended thinking configuration. When enabled, temperature is forced to 1. */
  thinking?: ThinkingConfig;
}

/**
 * Normalize tool definitions for the Anthropic API, optionally with strict mode.
 * Shared between streaming and non-streaming tool-calling paths to prevent drift.
 *
 * When the model supports constrained decoding (STRUCTURED_OUTPUTS_SUPPORTED_MODELS),
 * adds strict: true + additionalProperties: false for decoder-constrained arguments.
 * For older models, passes tools without strict mode to avoid hard 400 failures.
 */
function buildStrictAnthropicTools(
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  model: string,
) {
  const supportsStrict = STRUCTURED_OUTPUTS_SUPPORTED_MODELS.has(model);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    ...(supportsStrict ? { strict: true as const } : {}),
    input_schema: {
      ...tool.input_schema,
      ...(supportsStrict ? { additionalProperties: false } : {}),
    } as unknown as Anthropic.Tool.InputSchema,
  }));
}

/**
 * Native tool calling with Anthropic.
 * Uses Anthropic's native tool_use content blocks for multi-turn orchestration.
 * Follows the same infrastructure as chatWithAnthropic: retry, timeout, telemetry.
 */
export async function chatWithToolsAnthropic(
  args: ChatWithToolsAnthropicArgs
): Promise<ChatWithToolsResult> {
  const model = resolveAnthropicModel(args.model);
  const thinkingRequested = args.thinking?.type === 'enabled';
  const thinkingEnabled = thinkingRequested && isThinkingSupported(model, 'chat_with_tools');
  // When thinking budget is set, auto-raise max_tokens to budget + 1024 minimum
  const thinkingBudget = thinkingEnabled ? (args.thinking as { type: 'enabled'; budget_tokens: number }).budget_tokens : 0;
  const maxTokens = Math.max(args.maxTokens ?? 4096, thinkingEnabled ? thinkingBudget + 1024 : 0);
  // Anthropic requires temperature=1 when extended thinking is active.
  // Sonnet 5 / Opus 4.7+ / Fable 5 REJECT any explicit sampling param with a 400 —
  // omit temperature entirely for them (undefined is dropped from the request).
  const temperature = rejectsSamplingParams(model)
    ? undefined
    : (thinkingEnabled ? 1 : (args.temperature ?? 0));
  const timeoutMs = args.timeoutMs ?? TIMEOUT_MS;

  const idempotencyKey = args.requestId || makeIdempotencyKey();
  const startTime = Date.now();

  log.info(
    {
      model,
      max_tokens: maxTokens,
      temperature,
      // 'disabled' distinguishes an EXPLICIT suppression (adaptive thinking off,
      // e.g. CEE_COACH_THINKING_DISABLED) from 'none' (no thinking field →
      // adaptive thinking on by default on Sonnet 5). Byte-identical when no
      // caller passes {type:'disabled'} (today's default) — still 'none'.
      thinking: thinkingEnabled
        ? 'enabled'
        : args.thinking?.type === 'disabled'
          ? 'disabled'
          : 'none',
      system_chars: args.system_cache_blocks
        ? args.system_cache_blocks.reduce((sum: number, b: { text: string }) => sum + b.text.length, 0)
        : args.system.length,
      system_source: args.system_cache_blocks ? 'cache_blocks' : 'plain',
      message_count: args.messages.length,
      tool_count: args.tools.length,
      tool_names: args.tools.map(t => t.name),
      idempotency_key: idempotencyKey,
    },
    "calling Anthropic for chat with tools"
  );

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const apiClient = getClient();

    // Convert messages to Anthropic SDK format
    const anthropicMessages: Anthropic.MessageParam[] = args.messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }
      // Array of content blocks — map to Anthropic SDK types
      const blocks: Anthropic.ContentBlockParam[] = msg.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
        }
        return block as Anthropic.ContentBlockParam;
      });
      return { role: msg.role, content: blocks };
    });

    const anthropicTools = buildStrictAnthropicTools(args.tools, model);

    // Build tool_choice parameter
    let toolChoice: Anthropic.MessageCreateParams['tool_choice'] | undefined;
    if (args.tool_choice) {
      if (args.tool_choice.type === 'tool' && args.tool_choice.name) {
        toolChoice = { type: 'tool', name: args.tool_choice.name };
      } else if (args.tool_choice.type === 'any') {
        toolChoice = { type: 'any' };
      } else {
        toolChoice = { type: 'auto' };
      }
    }

    // Use pre-split system cache blocks when provided (orchestrator path),
    // otherwise fall back to plain system string wrapped in buildSystemBlocks.
    const systemParam: Anthropic.MessageCreateParams['system'] = args.system_cache_blocks
      ? args.system_cache_blocks.map((block) => ({
          type: 'text' as const,
          text: block.text,
          ...(block.cache_control ? { cache_control: block.cache_control } : {}),
        }))
      : args.system;

    const createParams: Anthropic.MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemParam,
      messages: anthropicMessages,
      tools: anthropicTools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      // {type:'disabled'} must be TRANSMITTED, not dropped: models with adaptive
      // thinking on by default (Sonnet 5) think unless the request explicitly
      // disables it, and the tool-use routing turn omits `thinking` on the
      // common path (so adaptive fires). An explicit disable is the only way to
      // suppress it — mirrors chatWithAnthropic's handling. No production caller
      // passes {type:'disabled'} here today except the coach turn under
      // CEE_COACH_THINKING_DISABLED, so this is byte-identical when that flag is
      // off. Live-probed 2026-07-14: the API accepts thinking:{type:'disabled'}.
      ...(thinkingEnabled
        ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } }
        : args.thinking?.type === 'disabled'
          ? { thinking: { type: 'disabled' } }
          : {}),
    };

    const response = await withRetry(
      async () =>
        apiClient.messages.create(createParams, {
          signal: abortController.signal,
          headers: { "Idempotency-Key": idempotencyKey },
        }),
      {
        adapter: "anthropic",
        model,
        operation: "chat_with_tools",
      }
    );

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    // Map Anthropic content blocks to our ToolResponseBlock type.
    // Only `text` and `tool_use` blocks may reach the caller (and thus
    // user-facing assistant_text). Any other block type — notably Sonnet 5's
    // extended-thinking `thinking` / `redacted_thinking` blocks, which the model
    // returns on a routing tool call even when we do not request thinking — is
    // DROPPED, never serialised. Serialising a thinking block leaked its opaque
    // signature JSON as a prefix onto assistant_text on every Run-analysis click
    // (see acceptance-evidence/sonnet5-flip). This mirrors the streaming path,
    // which already excludes thinking blocks from the client-visible content.
    const content: ToolResponseBlock[] = [];
    // ROADMAP 1.42 — when CEE_REASONING_CAPTURE_ENABLED is on, VERBATIM
    // `thinking` block text is captured OUT-OF-BAND into reasoningParts
    // (never into `content`, see ChatWithToolsResult.reasoning jsdoc for why).
    // `block.signature` is NEVER captured into `reasoning` — it is
    // Anthropic's opaque replay token, not reasoning content, and must never
    // reach a client. `redacted_thinking` `data` is likewise never captured
    // into `reasoning` — it is encrypted/opaque and carries no readable
    // reasoning.
    const reasoningParts: string[] = [];
    // ROADMAP 1.55(b) — thinking / redacted_thinking blocks are ALSO captured
    // VERBATIM (signature/data intact) into replay_thinking_blocks,
    // unconditionally, for API-BOUND REPLAY ONLY: Anthropic's tool-use
    // protocol requires the complete unmodified thinking block(s) on the
    // assistant echo when tool_results are returned (400 otherwise), so the
    // REPAIR_ONCE path needs them. This does NOT loosen the user-facing
    // filter: they never enter `content` and must never be serialised to any
    // client-facing surface (see ReplayThinkingBlock jsdoc).
    const replayThinkingBlocks: ReplayThinkingBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        content.push({ type: 'text' as const, text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      } else if (block.type === 'thinking') {
        replayThinkingBlocks.push({
          type: 'thinking' as const,
          thinking: block.thinking,
          signature: block.signature,
        });
        if (config.features.reasoningCaptureEnabled) {
          reasoningParts.push(block.thinking);
        }
      } else if (block.type === 'redacted_thinking') {
        replayThinkingBlocks.push({
          type: 'redacted_thinking' as const,
          data: block.data,
        });
      } else {
        // Any other block type — drop it; it must never surface to the user.
        log.warn(
          { block_type: (block as any).type },
          "dropping non-text content block from tool response (not surfaced to client)",
        );
      }
    }
    const reasoning = reasoningParts.length > 0 ? reasoningParts.join('\n\n') : undefined;
    if (reasoning !== undefined) {
      log.info(
        { reasoning_chars: reasoning.length },
        "captured extended-thinking reasoning (ROADMAP 1.42, flag-gated)",
      );
    }

    // Map stop_reason
    const stopReason = response.stop_reason as 'end_turn' | 'tool_use' | 'max_tokens';

    // Cache metrics (graceful — absent when no cache blocks or non-caching API version)
    const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
    const hasCacheMetrics = cacheCreationTokens > 0 || cacheReadTokens > 0;

    log.info(
      {
        provider: 'anthropic',
        model,
        latency_ms: latencyMs,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        content_blocks: content.length,
        tool_use_blocks: content.filter(b => b.type === 'tool_use').length,
        stop_reason: stopReason,
        ...(hasCacheMetrics ? {
          cache_creation_input_tokens: cacheCreationTokens,
          cache_read_input_tokens: cacheReadTokens,
          cache_hit: cacheReadTokens > 0,
        } : {}),
        has_cache_blocks: !!args.system_cache_blocks,
      },
      "Anthropic chat with tools successful"
    );

    return {
      content,
      stop_reason: stopReason,
      model,
      latencyMs,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      },
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(replayThinkingBlocks.length > 0 ? { replay_thinking_blocks: replayThinkingBlocks } : {}),
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error({ timeout_ms: timeoutMs, elapsed_ms: elapsedMs }, "Anthropic chat_with_tools call timed out");
        throw new UpstreamTimeoutError(
          "Anthropic chat_with_tools timed out",
          "anthropic",
          "chat_with_tools",
          "body",
          elapsedMs,
          error
        );
      }

      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs },
          "Anthropic API returned non-2xx status"
        );
        throw new UpstreamHTTPError(
          `Anthropic chat_with_tools failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error
        );
      }
    }

    log.error({ error }, "Anthropic chat_with_tools call failed");
    throw error;
  }
}

// ============================================================================
// Streaming Tool Calling
// ============================================================================

/**
 * Streaming chat with tools via Anthropic SDK.
 * Yields text_delta events immediately, accumulates tool input JSON,
 * and yields message_complete with the full ChatWithToolsResult on stream end.
 */
export async function* streamChatWithToolsAnthropic(
  args: ChatWithToolsAnthropicArgs & { signal?: AbortSignal },
): AsyncGenerator<ChatWithToolsStreamEvent> {
  const model = resolveAnthropicModel(args.model);
  const thinkingRequested = args.thinking?.type === 'enabled';
  const thinkingEnabled = thinkingRequested && isThinkingSupported(model, 'stream_chat_with_tools');
  const thinkingBudget = thinkingEnabled ? (args.thinking as { type: 'enabled'; budget_tokens: number }).budget_tokens : 0;
  const maxTokens = Math.max(args.maxTokens ?? 4096, thinkingEnabled ? thinkingBudget + 1024 : 0);
  // Anthropic requires temperature=1 when extended thinking is active.
  // Sonnet 5 / Opus 4.7+ / Fable 5 REJECT any explicit sampling param with a 400 —
  // omit temperature entirely for them (undefined is dropped from the request).
  const temperature = rejectsSamplingParams(model)
    ? undefined
    : (thinkingEnabled ? 1 : (args.temperature ?? 0));
  const timeoutMs = args.timeoutMs ?? TIMEOUT_MS;

  const startTime = Date.now();

  log.info(
    {
      model,
      max_tokens: maxTokens,
      temperature,
      thinking: thinkingEnabled ? 'enabled' : 'none',
      system_chars: args.system_cache_blocks
        ? args.system_cache_blocks.reduce((sum: number, b: { text: string }) => sum + b.text.length, 0)
        : args.system.length,
      system_source: args.system_cache_blocks ? 'cache_blocks' : 'plain',
      message_count: args.messages.length,
      tool_count: args.tools.length,
      tool_names: args.tools.map(t => t.name),
      streaming: true,
    },
    "calling Anthropic for streaming chat with tools",
  );

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  // Link external signal
  if (args.signal) {
    if (args.signal.aborted) {
      clearTimeout(timeoutId);
      return;
    }
    args.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  try {
    const apiClient = getClient();

    // Convert messages — same logic as chatWithToolsAnthropic
    const anthropicMessages: Anthropic.MessageParam[] = args.messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }
      const blocks: Anthropic.ContentBlockParam[] = msg.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
        }
        return block as Anthropic.ContentBlockParam;
      });
      return { role: msg.role, content: blocks };
    });

    const anthropicTools = buildStrictAnthropicTools(args.tools, model);

    let toolChoice: Anthropic.MessageCreateParams['tool_choice'] | undefined;
    if (args.tool_choice) {
      if (args.tool_choice.type === 'tool' && args.tool_choice.name) {
        toolChoice = { type: 'tool', name: args.tool_choice.name };
      } else if (args.tool_choice.type === 'any') {
        toolChoice = { type: 'any' };
      } else {
        toolChoice = { type: 'auto' };
      }
    }

    // Use pre-split system cache blocks when provided (orchestrator path)
    const streamSystemParam: Anthropic.MessageCreateParams['system'] = args.system_cache_blocks
      ? args.system_cache_blocks.map((block) => ({
          type: 'text' as const,
          text: block.text,
          ...(block.cache_control ? { cache_control: block.cache_control } : {}),
        }))
      : args.system;

    const stream = apiClient.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      system: streamSystemParam,
      messages: anthropicMessages,
      tools: anthropicTools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(thinkingEnabled ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } : {}),
    }, {
      signal: abortController.signal,
    });

    // Track tool input accumulation per content block index (array-based to avoid O(n²) concat)
    const toolInputBuffers = new Map<number, { id: string; name: string; chunks: string[] }>();
    // Track thinking block indices so we can suppress their deltas
    const thinkingBlockIndices = new Set<number>();
    const contentBlocks: ToolResponseBlock[] = [];

    for await (const event of stream) {
      if (abortController.signal.aborted) return;

      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'thinking') {
          // Extended thinking block — track index to suppress deltas, never stream to client
          thinkingBlockIndices.add(event.index);
        } else if (block.type === 'tool_use') {
          toolInputBuffers.set(event.index, { id: block.id, name: block.name, chunks: [] });
          yield { type: 'tool_input_start', tool_id: block.id, tool_name: block.name };
        }
      } else if (event.type === 'content_block_delta') {
        // Skip deltas from thinking blocks — never stream thinking tokens to client
        if (thinkingBlockIndices.has(event.index)) continue;

        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', delta: delta.text };
        } else if (delta.type === 'input_json_delta') {
          const buf = toolInputBuffers.get(event.index);
          if (buf) {
            buf.chunks.push(delta.partial_json);
          }
        }
      } else if (event.type === 'content_block_stop') {
        // Clean up thinking block tracking
        if (thinkingBlockIndices.has(event.index)) {
          thinkingBlockIndices.delete(event.index);
          continue;
        }
        const buf = toolInputBuffers.get(event.index);
        if (buf) {
          let input: Record<string, unknown> = {};
          const json = buf.chunks.join('');

          // Check if this tool expects no input (properties: {} with no required fields).
          // Tools like what_would_flip and compare_options have empty input schemas —
          // an empty string or '{}' from the LLM is correct, not a parse failure.
          const toolDef = args.tools.find((t) => t.name === buf.name);
          const schemaProps = toolDef?.input_schema?.properties as Record<string, unknown> | undefined;
          const isNoInputTool = schemaProps != null && Object.keys(schemaProps).length === 0;

          if (json.length === 0 && isNoInputTool) {
            // Expected: no-input tool produced no JSON — use empty object
            input = {};
          } else if (json.length > 0) {
            try {
              input = JSON.parse(json);
            } catch {
              // Include head + tail of raw payload and per-chunk lengths
              // so parse failures can be traced to assembly vs model output.
              const chunkLengths = buf.chunks.map((c) => c.length);
              log.warn({
                tool_id: buf.id,
                tool_name: buf.name,
                raw_length: json.length,
                raw_head: json.substring(0, 200),
                raw_tail: json.length > 200 ? json.substring(json.length - 100) : undefined,
                chunk_count: buf.chunks.length,
                chunk_lengths: chunkLengths.length <= 20 ? chunkLengths : chunkLengths.slice(0, 10).concat([-1], chunkLengths.slice(-5)),
                is_no_input_tool: isNoInputTool,
              }, "failed to parse streamed tool input JSON");
              log.info({
                event: 'v4.streamed_tool_json_parse_failed',
                tool_name: buf.name,
                raw_length: json.length,
                first_200_chars: json.substring(0, 200),
                chunk_count: buf.chunks.length,
              }, 'v4.streamed_tool_json_parse_failed');
            }
          } else {
            // Empty string for a tool that expects input — log diagnostic
            log.warn({
              tool_id: buf.id,
              tool_name: buf.name,
              chunk_count: buf.chunks.length,
            }, "streamed tool input is empty for tool that expects parameters");
          }
          contentBlocks.push({ type: 'tool_use', id: buf.id, name: buf.name, input });
          yield { type: 'tool_input_complete', tool_id: buf.id, tool_name: buf.name, input };
          toolInputBuffers.delete(event.index);
        }
      }
    }

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    // Get the final message for usage and stop_reason
    const finalMessage = await stream.finalMessage();

    // Assemble text blocks from the final message — filter out thinking blocks
    for (const block of finalMessage.content) {
      if (block.type === 'text') {
        contentBlocks.unshift({ type: 'text' as const, text: block.text });
      }
      // 'thinking' blocks are intentionally excluded — not sent to client
    }

    // Sort: text blocks first, then tool_use blocks (matching non-streaming order)
    const textBlocks = contentBlocks.filter(b => b.type === 'text');
    const toolBlocks = contentBlocks.filter(b => b.type === 'tool_use');
    const orderedContent = [...textBlocks, ...toolBlocks];

    const stopReason = finalMessage.stop_reason as 'end_turn' | 'tool_use' | 'max_tokens';

    // Cache metrics (graceful — absent when no cache blocks or non-caching API version)
    const streamCacheCreationTokens = finalMessage.usage.cache_creation_input_tokens ?? 0;
    const streamCacheReadTokens = finalMessage.usage.cache_read_input_tokens ?? 0;
    const streamHasCacheMetrics = streamCacheCreationTokens > 0 || streamCacheReadTokens > 0;

    log.info(
      {
        provider: 'anthropic',
        model,
        latency_ms: latencyMs,
        input_tokens: finalMessage.usage.input_tokens,
        output_tokens: finalMessage.usage.output_tokens,
        content_blocks: orderedContent.length,
        tool_use_blocks: toolBlocks.length,
        stop_reason: stopReason,
        streaming: true,
        ...(streamHasCacheMetrics ? {
          cache_creation_input_tokens: streamCacheCreationTokens,
          cache_read_input_tokens: streamCacheReadTokens,
          cache_hit: streamCacheReadTokens > 0,
        } : {}),
        has_cache_blocks: !!args.system_cache_blocks,
      },
      "Anthropic streaming chat with tools successful",
    );

    yield {
      type: 'message_complete',
      result: {
        content: orderedContent,
        stop_reason: stopReason,
        model,
        latencyMs,
        usage: {
          input_tokens: finalMessage.usage.input_tokens,
          output_tokens: finalMessage.usage.output_tokens,
          cache_creation_input_tokens: finalMessage.usage.cache_creation_input_tokens ?? undefined,
          cache_read_input_tokens: finalMessage.usage.cache_read_input_tokens ?? undefined,
        },
      },
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error({ timeout_ms: timeoutMs, elapsed_ms: elapsedMs, streaming: true }, "Anthropic streaming chat_with_tools timed out");
        throw new UpstreamTimeoutError(
          "Anthropic streaming chat_with_tools timed out",
          "anthropic",
          "stream_chat_with_tools",
          "body",
          elapsedMs,
          error,
        );
      }

      if ('status' in error && typeof error.status === 'number') {
        const apiError = error as any;
        const requestId = apiError.headers?.get?.('request-id') || apiError.request_id;
        log.error(
          { status: apiError.status, request_id: requestId, elapsed_ms: elapsedMs, streaming: true },
          "Anthropic streaming API returned non-2xx status",
        );
        throw new UpstreamHTTPError(
          `Anthropic streaming chat_with_tools failed: ${apiError.message || 'unknown error'}`,
          "anthropic",
          apiError.status,
          apiError.code || apiError.type,
          requestId,
          elapsedMs,
          error,
        );
      }
    }

    log.error({ error, streaming: true }, "Anthropic streaming chat_with_tools call failed");
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
    this.model = resolveAnthropicModel(model);
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
        briefSignalsHeader: args.briefSignalsHeader,
        currencyInstruction: args.currencyInstruction,
        systemDirective: args.systemDirective,
        thinking: args.thinking,
      },
      { collector: opts.collector, refreshPrompts: opts.bypassCache, forceDefault: opts.forceDefault, signal: opts.signal ?? opts.abortSignal, timeoutMs: opts.timeoutMs, maxTokensCeiling: opts.maxTokensCeiling }
    );

    return {
      graph: result.graph,
      rationales: result.rationales,
      usage: result.usage,
      ...((result as any).coaching ? { coaching: (result as any).coaching } : {}),
      ...(result.debug ? { debug: result.debug } : {}),
      ...(result.meta ? { meta: result.meta } : {}),
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
    const { graph, violations, brief, docs, currencyInstruction } = args;

    const result = await repairGraphWithAnthropic(
      {
        graph,
        violations,
        model: this.model,
        requestId: opts.requestId,
        brief,
        docs,
        currencyInstruction,
      } as any,
      { signal: opts.signal ?? opts.abortSignal, timeoutMs: opts.timeoutMs }
    );

    return {
      graph: result.graph,
      rationales: result.rationales,
      usage: result.usage,
    };
  }

  async clarifyBrief(args: ClarifyBriefArgs, _opts: CallOpts): Promise<ClarifyBriefResult> {
    const { brief, round, previous_answers, seed, currencyInstruction } = args;

    const result = await clarifyBriefWithAnthropic({
      brief,
      round,
      previous_answers,
      seed,
      model: this.model,
      currencyInstruction,
    } as any);

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

  async chat(args: ChatArgs, opts: CallOpts): Promise<ChatResult> {
    return chatWithAnthropic({
      system: args.system,
      userMessage: args.userMessage,
      model: this.model,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      requestId: opts.requestId,
      timeoutMs: opts.timeoutMs,
      // CallOpts.signal was previously dropped here — callers that forwarded
      // an abort signal through adapter.chat() got no cancellation at all.
      // Minor (Codex r2 review): honour the legacy `abortSignal` alias too, for
      // contract parity with every other forwarding site (draftGraph/repairGraph
      // + the two chatWithTools sites all use `opts.signal ?? opts.abortSignal`).
      signal: opts.signal ?? opts.abortSignal,
      thinking: args.thinking,
      outputSchema: args.outputSchema,
      structuredOutputsUserReminder: args.structuredOutputsUserReminder,
      structuredOutputsAdditionalModels: args.structuredOutputsAdditionalModels,
    });
  }

  async chatWithTools(args: ChatWithToolsArgs, opts: CallOpts): Promise<ChatWithToolsResult> {
    return chatWithToolsAnthropic({
      system: args.system,
      messages: args.messages,
      tools: args.tools,
      tool_choice: args.tool_choice,
      model: this.model,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      requestId: opts.requestId,
      timeoutMs: opts.timeoutMs,
      system_cache_blocks: args.system_cache_blocks,
      thinking: args.thinking,
    });
  }

  async *streamChatWithTools(args: ChatWithToolsArgs, opts: CallOpts): AsyncIterable<ChatWithToolsStreamEvent> {
    yield* streamChatWithToolsAnthropic({
      system: args.system,
      messages: args.messages,
      tools: args.tools,
      tool_choice: args.tool_choice,
      model: this.model,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      requestId: opts.requestId,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal ?? opts.abortSignal,
      system_cache_blocks: args.system_cache_blocks,
      thinking: args.thinking,
    });
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
  isStructuredOutputsRejection,
  buildStrictAnthropicTools,
};
