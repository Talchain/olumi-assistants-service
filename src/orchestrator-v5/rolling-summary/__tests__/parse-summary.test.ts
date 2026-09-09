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
import { parseSummaryOutput } from '../parse-summary.js';
import { SUMMARISER_SYSTEM_PROMPT } from '../summariser.js';
import { SUMMARY_HARD_CAP_CHARS } from '../summary-types.js';

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
// THE CAP UNIT — what the hard cap actually measures.
// ---------------------------------------------------------------------------

/**
 * Witnessed on deployed staging, scenario `8a8721ae`, 2026-09-08. All twenty
 * `v5.summary.updated` records for one real conversation: applied sizes climb
 * 702 → 975 → 1229 → 1460, and from there EVERY incremental pass is
 * `rejected_kept_prior / over_cap` — fourteen of twenty — with regenerations
 * briefly recovering at 1382 and 1479. The final rejection burned 9,559 ms and
 * 615 output tokens and then kept the old summary.
 *
 * The check measured `raw.length`, stamps included; the stored and injected
 * text has every `[tN]` stripped by `extractRefs` into
 * `slots[].entries[].source_turn_ids` and never re-rendered. So the cap charged
 * a summary for bytes it does not keep — while the prompt REQUIRES those
 * citations, making every extra turn eat the length budget with provenance
 * rather than content. That is the escalation the capture shows.
 *
 * ⚠ THESE FIXTURES ARE SIZE-FAITHFUL RECONSTRUCTIONS, NOT RECOVERED BYTES. The
 * capture records `chars`, tokens and reject reasons; the rejected summary text
 * itself was never persisted (that is the defect). They are built to sit either
 * side of the boundary on purpose, and are labelled as constructions rather
 * than presented as the real summaries.
 */
function summaryOfRetainedSize(retainedTarget: number, stampCount: number): string {
  // FRAME carries the filler; CONSTRAINTS carries the citations, exactly as the
  // prompt asks for ("cite the turn(s) it came from").
  const stamps = Array.from({ length: stampCount }, (_, i) => `[t${i + 1}]`).join(' ');
  const labels =
    'DECISION FRAME: \nCONSTRAINTS & PREFERENCES: Keep Berlin. \nRESOLVED: (none)\nOPEN: (none)';
  const fillerLen = Math.max(0, retainedTarget - labels.length);
  const filler = 'x'.repeat(fillerLen);
  return [
    `DECISION FRAME: ${filler}`,
    `CONSTRAINTS & PREFERENCES: Keep Berlin. ${stamps}`,
    'RESOLVED: (none)',
    'OPEN: (none)',
  ].join('\n');
}

const RETAINED = (raw: string): number => raw.replace(/\[\s*t\d+(?:\s*,\s*t\d+)*\s*\]/gi, '').length;

