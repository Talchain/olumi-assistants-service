import { Buffer } from "node:buffer";
import type { FastifyInstance } from "fastify";
import { CritiqueGraphInput, CritiqueGraphOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { processAttachments, type AttachmentInput, type GroundingStats } from "../grounding/process-attachments.js";
import { type DocPreview } from "../services/docProcessing.js";
import { isFeatureEnabled } from "../utils/feature-flags.js";
import { verificationPipeline } from "../cee/verification/index.js";
import {
  createObservabilityCollector,
  createNoOpObservabilityCollector,
  isObservabilityEnabled,
  isRawIOCaptureEnabled,
  type ObservabilityCollector,
} from "../cee/observability/index.js";

const CEE_VERSION = "v12.4";

type AttachmentPayload = string | { data: string; encoding?: string };

export default async function route(app: FastifyInstance) {
  app.post("/assist/critique-graph", async (req, reply) => {
    const parsed = CritiqueGraphInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "invalid input",
        details: parsed.error.flatten()
      }));
    }

    const input = parsed.data;

    // Feature flag guard: return 404 if critique is disabled
    if (!isFeatureEnabled('critique', input.flags)) {
      reply.code(404);
      return reply.send();
    }

    const requestId = getRequestId(req as any);
    const callerCtx = getRequestCallerContext(req as any);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    // Observability: create collector if enabled via flag or include_debug
    const includeDebug = (input as any).include_debug === true;
    const observabilityEnabled = isObservabilityEnabled(includeDebug);
    const rawIOEnabled = isRawIOCaptureEnabled(includeDebug);
    const observabilityCollector: ObservabilityCollector = observabilityEnabled
      ? createObservabilityCollector({
          requestId,
          ceeVersion: CEE_VERSION,
          captureRawIO: rawIOEnabled,
        })
      : createNoOpObservabilityCollector(requestId);

    try {
      // Process attachments with grounding module (v04: 5k limit, privacy, safe CSV)
      let docs: DocPreview[] = [];
      let groundingStats: GroundingStats | undefined;

      // Check if grounding feature is enabled (env or per-request flag)
      const groundingEnabled = isFeatureEnabled('grounding', input.flags);

      if (groundingEnabled && input.attachments?.length) {
        try {
          const payloads = (req.body as { attachment_payloads?: Record<string, AttachmentPayload> })?.attachment_payloads ?? {};

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

          const result = await processAttachments(attachmentInputs);
          docs = result.docs;
          groundingStats = result.stats;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));

          // Handle over-limit files with BAD_INPUT error and helpful hint
          if (err.message.includes('_exceeds_limit')) {
            const hint = err.message.includes('aggregate_exceeds_limit')
              ? "Total attachment size exceeds 50k character limit. Please reduce the number of attachments or their sizes."
              : "One or more files exceed the 5k character limit. Please reduce file size or split into smaller files.";

            reply.code(400);
            return reply.send(ErrorV1.parse({
              schema: "error.v1",
              code: "BAD_INPUT",
              message: err.message,
              details: { hint }
            }));
          }

          // Handle other processing errors
          reply.code(400);
          return reply.send(ErrorV1.parse({
            schema: "error.v1",
            code: "BAD_INPUT",
            message: `Attachment processing failed: ${err.message}`
          }));
        }
      }

      const critiqueStartTime = Date.now();

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('critique_graph');

      emit(TelemetryEvents.CritiqueStart, {
        ...telemetryCtx,
        node_count: input.graph.nodes.length,
        edge_count: input.graph.edges.length,
        has_brief: !!input.brief,
        has_attachments: docs.length > 0,
        focus_areas: input.focus_areas,
        provider: adapter.name,
      });

      const result = await adapter.critiqueGraph(
        {
          graph: input.graph,
          brief: input.brief,
          docs, // NEW: pass grounding docs to adapter
          focus_areas: input.focus_areas,
        },
        {
          requestId,
          timeoutMs: 10000, // 10s timeout for critique
          observabilityCollector,
        }
      );

      const critiqueDuration = Date.now() - critiqueStartTime;

      // Record LLM call for observability
      if (observabilityEnabled) {
        observabilityCollector.recordLLMCall({
          step: "critique_graph",
          model: adapter.model,
          provider: (adapter.name === "anthropic" || adapter.name === "openai") ? adapter.name : "anthropic",
          model_selection_reason: "task_default", // Uses TASK_MODEL_DEFAULTS
          tokens: {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens,
            total: result.usage.input_tokens + result.usage.output_tokens,
          },
          latency_ms: critiqueDuration,
          attempt: 1,
          success: true,
          started_at: new Date(critiqueStartTime).toISOString(),
          completed_at: new Date().toISOString(),
          cache_hit: (result.usage.cache_read_input_tokens ?? 0) > 0,
        });
      }

      // Calculate cost (provider-specific pricing)
      const cost_usd = calculateCost(adapter.model, result.usage.input_tokens, result.usage.output_tokens);

      // Count issues by level
      const blockerCount = result.issues.filter(i => i.level === "BLOCKER").length;
      const improvementCount = result.issues.filter(i => i.level === "IMPROVEMENT").length;
      const observationCount = result.issues.filter(i => i.level === "OBSERVATION").length;

      // Emit telemetry with provider/cost fallbacks (per v04 spec)
      const telemetryData: Record<string, unknown> = {
        ...telemetryCtx,
        duration_ms: critiqueDuration,
        issue_count: result.issues.length,
        blocker_count: blockerCount,
        improvement_count: improvementCount,
        observation_count: observationCount,
        overall_quality: result.overall_quality,
        provider: adapter.name || "unknown",
        cost_usd: cost_usd ?? 0,
        model: adapter.model,
        cache_hit: (result.usage.cache_read_input_tokens || 0) > 0,
      };

      // Add grounding stats if attachments were processed (v04)
      if (groundingStats && groundingStats.files_processed > 0) {
        telemetryData.grounding = groundingStats;
      }

      emit(TelemetryEvents.CritiqueComplete, telemetryData);

      // Deterministic ordering: BLOCKER → IMPROVEMENT → OBSERVATION, then by note
      const levelOrder: Record<string, number> = { BLOCKER: 0, IMPROVEMENT: 1, OBSERVATION: 2 };
      const sortedIssues = [...result.issues].sort((a, b) => {
        const la = levelOrder[a.level] ?? 99;
        const lb = levelOrder[b.level] ?? 99;
        if (la !== lb) return la - lb;
        return a.note.localeCompare(b.note);
      });

      const output = CritiqueGraphOutput.parse({
        issues: sortedIssues,
        suggested_fixes: result.suggested_fixes,
        overall_quality: result.overall_quality,
      });

      const { response } = await verificationPipeline.verify(
        output,
        CritiqueGraphOutput,
        {
          endpoint: "critique-graph",
          requiresEngineValidation: false,
          requestId,
        },
      );

      // Attach observability data if enabled
      if (observabilityEnabled) {
        (response as any)._observability = observabilityCollector.build();
      }

      return reply.send(response);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      log.error({ err, node_count: input.graph.nodes.length }, "critique-graph route failure");

      emit(TelemetryEvents.CritiqueFailed, {
        ...telemetryCtx,
        error: err.message,
      });

      // Capability mapping: provider not supported -> 400 BAD_INPUT with hint
      if (err.message && err.message.includes("_not_supported")) {
        reply.code(400);
        return reply.send(ErrorV1.parse({
          schema: "error.v1",
          code: "BAD_INPUT",
          message: "not_supported",
          details: { hint: "Use LLM_PROVIDER=anthropic or fixtures" },
        }));
      }

      reply.code(500);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "INTERNAL",
        message: err.message || "internal",
      }));
    }
  });
}
