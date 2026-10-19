/**
 * ⭐ A RANGE'S CLOSING SCALE BELONGS TO BOTH ENDS (DL-3 ruling on C5's finding, 19 Oct). "two to three" closed by a scale word,
 * and its digits, read the low end as a bare 2: a wrong number, credited as the user's. Every reader now reads a low end with no
 * scale of its own at the scale its high end closes with, in words and in digits. A low end with its own scale keeps it; a low end
 * with its own unit is another quantity.
 * ⛔ NEVER ONE END ALONE (DL-3 on Codex R2 #3442: "between 2 and three thousand" credited 2, "five million to seven" 7). A range
 * with no ONE shared scale gives nothing: written across the two forms, with the scale on its low end only, closed by no ONE scale,
 * or a bare count before money. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { amountsWrittenIn, figureTheUserWrote, timesTheUserWrote } from '../stated-by-user.js';
import { figuresWritten, userStated } from '../user-statements.js';
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
    ['words, a dash', 'We expect two – three million users.', [['words', 2_000_000], ['words', 3_000_000]]],
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
    ['no ONE scale closes the range, across forms', 'We expect 2 to three hundred and fifty thousand users.', []],
    ['a bare digit before money', 'We need 2 to £3m.', []],
    ['a bare word before money', 'We need two to £3m.', []],
  ])('REFUSED whole, never one end alone: %s: "%s"', (_case, text, expected) => { expect(read(text)).toEqual(expected); });
});

/** Codex R2 on #3442 @74770078 (held-out probes, adopted verbatim), then the rest of the class: across forms, and reversed. */
const NO_ONE_SHARED_SCALE = [
  'between 2 and three thousand',
  'five million to seven',
  'We expect two to 3 million users.',
  'We expect 2 to three million users.',
  'We expect between two and 3 thousand users.',
  'We expect two or 3k users.',
  'We expect 2 or three thousand users.',
  'We expect five million to 7 users.',
  'We expect 5 million to seven users.',
  'We expect 5 million to 7 users.',
  'We expect between 5 million and 7 users.',
  'We expect five million or seven users.',
  'We expect five million - seven users.',
  'We need £5m to 7.',
  // A low end this grammar reads no number from (an article, a fraction) still holds the range's scale.
  'We expect a million to 3 users.',
  'We expect a million to seven users.',
  'We expect 3 to a million users.',
  'We expect between a million and seven users.',
  'We expect a hundred to 3 hundred users.',
  'We expect a hundred and twenty to three users.',
  'We expect two thousand five to seven users.',
  'We need half a million to 7.',
];

describe('⛔ a range with no ONE shared scale gives nothing, never one end alone (Codex R2 on #3442)', () => {
  it.each(NO_ONE_SHARED_SCALE)('"%s": the located-amount reader reads neither end', (text) => {
    expect(read(text)).toEqual([]);
  });
  it.each(NO_ONE_SHARED_SCALE)('"%s": the authorship rule\'s span reader reads neither end', (text) => {
    expect(figuresWritten(text)).toEqual([]);
  });
  it.each([
    'We expect two and a half million to 3 users.',
    'We expect two and a half million to three users.',
    'We expect two and a half to 3 users.',
  ])('"%s": a fraction\'s low end holds the range; the high end is never read alone', (text) => {
    expect(read(text)).toEqual([]);
    // The authorship rule's reader still reads the "two" of "two and a half": the fraction class (#3438, fail-safe), on staging as here.
    expect(figuresWritten(text).filter((f) => f.low === 3 || f.low === 3_000_000)).toEqual([]);
  });
  const texts = (m: string) => ({ now: m, conversation: m, messages: [m] });
  it.each([
    ['between 2 and three thousand', 2], ['between 2 and three thousand', 3_000], ['five million to seven', 7], ['five million to seven', 5_000_000],
  ] as const)('"%s": %d is never the user\'s point', (quote, value) => {
    expect(userStated({ quote, value }, texts(`We think ${quote} is right.`), { quantity: 'level', node_id: 'fac_1' }).origin).not.toBe('human');
  });
  it('CONTRAST: a range with one shared scale is the user\'s at both ends, in words and in digits', () => {
    const texts1 = texts('We think between 2 and 3 thousand is right.');
    expect(userStated({ quote: 'between 2 and 3 thousand', value: 2_000 }, texts1, { quantity: 'level', node_id: 'fac_1' }).origin).toBe('human');
    expect(read('We expect between two and three thousand users.')).toEqual([['words', 2_000], ['words', 3_000]]);
  });
});

/**
 * Each side and connector with an end not read: an article before a number word, a word before a scale word, any "between … and" it
 * cannot read whole. An article before any other word is no amount (DL-3): "a few to twenty" and "several to twenty" read 20, disclosed
 * residuals (no word list).
 */
const AN_END_NOT_READ = [
  'We expect a hundred to 200 users.', 'We expect a million or two million users.', 'We expect twenty to a hundred users.',
  'We expect several hundred to 2,000 users.', 'We expect several hundred to three thousand users.', 'We expect a few hundred – twenty users.',
  'We expect 20 to a few hundred users.', 'We expect between 20 and a dozen users.', 'We expect between two and a dozen users.',
];

