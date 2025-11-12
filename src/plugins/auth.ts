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
import { env } from "node:process";
import { emit, TelemetryEvents, log } from "../utils/telemetry.js";
import { checkQuota, recordRequest, getKeyQuotaConfig } from "../utils/per-key-quotas.js";
import { getRequestId } from "../utils/request-id.js";

// Rate limit: 120 requests per minute per key (2 req/sec sustained)
const RATE_LIMIT_RPM = Number(env.RATE_LIMIT_RPM) || 120;
const _RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// SSE rate limit: 20 requests per minute per key
const SSE_RATE_LIMIT_RPM = Number(env.SSE_RATE_LIMIT_RPM) || 20;

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
}

interface KeyMetadata {
  keyId: string; // sha256 hash prefix for logging
  bucket: TokenBucket;
  sseBucket: TokenBucket;
  requestCount: number;
  lastUsed: number;
}

const keyMetadata = new Map<string, KeyMetadata>();

/**
 * Get or create metadata for an API key
 */
function getKeyMetadata(apiKey: string): KeyMetadata {
  if (!keyMetadata.has(apiKey)) {
    // Generate short hash for telemetry (first 8 chars of sha256)
    const keyId = hashKeyId(apiKey);

    keyMetadata.set(apiKey, {
      keyId,
      bucket: createTokenBucket(RATE_LIMIT_RPM),
      sseBucket: createTokenBucket(SSE_RATE_LIMIT_RPM),
      requestCount: 0,
      lastUsed: Date.now(),
    });
  }

  const metadata = keyMetadata.get(apiKey)!;
  metadata.lastUsed = Date.now();
  metadata.requestCount++;

  return metadata;
}

/**
 * Create a token bucket for rate limiting
 */
function createTokenBucket(rpm: number): TokenBucket {
  return {
    tokens: rpm,
    lastRefill: Date.now(),
    capacity: rpm,
    refillRate: rpm / 60, // tokens per second
  };
}

/**
 * Refill token bucket based on elapsed time
 */
function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  const tokensToAdd = elapsedSeconds * bucket.refillRate;

  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;
}

/**
 * Try to consume a token from the bucket
 * Returns true if successful, false if rate limited
 */
function tryConsume(bucket: TokenBucket): boolean {
  refillBucket(bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}

/**
 * Hash API key to short ID for logging (non-reversible)
 */
function hashKeyId(apiKey: string): string {
  // Simple hash for telemetry (not cryptographic, just for grouping)
  let hash = 0;
  for (let i = 0; i < apiKey.length; i++) {
    hash = ((hash << 5) - hash) + apiKey.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

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
function isPublicRoute(path: string): boolean {
  const publicRoutes = [
    "/healthz",
    "/health",
    "/",
  ];

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
  }

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public routes
    if (isPublicRoute(request.url)) {
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
    if (validKeys.size === 0) {
      return;
    }

    // Extract API key
    const apiKey = extractApiKey(request);

    if (!apiKey) {
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
    if (!validKeys.has(apiKey)) {
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

    // Get key metadata
    const metadata = getKeyMetadata(apiKey);

    // Check rate limit (token bucket - short-term spike protection)
    const isSSE = isSseRequest(request);
    const bucket = isSSE ? metadata.sseBucket : metadata.bucket;
    const allowed = tryConsume(bucket);

    if (!allowed) {
      emit(TelemetryEvents.RateLimited, {
        key_id: metadata.keyId,
        path: request.url,
        is_sse: isSSE,
      });

      // Calculate retry-after in seconds
      const tokensNeeded = 1 - bucket.tokens;
      const retryAfterSec = Math.ceil(tokensNeeded / bucket.refillRate);

      return reply.code(429).send({
        schema: "error.v1",
        code: "RATE_LIMITED",
        message: "Rate limit exceeded.",
        details: {
          retry_after_seconds: retryAfterSec,
        },
      });
    }

    // V1.5 PR L: Check per-key quotas (rolling windows - long-term protection)
    const quotaConfig = getKeyQuotaConfig(metadata.keyId);
    const quotaCheck = checkQuota(metadata.keyId, quotaConfig);

    if (!quotaCheck.allowed) {
      const requestId = getRequestId(request);

      emit(TelemetryEvents.QuotaExceeded, {
        key_id: metadata.keyId,
        path: request.url,
        reason: quotaCheck.reason,
        retry_after: quotaCheck.retryAfter,
      });

      return reply.code(429).send({
        schema: "error.v1",
        code: "QUOTA_EXCEEDED",
        message: `Quota exceeded: ${quotaCheck.reason}`,
        details: {
          retry_after_seconds: quotaCheck.retryAfter || 3600,
          reason: quotaCheck.reason,
        },
        request_id: requestId,
      });
    }

    // Record request in quota windows
    recordRequest(metadata.keyId);

    // Auth successful
    emit(TelemetryEvents.AuthSuccess, {
      key_id: metadata.keyId,
      path: request.url,
    });

    // Attach key metadata to request for downstream use
    (request as any).keyMetadata = metadata;
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
 * Get key metadata from request (if authenticated)
 */
export function getRequestKeyMetadata(request: FastifyRequest): KeyMetadata | null {
  return (request as any).keyMetadata || null;
}
