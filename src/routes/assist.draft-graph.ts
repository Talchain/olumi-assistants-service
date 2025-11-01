import { env } from "node:process";
import { Buffer } from "node:buffer";
import type { FastifyInstance, FastifyReply } from "fastify";
import { DraftGraphInput, DraftGraphOutput, ErrorV1, type DraftGraphInputT } from "../schemas/assist.js";
import { calcConfidence, shouldClarify } from "../utils/confidence.js";
import { estimateTokens, allowedCostUSD } from "../utils/costGuard.js";
import { toPreview, type DocPreview } from "../services/docProcessing.js";
import { draftGraphWithAnthropic, repairGraphWithAnthropic } from "../adapters/llm/anthropic.js";
import { validateGraph } from "../services/validateClient.js";
import { simpleRepair } from "../services/repair.js";
import { stabiliseGraph, ensureDagAndPrune } from "../orchestrator/index.js";
import { emit, log } from "../utils/telemetry.js";
import { hasLegacyProvenance } from "../schemas/graph.js";
import { fixtureGraph } from "../utils/fixtures.js";
import type { GraphT } from "../schemas/graph.js";

const EVENT_STREAM = "text/event-stream";
const STAGE_EVENT = "stage";
const SSE_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache"
} as const;

const FIXTURE_TIMEOUT_MS = 2500; // Show fixture if draft takes longer than 2.5s
const DEPRECATION_SUNSET = env.DEPRECATION_SUNSET || "2025-12-01"; // Configurable sunset date
const defaultPatch = { adds: { nodes: [], edges: [] }, updates: [], removes: [] } as const;

type SuccessPayload = ReturnType<typeof DraftGraphOutput.parse>;
type ErrorEnvelope = ReturnType<typeof ErrorV1.parse>;

type StageEvent =
  | { stage: "DRAFTING"; payload?: SuccessPayload }
  | { stage: "COMPLETE"; payload: SuccessPayload | ErrorEnvelope };

type AttachmentPayload = string | { data: string; encoding?: BufferEncoding };

type PipelineResult =
  | { kind: "success"; payload: SuccessPayload; hasLegacyProvenance?: boolean }
  | { kind: "error"; statusCode: number; envelope: ErrorEnvelope };

function buildError(code: "BAD_INPUT" | "RATE_LIMITED" | "INTERNAL", message: string, details?: unknown): ErrorEnvelope {
  return ErrorV1.parse({ schema: "error.v1", code, message, details });
}

function determineClarifier(confidence: number): "complete" | "max_rounds" | "confident" {
  if (confidence >= 0.9) return "confident";
  return shouldClarify(confidence, 0) ? "max_rounds" : "complete";
}

