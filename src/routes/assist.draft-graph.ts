import { Buffer } from "node:buffer";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getRequestId } from "../utils/request-id.js";
import { DraftGraphInput, DraftGraphOutput, ErrorV1, type DraftGraphInputT } from "../schemas/assist.js";
import { calcConfidence, shouldClarify } from "../utils/confidence.js";
import { estimateTokens, allowedCostUSD } from "../utils/costGuard.js";
import { type DocPreview } from "../services/docProcessing.js";
import { processAttachments, type AttachmentInput, type GroundingStats } from "../grounding/process-attachments.js";
import { getAdapter } from "../adapters/llm/router.js";
import { validateGraph } from "../services/validateClientWithCache.js";
import { coerceViolations } from "../cee/unified-pipeline/stages/repair/plot-validation.js";
import { simpleRepair } from "../services/repair.js";
import { stabiliseGraph, ensureDagAndPrune } from "../orchestrator/index.js";
import { validateAndFixGraph } from "../cee/structure/index.js";
import { enrichGraphWithFactorsAsync } from "../cee/factor-extraction/enricher.js";
import { createCorrectionCollector } from "../cee/corrections.js";
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
import { HTTP_CLIENT_TIMEOUT_MS, getJitteredRetryDelayMs, FIXTURE_TIMEOUT_MS, DRAFT_BUDGET_MS, REPAIR_TIMEOUT_MS, DRAFT_REQUEST_BUDGET_MS, DRAFT_LLM_TIMEOUT_MS, LLM_POST_PROCESSING_HEADROOM_MS, SSE_HEARTBEAT_INTERVAL_MS, SSE_RESUME_LIVE_TIMEOUT_MS, SSE_RESUME_POLL_INTERVAL_MS, SSE_RESUME_SNAPSHOT_RENEWAL_MS, SSE_WRITE_TIMEOUT_MS } from "../config/timeouts.js";
import { LLMTimeoutError, RequestBudgetExceededError, ClientDisconnectError } from "../adapters/llm/errors.js";
import type { DraftGraphResult } from "../adapters/llm/types.js";
import { config, shouldUseStagingPrompts } from "../config/index.js";
import { captureCheckpoint, assembleCeeProvenance, applyCheckpointSizeGuard, type PipelineCheckpoint } from "../cee/pipeline-checkpoints.js";
import { getModelConfig, getClientAllowedModels } from "../config/models.js";
import { getSystemPromptMeta } from "../adapters/llm/prompt-loader.js";
import {
  validateAndRepairGraph,
  GraphValidationError,
  type RepairOnlyAdapter,
} from "../cee/graph-orchestrator.js";
import { reconcileStructuralTruth } from "../validators/structural-reconciliation.js";
import {
  extractCompoundGoals,
  toGoalConstraints,
  remapConstraintTargets,
} from "../cee/compound-goal/index.js";

const EVENT_STREAM = "text/event-stream";
const STAGE_EVENT = "stage";
const SSE_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache"
} as const;

// All timeout constants are imported from config/timeouts.ts (env-var controlled):
// FIXTURE_TIMEOUT_MS, DRAFT_BUDGET_MS, REPAIR_TIMEOUT_MS, SSE_HEARTBEAT_INTERVAL_MS

function getDraftBudgetMs(): number {
  return DRAFT_BUDGET_MS;
}

function getRepairTimeoutMs(): number {
  return REPAIR_TIMEOUT_MS;
}

/**
 * Preserve category field from original nodes when using engine's normalized graph.
 * The external PLoT engine's /v1/validate may not include the category field in its
 * normalized response, so we merge it back from the original nodes.
 */
