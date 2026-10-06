/**
 * ⛔ SD-1 (DL 0df0e1, 6 Oct): the model never reads a C1 as one change's credit unless the pair IS one recorded change.
 *
 * Acceptance rehearsal12 (CEE d40fd7b, wire turn-009 → 011): two changes (the user restated "Price rise from current price →
 * Customers lost to price rise" inside its band, 0.4 → 0.6, and moved "Starter monthly price → Starter-tier MRR" from strong
 * to moderate). `run_delta` (verbatim below) named only the band edit, coverage `partial`, case C1. The typed answer read the
 * model-facing C1 and said "the current comparison attributes the difference to your edit". The projection now applies S7's
 * own rule: C1 only for complete coverage with exactly one non-goal row; any other C1 is checked as C2_unpaired.
 */
import { describe, expect, it } from 'vitest';
import type { RunDelta } from '@talchain/schemas/boundary';

import { modelFacingAttributionCase, projectModelFacingRunDelta } from '../model-facing-run-delta.js';

/** turn-009's `run_delta`, verbatim (cut5-rehearsal12-t1b/wire/turn-009-1791250451032.json). */
const REHEARSAL12 = {
  attribution_case: 'C1_attributable',
  pair_provenance: { seed_equal: true, hash_equal: false, builds_equal: 'equal', n_equal: true },
  leader: { changed: false, prior_leading_option_id: 'launch_starter_tier', current_leading_option_id: 'launch_starter_tier', noise_verdict: 'not_noise_qualified' },
  win_probabilities: [
    { option_id: 'keep_pricing_as_it_is', prior: 0.04168333333333326, current: 0.050266666666666564, noise_verdict: 'signal' },
    { option_id: 'launch_starter_tier', prior: 0.5591333333333328, current: 0.5399666666666664, noise_verdict: 'signal' },
    { option_id: 'raise_prices_10', prior: 0.3991833333333342, current: 0.4097666666666675, noise_verdict: 'within_noise' },
  ],
  flip_thresholds: [],
  endpoints: {
    prior: { run_id: 'd9226ab6338b7f50f0e13b5ab533f5810e43396bce2f6bd6f548d2bf58e30e4c', computed_at: '2026-10-06T01:31:01.839Z' },
    current: { run_id: '4325592911cbb0dcc927f302e77d3974315de757eccb78877d2bb92b6e3dbdde', computed_at: '2026-10-06T01:34:04.361Z' },
  },
  input_coverage: 'partial',
  input_changes: [
    { entity_kind: 'link', entity_id: 'starter_monthly_price->starter_tier_mrr', link: { from: 'starter_monthly_price', to: 'starter_tier_mrr' },
      field: 'strength', before: { raw: 'strong' }, after: { raw: 'moderate' }, change: 'changed' },
    { entity_kind: 'link', entity_id: 'starter_monthly_price->starter_tier_mrr', link: { from: 'starter_monthly_price', to: 'starter_tier_mrr' },
      field: 'sizing', before: { raw: 'olumi_estimate' }, after: { raw: 'user' }, change: 'changed' },
  ],
} as unknown as RunDelta;

const ONE_ROW = { entity_kind: 'option_setting', entity_id: 'fac_price', option_id: 'opt-a', field: 'value',
  before: { raw: 59, unit: 'GBP' }, after: { raw: 60, unit: 'GBP' }, change: 'changed' };

describe('the model-facing case', () => {
  it('⭐ rehearsal12 (C1, partial, a band edit + an unstated in-band figure): the model reads C2, never C1', () => {
    const projected = projectModelFacingRunDelta(REHEARSAL12 as never);
    expect(projected.attribution_case).toBe('C2_unpaired');
    // Everything else the model reads is unchanged, and the stripped keys stay stripped.
    expect(projected.win_probabilities).toEqual(REHEARSAL12.win_probabilities);
    expect(projected).not.toHaveProperty('input_coverage');
    expect(projected).not.toHaveProperty('input_changes');
  });
  it('CONTROL: C1 with complete coverage and exactly one non-goal change stays C1, and the projection is unchanged', () => {
    const one = { ...REHEARSAL12, input_coverage: 'complete', input_changes: [ONE_ROW] } as unknown as RunDelta;
    expect(projectModelFacingRunDelta(one as never).attribution_case).toBe('C1_attributable');
  });
  it.each([
    ['complete but two changes', { input_coverage: 'complete', input_changes: [ONE_ROW, { ...ONE_ROW, entity_id: 'fac_other' }] }],
    ['complete, one change, but it is the goal', { input_coverage: 'complete', input_changes: [{ ...ONE_ROW, entity_kind: 'goal', option_id: undefined }] }],
    ['complete and no change at all', { input_coverage: 'complete', input_changes: [] }],
    ['partial with one row', { input_coverage: 'partial', input_changes: [ONE_ROW] }],
    ['not_recorded', { input_coverage: 'not_recorded', input_changes: undefined }],
  ])('%s: checked as C2', (_name, over) => {
    expect(modelFacingAttributionCase({ ...REHEARSAL12, ...over } as never)).toBe('C2_unpaired');
  });
  it('an already-projected delta (no coverage key) passes as it is — a second projection never moves a case', () => {
    const once = projectModelFacingRunDelta({ ...REHEARSAL12, input_coverage: 'complete', input_changes: [ONE_ROW] } as never);
    expect(projectModelFacingRunDelta(once as never).attribution_case).toBe('C1_attributable');
  });
  it('a non-C1 case is never touched', () => {
    expect(modelFacingAttributionCase({ ...REHEARSAL12, attribution_case: 'C3_engine_drift' } as never)).toBe('C3_engine_drift');
    expect(modelFacingAttributionCase({ ...REHEARSAL12, attribution_case: 'C0_identical', input_coverage: 'partial' } as never)).toBe('C0_identical');
  });
});
