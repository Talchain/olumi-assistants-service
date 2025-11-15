/**
 * Quota & Rate Limiting - Dual-mode (Redis + Memory fallback)
 *
 * Token bucket implementation with Redis persistence for multi-instance safety.
 * Falls back to in-memory buckets when Redis unavailable.
 *
 * Features:
 * - Token bucket rate limiting (continuous refill)
 * - Per-key quotas (separate buckets for standard and SSE requests)
 * - Redis persistence for multi-instance deployments
 * - In-memory fallback for single-instance or Redis failures
 * - Atomic Redis operations via Lua script (prevents race conditions)
 *
 * Environment:
 * - RATE_LIMIT_RPM: Standard rate limit (default: 120 req/min)
 * - SSE_RATE_LIMIT_RPM: SSE rate limit (default: 20 req/min)
 * - REDIS_QUOTA_ENABLED: Use Redis backend (default: false, requires REDIS_URL)
 *
 * Redis key patterns:
 * - qc:{keyId}:bucket - Standard bucket state
 * - qc:{keyId}:sse - SSE bucket state
 */

import { getRedis } from "../platform/redis.js";
import { log } from "./telemetry.js";
import { fastHash } from "./hash.js";

/**
 * Lua script for atomic token bucket consumption
 * Args: bucket_key, capacity, refill_rate, ttl_seconds
 * Returns: {allowed: 0|1, tokens: number, retry_after_seconds?: number}
 */
const LUA_CONSUME_TOKEN = `
local bucket_key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local ttl_seconds = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

-- Get existing bucket or initialize new one
local bucket_data = redis.call('GET', bucket_key)
local bucket
if bucket_data then
  bucket = cjson.decode(bucket_data)
else
  bucket = {
    tokens = capacity,
    lastRefill = now,
    capacity = capacity,
    refillRate = refill_rate
  }
end

-- Refill tokens based on elapsed time
local elapsed_seconds = (now - bucket.lastRefill) / 1000
local tokens_to_add = elapsed_seconds * bucket.refillRate
bucket.tokens = math.min(bucket.capacity, bucket.tokens + tokens_to_add)
bucket.lastRefill = now

-- Try to consume token
if bucket.tokens >= 1 then
  bucket.tokens = bucket.tokens - 1
  redis.call('SET', bucket_key, cjson.encode(bucket), 'EX', ttl_seconds)
  return cjson.encode({allowed = 1, tokens = bucket.tokens})
else
  -- Rate limited - calculate retry delay
  local tokens_needed = 1 - bucket.tokens
  local retry_after_seconds = math.ceil(tokens_needed / bucket.refillRate)
  return cjson.encode({allowed = 0, tokens = bucket.tokens, retry_after_seconds = retry_after_seconds})
end
`;

// Rate limits (configurable via environment)
const RATE_LIMIT_RPM = Number(process.env.RATE_LIMIT_RPM) || 120;
const SSE_RATE_LIMIT_RPM = Number(process.env.SSE_RATE_LIMIT_RPM) || 20;

// Redis backend toggle
const REDIS_QUOTA_ENABLED = process.env.REDIS_QUOTA_ENABLED === "true";

/**
 * Token bucket state
 */
export interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
}

/**
 * Per-key quota metadata
 */
export interface KeyQuota {
  keyId: string; // hash for telemetry
  bucket: TokenBucket;
  sseBucket: TokenBucket;
  requestCount: number;
  lastUsed: number;
}

// In-memory fallback storage
const memoryQuotas = new Map<string, KeyQuota>();

/**
 * Get Redis key for bucket state
 */
function getBucketKey(keyId: string, isSse: boolean): string {
  return `qc:${keyId}:${isSse ? "sse" : "bucket"}`;
}

/**
 * Create a new token bucket
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
 * Get or create quota for API key (dual-mode: Redis + memory fallback)
 */
