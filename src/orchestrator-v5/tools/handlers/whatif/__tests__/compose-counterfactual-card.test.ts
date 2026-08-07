/**
 * Unit tests for the claim-safe counterfactual card composer.
 *
 * Pins: names the concrete intervention (factor + target); NEVER quotes a
 * computed outcome number (doctrine-pending); no tone words / internal tokens.
 */

import { describe, it, expect } from 'vitest';

import { composeCounterfactualCard } from '../compose-counterfactual-card.js';

const FORBIDDEN_TONE = ['winner', 'winning', 'recommended', 'recommend', 'best option'];

describe('composeCounterfactualCard', () => {
  it('names the factor, direction, and formatted target', () => {
    const card = composeCounterfactualCard({
      factorLabel: 'Engineering capacity',
      goalLabel: 'Goal fit',
      direction: 'raise',
      targetDisplay: '20 engineers',
    });
    expect(card).toContain('Engineering capacity');
    expect(card).toContain('Goal fit');
    expect(card).toContain('raised');
    expect(card).toContain('20 engineers');
  });

  it('omits the target clause when no display value is available', () => {
    const card = composeCounterfactualCard({
      factorLabel: 'Hiring cost',
      goalLabel: 'Goal fit',
      direction: 'lower',
      targetDisplay: null,
    });
    expect(card).toContain('lowered');
    expect(card).not.toContain('to ');
    // Still a complete sentence.
    expect(card.endsWith('.')).toBe(true);
  });

  it('never carries tone words or a computed outcome number', () => {
    const card = composeCounterfactualCard({
      factorLabel: 'Marketing spend',
      goalLabel: 'Revenue',
      direction: 'raise',
      targetDisplay: '£40,000',
    });
    const lower = card.toLowerCase();
    for (const term of FORBIDDEN_TONE) {
      expect(lower).not.toContain(term);
    }
    // The only number in the card must be the (display-safe) intervention
    // target — never an ISL-computed outcome value.
    const numbers = card.match(/\d[\d,]*/g) ?? [];
    expect(numbers).toEqual(['40,000']);
  });
});
