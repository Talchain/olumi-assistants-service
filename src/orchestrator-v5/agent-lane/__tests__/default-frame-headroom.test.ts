/**
 * ⭐ OLUMI'S DEFAULT FRAME LEAVES HEADROOM (AIQ #72 5868446435).
 *
 * The frame Olumi chooses for a figure sits STRICTLY above it. A figure at exactly
 * 1.0 of its frame has its downstream values clipped one-sided in ISL, and a limit
 * on it lands on the frame edge (PLoT refuses thresholds outside the frame). So an
 * exact power of ten takes the next step up: £100,000 → 0–1,000,000 (0.1), never
 * 0–100,000 (1.0). A frame the user stated is never moved — this only chooses
 * Olumi's default.
 */

import { describe, it, expect } from 'vitest';
import { admitCandidateModel, defaultFrameFor, type CandidateModel } from '../admit-model.js';

describe('defaultFrameFor — headroom above the figure it carries', () => {
  it('£100,000 → a frame of 1,000,000, so the value is 0.1, never 1.0', () => {
    expect(defaultFrameFor(100_000)).toBe(1_000_000);
    expect(100_000 / defaultFrameFor(100_000)).toBeCloseTo(0.1, 12);
    expect(100_000 / defaultFrameFor(100_000)).toBeLessThan(1);
  });

  it('£120,000 → 1,000,000 (0.12), unchanged', () => {
    expect(defaultFrameFor(120_000)).toBe(1_000_000);
    expect(120_000 / defaultFrameFor(120_000)).toBeCloseTo(0.12, 12);
  });

  it('£65,000 → 100,000 (0.65), unchanged', () => {
    expect(defaultFrameFor(65_000)).toBe(100_000);
    expect(65_000 / defaultFrameFor(65_000)).toBeCloseTo(0.65, 12);
  });

  it('every exact power of ten takes the next step up', () => {
    expect(defaultFrameFor(10_000)).toBe(100_000);
    expect(10_000 / defaultFrameFor(10_000)).toBeCloseTo(0.1, 12);
    expect(defaultFrameFor(1_000_000)).toBe(10_000_000);
    expect(1_000_000 / defaultFrameFor(1_000_000)).toBeCloseTo(0.1, 12);
    // By magnitude, so a negative power of ten steps up too.
    expect(defaultFrameFor(-100_000)).toBe(1_000_000);
  });

  it('is strictly above |figure| across powers of ten and their neighbours', () => {
    const figures = [1.5, 9.99, 10, 10.01, 99, 100, 101, 999.9999999, 1000, 1001, 1e4, 1e5, 1e6 - 1, 1e6, 1e6 + 1, 1e7, 1e9, 1e12];
    for (const x of figures) {
      const frame = defaultFrameFor(x);
      expect(frame, `frame for ${x}`).toBeGreaterThan(x);
      // …and still the SMALLEST such power of ten: one step down would not hold it strictly.
      expect(frame / 10, `frame for ${x} is one step too wide`).toBeLessThanOrEqual(x);
    }
  });

  it('keeps zero, negative, non-finite and unit-interval handling exactly as before', () => {
    expect(defaultFrameFor(0)).toBe(1);
    expect(defaultFrameFor(0.7)).toBe(1);
    expect(defaultFrameFor(1)).toBe(1);
    expect(defaultFrameFor(Number.NaN)).toBe(1);
    expect(defaultFrameFor(Number.POSITIVE_INFINITY)).toBe(1);
    // A negative figure is framed by its magnitude, as before.
    expect(defaultFrameFor(-65_000)).toBe(100_000);
  });
});

/** A figure the brief states with no range: Olumi derives the frame at admission. */
function candidate(plausibleMax: number | undefined): CandidateModel {
  return {
    goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 2_000_000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hold spend', provenance: 'explicit', interventions: [{ factor_label: 'Marketing spend', value: 100_000, unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Cut spend', provenance: 'explicit', interventions: [{ factor_label: 'Marketing spend', value: 80_000, unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Marketing spend', role: 'controllable', baseline_known: true, baseline_value: 100_000, unit: 'GBP',
        ...(plausibleMax !== undefined ? { plausible_max: plausibleMax } : {}), provenance: 'explicit' },
    ],
    risks: [],
    outcomes: [],
    links: [
      { from: 'Hold spend', to: 'Marketing spend', direction: 'positive', provenance: 'explicit' },
      { from: 'Cut spend', to: 'Marketing spend', direction: 'positive', provenance: 'explicit' },
      { from: 'Marketing spend', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' },
    ],
    unknowns: [],
  } as unknown as CandidateModel;
}

function observedStateOf(model: CandidateModel, label: string): Record<string, unknown> {
  const a = admitCandidateModel(model);
  const n = a.nodes.find((x) => x.label === label);
  expect(n, `no admitted node "${label}"`).toBeDefined();
  const os = (n as { node?: { observed_state?: Record<string, unknown> } }).node?.observed_state
    ?? (n as unknown as { observed_state?: Record<string, unknown> }).observed_state;
  expect(os, JSON.stringify(n)).toBeDefined();
  return os!;
}

describe('admission — the defaulted frame leaves headroom; a stated frame is never moved', () => {
  it('a £100,000 baseline with no stated range is read on 0–1,000,000 (0.1)', () => {
    const os = observedStateOf(candidate(undefined), 'Marketing spend');
    expect(os.cap).toBe(1_000_000);
    expect(os.raw_value).toBe(100_000);
    expect(os.value).toBeCloseTo(0.1, 12);
  });

  it('a stated range of 100,000 stays 100,000 — the headroom rule never moves it', () => {
    const os = observedStateOf(candidate(100_000), 'Marketing spend');
    expect(os.cap).toBe(100_000);
    expect(os.raw_value).toBe(100_000);
    expect(os.value).toBe(1);
  });
});
