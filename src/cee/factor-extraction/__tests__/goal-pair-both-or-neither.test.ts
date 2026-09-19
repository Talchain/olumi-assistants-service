/**
 * ⭐⭐ ONE SIDE CARRIED A MAGNITUDE SUFFIX AND THE OTHER DID NOT.
 *
 * MEASURED LIVE on a real user brief (19 Sep): "grow ARR from 8 to 11 million
 * within 12 months" produced `from.raw = 8` and `to.raw = 11,000,000` from ONE
 * regex match — the suffix binds to the second amount only, and `resolveAmount`
 * applied `resolveMagnitude(undefined) === 1` to the first with nothing
 * noticing.
 *
 * ⛔ THE DAMAGE IS DOWNSTREAM AND CONFIDENT. Both numbers are then divided by
 * the SAME cap — that guard is correct and works — giving `goal_threshold 0.8`
 * beside `baseline_norm 5.8e-7`. ISL scores `P(level >= T)` against that
 * baseline, so the user gets a STRUCTURAL ZERO probability presented with full
 * confidence. The baseline was wrong by roughly 1,000,000x.
 *
 * ⭐ NOTHING IS INVENTED HERE. The rule is already this repo's doctrine at
 * `utils/amount-range.ts:936` (`if (hasFromMag !== hasToMag) return null;`) and
 * already wired into the from-to CHANGE pattern. The GOAL pair was the one
 * pair-former that never called it.
 *
 * ⚠ AND IT NEEDS NO CONSTANT. The obvious guard is a ratio threshold between
 * the two numbers — a CHOSEN bound, and this lane has a predicate that
 * oscillated four rounds on exactly that. `hasMagnitude` is a boolean read
 * straight off the parse.
 */

import { describe, expect, it } from 'vitest';

import { extractFactors } from '../index.js';

/** The goal pair a brief produced, or undefined. */
function goalPair(brief: string): { value?: number; baseline?: number } | undefined {
  // `extractFactors` returns ExtractedFactor[] directly (index.ts:2054).
  const factors = extractFactors(brief) as unknown as Array<{
    label?: string;
    value?: number;
    baseline?: number;
  }>;
  const f = factors.find((x) => x.baseline !== undefined);
  return f ? { value: f.value, baseline: f.baseline } : undefined;
}

describe('a goal pair is both-or-neither on magnitude', () => {
  it('REFUSES the measured live case — "from 8 to 11 million"', () => {
    const pair = goalPair('grow ARR from 8 to 11 million within 12 months');
    // The refusal shape: no pair formed, so no baseline is carried and ISL
    // keeps withholding honestly — exactly what it already does for the 82.6%
    // of goals that carry no baseline at all.
    expect(
      pair?.baseline,
      'a baseline survived from a pair whose two sides disagree on scale. ' +
        'Downstream this becomes a structural-zero probability shown with full ' +
        'confidence.',
    ).toBeUndefined();
  });

  it('⭐ CONTRAST: both sides carrying the suffix still forms a pair', () => {
    // The discriminating half. Without it the guard could refuse every pair and
    // the assertion above would pass while the feature was destroyed.
    const pair = goalPair('grow ARR from 8 million to 11 million within 12 months');
    expect(
      pair?.baseline,
      'a legitimate same-scale pair was refused — the guard is too wide and has ' +
        'cost the user a ranking rather than saved them a wrong one',
    ).toBeDefined();
  });

  it('CONTRAST: neither side carrying a suffix still forms a pair', () => {
    const pair = goalPair('grow weekly active teams from 1200 to 1500 within 12 months');
    expect(pair?.baseline).toBeDefined();
  });

  it('the refusal is SUPPRESSION, never a distributed suffix', () => {
    // ⚠ Reading "from 8 to 11 million" as 8 MILLION is the likely intent and is
    // still a GUESS about what the user meant. Putting an invented number on
    // the user's own goal is the harm this refusal exists to avoid, so the
    // guard must not "helpfully" repair the pair.
    const pair = goalPair('grow ARR from 8 to 11 million within 12 months');
    expect(pair?.baseline).not.toBe(8_000_000);
    expect(pair?.baseline).not.toBe(8);
  });
});
