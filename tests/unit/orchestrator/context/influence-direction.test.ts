import { describe, expect, it } from 'vitest';

import {
  resolveInfluenceDirection,
  toSignedInfluenceValue,
} from '../../../../src/orchestrator/context/influence-direction.js';

describe('resolveInfluenceDirection', () => {
  describe('authoritative enum wins (magnitude sign is ignored)', () => {
    it.each([
      // The core bug: unsigned elasticity (always >= 0) with an explicit
      // negative direction must resolve negative, not positive.
      ['negative', 0.6, 'negative'],
      ['negative', 0, 'negative'],
      ['positive', 0.6, 'positive'],
      // A neutral factor with a non-trivial magnitude must stay neutral —
      // never collapsed into a strengthen/weaken claim.
      ['neutral', 0.6, 'neutral'],
      ['neutral', -0.6, 'neutral'],
    ])('direction=%s, magnitude=%s → %s', (direction, magnitude, expected) => {
      expect(resolveInfluenceDirection(direction, magnitude as number)).toBe(expected);
    });
  });

  describe('sign fallback only when direction is absent/invalid (finite magnitude)', () => {
    it.each([
      [undefined, 0.4, 'positive'],
      [null, -0.4, 'negative'],
      ['', 0.4, 'positive'],
      ['up', -0.4, 'negative'],
      ['POSITIVE', 0.4, 'positive'], // case-sensitive: not an enum member → fallback
      [42, -0.4, 'negative'],
      [undefined, 0, 'positive'], // 0 >= 0 → positive
    ])('rawDirection=%s, magnitude=%s → %s', (raw, magnitude, expected) => {
      expect(resolveInfluenceDirection(raw, magnitude as number)).toBe(expected);
    });
  });

  describe('non-finite fallback magnitude never invents a directional claim', () => {
    it.each([
      [undefined, Number.NaN],
      [null, Number.POSITIVE_INFINITY],
      ['unknown', Number.NEGATIVE_INFINITY],
    ])('rawDirection=%s, magnitude=%s → neutral', (raw, magnitude) => {
      expect(resolveInfluenceDirection(raw, magnitude as number)).toBe('neutral');
    });

    it('honours an explicit enum even when the magnitude is non-finite', () => {
      expect(resolveInfluenceDirection('negative', Number.NaN)).toBe('negative');
      expect(resolveInfluenceDirection('positive', Number.POSITIVE_INFINITY)).toBe('positive');
    });
  });
});

describe('toSignedInfluenceValue', () => {
  it.each([
    ['positive', 0.6, 0.6],
    ['negative', 0.6, -0.6],
    ['neutral', 0.6, 0],
    ['neutral', 0, 0],
    ['positive', 0, 0],
  ] as const)('direction=%s, magnitude=%s → %s', (direction, magnitude, expected) => {
    expect(toSignedInfluenceValue(direction, magnitude)).toBe(expected);
  });

  it('neutral never falls through to the positive branch, even at high magnitude', () => {
    // Regression for the bug the contract doc previously implied: a neutral
    // driver with a large magnitude must still project to 0, not +magnitude.
    expect(toSignedInfluenceValue('neutral', 0.95)).toBe(0);
  });
});
