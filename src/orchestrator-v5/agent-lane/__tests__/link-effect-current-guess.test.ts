import { describe, expect, it } from 'vitest';
import { statedRangeSpread } from '../../stated-range-spread.js';
import {
  linkEffectFloorDisclosures,
  linkEffectFloorQuestion,
  readLinkEffectCurrentGuess,
  readLinkEffectFloorAnswer,
  type LinkEffectFloor,
} from '../link-effect-lower-bound.js';
import type { LinkEffectClarificationPending } from '../link-effect-clarification.js';

const FLOOR: LinkEffectFloor = {
  from_id: 'price', to_id: 'margin', value: 5, unit: 'percentage points', reading: 'points',
  words: 'at least 5 points', per_source_change: 1, per_source_change_unit: 'GBP',
  reading_answer: 'points', from_label: 'Café price', target_label: 'Gross margin',
  source_quote: 'Raising the café price by £1 will increase gross margin by at least 5%',
};
const question = (quote: string): string =>
  `You said ‘${quote}’. What's your best single guess, and the lowest and highest it could plausibly be?`;

function floorAsk(floor: LinkEffectFloor): LinkEffectClarificationPending {
  return {
    id: 'floor-ask', scenario_id: 'scenario', chip_id: 'agent-link-effect-clarification:floor-ask',
    emitted_at_iso: '2026-10-08T00:00:00.000Z', expires_at_iso: '2026-10-09T00:00:00.000Z', expires_at_turn_count: 6,
    preconditions: { target_entity_ids: ['price', 'margin'] },
    action: { kind: 'elicit_link_effect_clarification', from_id: 'price', to_id: 'margin',
      from_label: 'Café price', to_label: 'Gross margin', quote: FLOOR.source_quote!,
      question: question(FLOOR.source_quote!), refusal: 'not_the_users_statement', floor },
  };
}

function graphWithCurrentAmount(amount: number) {
  return { nodes: [{ id: 'price', label: 'Café price' }, { id: 'margin', label: 'Gross margin' }],
    edges: [{ id: 'price-margin', from: 'price', to: 'margin', strength: { mean: 0.2, std: 0.1 },
      provenance: { natural_effect: { strength_mean: 0.2, strength_mean_frame: 'edge_strength',
        amount, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'GBP' } } }] };
}

