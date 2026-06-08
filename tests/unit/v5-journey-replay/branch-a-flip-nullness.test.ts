/**
 * V5 replay harness — Branch A pending-scenario flip-nullness classifier.
 *
 * Pins the PURE `classifyFlipThresholdsNullness` contract that drives the
 * pending-scenario split. The classifier decides whether a persisted
 * `run_analysis` fact's `flip_thresholds[]` carried a live (finite)
 * `flip_value` (`has_non_null` → an emit regression if the chip is absent),
 * carried only null/absent flips (`all_null` → the pending-scenario case),
 * carried no entries at all (`empty` → PLoT found no flip-threshold factors,
 * ALSO the pending-scenario case — common on staging), carried an unexpected
 * shape — a non-object entry or a flip_value that is neither finite nor
 * null/undefined, e.g. a numeric string `"0.4"` (`malformed` → fail-safe to
 * red; a real flip may be serialised in a form we don't recognise, so it must
 * NOT be masked as no-flip), or was not an array (`absent` → inconclusive,
 * fail-safe to red). The live wrapper `readFlipThresholdsNullness` delegates
 * to this; it needs staging Supabase credentials and is exercised on the
 * `--db-readback` path (and indirectly by the run-level test).
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

  it('classifies a numeric-looking STRING flip_value as malformed (not masked as no-flip)', () => {
    // The exact PLoT contract-drift case: a real flip serialised as a string
    // must NOT be silently treated as "no flip" / all_null → fail safe to red.
    expect(
      classifyFlipThresholdsNullness([{ factor_id: 'c', factor_label: 'C', flip_value: '0.4' }]),
    ).toBe('malformed');
  });

  it('classifies a non-finite numeric (NaN / Infinity) flip_value as malformed', () => {
    expect(classifyFlipThresholdsNullness([{ factor_id: 'a', flip_value: Number.NaN }])).toBe('malformed');
    expect(
      classifyFlipThresholdsNullness([{ factor_id: 'b', flip_value: Number.POSITIVE_INFINITY }]),
    ).toBe('malformed');
  });

  it('classifies a boolean / object flip_value as malformed', () => {
    expect(classifyFlipThresholdsNullness([{ factor_id: 'a', flip_value: true }])).toBe('malformed');
    expect(classifyFlipThresholdsNullness([{ factor_id: 'b', flip_value: { v: 0.4 } }])).toBe('malformed');
  });

  it('classifies a non-object array entry as malformed (do NOT skip-and-mask it)', () => {
    expect(classifyFlipThresholdsNullness([null])).toBe('malformed');
    expect(classifyFlipThresholdsNullness(['0.4'])).toBe('malformed');
    expect(classifyFlipThresholdsNullness([42])).toBe('malformed');
    // A well-formed null entry followed by a non-object → still malformed; the
    // unexpected entry is not masked by the valid one.
    expect(classifyFlipThresholdsNullness([{ factor_id: 'a', flip_value: null }, 'oops'])).toBe(
      'malformed',
    );
  });
});
