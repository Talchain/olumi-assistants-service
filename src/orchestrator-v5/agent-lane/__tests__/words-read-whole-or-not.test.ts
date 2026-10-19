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
import { figuresWritten, userStated } from '../user-statements.js';

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
const AMOUNTS: [string, number][] = [['two', 2], ['forty-five', 45], ['twenty five', 25], ['one hundred and five', 105],
  ['a hundred and twenty', 120], ['three thousand', 3000], ['seven point five', 7.5]];
const UNITS: [string, string][] = [['hours per week', 'hours'], ['tickets per week', 'tickets'], ['minutes', 'minutes'], ['engineers', 'engineers']];
const BREAKS = ['for', 'of', 'to', 'in', 'on', 'at', 'with', 'by', 'from', 'into', 'across', 'over', 'under', 'within', 'per', 'than', 'and',
  'or', 'but', 'while', 'which', 'that', 'who', 'as', 'so', 'if', 'when', 'before', 'after', 'because', 'plus', 'minus', 'times'];
const NUMBERS = [...Object.keys(CARDINAL_WORD_VALUES), ...CARDINAL_FRACTION_WORDS, 'first', 'second', 'third', 'fifth', 'twentieth',
  'hundredth', 'millionth', '5', '12', '3.5', 'and a half', 'and a quarter', 'plus five', 'point two'];
// Codex R5's "-odd" joins the broad set ("give or take" is its own row below: a headcount unit reads any word after the amount as the
// noun it counts, so "two give or take engineers" is that rule's, not this property's).
const PUNCTUATION = [',', ';', ':', ' -', '.', ' (', ', and', ', and a quarter', '-and-a-half', '-odd', ' or so'];
const X = [...BREAKS.map((w) => ` ${w}`), ...NUMBERS.map((w) => ` ${w}`), ...PUNCTUATION];

