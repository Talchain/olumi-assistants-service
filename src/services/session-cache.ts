/**
 * Session Cache for /ask Endpoint
 *
 * Provides scenario-scoped session caching with Redis and graceful degradation.
 * Redis is supplementary, NOT the source of truth - graph_snapshot in the
 * request is always authoritative.
 *
 * Key pattern: {REDIS_NAMESPACE}:ws:{scenario_id}
 *
 * Graceful degradation:
 * - If Redis is down, missing, or expired, /ask works using only request payload
 * - Log when operating in degraded mode but do not fail the request
 */

import { getRedis, isRedisAvailable } from "../platform/redis.js";
import { log } from "../utils/telemetry.js";
import type { TurnT, AskIntentT } from "../schemas/working-set.js";
import { config } from "../config/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Session data stored in cache.
 * Minimal data - graph is NOT cached (request payload is authoritative).
 */
export interface SessionCache {
  /** Scenario identifier */
  scenario_id: string;
  /** Recent conversation turns (last 5) */
  turns_recent: TurnT[];
  /** Summary of decision state */
  decision_state_summary: string;
  /** Last detected intent */
  last_intent?: AskIntentT;
  /** Last update timestamp (ISO 8601) */
  updated_at: string;
}

/**
 * Result of session retrieval.
 */
