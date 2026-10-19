/**
 * ⭐ A RANGE'S CLOSING SCALE BELONGS TO BOTH ENDS (DL-3 ruling on C5's finding, 19 Oct). "two to three" closed by a scale word,
 * and its digits, read the low end as a bare 2: a wrong number, credited as the user's. The ONE located-amount reader now reads a
 * low end with no scale of its own at the scale its high end closes with, in words, in digits and across the two. A low end with
 * its own scale keeps it; a low end with its own unit is another quantity; where no ONE scale closes the range, or the high end is
 * money and the low end a bare count, the low end is refused, never credited bare. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { amountsWrittenIn, figureTheUserWrote, timesTheUserWrote } from '../stated-by-user.js';
import { findJoinedRanges, findStatedAmounts } from '../../../cee/provenance/stated-amounts.js';

const read = (text: string): [string, number][] =>
  [...amountsWrittenIn(text)].sort((x, y) => x.index - y.index).map((a) => [a.kind, a.magnitude]);

describe('the one reader: a range closed by a scale word shares it with its low end', () => {
  it.each([
    ['words, "to"', 'We need two to three million pounds of funding.', [['words', 2_000_000], ['words', 3_000_000]]],
    ['digits, "to"', 'We need 2 to 3 million pounds of funding.', [['plain', 2_000_000], ['plain', 3_000_000]]],
    ['digits, "between … and"', 'We need between 2 and 3 million pounds of funding.', [['plain', 2_000_000], ['plain', 3_000_000]]],
    ['digits, a dash', 'We expect 2-3 million users.', [['plain', 2_000_000], ['plain', 3_000_000]]],
    ['digits, a letter', 'We expect 2 to 3m users.', [['plain', 2_000_000], ['plain', 3_000_000]]],
    ['words, "or"', 'We expect two or three million users.', [['words', 2_000_000], ['words', 3_000_000]]],
    ['digits, "or"', 'We expect 2 or 3 million users.', [['plain', 2_000_000], ['plain', 3_000_000]]],
    ['words, a compound scale', 'We expect two to three hundred thousand users.', [['words', 200_000], ['words', 300_000]]],
    ['words, a compound lead', 'We expect ten to twenty-five thousand users.', [['words', 10_000], ['words', 25_000]]],
    ['words, a scale of a hundred', 'We expect two to three hundred visitors.', [['words', 200], ['words', 300]]],
    ['across forms, words then digits', 'We expect two to 3 million users.', [['words', 2_000_000], ['plain', 3_000_000]]],
    ['across forms, digits then words', 'We expect 2 to three million users.', [['plain', 2_000_000], ['words', 3_000_000]]],
  ])('%s: "%s"', (_case, text, expected) => { expect(read(text)).toEqual(expected); });
});

describe('the one reader: what a range does NOT share', () => {
  it.each([
    ['CONTROL each end with its own letter', 'We need 2m to 3m pounds.', [['plain', 2_000_000], ['plain', 3_000_000]]],
    ['the low end keeps its own scale, words', 'We need two thousand to three million pounds.', [['words', 2_000], ['words', 3_000_000]]],
    ['the low end keeps its own scale, digits', 'We need 2k to 3 million pounds.', [['plain', 2_000], ['plain', 3_000_000]]],
    ['the low end keeps its own scale, a hundred', 'We need two hundred to three million pounds.', [['words', 200], ['words', 3_000_000]]],
    ['CONTROL money already shares (A4)', 'Deals of £2-3m.', [['currency', 2_000_000], ['currency', 3_000_000]]],
    ['CONTROL no scale word, digits', 'Hire 2 to 3 engineers.', [['plain', 2], ['plain', 3]]],
    ['CONTROL no scale word, words', 'Hire two to three engineers.', [['words', 2], ['words', 3]]],
    ['CONTROL a high end that does not close with a scale word', 'Hire ten to one hundred and twenty people.', [['words', 10], ['words', 120]]],
    ['MIXED UNIT: a percent low end is its own unit', 'Churn fell 2% to 3 million customers.', [['percent', 2], ['plain', 3_000_000]]],
    ['MIXED UNIT: a noun after the low end, digits', 'We grew from 2 sites to 3 million customers.', [['plain', 2], ['plain', 3_000_000]]],
    ['MIXED UNIT: a noun after the low end, words', 'We grew from two sites to three million customers.', [['words', 2], ['words', 3_000_000]]],
    ['MIXED UNIT: "and" without "between" is two amounts', 'We have 2 and 3 million customers.', [['plain', 2], ['plain', 3_000_000]]],
  ])('%s: "%s"', (_case, text, expected) => { expect(read(text)).toEqual(expected); });

  it.each([
    // A range gives its two ends or nothing (DL-3 range rule; C5 #3442): with no ONE scale to share, neither end is read alone.
    ['no ONE scale closes the range', 'We expect two to three hundred and fifty thousand users.', []],
    // Across forms the two ends are two captures: the bare low end is refused, the high end is read whole as written.
    ['no ONE scale closes the range, across forms', 'We expect 2 to three hundred and fifty thousand users.', [['words', 350_000]]],
    ['a bare digit before money', 'We need 2 to £3m.', [['currency', 3_000_000]]],
    ['a bare word before money', 'We need two to £3m.', [['currency', 3_000_000]]],
  ])('REFUSED, never credited bare: %s: "%s"', (_case, text, expected) => { expect(read(text)).toEqual(expected); });
});

describe('what the user wrote: a bare low end is never their figure', () => {
  it.each([
    'We expect 2 to 3 million users.',
    'We expect between 2 and 3 million users.',
    'We expect 2 or 3 million users.',
  ])('"%s": 2 is not written; the low end, at its scale, is', (text) => {
    expect(figureTheUserWrote(2, undefined, text)).toBe(false);
    expect(timesTheUserWrote(2, undefined, text)).toBe(0);
    expect(figureTheUserWrote(2_000_000, undefined, text)).toBe(true);
    expect(figureTheUserWrote(3_000_000, undefined, text)).toBe(true);
  });

  it.each([
    'We expect two to three million users.',
    'We expect two or three million users.',
  ])('"%s": in words, 2 is not written either', (text) => {
    expect(figureTheUserWrote(2, undefined, text)).toBe(false);
    expect(timesTheUserWrote(2, undefined, text)).toBe(0);
    expect(figureTheUserWrote(3_000_000, undefined, text)).toBe(true);
  });

  it('CONTROL a real 2 stays written beside a range of another quantity', () => {
    const text = 'We grew from 2 sites to 3 million customers.';
    expect(figureTheUserWrote(2, undefined, text)).toBe(true);
    expect(figureTheUserWrote(2_000_000, undefined, text)).toBe(false);
  });

  it('a refused low end is no figure at all', () => {
    expect(figureTheUserWrote(2, undefined, 'We need 2 to £3m.')).toBe(false);
    expect(figureTheUserWrote(2, undefined, 'We expect two to three hundred and fifty thousand users.')).toBe(false);
  });
});

describe('the digit reader: every consumer reads the range at its scale', () => {
  it('a digit range closed by a scale word is one range at that scale (findJoinedRanges)', () => {
    const [r] = findJoinedRanges('We expect 2 to 3 million users.');
    expect([r?.low.magnitude, r?.high.magnitude]).toEqual([2_000_000, 3_000_000]);
  });
  it('the digit reader itself never reads the bare low end', () => {
    expect(findStatedAmounts('We expect 2 to 3 million users.').map((a) => a.magnitude)).toEqual([2_000_000, 3_000_000]);
    expect(findStatedAmounts('We need 2 to £3m.').map((a) => a.magnitude)).toEqual([3_000_000]);
  });
});
