/**
 * ⭐ THE GUIDANCE COPY NAMES NO CONTEST (DL ruling: one class, guard consistency; e8 via Acceptance cut-4 prod 3b, #87).
 *
 * Every line the coach serves — a row's `short_copy` (the title), `why_now` and `reasoning_question`, in every variant
 * (`render.ts` `renderCopy`) — says what the model implies, never who wins: no "best", "beat", "leads", "ahead",
 * "winner", "favoured" or "recommend". Served before (Acceptance, near tie): "Is there a hybrid that takes the best of
 * each?"; also "A hybrid might beat both." and "… could change which option leads."
 *
 * Scope: the served copy fields only. The policy's own `never_say` lists QUOTE banned phrases on purpose, and
 * "scores highest" is CEE's sanctioned run-share phrasing (its one-verb move is a separate, parked class).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = JSON.parse(readFileSync(new URL('../guidance/reasoning-interventions.json', import.meta.url), 'utf8')) as {
  rows: Array<Record<string, unknown> & { policy_id: string }>;
};
const SERVED_FIELDS = ['short_copy', 'why_now', 'reasoning_question'] as const;
const CONTEST = /\b(best|winners?|winning|ahead|favou?red|favou?rite|beats?|leads|top choice|recommend\w*)\b/i;
/** Placeholders filled with a neutral word, so a label never trips (or hides) a hit. */
const filled = (s: string): string => s.replace(/\{[a-z_]+\}/g, 'Price');

function servedLines(): Array<{ at: string; text: string }> {
  const out: Array<{ at: string; text: string }> = [];
  for (const row of SOURCE.rows) {
    for (const field of SERVED_FIELDS) {
      const v = row[field];
      if (typeof v === 'string') out.push({ at: `${row.policy_id}.${field}`, text: v });
      else if (v !== null && typeof v === 'object') {
        for (const [variant, text] of Object.entries(v as Record<string, unknown>)) {
          if (typeof text === 'string') out.push({ at: `${row.policy_id}.${field}.${variant}`, text });
        }
      }
    }
  }
  return out;
}

describe('guidance copy: no contest words in any served line', () => {
  const lines = servedLines();

  it('the scan sees the served copy (magnitude: every row, every variant)', () => {
    expect(lines.length).toBeGreaterThanOrEqual(20);
    // CONTRAST — causal "lead to" is not a contest, and the scan reads it.
    expect(lines.some((l) => l.text === 'Missing drivers can hide dependencies that change how your routes affect the goal.')).toBe(true);
  });

  it.each(servedLines().map((l) => [l.at, l.text] as const))('%s names no contest', (_at, text) => {
    expect(filled(text)).not.toMatch(CONTEST);
  });

  it('POSITIVE CONTROL — the lines served before this change ARE caught', () => {
    for (const before of [
      'These options come out about the same. Is there a hybrid that takes the best of each?',
      'The options come out close. A hybrid might beat both.',
      'Price could change which option leads.',
    ]) expect(before).toMatch(CONTEST);
  });
});

describe('the new words, exactly', () => {
  const row = (i: number) => SOURCE.rows[i] as Record<string, Record<string, string> | string>;
  it('W5 (near tie)', () => {
    expect((row(0).reasoning_question as Record<string, string>).W5).toBe('These options come out about the same. Is there a hybrid that combines the strengths of each?');
    expect((row(0).short_copy as Record<string, string>).W5).toBe('The options come out close. A hybrid might combine the strengths of both.');
  });
  it('the sensitive factor', () => {
    expect((row(1).reasoning_question as Record<string, string>).range_olumi_assumed).toBe(
      'Do you know {factor_label} more precisely? Within Olumi\'s assumed range it could change how the options compare.');
    expect(row(1).short_copy).toBe('{factor_label} could change how the options compare.');
  });
});
