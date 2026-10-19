/**
 * ⛔ A RANGE IS NEVER SUMMED (8b on #3438; DL-3): the ONE located-amount reader read "between two and three" as 5, a number the
 * user never wrote. The base cardinal grammar (`parseCardinalAmount`) now folds only an English compound, so a range gives its
 * two ends or nothing. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { amountsWrittenIn } from '../stated-by-user.js';

const inWords = (text: string): number[] => amountsWrittenIn(text).filter((a) => a.kind === 'words').map((a) => a.magnitude);

describe('the located-amount reader never sums a range written in words', () => {
  it.each([
    ['between two and three', 'We need between two and three more bakers.'],
    ['between twenty and thirty', 'Between twenty and thirty orders arrive late each week.'],
    ['between two and three million', 'Revenue will be between two and three million pounds.'],
    ['between two hundred and three hundred', 'Between two hundred and three hundred loaves are left over.'],
  ])('%s: never their sum', (_case, text) => {
    const read = inWords(text);
    for (const sum of [5, 50, 5_000_000, 20_300, 500]) expect(read).not.toContain(sum);
  });
  it.each([
    ['two to three', 'We need two to three more bakers.', [2, 3]],
    ['two or three', 'We need two or three more bakers.', [2, 3]],
  ])('%s: its two ends', (_case, text, ends) => { expect(inWords(text)).toEqual(ends); });
  it.each([
    ['CONTROL a compound with "and" still reads whole', 'We sell two hundred and fifty loaves a day.', [250]],
    ['CONTROL a ten and a unit still read whole', 'We sell twenty five loaves a day.', [25]],
  ])('%s', (_case, text, expected) => { expect(inWords(text)).toEqual(expected); });
});
