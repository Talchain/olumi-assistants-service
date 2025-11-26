/**
 * Enhanced Decision Review Route
 *
 * Provides ISL-enhanced decision review with graceful degradation.
 * Combines LLM critique with causal analysis from ISL.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GraphV1 } from '../contracts/plot/engine.js';
import { executeDecisionReview } from '../cee/decision-review/index.js';
import { formatDecisionReviewSummary } from '../cee/decision-review/templates.js';
import { buildCeeErrorResponse } from '../cee/validation/pipeline.js';
import { getRequestId } from '../utils/request-id.js';
import { getRequestKeyId } from '../plugins/auth.js';
import { emit } from '../utils/telemetry.js';
import { logCeeCall } from '../cee/logging.js';

// ============================================================================
// Input Schema
// ============================================================================

const EnhancedDecisionReviewInputSchema = z.object({
  /** Decision graph to analyze */
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()).optional(),
  }),

  /** Specific node IDs to analyze (optional) */
  target_nodes: z.array(z.string()).optional(),

  /** Correlation ID for tracing */
  correlation_id: z.string().optional(),

  /** Configuration options */
  config: z
    .object({
      /** Enable sensitivity analysis (default: true) */
      enable_sensitivity: z.boolean().default(true),
      /** Enable contrastive explanations (default: true) */
      enable_contrastive: z.boolean().default(true),
      /** Enable conformal predictions (default: false) */
      enable_conformal: z.boolean().default(false),
      /** Enable validation strategies (default: true) */
      enable_validation_strategies: z.boolean().default(true),
      /** Maximum nodes to analyze (default: 20) */
      max_nodes: z.number().int().positive().default(20),
      /** Return formatted markdown summary */
      include_formatted_summary: z.boolean().default(false),
    })
    .optional(),
});

type EnhancedDecisionReviewInput = z.infer<typeof EnhancedDecisionReviewInputSchema>;

// ============================================================================
// Rate Limiting
// ============================================================================

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const decisionReviewBuckets = new Map<string, BucketState>();

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

function checkDecisionReviewLimit(
  key: string,
  limit: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(decisionReviewBuckets, now);
  let state = decisionReviewBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    decisionReviewBuckets.set(key, state);
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

// ============================================================================
// Route Handler
// ============================================================================

export default async function route(app: FastifyInstance) {
  const RATE_LIMIT_RPM = parseInt(
    process.env.CEE_DECISION_REVIEW_RATE_LIMIT_RPM || '30',
    10,
  );
  const FEATURE_VERSION = 'decision-review-2.0.0';

  app.post('/assist/v1/decision-review/enhanced', async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);

    emit('cee.decision_review.requested', {
      request_id: requestId,
      feature: 'cee_enhanced_decision_review',
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || 'unknown';
    const { allowed, retryAfterSeconds } = checkDecisionReviewLimit(
      rateKey,
      RATE_LIMIT_RPM,
    );

    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        'CEE_RATE_LIMIT',
        'Decision Review rate limit exceeded',
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit('cee.decision_review.failed', {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: 'CEE_RATE_LIMIT',
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: 'cee_enhanced_decision_review',
        latencyMs: Date.now() - start,
        status: 'limited',
        errorCode: 'CEE_RATE_LIMIT',
        httpStatus: 429,
      });

      reply.header('Retry-After', retryAfterSeconds.toString());
      reply.header('X-CEE-API-Version', 'v1');
      reply.header('X-CEE-Feature-Version', FEATURE_VERSION);
      reply.header('X-CEE-Request-ID', requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    // Validate input
    const parsed = EnhancedDecisionReviewInputSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse(
        'CEE_VALIDATION_FAILED',
        'Invalid input',
        {
          retryable: false,
          requestId,
          details: { field_errors: parsed.error.flatten() },
        },
      );

      emit('cee.decision_review.failed', {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: 'CEE_VALIDATION_FAILED',
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: 'cee_enhanced_decision_review',
        latencyMs: Date.now() - start,
        status: 'error',
        errorCode: 'CEE_VALIDATION_FAILED',
        httpStatus: 400,
      });

      reply.header('X-CEE-API-Version', 'v1');
      reply.header('X-CEE-Feature-Version', FEATURE_VERSION);
      reply.header('X-CEE-Request-ID', requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const input = parsed.data;

    try {
      const graph = input.graph as unknown as GraphV1;

      // Execute decision review
      const reviewResult = await executeDecisionReview(
        graph,
        {
          correlationId: input.correlation_id ?? requestId,
          targetNodes: input.target_nodes,
          config: input.config
            ? {
                enableSensitivity: input.config.enable_sensitivity,
                enableContrastive: input.config.enable_contrastive,
                enableConformal: input.config.enable_conformal,
                enableValidationStrategies:
                  input.config.enable_validation_strategies,
                maxNodes: input.config.max_nodes,
              }
            : undefined,
        },
      );

      const latencyMs = Date.now() - start;

      // Build response
      const response: Record<string, unknown> = {
        ...reviewResult,
        // Override trace with our request ID
        trace: {
          ...reviewResult.trace,
          requestId,
          correlationId: input.correlation_id ?? requestId,
        },
      };

      // Optionally include formatted markdown summary
      if (input.config?.include_formatted_summary) {
        response.formatted_summary = formatDecisionReviewSummary(reviewResult);
      }

      emit('cee.decision_review.succeeded', {
        request_id: requestId,
        latency_ms: latencyMs,
        nodes_analyzed: reviewResult.summary.nodesAnalyzed,
        isl_available: reviewResult.islAvailability.serviceAvailable,
        critical_count: reviewResult.summary.bySeverity.critical,
        high_count: reviewResult.summary.bySeverity.high,
      });

      logCeeCall({
        requestId,
        capability: 'cee_enhanced_decision_review',
        latencyMs,
        status: reviewResult.islAvailability.serviceAvailable ? 'ok' : 'degraded',
        httpStatus: 200,
      });

      reply.header('X-CEE-API-Version', 'v1');
      reply.header('X-CEE-Feature-Version', FEATURE_VERSION);
      reply.header('X-CEE-Request-ID', requestId);
      reply.header(
        'X-CEE-ISL-Available',
        reviewResult.islAvailability.serviceAvailable ? 'true' : 'false',
      );
      reply.code(200);
      return reply.send(response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('internal error');

      emit('cee.decision_review.failed', {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: 'CEE_INTERNAL_ERROR',
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: 'cee_enhanced_decision_review',
        latencyMs: Date.now() - start,
        status: 'error',
        errorCode: 'CEE_INTERNAL_ERROR',
        httpStatus: 500,
      });

      const errorBody = buildCeeErrorResponse(
        'CEE_INTERNAL_ERROR',
        err.message || 'internal error',
        {
          retryable: false,
          requestId,
        },
      );

      reply.header('X-CEE-API-Version', 'v1');
      reply.header('X-CEE-Feature-Version', FEATURE_VERSION);
      reply.header('X-CEE-Request-ID', requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
