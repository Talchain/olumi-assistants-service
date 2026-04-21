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
import type { ResolutionSource } from '../../adapters/llm/router.js';
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

/**
 * Per-LLM-call model resolution record. One entry per call; a turn may
 * contain several. Appended in call-order.
 */
export interface ModelResolutionRecord {
  readonly task?: string;
  readonly resolved_model: string;
  readonly resolution_source: ResolutionSource;
  /**
   * Provider that served the request. Group 3 follow-up — without this
   * field an operator looking at model_resolutions can confirm a model
   * string was used but cannot distinguish (say) an openai-routed
   * gpt-4.1 from a misrouted one via a proxy. Optional because pre-
   * Group-3 entries in long-lived fixtures may not have it.
   */
  readonly provider?: 'anthropic' | 'openai' | 'fixtures';
  /** Unix timestamp (ms) when the resolution was recorded. */
  readonly timestamp: number;
}

/** A single stored debug entry. */
export interface TurnDebugEntry {
  readonly turn_id: string;
  readonly session_id: string;
  /** Unix timestamp (ms) when this entry was stored. Used for TTL and the response header. */
  readonly stored_at: number;
  readonly cqe: TurnDebugCqeSection;
  /**
   * Per-LLM-call model resolutions for this turn, in call-order.
   * Undefined when no resolutions recorded yet; empty array when explicitly
   * cleared. Append via recordModelResolution.
   */
  readonly model_resolutions?: readonly ModelResolutionRecord[];
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
    const existing = this.store.get(entry.turn_id);
    if (!existing && this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    // Preserve model_resolutions across overwrites; the CQE writer typically
    // runs before any resolution recorder, but in either order the union
    // must survive.
    const merged: TurnDebugEntry = existing
      ? {
          ...entry,
          model_resolutions: entry.model_resolutions ?? existing.model_resolutions,
        }
      : entry;
    this.store.set(entry.turn_id, merged);
  }

  appendModelResolution(
    turn_id: string,
    session_id: string,
    resolution: ModelResolutionRecord,
  ): void {
    this.cleanup();
    const existing = this.store.get(turn_id);
    if (existing) {
      const model_resolutions = [...(existing.model_resolutions ?? []), resolution];
      this.store.set(turn_id, { ...existing, model_resolutions });
      return;
    }
    // First write for this turn: create a minimal entry so the resolution
    // is persisted even if the CQE writer has not yet run. Enforce FIFO
    // eviction on new-key insertion.
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(turn_id, {
      turn_id,
      session_id,
      stored_at: Date.now(),
      cqe: {
        parsed_quantities: [],
        patterns_matched: [],
        timeout: false,
        compromise_match_count: 0,
        duration_ms: 0,
        message_too_long: false,
        word_range_missed: false,
      },
      model_resolutions: [resolution],
    });
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
 * Append a per-LLM-call model resolution to the turn's debug entry.
 * No-op when CEE_TURN_DEBUG_ENABLED is false. Safe to call before the
 * CQE writer has run — a minimal entry is created if needed.
 */
export function recordModelResolution(
  turn_id: string,
  session_id: string,
  resolution: Omit<ModelResolutionRecord, 'timestamp'> & { timestamp?: number },
): void {
  if (!config.cee.turnDebugEnabled) return;
  const record: ModelResolutionRecord = {
    task: resolution.task,
    resolved_model: resolution.resolved_model,
    resolution_source: resolution.resolution_source,
    ...(resolution.provider !== undefined ? { provider: resolution.provider } : {}),
    timestamp: resolution.timestamp ?? Date.now(),
  };
  turnDebugStore.appendModelResolution(turn_id, session_id, record);
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
