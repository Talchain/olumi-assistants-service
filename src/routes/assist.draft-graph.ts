import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { DraftGraphInput, DraftGraphOutput, ErrorV1, type DraftGraphInputT } from "../schemas/assist.js";
import { calcConfidence, shouldClarify } from "../utils/confidence.js";
import { estimateTokens, allowedCostUSD } from "../utils/costGuard.js";
import { type DocPreview } from "../services/docProcessing.js";
import { processAttachments, type AttachmentInput, type GroundingStats } from "../grounding/process-attachments.js";
import { getAdapter } from "../adapters/llm/router.js";
import { validateGraph } from "../services/validateClientWithCache.js";
import { simpleRepair } from "../services/repair.js";
import { stabiliseGraph, ensureDagAndPrune } from "../orchestrator/index.js";
import { validateAndFixGraph } from "../cee/structure/index.js";
import { enrichGraphWithFactorsAsync } from "../cee/factor-extraction/enricher.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";
import { hasLegacyProvenance } from "../schemas/graph.js";
import { fixtureGraph } from "../utils/fixtures.js";
import type { GraphT } from "../schemas/graph.js";
import { validateResponse } from "../utils/responseGuards.js";
import { enforceStableEdgeIds } from "../utils/graph-determinism.js";
import { detectCycles } from "../utils/graphGuards.js";
import { isFeatureEnabled } from "../utils/feature-flags.js";
import { createResumeToken, verifyResumeToken } from "../utils/sse-resume-token.js";
import { initStreamState, bufferEvent, markStreamComplete, cleanupStreamState, getStreamState, getBufferedEvents, getSnapshot, renewSnapshot } from "../utils/sse-state.js";
import { getRedis } from "../platform/redis.js";
import {
  SSE_DEGRADED_HEADER_NAME,
  SSE_DEGRADED_REDIS_REASON,
  SSE_DEGRADED_KIND_REDIS_UNAVAILABLE,
} from "../utils/degraded-mode.js";
import { HTTP_CLIENT_TIMEOUT_MS, getJitteredRetryDelayMs } from "../config/timeouts.js";
import type { DraftGraphResult } from "../adapters/llm/types.js";
import { config } from "../config/index.js";

const EVENT_STREAM = "text/event-stream";
const STAGE_EVENT = "stage";
const SSE_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache"
} as const;

const FIXTURE_TIMEOUT_MS = 2500; // Show fixture if draft takes longer than 2.5s

// Time budget configuration - skip LLM repair if draft takes too long
// This prevents client timeouts by ensuring faster responses
const DEFAULT_DRAFT_BUDGET_MS = 25000; // 25 seconds total budget
const DEFAULT_REPAIR_TIMEOUT_MS = 10000; // 10 seconds for repair call

function getDraftBudgetMs(): number {
  const envVal = process.env.CEE_DRAFT_BUDGET_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_DRAFT_BUDGET_MS;
}

function getRepairTimeoutMs(): number {
  const envVal = process.env.CEE_REPAIR_TIMEOUT_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_REPAIR_TIMEOUT_MS;
}

// Lazy config access to avoid module-level initialization issues
function getDeprecationSunset(): string {
  return config.server.deprecationSunset;
}

// Lazy config access to avoid module-level initialization issues in tests
function getCostMaxUsd(): number {
  return config.graph.costMaxUsd;
}

/**
 * Dangerous prototype keys that should never be set dynamically
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// v1.3.0: Legacy SSE flag (read at request time for testability)
function isLegacySSEEnabled(): boolean {
  return config.features.enableLegacySSE;
}
const defaultPatch = { adds: { nodes: [], edges: [] }, updates: [], removes: [] } as const;

function refinementEnabled(): boolean {
  return config.cee.refinementEnabled;
}

function buildRefinementBrief(
  brief: string,
  previousGraph: GraphT,
  options: {
    mode?: string;
    instructions?: string | null | undefined;
    preserveNodes?: string[] | null | undefined;
  },
): string {
  const safeInstructions = typeof options.instructions === "string" ? options.instructions.trim() : "";
  const preserveIds = Array.isArray(options.preserveNodes)
    ? options.preserveNodes.filter((id) => typeof id === "string" && id.length > 0)
    : [];

  let modeLine = "Refine the existing graph to improve clarity, completeness, and structure while preserving the core decision.";
  const mode = options.mode;
  if (mode === "expand") {
    modeLine =
      "Refine by expanding the graph: add missing options, outcomes, and risks, but avoid removing important nodes.";
  } else if (mode === "prune") {
    modeLine =
      "Refine by pruning and simplifying the graph: merge or remove redundant or low-impact nodes and edges, without changing the core decision.";
  } else if (mode === "clarify") {
    modeLine =
      "Refine by clarifying the existing graph: improve labels and connections for ambiguous nodes, but avoid large structural changes.";
  }

  const preserveLine = preserveIds.length
    ? `\n- Preserve these node IDs exactly (do not remove or rename them): ${preserveIds.join(", ")}.`
    : "";

  const instructionsLine = safeInstructions
    ? `\n- Follow these refinement instructions: ${safeInstructions}`
    : "";

  const maxNodes = 20;
  const maxEdges = 40;
  const maxLabelLen = 80;

  const nodes = Array.isArray(previousGraph.nodes) ? previousGraph.nodes.slice(0, maxNodes) : [];
  const edges = Array.isArray(previousGraph.edges) ? previousGraph.edges.slice(0, maxEdges) : [];

  const nodeLines = nodes
    .map((n) => {
      const id = typeof (n as any).id === "string" ? (n as any).id : "";
      const kind = typeof (n as any).kind === "string" ? (n as any).kind : "";
      const rawLabel = typeof (n as any).label === "string" ? (n as any).label : "";
      const label = rawLabel.length > maxLabelLen ? `${rawLabel.slice(0, maxLabelLen)}…` : rawLabel;
      const labelPart = label ? `: ${label}` : "";
      return `- ${id} [${kind}]${labelPart}`;
    })
    .join("\n");

  const edgeLines = edges
    .map((e) => {
      const from = typeof (e as any).from === "string" ? (e as any).from : "";
      const to = typeof (e as any).to === "string" ? (e as any).to : "";
      return `- ${from} -> ${to}`;
    })
    .join("\n");

  const graphSummary = [
    "Existing graph summary:",
    nodes.length ? `Nodes (${nodes.length}):\n${nodeLines}` : "Nodes: (none)",
    edges.length ? `Edges (${edges.length}):\n${edgeLines}` : "Edges: (none)",
  ].join("\n\n");

  const refinementContext = [
    "You are refining an existing decision graph instead of drafting from scratch.",
    modeLine,
    preserveLine,
    instructionsLine,
  ]
    .filter((line) => line && line.trim().length > 0)
    .join("\n");

  return [
    brief,
    "\n\n---\n\nRefinement context:",
    refinementContext,
    "\n\n",
    graphSummary,
  ].join(" ");
}

type SuccessPayload = ReturnType<typeof DraftGraphOutput.parse>;
type ErrorEnvelope = ReturnType<typeof ErrorV1.parse>;

type StageEvent =
  | { stage: "DRAFTING"; payload?: SuccessPayload }
  | { stage: "COMPLETE"; payload: SuccessPayload | ErrorEnvelope };

type Diagnostics = {
  resumes: number;
  trims: number;
  recovered_events: number;
  correlation_id: string;
};

type StructuralMeta = {
  had_cycles?: boolean;
  cycle_node_ids?: string[];
  had_pruned_nodes?: boolean;
};

function buildDiagnosticsFromPayload(
  payload: Record<string, any>,
  correlationId: string,
  overrides?: Partial<Pick<Diagnostics, "resumes" | "trims" | "recovered_events">>
): Diagnostics {
  const telemetry = payload && typeof payload === "object" ? (payload as any).telemetry : undefined;
  const trimsFromTelemetry = telemetry && telemetry.buffer_trimmed ? 1 : 0;

  return {
    resumes: overrides?.resumes ?? 0,
    trims: overrides?.trims ?? trimsFromTelemetry,
    recovered_events: overrides?.recovered_events ?? 0,
    correlation_id: correlationId,
  };
}

function withDiagnostics<T extends Record<string, any>>(
  payload: T,
  diagnostics: Diagnostics
): T & { diagnostics: Diagnostics } {
  return {
    ...(payload as any),
    diagnostics,
  } as T & { diagnostics: Diagnostics };
}

type AttachmentPayload = string | { data: string; encoding?: string };

export function sanitizeDraftGraphInput(
  input: DraftGraphInputT,
  rawInput?: unknown,
): DraftGraphInputT {
  const {
    brief,
    attachments,
    attachment_payloads,
    constraints,
    flags,
    include_debug,
    focus_areas,
    previous_graph,
    refinement_mode,
    refinement_instructions,
    preserve_nodes,
  } = input;

  const base = {
    brief,
    attachments,
    attachment_payloads,
    constraints,
    flags,
    include_debug,
    focus_areas,
    previous_graph,
    refinement_mode,
    refinement_instructions,
    preserve_nodes,
  };

  const passthrough: Record<string, unknown> = {};

  const extrasSource =
    rawInput && typeof rawInput === "object"
      ? (rawInput as Record<string, unknown>)
      : (input as unknown as Record<string, unknown>);

  const fixturesValue = extrasSource["fixtures"];
  if (typeof fixturesValue === "boolean") {
    passthrough.fixtures = fixturesValue;
  }

  // Preserve CEE-specific passthrough fields
  const seedValue = extrasSource["seed"];
  if (typeof seedValue === "string") {
    passthrough.seed = seedValue;
  }

  const archetypeHintValue = extrasSource["archetype_hint"];
  if (typeof archetypeHintValue === "string") {
    passthrough.archetype_hint = archetypeHintValue;
  }

  // Limit sim_* passthrough to prevent DOS via payload bloat
  const MAX_SIM_FIELDS = 10;
  const MAX_SIM_STRING_LENGTH = 500;
  let simFieldCount = 0;

  for (const [key, value] of Object.entries(extrasSource)) {
    if (!key.startsWith("sim_")) continue;
    // Skip unsafe keys to prevent prototype pollution
    if (UNSAFE_KEYS.has(key)) continue;
    // Enforce field count limit
    if (simFieldCount >= MAX_SIM_FIELDS) {
      log.warn({ key, limit: MAX_SIM_FIELDS }, "Ignoring sim_* field: count limit exceeded");
      continue;
    }
    const valueType = typeof value;
    if (valueType === "string") {
      // Enforce string length limit
      const strValue = value as string;
      if (strValue.length > MAX_SIM_STRING_LENGTH) {
        log.warn({ key, length: strValue.length, limit: MAX_SIM_STRING_LENGTH }, "Truncating sim_* string value");
        Object.defineProperty(passthrough, key, {
          value: strValue.slice(0, MAX_SIM_STRING_LENGTH),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        Object.defineProperty(passthrough, key, {
          value: strValue,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      simFieldCount++;
    } else if (valueType === "number" || valueType === "boolean") {
      Object.defineProperty(passthrough, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      simFieldCount++;
    }
  }

  return { ...base, ...passthrough } as DraftGraphInputT;
}

type PipelineResult =
  | {
      kind: "success";
      payload: SuccessPayload;
      hasLegacyProvenance?: boolean;
      cost_usd: number;
      provider: string;
      model: string;
      structural_meta?: StructuralMeta;
    }
  | { kind: "error"; statusCode: number; envelope: ErrorEnvelope };

function buildError(code: "BAD_INPUT" | "RATE_LIMITED" | "INTERNAL", message: string, details?: unknown): ErrorEnvelope {
  return ErrorV1.parse({ schema: "error.v1", code, message, details });
}

function determineClarifier(confidence: number): "complete" | "max_rounds" | "confident" {
  if (confidence >= 0.9) return "confident";
  return shouldClarify(confidence, 0) ? "max_rounds" : "complete";
}

/**
 * Write SSE event following RFC 8895 multi-line semantics
 * Each line of the data field must be prefixed with "data: "
 * Optimized: avoid split/loop for single-line JSON (common case)
 */
