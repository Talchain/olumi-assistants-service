/**
 * ⛔ A RANGE IS NEVER SUMMED, GLUED OR CUT (8b on #3438; DL-3; Codex R1 on #3442): the ONE located-amount reader read "between
 * two and three" as 5, "between twenty and one hundred" as 2,100, "two or three thousand" as 2 and 3,000, "a hundred and one"
 * as 1 and "seven point five" as 7 and 5, none of them a number the user wrote. The base grammar (`cardinal-words.ts`) now
 * consumes a range written in words WHOLE, so this reader gives its two ends (once it reads captures with `cardinalReadings`)
 * or nothing, and never a sum, a glue of the ends, a fragment, or one end alone. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { amountsWrittenIn } from '../stated-by-user.js';
import { findLinkEffectAmounts, hasLinkEffectRange } from '../link-effect-figures.js';

const inWords = (text: string): number[] => amountsWrittenIn(text).filter((a) => a.kind === 'words').map((a) => a.magnitude);

describe('the located-amount reader: a range written in words is its two ends or nothing', () => {
  it.each([
    ['between two and three', 'We need between two and three more bakers.', [2, 3]],
    ['between twenty and one hundred', 'Between twenty and one hundred orders arrive late.', [20, 100]],
    ['between two hundred and three thousand', 'Between two hundred and three thousand loaves are sold.', [200, 3_000]],
    ['between two and three million', 'Revenue will be between two and three million pounds.', [2_000_000, 3_000_000]],
    ['two to three', 'We need two to three more bakers.', [2, 3]],
    ['two or three thousand', 'We sell two or three thousand loaves.', [2_000, 3_000]],
    ['two to three million', 'Revenue is two to three million pounds.', [2_000_000, 3_000_000]],
  ])('%s: its two ends or nothing', (_case, text, ends) => {
    const read = inWords(text);
    expect([[], ends]).toContainEqual(read);
  });
  it.each([
    ['a hundred and one', 'We sold a hundred and one loaves.', [101]],
    ['seven point five', 'We waited seven point five weeks.', [7.5]],
  ])('%s: the whole value or nothing, never a fragment', (_case, text, whole) => { expect([[], whole]).toContainEqual(inWords(text)); });
  it('seven point five is its value (DL-3 ruling: a decimal in words is complete)', () => {
    expect(inWords('We have seven point five months of runway.')).toEqual([7.5]);
  });
  it.each([
    ['CONTROL a compound with "and" still reads whole', 'We sell two hundred and fifty loaves a day.', [250]],
    ['CONTROL a ten and a unit still read whole', 'We sell twenty five loaves a day.', [25]],
    ['CONTROL two numbers in two clauses', 'We have two ovens and three mixers.', [2, 3]],
  ])('%s', (_case, text, expected) => { expect(inWords(text)).toEqual(expected); });

  it('generated: ends × connectors × scales — never a number that is not one of the two ends', () => {
    const ENDS: ReadonlyArray<readonly [string, number]> = [
      ['two', 2], ['three', 3], ['twenty', 20], ['twenty five', 25], ['one hundred', 100], ['two hundred', 200], ['two hundred and fifty', 250],
    ];
    const CONNECTORS: ReadonlyArray<(x: string, y: string) => string> = [(x, y) => `between ${x} and ${y}`, (x, y) => `${x} to ${y}`, (x, y) => `${x} or ${y}`];
    const SCALES: ReadonlyArray<readonly [string, number]> = [['', 1], [' thousand', 1_000], [' million', 1_000_000]];
    const failures: string[] = [];
    for (const [lw, lv] of ENDS) for (const [hw, hv] of ENDS) for (const join of CONNECTORS) for (const [sw, sv] of SCALES) {
      if (lv >= hv) continue;
      const text = `We plan ${join(lw, hw + sw)} units.`;
      // The two ends, read either way the scale may be shared; anything else is a sum, a glue or a fragment.
      const allowed = new Set([lv, lv * sv, lv * 100, hv * sv]);
      const read = inWords(text);
      if (read.some((v) => !allowed.has(v)) || read.length === 1) failures.push(`${text} → ${JSON.stringify(read)}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('the link-size reader: a range written in words is a range of its two ends', () => {
  it.each([
    ['two to three', 'It cuts churn by two to three points.', true, [2, 3]],
    ['between two and three (never 5)', 'It cuts churn by between two and three points.', true, [2, 3]],
    ['twenty to thirty thousand (the shared scale)', 'It adds twenty to thirty thousand pounds.', true, [20_000, 30_000]],
    ['two point five (a decimal is one figure)', 'It cuts churn by two point five points.', false, [2.5]],
    ['CONTROL one figure', 'It cuts churn by two points.', false, [2]],
  ])('%s', (_case, quote, range, amounts) => {
    expect(hasLinkEffectRange(quote)).toBe(range);
    expect(findLinkEffectAmounts(quote).map((a) => a.magnitude)).toEqual(amounts);
  });
});
