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
  // AIQ 5925663053: the governed word must be what the source COUNTS (its unit noun, else its label's last word).
  for (const [source, sentence] of [
    ['Warm conversations with investment firms', 'Each investment firm brings in about £1m of funding'],
    ['Investor conversations', 'Every new investor brings in about £20,000 of funding'],
  ] as const) {
    it(`AIQ: "${sentence}" on "${source}" is per FIRM / INVESTOR, never per conversation → refused`, () => {
      const e2 = { ...effect, amount: sentence.includes('£1m') ? 1000000 : 20000 };
      expect(linkEffectTheUserStated(sentence, e2, { source, target: 'Funding secured' }, { quantities: ['Funding secured', source] })).not.toBeNull();
    });
  }
  it('AIQ control: "Each extra conversation with investment firms brings in about £20,000 of funding" on that source → per 1', () => {
    expect(linkEffectTheUserStated('Each extra conversation with investment firms brings in about £20,000 of funding', effect,
      { source: 'Warm conversations with investment firms', target: 'Funding secured' }, { quantities: ['Funding secured', 'Warm conversations with investment firms'] })).toBeNull();
  });

  // CODEX 5925755067: a compound unit binds only its HEAD noun; its qualifiers are crossed, never bound.
  const qualified = { ...effect, per_source_change_unit: 'qualified investment-firm conversations' };
  it('CODEX: "Each qualified round of conversations…" (unit "qualified investment-firm conversations") counts ROUNDS → refused', () => {
    expect(door('Each qualified round of conversations brings in about £20,000 towards funding', qualified)).not.toBeNull();
  });
  it('CODEX control: "Each qualified conversation…" on that unit → per 1', () => {
    expect(door('Each qualified conversation brings in about £20,000 towards funding', qualified)).toBeNull();
  });
  it('a rate unit ("conversations per week") counts its noun before "per": "Each extra conversation…" → per 1', () => {
    expect(door('Each extra conversation brings in about £20,000 towards funding', { ...effect, per_source_change_unit: 'conversations per week' })).toBeNull();
  });

  // CODEX 5925831728: a money/symbol unit has no head noun to count — an unsized "price rise" never invents £1.
  for (const unit of ['£/month', '£ per month']) {
    const price = { amount: -50, amount_unit: 'paying subscribers', per_source_change: 1, per_source_change_unit: unit };
    const priceEnds = { source: 'Pro plan price', target: 'Paying subscribers' };
    const pq = { quantities: ['Pro plan price', 'Paying subscribers', 'MRR'] };
    it(`CODEX (${unit}): "Each Pro price rise loses us about 50 paying subscribers" sizes no rise → refused`, () => {
      expect(linkEffectTheUserStated('Each Pro price rise loses us about 50 paying subscribers', price, priceEnds, pq)).not.toBeNull();
    });
    it(`CODEX control (${unit}): "Each £1 Pro price rise loses us about 50 paying subscribers" → stated`, () => {
      expect(linkEffectTheUserStated('Each £1 Pro price rise loses us about 50 paying subscribers', price, priceEnds, pq)).toBeNull();
    });
  }

  it('a written per figure still wins: "Every 2 extra conversations add about £20,000" is NOT read as per 1', () => {
    expect(door('Every 2 extra conversations add about £20,000 to funding')).not.toBeNull();
  });
});

// ⛔ CODEX #2443 5929515612: a quantity in a NUMBERED label is still a quantity. "Every 100 investor conversations …" on the
// source "100 investor conversations" is per 100, never per one (100× too strong), and a number word the same.
describe('a numbered source label: the distributive walk never crosses a quantity', () => {
  const numbered = { source: '100 investor conversations', target: 'Funding secured' };
  const q = ['100 investor conversations', 'Funding secured'];
  const per1 = { ...effect, per_source_change_unit: '100 investor conversations' };
  it('CODEX hostile: "Every 100 investor conversations bring in about £20,000 of funding" is NOT stated at per 1', () => {
    expect(linkEffectTheUserStated('Every 100 investor conversations bring in about £20,000 of funding', per1, numbered, { quantities: q })).not.toBeNull();
  });
  it('CODEX hostile: a number word too ("Each ten investor conversations …" on "Ten investor conversations")', () => {
    expect(linkEffectTheUserStated('Each ten investor conversations bring in about £20,000 of funding', { ...effect, per_source_change_unit: 'ten investor conversations' },
      { source: 'Ten investor conversations', target: 'Funding secured' }, { quantities: ['Ten investor conversations', 'Funding secured'] })).not.toBeNull();
  });
  it('control: the right reading, per 100 with the 100 written, is stated', () => {
    expect(linkEffectTheUserStated('Every 100 investor conversations bring in about £20,000 of funding', { ...effect, per_source_change: 100 }, numbered, { quantities: q })).toBeNull();
  });
  it('control: "Each extra investor conversation brings in about £20,000 of funding" on that label → per 1', () => {
    expect(linkEffectTheUserStated('Each extra investor conversation brings in about £20,000 of funding', effect, numbered, { quantities: q })).toBeNull();
  });
});