async function writeStage(reply: FastifyReply, event: StageEvent): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const jsonStr = JSON.stringify(event);

    // Optimization: Most JSON is single-line. Skip split/loop overhead.
    let buffer: string;
    if (jsonStr.indexOf('\n') === -1) {
      // Fast path: single-line JSON (no newlines)
      buffer = `event: ${STAGE_EVENT}\ndata: ${jsonStr}\n\n`;
    } else {
      // Slow path: multi-line JSON (rare, only if data contains embedded newlines)
      const lines = jsonStr.split('\n');
      buffer = `event: ${STAGE_EVENT}\n`;
      for (const line of lines) {
        buffer += `data: ${line}\n`;
      }
      buffer += '\n';
    }

    const ok = reply.raw.write(buffer);
    if (ok) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reply.raw.removeListener("drain", onDrain);
      reject(new Error("SSE write timeout"));
    }, 30000);

    const onDrain = () => {
      log.debug({ event: (event as any).stage }, "SSE write resumed after drain");
      clearTimeout(timeout);
      resolve();
    };

    reply.raw.once("drain", onDrain);
  });
}

/**
 * Process attachments using grounding module (v04).
 * Enforces 5k char limit per file with BAD_INPUT errors.
 *
 * @throws Error with details for over-limit files or processing failures
 */
async function groundAttachments(
  input: DraftGraphInputT,
  rawBody: unknown
): Promise<{ docs: DocPreview[]; stats: GroundingStats }> {
  // Check if grounding feature is enabled (env or per-request flag)
  if (!isFeatureEnabled('grounding', input.flags)) {
    return {
      docs: [],
      stats: { files_processed: 0, pdf: 0, txt_md: 0, csv: 0, total_chars: 0 }
    };
  }

  if (!input.attachments?.length) {
    return {
      docs: [],
      stats: { files_processed: 0, pdf: 0, txt_md: 0, csv: 0, total_chars: 0 }
    };
  }

  const payloads = (rawBody as { attachment_payloads?: Record<string, AttachmentPayload> })?.attachment_payloads ?? {};

  // Build AttachmentInput array with content
  const attachmentInputs: AttachmentInput[] = [];
  for (const attachment of input.attachments) {
    const payload = payloads[attachment.id];
    if (!payload) {
      log.warn({ attachment_id: attachment.id, redacted: true }, "Attachment payload missing, skipping");
      continue;
    }

    const content = typeof payload === "string"
      ? payload // Already base64 string
      : Buffer.from(payload.data, (payload.encoding ?? "base64") as any);

    attachmentInputs.push({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      content,
    });
  }

  // Process attachments with grounding module (enforces 5k limit, privacy, safe CSV)
  const result = await processAttachments(attachmentInputs);
  return result;
}

