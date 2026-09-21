/**
 * Context Architecture v2 — S4 rolling summary: PURE assembly of a parsed
 * summariser output into the stored RollingSummary shape.
 *
 * Resolves each slot's ordinal provenance refs ('t3') → real turn ids via the
 * ordinal map the input builder produced. Unresolvable refs (a hallucinated
 * ordinal, or a carried-over ref not in this pass's map) are DROPPED, so stored
 * source_turn_ids are always real and retrievable (the R1 regen fallback relies
 * on this — see build-input.ts).
 *
 * `text` is CLEAN prose (no `[tN]` stamps) — what the coach reads when the
 * injector consumes it (S4 injection follow-up). Machine-readable provenance
 * lives ONLY in slots[].entries[].source_turn_ids (the harness fidelity dim).
 */

import {
  ROLLING_SUMMARY_SLOT_LABELS,
  ROLLING_SUMMARY_SLOTS,
  SLOT_RETENTION_REQUIRED,
  SUMMARY_FULL_HISTORY_READ_LIMIT,
  SUMMARY_SCHEMA_VERSION,
  SUMMARY_SPEAKERS,
} from './summary-types.js';
import type {
  RollingSummary,
  RollingSummaryGenerator,
  RollingSummarySlot,
  RollingSummarySlotBlock,
  SummarySpeaker,
} from './summary-types.js';
import type { ParsedSummarySlot } from './parse-summary.js';
import { isEmptySlotText } from './retention.js';

/** In-band honest-partiality disclosure appended to the stored text when the
 *  maintainer's full-history read filled its cap (Codex r2 fix 4a). Rendered
 *  identically by the injector from `history_capped` so the disclosure
 *  survives into the prompt. */
export const HISTORY_CAP_DISCLOSURE = `(note: derived from the most recent ${SUMMARY_FULL_HISTORY_READ_LIMIT} turns only — earlier turns were not re-read)`;

/** Resolve ordinal refs to real turn ids AND to the DERIVED speaker set.
 *
 *  The speakers come from the ordinal map the input builder produced (one
 *  speaker per ordinal — build-input.ts `turnUnits`), never from the model's
 *  prose. That is the whole point: an entry's attribution becomes a derived
 *  fact about which utterances it cites, checkable by retention.ts, instead of
 *  an unverifiable claim inside the generated text. */
function resolveRefs(
  refs: readonly string[],
  ordinalMap: ReadonlyMap<
    string,
    { turn_id: string; created_at: string; speaker?: SummarySpeaker }
  >,
): { ids: string[]; speakers: SummarySpeaker[] } {
  const ids: string[] = [];
  const seen = new Set<string>();
  const speakers = new Set<SummarySpeaker>();
  for (const ref of refs) {
    const hit = ordinalMap.get(ref);
    if (!hit) continue;
    if (hit.speaker) speakers.add(hit.speaker);
    if (!seen.has(hit.turn_id)) {
      seen.add(hit.turn_id);
      ids.push(hit.turn_id);
    }
  }
  return { ids, speakers: SUMMARY_SPEAKERS.filter((s) => speakers.has(s)) };
}

