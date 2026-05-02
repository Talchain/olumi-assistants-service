/**
 * normaliseBriefText: input sanitisation for V5 Phase 1 brief persistence.
 *
 * Defence-in-depth alongside the DB CHECK constraint
 * `char_length(btrim(brief_text)) BETWEEN 1 AND 8000`. The helper must
 * NEVER throw on length and must collapse trimmed-empty inputs to
 * undefined so the RPC layer's WHERE clause does not see whitespace-only
 * values that would also fail the CHECK constraint.
 */

import { describe, expect, it } from 'vitest';

import { normaliseBriefText } from '../normalise-brief-text.js';

describe('normaliseBriefText', () => {
  it('returns undefined for null', () => {
    const r = normaliseBriefText(null);
    expect(r.value).toBeUndefined();
    expect(r.truncated).toBe(false);
    expect(r.originalLength).toBe(0);
  });

  it('returns undefined for undefined', () => {
    const r = normaliseBriefText(undefined);
    expect(r.value).toBeUndefined();
    expect(r.truncated).toBe(false);
    expect(r.originalLength).toBe(0);
  });

  it('returns undefined for empty string', () => {
    const r = normaliseBriefText('');
    expect(r.value).toBeUndefined();
    expect(r.truncated).toBe(false);
    expect(r.originalLength).toBe(0);
  });

  it('returns undefined for whitespace-only string', () => {
    const r = normaliseBriefText('   \n\t  ');
    expect(r.value).toBeUndefined();
    expect(r.truncated).toBe(false);
    expect(r.originalLength).toBe(0);
  });

  it('trims surrounding whitespace and returns the trimmed string', () => {
    const r = normaliseBriefText('  hello world  ');
    expect(r.value).toBe('hello world');
    expect(r.truncated).toBe(false);
    expect(r.originalLength).toBe('hello world'.length);
  });

  it('passes a short brief through unchanged', () => {
    const brief = 'Should I accept the offer at company X over staying at company Y?';
    const r = normaliseBriefText(brief);
    expect(r.value).toBe(brief);
    expect(r.truncated).toBe(false);
  });

  it('returns the trimmed string at exactly 8000 chars', () => {
    const exact = 'a'.repeat(8000);
    const r = normaliseBriefText(exact);
    expect(r.value).toBe(exact);
    expect(r.value?.length).toBe(8000);
    expect(r.truncated).toBe(false);
    expect(r.originalLength).toBe(8000);
  });

  it('truncates at 8001 chars (no spaces) — hard cut at 8000', () => {
    const over = 'a'.repeat(8001);
    const r = normaliseBriefText(over);
    expect(r.truncated).toBe(true);
    expect(r.value?.length).toBe(8000);
    expect(r.originalLength).toBe(8001);
  });

  it('truncates 16000 chars on a word boundary in the (7000, 8000) window', () => {
    // Build a brief where the last space before char 8000 falls > 7000.
    const head = 'a'.repeat(7500);
    const word = 'word';
    const tail = 'b'.repeat(10000);
    // Place a space at position 7500 so the last space within [0, 8000] is
    // at 7500 — well within the (7000, 8000) word-boundary window.
    const brief = `${head} ${word} ${tail}`;
    expect(brief.length).toBeGreaterThan(8000);

    const r = normaliseBriefText(brief);
    expect(r.truncated).toBe(true);
    // Truncated value must end at a space — not mid-word.
    expect(r.value).toBeDefined();
    if (r.value) {
      expect(r.value.endsWith(' ')).toBe(false); // space stripped by lastIndexOf-then-slice
      expect(r.value.length).toBeLessThanOrEqual(8000);
      // The value must not contain the right-side `b` runs because
      // truncation happened well before them.
      expect(r.value.includes('b')).toBe(false);
    }
  });

  it('hard-cuts at 8000 when no space exists in (7000, 8000)', () => {
    // 7500 chars of leading text with a single space at position 100 (well
    // below the 7000 word-boundary floor) followed by 1000 chars of
    // unbroken text. The last space within [0, 8000] is at 100, which is
    // <= 7000, so we hard-cut at 8000 instead of word-boundary.
    const text = 'x'.repeat(100) + ' ' + 'x'.repeat(8500);
    expect(text.length).toBeGreaterThan(8000);

    const r = normaliseBriefText(text);
    expect(r.truncated).toBe(true);
    expect(r.value?.length).toBe(8000);
  });

  it('does not throw on extremely long input', () => {
    const huge = 'word '.repeat(100_000); // ~500_000 chars
    expect(() => normaliseBriefText(huge)).not.toThrow();
    const r = normaliseBriefText(huge);
    expect(r.truncated).toBe(true);
    expect(r.value?.length).toBeLessThanOrEqual(8000);
  });

  it('reports originalLength as the post-trim length', () => {
    const padded = '   ' + 'real text' + '   ';
    const r = normaliseBriefText(padded);
    expect(r.originalLength).toBe('real text'.length);
  });
});
