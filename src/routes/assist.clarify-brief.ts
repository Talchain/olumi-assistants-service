import type { FastifyInstance } from "fastify";
import { ClarifyBriefInput, ClarifyBriefOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { emit, log, calculateCost } from "../utils/telemetry.js";

export default async function route(app: FastifyInstance) {
  app.post("/assist/clarify-brief", async (req, reply) => {
    const parsed = ClarifyBriefInput.safeParse(req.body);
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

    // Check round limit (0-2, max 3 rounds)
    if (input.round > 2) {
      reply.code(400);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "maximum 3 clarification rounds (0-2)",
        details: { round: input.round, max_round: 2 }
      }));
    }

    try {
      const clarifierStartTime = Date.now();

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('clarify_brief');

      emit("assist.clarifier.round_start", {
        round: input.round,
        brief_chars: input.brief.length,
        has_previous_answers: !!input.previous_answers?.length,
        provider: adapter.name,
      });

      const result = await adapter.clarifyBrief(
        {
          brief: input.brief,
          round: input.round,
          previous_answers: input.previous_answers,
          seed: input.seed,
        },
        {
          requestId: `clarify_${Date.now()}`,
          timeoutMs: 10000, // 10s timeout for clarification
        }
      );

      const clarifierDuration = Date.now() - clarifierStartTime;

      // Calculate cost (provider-specific pricing)
      const cost_usd = calculateCost(adapter.model, result.usage.input_tokens, result.usage.output_tokens);

      // Emit telemetry with provider/cost fallbacks (per v04 spec)
      emit("assist.clarifier.round_complete", {
        round: input.round,
        question_count: result.questions.length,
        confidence: result.confidence,
        should_continue: result.should_continue,
        duration_ms: clarifierDuration,
        provider: adapter.name || "unknown",
        cost_usd: cost_usd ?? 0,
        model: adapter.model,
        cache_hit: (result.usage.cache_read_input_tokens || 0) > 0,
      });

      const output = ClarifyBriefOutput.parse({
        questions: result.questions,
        confidence: result.confidence,
        should_continue: result.should_continue,
        round: input.round,
      });

      return reply.send(output);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      log.error({ err, round: input.round }, "clarify-brief route failure");

      emit("assist.clarifier.round_failed", {
        round: input.round,
        error: err.message,
      });

      reply.code(500);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "INTERNAL",
        message: err.message || "internal",
      }));
    }
  });
}
