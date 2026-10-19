/**
 * ⛔ A NUMBER IN WORDS IS READ WHOLE OR NOT AT ALL (Codex #3438 R2/R3; DL-3 fail-safe ruling, 19 Oct). The ONE located-amount reader
 * reads a count in words, an article before a scale word ("a million", "a hundred and twenty") and decimals ("seven point five"). A fraction is no figure (an
 * under-claim, never a wrong number), a number word touching another one is part of a longer number and refused, and a number in words
 * is credited only as a complete span (its unit right after it), so a prefix of a longer amount, or a part left over after one, is
 * never a figure: R3 credited 120 from "a hundred and twenty and a half hours" and 2.5 from "the two and a half
 * millionth ticket"; Codex R4 found "plus five", ", and a quarter" and "-and-a-half". Generated: an ADJACENCY property (a number in
 * words is credited only with its unit right after it). SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { amountsWrittenIn, figureTheUserWrote, figureTheUserWroteFor } from '../stated-by-user.js';
import { CARDINAL_FRACTION_WORDS, CARDINAL_WORD_VALUES } from '../../../utils/cardinal-words.js';
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
    ['CODEX R4 "plus" after an article compound (credited 120)', 'It takes a hundred and twenty plus five hours.', []],
    ['CODEX R4 a comma before the fraction (credited 120)', 'It takes a hundred and twenty, and a quarter hours.', []],
    ['CODEX R4 a hyphenated fraction (credited 120)', 'It takes a hundred and twenty-and-a-half hours.', []],
    ['DECIMAL read whole', 'We have seven point five months of runway.', [7.5]],
    ['DECIMAL before a scale word', 'We raised two point five million pounds.', [2500000]],
    ['DECIMAL after a scale word is no reading', 'We raised two million point five pounds.', []],
    ['DECIMAL that is not digit words is no reading', 'It is twenty point twenty-five units.', []],
    ['CONTROL two counts joined by "or" both read, as before', 'Hire one or two engineers.', [1, 2]],
    ['CONTROL counts of different things both read', 'Hire one senior and two juniors.', [1, 2]],
    ['CONTROL "second-hand" is no ordinal', 'We bought two second-hand vans.', [2]],
    ['CONTROL an ordinal BEFORE a count starts no longer number (served s3-t5 brief)', 'We need 20 new customers during the first three months.', [3]],
    ['CONTROL a plain cardinal is unchanged', 'We have five cafés.', [5]],
    ['CONTROL an ordinal refuses', 'The twenty-third café opened.', []],
    ['CONTROL an ordinal after a cardinal refuses', 'This is our forty fifth order.', []],
    ['CONTROL a fraction of something is no figure', 'A third of the team is remote.', []],
    ['CONTROL a singular fraction after a cardinal is no figure', 'The twenty third café opened.', []],
  ])('%s: "%s" → %j', (_case, text, expected) => {
    expect(inWords(text).map((a) => a.magnitude)).toEqual(expected);
  });
});

/**
 * ⭐ ADJACENCY PROPERTY (DL-3 decision on Codex R4, outbox/DL-DECISION-COMPLETE-SPAN): a number in words is credited only as a complete
 * span, its quantity's noun right after it. Generated: amount × unit × an inserted token X drawn from broad word sets (every preposition
 * and conjunction, every number word of the one cardinal vocabulary, fractions, ordinals, digits, punctuation), never a list of the
 * continuations found so far. Adjacent: credited. X between: never credited, at the shared check and at the binder.
 */
describe('adjacency property: a number in words is credited only with its unit right after it', () => {
  const AMOUNTS: [string, number][] = [['two', 2], ['forty-five', 45], ['twenty five', 25], ['one hundred and five', 105],
    ['a hundred and twenty', 120], ['three thousand', 3000], ['seven point five', 7.5]];
  const UNITS: [string, string][] = [['hours per week', 'hours'], ['tickets per week', 'tickets'], ['minutes', 'minutes'], ['engineers', 'engineers']];
  const BREAKS = ['for', 'of', 'to', 'in', 'on', 'at', 'with', 'by', 'from', 'into', 'across', 'over', 'under', 'within', 'per', 'than', 'and',
    'or', 'but', 'while', 'which', 'that', 'who', 'as', 'so', 'if', 'when', 'before', 'after', 'because', 'plus', 'minus', 'times'];
  const NUMBERS = [...Object.keys(CARDINAL_WORD_VALUES), ...CARDINAL_FRACTION_WORDS, 'first', 'second', 'third', 'fifth', 'twentieth',
    'hundredth', 'millionth', '5', '12', '3.5', 'and a half', 'and a quarter', 'plus five', 'point two'];
  const PUNCTUATION = [',', ';', ':', ' -', '.', ' (', ', and', ', and a quarter', '-and-a-half'];
  const X = [...BREAKS.map((w) => ` ${w}`), ...NUMBERS.map((w) => ` ${w}`), ...PUNCTUATION];
  const scope = (label: string) => ({ target: [label], others: ['Day shift load'] });
  it('adjacent: credited; any inserted token: never credited, at the shared check and the binder', () => {
    let credited = 0, refused = 0;
    for (const [amount, value] of AMOUNTS) for (const [unit, noun] of UNITS) {
      const own = `Night shift load is ${amount} ${noun} this week.`;
      expect(figureTheUserWrote(value, unit, own), own).toBe(true);
      expect(figureTheUserWroteFor(value, unit, own, scope('Night shift load')), own).toBe(true);
      credited += 1;
      for (const x of X) {
        const text = `Night shift load is ${amount}${x} ${noun} this week.`;
        expect(figureTheUserWrote(value, unit, text), text).toBe(false);
        expect(figureTheUserWroteFor(value, unit, text, scope('Night shift load')), text).toBe(false);
        refused += 1;
      }
    }
    expect({ credited, refused }).toEqual({ credited: AMOUNTS.length * UNITS.length, refused: AMOUNTS.length * UNITS.length * X.length });
  });
  it('no unit at all, or another number word inside the noun phrase: never credited (digits keep their own grammar)', () => {
    expect(figureTheUserWrote(45, 'hours per week', 'Night shifts are forty-five now.')).toBe(false);
    expect(figureTheUserWrote(45, 'hours per week', 'Night shifts are forty-five.')).toBe(false);
    expect(figureTheUserWrote(45, 'hours per week', 'Night shift load is forty-five extra five hours.')).toBe(false);
    expect(figureTheUserWrote(45, 'hours per week', 'Night shifts are forty-five hours now.'), 'CONTROL the unit right after it').toBe(true);
    expect(figureTheUserWrote(45, 'hours per week', 'Night shifts are 45 now.'), 'CONTROL digits read as before').toBe(true);
  });
  it('CODEX R4: neither the amount before the inserted words nor a number inside them is credited', () => {
    for (const text of ['It takes a hundred and twenty plus five hours.', 'It takes a hundred and twenty, and a quarter hours.',
      'It takes a hundred and twenty-and-a-half hours.']) {
      for (const v of [120, 5, 125]) expect(figureTheUserWrote(v, 'hours', text), `${text} ${v}`).toBe(false);
      expect(figuresWritten(text).some((f) => f.low === 120 && f.high === 120), `${text} figuresWritten`).toBe(false);
    }
  });
});