export function assembleSummaryFromParsed(args: {
  readonly parsedSlots: readonly ParsedSummarySlot[];
  readonly ordinalMap: ReadonlyMap<
    string,
    { turn_id: string; created_at: string; speaker?: SummarySpeaker }
  >;
  readonly watermark: { turn_id: string; created_at: string };
  readonly version: number;
  readonly generator: RollingSummaryGenerator;
  /** Codex r2 fix 4a: true when the maintainer's full-history read filled
   *  its cap — the summary discloses its own partiality (stored marker +
   *  in-text note) instead of claiming silent completeness. */
  readonly historyCapped?: boolean;
  /**
   * RETENTION (2026-07-25). The prior summary, so a slot holding durable fact
   * that this pass EMPTIED is CARRIED FORWARD rather than erased.
   *
   * Wholesale replacement was the module's only write mode: every pass rebuilt
   * all four slots from the model's output alone, and nothing carried an old
   * entry forward except the model choosing to restate it. Measured against
   * the real summariser, a user turn that merely DOUBTED recorded history
   * ("were you inventing them?") emptied RESOLVED in 57/57 samples versus
   * 0/16 on neutral controls — deleting eight named decision records, and
   * (because the injector reads a bare "(none)" as "the summariser looked and
   * found none") replacing them with an affirmative claim that no such
   * history exists.
   *
   * Carrying forward, rather than rejecting the pass, is deliberate: the model
   * is usually RIGHT about the other three slots on that same turn (it
   * correctly moves the user's challenge into OPEN), and freezing the whole
   * summary every time a user expresses doubt is its own degradation. So the
   * pass still lands and the watermark still advances — only the erasure is
   * refused. Which slots qualify is SLOT_RETENTION_REQUIRED (OPEN legitimately
   * empties when a question is answered).
   */
  readonly priorForRetention?: RollingSummary | null;
}): RollingSummary {
  const { parsedSlots, ordinalMap, watermark, version, generator, historyCapped } = args;
  const prior = args.priorForRetention ?? null;
  const priorBySlot = new Map<RollingSummarySlot, RollingSummarySlotBlock>();
  for (const b of prior?.slots ?? []) priorBySlot.set(b.slot, b);

  const bySlot = new Map<RollingSummarySlot, ParsedSummarySlot>();
  for (const p of parsedSlots) bySlot.set(p.slot, p);

  const slots: RollingSummarySlotBlock[] = [];
  const textLines: string[] = [];
  for (const slot of ROLLING_SUMMARY_SLOTS) {
    const parsed = bySlot.get(slot);
    const text = parsed?.text.trim() ?? '';
    // "(none)" is the contract's explicit empty marker, and the parser hands it
    // back VERBATIM rather than normalising it — so emptiness must be judged by
    // the shared predicate, not by `length === 0`.
    const isEmpty = isEmptySlotText(text);

    // CARRY-FORWARD: this pass emptied a slot that held durable fact. Restore
    // the prior entries verbatim — text AND provenance — so the record and
    // its source turns both survive.
    const priorBlock = priorBySlot.get(slot);
    const priorEntries =
      priorBlock?.entries.filter((e) => !isEmptySlotText(e.text.trim())) ?? [];
    if (isEmpty && SLOT_RETENTION_REQUIRED[slot] && priorEntries.length > 0) {
      // STAMP THE REPAIR (D1). The carry-forward itself is unchanged — it still
      // guards the measured 57/57 erasure — but it is no longer SILENT. Until
      // now a restored entry was byte-identical to a freshly-confirmed one, so
      // the next prompt asserted prior record as current fact with no way for
      // any reader to tell the two apart. `carried_forward` is what inject.ts
      // reads to qualify the entry.
      //
      // HONEST BOUND, stated rather than hidden: this flag says the REPAIR
      // fired, not that the repair was RIGHT. Emptying a retention-required
      // slot has (at least) two causes — the summariser dropping durable fact
      // under a user's challenge, and the user legitimately WITHDRAWING the
      // constraint — and this module cannot distinguish them, because both
      // arrive as the identical empty slot. The repair is the same in both
      // cases and is WRONG in the second (it returns a withdrawn figure with
      // its original provenance). Making a withdrawal expressible as TEXT
      // rather than as an emptying is the summariser-prompt half of this
      // slice (summariser.ts) — soft, because the summariser is an LLM.
      //
      // The stamp is deliberately NOT written into `textLines` below: the
      // stored `text` is re-served to the summariser as the prior-summary
      // block (build-input.ts's no-ordinal path), and a qualifier that enters
      // the model's own input compounds across passes. The qualifier is
      // rendered at INJECTION only, from this flag.
      const carried = priorEntries.map((e) => ({ ...e, carried_forward: true as const }));
      textLines.push(
        `${ROLLING_SUMMARY_SLOT_LABELS[slot]}: ${carried.map((e) => e.text).join(' ')}`,
      );
      slots.push({ slot, entries: carried });
      continue;
    }
    const resolved = parsed
      ? resolveRefs(parsed.refs, ordinalMap)
      : { ids: [] as string[], speakers: [] as SummarySpeaker[] };
    // FRAME always renders (it is required); the other slots render their text
    // or a "(none)" marker so the injected block is stable and complete.
    const rendered = !isEmpty ? text : slot === 'FRAME' ? '' : '(none)';
    textLines.push(`${ROLLING_SUMMARY_SLOT_LABELS[slot]}: ${rendered}`);
    slots.push({
      slot,
      entries:
        !isEmpty
          ? [
              {
                text,
                source_turn_ids: resolved.ids,
                // Conditional spread: ABSENT (not []) when nothing speaker-
                // scoped was cited, so "unknown" stays distinguishable from
                // "cited, and no assistant utterance among them".
                ...(resolved.speakers.length > 0
                  ? { source_speakers: resolved.speakers }
                  : {}),
              },
            ]
          : [],
    });
  }
  if (historyCapped === true) textLines.push(HISTORY_CAP_DISCLOSURE);

  return {
    text: textLines.join('\n'),
    slots,
    updated_turn_id: watermark.turn_id,
    updated_turn_created_at: watermark.created_at,
    version,
    generator,
    schema_version: SUMMARY_SCHEMA_VERSION,
    // Conditional spread: the key is ABSENT when the read was complete
    // (byte-stable stored JSONB for the common case).
    ...(historyCapped === true ? { history_capped: true } : {}),
  };
}
