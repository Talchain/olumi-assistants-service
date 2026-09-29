/**
 * Every unauthored number must be marked and ledgered — not just the mean.
 *
 * ⛔ THE DEFECT THIS PINS, found by an adversarial audit of this lane and then
 * confirmed by execution: an edge whose MEAN was authored still receives an
 * unauthored `std` and an unauthored `exists_probability`, and the old code only
 * set `defaulted` when the MEAN was missing. So `noUnmarkedMagnitudes` returned
 * true, `assessAnalysisAdmissibility` returned `ready` with ZERO reasons, and
 * PLoT would have computed over machine-chosen link-existence priors with no
 * caveat reaching the user. A guard that certifies the exact thing it exists to
 * catch is worse than no guard.
 */

import { describe, it, expect } from 'vitest';
import { admitCandidateLinks, noUnmarkedMagnitudes, isFullyAuthored } from '../admit-candidate.js';
import { assessAnalysisAdmissibility } from '../analysis-admissibility.js';

const authoredMean = () =>
  admitCandidateLinks([
    { from: 'price', to: 'mrr', direction: 'positive', provenance: 'explicit', strength_mean: 0.83 },
  ]);

describe('projected fields are marked per field', () => {
  it('an authored mean does NOT make the edge fully authored — std and existence are still ours', () => {
    const r = authoredMean();
    expect(r.edges[0].strength.mean, 'the authored mean survives verbatim').toBe(0.83);
    // Two different questions, and conflating them is what hid the defect.
    expect(isFullyAuthored(r), 'std and exists_probability were chosen by us').toBe(false);
    expect(noUnmarkedMagnitudes(r), 'but every projection must be MARKED and ledgered').toBe(true);
    expect(r.edges[0].defaulted, 'the edge carries numbers nobody authored').toBe(true);
  });

  it('ledgers EVERY unauthored numeric, including std', () => {
    const paths = authoredMean().loss.map((l) => l.field_path);
    expect(paths).toContain('edges[price::mrr].exists_probability');
    expect(paths, 'std is a number nobody authored and was previously unrecorded').toContain(
      'edges[price::mrr].strength.std',
    );
  });

  it('the admissibility policy SEES projected existence priors', () => {
    const r = authoredMean();
    const v = assessAnalysisAdmissibility({
      nodes: [
        { id: 'mrr', kind: 'goal', label: 'MRR' },
        { id: 'price', kind: 'factor', label: 'Price' },
      ],
      edges: r.edges,
      goal_constraints: [],
      loss: r.loss,
      withheld: [],
    } as never);
    expect(v.verdict, 'projected existence priors must at least qualify the result').not.toBe('ready');
    expect(v.reasons.map((x) => x.code)).toContain('existence_priors_projected');
  });

  it('CONTROL: a genuinely fully-authored model, with no projections, is still READY', () => {
    const v = assessAnalysisAdmissibility({
      nodes: [
        { id: 'mrr', kind: 'goal', label: 'MRR' },
        { id: 'price', kind: 'factor', label: 'Price' },
      ],
      edges: [
        { from: 'price', to: 'mrr', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      ],
      goal_constraints: [],
      loss: [],
      withheld: [],
    } as never);
    expect(v.verdict, 'the policy must not become a constant refusal').toBe('ready');
  });
});
