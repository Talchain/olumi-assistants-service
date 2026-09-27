import { describe, it, expect } from 'vitest';
import { addedFactorsReceipt } from '../added-factors-receipt.js';

const PLACEHOLDER = 'how strongly is not known yet: Olumi used a placeholder strength, not an estimate.';
/** Served f658d106 / CEE 4bdf7b2 (consent-C2c-2094r): the grandfathering option added these two factors. */
const SERVED = [
  { label: 'New-customer Pro price', changes: ['"MRR"', '"Monthly churn"'], strength: PLACEHOLDER },
  { label: 'Existing-customer Pro price', changes: ['"MRR"', '"Monthly churn"'], strength: PLACEHOLDER },
];

describe('added factors are said once, with one ask for their values', () => {
  it('RED (served receipt): two added factors → ONE ask naming both, the strength said once, nothing dropped', () => {
    const text = addedFactorsReceipt(SERVED).join(' ');
    expect(text.match(/Tell me/g)).toHaveLength(1);
    expect(text).toContain('Tell me today\'s value for "New-customer Pro price" and "Existing-customer Pro price" and I\'ll record them.');
    expect(text.split(PLACEHOLDER)).toHaveLength(2);
    for (const p of SERVED) expect(text).toContain(`"${p.label}" (changes "MRR", "Monthly churn")`);
    expect(text).not.toContain('Its current value is not set yet');
  });
  it('one factor keeps its sentence and asks once', () => {
    expect(addedFactorsReceipt([SERVED[0]!])).toEqual([
      `Also added the factor "New-customer Pro price", which changes "MRR", "Monthly churn"; ${PLACEHOLDER} Tell me its value today and I'll record it.`,
    ]);
  });
  it('different strength words are each kept on their own factor (provenance is never merged)', () => {
    const mixed = [SERVED[0]!, { ...SERVED[1]!, strength: 'how strongly is Olumi\'s estimate, for you to correct.' }];
    const text = addedFactorsReceipt(mixed).join(' ');
    expect(text).toContain(`"New-customer Pro price", which changes "MRR", "Monthly churn"; ${PLACEHOLDER}`);
    expect(text).toContain('"Existing-customer Pro price", which changes "MRR", "Monthly churn"; how strongly is Olumi\'s estimate');
    expect(text.match(/Tell me/g)).toHaveLength(1);
  });
  it('no added factor → nothing', () => {
    expect(addedFactorsReceipt([])).toEqual([]);
  });
});
