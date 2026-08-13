/**
 * Unit tests for the centralised display formatters (Phase 2 workstream C).
 *
 * Pins:
 *  - display mode rounds probabilities to whole percent
 *  - debug mode preserves the raw value with three-digit precision
 *  - non-finite values return "Not available" and emit telemetry
 *  - out-of-range probabilities (<0 or >1) return "Not available" and emit
 *    telemetry — no silent clamping
 *  - prose surface uses "percentage points" in full
 *  - compact surface uses "pp"
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setTestSink } from '../../../utils/telemetry.js';
import {
  formatPercentagePoints,
  formatProbability,
  formatProbabilityMargin,
} from '../format-analysis-value.js';

type Event = { event: string; data: Record<string, unknown> };

let events: Event[] = [];
beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
});

function probabilityOutOfRangeEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.probability_out_of_range');
}

describe('formatProbability', () => {
  it('renders valid 0–1 values as whole-percent in display mode', () => {
    expect(formatProbability(0)).toBe('0%');
    expect(formatProbability(0.05)).toBe('5%');
    expect(formatProbability(0.5)).toBe('50%');
    expect(formatProbability(0.62)).toBe('62%');
    expect(formatProbability(0.964)).toBe('96%');
    expect(formatProbability(1)).toBe('100%');
    expect(probabilityOutOfRangeEvent()).toBeUndefined();
  });

  /**
   * ROADMAP 2.229 slice 3 — CERTAINTY IS A CLAIM, NOT A ROUNDING.
   *
   * ⚠ TWO ASSERTIONS WERE DELETED FROM THE BLOCK ABOVE, DELIBERATELY, AND THIS
   * COMMENT IS THE RECORD OF WHY. They read:
   *
   *     expect(formatProbability(0.001)).toBe('0%');
   *     expect(formatProbability(0.999)).toBe('100%');
   *
   * They were not wrong about the code — they described `Math.round(v * 100)`
   * exactly. They were wrong about the WORLD, and they were derived from the
   * formatter rather than from what the number means (CLAUDE.md trap 13c: a
   * mutant kit validates sensitivity, never the correctness of the oracle —
   * those two lines were a perfect score on the wrong exam, and they held the
   * defect in place for every consumer of this module).
   *
   * MEASURED CONSEQUENCE, at the bytes, on the deployed build `335a938`:
   * ISL computed `win_probabilities = {replace…: 0.9991, keep…: 0.0009}`
   * (`coaching-surface-2026-08-12/drive-20260813/raw-T3_ANALYSE.json`) and the
   * deterministic composer emitted "…with a probability of 100%. `keep what we
   * have` sits in second place, with a probability of 0%."
   * (`drive-20260813/raw-Q4_METHOD.json`). A live 1-in-1,100 possibility was
   * rendered IMPOSSIBLE and a 99.91% result was rendered CERTAIN.
   *
   * THE PROPERTY, stated over the whole domain rather than over the two values
   * that happened to bite (trap 13d — write the invariant against the spec, not
   * against the failure mode you are fixing):
   *
   *   - a value that is NOT exactly 1 must never render "100%"
   *   - a value that is NOT exactly 0 must never render "0%"
   *
   * COPY CONVENTION IS DERIVED, NOT INVENTED. `<1%` is this estate's existing
   * house form for a sub-one-percent probability: `analysis-result-headline.ts`
   * carries `ELIMINATED_WIN_PROBABILITY_CEILING = 0.01` at `:186` with the
   * comment 'Mirrors the mission wording "<1% win probability"' at `:184`, and
   * that module's own note at `:197` records that an INTEGER percentage is used
   * precisely so the raw-decimal rule holds. `>99%` is its arithmetic mirror.
   * Neither token trips `RAW_DECIMAL_RE`
   * (`compose/forbidden-user-facing-phrases.ts:340`, leading-decimal only), and
   * every leader-leak pattern in `compose/leading-option-egress-guard.ts:82+`
   * is LEXICAL (`leads`, `winner`, `performs best`, …) rather than numeric, so
   * no detector loses sensitivity to a claim that now carries `<1%`/`>99%`.
   */
  it('never renders a non-certain probability as 100% or a live one as 0%', () => {
    // The exact pair measured live on `335a938`.
    expect(formatProbability(0.9991)).toBe('>99%');
    expect(formatProbability(0.0009)).toBe('<1%');

    // The property holds across the whole extreme band, not just at the two
    // values that were captured — including the half-percent boundaries, which
    // `Math.round` also sent to certainty.
    for (const v of [0.995, 0.999, 0.9999, 1 - Number.EPSILON]) {
      expect(formatProbability(v)).toBe('>99%');
    }
    for (const v of [0.0001, 0.001, 0.004, Number.EPSILON]) {
      expect(formatProbability(v)).toBe('<1%');
    }

    // ⚠ THE TWO ENDS ARE ARITHMETICALLY ASYMMETRIC, AND THAT IS DELIBERATE.
    // `Math.round` rounds half UP, so 0.995 → 99.5 → 100 (a certainty claim,
    // clamped above) while 0.005 → 0.5 → 1 (an ordinary "1%", left alone).
    // The clamp is therefore [0, 0.005) at the floor and [0.995, 1) at the
    // ceiling — not a symmetric pair, and this line exists so nobody
    // "corrects" it into one. The PROPERTY is still symmetric and still
    // holds: a value that is not exactly 0 never reads "0%".
    expect(formatProbability(0.005)).toBe('1%');

    // …and the two genuine certainties still read as certainties. Without this
    // pair the fix could be "never say 100%", which is a different and equally
    // dishonest product.
    expect(formatProbability(1)).toBe('100%');
    expect(formatProbability(0)).toBe('0%');

    // Nothing above is an out-of-range value: the guard must not have fired,
    // or the assertions would be passing on the "Not available" path instead
    // of on the rounding path (trap 13b — pin the precondition in-test).
    expect(probabilityOutOfRangeEvent()).toBeUndefined();
  });

  it('leaves the interior of the range on whole-percent rounding', () => {
    // Contrast control for the test above: the clamp must be confined to the
    // extremes. A fix that returned "<1%"/">99%" too widely would pass the
    // certainty test and silently destroy every ordinary probability — so this
    // asserts the ordinary band is untouched, including the values adjacent to
    // the two clamp boundaries.
    expect(formatProbability(0.006)).toBe('1%');
    expect(formatProbability(0.01)).toBe('1%');
    expect(formatProbability(0.014)).toBe('1%');
    expect(formatProbability(0.985)).toBe('99%');
    expect(formatProbability(0.99)).toBe('99%');
    expect(formatProbability(0.994)).toBe('99%');
    expect(probabilityOutOfRangeEvent()).toBeUndefined();
  });

  it('renders debug mode with three-digit precision', () => {
    expect(formatProbability(0.964, 'debug')).toBe('0.964');
    expect(formatProbability(0.5, 'debug')).toBe('0.500');
    expect(formatProbability(1, 'debug')).toBe('1');
    expect(formatProbability(0, 'debug')).toBe('0');
  });

  it('returns "Not available" and emits telemetry for NaN', () => {
    expect(formatProbability(Number.NaN)).toBe('Not available');
    const ev = probabilityOutOfRangeEvent();
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({ value_kind: 'non_finite', detail: 'NaN' });
  });

  it('returns "Not available" and emits telemetry for Infinity', () => {
    expect(formatProbability(Number.POSITIVE_INFINITY)).toBe('Not available');
    expect(probabilityOutOfRangeEvent()!.data).toMatchObject({
      value_kind: 'non_finite',
      detail: 'Infinity',
    });
  });

  it('returns "Not available" and emits telemetry for negative values (no silent clamping)', () => {
    expect(formatProbability(-0.1)).toBe('Not available');
    expect(probabilityOutOfRangeEvent()!.data).toMatchObject({
      value_kind: 'out_of_range',
      detail: '-0.1',
    });
  });

  it('returns "Not available" and emits telemetry for values >1 (no silent clamping)', () => {
    expect(formatProbability(1.5)).toBe('Not available');
    expect(probabilityOutOfRangeEvent()!.data).toMatchObject({
      value_kind: 'out_of_range',
      detail: '1.5',
    });
  });

  it('honours field_path in telemetry context', () => {
    formatProbability(Number.NaN, 'display', { field_path: 'results[0].win_probability' });
    expect(probabilityOutOfRangeEvent()!.data).toMatchObject({
      field_path: 'results[0].win_probability',
    });
  });
});

