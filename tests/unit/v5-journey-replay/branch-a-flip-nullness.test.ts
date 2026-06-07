/**
 * V5 replay harness — Branch A pending-scenario flip-nullness classifier.
 *
 * Pins the PURE `classifyFlipThresholdsNullness` contract that drives the
 * pending-scenario split. The classifier decides whether a persisted
 * `run_analysis` fact's `flip_thresholds[]` carried a live (finite)
 * `flip_value` (`has_non_null` → an emit regression if the chip is absent),
 * carried only null/absent flips (`all_null` → the pending-scenario case),
 * carried no entries at all (`empty` → PLoT found no flip-threshold factors,
 * ALSO the pending-scenario case — common on staging), or was not an array
 * (`absent` → inconclusive, fail-safe to red). The live wrapper
 * `readFlipThresholdsNullness` delegates to this; it needs staging Supabase
 * credentials and is exercised on the `--db-readback` path (and indirectly by
 * the run-level test).
 */

import { describe, it, expect } from 'vitest';

import { classifyFlipThresholdsNullness } from '../../../tools/v5-journey-replay/db-readback.js';

describe('classifyFlipThresholdsNullness', () => {
  it('classifies all-null flip_value entries as all_null (the pending-scenario case)', () => {
    expect(
      classifyFlipThresholdsNullness([
        { factor_id: 'fac_eng', factor_label: 'Engineering Capacity', flip_value: null },
        { factor_id: 'fac_q', factor_label: 'Quality', flip_value: null },
      ]),
    ).toBe('all_null');
  });

  it('treats absent/undefined flip_value entries as all_null too', () => {
    expect(
      classifyFlipThresholdsNullness([
        { factor_id: 'fac_a', factor_label: 'A' },
        { factor_id: 'fac_b', factor_label: 'B', flip_value: undefined },
      ]),
    ).toBe('all_null');
  });

  it('classifies one finite flip_value as has_non_null (emit regression signal)', () => {
    expect(
      classifyFlipThresholdsNullness([
        { factor_id: 'fac_q', factor_label: 'Quality', flip_value: 0.4 },
      ]),
    ).toBe('has_non_null');
  });

  it('classifies a mix (one null, one finite number) as has_non_null', () => {
    expect(
      classifyFlipThresholdsNullness([
        { factor_id: 'fac_a', factor_label: 'A', flip_value: null },
        { factor_id: 'fac_b', factor_label: 'B', flip_value: 0.5 },
      ]),
    ).toBe('has_non_null');
  });

  it('classifies an empty array as empty (a pending-scenario status, like all_null)', () => {
    expect(classifyFlipThresholdsNullness([])).toBe('empty');
  });

  it('classifies a non-array (object / undefined / null / string) as absent (fail-safe to red)', () => {
    expect(classifyFlipThresholdsNullness({})).toBe('absent');
    expect(classifyFlipThresholdsNullness(undefined)).toBe('absent');
    expect(classifyFlipThresholdsNullness(null)).toBe('absent');
    expect(classifyFlipThresholdsNullness('flip_thresholds')).toBe('absent');
  });

  it('does NOT count a non-finite numeric (NaN / Infinity) or string flip_value as non-null', () => {
    expect(
      classifyFlipThresholdsNullness([
        { factor_id: 'a', flip_value: Number.NaN },
        { factor_id: 'b', flip_value: Number.POSITIVE_INFINITY },
        { factor_id: 'c', flip_value: '0.4' },
      ]),
    ).toBe('all_null');
  });
});
