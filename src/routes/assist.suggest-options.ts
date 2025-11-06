import type { FastifyInstance } from "fastify";
import { SuggestOptionsInput, SuggestOptionsOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";

/**
 * POST /assist/suggest-options
 *
 * Suggests 3-5 distinct strategic options for a goal.
 * Enforces deterministic ordering (by option id alphabetically).
 */
export default async function route(app: FastifyInstance) {
  app.post("/assist/suggest-options", async (req, reply) => {
    const startTime = Date.now();
    const parsed = SuggestOptionsInput.safeParse(req.body);

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
      const existingOptions = parsed.data.graph_summary?.existing_options;

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('suggest_options');

      // Emit telemetry start event
      emit(TelemetryEvents.SuggestOptionsStart, {
        goal_length: parsed.data.goal.length,
        has_constraints: !!parsed.data.constraints,
        existing_options_count: existingOptions?.length || 0,
        provider: adapter.name
      });

      const result = await adapter.suggestOptions(
        {
          goal: parsed.data.goal,
          constraints: parsed.data.constraints,
          existingOptions,
        },
        {
          requestId: `suggest_${Date.now()}`,
          timeoutMs: 10000, // 10s timeout for suggestions
        }
      );

      // Sort options deterministically (by id alphabetically)
      const sortedOptions = [...result.options].sort((a, b) => a.id.localeCompare(b.id));

      const durationMs = Date.now() - startTime;

      // Calculate cost from usage metrics
      const costUsd = calculateCost(
        adapter.model,
        result.usage.input_tokens,
        result.usage.output_tokens
      );

      // Emit completion telemetry
      emit(TelemetryEvents.SuggestOptionsComplete, {
        option_count: sortedOptions.length,
        duration_ms: durationMs,
        provider: adapter.name,
        model: adapter.model,
        cost_usd: costUsd
      });

      const output = SuggestOptionsOutput.parse({ options: sortedOptions });
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

      log.error({ err }, "suggest-options route failure");
      reply.code(500);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "INTERNAL",
        message: err.message || "internal",
      }));
    }
  });
}
