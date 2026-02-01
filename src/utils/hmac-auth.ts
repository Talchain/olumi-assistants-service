/**
 * HMAC Signature Authentication with Replay Protection
 *
 * Provides HMAC-SHA256 signature validation for API requests with:
 * - Timestamp-based replay protection (clock skew tolerance)
 * - Nonce-based replay protection (Redis deduplication)
 * - Backwards compatibility (legacy signatures without timestamp/nonce)
 *
 * Headers:
 * - X-Olumi-Signature: HMAC-SHA256 signature
 * - X-Olumi-Timestamp: Unix timestamp in milliseconds (optional for legacy)
 * - X-Olumi-Nonce: UUID v4 nonce (optional for legacy)
 *
 * Canonical signing string:
 * - New: METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + BODY_SHA256
 * - Legacy: METHOD + "\n" + PATH + "\n" + BODY_SHA256
 *
 * Environment:
 * - HMAC_SECRET: Secret key for signature validation (required for HMAC auth)
 * - HMAC_MAX_SKEW_MS: Clock skew tolerance in milliseconds (default: 300000 = 5 minutes)
 * - REDIS_HMAC_NONCE_ENABLED: Use Redis for nonce deduplication (default: false)
 */

import { createHash } from "node:crypto";
import { verifyHmacSha256 } from "./hash.js";
import { getRedis } from "../platform/redis.js";
import { log, emit } from "./telemetry.js";
import { LruTtlCache } from "./cache.js";
import { config } from "../config/index.js";

/**
 * Telemetry events for Redis fallback monitoring
 */
const HmacTelemetryEvents = {
  RedisFallbackNonceCheck: "hmac.redis_fallback.nonce_check",
  RedisFallbackNonceStore: "hmac.redis_fallback.nonce_store",
} as const;

// In-memory nonce cache (fallback) - LRU with TTL to prevent unbounded growth
// Lazy initialization to use runtime HMAC_MAX_SKEW_MS config
let memoryNonces: LruTtlCache<string, boolean> | null = null;

function getNonceCache(): LruTtlCache<string, boolean> {
  if (!memoryNonces) {
    const config = getHmacConfig();
    const ttlMs = config.maxSkewMs * 2; // Match Redis TTL behavior
    memoryNonces = new LruTtlCache<string, boolean>(10000, ttlMs);
  }
  return memoryNonces;
}

/**
 * Get HMAC configuration from centralized config (read at runtime for testability)
 */
function getHmacConfig() {
  return {
    secret: config.auth.hmacSecret,
    maxSkewMs: config.auth.hmacMaxSkewMs,
    redisNonceEnabled: config.redis.hmacNonceEnabled,
  };
}

/**
 * Get Redis key for nonce
 */
function getNonceKey(nonce: string): string {
  return `hmac:nonce:${nonce}`;
}

/**
 * Compute SHA256 hash of request body
 */
function hashBody(body: string | undefined): string {
  if (!body || body.length === 0) {
    return ""; // Empty body hash
  }

  return createHash("sha256").update(body).digest("hex");
}

/**
 * Build canonical string for signing
 */
