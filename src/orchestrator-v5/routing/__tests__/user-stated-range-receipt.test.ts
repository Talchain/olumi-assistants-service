/**
 * ⭐ RECOVERY BATCH E (DL, 12 Oct; score run 4 hiring step 13, B5/U5 BLOCKING): the read after the approval (02-13) holds
 * Paul's own 20–30 % range on 'Capacity used for non-development tasks', yet the receipt said "(0 to 100). Those ranges
 * are not yours." `isUserStatedRange` is the author half of `isStatedLevelRange`; a factor holding such a range is never
 * reported in `ranges_added_for_analysis` (the route row is (r‴) in agent-add-factor-door-seam.test.ts).
 *
 * Rows: the served node (both predicates true); contrasts by author (Olumi's inference, a brief's type-less stamp), by a
 * missing quote, and with no range at all.
 */
import { describe, expect, it } from 'vitest';
import { isStatedLevelRange, isUserStatedRange } from '../add-factor-transaction.js';

const QUOTE = "If we think of our development team's monthly capacity, currently they spend between 20% and 30% of their time on non-development tasks (e.g., meetings, admin, and other distractions that are not writing code).";
/** `observed_state` of fac_capacity_used_for_non_development_tasks in score run 4 hiring reads/02-13-after-approve.json. */
const SERVED = {
  cap: 100, unit: '% of monthly team capacity',
  range: { low: 20, high: 30, source: 'user_override', meaning: 'min_max', source_quote: QUOTE },
  value: 0.25, source: 'user_override', raw_value: 25, declared_scale: 'unit_interval', extractionType: 'explicit',
} as const;

describe('a range the user stated is recognised as theirs', () => {
  it('the served node after step 13: his range, his figure inside it', () => {
    expect(isUserStatedRange(SERVED.range)).toBe(true);
    expect(isStatedLevelRange(SERVED.range, SERVED)).toBe(true);
  });

  it.each([
    ['Olumi\'s inference', { ...SERVED.range, source: 'cee_inference' }],
    ['a brief\'s type-less stamp', { ...SERVED.range, source: 'brief_extraction' }],
    ['no quote of his words', { ...SERVED.range, source_quote: ' ' }],
    ['no range at all', undefined],
  ])('CONTRAST — %s: not the user\'s', (_name, range) => {
    expect(isUserStatedRange(range)).toBe(false);
  });
});
