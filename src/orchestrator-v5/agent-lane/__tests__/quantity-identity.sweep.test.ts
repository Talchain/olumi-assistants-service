/**
 * ⭐ THE ONE QUANTITY-IDENTITY RULE, SWEPT: every generated case flips ONE input of a sentence that names the quantity, and the
 * flip alone must decide (Codex R1/R2 on #3433; DL-3: one rule for the limit door and the value door, a generated flip sweep).
 * Label families: plain, nested, unit-only, symbol (%, £) and a non-candidate second name (P05). SYNTHETIC labels and wording.
 *
 * Figures in WORDS: on this base only digits are read (`figureTheUserWroteSpan`), so a word form may never be accepted where its
 * digits are refused (one way only; the parity of the two forms is #3429's).
 */
import { describe, expect, it } from 'vitest';
import { figureIsThisQuantitys } from '../quantity-identity.js';

interface Family {
  readonly why: string;
  readonly target: string; readonly rival: string; readonly rivalCompetes: boolean;
  readonly unit: string; readonly value: number; readonly fig: string; readonly figWords?: string; readonly other: string;
  /** A bare number of this value, then a word of another label: it counts that thing. */
  readonly countsAnother?: string;
}
const ovens = { unit: 'ovens', value: 2, fig: '2 ovens', figWords: 'two ovens', other: '3 ovens' };
const pct = { unit: '%', value: 85, fig: '85%', figWords: 'eighty-five percent', other: '90%' };
const gbp = { unit: '£', value: 2, fig: '£2', figWords: 'two pounds', other: '£3' };
const FAMILIES: readonly Family[] = [
  { why: 'plain', target: 'Oven capacity', rival: 'Shelf capacity', rivalCompetes: true, ...ovens },
  { why: 'nested (target inside rival)', target: 'Oven capacity', rival: 'Annual oven capacity', rivalCompetes: true, ...ovens },
  { why: 'nested (rival inside target)', target: 'Annual oven capacity', rival: 'Oven capacity', rivalCompetes: true, ...ovens },
  { why: 'unit-only target', target: 'Ovens', rival: 'Shelf capacity', rivalCompetes: true, ...ovens },
  { why: 'unit-only rival', target: 'Shelf capacity', rival: 'Ovens', rivalCompetes: true, ...ovens },
  { why: 'symbol target %', target: '%', rival: 'Shelf completion', rivalCompetes: true, ...pct, countsAnother: '85 shelves' },
  { why: 'symbol rival %', target: 'Shelf completion', rival: '%', rivalCompetes: true, ...pct, countsAnother: '85 shelves' },
  { why: 'symbol target £', target: '£', rival: 'Budget', rivalCompetes: true, ...gbp },
  { why: 'symbol rival £', target: 'Budget', rival: '£', rivalCompetes: true, ...gbp },
  { why: 'P05: a second name that is no candidate', target: 'Remote requests served within 30 days', rival: 'Villages with two-day repair service',
    rivalCompetes: false, ...pct, countsAnother: '85 requests' },
];

const nameOf = (label: string): string => label.toLowerCase();
const decide = (f: Family, text: string, form: 'digits' | 'words' = 'digits'): boolean => figureIsThisQuantitys(
  form === 'words' && f.figWords !== undefined ? text.split(f.fig).join(f.figWords) : text, f.value, f.unit,
  { target: [f.target], others: [f.rival, 'Mixer speed'] }, f.rivalCompetes ? [{ label: f.rival, unit: f.unit }] : []).verdict === 'this';

/** [case, sentence, expected]: the base names the quantity; every other row changes one thing about it. */
function casesOf(f: Family): [string, string, boolean][] {
  const name = nameOf(f.target); const rival = nameOf(f.rival);
  return [
    ['BASE: names the quantity', `The ${name} limit should be at most ${f.fig}.`, true],
    ['FLIP turned down', `The ${name} limit should be at most ${f.other}, not ${f.fig}.`, false],
    ['FLIP turned down ("rather than")', `The ${name} limit should be ${f.other} rather than ${f.fig}.`, false],
    ['FLIP names the other label instead', `The ${rival} limit should be at most ${f.fig}.`, false],
    ['FLIP names both', `The ${name}/${rival} limit should be at most ${f.fig}.`, !f.rivalCompetes],
    ['FLIP names a non-quantity word only', 'The mixer speed limit should be at most ' + f.fig + '.', false],
    ['FLIP names nothing', `Make it at most ${f.fig}.`, !f.rivalCompetes],
    ['FLIP the same figure, affirmed about nothing, turned down for this quantity', `We saw ${f.fig} yesterday. The ${name} limit should be at most ${f.other}, not ${f.fig}.`, false],
    ...(f.countsAnother === undefined ? [] : [['FLIP a bare number counting another thing, turned down for this quantity',
      `${f.countsAnother} arrived yesterday. The ${name} limit should be at most ${f.other}, not ${f.fig}.`, false] as [string, string, boolean]]),
    ['CONTROL: two quantities in one sentence, each its own clause', `Set the ${name} limit to ${f.fig} and the ${rival} limit to ${f.other}.`, true],
  ];
}

