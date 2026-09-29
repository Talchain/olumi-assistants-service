/**
 * Shared Data closure row 1 (#72 5881225605, claim 5881253593): WHOSE a value is enters the analysis revision.
 *
 * `computeAnalysisAffectingGraphHash` MUST capture any field whose mutation would change analysis results
 * (`graph-hash.ts` header). Since R1 (schemas 0.61.0) the science reads `observed_state.source`: ISL derives whose
 * base/level it is from that literal, and CEE's per-limit verdict reads `level_olumi_estimate` from it. Live on served
 * f79119b (scenario 0938f068): churn 3.2% moved cee_inference → user_override with the value unchanged; the hash did not
 * move, the Run stayed `complete_current` with verdict `estimate_only`, and a rerun on the same hash gave `scored`.
 *
 * `unit`, `raw_value` and node `scale_frame` are analytical too (AIQ #72 5881494849): `level-limit-baseline.ts` reads
 * them into the PLoT wire (the relabelled-`%` wire unit; `percentLimitFrameProvable`, framed vs withheld).
 *
 * Contrast in the same file: a label, `extractionType` or `reviewed_by_user` change (never read by an analysis path)
 * still leaves the hash unchanged — this row must not pass by hashing everything.
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';

function churnGraph(observed: Record<string, unknown>, label = 'Monthly churn'): GraphV3T {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'monthly_churn', kind: 'factor', label, observed_state: observed },
    ],
    edges: [
      { from: 'monthly_churn', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
    ],
  } as unknown as GraphV3T;
}

const olumis = { value: 0.032, raw_value: 3.2, unit: '%', source: 'cee_inference' };
const users = { value: 0.032, raw_value: 3.2, unit: '%', source: 'user_override' };

describe('analysis revision: whose value it is', () => {
  it('RED at f79119b: the same value becoming the user\'s moves the analysis hash', () => {
    expect(computeAnalysisAffectingGraphHash(churnGraph(users))).not.toBe(computeAnalysisAffectingGraphHash(churnGraph(olumis)));
  });

  it('a source that is absent differs from one that is present (absence is never read as a class)', () => {
    const { source: _s, ...unstamped } = olumis;
    expect(computeAnalysisAffectingGraphHash(churnGraph(unstamped))).not.toBe(computeAnalysisAffectingGraphHash(churnGraph(olumis)));
  });

  it('unit, raw_value and node scale_frame move the analysis hash (each decides the PLoT wire)', () => {
    const base = computeAnalysisAffectingGraphHash(churnGraph(olumis));
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, unit: '% per year' }))).not.toBe(base);
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, raw_value: 32 }))).not.toBe(base);
    const framed = churnGraph(olumis) as unknown as { nodes: Array<Record<string, unknown>> };
    framed.nodes[1]!.scale_frame = 100;
    expect(computeAnalysisAffectingGraphHash(framed as unknown as GraphV3T)).not.toBe(base);
  });

  it('CONTRAST: label, extractionType and the review record stay out (hash unchanged)', () => {
    const base = computeAnalysisAffectingGraphHash(churnGraph(olumis));
    expect(computeAnalysisAffectingGraphHash(churnGraph(olumis, 'Churn per month'))).toBe(base);
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, extractionType: 'explicit' }))).toBe(base);
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, reviewed_by_user: { intent: 'confirm', at: '2026-09-29T00:40:00.000Z' } }))).toBe(base);
  });
});
