/**
 * API Key Authentication & Per-Key Quotas
 *
 * Supports:
 * - Single key via ASSIST_API_KEY (backwards compat)
 * - Multiple keys via ASSIST_API_KEYS (comma-separated)
 * - Per-key rate limiting (token bucket)
 * - Per-key quotas
 * - Telemetry per key
 *
 * Public routes: /healthz
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { emit, TelemetryEvents, log } from "../utils/telemetry.js";
import { tryConsumeToken } from "../utils/quota.js";
import { verifyHmacSignature } from "../utils/hmac-auth.js";
import { attachCallerContext, getCallerContext, type CallerContext } from "../context/index.js";

/**
 * Get valid API keys from environment
 * Use process.env directly to avoid module-level caching issues in tests
 */
function getValidApiKeys(): Set<string> {
  const keys = new Set<string>();

  // Single key (backwards compat)
  if (process.env.ASSIST_API_KEY) {
    keys.add(process.env.ASSIST_API_KEY);
  }

  // Multiple keys (comma-separated)
  if (process.env.ASSIST_API_KEYS) {
    const multiKeys = process.env.ASSIST_API_KEYS.split(",")
      .map(k => k.trim())
      .filter(k => k.length > 0);

    multiKeys.forEach(k => keys.add(k));
  }

  return keys;
}

/**
 * Check if route is public (no auth required)
 */
function isPublicRoute(path: string, method?: string): boolean {
  const publicRoutes = [
    "/healthz",
    "/health",
    "/",
    "/v1/status",
  ];

  // Share GET/DELETE are public (token-based auth)
  if ((method === "GET" || method === "DELETE") && path.startsWith("/assist/share/")) {
    return true;
  }

  return publicRoutes.some(route => path === route || path.startsWith(route + "/"));
}

/**
 * Extract API key from request headers
 */
