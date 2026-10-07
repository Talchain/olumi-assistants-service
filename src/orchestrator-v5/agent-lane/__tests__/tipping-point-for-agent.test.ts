/** SCI-HERO: existing served positive/control; no inferred winner or EVPPI ranking. No provider calls. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysisResultForAgent, tippingPointOf } from '../decision-sensitivity.js';
import { modelFacingToolResult } from '../licensed-run-view.js';

type Rec = Record<string, unknown>;
const read = (path: string): Rec => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Rec;
const POSITIVE = read('../../../../tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json');
const ENRICHMENT = POSITIVE.enrichment as Rec;
const CONTROL = read('../../coaching/__tests__/fixtures/paul-run-17d1cd3a-next-move.json').analysis_result as Rec;
const rows = ENRICHMENT.flip_thresholds as Rec[];
const withRows = (next: Rec[]) => ({ ...ENRICHMENT, flip_thresholds: next });
const block = { type: 'analysis_result', computed_against_hash: POSITIVE.graph_hash, enrichment: ENRICHMENT };
const SAY = 'Pro plan price is a factor that could change this: the comparison could change if it rises above 55.76 GBP/month.';

describe('typed tipping-point fact from the served corpus', () => {
  it('preserves the actual display threshold, factor identity, direction and unit', () => {
    expect(POSITIVE.graph_hash).toBe('0e19bb826dd6fde4');
    expect(rows[0]).toMatchObject({ factor_id: 'pro_plan_price', current_value: 49, flip_value: 55.76,
      unit: 'GBP/month', value_scale: 'display', flip_reason: 'found' });
    expect(tippingPointOf(ENRICHMENT)).toEqual({ status: 'found', factor_id: 'pro_plan_price', label: 'Pro plan price',
      current_value: 49, threshold: 55.76, direction: 'increase', unit: 'GBP/month',
      current_display: '49 GBP/month', threshold_display: '55.76 GBP/month', say: SAY });
  });
  it('keeps the producer order, independently of EVPPI order or values', () => {
    const swapped = tippingPointOf({ ...withRows([rows[1]!, rows[0]!, rows[2]!]),
      factor_evppi: [{ factor_id: 'pro_plan_price', status: 'resolved', evppi: 999 }] });
    expect(swapped).toMatchObject({ status: 'found', factor_id: 'feature_development_spend', direction: 'increase', threshold: 17330 });
    expect(tippingPointOf({ ...ENRICHMENT, factor_evppi: [] })).toEqual(tippingPointOf(ENRICHMENT));
  });
  it('skips a display-unsafe first crossing and selects the next usable existing-order row', () => {
    expect(tippingPointOf(withRows([{ ...rows[0]!, value_scale: 'model' }, rows[1]!, rows[2]!]))).toMatchObject({
      status: 'found', factor_id: 'feature_development_spend', direction: 'increase',
    });
  });
  it('uses the shared legacy display predicate without a second stricter validator', () => {
    expect(tippingPointOf(withRows([{ ...rows[0]!, value_scale: undefined }]))).toMatchObject({ status: 'found', threshold: 55.76 });
    expect(tippingPointOf(withRows([{ ...rows[0]!, value_scale: undefined, current_value: 0.49, flip_value: 0.5576 }])))
      .toEqual({ status: 'unresolved' });
  });
  it('does not round a distinguishable threshold into today’s value', () => {
    expect(tippingPointOf(withRows([{ ...rows[0]!, current_value: 100.2, flip_value: 100.4 }]))).toMatchObject({
      status: 'found', current_display: '100.2 GBP/month', threshold_display: '100.4 GBP/month',
    });
  });
  it('retains direction from the shared parser and describes a decreasing crossing correctly', () => {
    expect(tippingPointOf(withRows([{ ...rows[0]!, current_value: 60, flip_value: 55.76, direction: 'increase' }]))).toMatchObject({
      direction: 'decrease', say: SAY.replace('rises above', 'falls below'),
    });
  });
  it('keeps no-signal distinct from unresolved and unavailable, without a tipping sentence', () => {
    const controlRows = (CONTROL.enrichment as Rec).flip_thresholds as Rec[];
    expect(controlRows.every(r => r.flip_value === null && r.flip_reason === 'structurally_invariant')).toBe(true);
    expect(tippingPointOf(CONTROL.enrichment)).toEqual({ status: 'no_flip_in_range' });
    expect(tippingPointOf(withRows([{ ...rows[0]!, flip_value: null, flip_reason: 'candidate_cap_exceeded' }])))
      .toEqual({ status: 'unresolved' });
    expect(tippingPointOf(withRows([{ ...rows[0]!, value_scale: 'model' }]))).toEqual({ status: 'unresolved' });
    expect(tippingPointOf(withRows([]))).toEqual({ status: 'not_evaluated' });
    expect(tippingPointOf(undefined)).toEqual({ status: 'not_evaluated' });
    expect(JSON.stringify(analysisResultForAgent(CONTROL))).not.toContain('a factor that could change this');
  });
  it('does not depend on alternative-winner identity or label', () => {
    expect(tippingPointOf(withRows([{ ...rows[0]!, alternative_winner_id: null, alternative_winner_label: null }])))
      .toEqual(tippingPointOf(ENRICHMENT));
  });
  it('preserves the enclosing Run binding and does not mutate the stored result', () => {
    const before = JSON.stringify(block);
    const out = analysisResultForAgent(block) as Rec;
    expect(out.computed_against_hash).toBe('0e19bb826dd6fde4');
    expect(out.tipping_point).toEqual(tippingPointOf(ENRICHMENT));
    // S2i (DL GO): robustness ran on this Run, so the screen shows it and no absence status is handed to the Agent.
    expect(out).not.toHaveProperty('decision_sensitivity');
    expect(JSON.stringify(block)).toBe(before);
  });
  it.each([false, true])('retains the threshold under leader licence %s, with no winner fields', (leader_may_be_named) => {
    const out = modelFacingToolResult('run_analysis', { result: analysisResultForAgent(block),
      claim_permissions: { leader_may_be_named } }) as { result: { tipping_point: Rec } };
    expect(out.result.tipping_point).toEqual(tippingPointOf(ENRICHMENT));
    expect(JSON.stringify(out.result.tipping_point)).not.toMatch(/additional_advertising|Additional advertising|new_leading_option/u);
  });
});
