/**
 * ⭐ "EACH EXTRA CONVERSATION" WRITES A CHANGE OF ONE (R3 SCIENCE RULING #75 5925568501).
 * Served at CEE `3b0537c1` (06:00Z joined acceptance, guest 4644486f, turn 06): Paul's step-2 answer "Each extra
 * conversation brings in about £20,000" was refused (`not_the_users_figure`) — the link-size door needed the per-unit
 * figure written as a number. "each / every / per / one more / an extra / a single" + a word of the SOURCE quantity,
 * in one sentence with no punctuation between, IS the user writing a change of 1 of that unit. A plural with no
 * distributive word ("extra conversations bring £20,000") stays refused — it could be a total.
 */
import { describe, expect, it } from 'vitest';
import { linkEffectTheUserStated, statingSentenceOf } from '../stated-by-user.js';

const Q = ['Funding secured', 'Investment-firm funding secured', 'Angel funding secured', 'Qualified investment-firm conversations',
  'Qualified angel conversations', 'Hours per week on angel outreach'];
const effect = { amount: 20000, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'conversations' };
const ends = { source: 'Qualified investment-firm conversations', target: 'Investment-firm funding secured' };
const door = (s: string, e = effect) => linkEffectTheUserStated(s, e, ends, { quantities: Q });

describe('R3 5925568501: a distributive word + the source names a change of one', () => {
  it('RED (served step 2): "Each extra conversation brings in about £20,000 towards funding" → stated at per 1', () => {
    expect(door('Each extra conversation brings in about £20,000 towards funding')).toBeNull();
  });
  it('control (R3): "Extra conversations bring in about £20,000 towards funding" → refused (could be a total)', () => {
    expect(door('Extra conversations bring in about £20,000 towards funding')).not.toBeNull();
  });
  it('the approval card quotes that sentence (what Paul approves is the reading of his own words)', () => {
    const quote = 'We have £180k in the bank. Each extra conversation brings in about £20,000 towards funding.';
    expect(statingSentenceOf(quote, effect, ends, { quantities: Q })).toBe('Each extra conversation brings in about £20,000 towards funding');
  });
  for (const s of ['One more conversation adds about £20,000 to funding', 'Each extra investment-firm conversation adds about £20,000 to funding', 'Each extra conversation, we think, adds about £20,000 to funding',
    'We bring in about £20,000 of funding per extra conversation']) {
    it(`stated at per 1: "${s}"`, () => expect(door(s)).toBeNull());
  }
  for (const [s, why] of [
    ['Each, extra conversation adds about £20,000 to funding', 'punctuation inside the phrase'],
    ['Each angel conversation adds about £20,000 to funding', 'another quantity\'s word stands between'],
    ['We get about £20,000 of funding per quarter from investment-firm conversations', 'AIQ (1): "per" governs quarter'],
    ['One more round of conversations brings in £20,000 of funding', 'AIQ (2): the unit is a round'],
    ['Each extra new conversation adds about £20,000 to funding', 'two modifiers: the word no longer governs the noun'],
    ['Each phone conversation adds about £20,000 to funding', 'an unknown modifier names a KIND of conversation, not the source: under-claim'],
    ['Every week a conversation adds about £20,000 to funding', '"every week" counts weeks, not conversations: only extra/more/new or the source\'s own words may stand between'],
    ['Each extra conversation brings down funding by about £20,000', 'a bare "brings" is no direction (never read as money in)'],
  ] as const) {
    it(`refused (${why}): "${s}"`, () => expect(door(s)).not.toBeNull());
  }
  it('a written per figure still wins: "Every 2 extra conversations add about £20,000" is NOT read as per 1', () => {
    expect(door('Every 2 extra conversations add about £20,000 to funding')).not.toBeNull();
  });
});