describe('adjacency property: a number in words is credited only with its unit right after it', () => {
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

/**
 * ⛔ THE VERIFIER READS THE SAME ELIGIBILITY (Codex #3438 R5 BLOCK: `figuresWritten` listed every amount in words with no span check,
 * so `userStated` verified 120 from "a hundred and twenty-odd hours" and "a hundred and twenty give or take five hours"). Its figure
 * list now goes through the one complete-span eligibility (`amountComplete`), in the statement's own unit. No phrase, parser or
 * refusal rule: the same adjacency property, at the verifier, beside the held-unit and own-source positives.
 */
describe('the verifier: the same complete-span eligibility as the one check', () => {
  const subject = { quantity: 'Night shift load' };
  const verified = (quote: string, value: number, unit: string): boolean =>
    userStated({ quote, form: 'point', value, unit }, { now: quote }, subject).origin === 'human';
  const listed = (quote: string, value: number, unit: string): boolean => figuresWritten(quote, unit).some((f) => f.low === value && f.high === value);
  it.each([
    ['CODEX R5 "-odd" after the amount', 'It takes a hundred and twenty-odd hours.', 120, 'hours'],
    ['CODEX R5 "give or take" after the amount', 'It takes a hundred and twenty give or take five hours.', 120, 'hours'],
    ['CODEX R6 the tolerance itself', 'It takes a hundred and twenty give or take five hours.', 5, 'hours'],
    ['CODEX R5 "give or take", per week', 'Night shifts take forty-five give or take five hours per week.', 45, 'hours per week'],
    ['CODEX R5 "-odd", per week', 'Night shifts take forty-odd hours per week.', 40, 'hours per week'],
    ['another counted noun, words', 'Correction: forty-five nurses cover the night shifts.', 45, 'hours per week'],
    ['no unit after the words', 'Night shifts are forty-five now.', 45, 'hours per week'],
  ])('%s: "%s" never verifies %d', (_case, quote, value, unit) => {
    expect(listed(quote, value, unit), 'figuresWritten').toBe(false);
    expect(verified(quote, value, unit), 'userStated').toBe(false);
    expect(figureTheUserWrote(value, unit, quote), 'the one check reads the same').toBe(false);
  });
  it.each([
    ['45 the held unit, words', 'Night shifts take forty-five hours per week.', 45, 'hours per week'],
    ['45 the held unit, digits', 'Night shifts take 45 hours per week.', 45, 'hours per week'],
    ['70 the held unit after a modifier, words', 'We now have seventy support tickets per week.', 70, 'tickets per week'],
    ['70 the held unit, digits', 'Our team resolves 70 tickets per week.', 70, 'tickets per week'],
    ['£59 the user\'s own price', 'We charge £59 per month for new Pro customers.', 59, 'GBP per month'],
    ['a headcount unit counts any noun', 'We have twelve support engineers.', 12, 'people'],
  ])('%s: "%s" verifies %d as the user\'s', (_case, quote, value, unit) => {
    expect(listed(quote, value, unit), 'figuresWritten').toBe(true);
    expect(verified(quote, value, unit), 'userStated').toBe(true);
    expect(figureTheUserWrote(value, unit, quote), 'the one check reads the same').toBe(true);
  });
  it('the speaker check reads the same places: words never credited cannot make another speaker\'s quoted figure the user\'s', () => {
    for (const own of ['a hundred and twenty-odd hours', 'a hundred and twenty give or take five hours']) {
      const quote = `It takes ${own}, as our manager said: \u201C120 hours\u201D.`;
      expect(verified(quote, 120, 'hours'), quote).toBe(false);
    }
    const control = 'It takes a hundred and twenty hours, as our manager said: \u201C120 hours\u201D.';
    expect(verified(control, 120, 'hours'), 'CONTROL the user\'s own complete span').toBe(true);
  });
  it('ADJACENCY at the verifier: adjacent verifies; any inserted token never does', () => {
    let credited = 0, refused = 0;
    for (const [amount, value] of AMOUNTS) for (const [unit, noun] of UNITS) {
      const own = `Night shift load is ${amount} ${noun} this week.`;
      expect(listed(own, value, unit), own).toBe(true);
      expect(verified(own, value, unit), own).toBe(true);
      credited += 1;
      for (const x of X) {
        const text = `Night shift load is ${amount}${x} ${noun} this week.`;
        expect(listed(text, value, unit), text).toBe(false);
        expect(verified(text, value, unit), text).toBe(false);
        refused += 1;
      }
    }
    expect({ credited, refused }).toEqual({ credited: AMOUNTS.length * UNITS.length, refused: AMOUNTS.length * UNITS.length * X.length });
  });
});

/**
 * ⛔ ONE JOINED EXPRESSION IS NO STANDALONE VALUE (DL-3 class rule on Codex #3438 R6: "… twenty give or take five hours" credited 5 as
 * the hours, and with engineers both 20 and 5). An amount joined, in one clause, to another that carries no unit of its own is a
 * tolerance or an operand: both are refused at every consumer (the shared check, the binder, the verifier's figure list, the
 * verifier). Generated: first operand (words, digits) × joining shape × second operand (words, digits) × unit. Controls: ranges,
 * changes, separate counts, a year, a ratio and a new sentence keep their figures. SYNTHETIC wording.
 */
describe('a joined expression: neither operand is a standalone value', () => {
  const FIRSTS: [string, number][] = [['twenty', 20], ['20', 20], ['a hundred and twenty', 120], ['120', 120]];
  const SHAPES = [' give or take ', ', give or take ', ' give or take about ', ' plus or minus ', ' ± ', ' +/- ', ' or ', ' plus '];
  const SECONDS: [string, number][] = [['five', 5], ['5', 5]];
  const JOINED_UNITS: [string, string][] = [['hours', 'hours'], ['hours per week', 'hours'], ['engineers', 'engineers'], ['people', 'engineers']];
  const subject = { quantity: 'Night shift load' };
  const scope = { target: ['Night shift load'], others: ['Day shift load'] };
  const credits = (text: string, value: number, unit: string): string[] => [
    figureTheUserWrote(value, unit, text) ? 'one check' : '',
    figureTheUserWroteFor(value, unit, text, scope) ? 'binder' : '',
    figuresWritten(text, unit).some((f) => f.low === value && f.high === value) ? 'figure list' : '',
    userStated({ quote: text, form: 'point', value, unit }, { now: text }, subject).origin === 'human' ? 'verifier' : '',
  ].filter((c) => c !== '');
  it('CODEX R6: "… twenty give or take five hours" credits neither 120 nor 5; with engineers neither 20 nor 5', () => {
    expect(credits('It takes a hundred and twenty give or take five hours.', 5, 'hours')).toEqual([]);
    expect(credits('It takes a hundred and twenty give or take five hours.', 120, 'hours')).toEqual([]);
    expect(credits('We need twenty give or take five engineers.', 5, 'engineers')).toEqual([]);
    expect(credits('We need twenty give or take five engineers.', 20, 'engineers')).toEqual([]);
  });
  it('generated: every operand of every joined shape is refused at all four consumers', () => {
    let rows = 0;
    for (const [first, a] of FIRSTS) for (const shape of SHAPES) for (const [second, b] of SECONDS) for (const [unit, noun] of JOINED_UNITS) {
      const text = `The night shift load is ${first}${shape}${second} ${noun} this week.`;
      for (const v of [a, b]) expect(credits(text, v, unit), `${v} ${unit} | ${text}`).toEqual([]);
      rows += 1;
    }
    expect(rows).toBe(FIRSTS.length * SHAPES.length * SECONDS.length * JOINED_UNITS.length);
  });
  it('a count in words right before plain digits is one expression ("ten 5-hour shifts")', () => {
    expect(credits('We run ten 5-hour shifts.', 5, 'hours')).toEqual([]);
    expect(credits('We run 5-hour shifts.', 5, 'hours'), 'CONTROL no count before it').toContain('one check');
  });
  it.each([
    ['a range is the range grammar\'s', 'Night shifts take 20 to 30 hours.', 30, 'hours'],
    ['a change from one level to another', 'We will grow from 400 to 500 customers.', 400, 'customers'],
    ['a change, its target', 'We will grow from 400 to 500 customers.', 500, 'customers'],
    ['separate counts, each with its own noun', 'Hire two engineers or five analysts.', 5, 'analysts'],
    ['separate counts in digits', 'We have 12 engineers and 5 designers.', 5, 'designers'],
    ['a year before a count', 'In 2024 we had 400 customers.', 400, 'customers'],
    ['a period after a target', 'We want to reach 500 customers in 6 months.', 500, 'customers'],
    ['a ratio keeps its own grammar', 'Our satisfaction score is 4.2/5 today.', 4.2, 'points'],
    ['a new sentence is never joined', 'The load is twenty. Give or take five hours of overtime is normal.', 5, 'hours'],
    ['the first amount carries its unit', 'Night shifts take 40 hours, give or take 5 hours.', 40, 'hours'],
    ['money carries its own unit', 'Yes, let\'s make that one £62 a month.', 62, 'GBP per month'],
  ])('CONTROL %s: "%s" still credits %d', (_case, text, value, unit) => {
    expect(figureTheUserWrote(value, unit, text), 'one check').toBe(true);
  });
});
