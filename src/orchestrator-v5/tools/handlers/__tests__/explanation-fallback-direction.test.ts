/**
 * Wave 5H — boundary tests for formatSensitivityDirection and
 * formatEdgeStrengthMagnitude after the alignment to the canonical
 * `bandFromMagnitude` thresholds and vocabulary.
 *
 * Wave 4 introduced these helpers with their own bucket boundaries
 * (0.02 / 0.1 / 0.3 / 0.6) and an adverb form ("moderately strengthens
 * the lead"). The display-safe projection in
 * `format-analysis-for-context.ts` was already using `bandFromMagnitude`
 * (0.3 / 0.7 / 0.95, NEAR_ZERO 0.05) with adjective vocabulary
 * (`weak | moderate | strong | very strong`). That mismatch meant for
 * the SAME sensitivity coefficient (e.g. 0.5) Sonnet's context pack saw
 * "moderate positive influence" while the deterministic fallback emitted
 * "strongly strengthens the lead".
 *
 * Wave 5H replaces the helpers with thin wrappers over `bandFromMagnitude`
 * so band boundaries and vocabulary cannot drift. This file pins the new
 * thresholds and vocabulary, and asserts the no-raw-decimal egress
 * invariant survives the rewrite.
 */

import { describe, expect, it } from 'vitest';
import {
  formatSensitivityDirection,
  formatEdgeStrengthMagnitude,
} from '../explanation-fallback.js';

describe('formatSensitivityDirection', () => {
  it.each([
    // Near-zero short-circuit (|v| < 0.05).
    [0, 'has no material influence'],
    [0.01, 'has no material influence'],
    [-0.01, 'has no material influence'],
    [0.049, 'has no material influence'],
    [-0.049, 'has no material influence'],
    // Weak band: [0.05, 0.3).
    [0.05, 'has a weak positive influence'],
    [-0.05, 'has a weak negative influence'],
    [0.1, 'has a weak positive influence'],
    [0.2, 'has a weak positive influence'],
    [0.299, 'has a weak positive influence'],
    // Moderate band: [0.3, 0.7).
    [0.3, 'has a moderate positive influence'],
    [-0.3, 'has a moderate negative influence'],
    [0.5, 'has a moderate positive influence'],
    [0.699, 'has a moderate positive influence'],
    // Strong band: [0.7, 0.95).
    [0.7, 'has a strong positive influence'],
    [-0.7, 'has a strong negative influence'],
    [0.9, 'has a strong positive influence'],
    [0.949, 'has a strong positive influence'],
    // Very strong band: [0.95, ∞).
    [0.95, 'has a very strong positive influence'],
    [-0.95, 'has a very strong negative influence'],
    [1.0, 'has a very strong positive influence'],
    // The brief's evidence #4 raw value: must surface as bucketed prose.
    [-0.7346938775510203, 'has a strong negative influence'],
  ])('value=%s → %s', (value, expected) => {
    expect(formatSensitivityDirection(value)).toBe(expected);
  });

  it('non-finite input is treated as no material influence (does not throw)', () => {
    expect(formatSensitivityDirection(Number.NaN)).toBe('has no material influence');
    expect(formatSensitivityDirection(Number.POSITIVE_INFINITY)).toBe(
      'has no material influence',
    );
    expect(formatSensitivityDirection(Number.NEGATIVE_INFINITY)).toBe(
      'has no material influence',
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
