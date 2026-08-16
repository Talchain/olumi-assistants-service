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

/** Canonical render labels for the four slots — ONE vocabulary shared by the
 *  stored-text renderer (assemble.ts), the injector (inject.ts), and the
 *  incremental prior-summary rendering (build-input.ts). */
export const ROLLING_SUMMARY_SLOT_LABELS: Record<RollingSummarySlot, string> = {
  FRAME: 'DECISION FRAME',
  CONSTRAINTS: 'CONSTRAINTS & PREFERENCES',
  RESOLVED: 'RESOLVED',
  OPEN: 'OPEN',
};

/**
 * RETENTION POLICY per slot — which slots hold DURABLE fact that an update
 * pass may never empty, and which are legitimately transient.
 *
 * Motivation (measured, 2026-07-25): on a user turn that CHALLENGES or DOUBTS
 * recorded history ("I think your last answer was made up… were you inventing
 * them?"), the summariser rewrote `RESOLVED` from a slot holding eight named
 * decision records to `(none)` — 57/57 samples against 0/16 on neutral control
 * turns. `(none)` is not a silence: for a non-floor summary the injector
 * documents the bare marker as "the summariser looked and found none"
 * (inject.ts), so the erasure is stored and injected as an AFFIRMATIVE claim
 * that no settled history exists. A user expressing doubt about their own
 * decision history caused that history to be deleted and denied.
 *
 * parse-summary.ts already rejects a MISSING slot for exactly this reason
 * ("the missing slots were stored as '(none)', silently erasing prior
 * memory"). A slot the model emits but EMPTIES produces the identical stored
 * outcome; the existing guard caught the typo case and missed the semantic
 * one. See retention.ts.
 *
 * `true` ⇒ once non-empty, an update may not empty it (reject and keep prior).
 * `false` ⇒ emptying is a legitimate transition:
 *   - OPEN: an open question getting answered SHOULD empty the slot.
 *   - FRAME: required and never empty in practice; parse rejects a missing one.
 *
 * Exhaustive `Record` BY DESIGN (trap 12 — derive, or fail loud): adding a
 * fifth slot to ROLLING_SUMMARY_SLOTS without deciding its retention policy is
 * a COMPILE error, not a silent default.
 */
export const SLOT_RETENTION_REQUIRED: Record<RollingSummarySlot, boolean> = {
  FRAME: false,
  CONSTRAINTS: true,
  RESOLVED: true,
  OPEN: false,
};

/** Which participant produced an utterance. The summariser input labels every
 *  citable unit with exactly one of these (build-input.ts), so a stored
 *  entry's attribution is DERIVED from provenance rather than read out of the
 *  model's prose. */
export const SUMMARY_SPEAKERS = ['user', 'assistant'] as const;
export type SummarySpeaker = (typeof SUMMARY_SPEAKERS)[number];

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

/** The maintainer's full-history read limit (readRecent is unclamped; this
 *  bounds one pass's read). When a read FILLS this limit the "full history"
 *  may be partial — the maintainer then marks the stored summary
 *  `history_capped` and the rendered text discloses the partiality in-band
 *  (Codex r2 fix 4a: no silent partiality). Lives here (not capture.ts) so
 *  assemble.ts can render the number without a circular import; capture.ts
 *  re-exports it for compatibility. */
export const SUMMARY_FULL_HISTORY_READ_LIMIT = 1000;

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
  /** DERIVED speaker attribution — which participants' utterances this entry
   *  cites, resolved from the summariser input's ordinal map (the source of
   *  truth), never parsed out of the model's prose. Absent on rows written
   *  before speaker-scoped citation units existed, and on entries that cited
   *  nothing. Consumed by retention.ts's attribution gate. */
  readonly source_speakers?: readonly SummarySpeaker[];
  /**
   * CARRY-FORWARD VISIBILITY. Present-and-true when assemble.ts restored this
   * entry from the PRIOR summary because THIS pass emptied a slot whose
   * retention is required — i.e. the entry is prior record that the latest
   * pass did not restate, not something the latest pass confirmed.
   *
   * Why it exists: carry-forward is a REPAIR (assemble.ts), and until now it
   * was a SILENT one. The restored entry was byte-indistinguishable from a
   * freshly-confirmed one, so a re-injected constraint could masquerade as
   * current confirmation — including in the one case where the summariser was
   * RIGHT to empty the slot (a genuine withdrawal), where the repair returns a
   * stale figure wearing its original provenance. This flag does not decide
   * which of those happened; it makes the fact of the repair legible so
   * inject.ts can qualify the entry instead of asserting it.
   *
   * ABSENT (not false) on a fresh entry — byte-stable stored JSONB for the
   * common case, same posture as `history_capped`.
   *
   * ⚠ IT MUST BE DECLARED IN `RollingSummaryEntrySchema` BELOW OR IT DOES NOT
   * SURVIVE STORAGE. `parseStoredRollingSummary` is the read path for every
   * consumer including inject.ts, and a bare `z.object` STRIPS unknown keys
   * silently (zod 3 default) — it does not reject them. "The readers tolerate
   * an extra field" is therefore true and useless: an undeclared field is
   * written to JSONB, read back, and dropped without a single error.
   */
  readonly carried_forward?: boolean;
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
  /** Honest-partiality marker (Codex r2 fix 4a): present-and-true when the
   *  maintainer's full-history read FILLED SUMMARY_FULL_HISTORY_READ_LIMIT,
   *  so the "full history" behind this summary may be partial. The rendered
   *  text (stored and injected) discloses it in-band. ABSENT (not false)
   *  when the read was complete — byte-stable stored shape for the common
   *  case, and tolerated by the read parse as optional. */
  readonly history_capped?: boolean;
}

// ---------------------------------------------------------------------------
// Defensive read-parse schema (get_rolling_summary returns raw JSONB).
// ---------------------------------------------------------------------------

const RollingSummaryEntrySchema = z.object({
  text: z.string(),
  source_turn_ids: z.array(z.string()).default([]),
  // Optional, not defaulted: rows written before speaker-scoped citation units
  // have no speaker provenance, and "absent" must stay distinguishable from
  // "cited nothing" (the attribution gate treats an absent set as UNKNOWN, not
  // as proof of a user-only citation).
  source_speakers: z.array(z.enum(SUMMARY_SPEAKERS)).optional(),
  // Optional, not defaulted: absent means "written fresh by this pass" and is
  // the common case. DECLARED because a bare z.object strips unknown keys —
  // without this line the stamp assemble.ts writes would be silently dropped
  // on every read and inject.ts could never qualify a carried entry.
  carried_forward: z.boolean().optional(),
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
  history_capped: z.boolean().optional(),
});

export function parseStoredRollingSummary(raw: unknown): RollingSummary | null {
  if (raw === null || raw === undefined) return null;
  const parsed = RollingSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
