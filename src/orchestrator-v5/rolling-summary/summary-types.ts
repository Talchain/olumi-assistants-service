/**
 * Context Architecture v2 — S4 rolling conversation summary (ROADMAP 1.73).
 * Shared types + constants + a defensive read-parse schema.
 *
 * Design of record: CONTEXT-ARCHITECTURE-V2-2026-07-13/01 §2, §4; 04 §3; 05 §S4.
 *
 * The stored shape (scenarios.rolling_summary JSONB — see
 * supabase/migrations/20260712120000_v5_rolling_summary.sql):
 *   { text, slots[{slot, entries[{text, source_turn_ids}]}],
 *     updated_turn_id, updated_turn_created_at, version, generator }
 *
 * Four FIXED slots so the summary cannot bloat or wander (01 §2):
 *   FRAME       — the decision being made (goal + decision, 1-2 sentences)
 *   CONSTRAINTS — user-stated constraints & preferences (incl. prose-only ones
 *                 never captured as typed facts — the class this layer exists for)
 *   RESOLVED    — settled threads (so the coach stops relitigating them)
 *   OPEN        — unanswered questions / pending intents
 *
 * Slot provenance [R3]: every CONSTRAINTS/RESOLVED/OPEN entry carries the
 * source turn id(s) it derived from. FRAME may carry them too but is not
 * required to (it distils the whole conversation).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Slot vocabulary.
// ---------------------------------------------------------------------------

/** The four fixed slot keys, in canonical render order. */
export const ROLLING_SUMMARY_SLOTS = ['FRAME', 'CONSTRAINTS', 'RESOLVED', 'OPEN'] as const;
export type RollingSummarySlot = (typeof ROLLING_SUMMARY_SLOTS)[number];

// ---------------------------------------------------------------------------
// Bounds & cadence constants (all revisable by measurement, not by wire change).
// ---------------------------------------------------------------------------

/** 01 §2: target envelope. Below MIN is not rejected (a terse summary is
 *  valid); above HARD_CAP IS rejected (bloat — keep the prior summary). */
export const SUMMARY_TARGET_MIN_CHARS = 800;
export const SUMMARY_TARGET_MAX_CHARS = 1200;
/** Hard reject ceiling — a summariser that ignores the length contract is
 *  treated as a schema violation (01 §2 "reject and keep the prior summary").
 *  Set with headroom over the 1,200 target + [tN] stamps + slot labels. */
export const SUMMARY_HARD_CAP_CHARS = 1600;

/** Anti-compounding regeneration horizon (01 §2 / 07 R1): every N turns the
 *  summariser rebuilds from FULL persisted history rather than incrementally
 *  compounding a prior summary. N=10 keeps drift bounded at ≤10 turns. */
export const SUMMARY_REGEN_INTERVAL = 10;

/** Regen input budget (01 §2 fallback). Char proxy for the pack's ~60K-token
 *  cap at the ~3.5 chars/token pack ratio (03 §0). Above this the regen input
 *  degrades to prior-summary + verbatim tail + provenance-cited turns. */
export const SUMMARY_REGEN_INPUT_CHAR_BUDGET = 200_000;

/** The verbatim tail kept in the capped-input fallback (01 §2). */
export const SUMMARY_INPUT_TAIL_TURNS = 20;

/** Shape version of the stored JSONB (NOT the monotonic `version` counter).
 *  A stored summary whose schema_version differs forces a regen. */
export const SUMMARY_SCHEMA_VERSION = 1;

/** Haiku-class default (the only haiku entry in src/config/models.ts). The
 *  1.74 estate lane can re-point CEE_MODEL_SUMMARY estate-wide. */
export const DEFAULT_SUMMARY_MODEL = 'claude-haiku-4-5';

/** Generator provenance stamped on every write — which path produced it. */
export type RollingSummaryGenerator = 'regen' | 'incremental' | 'floor';

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface RollingSummaryEntry {
  readonly text: string;
  /** Source turn id(s) [R3]. May be empty for FRAME. */
  readonly source_turn_ids: readonly string[];
}

export interface RollingSummarySlotBlock {
  readonly slot: RollingSummarySlot;
  readonly entries: readonly RollingSummaryEntry[];
}

export interface RollingSummary {
  /** The rendered, prompt-ready summary text (all four slots). */
  readonly text: string;
  /** Structured slots (provenance-bearing) — the durable form. */
  readonly slots: readonly RollingSummarySlotBlock[];
  /** Provenance/debug: the newest turn id absorbed. */
  readonly updated_turn_id: string;
  /** WATERMARK: created_at (ISO) of the newest turn absorbed — the monotonic
   *  key the DB guard orders on (01 §2 / 07 R4). */
  readonly updated_turn_created_at: string;
  /** Monotonic write counter (advances on every applied write). */
  readonly version: number;
  /** Which path produced this summary. */
  readonly generator: RollingSummaryGenerator;
  /** Stored shape version (SUMMARY_SCHEMA_VERSION). */
  readonly schema_version: number;
}

// ---------------------------------------------------------------------------
// Defensive read-parse schema (get_rolling_summary returns raw JSONB).
// ---------------------------------------------------------------------------

const RollingSummaryEntrySchema = z.object({
  text: z.string(),
  source_turn_ids: z.array(z.string()).default([]),
});

const RollingSummarySlotBlockSchema = z.object({
  slot: z.enum(ROLLING_SUMMARY_SLOTS),
  entries: z.array(RollingSummaryEntrySchema),
});

/** Parses a stored summary back into RollingSummary. Tolerant of a missing
 *  schema_version (pre-versioned rows read as 0 → forces a regen). Returns
 *  null on any structural failure — the maintainer treats "unparseable prior"
 *  the same as "no prior" (regen), never a throw. */
export const RollingSummarySchema = z.object({
  text: z.string(),
  slots: z.array(RollingSummarySlotBlockSchema),
  updated_turn_id: z.string(),
  updated_turn_created_at: z.string(),
  version: z.number(),
  generator: z.enum(['regen', 'incremental', 'floor']),
  schema_version: z.number().default(0),
});

export function parseStoredRollingSummary(raw: unknown): RollingSummary | null {
  if (raw === null || raw === undefined) return null;
  const parsed = RollingSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
