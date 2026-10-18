import { describe, it, expect } from 'vitest';
import { classifyValueSource } from '../../src/cee/graph-readiness/obligation-provenance.js';

describe('obligation provenance', () => {
  it('user_confirmed is NOT authorship for obligation', () => {
    expect(classifyValueSource('user_confirmed')).toBe('user_ratified');
  });

  it('user_assumption is ratification, not authorship', () => {
    expect(classifyValueSource('user_assumption')).toBe('user_ratified');
  });
});
