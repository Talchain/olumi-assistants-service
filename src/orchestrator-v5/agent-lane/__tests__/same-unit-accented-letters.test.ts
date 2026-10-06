/**
 * ⭐ THE UNIT READERS READ EVERY LETTER, NOT ONLY A–Z (Integrator, domain 1; found on RT-6 row 1b, red team #87 6005529714).
 * Served café scenario (guest b8143909, f0eb03ac): "cafés" and "£ per café per month" read as NOTHING in every reader
 * (`readUnitParts`, C1 `readCount` / `readMoney`, the stated-tail readers): seven a–z word tests in same-unit.ts. So
 * "£ per café per month × cafés" never composed to the goal's £/month, while its ASCII twin did. Rows bind by reader
 * output; the ASCII twin is the control that only the accent differs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nounUnitsAt, readCount, readMoney, readUnitParts } from '../same-unit.js';
import { unitsCompose } from '../reconciling-product.js';

describe('same-unit readers read accented letters (U1 class fix)', () => {
  it('a count with an accented noun reads ("cafés" → café)', () => {
    expect(readUnitParts('cafés')).toMatchObject({ kind: 'count', noun: ['café'], period: null });
    expect(readCount('cafés')).toEqual(['café']);
  });
  it('money per an accented denominator reads ("£ per café per month")', () => {
    expect(readMoney('£ per café per month', '')).toEqual({ code: 'GBP', period: 'month', per: ['café'] });
    expect(readMoney('GBP per café per month', '')).toEqual({ code: 'GBP', period: 'month', per: ['café'] });
  });
  it('the stated-tail reader takes an accented noun ("12 cafés a month")', () => {
    expect(nounUnitsAt(' cafés a month')).toContain('cafés');
  });
  it('SERVED GAIN: £ per café per month × cafés composes to the £/month goal (proof), exactly like its ASCII twin', () => {
    const goal = ['GBP per month', 'Monthly wholesale subscription revenue'] as const;
    const accented = unitsCompose(goal[0], goal[1], { unit: 'GBP per café per month', label: 'Monthly fee per café' },
      { unit: 'cafés', label: 'Subscribed local cafés' });
    const ascii = unitsCompose(goal[0], goal[1], { unit: 'GBP per cafe per month', label: 'Monthly fee per cafe' },
      { unit: 'cafes', label: 'Subscribed local cafes' });
    expect(ascii.kind, 'CONTROL: the ASCII twin already composes').toBe('proof');
    expect(accented.kind).toBe('proof');
  });
  it('CONTRAST: the denominator must still name the count (café rate × shops does not compose)', () => {
    expect(unitsCompose('GBP per month', 'Monthly revenue', { unit: 'GBP per café per month', label: 'Fee per café' },
      { unit: 'shops', label: 'Shops operating' }).kind).toBe('no');
  });
  it('CONTRAST: symbols are still not words ("£" alone is money, never a count; "€5" never a noun)', () => {
    expect(readCount('£')).toBeNull();
    expect(readUnitParts('€5')).toBeNull();
  });
  it('a DECOMPOSED accent reads too (NFD "cafe\u0301s": a letter then a combining mark)', () => {
    const nfd = 'cafe\u0301s';
    expect(nfd.length, 'CONTROL: the input really is decomposed').toBe(6);
    expect(readUnitParts(nfd)).toMatchObject({ kind: 'count', noun: [`cafe\u0301`] });
    expect(readMoney('£ per cafe\u0301 per month', '')).toEqual({ code: 'GBP', period: 'month', per: ['cafe\u0301'] });
  });
});

// ⛔ THE GUARD: the class stays closed. No a–z letter class may come back into same-unit.ts's readers.
describe('GUARD: same-unit.ts has no ASCII-only letter class', () => {
  const source = readFileSync(new URL('../same-unit.ts', import.meta.url), 'utf8');
  it('no [a-z] / [A-Za-z] character class in any regex', () => {
    const asciiClasses = source.split('\n').flatMap((line, i) => /\[[^\]]*a-z[^\]]*\]/i.test(line) ? [`${i + 1}: ${line.trim()}`] : []);
    expect(asciiClasses).toEqual([]);
  });
  it('CONTROL: the probe sees the Unicode letter classes it guards', () => {
    expect(source.match(/\\p\{L\}/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });
});
