import { describe, it, expect } from 'vitest';
import { disclosuresFor, withDisclosures, PLACEHOLDER_STRENGTH_DISCLOSURE } from '../disclosure.js';

describe('Olumi discloses a placeholder, not the Agent', () => {
  it('discloses when a write used a placeholder strength', () => {
    const owed = disclosuresFor([{ mutated: true, placeholder_strength: true }]);
    expect(owed).toEqual([PLACEHOLDER_STRENGTH_DISCLOSURE]);
    expect(owed[0]).toMatch(/not yours/);
    expect(owed[0]).toMatch(/should not be read as a measurement/);
  });

  it('says NOTHING when the write carried a stated strength', () => {
    expect(disclosuresFor([{ mutated: true, placeholder_strength: false }])).toEqual([]);
  });

  it('says NOTHING when nothing was written, even if a proposal used a placeholder', () => {
    expect(disclosuresFor([{ mutated: false, placeholder_strength: true }])).toEqual([]);
  });

  it('says NOTHING on a read-only turn — a disclosure on every turn is noise', () => {
    expect(disclosuresFor([{ mutated: false }, { mutated: false }])).toEqual([]);
  });

  it('appends without rewriting the Agent’s own words', () => {
    const agentText = 'Added the link between policy and churn.';
    const out = withDisclosures(agentText, [PLACEHOLDER_STRENGTH_DISCLOSURE]);
    expect(out.startsWith(agentText)).toBe(true);
    expect(out).toContain(PLACEHOLDER_STRENGTH_DISCLOSURE);
  });

  it('stands alone when the Agent said nothing', () => {
    expect(withDisclosures('', [PLACEHOLDER_STRENGTH_DISCLOSURE])).toBe(PLACEHOLDER_STRENGTH_DISCLOSURE);
  });

  it('returns the text untouched when nothing is owed', () => {
    expect(withDisclosures('hello', [])).toBe('hello');
  });
});
