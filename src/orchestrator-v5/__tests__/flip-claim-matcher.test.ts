/**
 * ROADMAP 2.278 amendment — controls for the shared flippability matcher.
 *
 * The matcher is the instrument every "no flip claim" assertion in this lane
 * depends on. An instrument that cannot see the defect makes every absence
 * assertion vacuous (trap 13), and one that over-strips makes them worse than
 * vacuous — it would bless the exact copy the lane exists to remove.
 */

import { describe, expect, it } from 'vitest';

import {
  BODY_BY_RATIONALE,
} from '../compose/lens-selector.js';
import {
  assertsFlippability,
  stripNegatedFlipClaims,
  FLIP_CLAIM_CORE_REGEX,
  FLIP_CLAIM_STRUCTURAL_REGEX,
} from './support/flip-claim-matcher.support.js';

describe('the matcher SEES the shipped assertive copy (trap 13)', () => {
  it.each([
    ['lens FLIP_RISK_ISOLATED', BODY_BY_RATIONALE.FLIP_RISK_ISOLATED],
    ['lens FLIP_RISK_CORRELATED', BODY_BY_RATIONALE.FLIP_RISK_CORRELATED],
    ['lens DOMINANT_DRIVER', BODY_BY_RATIONALE.DOMINANT_DRIVER],
    ['headline', ' The result is not yet robust — small changes could flip it.'],
    [
      'advice-gate explain',
      'The picture appears fragile, so even small adjustments to the strongest factor could change which option leads.',
    ],
    ['advice-gate improvement', ' The picture appears fragile, so even small adjustments could shift it.'],
    [
      'advice-gate near-tie',
      ' The result is effectively tied, so smaller adjustments could change which option leads.',
    ],
    ['meaning / explain driver beat', 'The order could shift with movement on “Risk”.'],
    ['composeAdvice next-step', 'The biggest thing to examine next is Risk, because it could change the result.'],
  ])('%s', (_label, copy) => {
    expect(assertsFlippability(copy)).toBe(true);
  });
});

describe('the matcher does NOT fire on a denial', () => {
  it.each([
    [
      'A2 single-factor denial (which option leads)',
      'The picture appears fragile, so the size of the gap is sensitive to the strongest factor — though no single factor we tested would change which option leads on its own.',
    ],
    [
      'A2 single-factor denial (the order)',
      ' The result is not yet robust — no single factor we tested would change the order on its own, but the margin is not settled.',
    ],
    [
      'the pre-existing explanation-fallback precedent',
      'Within the tested range, no single factor on its own reached a tipping point that would change which option leads.',
    ],
    [
      'A3 driver beat, re-aimed',
      'No single factor we tested would change the order on its own, but “Risk” moves the margin most.',
    ],
  ])('%s', (_label, copy) => {
    expect(assertsFlippability(copy)).toBe(false);
  });
});

describe('the stripper does NOT over-strip (the control that keeps the above honest)', () => {
  it('an assertive claim SURVIVES stripping', () => {
    const assertive =
      'The picture appears fragile, so even small adjustments to the strongest factor could change which option leads.';
    expect(FLIP_CLAIM_CORE_REGEX.test(stripNegatedFlipClaims(assertive))).toBe(true);
    // …and the structural voice survives stripping too.
    expect(
      FLIP_CLAIM_STRUCTURAL_REGEX.test(
        stripNegatedFlipClaims('A sensitivity check shows how far it can move before the leading option changes.'),
      ),
    ).toBe(true);
  });

  it('a denial followed by a REAL claim in the same text is still caught', () => {
    // The A3 defect shape verbatim: a denial and an assertion side by side.
    const mixed =
      'though no single factor we tested would change which option leads on its own. The order could shift with movement on “Risk”.';
    expect(assertsFlippability(mixed)).toBe(true);
  });

  it('an UNRECOGNISED denial phrasing fails LOUD, not silent', () => {
    // Direction-of-failure pin: a new denial we have not listed reads as a
    // claim (false alarm → investigation), never as a clear.
    expect(assertsFlippability('nothing whatsoever could flip this result.')).toBe(true);
  });

  it('neutral prose matches nothing', () => {
    expect(assertsFlippability('One factor shapes this result more than the others.')).toBe(false);
  });
});
