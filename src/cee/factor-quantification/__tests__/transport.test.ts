import { describe, expect, it } from 'vitest';
import { selectFactorQuantity } from '@talchain/schemas';
import { GraphV3, type NodeV3T } from '../../../schemas/cee-v3.js';
import { transformNodeToV3 } from '../../transforms/schema-v3.js';

type Input = Record<string, unknown>;
const factor = (data: Input, extra: Input = {}): Input => ({
  id: 'fac_quantity', kind: 'factor', label: 'Current availability share',
  category: 'controllable', data, ...extra,
});
/** Serialize and validate the real transform result, rather than keeping
 * undefined source properties or bypassing the receiving canonical schema. */
function throughWire(input: Input): NodeV3T {
  const projected = transformNodeToV3(input as Parameters<typeof transformNodeToV3>[0]);
  return GraphV3.parse(JSON.parse(JSON.stringify({ nodes: [projected], edges: [] }))).nodes[0]!;
}

describe('factor quantity source and fallback semantics through the V3 transport', () => {
  it.each([0.5, 0.37])('preserves explicitly stamped system fallback at value %s', value => {
    const input = factor({ value, unit: 'share', value_tier: 'fallback_default' });
    const before = structuredClone(input);
    const output = throughWire(input);
    expect(output.observed_state).toMatchObject({ value, unit: 'share',
      source: 'cee_repair', value_tier: 'fallback_default' });
    expect(selectFactorQuantity(output)).toMatchObject({ kind: 'fallback',
      carrier: 'observed_state', source: 'cee_repair', protected: false });
    expect(input).toEqual(before);
  });

  it.each([0.5, 0.37])('leaves source-absent value %s neutral instead of calling it user input or fallback', value => {
    const output = throughWire(factor({ value, unit: 'share' }));
    expect(output.observed_state?.value).toBe(value);
    expect(output.observed_state).not.toHaveProperty('source');
    expect(output.observed_state).not.toHaveProperty('value_tier');
    expect(output.observed_state).not.toHaveProperty('extractionType');
    expect(selectFactorQuantity(output)).toEqual({ kind: 'point', carrier: 'observed_state',
      source: null, protected: true });
    expect(output.provenance).not.toBe('from_brief');
  });

  it.each(['future_source', null, 42])('refuses unsupported source %s despite an explicit extraction label', source => {
    const input = factor({ value: 0.12, source, extractionType: 'explicit', unit: 'share' });
    expect(() => throughWire(input)).toThrow('Unsupported factor source on fac_quantity');
  });

  it.each(['future_source', null, 42])('a fallback stamp does not license coercing unsupported source %s', source => {
    const input = factor({ value: 0.12, source, value_tier: 'fallback_default', unit: 'share' });
    expect(() => throughWire(input)).toThrow('Unsupported factor source on fac_quantity');
  });

  it('does not transfer an observed fallback marker or repair source onto an independent supplied prior', () => {
    const suppliedPrior = { distribution: 'uniform', range_min: 0.2, range_max: 0.4,
      unit: 'share', source: 'user_assumption' };
    const input = factor({ value: 0.5, source: 'cee_repair', value_tier: 'fallback_default', unit: 'share' },
      { prior: suppliedPrior });
    const before = structuredClone(input);
    const output = throughWire(input);
    expect(output.observed_state).toMatchObject({ value: 0.5, source: 'cee_repair', value_tier: 'fallback_default' });
    expect(output.prior).toEqual(suppliedPrior);
    expect(output.prior).not.toHaveProperty('prior_is_unquantified');
    expect(output.prior).not.toHaveProperty('value_tier');
    expect(selectFactorQuantity(output)).toEqual({ kind: 'distribution', carrier: 'prior',
      source: 'user_assumption', protected: true });
    expect(input).toEqual(before);
  });

  it.each(['explicit', 'observed'] as const)('preserves supported %s extraction and raw units', extractionType => {
    const output = throughWire(factor({ value: 0.38, raw_value: 38, unit: '%', extractionType }));
    expect(output.observed_state).toMatchObject({ value: 0.38, raw_value: 38, unit: '%',
      extractionType, source: 'brief_extraction' });
    expect(output.observed_state).not.toHaveProperty('value_tier');
    expect(selectFactorQuantity(output)).toMatchObject({ kind: 'point', source: 'brief_extraction', protected: true });
  });

  it('does not replace an explicit user source with the inferred extraction label', () => {
    const output = throughWire(factor({ value: 0.24, raw_value: 24, unit: '%',
      source: 'user_override', extractionType: 'inferred' }));
    expect(output.observed_state).toMatchObject({ value: 0.24, raw_value: 24, unit: '%', source: 'user_override' });
    expect(selectFactorQuantity(output)).toMatchObject({ kind: 'point', source: 'user_override', protected: true });
  });
});
