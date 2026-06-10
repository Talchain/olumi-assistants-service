/**
 * Value-Scale Readiness — consolidated regression fixtures (Slice D).
 *
 * Part of the "Analysis Trust + Value-Scale Readiness" lane. This suite is
 * FIXTURES-ONLY: it asserts the CURRENT behaviour of every value-scale
 * conversion path so the lane can verify that displayed numbers stay on the
 * same scale as the values analysis uses, across:
 *   - percentages;
 *   - currency (+ thousands separators, k/m abbreviation, ≥ 1e9);
 *   - ranges;
 *   - large-cap factors;
 *   - factor values changed through edit paths (set + delta operators).
 *
 * It deliberately introduces NO source change and NO new guard. A red fixture
 * here is a FINDING to report, not licence to patch source in this lane.
 *
 * Two vectors assert behaviour the audit flagged as unverified-but-current.
 * They are GREEN (they lock today's output) and tagged `[FINDING]` so the
 * surprising rendering is visible without being "fixed" here:
 *   1. ≥ 1e9 currency renders with `m` (no `b`/billion abbreviation):
 *      £1,500,000,000 → "£1500m".
 *   2. Negative currency in the approximate formatter puts the minus AFTER the
 *      symbol: -50,000 → "£-50,000".
 *
 * Formatters under test (exercised through their real public entry points —
 * no mocks): formatFactorValue / formatFactorValueApprox, buildFlipProposal
 * (which drives the internal classifyValueScale), formatProbability /
 * formatPercentagePoints / formatProbabilityMargin, synthesiseDisplayValue /
 * synthesiseRangeDisplayValue, normaliseFactorValue + applyFactorValueOperator,
 * and formatFactorChange.
 */

import { describe, it, expect } from 'vitest';

import {
  formatFactorValue,
  formatFactorValueApprox,
} from '../../src/orchestrator-v5/compose/format-factor-value.js';
import { buildFlipProposal } from '../../src/orchestrator-v5/compose/flip-proposal.js';
import {
  formatProbability,
  formatPercentagePoints,
  formatProbabilityMargin,
} from '../../src/orchestrator-v5/format/format-analysis-value.js';
import { formatFactorChange } from '../../src/orchestrator-v5/tools/handlers/d1-shared/format-confirmation.js';
import { normaliseFactorValue } from '../../src/orchestrator-v5/tools/handlers/d1-shared/normalise-factor-value.js';
import { applyFactorValueOperator } from '../../src/orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import {
  synthesiseDisplayValue,
  synthesiseRangeDisplayValue,
} from '../../src/cee/factor-extraction/display-value.js';

describe('value-scale readiness — percentages', () => {
  it('renders a whole-number percentage on the 0–100 scale', () => {
    expect(formatFactorValue(30, '%')).toEqual({ display: '30%', value: 30 });
  });

  it('refuses an ambiguous sub-1 percentage rather than leaking "0.7%"', () => {
    expect(formatFactorValue(0.7, '%')).toBeNull();
  });

  it('refuses an out-of-range percentage (> 100)', () => {
    expect(formatFactorValue(150, '%')).toBeNull();
  });

  it('converts a model-scale probability [0,1] to a display percentage', () => {
    expect(formatProbability(0.42)).toBe('42%');
    expect(formatProbability(0.964)).toBe('96%');
  });

  it('returns "Not available" (no silent clamp) for a probability outside [0,1]', () => {
    expect(formatProbability(1.5)).toBe('Not available');
    expect(formatProbability(Number.NaN)).toBe('Not available');
  });
});

describe('value-scale readiness — currency', () => {
  it('renders currency with symbol + deterministic thousands separator', () => {
    expect(formatFactorValue(50000, '£')).toEqual({ display: '£50,000', value: 50000 });
    expect(formatFactorValue(50000, 'GBP')).toEqual({ display: '£50,000', value: 50000 });
  });

  it('refuses a fractional currency value (no "£0.5")', () => {
    expect(formatFactorValue(0.5, '$')).toBeNull();
  });

  it('abbreviates large currency amounts with k / m', () => {
    expect(synthesiseDisplayValue({ raw_value: 1_500, unit: '£' })).toBe('£1.5k');
    expect(synthesiseDisplayValue({ raw_value: 1_250_000, unit: '£' })).toBe('£1.25m');
  });

  it('[FINDING] ≥ 1e9 currency renders with "m", NOT a "b"/billion abbreviation', () => {
    // Current behaviour: 1.5bn → "£1500m". Asserted to lock it; a billion-scale
    // abbreviation would be a separate, explicitly-scoped change (NOT this lane).
    expect(synthesiseDisplayValue({ raw_value: 1_500_000_000, unit: '£' })).toBe('£1500m');
  });
});

describe('value-scale readiness — ranges', () => {
  it('formats a currency range with k abbreviation on both bounds', () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 200_000, range_max: 500_000 }, '£'),
    ).toBe('£200k to £500k');
  });

  it('normalises a [0,1] percentage range to 0–100 on both bounds', () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0.1, range_max: 0.25 }, '%'),
    ).toBe('10% to 25%');
  });

  it('renders single-sided ranges with "Up to" / "At least"', () => {
    expect(synthesiseRangeDisplayValue({ range_max: 500_000 }, '£')).toBe('Up to £500k');
    expect(synthesiseRangeDisplayValue({ range_min: 200_000 }, '£')).toBe('At least £200k');
  });

  it('formats a margin as percentage points on the same scale as analysis', () => {
    expect(formatPercentagePoints(24)).toBe('24 percentage points');
    // (0.62 − 0.38) × 100 → 24pp, computed from model-scale probabilities.
    expect(formatProbabilityMargin(0.62, 0.38)).toBe('24 percentage points');
  });
});

