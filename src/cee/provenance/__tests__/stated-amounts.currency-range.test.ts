/**
 * ⭐ A CURRENCY RANGE SHARES ITS CURRENCY AND ITS MAGNITUDE WITH BOTH ENDS (R3 #75 5918453000 A4; MG 5918487838).
 *
 * Paul's funding brief says "investment firms that do deals between £1-2 million". It was read as `£1` (currency, 1)
 * and `2 million` (plain), so neither end of the stated deal size could ever be the user's figure in money: £1m was
 * nowhere, and £2m was not money. Rows: the written shapes that share a currency and a magnitude read both ends; every
 * other shape reads exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { findStatedAmounts } from '../stated-amounts.js';

const read = (text: string) => findStatedAmounts(text).map((a) => ({ magnitude: a.magnitude, kind: a.kind, currencyCode: a.currencyCode }));
const gbp = (magnitude: number) => ({ magnitude, kind: 'currency', currencyCode: 'GBP' });

describe('a currency range reads both ends in its currency and magnitude', () => {
  it.each([
    ["Paul's brief: deals between £1-2 million", "We've been focused on investment firms that do deals between £1-2 million, mostly based in the UK."],
    ['an en dash', 'Deals run £1–2 million.'],
    ['a short suffix', 'Deals run £1-2m.'],
    ['"to"', 'Deals run £1 to 2 million.'],
    ['both ends written in full (R3: the same pair)', 'Deals run £1m–£2m.'],
    ['"between … and …" with the currency on both ends', 'Deals run between £1 and £2 million.'],
  ])('RED: %s → £1,000,000 and £2,000,000', (_name, text) => {
    expect(read(text)).toEqual([gbp(1_000_000), gbp(2_000_000)]);
  });

  it.each([
    ['both ends carry their own magnitude (already read)', 'Deals are £1m to £2m.', [gbp(1_000_000), gbp(2_000_000)]],
    ['the second end has no magnitude', 'Tickets cost £5-10.', [gbp(5), { magnitude: 10, kind: 'plain', currencyCode: undefined }]],
    ['a different currency on the second end', 'Deals run £1 to €2 million.', [gbp(1), { magnitude: 2_000_000, kind: 'currency', currencyCode: 'EUR' }]],
    ['not joined as a range', 'We have £1 left and 2 million users.', [gbp(1), { magnitude: 2_000_000, kind: 'plain', currencyCode: undefined }]],
    ['a percent second end', 'Margins of £1-15% are fine.', [gbp(1), { magnitude: 15, kind: 'percent', currencyCode: undefined }]],
    // R3 5918513716: "and" without "between" is two amounts, not a range.
    ['"£1 and 2 million customers" (no "between")', 'We raised £1 and 2 million customers signed up.', [gbp(1), { magnitude: 2_000_000, kind: 'plain', currencyCode: undefined }]],
  ] as const)('CONTROL: %s → read exactly as before', (_name, text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});