function preserveCategoryFromOriginal(normalized: GraphT, original: GraphT): GraphT {
  const categoryMap = new Map(original.nodes.map(n => [n.id, n.category]));
  // Label-based fallback for nodes whose IDs changed during normalization.
  // Only use labels that are unique in the original graph to avoid misassignment.
  const labelCounts = new Map<string, number>();
  for (const n of original.nodes) {
    if (n.label) {
      const key = n.label.toLowerCase();
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
  }
  const labelCategoryMap = new Map(
    original.nodes
      .filter(n => n.category && n.label && labelCounts.get(n.label.toLowerCase()) === 1)
      .map(n => [n.label!.toLowerCase(), n.category!])
  );

  const nodesWithCategory = normalized.nodes.map(n => {
    const fromId = categoryMap.get(n.id);
    if (fromId !== undefined) return { ...n, category: fromId };
    // Fallback: match by label if ID changed
    const fromLabel = n.label ? labelCategoryMap.get(n.label.toLowerCase()) : undefined;
    if (fromLabel !== undefined) return { ...n, category: fromLabel };
    // Keep whatever category the node already has
    return n;
  });
  return { ...normalized, nodes: nodesWithCategory };
}

/**
 * Canonical V4 edge fields that the external validation engine may strip.
 * Legacy aliases (weight, belief) are intentionally excluded — they are
 * derived at the V3 transform layer and must not be back-filled here.
 */
export const V4_EDGE_FIELDS = [
  "strength_mean",
  "strength_std",
  "belief_exists",
  "effect_direction",
  "provenance",
  "provenance_source",
] as const;

/**
 * Restore canonical V4 edge fields that the external PLoT engine's /v1/validate
 * may strip from its normalized response.
 *
 * Rules (per addendum):
 *  1. Only restore the V4 canonical set — never legacy weight/belief.
 *  2. Only restore for edges present in BOTH graphs (keyed by from::to).
 *     Edges the engine added are left untouched.
 *  3. If the normalized edge already has a defined value for a field, keep it.
 *  4. Log duplicate edge keys as a uniqueness guard.
 *  5. Log edges removed and edges added by the engine.
 */
export function preserveEdgeFieldsFromOriginal(
  normalized: GraphT,
  original: GraphT,
): GraphT {
  // Build lookup from original edges keyed by from::to
  const originalEdgeMap = new Map<string, (typeof original.edges)[number]>();
  const duplicateKeys: string[] = [];
  for (const edge of original.edges) {
    const key = `${edge.from}::${edge.to}`;
    if (originalEdgeMap.has(key)) {
      duplicateKeys.push(key);
    }
    originalEdgeMap.set(key, edge);
  }

  if (duplicateKeys.length > 0) {
    log.warn(
      { event: "PRESERVE_EDGE_FIELDS_DUPLICATE_KEYS", keys: duplicateKeys },
      `Original graph has ${duplicateKeys.length} duplicate edge key(s)`,
    );
  }

  // Detect edges removed/added by the engine (observability)
  const normalizedKeySet = new Set(
    normalized.edges.map((e) => `${e.from}::${e.to}`),
  );
  const originalKeySet = new Set(originalEdgeMap.keys());

  const removedByEngine = [...originalKeySet].filter(
    (k) => !normalizedKeySet.has(k),
  );
  const addedByEngine = [...normalizedKeySet].filter(
    (k) => !originalKeySet.has(k),
  );

  if (removedByEngine.length > 0 || addedByEngine.length > 0) {
    log.info(
      {
        event: "PRESERVE_EDGE_FIELDS_ENGINE_DIFF",
        removed_count: removedByEngine.length,
        added_count: addedByEngine.length,
        removed: removedByEngine.slice(0, 10),
        added: addedByEngine.slice(0, 10),
      },
      "Engine modified edge set during normalization",
    );
  }

  let restoredCount = 0;
  let keptNormalisedCount = 0;
  let noMatchCount = 0;
  const restoredSamples: string[] = [];

  const edgesWithFields = normalized.edges.map((normEdge) => {
    const key = `${normEdge.from}::${normEdge.to}`;
    const origEdge = originalEdgeMap.get(key);

    // Only restore for edges that existed in the original graph
    if (!origEdge) {
      noMatchCount++;
      // Diagnostic: per-edge log
      log.info({
        event: "PRESERVE_EDGE_FIELDS_DIAGNOSTIC",
        edge_key: key,
        original: null,
        normalised: {
          strength_mean: normEdge.strength_mean,
          strength_std: normEdge.strength_std,
          belief_exists: normEdge.belief_exists,
        },
        action: "no_original_match",
      }, `Edge ${key}: no original match`);
      return normEdge;
    }

    let didRestore = false;
    const patched = { ...normEdge } as Record<string, unknown>;

    for (const field of V4_EDGE_FIELDS) {
      // Only restore if the normalized edge is missing the field
      if (patched[field] !== undefined) continue;
      const origValue = (origEdge as Record<string, unknown>)[field];
      if (origValue !== undefined) {
        patched[field] = origValue;
        didRestore = true;
      }
    }

    // Diagnostic: per-edge log with full before/after visibility
    const action = didRestore ? "restored" : "kept_normalised";
    log.info({
      event: "PRESERVE_EDGE_FIELDS_DIAGNOSTIC",
      edge_key: key,
      original: {
        strength_mean: origEdge.strength_mean,
        strength_std: origEdge.strength_std,
        belief_exists: origEdge.belief_exists,
      },
      normalised: {
        strength_mean: normEdge.strength_mean,
        strength_std: normEdge.strength_std,
        belief_exists: normEdge.belief_exists,
      },
      action,
    }, `Edge ${key}: ${action}`);

    if (didRestore) {
      restoredCount++;
      if (restoredSamples.length < 5) {
        restoredSamples.push(key);
      }
    } else {
      keptNormalisedCount++;
    }

    return patched as (typeof normalized.edges)[number];
  });

  // Diagnostic: summary log
  log.info(
    {
      event: "PRESERVE_EDGE_FIELDS_SUMMARY",
      total_edges: normalized.edges.length,
      restored_count: restoredCount,
      kept_normalised_count: keptNormalisedCount,
      no_match_count: noMatchCount,
      samples: restoredSamples,
    },
    `Edge field preservation: ${restoredCount} restored, ${keptNormalisedCount} kept normalised, ${noMatchCount} no match (${normalized.edges.length} total)`,
  );

  return { ...normalized, edges: edgesWithFields };
}

/**
 * Chain both field-preservation functions: node category + edge V4 fields.
 * Drop-in replacement for the previous preserveCategoryFromOriginal calls.
 */
export function preserveFieldsFromOriginal(
  normalized: GraphT,
  original: GraphT,
): GraphT {
  const withCategory = preserveCategoryFromOriginal(normalized, original);
  return preserveEdgeFieldsFromOriginal(withCategory, original);
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

export function buildRefinementBrief(
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
    raw_output,
    model,
    repair_model,
    bias_model,
    enrichment_model,
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
    raw_output,
    model,
    repair_model,
    bias_model,
    enrichment_model,
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
      llm_meta?: DraftGraphResult["meta"];
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
    }, SSE_WRITE_TIMEOUT_MS);

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
export async function groundAttachments(
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

export interface PipelineOpts {
  /** Force refresh prompts from Supabase (bypass cache) - ?supa=1 URL param */
  refreshPrompts?: boolean;
  /** Force use of hardcoded default prompt (skip store lookup) - ?default=1 URL param */
  forceDefault?: boolean;
  /** AbortSignal for client disconnect / budget cancellation */
  signal?: AbortSignal;
  /** Request start timestamp for budget tracking */
  requestStartMs?: number;
}


/**
 * Legacy Pipeline A entry point — ARCHIVED.
 *
 * This function previously contained ~1,650 lines of the original draft-graph
 * pipeline (Pipeline A). It has been replaced by the unified 6-stage pipeline
 * (`runUnifiedPipeline`). The function signature is preserved for
 * type-compatibility with any remaining imports.
 */
export async function runDraftGraphPipeline(_input: DraftGraphInputT, _rawBody: unknown, _correlationId: string, _pipelineOpts?: PipelineOpts): Promise<PipelineResult> {
  throw new Error("Pipeline A has been removed. Use the unified pipeline (runUnifiedPipeline) instead.");
}

/**
 * Legacy route registration — ARCHIVED.
 *
 * These routes (/assist/draft-graph, /assist/draft-graph/stream,
 * /assist/draft-graph/resume) have been superseded by the v1 endpoints
 * (/assist/v1/draft-graph). They are kept as stubs returning 410 Gone
 * to provide a clear migration signal to any remaining consumers.
 */
export default async function route(app: FastifyInstance) {
  const goneResponse = {
    schema: "error.v1",
    code: "GONE",
    message: "This endpoint has been removed. Use /assist/v1/draft-graph instead.",
  };

  app.post("/assist/draft-graph/stream", async (_req, reply) => {
    return reply.code(410).send(goneResponse);
  });

  app.post("/assist/draft-graph/resume", async (_req, reply) => {
    return reply.code(410).send(goneResponse);
  });

  app.post("/assist/draft-graph", async (_req, reply) => {
    return reply.code(410).send(goneResponse);
  });
}
