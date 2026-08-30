import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { FACTOR_ESTIMATES_JSON_SCHEMA, parseFactorEstimates } from '../estimate-response.js';

const point = { factor_id: 'f_cost', estimate_type: 'estimated', value: 60, std: 12, reasoning: 'The stated contract bounds the likely total; scope remains uncertain.', basis: ['fact:contract'] };
const range = { factor_id: 'f_time', estimate_type: 'estimated', distribution: 'uniform', range_min: 4, range_max: 8, reasoning: 'The contract allocates production slots uniformly from month four to month eight, supporting equal density across those bounds.', basis: ['fact:delivery'] };
const unknown = { factor_id: 'f_effect', estimate_type: 'unknown', reasoning: 'No observation or defensible reference class connects this diagnostic factor to an intervention.', basis: [] };
const ids = ['f_cost', 'f_time', 'f_effect'];
const parse = (item: unknown) => parseFactorEstimates({ estimates: [item] }, ids);

describe('factor quantification response authority and uncertainty', () => {
  it('preserves distinct point, bounded range and explicit unknown outcomes', () => {
    expect(parseFactorEstimates({ estimates: [point, range, unknown] }, ids)).toEqual({ ok: true, estimates: [point, range, unknown] });
  });

  it('keeps omitted targets operationally unresolved instead of inventing abstentions', () => {
    expect(parseFactorEstimates({ estimates: [point] }, ids)).toEqual({ ok: true, estimates: [point] });
    expect(parseFactorEstimates({ estimates: [] }, ids)).toEqual({ ok: true, estimates: [] });
  });

  it.each([
    ['unrequested factor', { ...point, factor_id: 'user_owned_value' }],
    ['padded identity', { ...point, factor_id: ' f_cost ' }],
    ['infinite value', { ...point, value: Infinity }],
    ['NaN value', { ...point, value: NaN }],
    ['negative deviation', { ...point, std: -1 }],
    ['zero deviation', { ...point, std: 0 }],
    ['nonfinite deviation', { ...point, std: Infinity }],
    ['missing deviation', { ...point, std: undefined }],
    ['unsupported distribution', { ...range, distribution: 'normal' }],
    ['reversed range', { ...range, range_min: 10 }],
    ['point mass range', { ...range, range_min: 8 }],
    ['unbounded range', { ...range, range_max: Infinity }],
    ['mixed estimate forms', { ...range, value: 6, std: 1 }],
    ['numeric unknown', { ...unknown, value: 0.5 }],
    ['nullable numeric unknown', { ...unknown, value: null }],
    ['range unknown', { ...unknown, range_min: 0, range_max: 1 }],
    ['distribution unknown', { ...unknown, distribution: 'uniform' }],
    ['model-selected evidence authority', { ...point, source: 'brief_extraction' }],
    ['unit redefinition', { ...point, unit: 'normalized' }],
    ['no reasoning', { ...point, reasoning: '  ' }],
    ['no estimated basis', { ...point, basis: [] }],
    ['duplicate basis', { ...point, basis: ['fact:contract', 'fact:contract'] }],
    ['padded basis identity', { ...point, basis: [' fact:contract '] }],
  ])('rejects %s without silently coercing or dropping it', (_name, item) => {
    expect(parse(item).ok).toBe(false);
  });

  it('rejects duplicate IDs rather than allowing order to select a value', () => {
    expect(parseFactorEstimates({ estimates: [point, { ...point, value: 1 }] }, ids)).toEqual({ ok: false, error: 'duplicate_factor_id' });
  });

  it('rejects response extensions and invalid caller identity sets', () => {
    expect(parseFactorEstimates({ estimates: [point], graph: {} }, ids).ok).toBe(false);
    expect(parseFactorEstimates({ estimates: [point] }, ['f_cost', 'f_cost']).ok).toBe(false);
  });

  it('does not pretend syntax validation establishes basis truth', () => {
    const result = parse({ ...point, basis: ['not_in_allowed_context'] });
    expect(result.ok).toBe(true); // The adopter, with actual context authority, must refuse this.
  });
});

describe('provider grammar agrees with the response forms', () => {
  const validate = new Ajv({ strict: false }).compile(FACTOR_ESTIMATES_JSON_SCHEMA);

  it.each([point, range, unknown])('admits each supported form', (item) => {
    expect(validate({ estimates: [item] }), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each([
    { ...unknown, value: 0.5 },
    { ...range, value: 6, std: 1 },
    { ...point, source: 'user_override' },
  ])('refuses payload mixing and forged provenance at the grammar boundary', (item) => {
    expect(validate({ estimates: [item] })).toBe(false);
  });

  it('contains no numeric constraints rejected by the provider grammar compiler', () => {
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) { keys.push(key); visit(child); }
    };
    visit(FACTOR_ESTIMATES_JSON_SCHEMA);
    expect(keys).not.toEqual(expect.arrayContaining(['minimum']));
    expect(keys).not.toEqual(expect.arrayContaining(['exclusiveMinimum']));
    expect(keys).not.toEqual(expect.arrayContaining(['maxItems']));
  });
});
