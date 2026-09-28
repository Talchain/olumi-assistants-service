/**
 * ⛔ A PLAIN NUMBER WRITTEN AS A COUNT (OR A TIME) IS NEVER THE USER'S FIGURE IN ANOTHER KIND OF UNIT (MG; the unscaled
 * half of DL #72 5862394804, left open by #2189: "300 subscribers" still grounded 300 GBP/month).
 *
 * `figureTheUserWrote` grounds a figure held in a unit only when the user wrote that figure. A PLAIN amount ("300") had
 * no unit of its own, so it grounded any unit — and "we have 300 subscribers" made 300 GBP/month "the user's". The word
 * the user wrote right after the number is its unit: when the estate's unit classifier (`unitFamilyOf`) or the shared
 * counted nouns (`counted-nouns.ts`) read it as ANOTHER family than the held unit's, the plain amount is not that figure.
 * A following word that reads as no unit ("a", "Pro", "new") keeps today's reading, so nothing that grounded for its
 * own unit stops grounding.
 */
import { describe, expect, it } from 'vitest';

import { figureTheUserWrote, figureTheUserWroteFor } from '../stated-by-user.js';

describe('figureTheUserWrote: a plain number written with a unit word of another kind is not the figure', () => {
  it.each([
    ['⭐ RED: "300 subscribers" is never 300 GBP/month', 300, 'GBP/month', 'we have 300 subscribers on Pro', false],
    ['RED: "300 customers" is never £300', 300, '£', 'about 300 customers churned', false],
    ['RED: "12 months" is never 12 GBP', 12, 'GBP', 'reach it within 12 months', false],
    ['RED: "4 engineers" is never 4%', 4, '%', 'we will hire 4 engineers', false],
    ['CONTROL: "300 subscribers" IS 300 subscribers', 300, 'subscribers', 'we have 300 subscribers on Pro', true],
    ['CONTROL: "300 subscribers" IS 300 people (the same family: count)', 300, 'people', 'we have 300 subscribers on Pro', true],
    ['CONTROL: "12 months" IS 12 months', 12, 'months', 'reach it within 12 months', true],
    ['CONTROL (a word that is no unit): "49 a month" is still £49/month', 49, 'GBP/month', 'we charge 49 a month', true],
    ['CONTROL (a word that is no unit): "300 Pro seats" reads "Pro" — unchanged, grounds', 300, 'GBP/month', 'we sold 300 Pro seats', true],
    ['CONTROL (money written as money): "£300 a month" is 300 GBP/month', 300, 'GBP/month', 'it costs £300 a month', true],
    ['CONTROL (end of text): "we have 300" is still 300 GBP/month', 300, 'GBP/month', 'we have 300', true],
  ])('%s', (_label, value, unit, text, expected) => {
    expect(figureTheUserWrote(value, unit, text)).toBe(expected);
  });
});

describe('figureTheUserWroteFor shares the rule (the entity-bound matcher uses the same unit rules)', () => {
  const MRR = { target: ['MRR'], others: ['Pro paying subscribers'] };
  // PINNED (already held at base by the entity binding: 300 binds to the subscribers, not MRR); kept under the new rule.
  it('PINNED: "MRR … 300 subscribers" never grounds 300 GBP/month for MRR', () => {
    expect(figureTheUserWroteFor(300, 'GBP/month', 'MRR is driven by our 300 subscribers', MRR)).toBe(false);
  });
  it('CONTROL: "MRR of 300 a month" still grounds 300 GBP/month for MRR', () => {
    expect(figureTheUserWroteFor(300, 'GBP/month', 'an MRR of 300 a month', MRR)).toBe(true);
  });
});
