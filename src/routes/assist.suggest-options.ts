import type { FastifyInstance } from "fastify";
import { SuggestOptionsInput, SuggestOptionsOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { getSystemPromptMeta } from "../adapters/llm/prompt-loader.js";
import { shouldUseStagingPrompts } from "../config/index.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";
import { getRequestId } from "../utils/request-id.js";
import {
  createObservabilityCollector,
  createNoOpObservabilityCollector,
  isObservabilityEnabled,
  isRawIOCaptureEnabled,
  type ObservabilityCollector,
} from "../cee/observability/index.js";

const CEE_VERSION = "v12.4";

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
    const requestId = getRequestId(req as any);

    if (!parsed.success) {
      reply.code(400);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "invalid input",
        details: parsed.error.flatten()
      }));
    }

    // Observability: create collector if enabled via flag or include_debug
    const includeDebug = (parsed.data as any).include_debug === true;
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
      const existingOptions = parsed.data.graph_summary?.existing_options;

      // Get adapter via router (env-driven or config)
      // Model selection priority: prompt config > task default
      let modelOverride: string | undefined;
      const promptMeta = getSystemPromptMeta('suggest_options');
      if (promptMeta.modelConfig) {
        const env = shouldUseStagingPrompts() ? 'staging' : 'production';
        const promptModel = promptMeta.modelConfig[env];
        if (promptModel) {
          modelOverride = promptModel;
          log.info({ task: 'suggest_options', env, promptModel, promptId: promptMeta.promptId }, 'Using model from prompt config');
        }
      }
      const adapter = getAdapter('suggest_options', modelOverride);

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
          requestId,
          timeoutMs: 10000, // 10s timeout for suggestions
          observabilityCollector,
        }
      );

      // Sort options deterministically (by id alphabetically)
      const sortedOptions = [...result.options].sort((a, b) => a.id.localeCompare(b.id));

      const durationMs = Date.now() - startTime;

      // Record LLM call for observability
      if (observabilityEnabled) {
        observabilityCollector.recordLLMCall({
          step: "suggest_options",
          model: adapter.model,
          provider: (adapter.name === "anthropic" || adapter.name === "openai") ? adapter.name : "anthropic",
          model_selection_reason: "task_default", // Uses TASK_MODEL_DEFAULTS
          tokens: {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens,
            total: result.usage.input_tokens + result.usage.output_tokens,
          },
          latency_ms: durationMs,
          attempt: 1,
          success: true,
          started_at: new Date(startTime).toISOString(),
          completed_at: new Date().toISOString(),
          cache_hit: (result.usage.cache_read_input_tokens ?? 0) > 0,
        });
      }

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

      // Attach observability data if enabled
      if (observabilityEnabled) {
        (output as any)._observability = observabilityCollector.build();
      }

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
