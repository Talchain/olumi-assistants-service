/**
 * Context Architecture v2 — S4 rolling summary: parser slot-completeness pins
 * (Codex r2 blocker 2 — silent slot erasure).
 *
 * The parser is the ONLY guard between the summariser model and the stored
 * summary. Before this pin it required FRAME alone, so a model response that
 * dropped CONSTRAINTS / RESOLVED / OPEN was ACCEPTED and assemble.ts rendered
 * the missing slots as "(none)" — silently erasing prior memory (the exact
 * class of constraint the layer exists to preserve). The contract is now:
 * EXACTLY ONE instance of ALL FOUR slots, or reject (and the maintainer keeps
 * the prior summary).
 */

import { describe, it, expect } from 'vitest';

import { assembleSummaryFromParsed } from '../assemble.js';
import { buildConversationSummarySection } from '../inject.js';
import { parseSummaryOutput } from '../parse-summary.js';
import { SUMMARISER_SYSTEM_PROMPT } from '../summariser.js';
import { RollingSummarySchema, SUMMARY_HARD_CAP_CHARS } from '../summary-types.js';

const FULL = [
  'DECISION FRAME: Choosing an HQ.',
  'CONSTRAINTS & PREFERENCES: Keep Berlin. [t1]',
  'RESOLVED: (none)',
  'OPEN: (none)',
].join('\n');

