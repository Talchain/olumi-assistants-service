import { describe, it, expect } from 'vitest';
import { computeBiasOffsets, applyBiasCorrection } from '../../../src/cee/validation-pipeline/bias-correction.js';
import type { LintedPass2Estimate } from '../../../src/cee/validation-pipeline/types.js';
import type { EdgeV3T } from '../../../src/schemas/cee-v3.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeP1(from: string, to: string, mean: number, std: number, ep: number): EdgeV3T {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: ep,
    effect_direction: mean >= 0 ? 'positive' : 'negative',
  } as unknown as EdgeV3T;
}

function makeP2(
  from: string,
  to: string,
  mean: number,
  std: number,
  ep: number,
): LintedPass2Estimate {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: ep,
    reasoning: 'test',
    basis: 'domain_prior',
    needs_user_input: false,
    lint_corrected: false,
  };
}

// ── computeBiasOffsets ────────────────────────────────────────────────────────

describe('computeBiasOffsets', () => {
  it('returns zero offsets when there are no matched edges', () => {
    const { offsets } = computeBiasOffsets([], []);
    expect(offsets.strength_mean).toBe(0);
    expect(offsets.strength_std).toBe(0);
    expect(offsets.exists_probability).toBe(0);
  });

  it('returns correct median offset for a single matched edge', () => {
    // Pass 1: mean=0.5, std=0.1, ep=0.8
    // Pass 2: mean=0.4, std=0.12, ep=0.75
    // offsets: mean=0.1, std=-0.02, ep=0.05
    const p1 = [makeP1('a', 'b', 0.5, 0.1, 0.8)];
    const p2 = [makeP2('a', 'b', 0.4, 0.12, 0.75)];
    const { offsets } = computeBiasOffsets(p1, p2);
    expect(offsets.strength_mean).toBeCloseTo(0.1);
    expect(offsets.strength_std).toBeCloseTo(-0.02);
    expect(offsets.exists_probability).toBeCloseTo(0.05);
  });

  it('computes median over multiple edges (odd count)', () => {
    // mean deltas: 0.1, 0.2, 0.3 → median = 0.2
    const p1 = [
      makeP1('a', 'b', 0.5, 0.1, 0.8),
      makeP1('c', 'd', 0.6, 0.1, 0.8),
      makeP1('e', 'f', 0.7, 0.1, 0.8),
    ];
    const p2 = [
      makeP2('a', 'b', 0.4, 0.1, 0.8),
      makeP2('c', 'd', 0.4, 0.1, 0.8),
      makeP2('e', 'f', 0.4, 0.1, 0.8),
    ];
    // Pass 1 means: 0.5, 0.6, 0.7
    // Pass 2 means: 0.4, 0.4, 0.4
    // deltas: 0.1, 0.2, 0.3 → median = 0.2
    const { offsets } = computeBiasOffsets(p1, p2);
    expect(offsets.strength_mean).toBeCloseTo(0.2);
  });

  it('computes median over multiple edges (even count)', () => {
    // mean deltas: 0.1, 0.3 → median = (0.1 + 0.3) / 2 = 0.2
    const p1 = [
      makeP1('a', 'b', 0.5, 0.1, 0.8),
      makeP1('c', 'd', 0.7, 0.1, 0.8),
    ];
    const p2 = [
      makeP2('a', 'b', 0.4, 0.1, 0.8),
      makeP2('c', 'd', 0.4, 0.1, 0.8),
    ];
    const { offsets } = computeBiasOffsets(p1, p2);
    expect(offsets.strength_mean).toBeCloseTo(0.2);
  });

  it('skips Pass 1 edges with no Pass 2 match', () => {
    // Only 'a'->'b' matched; 'c'->'d' is in p1 only
    const p1 = [makeP1('a', 'b', 0.5, 0.1, 0.8), makeP1('c', 'd', 0.5, 0.1, 0.8)];
    const p2 = [makeP2('a', 'b', 0.4, 0.1, 0.8)]; // only one match
    const { offsets } = computeBiasOffsets(p1, p2);
    expect(offsets.strength_mean).toBeCloseTo(0.1); // only the matched edge
  });

  it('discards extreme mean offset and emits warning', () => {
    // delta = 0.5 − (−0.1) = 0.6 > 0.3 (limit)
    const p1 = [makeP1('a', 'b', 0.5, 0.1, 0.8)];
    const p2 = [makeP2('a', 'b', -0.1, 0.1, 0.8)];
    const { offsets, warnings } = computeBiasOffsets(p1, p2);
    expect(offsets.strength_mean).toBe(0);
    expect(warnings.some((w) => w.includes('WARN_EXTREME_BIAS_OFFSET'))).toBe(true);
    expect(warnings.some((w) => w.includes('strength_mean'))).toBe(true);
  });

  it('discards extreme ep offset and emits warning', () => {
    // delta = 0.9 − 0.5 = 0.4 > 0.3
    const p1 = [makeP1('a', 'b', 0.5, 0.1, 0.9)];
    const p2 = [makeP2('a', 'b', 0.5, 0.1, 0.5)];
    const { offsets, warnings } = computeBiasOffsets(p1, p2);
    expect(offsets.exists_probability).toBe(0);
    expect(warnings.some((w) => w.includes('exists_probability'))).toBe(true);
  });
});

