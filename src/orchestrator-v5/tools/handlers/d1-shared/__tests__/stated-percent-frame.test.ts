import { describe, expect, it } from 'vitest';

import { D1HandlerError } from '../errors.js';
import { normaliseFactorValue, type NormaliseInput } from '../normalise-factor-value.js';

function explicitPercent(overrides: Partial<NormaliseInput> = {}): NormaliseInput {
  return { rawInput: 12, unit: '%', inputHasUnit: true, ...overrides };
}

function expectScaleRefusal(input: NormaliseInput) {
  let failure: unknown;
  try {
    normaliseFactorValue(input);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(D1HandlerError);
  expect(failure).toMatchObject({ code: 'PARAMETER_INVALID' });
  expect((failure as D1HandlerError).userGuidance).toBeTruthy();
}

describe('a stated percent supplies a frame without inventing a scale class', () => {
  it('keeps 12 in user units and supplies the missing divisor of 100', () => {
    const input = explicitPercent();
    const before = { ...input };
    expect(normaliseFactorValue(input)).toEqual({ raw_value: 12, value: 0.12, scale_frame: 100 });
    expect(input).toEqual(before);
  });

  it('retains a zero percent frame when a later reader cannot recover it from 0 / 0', () => {
    expect(normaliseFactorValue(explicitPercent({ rawInput: 0 }))).toEqual({
      raw_value: 0, value: 0, scale_frame: 100,
    });
  });

  it.each([undefined, 'ratio'] as const)('110 percent remains 1.1 with declared scale %s, without adding a cap or probability class', (factorDeclaredScale) => {
    const result = normaliseFactorValue(explicitPercent({ rawInput: 110, factorDeclaredScale }));
    expect(result).toEqual({ raw_value: 110, value: 1.1, scale_frame: 100 });
    expect(result).not.toHaveProperty('cap');
    expect(result).not.toHaveProperty('declared_scale');
    expect(result).not.toHaveProperty('factor_type');
  });

  it.each([-1, 110])('a new unit_interval frame refuses %s percent rather than contradicting its declared bounds', (rawInput) => {
    expectScaleRefusal(explicitPercent({ rawInput, factorDeclaredScale: 'unit_interval' }));
  });

  it.each([0, 100])('a declared unit_interval still accepts its %s percent boundary', (rawInput) => {
    expect(normaliseFactorValue(explicitPercent({ rawInput, factorDeclaredScale: 'unit_interval' }))).toEqual({
      raw_value: rawInput, value: rawInput / 100, scale_frame: 100,
    });
  });

  it.each(['probability', 'continuous', 'count'])('a legacy factor_type=%s supplies no authority to clamp or classify the percentage', (factor_type) => {
    const input = { ...explicitPercent({ rawInput: 110 }), factor_type };
    expect(normaliseFactorValue(input)).toEqual({ raw_value: 110, value: 1.1, scale_frame: 100 });
  });

  it('the opposite bare 12 stays raw rather than acquiring a percentage frame', () => {
    expect(normaliseFactorValue({ rawInput: 12, inputHasUnit: false })).toEqual({
      raw_value: 12, value: 12,
    });
  });

  it('a recorded small count can still increase from 1 to 12', () => {
    expect(normaliseFactorValue({
      rawInput: 12, inputHasUnit: false,
      factorObservedValue: 1, factorObservedRawValue: 1,
      factorDeclaredScale: 'raw_count',
    })).toEqual({ raw_value: 12, value: 12 });
  });

  it('an explicitly stated currency without a cap remains in its raw currency units', () => {
    expect(normaliseFactorValue({ rawInput: 120000, unit: '£', inputHasUnit: true })).toEqual({
      raw_value: 120000, value: 120000,
    });
  });

  it('an existing currency cap retains its own divisor', () => {
    expect(normaliseFactorValue({
      rawInput: 120000, unit: '£', factorUnit: '£', factorCap: 200000, inputHasUnit: true,
    })).toEqual({ raw_value: 120000, value: 0.6 });
  });

  it('an existing coherent frame of 200 wins over the new-unit convention', () => {
    expect(normaliseFactorValue(explicitPercent({
      factorUnit: '%', factorScaleFrame: 200,
      factorObservedRawValue: 40, factorObservedValue: 0.2,
    }))).toEqual({ raw_value: 12, value: 0.06 });
  });

  it('a valid stored frame with no baseline pair is still authoritative', () => {
    expect(normaliseFactorValue(explicitPercent({ factorScaleFrame: 200 }))).toEqual({
      raw_value: 12, value: 0.06,
    });
  });

  it('a legacy coherent percentage pair still preserves its recovered frame', () => {
    expect(normaliseFactorValue(explicitPercent({
      rawInput: 24, factorUnit: '%',
      factorObservedRawValue: 12, factorObservedValue: 0.12,
    }))).toEqual({ raw_value: 24, value: 0.24 });
  });

  it.each([
    { name: 'raw 12/12 pair', factorObservedValue: 12, factorObservedRawValue: 12 },
    { name: 'recorded zero pair', factorObservedValue: 0, factorObservedRawValue: 0 },
    { name: 'recorded value alone', factorObservedValue: 12 },
    { name: 'recorded raw amount alone', factorObservedRawValue: 12 },
  ])('refuses a new percent frame for an existing $name without reframing the baseline alone', ({ name: _name, ...recorded }) => {
    const input = explicitPercent({ rawInput: 24, factorUnit: '%', ...recorded });
    const before = { ...input };
    expectScaleRefusal(input);
    expect(input).toEqual(before);
  });

  it('refuses a stored 200 frame that conflicts with the factor pair proving 100', () => {
    expectScaleRefusal(explicitPercent({
      factorUnit: '%', factorScaleFrame: 200,
      factorObservedRawValue: 40, factorObservedValue: 0.4,
    }));
  });

  it.each([0, 1, -100, Number.NaN, Number.POSITIVE_INFINITY])('an invalid stored frame %s cannot fall back to a recoverable 100 pair', (factorScaleFrame) => {
    expectScaleRefusal(explicitPercent({
      factorUnit: '%', factorScaleFrame,
      factorObservedRawValue: 40, factorObservedValue: 0.4,
    }));
  });

  it('an existing percentage cap of 100 keeps its established result and does not mint another frame', () => {
    expect(normaliseFactorValue(explicitPercent({
      factorCap: 100, factorUnit: '%',
      factorObservedRawValue: 20, factorObservedValue: 0.2,
    }))).toEqual({ raw_value: 12, value: 0.12 });
  });

  it('refuses a new percent frame when the semantic scale is explicitly raw_count', () => {
    expectScaleRefusal(explicitPercent({ factorDeclaredScale: 'raw_count' }));
  });

  it('refuses an unrecognised recorded scale rather than upgrading it to a percent frame', () => {
    expectScaleRefusal(explicitPercent({ factorDeclaredScale: 'unknown_future_scale' }));
  });
});
