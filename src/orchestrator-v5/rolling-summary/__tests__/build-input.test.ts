/**
 * Context Architecture v2 — S4 rolling summary: summariser-input pins for
 * Codex r2 fix 3 (same-timestamp watermark skip) and the provenance-carry
 * fold-in (incremental rounds losing source_turn_ids).
 *
 *  - COMPOSITE WATERMARK: incremental selection must include a turn that
 *    shares the watermark's created_at but is NOT the watermark turn — the
 *    store permits same-timestamp siblings and orders them (created_at,
 *    turn_id); a `created_at >` filter alone skips the sibling on every
 *    incremental pass.
 *  - PROVENANCE CARRY: the prior summary's cited turns get ordinal labels in
 *    the incremental input (and entries render with those stamps), so a
 *    carried entry keeps a resolvable citation instead of silently losing its
 *    source_turn_ids until the next regen.
 */

import { describe, it, expect } from 'vitest';

import { buildSummariserInput } from '../build-input.js';
import type { SummariserTurn } from '../build-input.js';
import { SUMMARY_SCHEMA_VERSION } from '../summary-types.js';
import type { RollingSummary } from '../summary-types.js';

function turn(id: string, createdAt: string, user = `msg ${id}`): SummariserTurn {
  return { turn_id: id, created_at: createdAt, user_message: user, assistant_message: null };
}

function priorWith(args: {
  watermarkId: string;
  watermarkTs: string;
  constraintText?: string;
  constraintSources?: string[];
}): RollingSummary {
  return {
    text: 'DECISION FRAME: prior.\nCONSTRAINTS & PREFERENCES: (none)\nRESOLVED: (none)\nOPEN: (none)',
    slots: [
      { slot: 'FRAME', entries: [{ text: 'prior.', source_turn_ids: [] }] },
      {
        slot: 'CONSTRAINTS',
        entries: args.constraintText
          ? [{ text: args.constraintText, source_turn_ids: args.constraintSources ?? [] }]
          : [],
      },
      { slot: 'RESOLVED', entries: [] },
      { slot: 'OPEN', entries: [] },
    ],
    updated_turn_id: args.watermarkId,
    updated_turn_created_at: args.watermarkTs,
    version: 1,
    generator: 'regen',
    schema_version: SUMMARY_SCHEMA_VERSION,
  };
}

const TS = '2026-07-10T10:05:00.000Z';
const TS_LATER = '2026-07-10T10:06:00.000Z';

describe('buildSummariserInput — composite watermark (same-timestamp sibling)', () => {
  it('INCREMENTAL shows a same-timestamp sibling of the watermark (not just created_at >)', () => {
    // Chronological (created_at, turn_id) order: w, s share TS; n is newer.
    // Prior watermark = w. The sibling s was never absorbed; a ts-only filter
    // skips it on every incremental pass until a regen.
    const w = turn('turn-a-watermark', TS);
    const s = turn('turn-b-sibling', TS, 'the missed same-ms turn');
    const n = turn('turn-c-newer', TS_LATER);
    const input = buildSummariserInput({
      mode: 'incremental',
      priorSummary: priorWith({ watermarkId: w.turn_id, watermarkTs: TS }),
      chronologicalTurns: [w, s, n],
    });
    const shownIds = [...input.ordinalMap.values()].map((v) => v.turn_id);
    expect(shownIds).toContain(s.turn_id);
    expect(shownIds).toContain(n.turn_id);
    // The watermark turn itself is already absorbed — not re-shown.
    expect(shownIds).not.toContain(w.turn_id);
    expect(input.userMessage).toContain('the missed same-ms turn');
    // Watermark advances to the composite max (the newer turn).
    expect(input.watermark).toEqual({ turn_id: n.turn_id, created_at: n.created_at });
  });
});

describe('buildSummariserInput — incremental provenance carry', () => {
  it('prior-cited turns receive ordinals and the prior block renders their stamps', () => {
    const cited = turn('turn-old-cited', '2026-07-10T09:00:00.000Z');
    const w = turn('turn-w', TS);
    const n = turn('turn-n', TS_LATER);
    const prior = priorWith({
      watermarkId: w.turn_id,
      watermarkTs: TS,
      constraintText: 'Keep Maria on the team.',
      constraintSources: [cited.turn_id],
    });
    const input = buildSummariserInput({
      mode: 'incremental',
      priorSummary: prior,
      chronologicalTurns: [cited, w, n],
    });
    // The cited turn is resolvable via the ordinal map even though it is not
    // one of the new turns shown.
    const citedEntries = [...input.ordinalMap.entries()].filter(
      ([, v]) => v.turn_id === cited.turn_id,
    );
    expect(citedEntries).toHaveLength(1);
    const citedOrdinal = citedEntries[0]![0];
    // The prior block renders the carried entry WITH its stamp so the model
    // can echo it and assemble.ts can resolve it back to the real turn id.
    expect(input.userMessage).toContain(`Keep Maria on the team. [${citedOrdinal}]`);
    // New turns are labelled after the carried ordinals — no collisions.
    const allOrdinals = [...input.ordinalMap.keys()];
    expect(new Set(allOrdinals).size).toBe(allOrdinals.length);
  });

  it('no carry in REGEN mode (full history re-anchors provenance)', () => {
    const cited = turn('turn-old-cited', '2026-07-10T09:00:00.000Z');
    const w = turn('turn-w', TS);
    const prior = priorWith({
      watermarkId: w.turn_id,
      watermarkTs: TS,
      constraintText: 'Keep Maria on the team.',
      constraintSources: [cited.turn_id],
    });
    const input = buildSummariserInput({
      mode: 'regen',
      priorSummary: prior,
      chronologicalTurns: [cited, w],
    });
    // Regen shows the real turns; ordinals label shown turns only.
    expect([...input.ordinalMap.values()].map((v) => v.turn_id)).toEqual([
      cited.turn_id,
      w.turn_id,
    ]);
  });
});
