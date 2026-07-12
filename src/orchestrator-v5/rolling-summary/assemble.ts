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

import { ROLLING_SUMMARY_SLOTS, SUMMARY_SCHEMA_VERSION } from './summary-types.js';
import type {
  RollingSummary,
  RollingSummaryGenerator,
  RollingSummarySlot,
  RollingSummarySlotBlock,
} from './summary-types.js';
import type { ParsedSummarySlot } from './parse-summary.js';

const SLOT_LABEL: Record<RollingSummarySlot, string> = {
  FRAME: 'DECISION FRAME',
  CONSTRAINTS: 'CONSTRAINTS & PREFERENCES',
  RESOLVED: 'RESOLVED',
  OPEN: 'OPEN',
};

function resolveRefs(
  refs: readonly string[],
  ordinalMap: ReadonlyMap<string, { turn_id: string; created_at: string }>,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const hit = ordinalMap.get(ref);
    if (hit && !seen.has(hit.turn_id)) {
      seen.add(hit.turn_id);
      ids.push(hit.turn_id);
    }
  }
  return ids;
}

export function assembleSummaryFromParsed(args: {
  readonly parsedSlots: readonly ParsedSummarySlot[];
  readonly ordinalMap: ReadonlyMap<string, { turn_id: string; created_at: string }>;
  readonly watermark: { turn_id: string; created_at: string };
  readonly version: number;
  readonly generator: RollingSummaryGenerator;
}): RollingSummary {
  const { parsedSlots, ordinalMap, watermark, version, generator } = args;
  const bySlot = new Map<RollingSummarySlot, ParsedSummarySlot>();
  for (const p of parsedSlots) bySlot.set(p.slot, p);

  const slots: RollingSummarySlotBlock[] = [];
  const textLines: string[] = [];
  for (const slot of ROLLING_SUMMARY_SLOTS) {
    const parsed = bySlot.get(slot);
    const text = parsed?.text.trim() ?? '';
    const source_turn_ids = parsed ? resolveRefs(parsed.refs, ordinalMap) : [];
    // FRAME always renders (it is required); the other slots render their text
    // or a "(none)" marker so the injected block is stable and complete.
    const rendered = text.length > 0 ? text : slot === 'FRAME' ? '' : '(none)';
    textLines.push(`${SLOT_LABEL[slot]}: ${rendered}`);
    slots.push({
      slot,
      entries: text.length > 0 ? [{ text, source_turn_ids }] : [],
    });
  }

  return {
    text: textLines.join('\n'),
    slots,
    updated_turn_id: watermark.turn_id,
    updated_turn_created_at: watermark.created_at,
    version,
    generator,
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}
