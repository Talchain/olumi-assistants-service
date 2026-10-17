import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ExplainDiffInput, ExplainDiffOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";
import { EXPLAIN_DIFF_TIMEOUT_MS } from "../config/timeouts.js";

/** Explains graph-patch changes without mutating the model. */
export const EXPLAIN_DIFF_PATHS = [
  "/assist/v1/explain-diff",
] as const;

export default async function route(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const parsed = ExplainDiffInput.safeParse(req.body);

    if (!parsed.success) {
      reply.code(400);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "invalid input",
        details: parsed.error.flatten()
      }));
    }

    try {
      const { patch, brief, graph_summary } = parsed.data;

      // Count total changes
      const totalChanges =
        (patch.adds?.nodes?.length || 0) +
        (patch.adds?.edges?.length || 0) +
        (patch.updates?.length || 0) +
        (patch.removes?.length || 0);

      if (totalChanges === 0) {
        reply.code(400);
        return reply.send(ErrorV1.parse({
          schema: "error.v1",
          code: "BAD_INPUT",
          message: "patch has no changes to explain"
        }));
      }

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('explain_diff');

      // Emit telemetry start event
      emit(TelemetryEvents.ExplainDiffStart, {
        change_count: totalChanges,
        has_brief: !!brief,
        has_graph_summary: !!graph_summary,
        provider: adapter.name
      });

      // Call adapter to explain the diff
      const result = await adapter.explainDiff(
        {
          patch,
          brief,
          graph_summary,
        },
        {
          requestId: `explain_${Date.now()}`,
          timeoutMs: EXPLAIN_DIFF_TIMEOUT_MS,
        }
      );

      // Rationales are already sorted by adapter, but ensure deterministic ordering
      const sortedRationales = [...result.rationales].sort((a, b) => a.target.localeCompare(b.target));

      const durationMs = Date.now() - startTime;

      // Calculate cost from usage metrics
      const costUsd = calculateCost(
        adapter.model,
        result.usage.input_tokens,
        result.usage.output_tokens
      );

      // Emit completion telemetry
      emit(TelemetryEvents.ExplainDiffComplete, {
        rationale_count: sortedRationales.length,
        duration_ms: durationMs,
        provider: adapter.name,
        model: adapter.model,
        cost_usd: costUsd
      });

      const output = ExplainDiffOutput.parse({ rationales: sortedRationales });
      return reply.send(output);

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");

      // Capability error mapping (like clarifier/critique)
      if (err.message && err.message.includes("_not_supported")) {
        reply.code(400);
        return reply.send(ErrorV1.parse({
          schema: "error.v1",
          code: "BAD_INPUT",
          message: "not_supported",
          details: { hint: "Use LLM_PROVIDER=anthropic or fixtures" }
        }));
      }

      log.error({ err }, "explain-diff route failure");
      reply.code(500);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "INTERNAL",
        message: err.message || "internal"
      }));
    }
  };

  // Derived from the path list above — one handler reference, so the two
  // surfaces cannot fork.
  for (const path of EXPLAIN_DIFF_PATHS) {
    app.post(path, { config: { scenarioId: 'none' } }, handler);
  }
}
