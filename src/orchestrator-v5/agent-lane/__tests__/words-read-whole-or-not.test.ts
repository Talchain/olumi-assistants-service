/**
 * ⛔ A NUMBER IN WORDS IS READ WHOLE OR NOT AT ALL (Codex #3438 R2/R3; DL-3 fail-safe ruling, 19 Oct). The ONE located-amount reader
 * reads a count in words and an article before a scale word ("a million", "a hundred and twenty"). A fraction is no figure (an
 * under-claim, never a wrong number), and every capture takes its whole continuation with it, so a prefix of a longer amount, or a part
 * left over after one, is never a figure: R3 credited 120 from "a hundred and twenty and a half hours" and 2.5 from "the two and a half
 * millionth ticket". Generated: every amount phrase × every continuation gives the complete value or nothing. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { amountsWrittenIn, figureTheUserWrote } from '../stated-by-user.js';
import { figuresWritten } from '../user-statements.js';

const inWords = (text: string) => amountsWrittenIn(text).filter((a) => a.kind === 'words');

describe('the located-amount reader: articles read, fractions refused (C5\'s rows, under the fail-safe ruling)', () => {
  it.each([
    ['a million', 'We serve a million customers.', [1000000]],
    ['a hundred', 'We sell a hundred loaves a day.', [100]],
    ['a hundred and twenty', 'We sell a hundred and twenty loaves a day.', [120]],
    ['FRACTION half a million', 'We have half a million pounds available.', []],
    ['FRACTION a quarter of a million', 'We raised a quarter of a million pounds.', []],
    ['FRACTION three quarters of a million', 'We raised three quarters of a million pounds.', []],
    ['FRACTION two and a half million', 'Revenue is two and a half million pounds.', []],
    ['FRACTION one and a half million', 'Revenue is one and a half million pounds.', []],
    ['FRACTION two and a half', 'Delivery takes two and a half days.', []],
    ['FRACTION two thirds', 'Two thirds of orders are late.', []],
    ['FRACTION one third', 'One third of orders are late.', []],
    ['CODEX R3 a fraction after an article compound (credited 120)', 'It takes a hundred and twenty and a half hours.', []],
    ['CODEX R3 an ordinal after a fraction (credited 2.5)', 'This is the two and a half millionth ticket.', []],
    ['CONTROL a plain cardinal is unchanged', 'We have five cafés.', [5]],
    ['CONTROL an ordinal refuses', 'The twenty-third café opened.', []],
    ['CONTROL an ordinal after a cardinal refuses', 'This is our forty fifth order.', []],
    ['CONTROL a fraction of something is no figure', 'A third of the team is remote.', []],
    ['CONTROL a singular fraction after a cardinal is no figure', 'The twenty third café opened.', []],
  ])('%s: "%s" → %j', (_case, text, expected) => {
    expect(inWords(text).map((a) => a.magnitude)).toEqual(expected);
  });
});

describe('the complete value or nothing, never a prefix: every amount phrase × every continuation', () => {
  const PHRASES: [string, number][] = [
    ['two', 2], ['forty five', 45], ['twenty-five', 25], ['two hundred', 200], ['one hundred and five thousand', 105000],
    ['three thousand', 3000], ['two million', 2000000], ['a hundred', 100], ['a hundred and twenty', 120], ['a million', 1000000],
  ];
  const CONTINUATIONS: [string, 'refused' | 'whole or nothing'][] = [
    [' and a half', 'refused'], [' and a quarter', 'refused'], [' and two thirds', 'refused'], ['-thirds', 'refused'],
    [' point five', 'refused'], [' point two five', 'refused'],
    [' millionth', 'refused'], ['-millionth', 'refused'], [' thousandth', 'refused'], ['-fifth', 'refused'], [' and fifth', 'refused'],
    [' and a half million', 'refused'], [' and a half million and fifty thousand', 'refused'], [' quarters of a million', 'refused'],
    [' and twenty', 'whole or nothing'], [' and three', 'whole or nothing'], [' and fifty thousand', 'whole or nothing'],
  ];
  it('the reader, the verifier\'s figure list and the shared check never read the phrase\'s own value out of a longer amount', () => {
    let rows = 0;
    for (const [phrase, value] of PHRASES) for (const [cont, verdict] of CONTINUATIONS) {
      const amount = `${phrase}${cont}`, text = `We need ${amount} hours this week.`;
      const read = inWords(text);
      if (verdict === 'refused') expect(read.map((a) => a.matchedText), text).toEqual([]);
      else expect(read.length === 0 || (read.length === 1 && read[0]!.matchedText === amount), `${text} → ${JSON.stringify(read)}`).toBe(true);
      expect(figuresWritten(text).some((f) => f.low === value && f.high === value), `${text} figuresWritten`).toBe(false);
      expect(figureTheUserWrote(value, 'hours', text), `${text} shared check`).toBe(false);
      rows += 1;
    }
    expect(rows).toBe(PHRASES.length * CONTINUATIONS.length);
  });
  it('CONTROL each phrase alone is read, at its own value, by all three', () => {
    for (const [phrase, value] of PHRASES) {
      const text = `We need ${phrase} hours this week.`;
      expect(inWords(text).map((a) => a.magnitude), text).toEqual([value]);
      expect(figuresWritten(text).some((f) => f.low === value && f.high === value), `${text} figuresWritten`).toBe(true);
      expect(figureTheUserWrote(value, 'hours', text), `${text} shared check`).toBe(true);
    }
  });
});