describe('RC2a current-turn guess and range class', () => {
  it('asks for the current guess, lowest and highest in one shared sentence', () => {
    expect(linkEffectFloorQuestion(FLOOR)).toBe(question(FLOOR.source_quote!));
  });

  it('P1 RED: a current guess below stored 5 is a point, independent of that stored floor', () => {
    expect(readLinkEffectFloorAnswer(FLOOR, 'My best guess is 2 points.')).toEqual({ ok: true, guess: 2 });
  });

  it('P1 RED: current guess plus upper never takes the missing low from stored floor 5', () => {
    expect(readLinkEffectFloorAnswer(FLOOR, '6, at most 7')).toMatchObject({
      ok: false, refusal: 'incomplete_current_range', question: question(FLOOR.source_quote!),
    });
  });

  it('current triplet uses current 2 and 7 for sigma, retaining current guess 6', () => {
    const spread = statedRangeSpread(2, 7, 0.9);
    expect(spread.ok).toBe(true);
    const parsed = readLinkEffectFloorAnswer(FLOOR,
      'My best guess is 6 points; the lowest it could plausibly be is 2 points; the highest it could plausibly be is 7 points.');
    expect(parsed).toEqual({ ok: true, guess: 6, lower: 2, upper: 7, std: spread.ok ? spread.std : undefined });
  });

  it.each([
    ['2, lowest 1, highest 3', 2, 1, 3],
    ['2, at least 1, at most 3', 2, 1, 3],
    ['My best guess is two points; lowest one point; highest three points.', 2, 1, 3],
  ] as const)('a current triplet (%s) permits a guess below the earlier floor', (answer, guess, lower, upper) => {
    const spread = statedRangeSpread(lower, upper, 0.9);
    expect(readLinkEffectFloorAnswer(FLOOR, answer)).toEqual({
      ok: true, guess, lower, upper, std: spread.ok ? spread.std : undefined,
    });
  });

  it.each(['6, [2, 7]', '6, between 2 and 7'])('compact CURRENT guess and range (%s) use exactly its three figures', (answer) => {
    const spread = statedRangeSpread(2, 7, 0.9);
    expect(readLinkEffectCurrentGuess(answer, { reading: 'points', unit: 'percentage points' }, 'one question')).toEqual({
      ok: true, guess: 6, lower: 2, upper: 7, std: spread.ok ? spread.std : undefined,
    });
  });

  it.each(['My best guess is -6 points; lowest -7 points; highest -2 points.', '-6, [-7, -2]', '-6, between -7 and -2'])(
    'preserves all signed current figures (%s)', (answer) => {
      const spread = statedRangeSpread(-7, -2, 0.9);
      expect(readLinkEffectCurrentGuess(answer, { reading: 'points', unit: 'percentage points' }, 'one question')).toEqual({
        ok: true, guess: -6, lower: -7, upper: -2, std: spread.ok ? spread.std : undefined,
      });
    });

  it('a current negative guess remains a negative point', () => {
    expect(readLinkEffectCurrentGuess('My best guess is -2 points.', { reading: 'points', unit: 'percentage points' }, 'one question'))
      .toEqual({ ok: true, guess: -2 });
    expect(readLinkEffectCurrentGuess('About 4 fewer visits per day.', { reading: 'absolute', unit: 'visits per day' }, 'one question'))
      .toEqual({ ok: true, guess: -4 });
  });

  it('RED: the current lower suffix “fewer” supplies -2, so sigma fits -2 to 7', () => {
    const spread = statedRangeSpread(-2, 7, 0.9);
    expect(readLinkEffectCurrentGuess('6 points; lowest 2 fewer points; highest 7 points',
      { reading: 'points', unit: 'percentage points' }, 'one question')).toEqual({
      ok: true, guess: 6, lower: -2, upper: 7, std: spread.ok ? spread.std : undefined,
    });
  });

  it('RED: current fewer suffixes preserve both signed extremes around a negative guess', () => {
    const spread = statedRangeSpread(-7, -2, 0.9);
    expect(readLinkEffectCurrentGuess('6 fewer points; lowest 7 fewer points; highest 2 fewer points',
      { reading: 'points', unit: 'percentage points' }, 'one question')).toEqual({
      ok: true, guess: -6, lower: -7, upper: -2, std: spread.ok ? spread.std : undefined,
    });
  });

  it('RED: a current upper “7 fewer” is -7 and cannot contain a positive current guess', () => {
    expect(readLinkEffectCurrentGuess('6 points; lowest 2 fewer points; highest 7 fewer points',
      { reading: 'points', unit: 'percentage points' }, 'one question')).toEqual({
      ok: false, refusal: 'outside_stated_bounds', question: 'one question',
    });
  });

  it.each(['6, [7, 2]', '8, [2, 7]', '6, between 7 and 2', '-8, [-7, -2]'])(
    'compact bounds are ordered around the signed current guess (%s)', (answer) => {
      expect(readLinkEffectCurrentGuess(answer, { reading: 'points', unit: 'percentage points' }, 'one question')).toEqual({
        ok: false, refusal: 'outside_stated_bounds', question: 'one question',
      });
    });

  it('unmarked three figures and a partial bracket do not invent the guess or missing extreme', () => {
    for (const answer of ['6, 2, 7', '6, [2]', '[2, 7]', '6, [2, 7] and 8']) {
      expect(readLinkEffectCurrentGuess(answer, { reading: 'points', unit: 'percentage points' }, 'one question')).toEqual({
        ok: false, refusal: 'unreadable_current_guess', question: 'one question',
      });
    }
  });

  it.each([
    '2, lowest 3, highest 7',
    '8, lowest 2, highest 7',
    '6, lowest 7, highest 2',
  ])('only current bounds validate the current guess (%s), with one question', (answer) => {
    expect(readLinkEffectFloorAnswer(FLOOR, answer)).toEqual({
      ok: false, refusal: 'outside_stated_bounds', question: question(FLOOR.source_quote!),
    });
  });

  it('a zero-width current range refuses through the shared spread rule', () => {
    expect(readLinkEffectFloorAnswer(FLOOR, '2, lowest 2, highest 2')).toEqual({
      ok: false, refusal: 'RANGE_ZERO_WIDTH', question: question(FLOOR.source_quote!),
    });
  });

  it('CLASS MUTANT RED: reading a stored floor for sigma or validation trips the numeric barrier', () => {
    const floor = { ...FLOOR };
    Object.defineProperty(floor, 'value', { get: () => { throw new Error('stored floor reached current-figure parser'); } });
    expect(() => readLinkEffectFloorAnswer(floor, 'My best guess is 2 points.')).not.toThrow();
    const spread = statedRangeSpread(1, 3, 0.9);
    expect(readLinkEffectFloorAnswer(floor, '2, lowest 1, highest 3')).toEqual({
      ok: true, guess: 2, lower: 1, upper: 3, std: spread.ok ? spread.std : undefined,
    });
  });
});

describe('RC2a strict floor disclosure', () => {
  it('P2 RED: strict more-than-5 and current exactly 5 discloses', () => {
    const floor = { ...FLOOR, exclusive: true as const, words: 'more than 5 points' };
    expect(linkEffectFloorDisclosures(graphWithCurrentAmount(5), [floorAsk(floor)])).toEqual([
      "Olumi's current figure for how much ‘Café price’ affects ‘Gross margin’ is below your ‘more than 5 points’, so this Run likely understates churn and may flatter the price rise.",
    ]);
  });

  it('the reverse row: inclusive at-least-5 and current exactly 5 needs no disclosure', () => {
    expect(linkEffectFloorDisclosures(graphWithCurrentAmount(5), [floorAsk(FLOOR)])).toEqual([]);
  });
});
