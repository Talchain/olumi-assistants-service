/**
 * Idempotency Cache for Orchestrator Turns
 *
 * In-memory Map keyed by `${scenario_id}:${client_turn_id}`.
 *
 * TTL rules:
 * - Successful response: 60s
 * - Transient error (recoverable: true): 3s
 * - Permanent error (recoverable: false): 60s
 * - INVALID_REQUEST errors: NOT cached
 *
 * Max entries: 10,000. Expired entries evicted on capacity pressure.
 * _clearIdempotencyCache() exposed for tests.
 */

import { log } from "../utils/telemetry.js";
import type { OrchestratorResponseEnvelope } from "./types.js";

// ============================================================================
// TTL Configuration
// ============================================================================

const SUCCESS_TTL_MS = 60_000;
const TRANSIENT_ERROR_TTL_MS = 3_000;
const PERMANENT_ERROR_TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;

// ============================================================================
// Cache Entry
// ============================================================================

interface CacheEntry {
  response: OrchestratorResponseEnvelope;
  expiresAt: number;
}

// ============================================================================
// Cache Store
// ============================================================================

const cache = new Map<string, CacheEntry>();

function makeKey(scenarioId: string, clientTurnId: string): string {
  return `${scenarioId}:${clientTurnId}`;
}

function isExpired(entry: CacheEntry): boolean {
  return Date.now() >= entry.expiresAt;
}

/**
 * Determine TTL for a response based on error state.
 * Returns null if the response should NOT be cached (INVALID_REQUEST).
 */
function getTtlMs(response: OrchestratorResponseEnvelope): number | null {
  if (!response.error) {
    return SUCCESS_TTL_MS;
  }

  if (response.error.code === 'INVALID_REQUEST') {
    return null; // Do not cache
  }

  return response.error.recoverable ? TRANSIENT_ERROR_TTL_MS : PERMANENT_ERROR_TTL_MS;
}

/**
 * Evict expired entries when approaching capacity.
 * Scans the full map and removes expired entries.
 */
function evictExpired(): void {
  const now = Date.now();
  let evicted = 0;

  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) {
      cache.delete(key);
      evicted++;
    }
  }

  if (evicted > 0) {
    log.debug({ evicted, remaining: cache.size }, "Idempotency cache: evicted expired entries");
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Look up a cached response for the given scenario + turn.
 * Returns the cached envelope if found and not expired, null otherwise.
 */
export function getIdempotentResponse(
  scenarioId: string,
  clientTurnId: string,
): OrchestratorResponseEnvelope | null {
  const key = makeKey(scenarioId, clientTurnId);
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (isExpired(entry)) {
    cache.delete(key);
    return null;
  }

  log.debug(
    { scenario_id: scenarioId, client_turn_id: clientTurnId },
    "Idempotency cache hit",
  );

  return entry.response;
}

/**
 * Cache a response for the given scenario + turn.
 * Applies TTL rules per response type. Skips caching for INVALID_REQUEST.
 */
export function setIdempotentResponse(
  scenarioId: string,
  clientTurnId: string,
  response: OrchestratorResponseEnvelope,
): void {
  const ttlMs = getTtlMs(response);
  if (ttlMs === null) {
    return; // INVALID_REQUEST — do not cache
  }

  // Evict expired entries if at capacity
  if (cache.size >= MAX_ENTRIES) {
    evictExpired();
  }

  // If still at capacity after eviction, skip caching (graceful degradation)
  if (cache.size >= MAX_ENTRIES) {
    log.warn(
      { size: cache.size, max: MAX_ENTRIES },
      "Idempotency cache at capacity after eviction, skipping cache",
    );
    return;
  }

  const key = makeKey(scenarioId, clientTurnId);
  cache.set(key, {
    response,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Clear the idempotency cache. For tests only.
 */
export function _clearIdempotencyCache(): void {
  cache.clear();
}

/**
 * Get cache size. For diagnostics.
 */
export function _getIdempotencyCacheSize(): number {
  return cache.size;
}
