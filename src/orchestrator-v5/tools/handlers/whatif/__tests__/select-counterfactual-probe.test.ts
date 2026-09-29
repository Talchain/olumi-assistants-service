/**
 * Unit tests for the deterministic what-if probe selector.
 *
 * Pins: fires ONLY on a concrete single-factor flip (a named actionable
 * factor); never guesses; auditable trigger provenance.
 */

import { describe, it, expect } from 'vitest';

import { selectCounterfactualProbe } from '../select-counterfactual-probe.js';
import type { FlipSummary, FlipEntry } from '../../../../compose/flip-proposal.js';
import type { RawRobustnessSignals } from '../../../../coaching/robustness-honesty.js';

function entry(over?: Partial<FlipEntry>): FlipEntry {
  return {
    factor_id: 'factor_capacity',
    factor_label: 'Engineering capacity',
    flip_value: 18,
    ...over,
  };
}

function summary(status: FlipSummary['overall_status'], entries: FlipEntry[]): FlipSummary {
  return { overall_status: status, entries, margin_supports_flip: true };
}

const FRAGILE: RawRobustnessSignals = { level: 'fragile', near_tie_is_tie: false };
const STABLE: RawRobustnessSignals = { level: 'stable', near_tie_is_tie: false };

describe('selectCounterfactualProbe', () => {
  it('selects the first concrete flip entry as the probe', () => {
    const probe = selectCounterfactualProbe(summary('concrete', [entry()]), STABLE);
    expect(probe).toEqual({
      factor_id: 'factor_capacity',
      factor_label: 'Engineering capacity',
      trigger: 'concrete_flip',
    });
  });

  it('labels the trigger fragile_concrete_flip when the result is raw-fragile', () => {
    const probe = selectCounterfactualProbe(summary('concrete', [entry()]), FRAGILE);
    expect(probe?.trigger).toBe('fragile_concrete_flip');
  });

  it('skips entries with a null flip_value and picks the next concrete one', () => {
    const probe = selectCounterfactualProbe(
      summary('concrete', [
        entry({ factor_id: 'factor_a', factor_label: 'A', flip_value: null }),
        entry({ factor_id: 'factor_b', factor_label: 'B', flip_value: 12 }),
      ]),
      STABLE,
    );
    expect(probe?.factor_id).toBe('factor_b');
  });

  it('returns null when the overall status is not concrete', () => {
    expect(selectCounterfactualProbe(summary('no_practical_flip', [entry()]), FRAGILE)).toBeNull();
    expect(selectCounterfactualProbe(summary('insufficient_data', [entry()]), FRAGILE)).toBeNull();
    expect(selectCounterfactualProbe(summary('none', []), FRAGILE)).toBeNull();
  });

  it('returns null when no concrete entry carries a usable factor id + finite value', () => {
    expect(
      selectCounterfactualProbe(summary('concrete', [entry({ factor_id: '  ', flip_value: 5 })]), STABLE),
    ).toBeNull();
    expect(
      selectCounterfactualProbe(summary('concrete', [entry({ flip_value: Number.NaN })]), STABLE),
    ).toBeNull();
  });

  it('returns null for absent flip evidence', () => {
    expect(selectCounterfactualProbe(null, FRAGILE)).toBeNull();
    expect(selectCounterfactualProbe(undefined, undefined)).toBeNull();
  });
});
