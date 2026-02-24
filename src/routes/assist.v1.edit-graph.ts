/**
 * POST /assist/v1/edit-graph
 *
 * HTTP endpoint for graph editing via LLM.
 * Feature-gated behind ENABLE_ORCHESTRATOR.
 *
 * Accepts a graph + natural language edit description, produces PatchOperation[].
 * Also callable as a function from the orchestrator turn handler.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getOrGenerateRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
import { getAdapter } from "../adapters/llm/router.js";
import { handleEditGraph } from "../orchestrator/tools/edit-graph.js";
import type { ConversationContext, OrchestratorError } from "../orchestrator/types.js";
import { getHttpStatusForError } from "../orchestrator/types.js";

// ============================================================================
// Request Validation
// ============================================================================

const EditGraphRequestSchema = z.object({
  graph: z.unknown(),
  edit_description: z.string().min(1).max(10_000),
  scenario_id: z.string().min(1).max(200).optional(),
});

// ============================================================================
// Route
// ============================================================================

export default async function route(app: FastifyInstance): Promise<void> {
  app.post("/assist/v1/edit-graph", async (req, reply) => {
    const startTime = Date.now();
    const requestId = getOrGenerateRequestId(req);

    const parsed = EditGraphRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorDetail = parsed.error.flatten();
      log.warn(
        { request_id: requestId, errors: errorDetail },
        "edit-graph request validation failed",
      );
      reply.code(400);
      return {
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed",
          details: errorDetail,
        },
      };
    }

    const { graph, edit_description, scenario_id } = parsed.data;

    // Build minimal ConversationContext for the handler
    const context: ConversationContext = {
      graph: graph as ConversationContext["graph"],
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: scenario_id ?? "direct-edit",
    };

    const adapter = getAdapter("orchestrator");
    const turnId = `direct-edit-${requestId}`;

    try {
      const result = await handleEditGraph(
        context,
        edit_description,
        adapter,
        requestId,
        turnId,
      );

      log.info(
        { request_id: requestId, elapsed_ms: Date.now() - startTime },
        "edit-graph completed",
      );

      reply.code(200);
      return {
        blocks: result.blocks,
        assistant_text: result.assistantText,
        latency_ms: result.latencyMs,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;

      // Extract orchestratorError if attached
      const orchErr = error && typeof error === "object" && "orchestratorError" in error
        ? (error as { orchestratorError: OrchestratorError }).orchestratorError
        : null;

      if (orchErr) {
        const status = getHttpStatusForError(orchErr);
        log.warn(
          { request_id: requestId, elapsed_ms: elapsed, error_code: orchErr.code, http_status: status },
          "edit-graph tool error",
        );
        reply.code(status);
        return { error: orchErr };
      }

      log.error(
        { error, request_id: requestId, elapsed_ms: elapsed },
        "edit-graph unhandled error",
      );
      reply.code(500);
      return {
        error: {
          code: "UNKNOWN",
          message: "Internal server error",
          recoverable: false,
        },
      };
    }
  });
}