function buildCanonicalString(
  method: string,
  path: string,
  timestamp: string | undefined,
  nonce: string | undefined,
  bodyHash: string
): string {
  // New format with timestamp + nonce
  if (timestamp && nonce) {
    return `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  }

  // Legacy format without timestamp/nonce
  return `${method}\n${path}\n${bodyHash}`;
}

/**
 * Verify HMAC signature
 */
export async function verifyHmacSignature(
  method: string,
  path: string,
  body: string | undefined,
  headers: Record<string, string | string[] | undefined>
): Promise<{
  valid: boolean;
  error?: "NO_SECRET" | "MISSING_SIGNATURE" | "SIGNATURE_SKEW" | "REPLAY_BLOCKED" | "INVALID_SIGNATURE";
  legacy?: boolean; // True if validated using legacy format
}> {
  const config = getHmacConfig();

  // Check if HMAC secret is configured
  if (!config.secret) {
    return { valid: false, error: "NO_SECRET" };
  }

  // Extract signature header
  const signature = headers["x-olumi-signature"];
  if (!signature || typeof signature !== "string") {
    return { valid: false, error: "MISSING_SIGNATURE" };
  }

  // Extract optional timestamp and nonce
  const timestamp = headers["x-olumi-timestamp"];
  const nonce = headers["x-olumi-nonce"];

  const timestampStr = typeof timestamp === "string" ? timestamp : undefined;
  const nonceStr = typeof nonce === "string" ? nonce : undefined;

  // Compute body hash
  const bodyHash = hashBody(body);

  // Build canonical string
  const canonical = buildCanonicalString(method, path, timestampStr, nonceStr, bodyHash);

  // Constant-time signature verification (prevents timing attacks)
  if (!verifyHmacSha256(canonical, signature, config.secret)) {
    return { valid: false, error: "INVALID_SIGNATURE" };
  }

  // If using new format (timestamp + nonce), validate timestamp and nonce
  if (timestampStr && nonceStr) {
    // Validate timestamp (clock skew tolerance)
    const requestTime = Number(timestampStr);

    // Reject invalid (non-numeric) timestamps
    if (!Number.isFinite(requestTime) || requestTime <= 0) {
      log.warn(
        { timestamp: timestampStr },
        "HMAC signature timestamp is not a valid number"
      );
      return { valid: false, error: "SIGNATURE_SKEW" };
    }

    const now = Date.now();
    const skew = Math.abs(now - requestTime);

    if (skew > config.maxSkewMs) {
      log.warn(
        { skew_ms: skew, max_skew_ms: config.maxSkewMs },
        "HMAC signature timestamp outside skew window"
      );
      return { valid: false, error: "SIGNATURE_SKEW" };
    }

    // Check nonce for replay protection
    const nonceUsed = await isNonceUsed(nonceStr);
    if (nonceUsed) {
      log.warn({ nonce_prefix: nonceStr.substring(0, 8) }, "HMAC nonce replay detected");
      return { valid: false, error: "REPLAY_BLOCKED" };
    }

    // Mark nonce as used
    await markNonceUsed(nonceStr);

    return { valid: true, legacy: false };
  }

  // Legacy format (no timestamp/nonce) - valid but less secure
  log.info("HMAC signature validated using legacy format (no timestamp/nonce)");
  return { valid: true, legacy: true };
}

/**
 * Check if nonce has been used (dual-mode: Redis + memory fallback)
 */
async function isNonceUsed(nonce: string): Promise<boolean> {
  const config = getHmacConfig();

  if (config.redisNonceEnabled) {
    const redis = await getRedis();

    if (redis) {
      try {
        const nonceKey = getNonceKey(nonce);
        const exists = await redis.exists(nonceKey);
        return exists === 1;
      } catch (error) {
        log.warn({ error, nonce_prefix: nonce.substring(0, 8) }, "Redis nonce check failed, using memory fallback");
        emit(HmacTelemetryEvents.RedisFallbackNonceCheck, {
          nonce_prefix: nonce.substring(0, 8),
          error: String(error),
        });
      }
    }
  }

  // Fallback to in-memory LRU cache
  const cache = getNonceCache();
  return cache.get(nonce) !== undefined;
}

/**
 * Mark nonce as used (dual-mode: Redis + memory fallback)
 */
async function markNonceUsed(nonce: string): Promise<void> {
  const config = getHmacConfig();

  if (config.redisNonceEnabled) {
    const redis = await getRedis();

    if (redis) {
      try {
        const nonceKey = getNonceKey(nonce);
        // TTL = 2 * HMAC_MAX_SKEW_MS (to account for clock skew in both directions)
        const ttlSeconds = Math.max(1, Math.floor((config.maxSkewMs * 2) / 1000));
        await redis.set(nonceKey, "1", "EX", ttlSeconds);

        log.debug({ nonce_prefix: nonce.substring(0, 8), ttl_seconds: ttlSeconds }, "Nonce marked as used in Redis");
        return;
      } catch (error) {
        log.warn({ error, nonce_prefix: nonce.substring(0, 8) }, "Redis nonce storage failed, using memory fallback");
        emit(HmacTelemetryEvents.RedisFallbackNonceStore, {
          nonce_prefix: nonce.substring(0, 8),
          error: String(error),
        });
      }
    }
  }

  // Fallback to in-memory LRU cache (automatic TTL and eviction)
  const cache = getNonceCache();
  cache.set(nonce, true);
  log.debug({ nonce_prefix: nonce.substring(0, 8) }, "Nonce marked as used in memory LRU");
}

/**
 * Clear all nonces (for testing)
 */
export async function clearAllNonces(): Promise<void> {
  const redis = await getRedis();

  if (redis) {
    try {
      let cursor = "0";
      let totalDeleted = 0;

      do {
        const [newCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          "hmac:nonce:*",
          "COUNT",
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== "0");

      log.info({ deleted: totalDeleted }, "Cleared all HMAC nonces from Redis");
    } catch (error) {
      log.error({ error }, "Failed to clear Redis HMAC nonces");
    }
  }

  const cache = getNonceCache();
  cache.clear();
  log.info("Cleared all HMAC nonces from memory");
}