export async function getKeyQuota(apiKey: string): Promise<KeyQuota> {
  const keyId = fastHash(apiKey, 8);

  // Try Redis first if enabled
  if (REDIS_QUOTA_ENABLED) {
    const redis = await getRedis();

    if (redis) {
      try {
        // Load bucket state from Redis
        const standardKey = getBucketKey(keyId, false);
        const sseKey = getBucketKey(keyId, true);

        const [standardData, sseData] = await Promise.all([
          redis.get(standardKey),
          redis.get(sseKey),
        ]);

        let bucket: TokenBucket;
        let sseBucket: TokenBucket;

        if (standardData) {
          bucket = JSON.parse(standardData);
        } else {
          // First time seeing this key - initialize
          bucket = createTokenBucket(RATE_LIMIT_RPM);
          await redis.set(standardKey, JSON.stringify(bucket), "EX", 3600); // 1 hour TTL
        }

        if (sseData) {
          sseBucket = JSON.parse(sseData);
        } else {
          sseBucket = createTokenBucket(SSE_RATE_LIMIT_RPM);
          await redis.set(sseKey, JSON.stringify(sseBucket), "EX", 3600);
        }

        return {
          keyId,
          bucket,
          sseBucket,
          requestCount: 0, // Not tracked in Redis (use telemetry)
          lastUsed: Date.now(),
        };
      } catch (error) {
        log.warn({ error, key_id: keyId }, "Redis quota fetch failed, using memory fallback");
      }
    }
  }

  // Fallback to in-memory quota
  return getKeyQuotaFromMemory(apiKey, keyId);
}

/**
 * Get quota from in-memory storage
 */
function getKeyQuotaFromMemory(apiKey: string, keyId: string): KeyQuota {
  if (!memoryQuotas.has(apiKey)) {
    memoryQuotas.set(apiKey, {
      keyId,
      bucket: createTokenBucket(RATE_LIMIT_RPM),
      sseBucket: createTokenBucket(SSE_RATE_LIMIT_RPM),
      requestCount: 0,
      lastUsed: Date.now(),
    });
  }

  const quota = memoryQuotas.get(apiKey)!;
  quota.lastUsed = Date.now();
  quota.requestCount++;

  return quota;
}

/**
 * Snapshot quota state for a given key ID without consuming tokens.
 *
 * Used by /v1/limits to expose remaining tokens and refill ETA.
 */
export async function getQuotaSnapshotByKeyId(
  keyId: string,
  isSse: boolean
): Promise<{
  backend: "redis" | "memory";
  capacity: number;
  tokens?: number;
  refillRate?: number;
  retryAfterSeconds?: number;
}> {
  const rpm = isSse ? SSE_RATE_LIMIT_RPM : RATE_LIMIT_RPM;

  // If Redis backend is enabled, try to read bucket state directly
  if (REDIS_QUOTA_ENABLED) {
    const redis = await getRedis();

    if (redis) {
      try {
        const bucketKey = getBucketKey(keyId, isSse);
        const bucketData = await redis.get(bucketKey);

        let bucket: TokenBucket;
        if (bucketData) {
          bucket = JSON.parse(bucketData) as TokenBucket;
        } else {
          // No bucket yet – treat as full capacity (no writes in snapshot path)
          bucket = createTokenBucket(rpm);
        }

        // Work on a shallow copy so we don't mutate stored state
        const snapshotBucket: TokenBucket = { ...bucket };
        refillBucket(snapshotBucket);

        const capacity = snapshotBucket.capacity;
        const tokens = snapshotBucket.tokens;
        const refillRate = snapshotBucket.refillRate;

        let retryAfterSeconds = 0;
        if (tokens < 1) {
          const tokensNeeded = 1 - tokens;
          retryAfterSeconds = Math.ceil(tokensNeeded / refillRate);
        }

        return {
          backend: "redis",
          capacity,
          tokens,
          refillRate,
          retryAfterSeconds,
        };
      } catch (error) {
        log.warn({ error, key_id: keyId, is_sse: isSse }, "Redis quota snapshot failed, falling back to memory view");
      }
    }
  }

  // Memory view (either backend=memory or Redis unavailable).
  // We key in-memory quotas by raw API key but each KeyQuota carries a hashed
  // keyId, so we can locate the bucket by scanning for the matching keyId.
  for (const quota of memoryQuotas.values()) {
    if (quota.keyId !== keyId) continue;

    const bucket = isSse ? quota.sseBucket : quota.bucket;

    // Work on a shallow copy so we don't mutate the live bucket
    const snapshotBucket: TokenBucket = { ...bucket };
    refillBucket(snapshotBucket);

    const capacity = snapshotBucket.capacity;
    const tokens = snapshotBucket.tokens;
    const refillRate = snapshotBucket.refillRate;

    let retryAfterSeconds = 0;
    if (tokens < 1) {
      const tokensNeeded = 1 - tokens;
      retryAfterSeconds = Math.ceil(tokensNeeded / refillRate);
    }

    return {
      backend: "memory",
      capacity,
      tokens,
      refillRate,
      retryAfterSeconds,
    };
  }

  // No existing quota for this key ID yet – treat as a fresh bucket at full
  // capacity so clients still get meaningful limits information.
  const freshBucket = createTokenBucket(rpm);
  return {
    backend: "memory",
    capacity: freshBucket.capacity,
    tokens: freshBucket.tokens,
    refillRate: freshBucket.refillRate,
    retryAfterSeconds: 0,
  };
}

