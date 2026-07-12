/**
 * Context Architecture v2 — S4 rolling summary: the DETERMINISTIC FLOOR
 * (design pack 01 §2). PURE.
 *
 * "On first summarisation failure the summary is seeded/kept as
 *  DECISION FRAME = first 2 sentences of brief_text + goal-node label — the
 *  summary is never empty and never blocks."
 *
 * Used only when the summariser rejected/failed AND there is no prior summary
 * to keep. If a prior summary exists, the maintainer keeps THAT (never
 * downgrades a real summary to the floor). The floor carries generator:'floor'
 * so telemetry/debug can see the degraded state, and it also fills the FRAME
 * slot from the conversation even when brief_text is empty (02 §Seam 1's
 * write-once-seed residual is de-fanged here).
 */

import { SUMMARY_SCHEMA_VERSION } from './summary-types.js';
import type { RollingSummary } from './summary-types.js';

/** First up-to-2 sentences of a text, whitespace-normalised. */
function firstTwoSentences(text: string): string {
  const normalised = text.replace(/\s+/g, ' ').trim();
  if (normalised.length === 0) return '';
  const matches = normalised.match(/[^.!?]+[.!?]+/g);
  if (matches && matches.length > 0) {
    return matches.slice(0, 2).map((s) => s.trim()).join(' ').trim();
  }
  // No sentence terminator — take the whole (single) sentence, bounded.
  return normalised.slice(0, 240).trim();
}

export interface FloorInputs {
  readonly briefText: string | null | undefined;
  readonly goalLabel: string | null | undefined;
  readonly watermark: { turn_id: string; created_at: string };
  readonly version: number;
  /** Newest user message — a last-resort FRAME source when brief + goal are
   *  both empty, so the floor is never a bare placeholder. */
  readonly latestUserMessage?: string | null;
}

/**
 * Build the deterministic floor summary. Always returns a non-empty FRAME.
 */
export function buildDeterministicFloor(inputs: FloorInputs): RollingSummary {
  const { briefText, goalLabel, watermark, version, latestUserMessage } = inputs;

  const briefFrame = briefText ? firstTwoSentences(briefText) : '';
  const goalPart = goalLabel && goalLabel.trim().length > 0 ? `Goal: ${goalLabel.trim()}.` : '';

  let frame = [briefFrame, goalPart].filter((s) => s.length > 0).join(' ').trim();
  if (frame.length === 0) {
    const fromTurn = latestUserMessage ? firstTwoSentences(latestUserMessage) : '';
    frame = fromTurn.length > 0 ? fromTurn : 'A decision is under discussion.';
  }

  const frameEntry = { text: frame, source_turn_ids: [] as string[] };
  const emptyEntries: { text: string; source_turn_ids: string[] }[] = [];

  return {
    text: [
      `DECISION FRAME: ${frame}`,
      'CONSTRAINTS & PREFERENCES: (none captured yet)',
      'RESOLVED: (none captured yet)',
      'OPEN: (none captured yet)',
    ].join('\n'),
    slots: [
      { slot: 'FRAME', entries: [frameEntry] },
      { slot: 'CONSTRAINTS', entries: emptyEntries },
      { slot: 'RESOLVED', entries: emptyEntries },
      { slot: 'OPEN', entries: emptyEntries },
    ],
    updated_turn_id: watermark.turn_id,
    updated_turn_created_at: watermark.created_at,
    version,
    generator: 'floor',
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}