describe('formatPercentagePoints', () => {
  it('renders prose surface with full "percentage points" suffix', () => {
    expect(formatPercentagePoints(24)).toBe('24 percentage points');
    expect(formatPercentagePoints(0)).toBe('0 percentage points');
    expect(formatPercentagePoints(94)).toBe('94 percentage points');
  });

  it('renders compact surface as "Npp"', () => {
    expect(formatPercentagePoints(24, 'compact')).toBe('24pp');
    expect(formatPercentagePoints(94, 'compact')).toBe('94pp');
  });

  it('rounds to nearest whole number', () => {
    expect(formatPercentagePoints(23.6)).toBe('24 percentage points');
    expect(formatPercentagePoints(23.4)).toBe('23 percentage points');
  });

  it('handles negative pp values (debug bundles use them)', () => {
    expect(formatPercentagePoints(-5)).toBe('-5 percentage points');
    expect(formatPercentagePoints(-5, 'compact')).toBe('-5pp');
  });

  it('uses singular "percentage point" only when |value| === 1', () => {
    expect(formatPercentagePoints(1)).toBe('1 percentage point');
    expect(formatPercentagePoints(-1)).toBe('-1 percentage point');
    expect(formatPercentagePoints(2)).toBe('2 percentage points');
    expect(formatPercentagePoints(0)).toBe('0 percentage points');
    expect(formatPercentagePoints(0.7)).toBe('1 percentage point');
  });

  it('returns "Not available" and emits telemetry for NaN', () => {
    expect(formatPercentagePoints(Number.NaN)).toBe('Not available');
    expect(probabilityOutOfRangeEvent()!.data).toMatchObject({
      value_kind: 'non_finite',
      detail: 'NaN',
    });
  });
});

describe('formatProbabilityMargin', () => {
  it('computes (leader - runner) * 100 in prose mode', () => {
    expect(formatProbabilityMargin(0.62, 0.38)).toBe('24 percentage points');
    expect(formatProbabilityMargin(0.964, 0.025)).toBe('94 percentage points');
  });

  it('renders compact surface', () => {
    expect(formatProbabilityMargin(0.62, 0.38, 'compact')).toBe('24pp');
  });

  it('returns "Not available" and emits telemetry when leader is invalid', () => {
    expect(formatProbabilityMargin(Number.NaN, 0.38)).toBe('Not available');
    expect(probabilityOutOfRangeEvent()!.data).toMatchObject({
      field_path: 'margin.leader',
      value_kind: 'non_finite',
    });
  });

  it('returns "Not available" and emits telemetry when runner is out of range', () => {
    expect(formatProbabilityMargin(0.62, 1.5)).toBe('Not available');
    expect(probabilityOutOfRangeEvent()!.data).toMatchObject({
      field_path: 'margin.runner',
      value_kind: 'out_of_range',
    });
  });
});
