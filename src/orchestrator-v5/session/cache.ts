/**
 * In-memory LRU cache tier for V5 session store (slice B).
 *
 * Cache is derivative of Supabase: on disagreement Supabase wins. The cache
 * exists to avoid a round-trip on the common case (same scenario, successive
 * turns). Invalidation primitives keep it honest when graph state changes.
 *
 * Bounds (from env, defaults in index.ts):
 *   - maxScenarios: how many distinct scenarios to retain (LRU eviction)
 *   - maxTurnsPerScenario: per-scenario ring of recent turns
 *
 * Returned snapshots are DEEP-FROZEN (recursive) — `Object.freeze` alone is
 * shallow and would leave nested objects (handler facts, request-hash bytes)
 * mutable. Consumers hold read-only views; in-place mutation would silently
 * corrupt the cache.
 */

import type { SessionTurn } from '@talchain/schemas/orchestrator';
import type { InvalidationResult, InvalidationScope } from './invalidation.js';

export interface LRUCacheConfig {
  readonly maxScenarios: number;
  readonly maxTurnsPerScenario: number;
}

interface ScenarioEntry {
  turns: SessionTurn[]; // sorted by created_at DESC
  staleTurnIds: Set<string>;
}

export class SessionLRUCache {
  private readonly map = new Map<string, ScenarioEntry>();

  constructor(private readonly config: LRUCacheConfig) {
    if (config.maxScenarios <= 0 || config.maxTurnsPerScenario <= 0) {
      throw new Error(
        `SessionLRUCache: maxScenarios and maxTurnsPerScenario must be positive (got ${config.maxScenarios}, ${config.maxTurnsPerScenario})`,
      );
    }
  }

  /**
   * Returns a deep-frozen snapshot of the non-stale turns for this scenario,
   * or `null` if the scenario is not cached. LRU-bumps the scenario on hit.
   */
  getScenario(scenarioId: string): readonly SessionTurn[] | null {
    const entry = this.map.get(scenarioId);
    if (!entry) return null;
    // LRU bump: delete + re-set moves the key to the end of the Map iteration
    // order. Map preserves insertion order, so oldest key is always first.
    this.map.delete(scenarioId);
    this.map.set(scenarioId, entry);
    const fresh = entry.turns.filter((t) => !entry.staleTurnIds.has(t.turn_id));
    return deepFreeze(fresh.slice());
  }

  /**
   * Replace the scenario's cached turns. Called on cache miss when the store
   * freshly read from Supabase. Bounded to `maxTurnsPerScenario`.
   */
  populate(scenarioId: string, turns: readonly SessionTurn[]): void {
    const bounded = turns.slice(0, this.config.maxTurnsPerScenario);
    this.map.delete(scenarioId);
    this.map.set(scenarioId, {
      turns: [...bounded],
      staleTurnIds: new Set(),
    });
    this.evictOverLimit();
  }

  /**
   * Prepend a newly-written turn to the front of the cached list. Called by
   * the store AFTER a successful commit so the next `readRecent` sees the
   * new turn without a Supabase round-trip. No-op if the scenario is not
   * currently cached (next read will populate from DB).
   *
   * Pressure-test commit ordering: RPC success → prepend → return. Never
   * prepend before the RPC confirms.
   */
  prepend(scenarioId: string, turn: SessionTurn): void {
    const entry = this.map.get(scenarioId);
    if (!entry) return;
    entry.turns.unshift(turn);
    if (entry.turns.length > this.config.maxTurnsPerScenario) {
      entry.turns.length = this.config.maxTurnsPerScenario;
    }
    // LRU bump
    this.map.delete(scenarioId);
    this.map.set(scenarioId, entry);
  }

  /**
   * Scoped invalidation. In Slice B, handler facts are not yet emitted, so
   * no turn can be proven to "touch" a specific factor or edge. Behaviour:
   *
   *   - structural: marks every cached turn for this scenario stale
   *   - factor / edge: marks every cached turn stale as well (pessimistic;
   *     Slice C refines to fact-indexed eviction once facts exist)
   *
   * Mark-stale (rather than delete) preserves a debuggable trail if a future
   * `getScenario` wants to show "stale" flags. Consumers filter stale out.
   */
  invalidateScoped(scenarioId: string, scope: InvalidationScope): InvalidationResult {
    const entry = this.map.get(scenarioId);
    if (!entry) {
      return { scope, entries_invalidated: [] };
    }
    const invalidated: string[] = [];
    for (const turn of entry.turns) {
      if (!entry.staleTurnIds.has(turn.turn_id)) {
        entry.staleTurnIds.add(turn.turn_id);
        invalidated.push(turn.turn_id);
      }
    }
    return { scope, entries_invalidated: invalidated };
  }

  /**
   * Full invalidation — evict the scenario entry entirely. Next read
   * repopulates from Supabase.
   */
  invalidateAll(scenarioId: string): InvalidationResult {
    const entry = this.map.get(scenarioId);
    if (!entry) {
      return { scope: { kind: 'structural' }, entries_invalidated: [] };
    }
    const ids = entry.turns.map((t) => t.turn_id);
    this.map.delete(scenarioId);
    return { scope: { kind: 'structural' }, entries_invalidated: ids };
  }

  /** Test-only: inspect current scenario count. */
  size(): number {
    return this.map.size;
  }

  /** Test-only: reset. */
  clear(): void {
    this.map.clear();
  }

  private evictOverLimit(): void {
    while (this.map.size > this.config.maxScenarios) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) return;
      this.map.delete(oldest);
    }
  }
}

/**
 * Recursive freeze. `Object.freeze` is shallow; nested arrays/objects would
 * otherwise remain mutable, and a consumer could silently corrupt cached
 * state through a deep reference.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== null && typeof nested === 'object') {
      deepFreeze(nested);
    }
  }
  return value;
}
