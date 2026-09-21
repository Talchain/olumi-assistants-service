import { describe, expect, it } from 'vitest';

import { D1HandlerError } from '../errors.js';
import { normaliseFactorValue } from '../normalise-factor-value.js';

describe('normaliseFactorValue', () => {
  it('normalises a percentage on a cap=100 factor', () => {
    const result = normaliseFactorValue({
      rawInput: 5,
      unit: '%',
      proposalCap: 100,
      inputHasUnit: true,
    });
    expect(result).toEqual({ raw_value: 5, value: 0.05 });
  });

  it('normalises currency on a cap-defined factor', () => {
    const result = normaliseFactorValue({
      rawInput: 50000,
      unit: '£',
      factorCap: 100000,
      inputHasUnit: true,
    });
    expect(result).toEqual({ raw_value: 50000, value: 0.5 });
  });

  it('passes a ratio through when no cap is defined', () => {
    const result = normaliseFactorValue({
      rawInput: 0.8,
      inputHasUnit: false,
    });
    expect(result).toEqual({ raw_value: 0.8, value: 0.8 });
  });

  it('rejects ambiguous bare-number on a capped factor', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: 5,
        factorCap: 1,
        inputHasUnit: false,
      }),
    ).toThrow(D1HandlerError);
  });

  it('accepts a bare-number within the factor cap', () => {
    const result = normaliseFactorValue({
      rawInput: 0.5,
      factorCap: 1,
      inputHasUnit: false,
    });
    expect(result).toEqual({ raw_value: 0.5, value: 0.5 });
  });

  it('rejects non-finite input', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: Number.NaN,
        inputHasUnit: false,
      }),
    ).toThrow(D1HandlerError);
  });

  it('rejects non-positive cap', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: 1,
        factorCap: 0,
        inputHasUnit: false,
      }),
    ).toThrow(D1HandlerError);
  });

  it('uses the proposal cap over the factor cap when both are present', () => {
    const result = normaliseFactorValue({
      rawInput: 50,
      proposalCap: 100,
      factorCap: 1,
      inputHasUnit: true,
      unit: '%',
    });
    expect(result).toEqual({ raw_value: 50, value: 0.5 });
  });
});
