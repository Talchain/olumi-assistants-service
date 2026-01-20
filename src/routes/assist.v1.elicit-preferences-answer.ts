import type { FastifyInstance } from "fastify";
import { CEEElicitPreferencesAnswerInput, type CEEElicitPreferencesAnswerInputT } from "../schemas/cee.js";
import {
  CEEElicitPreferencesAnswerResponseV1Schema,
  type CEEElicitPreferencesAnswerResponseV1T,
} from "../schemas/ceeResponses.js";
import {
  processAnswer,
  generateRecommendationImpact,
  selectNextQuestion,
  getRemainingQuestionsCount,
} from "../cee/preference-elicitation/index.js";
import type { SelectionContext, PreferenceQuestionT } from "../cee/preference-elicitation/types.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents, log } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

// In-memory question store for tracking active questions
// In production, this would be stored in a database or cache
const activeQuestions = new Map<string, PreferenceQuestionT>();

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeElicitPreferencesAnswerBuckets = new Map<string, BucketState>();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS) return;

  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    }
  }

  if (map.size <= MAX_BUCKETS) return;

  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

function checkCeeElicitPreferencesAnswerLimit(
  key: string,
  limit: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeElicitPreferencesAnswerBuckets, now);
  let state = ceeElicitPreferencesAnswerBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeElicitPreferencesAnswerBuckets.set(key, state);
  }

  if (now - state.windowStart >= WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }

  if (state.count >= limit) {
    const resetAt = state.windowStart + WINDOW_MS;
    const diffMs = Math.max(0, resetAt - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(diffMs / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  state.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

// Store a question for later retrieval
export function storeQuestion(question: PreferenceQuestionT): void {
  activeQuestions.set(question.id, question);
  // Clean up old questions (keep last 1000)
  if (activeQuestions.size > 1000) {
    const keysToDelete = Array.from(activeQuestions.keys()).slice(0, 100);
    for (const key of keysToDelete) {
      activeQuestions.delete(key);
    }
  }
}

// Retrieve a stored question
function getStoredQuestion(questionId: string): PreferenceQuestionT | undefined {
  return activeQuestions.get(questionId);
}

export default async function route(app: FastifyInstance) {
  const ELICIT_PREFERENCES_ANSWER_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_ELICIT_PREFERENCES_ANSWER_RATE_LIMIT_RPM") ?? 30;
  const FEATURE_VERSION = "elicit-preferences-answer-1.0.0";

  app.post("/assist/v1/elicit/preferences/answer", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx
      ? contextToTelemetry(callerCtx)
      : { request_id: requestId };

    emit(TelemetryEvents.CeeElicitPreferencesAnswerRequested, {
      ...telemetryCtx,
      feature: "cee_elicit_preferences_answer",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeElicitPreferencesAnswerLimit(
      rateKey,
      ELICIT_PREFERENCES_ANSWER_RATE_LIMIT_RPM
    );

    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Elicit Preferences Answer rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeElicitPreferencesAnswerFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_elicit_preferences_answer",
        latencyMs: Date.now() - start,
        status: "limited",
        errorCode: "CEE_RATE_LIMIT",
        httpStatus: 429,
      });

      reply.header("Retry-After", retryAfterSeconds.toString());
      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    // Input validation
    const parsed = CEEElicitPreferencesAnswerInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse(
        "CEE_VALIDATION_FAILED",
        "invalid input",
        {
          retryable: false,
          requestId,
          details: { field_errors: parsed.error.flatten() },
        }
      );

      emit(TelemetryEvents.CeeElicitPreferencesAnswerFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_elicit_preferences_answer",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_VALIDATION_FAILED",
        httpStatus: 400,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const input = parsed.data as CEEElicitPreferencesAnswerInputT;

    try {
      // Retrieve the question being answered
      const question = getStoredQuestion(input.question_id);

      if (!question) {
        // If question not found, create a synthetic one for processing
        // This allows stateless operation when question wasn't stored
        const errorBody = buildCeeErrorResponse(
          "CEE_VALIDATION_FAILED",
          "Question not found. Questions expire after a period of time.",
          {
            retryable: false,
            requestId,
          }
        );

        emit(TelemetryEvents.CeeElicitPreferencesAnswerFailed, {
          ...telemetryCtx,
          latency_ms: Date.now() - start,
          error_code: "CEE_VALIDATION_FAILED",
          http_status: 404,
        });

        logCeeCall({
          requestId,
          capability: "cee_elicit_preferences_answer",
          latencyMs: Date.now() - start,
          status: "error",
          errorCode: "CEE_VALIDATION_FAILED",
          httpStatus: 404,
        });

        reply.header("X-CEE-API-Version", "v1");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.code(404);
        return reply.send(errorBody);
      }

      // Process the answer
      const { updated, impact } = processAnswer(
        question,
        input.answer,
        input.current_preferences
      );

      // Generate recommendation impact statement
      const recommendationImpact = generateRecommendationImpact(
        input.current_preferences,
        updated,
        question.type
      );

      // Calculate remaining questions
      const remainingQuestions = getRemainingQuestionsCount(updated, "high");

      // Select next question if more are needed
      let nextQuestion: PreferenceQuestionT | undefined;
      if (remainingQuestions > 0) {
        const selectionCtx: SelectionContext = {
          currentPreferences: updated,
          graphGoals: [],
          graphOptions: [],
          decisionScale: 10000,
        };
        const selected = selectNextQuestion(selectionCtx);
        if (selected) {
          nextQuestion = selected;
          // Store for later retrieval
          storeQuestion(nextQuestion);
        }
      }

      // Build response
      const response: CEEElicitPreferencesAnswerResponseV1T = {
        updated_preferences: updated,
        recommendation_impact: recommendationImpact,
        remaining_questions: remainingQuestions,
        next_question: nextQuestion,
        trace: {
          request_id: requestId,
          correlation_id: requestId,
          context_id: input.context_id,
        },
        provenance: "cee",
      };

      // Validate response schema
      const validationResult = CEEElicitPreferencesAnswerResponseV1Schema.safeParse(response);
      if (!validationResult.success) {
        log.error(
          { error: validationResult.error, request_id: requestId },
          "Elicit preferences answer response schema validation failed"
        );
        throw new Error("Internal response validation failed");
      }

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeElicitPreferencesAnswerSucceeded, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        question_type: question.type,
        answer: input.answer,
        new_confidence: updated.confidence,
        remaining_questions: remainingQuestions,
      });

      logCeeCall({
        requestId,
        capability: "cee_elicit_preferences_answer",
        latencyMs,
        status: "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");

      emit(TelemetryEvents.CeeElicitPreferencesAnswerFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: "cee_elicit_preferences_answer",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_INTERNAL_ERROR",
        httpStatus: 500,
      });

      const errorBody = buildCeeErrorResponse(
        "CEE_INTERNAL_ERROR",
        err.message || "internal error",
        {
          retryable: false,
          requestId,
        }
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
