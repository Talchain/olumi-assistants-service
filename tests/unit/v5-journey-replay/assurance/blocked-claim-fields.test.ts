import { describe, it, expect } from 'vitest';

import {
  findBlockedClaimMatches,
  scanUserFacingSurfaces,
} from '../../../../tools/v5-journey-replay/assurance/blocked-claim-fields.js';

describe('blocked-claim-fields — Tier-2/3 negative guard', () => {
  describe('catches blocked field identifiers (snake_case)', () => {
    for (const id of [
      'confidence_tier',
      'factor_sensitivity',
      'edge_e_values',
      'inference_warnings',
      'flip_thresholds',
    ]) {
      it(`flags "${id}"`, () => {
        const matches = findBlockedClaimMatches(`The ${id} value is high.`);
        expect(matches.some((m) => m === `blocked_field:${id}`)).toBe(true);
      });
    }
  });

  describe('catches scientific / claim vocabulary', () => {
    const cases: Array<[string, RegExp]> = [
      ['Confidence tier: high', /blocked_claim:Confidence tier/i],
      ['A sensitivity analysis shows the budget dominates.', /blocked_claim:sensitivity analysis/i],
      ['Robustness: 0.82', /blocked_claim:Robustness/i],
      ['We ran a Monte Carlo simulation.', /blocked_claim:Monte Carlo/i],
      ['Inference warnings were raised.', /blocked_claim:Inference warnings/i],
      ['The evidence quality is graded B.', /blocked_claim:evidence quality/i],
      ['EVPI suggests more data helps.', /blocked_claim:EVPI/i],
      ['The dominant factor is salary.', /blocked_claim:dominant factor/i],
    ];
    for (const [text, expected] of cases) {
      it(`flags: "${text}"`, () => {
        const matches = findBlockedClaimMatches(text);
        expect(matches.join(' | ')).toMatch(expected);
      });
    }
  });

  describe('does NOT false-positive on normal decision prose', () => {
    const clean = [
      'Hire Two Senior Engineers looks strong; weigh the budget trade-off.',
      'This is a robust, well-reasoned decision.', // "robust" ≠ "robustness"
      'We value your input and lean toward decisive action.', // no bias-warning, no e-value
      'The offshore option reduces cost but adds coordination risk.',
      'Draft or save a model first, then run analysis.',
      'This may be out of date — re-run the analysis to refresh it.',
    ];
    for (const text of clean) {
      it(`passes: "${text}"`, () => {
        expect(findBlockedClaimMatches(text)).toEqual([]);
      });
    }
  });

  it('scanUserFacingSurfaces aggregates + dedupes across text and chips', () => {
    const matches = scanUserFacingSurfaces('The confidence_tier is high.', [
      'Review the model',
      'Show the confidence_tier breakdown',
    ]);
    expect(matches).toContain('blocked_field:confidence_tier');
    // de-duplicated despite appearing twice
    expect(matches.filter((m) => m === 'blocked_field:confidence_tier')).toHaveLength(1);
  });

  it('empty / undefined-ish input is clean', () => {
    expect(findBlockedClaimMatches('')).toEqual([]);
    expect(scanUserFacingSurfaces(undefined, [])).toEqual([]);
  });
});
