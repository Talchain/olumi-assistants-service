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
import { config } from "../config/index.js";

/**
 * Get valid API keys from centralized config
 */
function getValidApiKeys(): Set<string> {
  const keys = new Set<string>();

  // Single key (backwards compat)
  if (config.auth.assistApiKey) {
    keys.add(config.auth.assistApiKey);
  }

  // Multiple keys (already parsed as array)
  if (config.auth.assistApiKeys) {
    config.auth.assistApiKeys.forEach(k => keys.add(k));
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
    "/admin", // Admin UI and admin APIs have their own auth via X-Admin-Key
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
 * Extend FastifyRequest to include raw body for HMAC verification
 */
declare module "fastify" {
  interface FastifyRequest {
    /** Raw request body bytes captured before JSON parsing for HMAC verification */
    rawBody?: string;
    /** Flag indicating HMAC auth is pending (deferred to preHandler) */
    _hmacAuthPending?: boolean;
  }
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

  // Capture raw request body BEFORE JSON parsing for HMAC signature verification
  // This ensures the signature is verified against the exact bytes sent by the client,
  // not a re-stringified version that might have different key ordering
  fastify.addHook("preParsing", async (request: FastifyRequest, _reply, payload) => {
    // Only capture for routes that might use HMAC auth (non-public routes with body)
    if (isPublicRoute(request.url, request.method)) {
      return payload;
    }

    // Only capture for content types we care about (JSON)
    const contentType = request.headers["content-type"];
    if (!contentType || !contentType.includes("application/json")) {
      return payload;
    }

    // Capture the raw body bytes
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf-8");
    request.rawBody = rawBody;

    // Return a new readable stream with the same content for the body parser
    const { Readable } = await import("node:stream");
    return Readable.from([rawBody]);
  });

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
      !config.features.enableLegacySSE;

    if (isLegacySSEPath) {
      log.info({ path: request.url, legacy_sse_disabled: true }, "Skipping auth for legacy SSE deprecation path");
      return; // Let route return 426
    }

    // Get valid keys from config
    const validKeys = getValidApiKeys();

    // If no keys configured, skip auth
    if (validKeys.size === 0 && !config.auth.hmacSecret) {
      return; // No auth configured
    }

    // Check for HMAC signature (preferred method)
    const hasSignature = request.headers["x-olumi-signature"];

    let apiKey: string | null = null;
    let keyId: string | null = null;

    if (hasSignature && config.auth.hmacSecret) {
      // HMAC signature authentication requires the raw body bytes which are captured
      // in preParsing hook. Since onRequest runs before preParsing, we need to defer
      // HMAC verification to preHandler hook where rawBody is available.
      // Mark request as pending HMAC auth and continue.
      request._hmacAuthPending = true;
      return; // HMAC auth will be completed in preHandler hook
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
          code: "UNAUTHENTICATED",
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
    const hmacAuth = hasSignature !== undefined && config.auth.hmacSecret !== undefined;
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

  // Complete HMAC auth in preHandler (after preParsing has captured rawBody)
  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    // Only process if HMAC auth was deferred from onRequest
    if (!request._hmacAuthPending) {
      return;
    }

    // Clear the pending flag
    request._hmacAuthPending = false;

    const validKeys = getValidApiKeys();

    // HMAC signature authentication (preferred)
    // Use raw body bytes captured in preParsing hook to ensure signature verification
    // matches the exact bytes sent by the client, not re-stringified JSON
    const body = request.rawBody ??
                 (typeof request.body === "string" ? request.body :
                 request.body ? JSON.stringify(request.body) : undefined);

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
          code: "FORBIDDEN",
          message: `HMAC signature validation failed: ${hmacResult.error}`,
          details: {
            hmac_error: hmacResult.error,
          },
        });
      }

      // Fall through to API key auth if available
      const extractedKey = extractApiKey(request);
      if (!extractedKey || !validKeys.has(extractedKey)) {
        emit(TelemetryEvents.AuthFailed, {
          reason: extractedKey ? "invalid_key" : "missing_header",
          path: request.url,
        });

        return reply.code(extractedKey ? 403 : 401).send({
          schema: "error.v1",
          code: extractedKey ? "FORBIDDEN" : "UNAUTHENTICATED",
          message: extractedKey ? "Invalid API key." : "Missing API key. Provide X-Olumi-Assist-Key header.",
        });
      }

      // API key fallback successful
      const isSSE = isSseRequest(request);
      const quotaResult = await tryConsumeToken(extractedKey, isSSE);

      if (!quotaResult.allowed) {
        emit(TelemetryEvents.RateLimited, {
          key_id: quotaResult.keyId,
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

      // API key fallback auth successful
      const ctx = attachCallerContext(request, {
        keyId: quotaResult.keyId!,
        hmacAuth: false,
        sourceIp: request.ip,
        userAgent: request.headers["user-agent"] as string | undefined,
        correlationId: request.headers["x-correlation-id"] as string | undefined,
      });

      emit(TelemetryEvents.AuthSuccess, {
        key_id: quotaResult.keyId!,
        path: request.url,
        hmac_auth: false,
        correlation_id: ctx.correlationId,
      });

      (request as any).keyId = quotaResult.keyId;
      return;
    }

    // HMAC auth successful - use HMAC secret as the "API key" for quota tracking
    log.info(
      { legacy: hmacResult.legacy, path: request.url },
      "HMAC signature authentication successful"
    );

    const isSSE = isSseRequest(request);
    const quotaResult = await tryConsumeToken(config.auth.hmacSecret!, isSSE);

    if (!quotaResult.allowed) {
      emit(TelemetryEvents.RateLimited, {
        key_id: quotaResult.keyId,
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

    // HMAC auth successful - attach context
    const ctx = attachCallerContext(request, {
      keyId: quotaResult.keyId!,
      hmacAuth: true,
      sourceIp: request.ip,
      userAgent: request.headers["user-agent"] as string | undefined,
      correlationId: request.headers["x-correlation-id"] as string | undefined,
    });

    emit(TelemetryEvents.AuthSuccess, {
      key_id: quotaResult.keyId!,
      path: request.url,
      hmac_auth: true,
      correlation_id: ctx.correlationId,
    });

    (request as any).keyId = quotaResult.keyId;
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