describe('⛔ a range is found by its connector: an end the grammar does not read means the range gives nothing (Codex R3 on #3445)', () => {
  it.each(AN_END_NOT_READ)('"%s": neither reader reads either end', (text) => {
    expect(read(text)).toEqual([]);
    expect(figuresWritten(text)).toEqual([]);
  });
  const texts = (m: string) => ({ now: m, conversation: m, messages: [m] });
  it('Codex R3\'s witness (typed) is never the user\'s 20 alone: the authorship rule reads no single end of a range', () => {
    const quote = 'People total a dozen to twenty people.';
    expect(userStated({ quote, value: 20 }, texts(quote), { quantity: 'level', node_id: 'people' }).origin).not.toBe('human');
  });
  it('CONTROL an article before a word that is no number is no amount: the goal target is the user\'s', () => {
    const quote = 'We want to grow a business to £20m.';
    expect(userStated({ quote, value: 20_000_000, unit: 'GBP' }, texts(quote), { quantity: 'goal_target', node_id: 'goal' }).origin).toBe('human');
  });
  it.each([
    ['We want to grow to twenty stores.', [20]], ['Grow the team to 20 people.', [20]], ['Increase MRR to £20k.', [20_000]],
    ['We need 20 or more customers.', [20]], ['Target – 20 hires.', [20]], ['Hire two to three engineers.', [2, 3]],
    ['We want to grow a business to £20m.', [20_000_000]], ['Take a team to 30 people.', [30]],
  ] as const)('CONTROL a connector beside no amount still reads its number: "%s"', (text, expected) => {
    expect(read(text).map(([, v]) => v)).toEqual(expected);
  });
});

describe('"dozen" is a compounder like "hundred" (DL-3, 19 Oct): Codex R3\'s witness reads its true range', () => {
  it.each([
    ['a dozen to twenty (Codex R3)', 'People total a dozen to twenty people.', [['words', 12], ['words', 20]]],
    ['between a dozen and twenty (Codex R3)', 'People total between a dozen and twenty people.', [['words', 12], ['words', 20]]],
    ['two dozen', 'We ordered two dozen laptops.', [['words', 24]]],
    ['dozens of: vague', 'We have dozens of customers.', []],
    ['half a dozen: the complete 6 or nothing, never 0.5 or 12', 'We need half a dozen engineers.', []],
    ['half a dozen in a range: never 12', 'We expect half a dozen to twenty users.', []],
    ['CONTROL a compound keeps its value', 'We sold two hundred and fifty thousand units.', [['words', 250_000]]],
  ])('%s: "%s"', (_case, text, expected) => { expect(read(text)).toEqual(expected); });
  it('the authorship rule reads "two dozen" as 24, never 2', () => {
    expect(figuresWritten('We ordered two dozen laptops.')).toEqual([{ low: 24, high: 24 }]);
    expect(figuresWritten('We need half a dozen engineers.').filter((f) => f.low === 12 || f.low === 0.5)).toEqual([]);
  });
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

  it('a refused range is no figure at all, at either end', () => {
    expect(figureTheUserWrote(2, undefined, 'We need 2 to £3m.')).toBe(false);
    expect(figureTheUserWrote(3_000_000, '£', 'We need 2 to £3m.')).toBe(false);
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
    expect(findStatedAmounts('We need 2 to £3m.').map((a) => a.magnitude)).toEqual([]);
  });
});

describe('⭐ GENERATED: every two-ended range gives its two true ends or nothing, in every reader (never one end alone)', () => {
  // Each end in digits or in words, joined four ways, with the scale on neither end, both, the high end only (it closes the range
  // for both) or the low end only (reversed: the true range is read at that scale, so a bare high end is never a figure).
  const ends = { digits: ['2', '3'], words: ['two', 'three'] } as const;
  const scales = [['thousand', 1_000], ['million', 1_000_000]] as const;
  const joins = [(a: string, b: string) => `${a} to ${b}`, (a: string, b: string) => `${a} or ${b}`, (a: string, b: string) => `${a} – ${b}`,
    (a: string, b: string) => `between ${a} and ${b}`];
  const cases: { text: string; truth: readonly number[] }[] = [];
  for (const low of ['digits', 'words'] as const) for (const high of ['digits', 'words'] as const) for (const join of joins) for (const [word, s] of scales) {
    const [l, h] = [ends[low][0], ends[high][1]];
    for (const [lowScaled, highScaled] of [[false, false], [true, true], [false, true], [true, false]] as const) {
      const text = `We expect ${join(lowScaled ? `${l} ${word}` : l, highScaled ? `${h} ${word}` : h)} users.`;
      cases.push({ text, truth: lowScaled || highScaled ? [2 * s, 3 * s] : [2, 3] });
    }
  }
  // An end the grammar reads no figure from, on either side of every connector: the range has no true reading, so nothing.
  for (const unread of ['a hundred', 'a million', 'a few hundred', 'several hundred']) for (const join of joins) for (const other of ['twenty', '20']) {
    cases.push({ text: `We expect ${join(unread, other)} users.`, truth: [] });
    cases.push({ text: `We expect ${join(other, unread)} users.`, truth: [] });
  }
  const bothOrNothing = (got: readonly number[], truth: readonly number[]): boolean =>
    got.length === 0 || [...got].sort((a, b) => a - b).join() === [...truth].join();

  it.each(cases.map((c) => [c.text, c.truth] as const))('"%s"', (text, truth) => {
    expect(bothOrNothing(read(text).map(([, v]) => v), truth), JSON.stringify(read(text))).toBe(true);
    const points = [...new Set(figuresWritten(text).filter((f) => f.low === f.high).map((f) => f.low))];
    expect(bothOrNothing(points, truth), JSON.stringify(figuresWritten(text))).toBe(true);
  });

  it('CONTROL the property is not vacuous: one form with one shared scale reads both ends', () => {
    const read2 = cases.filter((c) => read(c.text).length === 2);
    expect(read2.length).toBeGreaterThan(cases.length / 5);
    expect(cases.filter((c) => c.truth.length === 0).length).toBeGreaterThan(50);
    expect(read2.some((c) => /\btwo\b/.test(c.text)) && read2.some((c) => /\b2\b/.test(c.text))).toBe(true);
  });
});
