/**
 * Boundary tests for `formatSensitivityDirection` and
 * `formatEdgeStrengthMagnitude`.
 *
 * The fallback helper restores the leading-option frame ("Cost
 * moderately weakens the lead") rather than the noun-phrase form
 * ("Cost has a moderate negative influence") so the deterministic
 * prose stays direct about WHAT the influence is on. Thresholds still
 * delegate to the canonical `bandFromMagnitude` so the bucket
 * boundaries cannot drift between this fallback and the upstream
 * display-safe projection.
 *
 * Vocabulary (adverb form):
 *   |v| < 0.05         → "has little effect on the lead"
 *   |v| in [0.05, 0.3) → "slightly strengthens|weakens the lead"
 *   |v| in [0.3, 0.7)  → "moderately ..."
 *   |v| in [0.7, 0.95) → "strongly ..."
 *   |v| ≥ 0.95         → "very strongly ..."
 *
 * The lowest band uses "slightly" rather than "weakly" because
 * "weakly weakens" reads awkwardly. The other bands compose naturally
 * with `weakens` / `strengthens`.
 */

import { describe, expect, it } from 'vitest';
import {
  formatSensitivityDirection,
  formatEdgeStrengthMagnitude,
} from '../explanation-fallback.js';

describe('formatSensitivityDirection', () => {
  it.each([
    // Near-zero short-circuit (|v| < 0.05).
    [0, 'has little effect on the lead'],
    [0.01, 'has little effect on the lead'],
    [-0.01, 'has little effect on the lead'],
    [0.049, 'has little effect on the lead'],
    [-0.049, 'has little effect on the lead'],
    // Weak band: [0.05, 0.3) — "slightly" to avoid "weakly weakens".
    [0.05, 'slightly strengthens the lead'],
    [-0.05, 'slightly weakens the lead'],
    [0.1, 'slightly strengthens the lead'],
    [0.2, 'slightly strengthens the lead'],
    [0.299, 'slightly strengthens the lead'],
    // Moderate band: [0.3, 0.7).
    [0.3, 'moderately strengthens the lead'],
    [-0.3, 'moderately weakens the lead'],
    [0.5, 'moderately strengthens the lead'],
    [0.699, 'moderately strengthens the lead'],
    // Strong band: [0.7, 0.95).
    [0.7, 'strongly strengthens the lead'],
    [-0.7, 'strongly weakens the lead'],
    [0.9, 'strongly strengthens the lead'],
    [0.949, 'strongly strengthens the lead'],
    // Very strong band: [0.95, ∞).
    [0.95, 'very strongly strengthens the lead'],
    [-0.95, 'very strongly weakens the lead'],
    [1.0, 'very strongly strengthens the lead'],
    // The brief's evidence #4 raw value: must surface as bucketed prose.
    [-0.7346938775510203, 'strongly weakens the lead'],
  ])('value=%s → %s', (value, expected) => {
    expect(formatSensitivityDirection(value)).toBe(expected);
  });

  it('non-finite input is treated as no material influence (does not throw)', () => {
    expect(formatSensitivityDirection(Number.NaN)).toBe('has little effect on the lead');
    expect(formatSensitivityDirection(Number.POSITIVE_INFINITY)).toBe(
      'has little effect on the lead',
    );
    expect(formatSensitivityDirection(Number.NEGATIVE_INFINITY)).toBe(
      'has little effect on the lead',
    );
  });

  it('output never contains a raw decimal (no-decimal egress invariant)', () => {
    for (const v of [-0.7346, 0.123, -0.5, 0.6789, -1.23456, 0.4, -0.96]) {
      const out = formatSensitivityDirection(v);
      expect(out).not.toMatch(/-?\d+\.\d/);
    }
  });
});

describe('formatEdgeStrengthMagnitude', () => {
  it.each([
    // Weak band: |v| < 0.3.
    [0, 'weak'],
    [0.05, 'weak'],
    [-0.099, 'weak'],
    [0.1, 'weak'],
    [0.25, 'weak'],
    [0.299, 'weak'],
    // Moderate band: [0.3, 0.7).
    [0.3, 'moderate'],
    [-0.3, 'moderate'],
    [0.5, 'moderate'],
    [0.699, 'moderate'],
    // Strong band: [0.7, 0.95).
    [0.7, 'strong'],
    [-0.7, 'strong'],
    [0.85, 'strong'],
    [0.949, 'strong'],
    // Very strong band: [0.95, ∞).
    [0.95, 'very strong'],
    [-0.95, 'very strong'],
    [1.0, 'very strong'],
  ])('value=%s → %s', (value, expected) => {
    expect(formatEdgeStrengthMagnitude(value)).toBe(expected);
  });

  it('non-finite input falls back to weak (does not throw)', () => {
    expect(formatEdgeStrengthMagnitude(Number.NaN)).toBe('weak');
    expect(formatEdgeStrengthMagnitude(Number.POSITIVE_INFINITY)).toBe('weak');
  });

  it('output never contains a raw decimal', () => {
    for (const v of [-0.7346, 0.123, 0.6789, 0.4, -0.96]) {
      const out = formatEdgeStrengthMagnitude(v);
      expect(out).not.toMatch(/-?\d+\.\d/);
    }
  });
});