/**
 * Try to consume a token (dual-mode: Redis + memory fallback)
 */
export async function tryConsumeToken(
  apiKey: string,
  isSse: boolean
): Promise<{
  allowed: boolean;
  retryAfterSeconds?: number;
  keyId: string;
}> {
  const keyId = fastHash(apiKey, 8);

  // Try Redis first if enabled
  if (REDIS_QUOTA_ENABLED) {
    const redis = await getRedis();

    if (redis) {
      try {
        const bucketKey = getBucketKey(keyId, isSse);
        const rpm = isSse ? SSE_RATE_LIMIT_RPM : RATE_LIMIT_RPM;
        const refillRate = rpm / 60; // tokens per second
        const now = Date.now();

        // Execute atomic Lua script to refill and consume token
        const result = await redis.eval(
          LUA_CONSUME_TOKEN,
          1, // number of KEYS
          bucketKey, // KEYS[1]
          rpm.toString(), // ARGV[1] - capacity
          refillRate.toString(), // ARGV[2] - refill_rate
          "3600", // ARGV[3] - TTL in seconds
          now.toString() // ARGV[4] - current timestamp
        ) as string;

        const parsed = JSON.parse(result);

        if (parsed.allowed === 1) {
          return { allowed: true, keyId };
        } else {
          return {
            allowed: false,
            retryAfterSeconds: parsed.retry_after_seconds,
            keyId,
          };
        }
      } catch (error) {
        log.warn(
          { error, key_id: keyId, is_sse: isSse },
          "Redis quota consumption failed, using memory fallback"
        );
      }
    }
  }

  // Fallback to in-memory quota
  return tryConsumeTokenFromMemory(apiKey, keyId, isSse);
}

/**
 * Try to consume token from in-memory storage
 */
function tryConsumeTokenFromMemory(
  apiKey: string,
  keyId: string,
  isSse: boolean
): {
  allowed: boolean;
  retryAfterSeconds?: number;
  keyId: string;
} {
  const quota = getKeyQuotaFromMemory(apiKey, keyId);
  const bucket = isSse ? quota.sseBucket : quota.bucket;

  refillBucket(bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, keyId };
  } else {
    const tokensNeeded = 1 - bucket.tokens;
    const retryAfterSeconds = Math.ceil(tokensNeeded / bucket.refillRate);
    return { allowed: false, retryAfterSeconds, keyId };
  }
}

/**
 * Get quota stats for monitoring (memory-only)
 */
export function getQuotaStats(): {
  total_keys: number;
  backend: "redis" | "memory";
} {
  return {
    total_keys: memoryQuotas.size,
    backend: REDIS_QUOTA_ENABLED ? "redis" : "memory",
  };
}

/**
 * Clear all quotas (for testing)
 */
export async function clearAllQuotas(): Promise<void> {
  const redis = await getRedis();

  if (redis) {
    try {
      // Scan for all quota keys and delete
      let cursor = "0";
      let totalDeleted = 0;

      do {
        const [newCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          "qc:*",
          "COUNT",
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== "0");

      log.info({ deleted: totalDeleted }, "Cleared all quotas from Redis");
    } catch (error) {
      log.error({ error }, "Failed to clear Redis quotas");
    }
  }

  memoryQuotas.clear();
  log.info("Cleared all quotas from memory");
}
