import { env } from "node:process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { DraftGraphInput, DraftGraphOutput, ErrorV1, type DraftGraphInputT } from "../schemas/assist.js";
import { calcConfidence, shouldClarify } from "../utils/confidence.js";
import { estimateTokens, allowedCostUSD } from "../utils/costGuard.js";
import { type DocPreview } from "../services/docProcessing.js";
import { processAttachments, type AttachmentInput, type GroundingStats } from "../grounding/process-attachments.js";
import { getAdapter } from "../adapters/llm/router.js";
import { validateGraph } from "../services/validateClient.js";
import { simpleRepair } from "../services/repair.js";
import { stabiliseGraph, ensureDagAndPrune } from "../orchestrator/index.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";
import { hasLegacyProvenance } from "../schemas/graph.js";
import { fixtureGraph } from "../utils/fixtures.js";
import type { GraphT } from "../schemas/graph.js";
import { validateResponse } from "../utils/responseGuards.js";
import { enforceStableEdgeIds } from "../utils/graph-determinism.js";
import { isFeatureEnabled } from "../utils/feature-flags.js";

const EVENT_STREAM = "text/event-stream";
const STAGE_EVENT = "stage";
const SSE_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache"
} as const;

const FIXTURE_TIMEOUT_MS = 2500; // Show fixture if draft takes longer than 2.5s
const DEPRECATION_SUNSET = env.DEPRECATION_SUNSET || "2025-12-01"; // Configurable sunset date
const COST_MAX_USD = Number(env.COST_MAX_USD) || 1.0;
// v1.3.0: Legacy SSE flag (read at request time for testability)
// Use process.env directly to avoid module-level caching issues in tests
function isLegacySSEEnabled(): boolean {
  return process.env.ENABLE_LEGACY_SSE === "true";
}
const defaultPatch = { adds: { nodes: [], edges: [] }, updates: [], removes: [] } as const;

type SuccessPayload = ReturnType<typeof DraftGraphOutput.parse>;
type ErrorEnvelope = ReturnType<typeof ErrorV1.parse>;

type StageEvent =
  | { stage: "DRAFTING"; payload?: SuccessPayload }
  | { stage: "COMPLETE"; payload: SuccessPayload | ErrorEnvelope };

type AttachmentPayload = string | { data: string; encoding?: BufferEncoding };

type PipelineResult =
  | { kind: "success"; payload: SuccessPayload; hasLegacyProvenance?: boolean; cost_usd: number; provider: string; model: string }
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
 */
