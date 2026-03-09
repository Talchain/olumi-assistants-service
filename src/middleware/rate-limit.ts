/**
 * Per-user rate limiting for the orchestrator endpoint.
 *
 * Applies to POST /orchestrate/v1/turn only.
 * Keys by JWT sub + scenario_id (preferred), or IP fallback.
 * In-memory store — suitable for single-instance pilot deployment.
 *
 * Key priority:
 *   user:{sub}:scenario:{scenario_id} → user:{sub} → ip:{ip}
 *
 * Unauthenticated requests use IP-only at a stricter limit (10/min).
 * scenario_id from unauthenticated requests is untrusted and ignored.
 *
 * Fail-open: if the rate limiter throws, a structured warning is logged
 * and the request proceeds.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { extractJwtSub, extractClientIp } from '../utils/jwt-extract.js';
import { getRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Configuration (env-driven with sensible defaults)
// ---------------------------------------------------------------------------

const MAX_REQUESTS = Number(process.env.CEE_ORCHESTRATOR_RATE_LIMIT_MAX) || 30;
const MAX_REQUESTS_UNAUTHENTICATED = 10; // Stricter for IP-only
const WINDOW_MS = Number(process.env.CEE_ORCHESTRATOR_RATE_LIMIT_WINDOW_MS) || 60_000; // 1 minute

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
// Key types for logging
// ---------------------------------------------------------------------------

export type RateLimitKeyType = 'user+scenario' | 'user' | 'ip';

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

export function checkRateLimit(key: string, now: number = Date.now(), limit: number = MAX_REQUESTS): RateLimitResult {
  let entry = _store.get(key);

  // Lazy reset if window has expired
  if (!entry || now >= entry.windowStart + WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    _store.set(key, entry);
  }

  entry.count += 1;

  const resetAt = entry.windowStart + WINDOW_MS;
  const remaining = Math.max(0, limit - entry.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  return {
    allowed: entry.count <= limit,
    limit,
    remaining,
    resetAt,
    retryAfterSeconds,
  };
}

/**
 * Resolve rate-limit key and type from request.
 *
 * Key priority:
 *   user:{sub}:scenario:{scenario_id} → user:{sub} → ip:{ip}
 *
 * Unauthenticated traffic always uses IP-only at the stricter limit.
 * scenario_id from unauthenticated requests is untrusted and ignored
 * to prevent limit evasion via scenario rotation.
 */
export function resolveRateLimitKey(
  request: FastifyRequest,
  scenarioId?: string,
): { key: string; keyType: RateLimitKeyType; limit: number } {
  const sub = extractJwtSub(request.headers.authorization);

  if (sub && scenarioId) {
    return { key: `user:${sub}:scenario:${scenarioId}`, keyType: 'user+scenario', limit: MAX_REQUESTS };
  }
  if (sub) {
    return { key: `user:${sub}`, keyType: 'user', limit: MAX_REQUESTS };
  }

  // Unauthenticated: IP-only, stricter limit. scenario_id ignored.
  const ip = extractClientIp(request);
  return { key: `ip:${ip}`, keyType: 'ip', limit: MAX_REQUESTS_UNAUTHENTICATED };
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
      // Extract scenario_id from body if available (body is parsed by this point)
      const body = request.body as Record<string, unknown> | undefined;
      const scenarioId = typeof body?.scenario_id === 'string' ? body.scenario_id : undefined;

      const { key, keyType, limit } = resolveRateLimitKey(request, scenarioId);
      const result = checkRateLimit(key, Date.now(), limit);
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
          key_type: keyType,
          limit: result.limit,
          window_ms: WINDOW_MS,
        }, 'Orchestrator rate limit exceeded');

        // cee.error.v1 shape — matches buildCeeErrorResponse() contract
        const responseBody = {
          schema: 'cee.error.v1',
          code: 'CEE_RATE_LIMIT',
          message: "You're sending messages faster than Olumi can process them. Please wait a moment before your next message.",
          retryable: true,
          source: 'cee',
          request_id: requestId,
          details: {
            retry_after_seconds: result.retryAfterSeconds,
          },
        };

        reply.code(429).send(responseBody);
        return;
      }
    } catch (err: unknown) {
      // Fail open — log structured warning and allow the request through
      const requestId = getRequestId(request);
      log.warn({
        event: 'rate_limit_error',
        request_id: requestId,
        route: request.url,
        error: err instanceof Error ? err.message : String(err),
      }, 'Rate limiter error — failing open');
    }
  };
}
