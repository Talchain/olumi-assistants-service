/**
 * Unit tests for the CQE word-number pre-pass compound guard.
 *
 * THE DEFECT (live, user-reachable): the pre-pass folds one..ten to digits
 * before the rule table scans. Without a compound guard it substitutes the
 * LEAD fragment of a multi-word number — "one hundred and forty" becomes
 * "1 hundred and forty" — and the deterministic value-update then commits the
 * fragment value (1), wrapped in confident copy, with zero LLM. Same silent
 * wrong-value class as the typed-chip bug, but reachable by ANY user typing a
 * compound word-number in chat.
 *
 * THE FIX (mechanism, this file's subject): `applyWordNumberPrePass` skips the
 * substitution whenever the matched word-number is adjacent (either side,
 * across whitespace/hyphen, optional "and" connector) to another number token
 * — a magnitude word, a tens word, or a digit. The phrase is left as words so
 * the compromise backstop / LLM reads the whole compound correctly. The
 * failure mode is therefore always "no partial-compound digit" → correct value
 * or LLM, NEVER a wrong number.
 *
 * Behaviour pinned at the bytes on origin/staging (2026-07-22, tip eb792d81)
 * via the runtime probe: pre-fix the live case extracted value 1; post-fix the
 * pre-pass leaves the phrase untouched and CQE extracts nothing → LLM.
 */

import { describe, it, expect } from 'vitest';

import { applyWordNumberPrePass } from '../word-numbers.js';

