import { describe, expect, it } from 'vitest';
import { NodeV3 } from '../../../src/schemas/cee-v3.js';

// Exercise the strict union before NodeV3's read-tolerant catch erases malformed carriers.
const strictCarrier = NodeV3.shape.nonlinear_identity.removeCatch().unwrap();
const accumulation = {
  operation: 'accumulation', factor_ids: ['S0', 'churn', 'inflow'],
  horizon_months: 12, rate_scale: 0.01, stated_in_brief: true,
};
const node = (carrier: unknown) => ({ id: 'subs_m12', kind: 'factor', label: 'Subscribers at month 12', nonlinear_identity: carrier });

describe('strict accumulation rate spread schema', () => {
  it('accepts the two rate spreads and retains them through NodeV3', () => {
    const carrier = { ...accumulation, rate_sigma_log: [0.136, 0.136] };
    expect(strictCarrier.safeParse(carrier).success).toBe(true);
    expect(NodeV3.parse(node(carrier)).nonlinear_identity).toEqual(carrier);
  });

  it.each([
    ['negative spread', [-0.1, 0.1]],
    ['one element', [0.136]],
    ['three elements', [0.136, 0.136, 0.136]],
    ['nonfinite spread', [Infinity, 0.136]],
  ])('rejects %s', (_label, rate_sigma_log) => {
    const carrier = { ...accumulation, rate_sigma_log };
    expect(strictCarrier.safeParse(carrier).success).toBe(false);
    expect(NodeV3.parse(node(carrier)).nonlinear_identity).toBeUndefined();
  });

  it.each(['product', 'sum'])('rejects rate_sigma_log on a %s carrier', (operation) => {
    const carrier = { operation, factor_ids: ['S0', 'inflow'], stated_in_brief: false, rate_sigma_log: [0.136, 0.136] };
    expect(strictCarrier.safeParse(carrier).success).toBe(false);
    expect(NodeV3.parse(node(carrier)).nonlinear_identity).toBeUndefined();
  });

  it('keeps an absent spread additive and accepts zero spread', () => {
    expect(strictCarrier.parse(accumulation)).toEqual(accumulation);
    expect(strictCarrier.safeParse({ ...accumulation, rate_sigma_log: [0, 0] }).success).toBe(true);
  });
});