function extractApiKey(request: FastifyRequest): string | null {
  // Check X-Olumi-Assist-Key header
  const header = request.headers["x-olumi-assist-key"];

  if (typeof header === "string") {
    return header;
  }

  // Also check Authorization: Bearer <key>
  const authHeader = request.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Check if request is for SSE endpoint (stricter rate limit)
 */
function isSseRequest(request: FastifyRequest): boolean {
  return request.url.includes("/stream") ||
         request.headers["accept"] === "text/event-stream";
}

/**
 * Auth plugin (internal implementation)
 */
async function authPluginImpl(fastify: FastifyInstance) {
  // Log initial state (but re-read keys on each request for testability)
  const initialKeys = getValidApiKeys();

  if (initialKeys.size === 0) {
    log.warn("No API keys configured (ASSIST_API_KEY or ASSIST_API_KEYS). Auth disabled.");
  } else {
    // Only log the count - avoid logging any partial key information
    log.info({ count: initialKeys.size }, "API keys configured");
  }

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public routes
    if (isPublicRoute(request.url, request.method)) {
      return;
    }

    // V04: Skip auth for legacy SSE deprecation path (426 Upgrade Required)
    // Allow unauthenticated requests to /assist/draft-graph with Accept: text/event-stream
    // when ENABLE_LEGACY_SSE is disabled, so the route can return 426 upgrade guidance
    const isLegacySSEPath =
      request.url === "/assist/draft-graph" &&
      (request.headers.accept?.includes("text/event-stream") ?? false) &&
      process.env.ENABLE_LEGACY_SSE !== "true";

    if (isLegacySSEPath) {
      log.info({ path: request.url, legacy_sse_disabled: true }, "Skipping auth for legacy SSE deprecation path");
      return; // Let route return 426
    }

    // Re-read keys on each request (for testability)
    const validKeys = getValidApiKeys();

    // If no keys configured, skip auth
    if (validKeys.size === 0 && !process.env.HMAC_SECRET) {
      return; // No auth configured
    }

    // Check for HMAC signature (preferred method)
    const hasSignature = request.headers["x-olumi-signature"];

    let apiKey: string | null = null;
    let keyId: string | null = null;

    if (hasSignature && process.env.HMAC_SECRET) {
      // HMAC signature authentication (preferred)
      const body = typeof request.body === "string" ? request.body :
                   request.body ? JSON.stringify(request.body) : undefined;

      const hmacResult = await verifyHmacSignature(
        request.method,
        request.url,
        body,
        request.headers as Record<string, string | string[] | undefined>
      );

      if (!hmacResult.valid) {
        emit(TelemetryEvents.AuthFailed, {
          reason: hmacResult.error,
          path: request.url,
          hmac: true,
          fallback: validKeys.size > 0 ? "api_key" : "none",
        });

        // If no API keys are configured, behave as before and fail hard on HMAC
        if (validKeys.size === 0) {
          return reply.code(403).send({
            schema: "error.v1",
            code: hmacResult.error || "FORBIDDEN",
            message: `HMAC signature validation failed: ${hmacResult.error}`,
          });
        }

        // Otherwise, fall through to API key auth
      } else {
        // HMAC auth successful - use HMAC secret as the "API key" for quota tracking
        apiKey = process.env.HMAC_SECRET;
        // keyId will be set by tryConsumeToken below

        log.info(
          { legacy: hmacResult.legacy, path: request.url },
          "HMAC signature authentication successful"
        );
      }
    }

    // Fallback or primary path: API key authentication
    if (!apiKey) {
      const extractedKey = extractApiKey(request);

      if (!extractedKey) {
        emit(TelemetryEvents.AuthFailed, {
          reason: "missing_header",
          path: request.url,
        });

        return reply.code(401).send({
          schema: "error.v1",
          code: "FORBIDDEN",
          message: "Missing API key. Provide X-Olumi-Assist-Key header.",
        });
      }

      // Validate API key
      if (!validKeys.has(extractedKey)) {
        emit(TelemetryEvents.AuthFailed, {
          reason: "invalid_key",
          path: request.url,
        });

        return reply.code(403).send({
          schema: "error.v1",
          code: "FORBIDDEN",
          message: "Invalid API key.",
        });
      }

      apiKey = extractedKey;
      // keyId will be set by tryConsumeToken below
    }

    // Check rate limit (dual-mode: Redis + memory fallback)
    const isSSE = isSseRequest(request);
    const quotaResult = await tryConsumeToken(apiKey, isSSE);
    keyId = quotaResult.keyId;

    if (!quotaResult.allowed) {
      emit(TelemetryEvents.RateLimited, {
        key_id: keyId,
        path: request.url,
        is_sse: isSSE,
      });

      return reply.code(429).send({
        schema: "error.v1",
        code: "RATE_LIMITED",
        message: "Rate limit exceeded.",
        details: {
          retry_after_seconds: quotaResult.retryAfterSeconds || 1,
        },
      });
    }

    // Auth successful - attach full caller context
    const hmacAuth = hasSignature !== undefined && process.env.HMAC_SECRET !== undefined;
    const ctx = attachCallerContext(request, {
      keyId: keyId!,
      hmacAuth,
      sourceIp: request.ip,
      userAgent: request.headers["user-agent"] as string | undefined,
      correlationId: request.headers["x-correlation-id"] as string | undefined,
    });

    emit(TelemetryEvents.AuthSuccess, {
      key_id: keyId!,
      path: request.url,
      hmac_auth: hmacAuth,
      correlation_id: ctx.correlationId,
    });

    // Also attach keyId directly for backwards compatibility
    (request as any).keyId = keyId;
  });
}

/**
 * Auth plugin (exported with fastify-plugin to break encapsulation)
 */
export const authPlugin = fp(authPluginImpl, {
  name: "auth",
  fastify: "5.x",
});

/**
 * Get key ID from request (if authenticated)
 * @deprecated Use getCallerContext() instead for full context access
 */
export function getRequestKeyId(request: FastifyRequest): string | null {
  return (request as any).keyId || null;
}

/**
 * Get full caller context from request (if authenticated)
 * Returns undefined for unauthenticated requests or public routes.
 *
 * @example
 * ```typescript
 * const ctx = getRequestCallerContext(request);
 * if (ctx) {
 *   log.info({ ...contextToTelemetry(ctx) }, 'Processing request');
 * }
 * ```
 */
export function getRequestCallerContext(request: FastifyRequest): CallerContext | undefined {
  return getCallerContext(request);
}

// Re-export CallerContext type for convenience
export type { CallerContext };
