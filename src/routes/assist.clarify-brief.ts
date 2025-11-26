import type { FastifyInstance } from "fastify";
import { ClarifyBriefInput, ClarifyBriefOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";
import { isFeatureEnabled } from "../utils/feature-flags.js";
import {
  assessBriefReadiness,
  findWeakestFactor,
  compressPreviousAnswers,
} from "../cee/validation/readiness.js";

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

    // Feature flag guard: return 404 if clarifier is disabled
    if (!isFeatureEnabled('clarifier', input.flags)) {
      reply.code(404);
      return reply.send();
    }

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

      // Assess brief readiness before clarification
      const readinessAssessment = assessBriefReadiness(input.brief);
      const weakestFactor = findWeakestFactor(readinessAssessment.factors);

      // Compress previous answers for history context
      const compressedHistory = compressPreviousAnswers(input.previous_answers);

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('clarify_brief');

      emit(TelemetryEvents.ClarifierRoundStart, {
        round: input.round,
        brief_chars: input.brief.length,
        has_previous_answers: !!input.previous_answers?.length,
        provider: adapter.name,
        readiness_score: readinessAssessment.score,
        readiness_level: readinessAssessment.level,
        weakest_factor: weakestFactor,
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

      // Log compressed history for debugging (available for future adapter enhancements)
      if (compressedHistory) {
        log.debug({
          round: input.round,
          compressed_history_length: compressedHistory.length,
          event: "cee.clarify.history_compressed",
        }, "Compressed previous answers for clarification round");
      }

      const clarifierDuration = Date.now() - clarifierStartTime;

      // Calculate cost (provider-specific pricing)
      const cost_usd = calculateCost(adapter.model, result.usage.input_tokens, result.usage.output_tokens);

      // Emit telemetry with provider/cost fallbacks (per v04 spec)
      emit(TelemetryEvents.ClarifierRoundComplete, {
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

      // MCQ-first deterministic ordering (choices first), then alphabetical by question
      const questionsSorted = [...result.questions].sort((a, b) => {
        const ac = Array.isArray(a.choices);
        const bc = Array.isArray(b.choices);
        if (ac !== bc) return ac ? -1 : 1;
        return a.question.localeCompare(b.question);
      });

      // Stop rule: confidence >= 0.8 implies no further rounds
      const shouldContinue = result.confidence >= 0.8 ? false : result.should_continue;

      const output = ClarifyBriefOutput.parse({
        questions: questionsSorted,
        confidence: result.confidence,
        should_continue: shouldContinue,
        round: input.round,
        // Include readiness assessment for UI to display factor scores
        readiness: {
          score: readinessAssessment.score,
          level: readinessAssessment.level,
          factors: readinessAssessment.factors,
          weakest_factor: weakestFactor,
        },
      });

      return reply.send(output);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      log.error({ err, round: input.round }, "clarify-brief route failure");

      emit(TelemetryEvents.ClarifierRoundFailed, {
        round: input.round,
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