describe('value-scale readiness — flip proposals (display vs model scale)', () => {
  it('DISPLAY scale: keeps the value in user units, rounds the chip copy, stores the EXACT value', () => {
    const result = buildFlipProposal(
      {
        factor_id: 'f_priority',
        factor_label: 'Priority',
        flip_value: 6.055,
        unit: 'story_points',
        value_scale: 'display',
      },
      { cap: 10, unit: 'story_points' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Chip copy rounds to 1 d.p. and says "around" because rounding changed it.
    expect(result.proposal.label).toContain('around 6.1 story points');
    // Executed payload retains the EXACT (unrounded) user value — display ≠ executed,
    // and the divergence is signalled honestly by "around".
    expect(result.proposal.params).toEqual({ value: { value: 6.055, cap: 10 } });
  });

  it('MODEL scale: inverts via × cap to an exact whole user value (display === executed)', () => {
    // 0.5 × 10 = 5 exactly (0.5 is float-exact) → no rounding ambiguity.
    const result = buildFlipProposal(
      {
        factor_id: 'f_x',
        factor_label: 'Throughput',
        flip_value: 0.5,
        unit: null,
        value_scale: 'model',
      },
      { cap: 10, unit: null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.label).toContain('at 5');
    expect(result.proposal.params).toEqual({ value: { value: 5, cap: 10 } });
  });

  it('AMBIGUOUS scale fails closed: capped value > 1 with no value_scale signal', () => {
    const result = buildFlipProposal(
      {
        factor_id: 'f_y',
        factor_label: 'Latency',
        flip_value: 5,
        unit: null,
        value_scale: null,
      },
      { cap: 10, unit: null },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('ambiguous_scale');
  });

  it('DISPLAY formatter: 6.055 → "6.1 story points" with approximate flag', () => {
    expect(formatFactorValueApprox(6.055, 'story_points')).toEqual({
      display: '6.1 story points',
      rounded: 6.1,
      approximate: true,
    });
  });
});

describe('value-scale readiness — factor values changed through edit paths', () => {
  it('SET on a capped factor normalises user units → model: value = raw / cap', () => {
    expect(
      normaliseFactorValue({
        rawInput: 50_000,
        unit: '£',
        factorCap: 100_000,
        inputHasUnit: true,
      }),
    ).toEqual({ raw_value: 50_000, value: 0.5 });
  });

  it('SET on an uncapped factor keeps raw_value === value', () => {
    expect(
      normaliseFactorValue({ rawInput: 0.8, inputHasUnit: false }),
    ).toEqual({ raw_value: 0.8, value: 0.8 });
  });

  it('delta operators compute the same effectiveRaw the handler will', () => {
    expect(applyFactorValueOperator(5, 'increase', 3)).toBe(8);
    expect(applyFactorValueOperator(5, 'decrease', 3)).toBe(2);
    expect(applyFactorValueOperator(5, 'multiply', 3)).toBe(15);
  });

  it('round-trip: "increase 5% by 3" → normalised 0.08 AND confirmation shows "8%"', () => {
    // The handler applies the operator before normalisation; mirror that here.
    const effectiveRaw = applyFactorValueOperator(5, 'increase', 3); // 8
    const normalised = normaliseFactorValue({
      rawInput: effectiveRaw,
      unit: '%',
      factorCap: 100,
      inputHasUnit: true,
    });
    expect(normalised).toEqual({ raw_value: 8, value: 0.08 });
    const confirmation = formatFactorChange({
      label: 'Churn rate',
      before: { raw_value: 5, unit: '%' },
      after: { raw_value: effectiveRaw, unit: '%' },
    });
    // Confirmation display ("8%") is on the same user scale as raw_value (8).
    expect(confirmation).toBe('Updated Churn rate from 5% to 8%.');
  });

  it('confirmation copy stays scale-consistent for currency and counts', () => {
    expect(
      formatFactorChange({
        label: 'Budget',
        before: { raw_value: 50_000, unit: '£' },
        after: { raw_value: 120_000, unit: '£' },
      }),
    ).toBe('Updated Budget from £50,000 to £120,000.');
    expect(
      formatFactorChange({
        label: 'Team',
        before: { raw_value: 1, unit: 'engineers' },
        after: { raw_value: 6, unit: 'engineers' },
      }),
    ).toBe('Updated Team from 1 engineer to 6 engineers.');
  });
});

describe('value-scale readiness — negative values (current behaviour)', () => {
  it('[FINDING] negative currency in the approximate formatter puts "-" AFTER the symbol', () => {
    // Current behaviour: -50,000 → "£-50,000" (not "-£50,000"). Asserted to lock
    // it; a sign-position guard would be a separate, explicitly-scoped change.
    expect(formatFactorValueApprox(-50_000, '£')?.display).toBe('£-50,000');
  });

  it('negative percentage is rejected (guarded) rather than rendered', () => {
    expect(formatFactorValueApprox(-5, '%')).toBeNull();
  });

  it('negative "other" unit renders with a leading minus', () => {
    expect(formatFactorValueApprox(-5, 'engineers')?.display).toBe('-5 engineers');
  });
});