function writeStage(reply: FastifyReply, event: StageEvent) {
  reply.raw.write(`event: ${STAGE_EVENT}\n`);
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function previewAttachments(input: DraftGraphInputT, rawBody: unknown): Promise<DocPreview[]> {
  if (!input.attachments?.length) return [];

  const previews: DocPreview[] = [];
  const payloads = (rawBody as { attachment_payloads?: Record<string, AttachmentPayload> })?.attachment_payloads ?? {};

  for (const attachment of input.attachments) {
    const payload = payloads[attachment.id];
    if (!payload) {
      log.warn({ attachment: attachment.id }, "attachment payload missing");
      continue;
    }

    try {
      const buffer =
        typeof payload === "string"
          ? Buffer.from(payload, "base64")
          : Buffer.from(payload.data, payload.encoding ?? "base64");
      previews.push(await toPreview(attachment.kind, attachment.name, buffer));
    } catch (error) {
      log.error({ attachment: attachment.id, error }, "failed to preview attachment");
    }
  }

  return previews;
}

async function runDraftGraphPipeline(input: DraftGraphInputT, rawBody: unknown): Promise<PipelineResult> {
  const docs = await previewAttachments(input, rawBody);
  const confidence = calcConfidence({ goal: input.brief });
  const clarifier = determineClarifier(confidence);

  const promptChars = input.brief.length + docs.reduce((acc, doc) => acc + doc.preview.length, 0);
  const tokensIn = estimateTokens(promptChars);
  const tokensOut = estimateTokens(1200);

  if (!allowedCostUSD(tokensIn, tokensOut)) {
    return { kind: "error", statusCode: 429, envelope: buildError("RATE_LIMITED", "cost guard exceeded") };
  }

  const llmStartTime = Date.now();
  emit("assist.draft.stage", { stage: "llm_start", confidence, tokensIn });
  const { graph, rationales } = await draftGraphWithAnthropic({ brief: input.brief, docs, seed: 17 });
  const llmDuration = Date.now() - llmStartTime;
  emit("assist.draft.stage", { stage: "llm_complete", nodes: graph.nodes.length, edges: graph.edges.length, duration_ms: llmDuration });

  let candidate = stabiliseGraph(ensureDagAndPrune(graph));
  let issues: string[] | undefined;

  const first = await validateGraph(candidate);
  if (!first.ok) {
    issues = first.violations;

    // LLM-guided repair: use violations as hints
    try {
      emit("assist.draft.repair_start", { violation_count: issues?.length ?? 0 });
      const repairResult = await repairGraphWithAnthropic({
        graph: candidate,
        violations: issues || [],
      });

      // Wrap DAG operations in try/catch to guarantee fallback on malformed output
      let repaired: GraphT;
      try {
        repaired = stabiliseGraph(ensureDagAndPrune(repairResult.graph));
      } catch (dagError) {
        log.warn({ error: dagError }, "Repaired graph failed DAG validation, using simple repair");
        throw dagError; // Re-throw to trigger outer catch fallback
      }

      // Re-validate repaired graph
      const second = await validateGraph(repaired);
      if (second.ok && second.normalized) {
        candidate = stabiliseGraph(ensureDagAndPrune(second.normalized));
        issues = second.violations;
        emit("assist.draft.repair_success", { repair_worked: true });
      } else {
        // Repair didn't fix all issues, fallback to simple repair
        candidate = stabiliseGraph(ensureDagAndPrune(simpleRepair(repaired)));
        issues = second.violations ?? issues;
        emit("assist.draft.repair_partial", { repair_worked: false });
      }
    } catch (error) {
      // LLM repair failed (API error, schema validation, or DAG error), fallback to simple repair
      log.warn({ error }, "LLM repair failed, falling back to simple repair");
      const repaired = stabiliseGraph(ensureDagAndPrune(simpleRepair(candidate)));
      const second = await validateGraph(repaired);
      if (second.ok && second.normalized) {
        candidate = stabiliseGraph(ensureDagAndPrune(second.normalized));
        issues = second.violations;
      } else {
        candidate = repaired;
        issues = second.violations ?? issues;
      }
      emit("assist.draft.repair_fallback", { fallback: "simple_repair" });
    }
  } else if (first.normalized) {
    candidate = stabiliseGraph(ensureDagAndPrune(first.normalized));
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
    log.warn(
      {
        legacy_provenance_count: legacy.count,
        total_edges: candidate.edges.length,
        deprecation: true
      },
      "Legacy string provenance detected - will be removed in future version"
    );
  }

  // Determine quality tier and fallback reason
  const qualityTier = confidence >= 0.9 ? "high" : confidence >= 0.7 ? "medium" : "low";
  const fallbackReason = issues?.length
    ? first.ok
      ? null
      : "validation_failed"
    : null;

  emit("assist.draft.completed", {
    confidence,
    issues: issues?.length ?? 0,
    quality_tier: qualityTier,
    fallback_reason: fallbackReason,
    draft_source: "anthropic",
  });

  return { kind: "success", payload, hasLegacyProvenance: legacy.hasLegacy };
}

/**
 * Handle SSE streaming response with fixture fallback
 */
async function handleSseResponse(
  reply: FastifyReply,
  input: DraftGraphInputT,
  rawBody: unknown
): Promise<void> {
  const streamStartTime = Date.now();
  reply.raw.writeHead(200, SSE_HEADERS);
  writeStage(reply, { stage: "DRAFTING" });

  try {
    let fixtureSent = false;

    // SSE with fixture fallback: show fixture if draft takes > 2.5s
    const fixtureTimeout = setTimeout(() => {
      if (!fixtureSent) {
        // Show minimal fixture graph while waiting for real draft
        const fixturePayload = DraftGraphOutput.parse({
          graph: fixtureGraph,
          patch: defaultPatch,
          rationales: [],
          confidence: 0.5,
          clarifier_status: "complete",
        });
        writeStage(reply, { stage: "DRAFTING", payload: fixturePayload });
        fixtureSent = true;
        emit("assist.draft.fixture_shown", { timeout_ms: FIXTURE_TIMEOUT_MS });
      }
    }, FIXTURE_TIMEOUT_MS);

    // Run pipeline
    const result = await runDraftGraphPipeline(input, rawBody);
    clearTimeout(fixtureTimeout);
    const streamDuration = Date.now() - streamStartTime;

    if (fixtureSent) {
      emit("assist.draft.fixture_replaced", { fixture_shown: true, stream_duration_ms: streamDuration });
    }

    // Handle errors
    if (result.kind === "error") {
      writeStage(reply, { stage: "COMPLETE", payload: result.envelope });
      reply.raw.end();
      return;
    }

    // Add deprecation headers if legacy string provenance detected
    if (result.hasLegacyProvenance) {
      reply.raw.setHeader("X-Deprecated-Provenance-Format", "true");
      reply.raw.setHeader("X-Deprecation-Sunset", DEPRECATION_SUNSET);
      reply.raw.setHeader("X-Deprecation-Link", "https://docs.olumi.ai/provenance-migration");
    }

    // Success
    writeStage(reply, { stage: "COMPLETE", payload: result.payload });
    emit("assist.draft.sse_completed", {
      stream_duration_ms: streamDuration,
      fixture_shown: fixtureSent,
    });
    reply.raw.end();
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error("unexpected error");
    log.error({ err }, "SSE draft graph failure");
    const envelope = buildError("INTERNAL", err.message || "internal");
    writeStage(reply, { stage: "COMPLETE", payload: envelope });
    const streamDuration = Date.now() - streamStartTime;
    emit("assist.draft.sse_error", {
      stream_duration_ms: streamDuration,
      error: err.message,
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
  rawBody: unknown
): Promise<void> {
  const result = await runDraftGraphPipeline(input, rawBody);

  // Handle errors
  if (result.kind === "error") {
    reply.code(result.statusCode);
    return reply.send(result.envelope);
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
  // Dedicated SSE streaming endpoint
  app.post("/assist/draft-graph/stream", async (req, reply) => {
    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      const envelope = buildError("BAD_INPUT", "invalid input", parsed.error.flatten());
      reply.raw.writeHead(400, SSE_HEADERS);
      writeStage(reply, { stage: "DRAFTING" });
      writeStage(reply, { stage: "COMPLETE", payload: envelope });
      reply.raw.end();
      return reply;
    }

    await handleSseResponse(reply, parsed.data, req.body);
    return reply;
  });

  // Main endpoint with backward compatibility (supports both SSE and JSON)
  app.post("/assist/draft-graph", async (req, reply) => {
    const wantsSse = req.headers.accept?.includes(EVENT_STREAM) ?? false;

    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      const envelope = buildError("BAD_INPUT", "invalid input", parsed.error.flatten());
      if (wantsSse) {
        reply.raw.writeHead(400, SSE_HEADERS);
        writeStage(reply, { stage: "DRAFTING" });
        writeStage(reply, { stage: "COMPLETE", payload: envelope });
        reply.raw.end();
        return reply;
      }
      reply.code(400);
      return reply.send(envelope);
    }

    if (wantsSse) {
      await handleSseResponse(reply, parsed.data, req.body);
      return reply;
    }

    // JSON response
    try {
      await handleJsonResponse(reply, parsed.data, req.body);
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
