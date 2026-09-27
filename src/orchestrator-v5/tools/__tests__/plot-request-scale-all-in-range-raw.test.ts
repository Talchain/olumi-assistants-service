/** "Cut churn to 0.8%" alone reached PLoT as 0.8 and was read as 80% (DL #70 5858285859; PLoT #373 KNOWN RESIDUAL). */
import { describe, it, expect } from 'vitest';
import { buildFactorScaleMap, projectRequestInterventionsToWireScale } from '../plot-intervention-scale.js';

const churn = { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', scale_frame: 100,
  observed_state: { value: 0.03, raw_value: 3, unit: '%' } };

describe('an all-in-range request carrying a raw value is demoted', () => {
  it('0.8% alone reaches PLoT as 0.008, never 0.8', () => {
    const map = buildFactorScaleMap([churn]);
    const out = projectRequestInterventionsToWireScale([{ monthly_churn: { value: 0.008, raw_value: 0.8, unit: '%' } }], map);
    expect(out.perOption[0]!.monthly_churn).toBeCloseTo(0.008, 10);
  });
  it('contrast: 2.5% alone ships RAW (2.5) — PLoT reads an out-of-range request as raw and scales it on the frame', () => {
    const map = buildFactorScaleMap([churn]);
    const out = projectRequestInterventionsToWireScale([{ monthly_churn: { value: 0.025, raw_value: 2.5, unit: '%' } }], map);
    expect(out.perOption[0]!.monthly_churn).toBe(2.5);
  });
});
