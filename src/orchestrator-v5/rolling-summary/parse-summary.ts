/**
 * Context Architecture v2 — S4 rolling summary: PURE parser for the
 * summariser's fixed-slot text output.
 *
 * The summariser (haiku-class, code-defined prompt — see summariser.ts) is
 * required to emit EXACTLY four labelled slots and nothing else:
 *
 *   DECISION FRAME: <1-2 sentences>
 *   CONSTRAINTS & PREFERENCES: <text or "(none)"> [t3, t7]
 *   RESOLVED: <text or "(none)"> [t5]
 *   OPEN: <text or "(none)"> [t8]
 *
 * This parser is the guard the design pack demands (01 §2): "If it emits
 * outside the four-slot schema, reject and keep the prior summary (never write
 * garbage)." A reject is NOT a failure of the turn — the maintainer keeps the
 * prior summary (or seeds the deterministic floor) and moves on.
 *
 * Provenance [R3]: the `[tN]` stamps are ORDINAL refs into the input the
 * maintainer built (t1 = oldest turn shown, etc.), NOT turn ids — a haiku model
 * citing opaque UUIDs would be unreliable. The maintainer resolves ordinals to
 * real turn ids via `resolveProvenance` using the ordinal map it built.
 */

import { ROLLING_SUMMARY_SLOTS, SUMMARY_HARD_CAP_CHARS } from './summary-types.js';
import type { RollingSummarySlot } from './summary-types.js';

/** Ordered label matchers → slot key. Case-insensitive; tolerant of the
 *  "& PREFERENCES" / "AND PREFERENCES" suffix and a bare "FRAME:". Each slot
 *  has exactly one canonical label the prompt emits; the alternates only make
 *  the parser forgiving of trivial model drift, never of a WRONG label. */
const SLOT_LABELS: ReadonlyArray<{ slot: RollingSummarySlot; re: RegExp }> = [
  { slot: 'FRAME', re: /^(?:DECISION\s+FRAME|FRAME)\s*:\s*/i },
  { slot: 'CONSTRAINTS', re: /^CONSTRAINTS(?:\s*(?:&|AND)\s*PREFERENCES)?\s*:\s*/i },
  { slot: 'RESOLVED', re: /^RESOLVED\s*:\s*/i },
  { slot: 'OPEN', re: /^OPEN\s*:\s*/i },
];

/** `[t3]`, `[t3, t7]`, `[t12,t4]` → the individual ordinal tokens. */
const PROVENANCE_RE = /\[\s*(t\d+(?:\s*,\s*t\d+)*)\s*\]/gi;

export type SummaryParseReject =
  | 'empty'
  | 'missing_frame'
  | 'missing_slot'
  | 'unknown_label'
  | 'content_before_label'
  | 'over_cap'
  | 'duplicate_slot';

export interface ParsedSummarySlot {
  readonly slot: RollingSummarySlot;
  /** Slot content with the `[tN]` stamps stripped and trimmed. */
  readonly text: string;
  /** Ordinal refs extracted from this slot's `[tN]` stamps (e.g. ['t3','t7']). */
  readonly refs: readonly string[];
}

export type ParseSummaryResult =
  | { readonly ok: true; readonly slots: readonly ParsedSummarySlot[] }
  | { readonly ok: false; readonly reason: SummaryParseReject };

function matchLabel(line: string): { slot: RollingSummarySlot; rest: string } | null {
  for (const { slot, re } of SLOT_LABELS) {
    const m = re.exec(line);
    if (m) return { slot, rest: line.slice(m[0].length) };
  }
  return null;
}

function extractRefs(text: string): { clean: string; refs: string[] } {
  const refs: string[] = [];
  const clean = text.replace(PROVENANCE_RE, (_full, group: string) => {
    for (const tok of group.split(',')) {
      const t = tok.trim().toLowerCase();
      if (t.length > 0) refs.push(t);
    }
    return '';
  });
  // De-dupe, preserve first-seen order.
  const seen = new Set<string>();
  const deduped = refs.filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
  return { clean: clean.replace(/\s+/g, ' ').trim(), refs: deduped };
}

/**
 * Parse the summariser's raw text into four slots, or reject. STRICT: ALL
 * FOUR slots must be present exactly once (Codex r2 blocker 2 — a response
 * missing CONSTRAINTS/RESOLVED/OPEN previously parsed OK and the missing
 * slots were stored as "(none)", silently erasing prior memory; now ANY
 * missing slot rejects and the maintainer keeps the prior summary); every
 * non-blank line must belong to a known slot; no slot may appear twice;
 * total length must be within the hard cap.
 */
export function parseSummaryOutput(raw: string): ParseSummaryResult {
  if (raw.trim().length === 0) return { ok: false, reason: 'empty' };
  if (raw.length > SUMMARY_HARD_CAP_CHARS) return { ok: false, reason: 'over_cap' };

  const lines = raw.split(/\r?\n/);
  const acc = new Map<RollingSummarySlot, string[]>();
  let current: RollingSummarySlot | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const matched = matchLabel(line);
    if (matched) {
      if (acc.has(matched.slot)) return { ok: false, reason: 'duplicate_slot' };
      acc.set(matched.slot, matched.rest.trim().length > 0 ? [matched.rest.trim()] : []);
      current = matched.slot;
      continue;
    }
    // A non-label, non-blank line before any label is malformed preamble —
    // the summariser is emitting outside the schema.
    if (current === null) return { ok: false, reason: 'content_before_label' };
    // Continuation of the current slot (wrapped content).
    acc.get(current)!.push(line);
  }

  if (!acc.has('FRAME')) return { ok: false, reason: 'missing_frame' };

  // ALL FOUR slots, exactly once each ('duplicate_slot' above catches twice;
  // this catches absence). A slot the model dropped is NOT "(none)" — "(none)"
  // is an explicit model statement; absence is a schema violation that would
  // overwrite prior memory with nothing.
  for (const slot of ROLLING_SUMMARY_SLOTS) {
    if (!acc.has(slot)) return { ok: false, reason: 'missing_slot' };
  }

  // Only the four known slots may exist — matchLabel already guarantees this,
  // but assert the invariant explicitly for the reader.
  for (const slot of acc.keys()) {
    if (!ROLLING_SUMMARY_SLOTS.includes(slot)) {
      return { ok: false, reason: 'unknown_label' };
    }
  }

  const slots: ParsedSummarySlot[] = [];
  for (const slot of ROLLING_SUMMARY_SLOTS) {
    const raw2 = (acc.get(slot) ?? []).join(' ');
    const { clean, refs } = extractRefs(raw2);
    // FRAME provenance is optional; other slots keep whatever they cited.
    slots.push({ slot, text: clean, refs });
  }
  return { ok: true, slots };
}
