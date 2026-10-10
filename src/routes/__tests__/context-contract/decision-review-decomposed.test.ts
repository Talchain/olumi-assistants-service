/** Real enricher -> buildSlices -> Anthropic SDK transport, with fixture responses only. */
import { beforeAll, describe, expect, it } from 'vitest';
import { reviewCapture, REVIEW_ORDINARY_PROSE, REVIEW_PRODUCER_PROSE, type ReviewWitness } from './decision-review-harness.js';
import { array, object, valueAt, type Variant } from './provider-harness.js';

const ready = new Map<Variant, ReviewWitness>();
describe('decision review decomposed: serialized provider contract', () => {
  beforeAll(async () => {
    for (const variant of ['run2', 'current', 'flip-unavailable', 'leader-withheld', 'stale'] as const) {
      const witness = await reviewCapture(variant, true);
      expect(witness.calls).toHaveLength(4);
      expect(witness.slices).toHaveLength(4);
      ready.set(variant, witness);
    }
  }, 60_000);

  it('G1 all four slices carry the bound complete_current analysis reference', () => {
    const w = ready.get('run2')!;
    for (const slice of w.slices) {
      const analysis = object(object(slice.DECISION_CONTEXT).analysis);
      expect(analysis.selected_run_reference).toBe(w.seed.captured_run_reference);
      expect(object(analysis.run_state).kind).toBe('complete_current');
    }
  });

  it('G2 no slice carries unavailable flip pairs; current licensed pair survives', () => {
    const unavailable = ready.get('flip-unavailable')!;
    for (const slice of unavailable.slices) {
      expect(array(slice.FLIP_THRESHOLD_DATA)).toEqual([]);
      expect(array(slice.FRAGILE_EDGES)).toEqual([]);
      expect(JSON.stringify(slice)).not.toContain(REVIEW_PRODUCER_PROSE);
    }
    // Only flip DATA (and prose restating its withheld threshold) goes; ordinary producer prose is not stripped with it.
    expect(JSON.stringify(unavailable.slices[3]!.MODEL_CRITIQUES)).toContain(REVIEW_ORDINARY_PROSE);
    const current = ready.get('current')!;
    expect(array(current.slices[2]!.FLIP_THRESHOLD_DATA)).toEqual([
      { factor_id: 'monthly_pro_churn', factor_label: 'Monthly Pro churn', current_value: 3,
        flip_value: 4.2, direction: 'increase', unit: '%' },
    ]);
  });

  it('G3 no slice names an unlicensed winner or carries any win share', () => {
    const w = ready.get('leader-withheld')!;
    for (const slice of w.slices) {
      expect(object(object(slice.DECISION_CONTEXT).winner)).not.toHaveProperty('id');
      expect(object(object(slice.DECISION_CONTEXT).winner)).not.toHaveProperty('label');
      expect(object(slice.DECISION_CONTEXT)).not.toHaveProperty('runner_up');
      expect(object(slice.DECISION_CONTEXT)).not.toHaveProperty('margin');
      expect(slice).not.toHaveProperty('WINNER_LABEL');
      expect(JSON.stringify(slice)).not.toContain(REVIEW_PRODUCER_PROSE);
      expect(object(slice.CALIBRATION)).not.toHaveProperty('winner_win_probability');
    }
    expect(valueAt(w.calls.flatMap(call => call.payloads), 'win_probability')).toEqual([]);
  });

  it('G4 stale Run carries no old flip, driver, fragility or winner share in any slice', () => {
    const w = ready.get('stale')!;
    for (const slice of w.slices) {
      expect(object(object(object(slice.DECISION_CONTEXT).analysis).run_state).kind).toBe('complete_stale');
      expect(array(slice.FLIP_THRESHOLD_DATA)).toEqual([]);
      expect(array(slice.FACTOR_SENSITIVITY)).toEqual([]);
      expect(array(slice.FRAGILE_EDGES)).toEqual([]);
      expect(slice.DRIVER_HINT ?? null).toBeNull();
      expect(JSON.stringify(slice)).not.toContain(REVIEW_PRODUCER_PROSE);
    }
    expect(valueAt(w.calls.flatMap(call => call.payloads), 'win_probability')).toEqual([]);
  });

  it('licensed/current contrasts preserve winner, calibration share and repeated option shares', () => {
    const w = ready.get('current')!;
    expect(object(object(w.slices[0]!.DECISION_CONTEXT).winner))
      .toMatchObject({ id: 'raise_price_to_59', win_probability: 1 });
    expect(object(w.slices[3]!.CALIBRATION).winner_win_probability).toBe(1);
    expect(array(w.slices[2]!.FRAGILE_EDGES)).toHaveLength(1);
    expect(JSON.stringify(w.slices[3]!.MODEL_CRITIQUES)).toContain(REVIEW_PRODUCER_PROSE);
    expect(w.slices[1]!.WINNER_LABEL).toBe(w.seed.snapshot.analysis_result.enrichment.option_comparison instanceof Array
      ? object(w.seed.snapshot.analysis_result.enrichment.option_comparison.find(o => object(o).option_id === 'raise_price_to_59')).option_label : undefined);
    for (const i of [0, 2]) expect(array(w.slices[i]!.OPTION_COMPARISON).map(object))
      .toContainEqual(expect.objectContaining({ option_id: 'raise_price_to_59', win_probability: 1 }));
  });
  it('missing current graph uses grounding hash, preserving matching Run and withholding changed grounding', async () => {
    const current = await reviewCapture('current', true, false);
    expect(object(object(current.slices[0]!.DECISION_CONTEXT).winner)).toHaveProperty('win_probability', 1);
    expect(array(current.slices[2]!.FLIP_THRESHOLD_DATA)).toHaveLength(1);
    const stale = await reviewCapture('stale', true, false);
    for (const slice of stale.slices) {
      expect(array(slice.FLIP_THRESHOLD_DATA)).toEqual([]);
      expect(object(object(object(slice.DECISION_CONTEXT).analysis).run_state).kind).toBe('complete_stale');
    }
    expect(valueAt(stale.calls.flatMap(call => call.payloads), 'win_probability')).toEqual([]);
  }, 60_000);

});
