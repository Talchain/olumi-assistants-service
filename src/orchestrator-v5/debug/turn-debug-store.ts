/**
 * Turn Debug Store
 *
 * In-memory FIFO store for per-turn V5 debug data, keyed by turn_id.
 * Enabled only when CEE_TURN_DEBUG_ENABLED=true -- never populates in production
 * unless the flag is explicitly set.
 *
 * Pattern mirrors src/cee/llm-output-store.ts (TTL, FIFO eviction, singleton).
 */

import type { QuantityExtractionResult } from '@talchain/schemas/orchestrator';
import { config } from '../../config/index.js';

/** Default TTL: 1 hour */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Max entries before FIFO eviction */
const MAX_ENTRIES = 500;

/**
 * CQE section captured per turn.
 * Fields mirror CqeExtractionSummary plus the full parsed_quantities array.
 */
export interface TurnDebugCqeSection {
  /** Full CQE extraction results, all fields including value_origin. */
  readonly parsed_quantities: readonly QuantityExtractionResult[];
  /** Pattern IDs that produced at least one match. */
  readonly patterns_matched: readonly string[];
  /** True if the total CQE budget (CQE_TOTAL_BUDGET_MS) was exceeded. */
  readonly timeout: boolean;
  /** Number of results produced by the compromise backstop. */
  readonly compromise_match_count: number;
  /** Wall-clock duration of the CQE run in milliseconds. */
  readonly duration_ms: number;
  /** True if the message exceeded the CQE length limit. */
  readonly message_too_long: boolean;
  /** True if numeric tokens appeared outside the supported word-range. */
  readonly word_range_missed: boolean;
}

/** A single stored debug entry. */
export interface TurnDebugEntry {
  readonly turn_id: string;
  readonly session_id: string;
  /** Unix timestamp (ms) when this entry was stored. Used for TTL and the response header. */
  readonly stored_at: number;
  readonly cqe: TurnDebugCqeSection;
}

class TurnDebugStore {
  private readonly store = new Map<string, TurnDebugEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  set(entry: TurnDebugEntry): void {
    this.cleanup();
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(entry.turn_id, entry);
  }

  /**
   * Retrieve a stored entry.
   * Returns undefined when not found or expired; returns 'expired' when an expired
   * entry was evicted (distinct from never-stored).
   */
  get(turn_id: string): TurnDebugEntry | undefined | 'expired' {
    const entry = this.store.get(turn_id);
    if (!entry) return undefined;
    if (Date.now() - entry.stored_at > this.ttlMs) {
      this.store.delete(turn_id);
      return 'expired';
    }
    return entry;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.stored_at > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

const turnDebugStore = new TurnDebugStore();

/**
 * Store a turn debug entry. No-op when CEE_TURN_DEBUG_ENABLED is false.
 */
export function storeTurnDebug(entry: TurnDebugEntry): void {
  if (!config.cee.turnDebugEnabled) return;
  turnDebugStore.set(entry);
}

/**
 * Retrieve a stored turn debug entry by turn_id.
 * Returns the entry, undefined (never stored), or 'expired' (stored but TTL elapsed).
 */
export function getTurnDebug(turn_id: string): TurnDebugEntry | undefined | 'expired' {
  return turnDebugStore.get(turn_id);
}

/** Get current store size (diagnostics). */
export function getTurnDebugStoreSize(): number {
  return turnDebugStore.size;
}

/** Clear all entries -- test use only. */
export function clearTurnDebugStore(): void {
  turnDebugStore.clear();
}
