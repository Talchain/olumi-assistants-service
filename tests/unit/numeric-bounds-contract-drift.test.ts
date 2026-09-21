/**
 * Review fix B11 (17 Jul) — derive-don't-mirror drift guard.
 *
 * src/validators/numeric-bounds.ts hardcodes the contract ranges
 * (exists_probability [0,1] · strength.mean [-1,1] · std positive) as
 * literals "matching the vendored @talchain/schemas pin". A hand-maintained
 * mirror with no fail-loud guard is the repo's dominant defect class — this
 * test IS the guard: it probes the vendored schemas at the exact boundary
 * values and asserts the validator's verdicts agree. A 0.17.0 contract
 * change that moves any bound turns this RED instead of drifting silently.
 */
import { describe, expect, it } from 'vitest';

import { EdgeV3Schema } from '@talchain/schemas';
import { collectEdgeRangeIssues } from '../../src/validators/numeric-bounds.js';

const baseEdge = { from: 'fac_a', to: 'fac_b' };
// exists_probability is REQUIRED on the contract edge — default an
// in-range value so mean/std probes isolate the strength bounds.
const edgeWith = (strength: object, exists = 0.8) => ({
  ...baseEdge,
  strength,
  exists_probability: exists,
});

function contractAccepts(edge: object): boolean {
  return EdgeV3Schema.safeParse(edge).success;
}
function validatorAccepts(edge: object): boolean {
  return collectEdgeRangeIssues(edge).length === 0;
}

describe('B11 — validator literals agree with the vendored contract at the boundaries', () => {
  const probes: Array<[string, object]> = [
    ['mean at +1 (in-range)', edgeWith({ mean: 1, std: 0.1 })],
    ['mean at -1 (in-range)', edgeWith({ mean: -1, std: 0.1 })],
    ['mean above +1', edgeWith({ mean: 1.0001, std: 0.1 })],
    ['mean below -1', edgeWith({ mean: -1.0001, std: 0.1 })],
    ['std positive (in-range)', edgeWith({ mean: 0, std: 0.001 })],
    ['std zero', edgeWith({ mean: 0, std: 0 })],
    ['std negative', edgeWith({ mean: 0, std: -0.1 })],
    ['exists_probability 0 (in-range)', edgeWith({ mean: 0, std: 0.1 }, 0)],
    ['exists_probability 1 (in-range)', edgeWith({ mean: 0, std: 0.1 }, 1)],
    ['exists_probability above 1', edgeWith({ mean: 0, std: 0.1 }, 1.0001)],
    ['exists_probability below 0', edgeWith({ mean: 0, std: 0.1 }, -0.0001)],
  ];

  it.each(probes)('%s: validator verdict == vendored-contract verdict', (_name, edge) => {
    expect(validatorAccepts(edge)).toBe(contractAccepts(edge));
  });
});