describe('parseSummaryOutput — all-four-slots contract', () => {
  it('accepts a response carrying exactly one of each slot', () => {
    const result = parseSummaryOutput(FULL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slots.map((s) => s.slot)).toEqual(['FRAME', 'CONSTRAINTS', 'RESOLVED', 'OPEN']);
    }
  });

  it('REJECTS a response missing CONSTRAINTS (would erase prior constraints)', () => {
    const threeSlots = [
      'DECISION FRAME: Choosing an HQ.',
      'RESOLVED: (none)',
      'OPEN: (none)',
    ].join('\n');
    const result = parseSummaryOutput(threeSlots);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('REJECTS a response missing RESOLVED', () => {
    const result = parseSummaryOutput(
      ['DECISION FRAME: X.', 'CONSTRAINTS & PREFERENCES: (none)', 'OPEN: (none)'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('REJECTS a response missing OPEN', () => {
    const result = parseSummaryOutput(
      ['DECISION FRAME: X.', 'CONSTRAINTS & PREFERENCES: (none)', 'RESOLVED: (none)'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('REJECTS a FRAME-only response', () => {
    const result = parseSummaryOutput('DECISION FRAME: Only a frame.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('still reports missing_frame when FRAME itself is absent', () => {
    const result = parseSummaryOutput(
      ['CONSTRAINTS & PREFERENCES: (none)', 'RESOLVED: (none)', 'OPEN: (none)'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_frame');
  });

  it('still rejects duplicate slots', () => {
    const result = parseSummaryOutput([FULL, 'OPEN: another open'].join('\n'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicate_slot');
  });
});

// ---------------------------------------------------------------------------
// THE CAP CONTRACT — stated to the model, and measured end-to-end.
// ---------------------------------------------------------------------------

/**
 * Witnessed on deployed staging, scenario `8a8721ae`, 2026-09-08. All twenty
 * `v5.summary.updated` records for one real conversation: applied sizes climb
 * 702 → 975 → 1229 → 1460, and from there EVERY incremental pass is
 * `rejected_kept_prior / over_cap` — fourteen of twenty — with regenerations
 * briefly recovering at 1382 and 1479. The final rejection spent 9,559 ms and
 * 615 output tokens and then kept the old summary.
 *
 * ── WHAT THESE TESTS DO AND DO NOT ESTABLISH ───────────────────────────────
 * The rejected raw outputs were never persisted — that IS the defect — so how
 * many of the fourteen a change would recover is UNKNOWN and unknowable from
 * this capture. Output-token counts (411–615) cannot be converted into exact
 * character lengths. Nothing below claims a recovery count.
 *
 * ── AND THE MEASUREMENT CHANGE THIS FILE ORIGINALLY CARRIED WAS WITHDRAWN ──
 * A first version of this branch discounted the `[tN]` stamps from the cap, on
 * the argument that they are stripped by `extractRefs` and never reach the
 * consumer. The first half is true; the second half is FALSE, and the test at
 * the end of this file is the evidence that killed it: `inject.ts`'s `stampFor`
 * RE-RENDERS provenance into the injected block, in the form
 * `[t:<8-char id>, …]` — which is LARGER than the model's own `[t3]`. So
 * discounting stamps at the parser would have grown the block the cap exists to
 * bound, in the exact direction the argument claimed it shrank it.
 *
 * `summary-types.ts` already says the 1600 ceiling reserves 200 chars over the
 * 1400 target "for [tN] stamps + slot labels". That is deliberate design, not
 * an accidental unit slip, and it stands.
 */

const CAP_LABELS =
  'DECISION FRAME: \nCONSTRAINTS & PREFERENCES: Keep Berlin. \nRESOLVED: (none)\nOPEN: (none)';

function summaryOfRawSize(rawTarget: number, stampCount: number): string {
  const stamps = Array.from({ length: stampCount }, (_, i) => `[t${i + 1}]`).join(' ');
  const fillerLen = Math.max(0, rawTarget - CAP_LABELS.length - (stamps.length > 0 ? stamps.length : 0));
  return [
    `DECISION FRAME: ${'x'.repeat(fillerLen)}`,
    `CONSTRAINTS & PREFERENCES: Keep Berlin. ${stamps}`,
    'RESOLVED: (none)',
    'OPEN: (none)',
  ].join('\n');
}

describe('parseSummaryOutput — the cap contract is unchanged and still enforced on raw output', () => {
  it('WITHIN-CAP CONTROL — the real applied sizes from the capture parse', () => {
    // 702 / 975 / 1229 / 1382 / 1460 / 1479 are the six APPLIED summaries in the
    // witnessed journey. Sizes taken from the capture; content is filler.
    for (const size of [702, 975, 1229, 1382, 1460, 1479]) {
      const result = parseSummaryOutput(summaryOfRawSize(size, 8));
      expect(result.ok, `applied size ${size}`).toBe(true);
    }
  });

  it('OVERSIZE COUNTERPART — one character of raw over the ceiling still rejects', () => {
    expect(SUMMARY_HARD_CAP_CHARS).toBe(1600);
    const raw = summaryOfRawSize(SUMMARY_HARD_CAP_CHARS + 1, 0);
    expect(raw.length).toBeGreaterThan(SUMMARY_HARD_CAP_CHARS);
    const result = parseSummaryOutput(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('over_cap');
  });

  it('MALFORMED AND REFUSAL BEHAVIOURS — unchanged', () => {
    const long = 'x'.repeat(SUMMARY_HARD_CAP_CHARS + 400);
    expect(parseSummaryOutput('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseSummaryOutput('   \n  ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseSummaryOutput(`Here is your summary. ${long}`)).toMatchObject({ ok: false });
    expect(
      parseSummaryOutput(['DECISION FRAME: A.', 'RESOLVED: (none)', 'OPEN: (none)'].join('\n')),
    ).toMatchObject({ ok: false, reason: 'missing_slot' });
  });

  it('REFS AND ATTRIBUTION survive the parse', () => {
    const parsed = parseSummaryOutput(
      [
        'DECISION FRAME: Choosing an HQ.',
        'CONSTRAINTS & PREFERENCES: Keep Berlin. [t1, t4]',
        'RESOLVED: Budget settled. [t2]',
        'OPEN: (none)',
      ].join('\n'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.slots.find((s) => s.slot === 'CONSTRAINTS')?.refs).toEqual(['t1', 't4']);
    expect(parsed.slots.find((s) => s.slot === 'RESOLVED')?.refs).toEqual(['t2']);
    expect(parsed.slots.find((s) => s.slot === 'CONSTRAINTS')?.text).toBe('Keep Berlin.');
  });
});

/**
 * THE END-TO-END EVIDENCE, and the reason the measurement change was withdrawn.
 *
 * parser → assemble → store read-parse → inject, on one summary. This is what a
 * parser-only length assertion cannot show, and it is what settles the question
 * of whether stamps may be discounted from the cap.
 */
describe('rolling summary — parser → assemble → read → inject, on real slot content', () => {
  const RAW = [
    'DECISION FRAME: Choosing between two hiring routes under a fixed deadline.',
    'CONSTRAINTS & PREFERENCES: Budget is £200k and the six-month deadline is externally committed. [t1, t4]',
    'RESOLVED: Delaying the hire was ruled out. [t2]',
    'OPEN: Whether salary inflation changes the comparison. [t5]',
  ].join('\n');

  it('the STORED text drops the stamps, and the INJECTED text puts provenance back — LARGER', () => {
    const parsed = parseSummaryOutput(RAW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const ordinalMap = new Map<string, { turn_id: string; created_at: string }>();
    for (const [ord, id] of [
      ['t1', '0934b3c3-cf6a-44a2-abae-433d5227cb85'],
      ['t2', '75c068a9-57f8-4de8-b2d2-6338a14a55c7'],
      ['t4', 'ea7a0079-b2ab-4835-890f-af747beb906f'],
      ['t5', '8a8721ae-0fde-4a20-b615-f40b5cab1492'],
    ] as const) {
      ordinalMap.set(ord, { turn_id: id, created_at: '2026-09-08T00:00:00.000Z' });
    }

    const assembled = assembleSummaryFromParsed({
      parsedSlots: parsed.slots,
      ordinalMap,
      watermark: { turn_id: 'turn-final', created_at: '2026-09-08T01:00:00.000Z' },
      version: 2,
      generator: 'incremental',
    });

    // STORED: canonical labels, clean text, no stamps — refs live structurally.
    expect(assembled.text).not.toMatch(/\[t\d+\]/);
    expect(assembled.text).toContain('DECISION FRAME:');
    expect(assembled.text).toContain('CONSTRAINTS & PREFERENCES:');
    const constraints = assembled.slots.find((s) => s.slot === 'CONSTRAINTS');
    expect(constraints?.entries[0]?.source_turn_ids).toHaveLength(2);

    // READ: the stored shape survives the defensive read-parse unchanged.
    const readBack = RollingSummarySchema.safeParse(JSON.parse(JSON.stringify(assembled)));
    expect(readBack.success).toBe(true);

    // INJECT: provenance is RE-RENDERED, in a form LONGER than the model's.
    // ⭐ THIS IS THE MEASUREMENT EVIDENCE. Discounting `[t3]` at the parser
    // would have let more content in and then paid for it again here at
    // `[t:0934b3c3, t:ea7a0079]` — bigger, not smaller.
    const injected = buildConversationSummarySection(
      readBack.success ? readBack.data : assembled,
      0,
      8,
    );
    expect(injected.text).toMatch(/\[t:[0-9a-f]{8}/);
    expect(injected.text.length).toBeGreaterThan(assembled.text.length);
    // The user-facing meaning survives the whole path.
    expect(injected.text).toContain('£200k');
    expect(injected.text).toContain('externally committed');
    expect(injected.text).toContain('Delaying the hire was ruled out.');
  });
});

/**
 * THE SURVIVING REPAIR. The measurement change was withdrawn (see above); this
 * one stands on its own and changes no number.
 */
describe('SUMMARISER_SYSTEM_PROMPT — the enforced ceiling is stated, not hidden', () => {
  it('names the real hard limit the parser applies', () => {
    // The model was told a target of 800-1400 and then judged against a 1600
    // hard reject it was never shown. On a pass that overshot its target a
    // little it had no way to know it had crossed a line that discards the
    // whole update and keeps the previous summary — which is what the capture
    // shows happening fourteen times in a row.
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(
      `The hard limit is ${SUMMARY_HARD_CAP_CHARS} characters`,
    );
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('the previous one is kept');
    // The existing target is retained, not replaced.
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('Keep the whole summary between');
    // And the citation rule it must not trade away is still there.
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('cite the turn(s) it came from');
  });
});