export interface SessionRetrieveResult {
  /** Session data if found */
  session: SessionCache | null;
  /** Source of data */
  source: "redis" | "memory" | "none";
  /** Whether we're operating in degraded mode */
  degraded: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

/** Key prefix for session cache */
const CACHE_PREFIX = "ws:";

/**
 * Get session cache TTL from config.
 * Returns configurable TTL in seconds (default 4 hours / 14400 seconds).
 */
function getSessionTtlSeconds(): number {
  return config.cee.sessionCacheTtlSeconds;
}

/** Maximum turns to store */
const MAX_TURNS = 5;

/** In-memory fallback cache (limited size) */
const memoryCache = new Map<string, { data: SessionCache; expires: number }>();
const MAX_MEMORY_CACHE_SIZE = 100;

// ============================================================================
// Internal Utilities
// ============================================================================

/**
 * Build the full cache key for a scenario.
 */
function buildKey(scenarioId: string): string {
  return `${CACHE_PREFIX}${scenarioId}`;
}

/**
 * Clean expired entries from memory cache.
 */
function cleanExpiredFromMemory(): void {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expires < now) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Evict oldest entries if memory cache is at capacity.
 */
function evictIfNeeded(): void {
  if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE) {
    // Remove oldest 10% of entries
    const toRemove = Math.ceil(MAX_MEMORY_CACHE_SIZE * 0.1);
    const keys = [...memoryCache.keys()].slice(0, toRemove);
    for (const key of keys) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Trim turns to max allowed.
 */
function trimTurns(turns: TurnT[]): TurnT[] {
  if (turns.length <= MAX_TURNS) {
    return turns;
  }
  return turns.slice(-MAX_TURNS);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Store session data for a scenario.
 *
 * Uses Redis if available, falls back to in-memory cache.
 * Never throws - logs errors and continues.
 */
export async function storeSession(
  scenarioId: string,
  data: Omit<SessionCache, "updated_at">,
  ttlSeconds?: number
): Promise<void> {
  const effectiveTtl = ttlSeconds ?? getSessionTtlSeconds();
  const key = buildKey(scenarioId);
  const session: SessionCache = {
    ...data,
    turns_recent: trimTurns(data.turns_recent),
    updated_at: new Date().toISOString(),
  };

  try {
    const redis = await getRedis();

    if (redis && isRedisAvailable()) {
      await redis.setex(key, effectiveTtl, JSON.stringify(session));
      log.debug(
        { scenario_id: scenarioId, ttl_seconds: effectiveTtl, turns_count: session.turns_recent.length },
        "Session cached in Redis"
      );
    } else {
      // Fallback to in-memory cache
      cleanExpiredFromMemory();
      evictIfNeeded();
      memoryCache.set(scenarioId, {
        data: session,
        expires: Date.now() + effectiveTtl * 1000,
      });
      log.debug(
        { scenario_id: scenarioId, ttl_seconds: effectiveTtl },
        "Session cached in memory (Redis unavailable)"
      );
    }
  } catch (error) {
    log.warn(
      { error, scenario_id: scenarioId },
      "Failed to cache session, using in-memory fallback"
    );
    cleanExpiredFromMemory();
    evictIfNeeded();
    memoryCache.set(scenarioId, {
      data: session,
      expires: Date.now() + effectiveTtl * 1000,
    });
  }
}

/**
 * Retrieve session data for a scenario.
 *
 * Returns the session from Redis or memory cache.
 * Indicates whether we're in degraded mode (Redis unavailable).
 */
export async function retrieveSession(
  scenarioId: string
): Promise<SessionRetrieveResult> {
  const key = buildKey(scenarioId);

  try {
    const redis = await getRedis();

    if (redis && isRedisAvailable()) {
      const raw = await redis.get(key);
      if (!raw) {
        log.debug({ scenario_id: scenarioId }, "Session not found in Redis cache");
        return { session: null, source: "none", degraded: false };
      }
      log.debug({ scenario_id: scenarioId }, "Session retrieved from Redis cache");
      return {
        session: JSON.parse(raw) as SessionCache,
        source: "redis",
        degraded: false,
      };
    }

    // Fallback to in-memory cache (degraded mode)
    cleanExpiredFromMemory();
    const entry = memoryCache.get(scenarioId);
    if (!entry || entry.expires < Date.now()) {
      memoryCache.delete(scenarioId);
      log.debug(
        { scenario_id: scenarioId },
        "Session not found in memory cache (Redis unavailable)"
      );
      return { session: null, source: "none", degraded: true };
    }

    log.debug(
      { scenario_id: scenarioId },
      "Session retrieved from memory cache (Redis unavailable)"
    );
    return { session: entry.data, source: "memory", degraded: true };
  } catch (error) {
    log.warn(
      { error, scenario_id: scenarioId },
      "Failed to retrieve session from Redis, trying memory fallback"
    );

    // Try memory fallback
    const entry = memoryCache.get(scenarioId);
    if (entry && entry.expires >= Date.now()) {
      return { session: entry.data, source: "memory", degraded: true };
    }
    return { session: null, source: "none", degraded: true };
  }
}

/**
 * Update session with a new turn.
 *
 * Appends the turn to existing session or creates new session.
 * Trims turns to MAX_TURNS.
 */
export async function appendTurn(
  scenarioId: string,
  turn: TurnT,
  decisionStateSummary?: string,
  lastIntent?: AskIntentT
): Promise<void> {
  const existing = await retrieveSession(scenarioId);

  const turns = existing.session
    ? [...existing.session.turns_recent, turn]
    : [turn];

  await storeSession(scenarioId, {
    scenario_id: scenarioId,
    turns_recent: turns,
    decision_state_summary:
      decisionStateSummary ||
      existing.session?.decision_state_summary ||
      "",
    last_intent: lastIntent || existing.session?.last_intent,
  });
}

/**
 * Delete session for a scenario.
 */
export async function deleteSession(scenarioId: string): Promise<void> {
  const key = buildKey(scenarioId);

  try {
    const redis = await getRedis();

    if (redis && isRedisAvailable()) {
      await redis.del(key);
      log.debug({ scenario_id: scenarioId }, "Session deleted from Redis");
    }
  } catch (error) {
    log.warn({ error, scenario_id: scenarioId }, "Failed to delete session from Redis");
  }

  // Always clean from memory cache too
  memoryCache.delete(scenarioId);
}

/**
 * Clear all sessions from memory cache (for testing).
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

/**
 * Get memory cache size (for testing/metrics).
 */
export function getMemoryCacheSize(): number {
  cleanExpiredFromMemory();
  return memoryCache.size;
}