describe('the one quantity-identity rule: each flip alone decides (generated)', () => {
  for (const f of FAMILIES) {
    describe(f.why, () => {
      it.each(casesOf(f))('%s: "%s" → %s', (_case, text, expected) => {
        expect(decide(f, text)).toBe(expected);
        // One way only on this base: a figure in words is never accepted where its digits are refused.
        if (!expected) expect(decide(f, text, 'words')).toBe(false);
      });
    });
  }
});

describe('the full written unit: the same sentence names the quantity, and only the unit written after the figure changes', () => {
  const is = (text: string, unit: string): boolean =>
    figureIsThisQuantitys(text, 2, unit, { target: ['Team capacity'], others: ['Shelf capacity'] }, []).verdict === 'this';
  it.each([
    ['BASE: a headcount for a headcount', 'The team capacity limit should be at most 2 engineers.', 'engineers', true],
    ['BASE: a rate for a rate', 'The team capacity limit should be at most 2 engineers per week.', 'engineers per week', true],
    ['BASE: no unit written keeps the quantity\'s', 'The team capacity limit should be at most 2.', 'engineers per week', true],
    ['BASE: prose after the figure is no unit', 'The team capacity limit should be at most 2 by June.', 'engineers per week', true],
    ['FLIP a headcount into a rate', 'The team capacity limit should be at most 2 engineers.', 'engineers per week', false],
    ['FLIP a rate into a headcount', 'The team capacity limit should be at most 2 engineers per week.', 'engineers', false],
    ['FLIP another period', 'The team capacity limit should be at most 2 engineers per month.', 'engineers per week', false],
    ['FLIP another counted thing', 'The team capacity limit should be at most 2 specialists.', 'tickets per week', false],
    ['FLIP a count into a percentage', 'The team capacity limit should be at most 2 requests.', '%', false],
    ['FLIP another denominator', 'The team capacity limit should be at most £2 per client.', '£ per engineer', false],
    // A headcount unit counts whatever its phrase names, as the ONE reader reads it (held-status-quo (b3): "We hire 3 developers").
    ['BASE: a headcount unit counts the people its phrase names', 'The team capacity limit should be at most 2 developers.', 'hires', true],
    ['FLIP the same phrase into a unit that counts a thing', 'The team capacity limit should be at most 2 developers.', 'tickets', false],
    ['FLIP the same people, as a rate, into a headcount', 'The team capacity limit should be at most 2 developers per week.', 'hires', false],
  ])('%s: "%s" into "%s" → %s', (_case, text, unit, expected) => { expect(is(text, unit)).toBe(expected); });
});

describe('the value door\'s shape (DL-3: "70 customers per week; the existing team capacity is unchanged")', () => {
  const scope = { target: ['Existing team capacity'], others: ['Weekly support capacity', 'Additional specialist capacity', 'Additional specialists'] };
  const candidates = [{ label: 'Weekly support capacity', unit: 'tickets per week' }, { label: 'Additional specialist capacity', unit: 'tickets per week' }];
  const is = (text: string): boolean => figureIsThisQuantitys(text, 70, 'tickets per week', scope, candidates).verdict === 'this';
  it.each([
    ['BASE: the clause names it', 'Correction: our existing team resolves 70 tickets per week, not 80.', true],
    ['FLIP the figure counts another thing; the named clause says unchanged', 'We now have 70 customers per week; the existing team capacity is unchanged.', false],
    ['FLIP the figure\'s clause names nothing; the name is in another clause', 'We now resolve 70 tickets per week; the existing team capacity is unchanged.', false],
    ['FLIP the figure\'s clause names another quantity', 'Additional specialist capacity is 70 tickets per week; the existing team stays as before.', false],
    ['FLIP a bare number counting another label\'s thing', 'We will hire 70 additional specialists; the existing team capacity is unchanged.', false],
  ])('%s: "%s" → %s', (_case, text, expected) => { expect(is(text)).toBe(expected); });
});
