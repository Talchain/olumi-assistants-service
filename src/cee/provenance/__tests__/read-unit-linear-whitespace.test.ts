/**
 * P44, 8 Oct: `readCurrencyUnitWithQualifiers("£" + ws + "/" + ws + "month")` took 0.48 s at n=1,000 and 19 s at
 * n=4,000. UNIT_PATTERN chains `\s*` around optional groups, so a rejected internal whitespace run backtracked every
 * split of it. `readUnit` now reads one space per run. Scaling rows only (a fixed ms bar flakes on slower CI runners).
 */
import { describe, expect, it } from 'vitest';
import { readCurrencyUnitWithQualifiers, readUnit } from '../stated-amounts.js';

const SHAPES: Record<string, (n: number) => string> = {
  'P44: "£" + ws + "/" + ws + "month"': (n) => `£${' '.repeat(n)}/${' '.repeat(n)}month`,
  'NBSP run before a rejected word': (n) => `£${' '.repeat(n)}x`,
  'tab/newline run before a rejected word': (n) => `£${'\t\n'.repeat(n / 2)}x`,
};

function msFor(read: (s: string) => unknown, s: string, reps: number): number {
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) read(s);
  return performance.now() - t0;
}

describe('readUnit is linear in whitespace runs', () => {
  for (const [name, make] of Object.entries(SHAPES)) {
    it(`${name}: 20,000 whitespace scales like a linear read of 1,000 (≤ 80× for 20×; cubic is 8,000×)`, () => {
      const small = make(1_000), large = make(20_000);
      readCurrencyUnitWithQualifiers(small); // warm the regex
      const tSmall = Math.max(msFor(readCurrencyUnitWithQualifiers, small, 200), 0.5);
      const tLarge = msFor(readCurrencyUnitWithQualifiers, large, 10) * 20;
      expect(tLarge / tSmall).toBeLessThan(80);
      expect(readCurrencyUnitWithQualifiers(large).kind).toBe(readCurrencyUnitWithQualifiers(small).kind);
    });
  }

  it('one space per run reads every unit exactly as before (multi-space, tab, NBSP spellings)', () => {
    const pairs: Array<[string, string]> = [
      ['£  k', '£ k'], ['GBP   m', 'GBP m'], ['£ \t %', '£ %'], ['  £  bn  ', '£ bn'],
      ['£  per   seat  per month', '£ per seat per month'], ['GBP\n/\nmonth', 'GBP / month'], ['50  %', '50 %'],
    ];
    for (const [spaced, single] of pairs) {
      expect(readUnit(spaced)).toEqual(readUnit(single));
      expect(readCurrencyUnitWithQualifiers(spaced)).toEqual(readCurrencyUnitWithQualifiers(single));
    }
    expect(readCurrencyUnitWithQualifiers('£   /   month').kind).toBe('currency');
    expect(readCurrencyUnitWithQualifiers('GBP    widgets').kind).toBe('plain');
  });
});
