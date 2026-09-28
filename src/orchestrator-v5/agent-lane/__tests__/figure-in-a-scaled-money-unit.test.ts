/**
 * ⭐ A FIGURE HELD IN A SCALED MONEY UNIT IS READ AT THE SCALE THE UNIT SAYS (DL #72 5862282849, journey A A2).
 *
 * Served `pj-20260928T023301Z` (CEE 79b69f8): the drafter held MRR in `£k/month` — target raw 100, today 75. The brief
 * says "£100k", which `findStatedAmounts` reads as 100,000, so `figureTheUserWrote(100, '£k/month', brief)` was false and
 * the goal lost its `threshold_source` on every turn. The unit's own magnitude letter is the scale the figure is in, so
 * 100 in £k/month IS the £100k the user wrote — the same reading `isAmountStatedInBrief` already gives `£k` (its
 * `readUnit` multiplier).
 *
 * The letter is read ONLY from a money unit (`readCurrencyUnitWithQualifiers`), so a unit with none is byte-identical
 * to before, and a scaled money unit no longer reads the UNSCALED figure: 100 in £k/month is never "£100".
 */
import { describe, expect, it } from 'vitest';

import { figureTheUserWrote } from '../stated-by-user.js';

const BRIEF = 'Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn under 4%, '
  + 'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';

describe('figureTheUserWrote reads a scaled money unit at its own scale', () => {
  it.each([
    ['the served target: 100 £k/month is "£100k"', 100, '£k/month', BRIEF, true],
    ['the served today level: 75 £k/month is the bare "75k"', 75, '£k/month', BRIEF, true],
    ['£m: 1.2 is "£1.2m"', 1.2, '£m', 'a budget of £1.2m this year', true],
    ['an ISO code with a letter: 400 GBPk is "£400k"', 400, 'GBPk', 'salary spend under £400k', true],
    ['a qualified £k unit: 100 £k MRR is "£100k MRR"', 100, '£k MRR', 'reach £100k MRR', true],
    ['CONTRAST: 120 £k/month is not in the brief', 120, '£k/month', BRIEF, false],
    ['CONTRAST: 100 £k/month is never the unscaled "£100 a month"', 100, '£k/month', 'we charge £100 a month', false],
    ['CONTRAST: 49 £k/month is never "£49" (a £49 price held as £49,000)', 49, '£k/month', BRIEF, false],
    ['CONTROL (unscaled, unchanged): 100000 GBP per month is "£100k"', 100000, 'GBP per month', BRIEF, true],
    ['CONTROL (unscaled, unchanged): 49 GBP/month is "£49"', 49, 'GBP/month', BRIEF, true],
    ['CONTROL (unchanged): a unit that is not money takes no letter: 100 "k" is not "100k"', 100, 'k', 'about 100k visits', false],
    ['CONTROL (unchanged): a percentage: 4 % is "under 4%"', 4, '%', BRIEF, true],
  ])('%s', (_label, value, unit, text, expected) => {
    expect(figureTheUserWrote(value, unit, text)).toBe(expected);
  });
});
