/**
 * Wave 4 — boundary tests for formatSensitivityDirection and
 * formatEdgeStrengthMagnitude.
 *
 * Pins the bucketing thresholds (0.02 / 0.1 / 0.3 / 0.6 for direction;
 * 0.1 / 0.3 / 0.6 for magnitude) and the sign-to-direction mapping
 * (positive = strengthens the lead, negative = weakens). Pre-fix the
 * raw decimal `-0.7346...` was passed through to user prose; post-fix
 * the user only ever sees calm bucketed phrasing.
 */

import { describe, expect, it } from 'vitest';
import {
  formatSensitivityDirection,
  formatEdgeStrengthMagnitude,
} from '../explanation-fallback.js';

describe('formatSensitivityDirection', () => {
  it.each([
    [0, 'has little effect on the result'],
    [0.01, 'has little effect on the result'],
    [-0.01, 'has little effect on the result'],
    [0.019, 'has little effect on the result'],
    [0.02, 'slightly strengthens the lead'],
    [-0.02, 'slightly weakens the lead'],
    [0.05, 'slightly strengthens the lead'],
    [-0.05, 'slightly weakens the lead'],
    [0.099, 'slightly strengthens the lead'],
    [0.1, 'moderately strengthens the lead'],
    [-0.1, 'moderately weakens the lead'],
    [0.25, 'moderately strengthens the lead'],
    [0.299, 'moderately strengthens the lead'],
    [0.3, 'strongly strengthens the lead'],
    [-0.3, 'strongly weakens the lead'],
    [0.5, 'strongly strengthens the lead'],
    [0.599, 'strongly strengthens the lead'],
    [0.6, 'very strongly strengthens the lead'],
    [-0.6, 'very strongly weakens the lead'],
    [1.0, 'very strongly strengthens the lead'],
    [-0.7346938775510203, 'very strongly weakens the lead'], // the brief's evidence #4
  ])('value=%s → %s', (value, expected) => {
    expect(formatSensitivityDirection(value)).toBe(expected);
  });

  it('output never contains a raw decimal', () => {
    for (const v of [-0.7346, 0.123, -0.5, 0.6789, -1.23456]) {
      const out = formatSensitivityDirection(v);
      expect(out).not.toMatch(/-?\d+\.\d/);
    }
  });
});

describe('formatEdgeStrengthMagnitude', () => {
  it.each([
    [0, 'weak'],
    [0.05, 'weak'],
    [-0.099, 'weak'],
    [0.1, 'moderate'],
    [-0.1, 'moderate'],
    [0.25, 'moderate'],
    [0.3, 'strong'],
    [-0.5, 'strong'],
    [0.6, 'very strong'],
    [-0.99, 'very strong'],
    [1.0, 'very strong'],
  ])('value=%s → %s', (value, expected) => {
    expect(formatEdgeStrengthMagnitude(value)).toBe(expected);
  });

  it('output never contains a raw decimal', () => {
    for (const v of [-0.7346, 0.123, 0.6789]) {
      const out = formatEdgeStrengthMagnitude(v);
      expect(out).not.toMatch(/-?\d+\.\d/);
    }
  });
});
