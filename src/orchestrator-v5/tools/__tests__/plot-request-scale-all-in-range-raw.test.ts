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

/** Shape probe (the input class, not the served example): every row names the wire value PLoT will read. */
describe('probe — percent levels on a framed churn node, alone and beside other levers', () => {
  const flag = { id: 'grandfathered', kind: 'factor', label: 'Grandfathered', observed_state: { value: 0, raw_value: 0, unit: '0/1' } };
  const map = () => buildFactorScaleMap([churn, flag]);
  const lvl = (raw: number) => ({ value: raw / 100, raw_value: raw, unit: '%' });
  const rows: Array<[string, Array<Record<string, unknown>>, Array<Record<string, number>>]> = [
    ['0.8% alone', [{ monthly_churn: lvl(0.8) }], [{ monthly_churn: 0.008 }]],
    ['1% alone (base sent 1 = 100%)', [{ monthly_churn: lvl(1) }], [{ monthly_churn: 0.01 }]],
    ['0% alone', [{ monthly_churn: lvl(0) }], [{ monthly_churn: 0 }]],
    ['0.8% and 0.5% on two options', [{ monthly_churn: lvl(0.8) }, { monthly_churn: lvl(0.5) }], [{ monthly_churn: 0.008 }, { monthly_churn: 0.005 }]],
    ['0.8% beside 3% (out of range → the request is raw)', [{ monthly_churn: lvl(0.8) }, { monthly_churn: lvl(3) }], [{ monthly_churn: 0.8 }, { monthly_churn: 3 }]],
    ['2.5% alone (raw)', [{ monthly_churn: lvl(2.5) }], [{ monthly_churn: 2.5 }]],
  ];
  for (const [name, input, want] of rows) {
    it(name, () => {
      const out = projectRequestInterventionsToWireScale(input as never, map());
      want.forEach((w, i) => { for (const [k, v] of Object.entries(w)) expect(out.perOption[i]![k]).toBeCloseTo(v, 10); });
    });
  }
});
