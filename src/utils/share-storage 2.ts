/**
 * Share Storage
 *
 * Dual-mode storage with Redis (production) and in-memory (fallback/dev).
 * Redis provides TTL-based expiry and multi-instance safety.
 * In-memory mode used when REDIS_URL not configured.
 */

import type { GraphT } from "../schemas/graph.js";
import { getRedis, isRedisAvailable } from "../platform/redis.js";
import { log } from "./telemetry.js";

export interface ShareData {
  share_id: string;
  graph: GraphT;
  brief?: string;
  created_at: number;
  expires_at: number;
  revoked: boolean;
  access_count: number;
}

// In-memory fallback store (keyed by share_id)
const memoryShares = new Map<string, ShareData>();

// Force in-memory mode (for testing or when SHARE_STORAGE_INMEMORY=true)
const forceInMemory = process.env.SHARE_STORAGE_INMEMORY === "true";

/**
 * Get Redis key for share
 */
function getShareKey(shareId: string): string {
  return `share:${shareId}`;
}

/**
 * Get Redis key for revoked status
 */
function getRevokedKey(shareId: string): string {
  return `share:revoked:${shareId}`;
}

/**
 * Get Redis key for access counter
 */
function getAccessKey(shareId: string): string {
  return `share:access:${shareId}`;
}

/**
 * Store share data
 */
export async function storeShare(data: ShareData): Promise<void> {
  const redis = !forceInMemory && (await getRedis());

  if (redis) {
    try {
      const key = getShareKey(data.share_id);
      const ttlSeconds = Math.max(
        1,
        Math.floor((data.expires_at - Date.now()) / 1000)
      );

      // Store share data with TTL
      await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);

      log.info(
        { share_id: data.share_id, ttl_seconds: ttlSeconds, storage: "redis" },
        "Share stored in Redis"
      );
    } catch (error) {
      log.error({ error, share_id: data.share_id }, "Redis store failed, using memory fallback");
      memoryShares.set(data.share_id, data);
    }
  } else {
    memoryShares.set(data.share_id, data);
    log.debug({ share_id: data.share_id, storage: "memory" }, "Share stored in memory");
  }
}

/**
 * Retrieve share data
 * Returns null if not found, expired, or revoked
 */
export async function getShare(shareId: string): Promise<ShareData | null> {
  const redis = !forceInMemory && (await getRedis());

  if (redis) {
    try {
      const key = getShareKey(shareId);
      const revokedKey = getRevokedKey(shareId);
      const accessKey = getAccessKey(shareId);

      // Check if revoked
      const isRevoked = await redis.exists(revokedKey);
      if (isRevoked) {
        return null;
      }

      // Get share data
      const raw = await redis.get(key);
      if (!raw) {
        return null;
      }

      const data: ShareData = JSON.parse(raw);

      // Check expiry (Redis TTL should handle this, but double-check)
      if (Date.now() > data.expires_at) {
        await redis.del(key);
        return null;
      }

      // Increment access count (separate counter for atomicity)
      const newCount = await redis.incr(accessKey);
      data.access_count = newCount;

      // Set TTL on access counter to match share TTL
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        await redis.expire(accessKey, ttl);
      }

      return data;
    } catch (error) {
      log.error({ error, share_id: shareId }, "Redis get failed, checking memory fallback");
      return getShareFromMemory(shareId);
    }
  } else {
    return getShareFromMemory(shareId);
  }
}

/**
 * Get share from memory fallback
 */
function getShareFromMemory(shareId: string): ShareData | null {
  const data = memoryShares.get(shareId);
  if (!data) {
    return null;
  }

  // Check expiry
  if (Date.now() > data.expires_at) {
    memoryShares.delete(shareId);
    return null;
  }

  // Check revocation
  if (data.revoked) {
    return null;
  }

  // Increment access count
  data.access_count++;

  return data;
}

/**
 * Revoke share (soft delete)
 */