// ── applyBiasCorrection ───────────────────────────────────────────────────────

describe('applyBiasCorrection', () => {
  it('applies offsets to all three parameters', () => {
    const p2 = [makeP2('a', 'b', 0.4, 0.1, 0.7)];
    const offsets = { strength_mean: 0.1, strength_std: -0.02, exists_probability: 0.05 };
    const result = applyBiasCorrection(p2, offsets);
    expect(result[0].strength.mean).toBeCloseTo(0.5);
    expect(result[0].strength.std).toBeCloseTo(0.08);
    expect(result[0].exists_probability).toBeCloseTo(0.75);
  });

  it('clamps ep to [0, 1] after correction', () => {
    const p2 = [makeP2('a', 'b', 0.4, 0.1, 0.95)];
    const offsets = { strength_mean: 0, strength_std: 0, exists_probability: 0.1 };
    const result = applyBiasCorrection(p2, offsets);
    expect(result[0].exists_probability).toBe(1.0);
  });

  it('clamps ep to 0 when offset pushes below 0', () => {
    const p2 = [makeP2('a', 'b', 0.4, 0.1, 0.05)];
    const offsets = { strength_mean: 0, strength_std: 0, exists_probability: -0.1 };
    const result = applyBiasCorrection(p2, offsets);
    expect(result[0].exists_probability).toBe(0.0);
  });

  it('clamps std to 0 when offset pushes below 0', () => {
    const p2 = [makeP2('a', 'b', 0.4, 0.05, 0.8)];
    const offsets = { strength_mean: 0, strength_std: -0.1, exists_probability: 0 };
    const result = applyBiasCorrection(p2, offsets);
    expect(result[0].strength.std).toBe(0);
  });

  it('does not mutate original input estimates', () => {
    const p2 = [makeP2('a', 'b', 0.4, 0.1, 0.7)];
    const offsets = { strength_mean: 0.1, strength_std: 0, exists_probability: 0 };
    applyBiasCorrection(p2, offsets);
    expect(p2[0].strength.mean).toBe(0.4); // unchanged
  });

  it('handles zero offsets (no-op)', () => {
    const p2 = [makeP2('a', 'b', 0.4, 0.1, 0.7)];
    const offsets = { strength_mean: 0, strength_std: 0, exists_probability: 0 };
    const result = applyBiasCorrection(p2, offsets);
    expect(result[0].strength.mean).toBeCloseTo(0.4);
    expect(result[0].strength.std).toBeCloseTo(0.1);
    expect(result[0].exists_probability).toBeCloseTo(0.7);
  });
});
