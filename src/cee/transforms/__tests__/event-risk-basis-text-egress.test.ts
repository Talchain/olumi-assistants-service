import { describe, expect, it } from 'vitest';
import { transformNodeToV3 } from '../schema-v3.js';
import type { V1Node } from '../schema-v2.js';

const occurrence = (basis = 'olumi') => ({
  version: 1,
  occurrence: { p_low: 0.05, p_high: 0.15, basis },
  horizon: { months: 6 },
});
const basisText = 'A single critical employee in a small team, over six months.';
const source = (eventRisk: unknown = occurrence(), kind = 'risk') => ({
  id: 'risk_key_developer', kind, label: 'Key developer departure',
  event_risk: eventRisk, event_risk_basis_text: basisText,
}) as unknown as V1Node;

describe('FIX-1: occurrence and its Olumi basis sidecar at V3 egress', () => {
  it('preserves valid risk occurrence and its Olumi basis text together', () => {
    const result = transformNodeToV3(source());
    expect(result.event_risk).toEqual(occurrence());
    expect(result.event_risk_basis_text).toBe(basisText);
  });

  it.each([
    ['orphan', undefined, 'risk'],
    ['malformed occurrence', { ...occurrence(), version: 2 }, 'risk'],
    ['non-risk node', occurrence(), 'factor'],
    ['user occurrence', occurrence('user'), 'risk'],
    ['reference occurrence', occurrence('reference'), 'risk'],
  ])('drops %s basis text without inventing a value', (_label, eventRisk, kind) => {
    const input = source(eventRisk, kind);
    // source() has a default for undefined; explicitly remove the orphan's occurrence.
    if (_label === 'orphan') delete (input as unknown as Record<string, unknown>).event_risk;
    const result = transformNodeToV3(input);
    expect(result.event_risk_basis_text).toBeUndefined();
    expect(result.id).toBe('risk_key_developer');
    if (kind !== 'risk' || _label === 'orphan' || _label === 'malformed occurrence') {
      expect(result.event_risk).toBeUndefined();
    } else {
      expect(result.event_risk).toEqual(eventRisk);
    }
  });
});