export async function revokeShare(shareId: string): Promise<boolean> {
  const redis = !forceInMemory && (await getRedis());

  if (redis) {
    try {
      const key = getShareKey(shareId);
      const revokedKey = getRevokedKey(shareId);
      const accessKey = getAccessKey(shareId);

      // Check if share exists
      const exists = await redis.exists(key);
      if (!exists) {
        // Try memory fallback
        return revokeShareInMemory(shareId);
      }

      // Get TTL to set same expiry on revoked marker
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        await redis.set(revokedKey, "1", "EX", ttl);
      } else {
        await redis.set(revokedKey, "1", "EX", 86400); // 24h default
      }

      // Delete primary share data and access counter to free memory
      await redis.del(key);
      await redis.del(accessKey);

      log.info({ share_id: shareId, storage: "redis" }, "Share revoked in Redis (data deleted)");
      return true;
    } catch (error) {
      log.error({ error, share_id: shareId }, "Redis revoke failed, using memory fallback");
      return revokeShareInMemory(shareId);
    }
  } else {
    return revokeShareInMemory(shareId);
  }
}

/**
 * Revoke share in memory fallback
 */
function revokeShareInMemory(shareId: string): boolean {
  const data = memoryShares.get(shareId);
  if (!data) {
    return false;
  }

  // Mark as revoked and delete from memory (consistent with Redis behavior)
  data.revoked = true;
  memoryShares.delete(shareId);

  log.debug({ share_id: shareId, storage: "memory" }, "Share revoked and deleted from memory");
  return true;
}

/**
 * Cleanup expired shares (for memory mode only - Redis uses TTL)
 */
export function cleanupExpiredShares(): number {
  if (isRedisAvailable() && !forceInMemory) {
    // Redis handles cleanup via TTL
    return 0;
  }

  const now = Date.now();
  let cleaned = 0;

  for (const [shareId, data] of memoryShares.entries()) {
    if (now > data.expires_at) {
      memoryShares.delete(shareId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    log.info({ cleaned, storage: "memory" }, "Cleaned up expired shares from memory");
  }

  return cleaned;
}

/**
 * Get storage stats (for monitoring)
 */
export async function getStorageStats(): Promise<{
  total: number;
  active: number;
  revoked: number;
  storage: "redis" | "memory";
}> {
  const redis = !forceInMemory && (await getRedis());

  if (redis) {
    try {
      // Count shares in Redis using SCAN
      let cursor = "0";
      let total = 0;
      let revoked = 0;

      do {
        const [newCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          "share:*",
          "COUNT",
          100
        );
        cursor = newCursor;

        for (const key of keys) {
          if (key.includes(":revoked:")) {
            revoked++;
          } else if (key.startsWith("share:") && !key.includes(":access:")) {
            total++;
          }
        }
      } while (cursor !== "0");

      const active = total; // In Redis, expired shares are auto-removed

      return { total, active, revoked, storage: "redis" };
    } catch (error) {
      log.error({ error }, "Redis stats failed, using memory fallback");
      return getStorageStatsFromMemory();
    }
  } else {
    return getStorageStatsFromMemory();
  }
}

/**
 * Get storage stats from memory fallback
 */
function getStorageStatsFromMemory(): {
  total: number;
  active: number;
  revoked: number;
  storage: "memory";
} {
  let active = 0;
  let revoked = 0;

  for (const data of memoryShares.values()) {
    if (data.revoked) {
      revoked++;
    } else {
      active++;
    }
  }

  return { total: memoryShares.size, active, revoked, storage: "memory" };
}

/**
 * Clear all shares (for testing)
 */
export async function clearAllShares(): Promise<void> {
  const redis = !forceInMemory && (await getRedis());

  if (redis) {
    try {
      let cursor = "0";
      do {
        const [newCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          "share:*",
          "COUNT",
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== "0");

      log.info("Cleared all shares from Redis");
    } catch (error) {
      log.error({ error }, "Failed to clear Redis shares");
    }
  }

  memoryShares.clear();
  log.info("Cleared all shares from memory");
}