function writeStage(reply: FastifyReply, event: StageEvent) {
  reply.raw.write(`event: ${STAGE_EVENT}\n`);

  // RFC 8895: split JSON on newlines and prefix each line with "data: "
  const jsonStr = JSON.stringify(event);
  const lines = jsonStr.split('\n');
  for (const line of lines) {
    reply.raw.write(`data: ${line}\n`);
  }

  // Blank line terminates event
  reply.raw.write('\n');
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
      : Buffer.from(payload.data, payload.encoding ?? "base64");

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

async function runDraftGraphPipeline(input: DraftGraphInputT, rawBody: unknown, correlationId: string): Promise<PipelineResult> {
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
  const clarifier = determineClarifier(confidence);

  // Get adapter via router (env-driven or config-based provider selection)
  const draftAdapter = getAdapter('draft_graph');

  // Cost guard: check estimated cost before making LLM call
  const promptChars = input.brief.length + docs.reduce((acc, doc) => acc + doc.preview.length, 0);
  const tokensIn = estimateTokens(promptChars);
  const tokensOut = estimateTokens(1200);

  if (!allowedCostUSD(tokensIn, tokensOut, draftAdapter.model)) {
    return { kind: "error", statusCode: 429, envelope: buildError("RATE_LIMITED", "cost guard exceeded") };
  }

  const llmStartTime = Date.now();
  emit(TelemetryEvents.Stage, { stage: "llm_start", confidence, tokensIn, provider: draftAdapter.name, correlation_id: correlationId });

  // V04: Telemetry for upstream calls
  let draftResult;
  let upstreamStatusCode = 200; // Default to success
  try {
    draftResult = await draftAdapter.draftGraph(
      { brief: input.brief, docs, seed: 17 },
      { requestId: `draft_${Date.now()}`, timeoutMs: 15000 }
    );
  } catch (error) {
    const llmDuration = Date.now() - llmStartTime;
    // Determine status code from error (timeout vs other failures)
    upstreamStatusCode = error instanceof Error && error.name === "UpstreamTimeoutError" ? 504 : 500;
    emit(TelemetryEvents.DraftUpstreamError, {
      status_code: upstreamStatusCode,
      latency_ms: llmDuration,
      provider: draftAdapter.name,
      correlation_id: correlationId,
    });
    throw error; // Re-throw to let outer handler deal with it
  }

  const { graph, rationales, usage: draftUsage } = draftResult;
  const llmDuration = Date.now() - llmStartTime;

  // V04: Emit upstream telemetry for successful calls
  emit(TelemetryEvents.DraftUpstreamSuccess, {
    status_code: upstreamStatusCode,
    latency_ms: llmDuration,
    provider: draftAdapter.name,
    correlation_id: correlationId,
  });
  emit(TelemetryEvents.Stage, { stage: "llm_complete", nodes: graph.nodes.length, edges: graph.edges.length, duration_ms: llmDuration });

  // Calculate draft cost immediately (provider-specific pricing)
  const draftCost = calculateCost(draftAdapter.model, draftUsage.input_tokens, draftUsage.output_tokens);

  // Track cache hits across draft and repair
  let totalCacheReadTokens = draftUsage.cache_read_input_tokens || 0;

  // Track repair costs separately (may use different provider)
  let repairCost = 0;
  let repairProviderName: string | null = null;
  let repairModelName: string | null = null;

  let candidate = stabiliseGraph(ensureDagAndPrune(graph));
  let issues: string[] | undefined;
  let repairFallbackReason: string | null = null;

  const first = await validateGraph(candidate);
  if (!first.ok) {
    issues = first.violations;

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
        { requestId: `repair_${Date.now()}`, timeoutMs: 10000 }
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
        candidate = stabiliseGraph(ensureDagAndPrune(simpleRepair(repaired)));
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

      const repaired = stabiliseGraph(ensureDagAndPrune(simpleRepair(candidate)));
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
  } else if (first.normalized) {
    candidate = stabiliseGraph(ensureDagAndPrune(first.normalized));
  }

  // Enforce stable edge IDs and deterministic sorting (v04 determinism hardening)
  candidate = enforceStableEdgeIds(candidate);

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

  return {
    kind: "success",
    payload,
    hasLegacyProvenance: legacy.hasLegacy,
    cost_usd: totalCost,
    provider: draftAdapter.name,
    model: draftAdapter.model,
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

  // V04: Echo correlation ID in response header
  reply.raw.setHeader("X-Correlation-ID", correlationId);
  reply.raw.writeHead(200, SSE_HEADERS);
  writeStage(reply, { stage: "DRAFTING" });
  emit(TelemetryEvents.SSEStarted, { correlation_id: correlationId });

  // V04: SSE heartbeats every 10s to prevent proxy idle timeouts
  // Send SSE comment lines that keep connection alive but don't affect client state
  const heartbeatInterval = setInterval(() => {
    try {
      reply.raw.write(': heartbeat\n\n');
    } catch (err) {
      log.warn({ err }, "Heartbeat write failed (client may have disconnected)");
      clearInterval(heartbeatInterval);
    }
  }, 10000); // 10s

  try {

    // SSE with fixture fallback: show fixture if draft takes > 2.5s
    const fixtureTimeout = setTimeout(() => {
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
        writeStage(reply, { stage: "DRAFTING", payload: fixturePayload });
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
      writeStage(reply, { stage: "COMPLETE", payload: result.envelope });
      emit(TelemetryEvents.SSEError, {
        stream_duration_ms: streamDuration,
        error: result.envelope.message,
        error_code: result.envelope.code,
        status_code: result.statusCode,
        fixture_shown: fixtureSent,
        correlation_id: correlationId,
        sse_end_state: sseEndState,
      });
      clearInterval(heartbeatInterval);
      reply.raw.end();
      return;
    }

    // Post-response guard: validate graph caps and cost (JSON↔SSE parity requirement)
    const guardResult = validateResponse(result.payload.graph, result.cost_usd, COST_MAX_USD);
    if (!guardResult.ok) {
      sseEndState = "error"; // V04: Track SSE end state
      const guardError = buildError("BAD_INPUT", guardResult.violation.message, guardResult.violation.details);
      writeStage(reply, { stage: "COMPLETE", payload: guardError });
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
      clearInterval(heartbeatInterval);
      reply.raw.end();
      return;
    }

    // Add deprecation headers if legacy string provenance detected
    if (result.hasLegacyProvenance) {
      reply.raw.setHeader("X-Deprecated-Provenance-Format", "true");
      reply.raw.setHeader("X-Deprecation-Sunset", DEPRECATION_SUNSET);
      reply.raw.setHeader("X-Deprecation-Link", "https://docs.olumi.ai/provenance-migration");
    }

    // Success - extract quality metrics for telemetry (with provider and cost - parity requirement)
    const confidence = result.payload.confidence ?? 0;
    const qualityTier = confidence >= 0.9 ? "high" : confidence >= 0.7 ? "medium" : "low";
    const hasIssues = (result.payload.issues?.length ?? 0) > 0;

    sseEndState = "complete"; // V04: Track SSE end state - successful completion
    writeStage(reply, { stage: "COMPLETE", payload: result.payload });
    emit(TelemetryEvents.SSECompleted, {
      stream_duration_ms: streamDuration,
      fixture_shown: fixtureSent,
      quality_tier: qualityTier,
      has_issues: hasIssues,
      confidence,
      provider: result.provider || "unknown",  // Fallback for parity
      cost_usd: result.cost_usd ?? 0,          // Fallback for parity
      model: result.model,
      correlation_id: correlationId,
      sse_end_state: sseEndState,
    });
    clearInterval(heartbeatInterval);
    reply.raw.end();
  } catch (error: unknown) {
    clearInterval(heartbeatInterval);
    const err = error instanceof Error ? error : new Error("unexpected error");
    sseEndState = err.name === "AbortError" ? "timeout" : "error"; // V04: Track SSE end state
    log.error({ err, correlation_id: correlationId }, "SSE draft graph failure");
    const envelope = buildError("INTERNAL", err.message || "internal");
    writeStage(reply, { stage: "COMPLETE", payload: envelope });
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
  const guardResult = validateResponse(result.payload.graph, result.cost_usd, COST_MAX_USD);
  if (!guardResult.ok) {
    const guardError = buildError("BAD_INPUT", guardResult.violation.message, guardResult.violation.details);
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
    reply.header("X-Deprecation-Sunset", DEPRECATION_SUNSET);
    reply.header("X-Deprecation-Link", "https://docs.olumi.ai/provenance-migration");
  }

  // Success
  reply.code(200);
  return reply.send(result.payload);
}

export default async function route(app: FastifyInstance) {
  // SSE-specific rate limit (lower than global due to long-running connections)
  const SSE_RATE_LIMIT_RPM = Number(env.SSE_RATE_LIMIT_RPM) || 20;

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

    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      const envelope = buildError("BAD_INPUT", "invalid input", parsed.error.flatten());
      reply.raw.setHeader("X-Correlation-ID", correlationId);
      reply.raw.writeHead(400, SSE_HEADERS);
      writeStage(reply, { stage: "DRAFTING" });
      writeStage(reply, { stage: "COMPLETE", payload: envelope });
      reply.raw.end();
      return reply;
    }

    await handleSseResponse(reply, parsed.data, req.body, correlationId);
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
        writeStage(reply, { stage: "DRAFTING" });
        writeStage(reply, { stage: "COMPLETE", payload: envelope });
        reply.raw.end();
        return reply;
      }
      reply.header("X-Correlation-ID", correlationId);
      reply.code(400);
      return reply.send(envelope);
    }

    if (wantsSse) {
      // v1.3.0: Legacy SSE path disabled by default
      if (!isLegacySSEEnabled()) {
        log.info({
          legacy_sse_disabled: true,
          endpoint: '/assist/draft-graph',
          recommended_endpoint: '/assist/draft-graph/stream',
          correlation_id: correlationId,
        }, "Legacy SSE path disabled - use /stream endpoint");

        const envelope = buildError(
          "BAD_INPUT",
          "Legacy SSE path disabled. Use POST /assist/draft-graph/stream instead.",
          {
            migration_guide: "Replace Accept: text/event-stream with POST to /assist/draft-graph/stream",
            recommended_endpoint: "/assist/draft-graph/stream",
          }
        );

        reply.header("X-Correlation-ID", correlationId);
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
            correlation_id: correlationId,
          },
          "Legacy SSE path used (Accept: text/event-stream header) - client should migrate to /stream endpoint (sampled log)"
        );
      }

      // Always emit telemetry event for aggregation (100% of occurrences)
      emit(TelemetryEvents.LegacySSEPath, {
        endpoint: '/assist/draft-graph',
        legacy_sse_path: true,
        correlation_id: correlationId,
      });

      await handleSseResponse(reply, parsed.data, req.body, correlationId);
      return reply;
    }

    // JSON response
    try {
      await handleJsonResponse(reply, parsed.data, req.body, correlationId);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      log.error({ err, correlation_id: correlationId }, "draft graph route failure");
      const envelope = buildError("INTERNAL", err.message || "internal");
      reply.code(500);
      return reply.send(envelope);
    }

    return reply;
  });
}