describe('parseSummaryOutput — the hard cap measures what is STORED, not what was typed', () => {
  it('ACCEPTS a summary whose content fits but whose citations pushed the raw bytes over', () => {
    // The regression case from the capture: content inside the ceiling, raw
    // outside it purely because the model obeyed the citation rule.
    const raw = summaryOfRetainedSize(SUMMARY_HARD_CAP_CHARS - 40, 30);
    expect(raw.length).toBeGreaterThan(SUMMARY_HARD_CAP_CHARS); // precondition
    expect(RETAINED(raw)).toBeLessThanOrEqual(SUMMARY_HARD_CAP_CHARS); // precondition

    const result = parseSummaryOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The citations were not merely tolerated — they were RETAINED as refs.
      const constraints = result.slots.find((s) => s.slot === 'CONSTRAINTS');
      expect(constraints?.refs.length).toBe(30);
      expect(constraints?.text).toContain('Keep Berlin.');
    }
  });

  it('DISCRIMINATION — the same shape with genuinely oversized CONTENT is still rejected', () => {
    // Without this counterpart the test above would pass against a cap that had
    // simply been raised or removed. Same builder, same stamps, more content.
    const raw = summaryOfRetainedSize(SUMMARY_HARD_CAP_CHARS + 200, 30);
    expect(RETAINED(raw)).toBeGreaterThan(SUMMARY_HARD_CAP_CHARS); // precondition
    const result = parseSummaryOutput(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('over_cap');
  });

  it('the cap NUMBER is unchanged — this is a unit repair, not a raised ceiling', () => {
    expect(SUMMARY_HARD_CAP_CHARS).toBe(1600);
    // One character of real content over the ceiling, with no citations at all,
    // still rejects: nothing was bought by loosening the limit.
    const bare = summaryOfRetainedSize(SUMMARY_HARD_CAP_CHARS + 1, 0);
    expect(RETAINED(bare)).toBe(bare.length);
    const result = parseSummaryOutput(bare);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('over_cap');
  });

  it('WITHIN-CAP CONTROL — the real applied sizes from the capture still parse', () => {
    // 1460 and 1479 are the two largest APPLIED summaries in the witnessed
    // journey. They must keep working exactly as before.
    for (const size of [702, 975, 1229, 1382, 1460, 1479]) {
      const raw = summaryOfRetainedSize(size, 8);
      const result = parseSummaryOutput(raw);
      expect(result.ok, `applied size ${size}`).toBe(true);
    }
  });

  it('CONSUMPTION — an accepted over-raw summary assembles to a stored text within the cap', () => {
    // The receiving end: what is actually persisted and later injected. If the
    // stored text exceeded the cap this repair would be moving bloat downstream
    // rather than correcting a unit.
    const raw = summaryOfRetainedSize(SUMMARY_HARD_CAP_CHARS - 40, 30);
    const parsed = parseSummaryOutput(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const ordinalMap = new Map<string, { turn_id: string; created_at: string }>();
    for (let i = 1; i <= 30; i += 1) {
      ordinalMap.set(`t${i}`, {
        turn_id: `turn-${i}`,
        created_at: `2026-09-08T00:${String(i).padStart(2, '0')}:00.000Z`,
      });
    }
    const assembled = assembleSummaryFromParsed({
      parsedSlots: parsed.slots,
      ordinalMap,
      watermark: { turn_id: 'turn-30', created_at: '2026-09-08T00:30:00.000Z' },
      version: 2,
      generator: 'incremental',
    });

    expect(assembled.text.length).toBeLessThanOrEqual(SUMMARY_HARD_CAP_CHARS);
    // The stamps are gone from the stored text and live on as resolved ids —
    // which is precisely why charging the cap for them was wrong.
    expect(assembled.text).not.toMatch(/\[t\d+\]/);
    const constraints = assembled.slots.find((s) => s.slot === 'CONSTRAINTS');
    expect(constraints?.entries[0]?.source_turn_ids.length).toBe(30);
    expect(assembled.text).toContain('Keep Berlin.');
  });

  it('MALFORMED AND REFUSAL BEHAVIOURS ARE UNTOUCHED by the unit change', () => {
    // Each of these is over the raw ceiling AND malformed; the malformed reason
    // must still win, and none of them may become acceptable.
    const long = 'x'.repeat(SUMMARY_HARD_CAP_CHARS + 400);
    expect(parseSummaryOutput('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseSummaryOutput('   \n  ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseSummaryOutput(`Here is your summary. ${long}`)).toMatchObject({ ok: false });
    expect(
      parseSummaryOutput(['DECISION FRAME: A.', 'RESOLVED: (none)', 'OPEN: (none)'].join('\n')),
    ).toMatchObject({ ok: false, reason: 'missing_slot' });
  });
});

describe('SUMMARISER_SYSTEM_PROMPT — the ceiling is stated in the unit it is enforced in', () => {
  it('names the real hard limit and excludes citations from it', () => {
    // The model used to be told 800-1400 and then judged against an unstated
    // 1600 — so an overshoot it could not see discarded the whole update.
    expect(SUMMARISER_SYSTEM_PROMPT).toContain(`The hard limit is ${SUMMARY_HARD_CAP_CHARS} characters`);
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('NOT counting the [tN] citations');
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('never drop a citation to save length');
    // And the existing target is retained, not replaced.
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('Keep the whole summary between');
  });
});