export async function runDraftGraphPipeline(input: DraftGraphInputT, rawBody: unknown, correlationId: string): Promise<PipelineResult> {
  // Process attachments with grounding module (v04: 5k limit, privacy, safe CSV)
  let docs: DocPreview[];
  let groundingStats: GroundingStats | undefined;

  try {
    const result = await groundAttachments(input, rawBody);
    docs = result.docs;
    groundingStats = result.stats;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Handle over-limit files with BAD_INPUT error and helpful hint
    if (err.message.includes('_exceeds_limit')) {
      const hint = err.message.includes('aggregate_exceeds_limit')
        ? "Total attachment size exceeds 50k character limit. Please reduce the number of attachments or their sizes."
        : "One or more files exceed the 5k character limit. Please reduce file size or split into smaller files.";

      return {
        kind: "error",
        statusCode: 400,
        envelope: buildError("BAD_INPUT", err.message, { hint })
      };
    }

    // Handle other processing errors
    return {
      kind: "error",
      statusCode: 400,
      envelope: buildError("BAD_INPUT", `Attachment processing failed: ${err.message}`)
    };
  }

  const confidence = calcConfidence({ goal: input.brief });
  const useRefinement = refinementEnabled() && input.previous_graph !== undefined;

  const effectiveBrief = useRefinement
    ? buildRefinementBrief(input.brief, input.previous_graph as GraphT, {
        mode: input.refinement_mode,
        instructions: input.refinement_instructions,
        preserveNodes: input.preserve_nodes,
      })
    : input.brief;
  const clarifier = determineClarifier(confidence);

  // Get adapter via router (env-driven or config-based provider selection)
  const draftAdapter = getAdapter('draft_graph');

  // Cost guard: check estimated cost before making LLM call
  const promptChars = effectiveBrief.length + docs.reduce((acc, doc) => acc + doc.preview.length, 0);
  const tokensIn = estimateTokens(promptChars);
  const tokensOut = estimateTokens(1200);

  if (!allowedCostUSD(tokensIn, tokensOut, draftAdapter.model)) {
    return { kind: "error", statusCode: 429, envelope: buildError("RATE_LIMITED", "cost guard exceeded") };
  }

  const llmStartTime = Date.now();
  emit(TelemetryEvents.Stage, { stage: "llm_start", confidence, tokensIn, provider: draftAdapter.name, correlation_id: correlationId });

  // V04: Telemetry for upstream calls with single retry on timeout
  let draftResult: DraftGraphResult | undefined;
  let upstreamStatusCode = 200; // Default to success
  let attempt = 0;

  while (attempt < 2) {
    attempt += 1;
    const requestId = attempt === 1 ? `draft_${Date.now()}` : `draft_retry_${Date.now()}`;

    try {
      draftResult = await draftAdapter.draftGraph(
        { brief: effectiveBrief, docs, seed: 17 },
        { requestId, timeoutMs: HTTP_CLIENT_TIMEOUT_MS }
      );
      break;
    } catch (error) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      const isTimeout = err.name === "UpstreamTimeoutError";

      if (!isTimeout || attempt >= 2) {
        const llmDuration = Date.now() - llmStartTime;
        upstreamStatusCode = isTimeout ? 504 : 500;
        emit(TelemetryEvents.DraftUpstreamError, {
          status_code: upstreamStatusCode,
          latency_ms: llmDuration,
          provider: draftAdapter.name,
          correlation_id: correlationId,
        });
        throw err;
      }

      const delayMs = getJitteredRetryDelayMs();
      log.warn(
        { provider: draftAdapter.name, correlation_id: correlationId, delay_ms: delayMs },
        "Upstream draft_graph timeout, retrying once",
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!draftResult) {
    throw new Error("draft_graph_missing_result");
  }

  const { graph, rationales, usage: draftUsage } = draftResult;
  const llmDuration = Date.now() - llmStartTime;

  // Time budget check: skip LLM repair if we've used too much time on draft
  const draftBudgetMs = getDraftBudgetMs();
  const repairTimeoutMs = getRepairTimeoutMs();
  const remainingBudget = draftBudgetMs - llmDuration;
  const skipRepairDueToBudget = remainingBudget < repairTimeoutMs;

  if (skipRepairDueToBudget) {
    log.warn({
      stage: "repair_budget_check",
      draft_duration_ms: llmDuration,
      budget_ms: draftBudgetMs,
      remaining_ms: remainingBudget,
      repair_timeout_ms: repairTimeoutMs,
      skip_repair: true,
      correlation_id: correlationId,
    }, "Time budget exceeded - will skip LLM repair and use simple repair if needed");
  }

  // V04: Emit upstream telemetry for successful calls
  emit(TelemetryEvents.DraftUpstreamSuccess, {
    status_code: upstreamStatusCode,
    latency_ms: llmDuration,
    provider: draftAdapter.name,
    correlation_id: correlationId,
  });
  emit(TelemetryEvents.Stage, { stage: "llm_complete", nodes: graph.nodes.length, edges: graph.edges.length, duration_ms: llmDuration });

  const initialNodeCount = Array.isArray((graph as any).nodes) ? (graph as any).nodes.length : 0;
  const initialEdgeCount = Array.isArray((graph as any).edges) ? (graph as any).edges.length : 0;

  // DEBUG: Track node counts through pipeline stages
  log.info({
    stage: "1_llm_draft",
    node_count: initialNodeCount,
    edge_count: initialEdgeCount,
    node_kinds: graph.nodes.map((n: any) => n.kind),
    correlation_id: correlationId,
  }, "Pipeline stage: LLM draft complete");

  // Track goal vs outcome node generation for prompt tuning
  const goalNodes = graph.nodes.filter((n: any) => n.kind === "goal");
  const outcomeNodes = graph.nodes.filter((n: any) => n.kind === "outcome");

  emit(TelemetryEvents.GoalGeneration ?? "cee.goal_generation", {
    goal_count: goalNodes.length,
    outcome_count: outcomeNodes.length,
    goal_labels: goalNodes.map((n: any) => n.label),
    outcome_labels: outcomeNodes.map((n: any) => n.label),
    brief_preview: effectiveBrief.substring(0, 100),
    correlation_id: correlationId,
  });

  if (goalNodes.length === 0) {
    log.warn({
      event: "cee.no_goal_node",
      outcome_labels: outcomeNodes.map((n: any) => n.label),
      brief_preview: effectiveBrief.substring(0, 150),
      correlation_id: correlationId,
    }, "LLM did not generate a goal node - prompt may need improvement");
  } else if (goalNodes.length > 1) {
    log.warn({
      event: "cee.multiple_goal_nodes",
      goal_count: goalNodes.length,
      goal_labels: goalNodes.map((n: any) => n.label),
      correlation_id: correlationId,
    }, "LLM generated multiple goal nodes - will be merged");
  }

  if (initialNodeCount === 0) {
    emit(TelemetryEvents.GuardViolation, {
      violation_type: "empty_graph",
    });

    return {
      kind: "error",
      statusCode: 400,
      envelope: buildError(
        "BAD_INPUT",
        "Draft graph is empty after validation and repair",
        {
          reason: "empty_graph",
          node_count: initialNodeCount,
          edge_count: initialEdgeCount,
          cee_error_code: "CEE_GRAPH_INVALID",
          recovery: {
            suggestion: "Add more detail to your decision brief before drafting a model.",
            hints: [
              "State the specific decision you are trying to make (e.g., 'Should we X or Y?')",
              "List 2-3 concrete options you are considering.",
              "Describe what success looks like for this decision (key outcomes or KPIs).",
            ],
            example:
              "We need to decide whether to build the feature in-house or outsource it. Options are: hire contractors, use an agency, or build with the current team. Success means launching within 3 months under $50k.",
          },
        },
      ),
    };
  }

  // === FACTOR ENRICHMENT: Extract quantitative factors from brief ===
  // Uses LLM-first extraction when CEE_LLM_FIRST_EXTRACTION_ENABLED=true
  const enrichmentResult = await enrichGraphWithFactorsAsync(graph, effectiveBrief);
  const enrichedGraph = enrichmentResult.graph;

  // DEBUG: Track node counts after factor enrichment
  log.info({
    stage: "2_factor_enrichment",
    node_count: enrichedGraph.nodes.length,
    edge_count: enrichedGraph.edges.length,
    factors_added: enrichmentResult.factorsAdded,
    factors_enhanced: enrichmentResult.factorsEnhanced,
    factors_skipped: enrichmentResult.factorsSkipped,
    extraction_mode: enrichmentResult.extractionMode,
    llm_success: enrichmentResult.llmSuccess,
    node_kinds: enrichedGraph.nodes.map((n: any) => n.kind),
    correlation_id: correlationId,
  }, "Pipeline stage: Factor enrichment complete");

  // Calculate draft cost immediately (provider-specific pricing)
  const draftCost = calculateCost(draftAdapter.model, draftUsage.input_tokens, draftUsage.output_tokens);

  // Track cache hits across draft and repair
  let totalCacheReadTokens = draftUsage.cache_read_input_tokens || 0;

  // Track repair costs separately (may use different provider)
  let repairCost = 0;
  let repairProviderName: string | null = null;
  let repairModelName: string | null = null;

  const initialNodeIds = new Set<string>(enrichedGraph.nodes.map((n: any) => (n as any).id as string));
  const cycles = detectCycles(enrichedGraph.nodes as any, enrichedGraph.edges as any);
  const hadCycles = cycles.length > 0;
  const cycleNodeIds: string[] = Array.from(
    new Set<string>((cycles.flat() as string[])),
  ).slice(0, 20);

  let candidate = stabiliseGraph(ensureDagAndPrune(enrichedGraph));
  let issues: string[] | undefined;
  let repairFallbackReason: string | null = null;

  // DEBUG: Track node counts after first stabiliseGraph (DAG + prune + 20 node cap)
  log.info({
    stage: "3_first_stabilise",
    node_count: candidate.nodes.length,
    edge_count: candidate.edges.length,
    had_cycles: hadCycles,
    cycle_node_ids: cycleNodeIds.slice(0, 5),
    node_kinds: candidate.nodes.map((n: any) => n.kind),
    correlation_id: correlationId,
  }, "Pipeline stage: First stabiliseGraph complete (20 node cap applied)");

  const first = await validateGraph(candidate);
  if (!first.ok) {
    issues = first.violations;

    // If time budget exceeded, skip LLM repair and use simple repair directly
    if (skipRepairDueToBudget) {
      log.info({
        stage: "repair_skipped",
        violation_count: issues?.length ?? 0,
        reason: "budget_exceeded",
        correlation_id: correlationId,
      }, "Skipping LLM repair due to time budget - using simple repair");

      repairFallbackReason = "budget_exceeded";
      const repaired = stabiliseGraph(ensureDagAndPrune(simpleRepair(candidate, correlationId)));
      const second = await validateGraph(repaired);
      if (second.ok && second.normalized) {
        candidate = stabiliseGraph(ensureDagAndPrune(second.normalized));
        issues = second.violations;
      } else {
        candidate = repaired;
        issues = second.violations ?? issues;
      }
      emit(TelemetryEvents.RepairFallback, {
        fallback: "simple_repair",
        reason: "budget_exceeded",
        error_type: "none",
      });
    } else {
      // LLM-guided repair: use violations as hints
      try {
        emit(TelemetryEvents.RepairStart, { violation_count: issues?.length ?? 0 });

        // Get repair adapter (may be different provider than draft)
        const repairAdapter = getAdapter('repair_graph');
        const repairResult = await repairAdapter.repairGraph(
          {
            graph: candidate,
            violations: issues || [],
          },
          { requestId: `repair_${Date.now()}`, timeoutMs: repairTimeoutMs }
        );

      // Calculate repair cost separately (may use different provider/pricing)
      repairCost = calculateCost(repairAdapter.model, repairResult.usage.input_tokens, repairResult.usage.output_tokens);
      repairProviderName = repairAdapter.name;
      repairModelName = repairAdapter.model;

      // Accumulate cache read tokens for cache hit tracking
      totalCacheReadTokens += repairResult.usage.cache_read_input_tokens || 0;

      // Wrap DAG operations in try/catch to guarantee fallback on malformed output
      let repaired: GraphT;
      try {
        repaired = stabiliseGraph(ensureDagAndPrune(repairResult.graph));
      } catch (dagError) {
        log.warn({ error: dagError }, "Repaired graph failed DAG validation, using simple repair");
        repairFallbackReason = "dag_transform_failed";
        throw dagError; // Re-throw to trigger outer catch fallback
      }

      // Re-validate repaired graph
      const second = await validateGraph(repaired);
      if (second.ok && second.normalized) {
        candidate = stabiliseGraph(ensureDagAndPrune(second.normalized));
        issues = second.violations;
        emit(TelemetryEvents.RepairSuccess, { repair_worked: true });
      } else {
        // Repair didn't fix all issues, fallback to simple repair
        candidate = stabiliseGraph(ensureDagAndPrune(simpleRepair(repaired, correlationId)));
        issues = second.violations ?? issues;
        repairFallbackReason = "partial_fix";
        emit(TelemetryEvents.RepairPartial, { repair_worked: false, fallback_reason: repairFallbackReason });
      }
    } catch (error) {
      // LLM repair failed (API error, schema validation, or DAG error), fallback to simple repair
      const errorType = error instanceof Error ? error.name : "unknown";
      if (!repairFallbackReason) {
        repairFallbackReason = errorType === "AbortError" ? "llm_timeout" : "llm_api_error";
      }
      log.warn({ error, fallback_reason: repairFallbackReason }, "LLM repair failed, falling back to simple repair");

      const repaired = stabiliseGraph(ensureDagAndPrune(simpleRepair(candidate, correlationId)));
      const second = await validateGraph(repaired);
      if (second.ok && second.normalized) {
        candidate = stabiliseGraph(ensureDagAndPrune(second.normalized));
        issues = second.violations;
      } else {
        candidate = repaired;
        issues = second.violations ?? issues;
      }
      emit(TelemetryEvents.RepairFallback, {
        fallback: "simple_repair",
        reason: repairFallbackReason,
        error_type: errorType,
      });
    }
    } // end of else block for !skipRepairDueToBudget
  } else if (first.normalized) {
    candidate = stabiliseGraph(ensureDagAndPrune(first.normalized));
  }

  // Enforce stable edge IDs and deterministic sorting (v04 determinism hardening)
  candidate = enforceStableEdgeIds(candidate);

  // Enforce single goal and other graph invariants (fix for multiple goal nodes bug)
  // Type assertion needed: validateAndFixGraph uses generic handling internally
  const graphValidation = validateAndFixGraph(candidate as any, undefined, {
    enforceSingleGoal: config.cee.enforceSingleGoal,
    checkSizeLimits: false, // Already handled by adapter
  });
  if (graphValidation.graph) {
    candidate = graphValidation.graph as GraphT;

    // Emit telemetry if goals were merged
    if (graphValidation.fixes.singleGoalApplied) {
      emit(TelemetryEvents.CeeGraphGoalsMerged, {
        original_goal_count: graphValidation.fixes.originalGoalCount,
        merged_goal_ids: graphValidation.fixes.mergedGoalIds,
      });
    }
  }

  // DEBUG: Track node counts after goal merging and validation fixes
  log.info({
    stage: "4_goal_merge_and_fix",
    node_count: candidate.nodes.length,
    edge_count: candidate.edges.length,
    single_goal_applied: graphValidation.fixes?.singleGoalApplied ?? false,
    original_goal_count: graphValidation.fixes?.originalGoalCount,
    merged_goal_ids: graphValidation.fixes?.mergedGoalIds,
    outcome_beliefs_filled: graphValidation.fixes?.outcomeBeliefsFilled ?? 0,
    node_kinds: candidate.nodes.map((n: any) => n.kind),
    correlation_id: correlationId,
  }, "Pipeline stage: Goal merge and validation fixes complete");

  const finalNodeIds = new Set<string>(candidate.nodes.map((n: any) => (n as any).id as string));
  let hadPrunedNodes = false;
  for (const id of initialNodeIds) {
    if (!finalNodeIds.has(id)) {
      hadPrunedNodes = true;
      break;
    }
  }

  const structuralMeta: StructuralMeta = {};
  if (hadCycles) {
    structuralMeta.had_cycles = true;
    if (cycleNodeIds.length > 0) {
      structuralMeta.cycle_node_ids = cycleNodeIds;
    }
  }
  if (hadPrunedNodes) {
    structuralMeta.had_pruned_nodes = true;
  }
  const nodeCount = Array.isArray((candidate as any).nodes) ? (candidate as any).nodes.length : 0;
  const edgeCount = Array.isArray((candidate as any).edges) ? (candidate as any).edges.length : 0;

  // DEBUG: Final pipeline summary with node delta analysis
  log.info({
    stage: "5_final_output",
    initial_node_count: initialNodeCount,
    final_node_count: nodeCount,
    node_delta: nodeCount - initialNodeCount,
    initial_edge_count: initialEdgeCount,
    final_edge_count: edgeCount,
    had_cycles: hadCycles,
    had_pruned_nodes: hadPrunedNodes,
    node_kinds: candidate.nodes.map((n: any) => n.kind),
    correlation_id: correlationId,
  }, "Pipeline stage: FINAL - Node count summary");

  if (nodeCount === 0) {
    emit(TelemetryEvents.GuardViolation, {
      violation_type: "empty_graph",
    });

    return {
      kind: "error",
      statusCode: 400,
      envelope: buildError(
        "BAD_INPUT",
        "Draft graph is empty after validation and repair",
        {
          reason: "empty_graph",
          node_count: nodeCount,
          edge_count: edgeCount,
          cee_error_code: "CEE_GRAPH_INVALID",
          recovery: {
            suggestion: "Add more detail to your decision brief before drafting a model.",
            hints: [
              "State the specific decision you are trying to make (e.g., 'Should we X or Y?')",
              "List 2-3 concrete options you are considering.",
              "Describe what success looks like for this decision (key outcomes or KPIs).",
            ],
            example:
              "We need to decide whether to build the feature in-house or outsource it. Options are: hire contractors, use an agency, or build with the current team. Success means launching within 3 months under $50k.",
          },
        },
      ),
    };
  }

  const payload = DraftGraphOutput.parse({
    graph: candidate,
    patch: defaultPatch,
    rationales,
    issues: issues?.length ? issues : undefined,
    confidence,
    clarifier_status: clarifier,
    debug: input.include_debug ? { needle_movers: docs } : undefined
  });

  // Check for legacy string provenance (for deprecation tracking)
  const legacy = hasLegacyProvenance(candidate);
  if (legacy.hasLegacy) {
    // Emit telemetry event for aggregation (always)
    emit(TelemetryEvents.LegacyProvenance, {
      legacy_count: legacy.count,
      total_edges: candidate.edges.length,
      legacy_percentage: Math.round((legacy.count / candidate.edges.length) * 100),
    });

    // Sample detailed logs (10% of occurrences) to reduce noise
    if (Math.random() < 0.1) {
      log.warn(
        {
          legacy_provenance_count: legacy.count,
          total_edges: candidate.edges.length,
          deprecation: true,
          sampled: true,
        },
        "Legacy string provenance detected - will be removed in future version (sampled log)"
      );
    }
  }

  // Determine quality tier and fallback reason
  const qualityTier = confidence >= 0.9 ? "high" : confidence >= 0.7 ? "medium" : "low";
  // Use repair fallback reason if set; null means either no repair needed or repair succeeded
  const fallbackReason = repairFallbackReason;

  // Calculate total cost (draft + repair, each priced with correct provider)
  const totalCost = draftCost + repairCost;
  // Cache hit if we read any tokens from cache
  const promptCacheHit = totalCacheReadTokens > 0;

  // Build telemetry event with per-provider cost breakdown
  const telemetryData: Record<string, unknown> = {
    confidence,
    issues: issues?.length ?? 0,
    quality_tier: qualityTier,
    fallback_reason: fallbackReason,
    draft_source: draftAdapter.name,
    draft_model: draftAdapter.model,
    draft_cost_usd: draftCost,
    cost_usd: totalCost,
    prompt_cache_hit: promptCacheHit,
  };

  // Add repair provider info if repair was performed
  if (repairProviderName && repairModelName) {
    telemetryData.repair_source = repairProviderName;
    telemetryData.repair_model = repairModelName;
    telemetryData.repair_cost_usd = repairCost;
    // Flag if mixed providers were used
    telemetryData.mixed_providers = repairProviderName !== draftAdapter.name;
  }

  // Add grounding stats if attachments were processed (v04)
  if (groundingStats && groundingStats.files_processed > 0) {
    telemetryData.grounding = groundingStats;
  }

  emit(TelemetryEvents.DraftCompleted, telemetryData);

  // Log successful response generation for debugging premature close issues
  log.info({
    correlation_id: correlationId,
    returned_response: true,
    status: "success",
    node_count: nodeCount,
    edge_count: edgeCount,
    total_latency_ms: Date.now() - llmStartTime,
    repair_skipped: skipRepairDueToBudget,
    repair_fallback_reason: repairFallbackReason,
  }, "Draft-graph pipeline complete - response ready for delivery");

  return {
    kind: "success",
    payload,
    hasLegacyProvenance: legacy.hasLegacy,
    cost_usd: totalCost,
    provider: draftAdapter.name,
    model: draftAdapter.model,
    structural_meta: (structuralMeta.had_cycles || structuralMeta.had_pruned_nodes) ? structuralMeta : undefined,
  };
}

/**
 * Handle SSE streaming response with fixture fallback
 */
async function handleSseResponse(
  reply: FastifyReply,
  input: DraftGraphInputT,
  rawBody: unknown,
  correlationId: string
): Promise<void> {
  const streamStartTime = Date.now();
  let fixtureSent = false;
  let sseEndState: "complete" | "timeout" | "aborted" | "error" = "complete"; // V04: Track SSE end state
  let eventSeq = 0; // v1.8: Track event sequence for resume

  // V04: Echo correlation ID in response header
  reply.raw.setHeader("X-Correlation-ID", correlationId);
  reply.raw.writeHead(200, SSE_HEADERS);
  await writeStage(reply, { stage: "DRAFTING" });
  emit(TelemetryEvents.SSEStarted, { correlation_id: correlationId });

  // v1.8: Initialize SSE resume state in Redis (gracefully skip if Redis unavailable)
  try {
    await initStreamState(correlationId);

    // Buffer first DRAFTING event
    await bufferEvent(correlationId, {
      seq: eventSeq,
      type: "stage",
      data: JSON.stringify({ stage: "DRAFTING" }),
      timestamp: Date.now(),
    });
    eventSeq++;

    // Generate and send resume token on first event
    try {
      const resumeToken = createResumeToken(correlationId, "DRAFTING", eventSeq);
      reply.raw.write(`event: resume\ndata: ${JSON.stringify({ token: resumeToken })}\n\n`);
      emit(TelemetryEvents.SseResumeIssued, {
        request_id: correlationId,
        seq: eventSeq,
        step: "DRAFTING",
      });

      // Buffer resume event
      await bufferEvent(correlationId, {
        seq: eventSeq,
        type: "resume",
        data: JSON.stringify({ token: resumeToken }),
        timestamp: Date.now(),
      });
      eventSeq++;
    } catch (tokenError) {
      log.debug({ error: tokenError, request_id: correlationId }, "Resume token generation skipped (secrets not configured)");
      // Continue without resume functionality
    }
  } catch (stateError) {
    log.debug({ error: stateError, request_id: correlationId }, "SSE resume state initialization skipped (Redis unavailable)");
    // Continue without resume functionality
  }

  // V04: SSE heartbeats every 10s to prevent proxy idle timeouts
  // Send SSE comment lines that keep connection alive but don't affect client state
  const heartbeatInterval = setInterval(() => {
    try {
      // SSE comment event that keeps the connection alive but does not affect client state
      reply.raw.write(`: heartbeat\n\n`);
    } catch (error) {
      // Client likely disconnected; stop heartbeats to avoid leaking timers
      clearInterval(heartbeatInterval);
      log.debug({ error, correlation_id: correlationId }, "Failed to write SSE heartbeat - stopping heartbeats");
    }
  }, 10000); // 10s

  // v1.8: Helper to write stage and buffer event (gracefully handle buffering errors)
  const writeStageAndBuffer = async (event: StageEvent) => {
    await writeStage(reply, event);
    try {
      await bufferEvent(correlationId, {
        seq: eventSeq,
        type: "stage",
        data: JSON.stringify(event),
        timestamp: Date.now(),
      });
      eventSeq++;
    } catch (error) {
      log.debug({ error, request_id: correlationId }, "Event buffering skipped (Redis unavailable)");
      eventSeq++;
      // Continue without buffering
    }
  };

  const withBufferTrimTelemetry = async <T extends Record<string, any>>(payload: T): Promise<T> => {
    try {
      const state = await getStreamState(correlationId);
      if (!state?.buffer_trimmed) {
        return payload;
      }

      const existingTelemetry =
        payload && typeof (payload as any).telemetry === "object"
          ? (payload as any).telemetry
          : {};

      return {
        ...(payload as any),
        telemetry: {
          ...existingTelemetry,
          buffer_trimmed: true,
        },
      } as T;
    } catch (error) {
      log.debug({ error, request_id: correlationId }, "Buffer trim state lookup skipped (Redis unavailable)");
      return payload;
    }
  };

  // SSE with fixture fallback: show fixture if draft takes > 2.5s
  try {
    const fixtureTimeout = setTimeout(async () => {
      if (!fixtureSent) {
        // Show minimal fixture graph while waiting for real draft
        // Apply stable edge IDs to fixture graph for consistency
        const stableFixture = enforceStableEdgeIds({ ...fixtureGraph });
        const fixturePayload = DraftGraphOutput.parse({
          graph: stableFixture,
          patch: defaultPatch,
          rationales: [],
          confidence: 0.5,
          clarifier_status: "complete",
        });
        await writeStageAndBuffer({ stage: "DRAFTING", payload: fixturePayload });
        fixtureSent = true;
        emit(TelemetryEvents.FixtureShown, { timeout_ms: FIXTURE_TIMEOUT_MS });
      }
    }, FIXTURE_TIMEOUT_MS);

    // Run pipeline
    const result = await runDraftGraphPipeline(input, rawBody, correlationId);
    clearTimeout(fixtureTimeout);
    const streamDuration = Date.now() - streamStartTime;

    if (fixtureSent) {
      emit(TelemetryEvents.FixtureReplaced, { fixture_shown: true, stream_duration_ms: streamDuration });
    }

    // Handle pipeline errors (validation, rate limiting, etc.)
    if (result.kind === "error") {
      const streamDuration = Date.now() - streamStartTime;
      sseEndState = "error"; // V04: Track SSE end state
      const payloadWithTelemetry = await withBufferTrimTelemetry(result.envelope);
      const diagnostics = buildDiagnosticsFromPayload(payloadWithTelemetry as any, correlationId);
      const completePayload = withDiagnostics(payloadWithTelemetry, diagnostics);
      await writeStageAndBuffer({ stage: "COMPLETE", payload: completePayload });
      emit(TelemetryEvents.SSEError, {
        stream_duration_ms: streamDuration,
        error: result.envelope.message,
        error_code: result.envelope.code,
        status_code: result.statusCode,
        fixture_shown: fixtureSent,
        correlation_id: correlationId,
        sse_end_state: sseEndState,
      });
      // Persist error snapshot for late resume (gracefully skip if Redis unavailable)
      try {
        await markStreamComplete(correlationId, completePayload, "error");
        emit(TelemetryEvents.SseSnapshotCreated, {
          request_id: correlationId,
          status: "error",
        });
      } catch (error) {
        log.debug({ error, request_id: correlationId }, "Snapshot creation skipped (Redis unavailable)");
      }
      clearInterval(heartbeatInterval);
      // v1.8: Cleanup SSE resume state on error (gracefully skip if Redis unavailable)
      try {
        await cleanupStreamState(correlationId);
      } catch (cleanupError) {
        log.debug({ error: cleanupError, request_id: correlationId }, "State cleanup skipped (Redis unavailable)");
      }
      reply.raw.end();
      return;
    }

    // Post-response guard: validate graph caps and cost (JSON↔SSE parity requirement)
    const guardResult = validateResponse(result.payload.graph, result.cost_usd, getCostMaxUsd());
    if (!guardResult.ok) {
      sseEndState = "error"; // V04: Track SSE end state
      const violation = guardResult.violation;
      const baseDetails = (violation.details ?? {}) as Record<string, unknown>;
      const ceeErrorCode =
        violation.code === "CAP_EXCEEDED" || violation.code === "INVALID_COST"
          ? "CEE_GRAPH_INVALID"
          : "CEE_VALIDATION_FAILED";
      const guardError = buildError("BAD_INPUT", violation.message, {
        ...baseDetails,
        cee_error_code: ceeErrorCode,
        guard_violation_code: violation.code,
      });
      const payloadWithTelemetry = await withBufferTrimTelemetry(guardError);
      const diagnostics = buildDiagnosticsFromPayload(payloadWithTelemetry as any, correlationId);
      const completePayload = withDiagnostics(payloadWithTelemetry, diagnostics);
      await writeStageAndBuffer({ stage: "COMPLETE", payload: completePayload });
      emit(TelemetryEvents.GuardViolation, {
        stream_duration_ms: streamDuration,
        violation_code: guardResult.violation.code,
        violation_message: guardResult.violation.message,
        provider: result.provider,
        cost_usd: result.cost_usd,
        fixture_shown: fixtureSent,
        correlation_id: correlationId,
        sse_end_state: sseEndState,
      });
      // Persist guard violation snapshot for late resume (gracefully skip if Redis unavailable)
      try {
        await markStreamComplete(correlationId, completePayload, "error");
        emit(TelemetryEvents.SseSnapshotCreated, {
          request_id: correlationId,
          status: "error",
        });
      } catch (error) {
        log.debug({ error, request_id: correlationId }, "Snapshot creation skipped (Redis unavailable)");
      }
      clearInterval(heartbeatInterval);
      // v1.8: Cleanup SSE resume state on error (gracefully skip if Redis unavailable)
      try {
        await cleanupStreamState(correlationId);
      } catch (cleanupError) {
        log.debug({ error: cleanupError, request_id: correlationId }, "State cleanup skipped (Redis unavailable)");
      }
      reply.raw.end();
      return;
    }

    // Add deprecation headers if legacy string provenance detected
    if (result.hasLegacyProvenance) {
      reply.raw.setHeader("X-Deprecated-Provenance-Format", "true");
      reply.raw.setHeader("X-Deprecation-Sunset", getDeprecationSunset());
      reply.raw.setHeader("X-Deprecation-Link", "https://docs.olumi.ai/provenance-migration");
    }

    // Success - extract quality metrics for telemetry (with provider and cost - parity requirement)
    const confidence = result.payload.confidence ?? 0;
    const qualityTier = confidence >= 0.9 ? "high" : confidence >= 0.7 ? "medium" : "low";
    const hasIssues = (result.payload.issues?.length ?? 0) > 0;

    sseEndState = "complete"; // V04: Track SSE end state - successful completion
    const payloadWithTelemetry = await withBufferTrimTelemetry(result.payload);
    const diagnostics = buildDiagnosticsFromPayload(payloadWithTelemetry as any, correlationId);
    const completePayload = withDiagnostics(payloadWithTelemetry, diagnostics);
    await writeStageAndBuffer({ stage: "COMPLETE", payload: completePayload });

    // v1.8: Save completion snapshot for late resume (gracefully skip if Redis unavailable)
    try {
      await markStreamComplete(correlationId, completePayload, "complete");
      emit(TelemetryEvents.SseSnapshotCreated, {
        request_id: correlationId,
        status: "complete",
      });
    } catch (error) {
      log.debug({ error, request_id: correlationId }, "Snapshot creation skipped (Redis unavailable)");
    }

    emit(TelemetryEvents.SSECompleted, {
      stream_duration_ms: streamDuration,
      fixture_shown: fixtureSent,
      quality_tier: qualityTier,
      has_issues: hasIssues,
      confidence,
      provider: result.provider || "unknown", // Fallback for parity
      cost_usd: result.cost_usd ?? 0, // Fallback for parity
      model: result.model,
      correlation_id: correlationId,
      sse_end_state: sseEndState,
    });
    clearInterval(heartbeatInterval);

    // v1.8: Cleanup SSE resume state after successful completion (gracefully skip if Redis unavailable)
    try {
      await cleanupStreamState(correlationId);
    } catch (error) {
      log.debug({ error, request_id: correlationId }, "State cleanup skipped (Redis unavailable)");
    }
    reply.raw.end();
  } catch (error: unknown) {
    clearInterval(heartbeatInterval);
    const err = error instanceof Error ? error : new Error("unexpected error");
    sseEndState = err.name === "AbortError" ? "timeout" : "error"; // V04: Track SSE end state
    log.error({ err, correlation_id: correlationId }, "SSE draft graph failure");
    const envelope = buildError("INTERNAL", err.message || "internal");
    const payloadWithTelemetry = await withBufferTrimTelemetry(envelope);
    const diagnostics = buildDiagnosticsFromPayload(payloadWithTelemetry as any, correlationId);
    const completePayload = withDiagnostics(payloadWithTelemetry, diagnostics);
    await writeStageAndBuffer({ stage: "COMPLETE", payload: completePayload });
    const streamDuration = Date.now() - streamStartTime;
    emit(TelemetryEvents.SSEError, {
      stream_duration_ms: streamDuration,
      error: err.message,
      error_code: "INTERNAL",
      error_type: err.name,
      fixture_shown: fixtureSent,
      correlation_id: correlationId,
      sse_end_state: sseEndState,
    });
    // v1.11: Persist internal error snapshot for late resume (gracefully skip if Redis unavailable)
    try {
      await markStreamComplete(correlationId, completePayload, "error");
      emit(TelemetryEvents.SseSnapshotCreated, {
        request_id: correlationId,
        status: "error",
      });
    } catch (snapshotError) {
      log.debug({ error: snapshotError, request_id: correlationId }, "Snapshot creation skipped (Redis unavailable)");
    }
    // v1.8: Cleanup SSE resume state on error (gracefully skip if Redis unavailable)
    try {
      await cleanupStreamState(correlationId);
    } catch (cleanupError) {
      log.debug({ error: cleanupError, request_id: correlationId }, "State cleanup skipped (Redis unavailable)");
    }
    reply.raw.end();
  }
}

/**
 * Handle JSON response
 */
async function handleJsonResponse(
  reply: FastifyReply,
  input: DraftGraphInputT,
  rawBody: unknown,
  correlationId: string
): Promise<void> {
  // V04: Echo correlation ID in response header
  reply.header("X-Correlation-ID", correlationId);

  const result = await runDraftGraphPipeline(input, rawBody, correlationId);

  // Handle errors
  if (result.kind === "error") {
    reply.code(result.statusCode);
    return reply.send(result.envelope);
  }

  // Post-response guard: validate graph caps and cost (JSON↔SSE parity requirement)
  const guardResult = validateResponse(result.payload.graph, result.cost_usd, getCostMaxUsd());
  if (!guardResult.ok) {
    const violation = guardResult.violation;
    const baseDetails = (violation.details ?? {}) as Record<string, unknown>;
    const ceeErrorCode =
      violation.code === "CAP_EXCEEDED" || violation.code === "INVALID_COST"
        ? "CEE_GRAPH_INVALID"
        : "CEE_VALIDATION_FAILED";
    const guardError = buildError("BAD_INPUT", violation.message, {
      ...baseDetails,
      cee_error_code: ceeErrorCode,
      guard_violation_code: violation.code,
    });
    emit(TelemetryEvents.GuardViolation, {
      violation_code: guardResult.violation.code,
      violation_message: guardResult.violation.message,
      provider: result.provider,
      cost_usd: result.cost_usd,
    });
    reply.code(400);
    return reply.send(guardError);
  }

  // Add deprecation headers if legacy string provenance detected
  if (result.hasLegacyProvenance) {
    reply.header("X-Deprecated-Provenance-Format", "true");
    reply.header("X-Deprecation-Sunset", getDeprecationSunset());
    reply.header("X-Deprecation-Link", "https://docs.olumi.ai/provenance-migration");
  }

  // Success
  const diagnostics = buildDiagnosticsFromPayload(result.payload as any, correlationId);
  const responsePayload = withDiagnostics(result.payload, diagnostics);
  reply.code(200);
  return reply.send(responsePayload);
}

export default async function route(app: FastifyInstance) {
  // SSE-specific rate limit (lower than global due to long-running connections)
  const SSE_RATE_LIMIT_RPM = config.rateLimits.sseRpm;
  // v1.9: Live resume feature flag and rate limit
  const SSE_RESUME_LIVE_ENABLED = config.sse.resumeLiveEnabled;
  const SSE_RESUME_LIVE_RPM = config.sse.resumeLiveRpm ?? SSE_RATE_LIMIT_RPM;

  // Dedicated SSE streaming endpoint with stricter rate limiting
  app.post("/assist/draft-graph/stream", {
    config: {
      rateLimit: {
        max: SSE_RATE_LIMIT_RPM,
        timeWindow: '1 minute'
      }
    }
  }, async (req, reply) => {
    // V04: Generate correlation ID for request traceability
    const correlationId = randomUUID();

    // v1.11: Detect Redis-unavailable degraded mode for SSE streaming
    // When Redis is unavailable, we still stream normally but explicitly signal
    // degraded mode and disable resume/buffering semantics.
    try {
      const redis = await getRedis();
      if (!redis) {
        reply.raw.setHeader(SSE_DEGRADED_HEADER_NAME, SSE_DEGRADED_REDIS_REASON);
        emit(TelemetryEvents.SseDegradedMode, {
          kind: SSE_DEGRADED_KIND_REDIS_UNAVAILABLE,
          correlation_id: correlationId,
          endpoint: "/assist/draft-graph/stream",
        });
      }
    } catch (error) {
      // Treat Redis connection errors as degraded mode as well
      reply.raw.setHeader(SSE_DEGRADED_HEADER_NAME, SSE_DEGRADED_REDIS_REASON);
      emit(TelemetryEvents.SseDegradedMode, {
        kind: SSE_DEGRADED_KIND_REDIS_UNAVAILABLE,
        correlation_id: correlationId,
        endpoint: "/assist/draft-graph/stream",
      });
      log.warn({ error, correlation_id: correlationId }, "Redis unavailable for SSE streaming - entering degraded mode");
    }

    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      log.warn({ correlation_id: correlationId, validation_error: parsed.error.flatten() }, "draft-graph stream input validation failed");
      const envelope = buildError("BAD_INPUT", "invalid input", parsed.error.flatten());
      reply.raw.setHeader("X-Correlation-ID", correlationId);
      reply.raw.writeHead(400, SSE_HEADERS);
      await writeStage(reply, { stage: "DRAFTING" });
      await writeStage(reply, { stage: "COMPLETE", payload: envelope });
      reply.raw.end();
      return reply;
    }

    const input = sanitizeDraftGraphInput(parsed.data, req.body);

    await handleSseResponse(reply, input, req.body, correlationId);
    return reply;
  });

  // v1.8: SSE Resume endpoint for reconnections
  // v1.9: Supports live mode for continued streaming
  app.post("/assist/draft-graph/resume", {
    config: {
      rateLimit: {
        max: SSE_RESUME_LIVE_RPM, // v1.9: Use live resume rate limit
        timeWindow: '1 minute'
      }
    }
  }, async (req, reply) => {
    // v1.9: Check for live mode request
    const resumeMode = (req.query as any).mode || req.headers["x-resume-mode"] || "replay";
    const requestLiveMode = resumeMode === "live";
    const liveEnabled = requestLiveMode && SSE_RESUME_LIVE_ENABLED;

    // Extract X-Resume-Token from headers
    const resumeToken = req.headers["x-resume-token"];

    if (!resumeToken || typeof resumeToken !== "string") {
      const envelope = buildError("BAD_INPUT", "Missing or invalid X-Resume-Token header");
      reply.code(400);
      return reply.send(envelope);
    }

    // Verify token (gracefully handle missing secrets)
    let verifyResult;
    try {
      verifyResult = verifyResumeToken(resumeToken);
    } catch (error) {
      // Secrets not configured, return 426 (Upgrade Required) to match streaming endpoint degradation
      log.debug({ error, token_prefix: resumeToken.substring(0, 12) }, "Resume token verification failed (secrets not configured)");
      const envelope = buildError("INTERNAL", "Resume functionality not available (secrets not configured)", {
        upgrade: "resume=unsupported",
      });
      reply.code(426);
      return reply.send(envelope);
    }

    if (!verifyResult.valid) {
      emit(TelemetryEvents.SseResumeExpired, {
        error: verifyResult.error,
      });
      const envelope = buildError("BAD_INPUT", `Invalid resume token: ${verifyResult.error}`);
      reply.code(401);
      return reply.send(envelope);
    }

    const { request_id, step, seq } = verifyResult.payload;

    emit(TelemetryEvents.SseResumeAttempt, {
      request_id,
      from_seq: seq,
      step,
    });

    // Get stream state
    const state = await getStreamState(request_id);

    // Check if resume is possible
    if (!state) {
      // Try snapshot fallback
      const snapshot = await getSnapshot(request_id);
      if (snapshot) {
        // Return snapshot as complete event via SSE with resume diagnostics
        reply.raw.setHeader("X-Correlation-ID", request_id);
        reply.raw.writeHead(200, SSE_HEADERS);

        const basePayload = snapshot.final_payload as any;
        const diagnostics = buildDiagnosticsFromPayload(basePayload, request_id, {
          resumes: 1,
          recovered_events: 0,
        });
        const payloadWithDiagnostics = withDiagnostics(basePayload, diagnostics);

        reply.raw.write(`event: complete\ndata: ${JSON.stringify(payloadWithDiagnostics)}\n\n`);
        reply.raw.end();

        emit(TelemetryEvents.SsePartialRecovery, {
          request_id,
          recovery_type: "snapshot_fallback",
        });
        return reply;
      }

      // Stream expired, return 426 Upgrade Required
      emit(TelemetryEvents.SseResumeExpired, {
        request_id,
        reason: "state_expired",
      });
      const envelope = buildError("INTERNAL", "Stream state expired, resume not available", {
        upgrade: "resume=unsupported",
      });
      reply.code(426);
      return reply.send(envelope);
    }

    // Check step compatibility
    // Treat "complete" state as compatible so we can replay buffered events
    // and then send the final snapshot, while still falling back for other
    // mismatches.
    if (state.status !== step.toLowerCase() && state.status !== "complete") {
      // If state has moved to a different step (e.g. COMPLETE) but we have a
      // snapshot, prefer snapshot-based recovery instead of hard 426 so
      // transient cleanup/Redis issues don't break resume.
      const snapshot = await getSnapshot(request_id);
      if (snapshot) {
        reply.raw.setHeader("X-Correlation-ID", request_id);
        reply.raw.writeHead(200, SSE_HEADERS);

        const basePayload = snapshot.final_payload as any;
        const diagnostics = buildDiagnosticsFromPayload(basePayload, request_id, {
          resumes: 1,
          recovered_events: 0,
        });
        const payloadWithDiagnostics = withDiagnostics(basePayload, diagnostics);

        reply.raw.write(`event: complete\ndata: ${JSON.stringify(payloadWithDiagnostics)}\n\n`);
        reply.raw.end();

        emit(TelemetryEvents.SsePartialRecovery, {
          request_id,
          recovery_type: "snapshot_step_mismatch",
        });
        return reply;
      }

      emit(TelemetryEvents.SseResumeIncompatible, {
        request_id,
        expected_step: step,
        actual_step: state.status,
      });
      const envelope = buildError("INTERNAL", `Stream state incompatible: expected ${step}, got ${state.status}`, {
        upgrade: "resume=unsupported",
      });
      reply.code(426);
      return reply.send(envelope);
    }

    // Get buffered events from seq+1
    const events = await getBufferedEvents(request_id, seq);

    // Start SSE response
    reply.raw.writeHead(200, SSE_HEADERS);
    reply.raw.setHeader("X-Correlation-ID", request_id);

    // Replay buffered events
    for (const event of events) {
      reply.raw.write(`event: ${event.type}\ndata: ${event.data}\n\n`);
    }

    emit(TelemetryEvents.SseResumeSuccess, {
      request_id,
      replayed_count: events.length,
      from_seq: seq,
      to_seq: state.last_seq,
    });

    emit(TelemetryEvents.SseResumeReplayCount, {
      request_id,
      count: events.length,
    });

    // If stream already complete, send final event and end
    if (state.status === "complete") {
      const snapshot = await getSnapshot(request_id);
      if (snapshot) {
        const basePayload = snapshot.final_payload as any;
        const diagnostics = buildDiagnosticsFromPayload(basePayload, request_id, {
          resumes: 1,
          recovered_events: events.length,
        });
        const payloadWithDiagnostics = withDiagnostics(basePayload, diagnostics);

        reply.raw.write(`event: complete\ndata: ${JSON.stringify(payloadWithDiagnostics)}\n\n`);
      }
      reply.raw.end();
      return reply;
    }

    // Otherwise, stream is still in progress
    // v1.9: Live mode continuation (if enabled)
    if (liveEnabled) {
      emit(TelemetryEvents.SseResumeLiveStart, {
        request_id,
        from_seq: state.last_seq,
      });

      let currentSeq = state.last_seq;
      let lastHeartbeat = Date.now();
      let lastSnapshotRenewal = Date.now();
      const startTime = Date.now();
      const liveTimeout = 120000; // 2 minutes
      const pollInterval = 1500; // 1.5 seconds
      const heartbeatInterval = 10000; // 10 seconds
      const snapshotRenewalInterval = 30000; // 30 seconds

      try {
        const pollForEvents = async (): Promise<boolean> => {
          // Check timeout
          if (Date.now() - startTime > liveTimeout) {
            emit(TelemetryEvents.SseResumeLiveEnd, {
              request_id,
              state: "timeout",
              duration_ms: Date.now() - startTime,
            });
            return false; // Stop polling
          }

          // Get latest state
          const latestState = await getStreamState(request_id);
          if (!latestState) {
            emit(TelemetryEvents.SseResumeLiveEnd, {
              request_id,
              state: "expired",
              duration_ms: Date.now() - startTime,
            });
            return false; // Stop polling
          }

          // Check for new events
          if (latestState.last_seq > currentSeq) {
            const newEvents = await getBufferedEvents(request_id, currentSeq);
            for (const event of newEvents) {
              reply.raw.write(`event: ${event.type}\ndata: ${event.data}\n\n`);
            }
            currentSeq = latestState.last_seq;

            emit(TelemetryEvents.SseResumeLiveContinue, {
              request_id,
              new_events: newEvents.length,
              current_seq: currentSeq,
            });
          }

          // Send heartbeat if needed
          const now = Date.now();
          if (now - lastHeartbeat > heartbeatInterval) {
            reply.raw.write(`: heartbeat\n\n`);
            lastHeartbeat = now;
          }

          // Renew snapshot if needed
          if (now - lastSnapshotRenewal > snapshotRenewalInterval) {
            await renewSnapshot(request_id);
            lastSnapshotRenewal = now;
          }

          // Check if stream completed
          if (latestState.status === "complete") {
            const snapshot = await getSnapshot(request_id);
            if (snapshot) {
              reply.raw.write(`event: complete\ndata: ${JSON.stringify(snapshot.final_payload)}\n\n`);
            }
            emit(TelemetryEvents.SseResumeLiveEnd, {
              request_id,
              state: "complete",
              duration_ms: Date.now() - startTime,
            });
            return false; // Stop polling
          }

          if (latestState.status === "error") {
            emit(TelemetryEvents.SseResumeLiveEnd, {
              request_id,
              state: "error",
              duration_ms: Date.now() - startTime,
            });
            return false; // Stop polling
          }

          return true; // Continue polling
        };

        // Poll until stream completes or timeout
        let shouldContinue = true;
        while (shouldContinue) {
          shouldContinue = await pollForEvents();
          if (shouldContinue) {
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
        }
      } catch (error) {
        log.error({ error, request_id }, "Error during live resume continuation");
        emit(TelemetryEvents.SseResumeLiveEnd, {
          request_id,
          state: "error",
          duration_ms: Date.now() - startTime,
          error: String(error),
        });
      } finally {
        reply.raw.end();
      }

      return reply;
    }

    // Replay-only mode (default): send heartbeat and close
    reply.raw.write(`: heartbeat\n\n`);
    reply.raw.end();

    return reply;
  });

  // Main endpoint with backward compatibility (supports both SSE and JSON)
  // DEPRECATED: SSE access via Accept: text/event-stream header uses global 120 RPM limit
  // For production SSE streaming, use dedicated /assist/draft-graph/stream endpoint (20 RPM limit)
  app.post("/assist/draft-graph", async (req, reply) => {
    // V04: Generate correlation ID for request traceability
    const correlationId = randomUUID();

    const wantsSse = req.headers.accept?.includes(EVENT_STREAM) ?? false;

    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      const envelope = buildError("BAD_INPUT", "invalid input", parsed.error.flatten());
      if (wantsSse) {
        reply.raw.setHeader("X-Correlation-ID", correlationId);
        reply.raw.writeHead(400, SSE_HEADERS);
        await writeStage(reply, { stage: "DRAFTING" });
        await writeStage(reply, { stage: "COMPLETE", payload: envelope });
        reply.raw.end();
        return reply;
      }
      reply.header("X-Correlation-ID", correlationId);
      reply.code(400);
      return reply.send(envelope);
    }

    const input = sanitizeDraftGraphInput(parsed.data);

    if (wantsSse) {
      // v1.3.0: Legacy SSE path disabled by default
      if (!isLegacySSEEnabled()) {
        log.info({
          legacy_sse_disabled: true,
          endpoint: '/assist/draft-graph',
          recommended_endpoint: '/assist/draft-graph/stream',
        }, "Legacy SSE path disabled - use /stream endpoint");

        const envelope = buildError(
          "BAD_INPUT",
          "Legacy SSE path disabled. Use POST /assist/draft-graph/stream instead.",
          {
            migration_guide: "Replace Accept: text/event-stream with POST to /assist/draft-graph/stream",
            recommended_endpoint: "/assist/draft-graph/stream",
          }
        );

        return reply.code(426).send(envelope); // 426 Upgrade Required
      }

      // DEPRECATED: Legacy SSE via Accept header - emit warning for observability
      // Sample detailed logs (10% of occurrences) to reduce noise
      if (Math.random() < 0.1) {
        log.warn(
          {
            legacy_sse_path: true,
            endpoint: '/assist/draft-graph',
            deprecation: true,
            recommended_endpoint: '/assist/draft-graph/stream',
            sampled: true,
          },
          "Legacy SSE path used (Accept: text/event-stream header) - client should migrate to /stream endpoint (sampled log)"
        );
      }

      // Always emit telemetry event for aggregation (100% of occurrences)
      emit(TelemetryEvents.LegacySSEPath, {
        endpoint: '/assist/draft-graph',
        legacy_sse_path: true,
      });

      await handleSseResponse(reply, input, req.body, correlationId);
      return reply;
    }

    // JSON response
    try {
      await handleJsonResponse(reply, input, req.body, correlationId);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      log.error({ err }, "draft graph route failure");
      const envelope = buildError("INTERNAL", err.message || "internal");
      reply.code(500);
      return reply.send(envelope);
    }

    return reply;
  });
}
