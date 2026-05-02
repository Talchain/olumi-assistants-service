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
    expect(formatProbability(0.001)).toBe('0%');
    expect(formatProbability(0.05)).toBe('5%');
    expect(formatProbability(0.5)).toBe('50%');
    expect(formatProbability(0.62)).toBe('62%');
    expect(formatProbability(0.964)).toBe('96%');
    expect(formatProbability(0.999)).toBe('100%');
    expect(formatProbability(1)).toBe('100%');
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
