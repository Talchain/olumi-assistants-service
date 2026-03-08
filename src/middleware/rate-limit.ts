/**
 * Per-user rate limiting for the orchestrator endpoint.
 *
 * Applies to POST /orchestrate/v1/turn only.
 * Keys by JWT sub (decoded, not verified) or IP fallback.
 * In-memory store — suitable for single-instance pilot deployment.
 *
 * Fail-open: if the rate limiter throws, a structured warning is logged
 * and the request proceeds.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { resolveUserKey } from '../utils/jwt-extract.js';
import { getRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Configuration (env-driven with sensible defaults)
// ---------------------------------------------------------------------------

const MAX_REQUESTS = Number(process.env.CEE_ORCHESTRATOR_RATE_LIMIT_MAX) || 30;
const WINDOW_MS = Number(process.env.CEE_ORCHESTRATOR_RATE_LIMIT_WINDOW_MS) || 3_600_000; // 60 min

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/** Exported for testing — not for production use. */
export const _store = new Map<string, RateLimitEntry>();

/** Reset the store (testing only). */
export function _resetStore(): void {
  _store.clear();
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;         // epoch ms
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  let entry = _store.get(key);

  // Lazy reset if window has expired
  if (!entry || now >= entry.windowStart + WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    _store.set(key, entry);
  }

  entry.count += 1;

  const resetAt = entry.windowStart + WINDOW_MS;
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  return {
    allowed: entry.count <= MAX_REQUESTS,
    limit: MAX_REQUESTS,
    remaining,
    resetAt,
    retryAfterSeconds,
  };
}

// ---------------------------------------------------------------------------
// Fastify preHandler hook
// ---------------------------------------------------------------------------

/**
 * Create a Fastify preHandler hook that enforces per-user rate limits.
 *
 * On 429, returns a cee.error.v1 response with CEE_RATE_LIMIT code,
 * matching the existing CEE typed-error contract used by all /assist/* routes.
 */
export function createOrchestratorRateLimitHook() {
  return async function orchestratorRateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const userKey = resolveUserKey(request);
      const result = checkRateLimit(userKey);
      const requestId = getRequestId(request);

      // Always attach rate-limit headers (including on 200s)
      reply.header('X-RateLimit-Limit', result.limit);
      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        reply.header('Retry-After', result.retryAfterSeconds);

        log.warn({
          event: 'orchestrator_rate_limit_hit',
          request_id: requestId,
          user_key: userKey,
          limit: result.limit,
          window_ms: WINDOW_MS,
        }, 'Orchestrator per-user rate limit exceeded');

        // cee.error.v1 shape — matches buildCeeErrorResponse() contract
        const body = {
          schema: 'cee.error.v1',
          code: 'CEE_RATE_LIMIT',
          message: "You've reached the request limit. Please try again in a few minutes.",
          retryable: true,
          source: 'cee',
          request_id: requestId,
          details: {
            retry_after_seconds: result.retryAfterSeconds,
          },
        };

        reply.code(429).send(body);
        return;
      }
    } catch (err: unknown) {
      // Fail open — log structured warning and allow the request through
      const requestId = getRequestId(request);
      log.warn({
        level: 'warn',
        event: 'rate_limit_error',
        request_id: requestId,
        route: request.url,
        error: err instanceof Error ? err.message : String(err),
      }, 'Rate limiter error — failing open');
    }
  };
}