describe('applyWordNumberPrePass — compound guard (live silent wrong-value)', () => {
  // RED-FIRST: the verbatim live case. Reverting the guard makes the pre-pass
  // emit "1 hundred and forty" (a `start:27,end:28` replacement) and this
  // assertion goes RED — the exact fragment that gets committed as the value.
  it('the verbatim live case "…to one hundred and forty" is NOT folded to a lead digit', () => {
    const input = 'set support ticket load to one hundred and forty';
    const { text, replacements } = applyWordNumberPrePass(input);
    expect(text).toBe(input); // unchanged — no "1 hundred and forty"
    expect(replacements).toEqual([]);
    // Belt-and-braces: no bare digit was introduced anywhere.
    expect(text).not.toMatch(/\b1\b/);
  });

  // ------------------------------------------------------------------
  // Compound hazard sweep. Every phrase here MUST be left as words (no
  // substitution) so no fragment can be committed. Reverting the guard turns
  // each of these RED (each currently folds its lead/embedded one..ten word to
  // a digit — verified at the bytes).
  //
  //  - "N hundred" — the digit path gives the WRONG value (N, not N·100).
  //  - "N hundred and M" — the live class; fragment N gets committed.
  //  - "N thousand"/"N million" — the digit path happens to be correct
  //    (suffix-expanded), but the guard routes the whole compound uniformly
  //    to the backstop/LLM (which returns the same value) rather than
  //    enumerating which magnitudes are "safe" (a hand-maintained mirror we
  //    refuse to keep). See the note on `two thousand` below.
  //  - "grand" — slang thousand; the digit path gives N (wrong, not N·1000).
  //  - tens+ones ("twenty five", "forty-five") — the embedded ones word is a
  //    fragment; folding it to a digit is the same bug reached from the other
  //    side of the compound.
  // ------------------------------------------------------------------
  const COMPOUND_HAZARDS: readonly string[] = [
    'set X to one hundred',
    'set X to five hundred',
    'set X to eight hundred',
    'set X to nine hundred and six',
    'set X to two hundred and fifty',
    'set X to one hundred and one', // leading AND trailing ones both guarded
    'set X to hundred and five', // bare magnitude + "and" + trailing ones
    'set X to one hundred thousand',
    'set X to two thousand',
    'set X to ten thousand',
    'set X to six million',
    'set X to two thousand five hundred',
    'set X to five grand',
    'set X to twenty five thousand',
    'set X to forty five',
    'set X to twenty one',
    'set X to ninety nine',
    'set X to forty-five',
  ];

  it.each(COMPOUND_HAZARDS)('compound "%s" is left as words (no fragment substitution)', (input) => {
    const { text, replacements } = applyWordNumberPrePass(input);
    expect(replacements).toEqual([]);
    expect(text).toBe(input);
  });

  // ------------------------------------------------------------------
  // POSITIVE CONTROLS — genuine single word-numbers MUST still fold, so the
  // deterministic fast-path keeps working for the common "set X to seven" case.
  // Reverting the guard leaves these unchanged (they never triggered it), so
  // these pin that the guard did NOT over-reach.
  // ------------------------------------------------------------------
  const SINGLE_WORD_NUMBERS: ReadonlyArray<readonly [string, string]> = [
    ['one', '1'],
    ['two', '2'],
    ['three', '3'],
    ['four', '4'],
    ['five', '5'],
    ['six', '6'],
    ['seven', '7'],
    ['eight', '8'],
    ['nine', '9'],
    ['ten', '10'],
  ];

  it.each(SINGLE_WORD_NUMBERS)('bare single word-number "%s" still folds to "%s"', (word, digit) => {
    const { text, replacements } = applyWordNumberPrePass(word);
    expect(text).toBe(digit);
    expect(replacements).toEqual([{ start: 0, end: digit.length }]);
  });

  it('a genuine single in a sentence still folds: "set X to seven" → "set X to 7"', () => {
    const { text, replacements } = applyWordNumberPrePass('set X to seven');
    expect(text).toBe('set X to 7');
    expect(replacements).toEqual([{ start: 9, end: 10 }]);
  });

  it('"ten" folds to a two-char "10" with the correct span', () => {
    const { text, replacements } = applyWordNumberPrePass('increase X by ten');
    expect(text).toBe('increase X by 10');
    expect(replacements).toEqual([{ start: 14, end: 16 }]);
  });

  // Non-compound occurrences of a word-number (as an English pronoun/quantifier,
  // not adjacent to another number token) keep the PRE-EXISTING fold. The guard
  // is strictly negative — it only ADDS skips for compounds; it must not change
  // these long-standing substitutions.
  it('non-compound "one"/"two"/"five" keep the pre-existing fold', () => {
    expect(applyWordNumberPrePass('set X to one of the options').text).toBe('set X to 1 of the options');
    expect(applyWordNumberPrePass('pick two of the five').text).toBe('pick 2 of the 5');
    expect(applyWordNumberPrePass('the top three options').text).toBe('the top 3 options');
  });

  // RANGE / CONNECTOR pins — the compound guard's "and" bridge is magnitude-ONLY
  // ("hundred and six"), so an English range or list that puts "and"/"or"/"to"
  // between two INDEPENDENT numbers must still fold BOTH ends. (Regression guard:
  // an earlier draft's unconditional "and" bridge misread "5 and ten" as a
  // compound and dropped the fold on "ten", breaking CQE fixture A01.)
  it('a word-number range still folds both ends: "between five and ten" → "between 5 and 10"', () => {
    expect(applyWordNumberPrePass('between five and ten').text).toBe('between 5 and 10');
  });

  it('a "to" range still folds both ends: "three to five months" → "3 to 5 months"', () => {
    expect(applyWordNumberPrePass('three to five months').text).toBe('3 to 5 months');
  });

  it('an "or" list still folds both: "one or two factors" → "1 or 2 factors"', () => {
    expect(applyWordNumberPrePass('one or two factors').text).toBe('1 or 2 factors');
  });

  // Regression pin for the pre-existing FRACTION_FOLLOW guard — the compound
  // guard sits alongside it and must not disturb it.
  it('word fractions (P5-owned) are still left untouched', () => {
    expect(applyWordNumberPrePass('set X to one third').text).toBe('set X to one third');
    expect(applyWordNumberPrePass('set X to three quarters').text).toBe('set X to three quarters');
    expect(applyWordNumberPrePass('set X to two thirds').text).toBe('set X to two thirds');
  });

  // Digit input is untouched (nothing to fold) — the primary positive control.
  it('digit values pass through unchanged: "set X to 140"', () => {
    const { text, replacements } = applyWordNumberPrePass('set X to 140');
    expect(text).toBe('set X to 140');
    expect(replacements).toEqual([]);
  });

  // ------------------------------------------------------------------
  // MIXED FRACTION — "and a <fraction>" tail. Same corruption family: folding
  // the whole part to a digit ("one and a half" → "1 and a half") committed 1
  // and dropped the ".5". RED-first: the verbatim phrase must be left as words
  // (→ LLM), never yield a lead digit. (Reverting the FRACTION_FOLLOW "and a"
  // alternation turns each RED — the whole part folds to a digit again.)
  // ------------------------------------------------------------------
  const MIXED_FRACTIONS: readonly string[] = [
    'set X to one and a half',
    'set X to two and a quarter',
    'set X to one and a third',
    'set X to three and a half',
  ];

  it.each(MIXED_FRACTIONS)('mixed fraction "%s" is left as words (no lead-digit fold)', (input) => {
    const { text, replacements } = applyWordNumberPrePass(input);
    expect(replacements).toEqual([]);
    expect(text).toBe(input);
  });

  // ------------------------------------------------------------------
  // SPOKEN DECIMAL — "point" separator. "one point five" folded to "1 point 5"
  // (lead 1 committed / .5 dropped) and "one point five million" to "1 point
  // five million" (committed 1). Both sides of "point" must be left as words.
  // RED-first: reverting the "point" connector re-folds "one"/"five" to digits.
  // ------------------------------------------------------------------
  const SPOKEN_DECIMALS: readonly string[] = [
    'set X to one point five',
    'set X to three point two',
    'set X to one point five million',
    'set X to nine point nine',
  ];

  it.each(SPOKEN_DECIMALS)('spoken decimal "%s" is left as words (both sides of "point")', (input) => {
    const { text, replacements } = applyWordNumberPrePass(input);
    expect(replacements).toEqual([]);
    expect(text).toBe(input);
  });

  it('a digit decimal is untouched and still parses: "set X to 1.5"', () => {
    const { text, replacements } = applyWordNumberPrePass('set X to 1.5');
    expect(text).toBe('set X to 1.5');
    expect(replacements).toEqual([]);
  });

  // SENTENCE-BOUNDARY control: a full stop then a NEW sentence starting "Point"
  // is NOT a decimal — the `[\s-]+` separator requires whitespace/hyphen
  // immediately after the word-number, and "." is neither. So the genuine
  // single "one" here still folds; the "point" guard must not over-reach across
  // a sentence break.
  it('a sentence boundary before "Point" does NOT suppress a genuine single: "…to one. Point taken…"', () => {
    const { text, replacements } = applyWordNumberPrePass('set X to one. Point taken about the budget');
    expect(text).toBe('set X to 1. Point taken about the budget');
    expect(replacements).toEqual([{ start: 9, end: 10 }]);
  });
});
