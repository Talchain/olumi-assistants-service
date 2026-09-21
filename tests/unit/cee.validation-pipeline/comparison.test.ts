import { describe, it, expect } from 'vitest';
import { compareEdge, buildMissingPass2Metadata } from '../../../src/cee/validation-pipeline/comparison.js';
import type { LintedPass2Estimate } from '../../../src/cee/validation-pipeline/types.js';
import type { EdgeV3T } from '../../../src/schemas/cee-v3.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeP1(mean: number, std: number, ep: number): EdgeV3T {
  return {
    from: 'a',
    to: 'b',
    strength: { mean, std },
    exists_probability: ep,
    effect_direction: mean >= 0 ? 'positive' : 'negative',
  } as unknown as EdgeV3T;
}

function makeP2(mean: number, std: number, ep: number): LintedPass2Estimate {
  return {
    from: 'a',
    to: 'b',
    strength: { mean, std },
    exists_probability: ep,
    reasoning: 'test reasoning',
    basis: 'domain_prior',
    needs_user_input: false,
    lint_corrected: false,
  };
}

function compare(
  p1Mean: number, p1Std: number, p1Ep: number,
  p2Mean: number, p2Std: number, p2Ep: number,
  distToGoal = 1,
) {
  const p1 = makeP1(p1Mean, p1Std, p1Ep);
  const p2Raw = makeP2(p2Mean, p2Std, p2Ep);
  const p2Adj = { ...p2Raw, strength: { ...p2Raw.strength } };
  return compareEdge(p1, p2Raw, p2Adj, [], distToGoal);
}

// ── Rule 1: Sign flip ─────────────────────────────────────────────────────────

describe('Rule 1: sign flip', () => {
  it('contested when pass1 mean is positive and pass2adj mean is negative', () => {
    const result = compare(0.4, 0.1, 0.8, -0.3, 0.1, 0.8);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('sign_flip');
    expect(result.sign_unstable).toBe(true);
  });

  it('contested when pass1 mean is negative and pass2adj mean is positive', () => {
    const result = compare(-0.4, 0.1, 0.8, 0.3, 0.1, 0.8);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('sign_flip');
  });

  it('not contested by sign flip when both means are positive', () => {
    const result = compare(0.4, 0.1, 0.8, 0.5, 0.1, 0.8);
    expect(result.contested_reasons).not.toContain('sign_flip');
  });

  it('not contested by sign flip when both means are negative', () => {
    const result = compare(-0.4, 0.1, 0.8, -0.5, 0.1, 0.8);
    expect(result.contested_reasons).not.toContain('sign_flip');
  });

  it('not triggered when either mean is 0', () => {
    const result = compare(0.4, 0.1, 0.8, 0, 0.1, 0.8);
    expect(result.contested_reasons).not.toContain('sign_flip');
  });
});

// ── Rule 2: Strength band change ──────────────────────────────────────────────

describe('Rule 2: strength band change', () => {
  it('contested when pass1 in weak core and pass2adj in moderate core', () => {
    // weak core: 0.10–0.25; moderate core: 0.30–0.55
    const result = compare(0.15, 0.1, 0.8, 0.40, 0.1, 0.8);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('strength_band_change');
  });

  it('contested when pass1 in moderate core and pass2adj in strong core', () => {
    // moderate core: 0.30–0.55; strong: >= 0.65
    const result = compare(0.45, 0.1, 0.8, 0.70, 0.1, 0.8);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('strength_band_change');
  });

  it('NOT contested when one value is in a buffer zone (0.25–0.30)', () => {
    // 0.22 is weak core, 0.27 is in buffer → no band change
    const result = compare(0.22, 0.1, 0.8, 0.27, 0.1, 0.8);
    expect(result.contested_reasons).not.toContain('strength_band_change');
  });

  it('NOT contested when one value is in buffer zone 0.55–0.65', () => {
    // 0.45 is moderate core, 0.58 is in buffer → no band change
    const result = compare(0.45, 0.1, 0.8, 0.58, 0.1, 0.8);
    expect(result.contested_reasons).not.toContain('strength_band_change');
  });

  it('NOT contested when both values in the same core band', () => {
    // Both in moderate core (0.30–0.55)
    const result = compare(0.35, 0.1, 0.8, 0.50, 0.1, 0.8);
    expect(result.contested_reasons).not.toContain('strength_band_change');
  });
});

// ── Rule 3: Confidence band change ───────────────────────────────────────────

describe('Rule 3: confidence band change', () => {
  it('contested when pass1 std in high core and pass2adj std in low core', () => {
    // high core: std < 0.08; low core: std >= 0.22
    const result = compare(0.4, 0.05, 0.8, 0.4, 0.25, 0.8);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('confidence_band_change');
  });

  it('contested when pass1 std in moderate core and pass2adj std in low core', () => {
    // moderate core: 0.12–0.18; low core: >= 0.22
    const result = compare(0.4, 0.14, 0.8, 0.4, 0.25, 0.8);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('confidence_band_change');
  });

  it('NOT contested when one std is in the buffer zone 0.08–0.12', () => {
    // 0.06 is high core; 0.10 is buffer → no confidence band change
    const result = compare(0.4, 0.06, 0.8, 0.4, 0.10, 0.8);
    expect(result.contested_reasons).not.toContain('confidence_band_change');
  });

  it('NOT contested when one std is in the buffer zone 0.18–0.22', () => {
    // 0.15 is moderate core; 0.20 is buffer → no band change
    const result = compare(0.4, 0.15, 0.8, 0.4, 0.20, 0.8);
    expect(result.contested_reasons).not.toContain('confidence_band_change');
  });

  it('NOT contested when both std in same core band (moderate)', () => {
    const result = compare(0.4, 0.13, 0.8, 0.4, 0.17, 0.8);
    expect(result.contested_reasons).not.toContain('confidence_band_change');
  });
});

// ── Rule 4: EP boundary crossing ─────────────────────────────────────────────

describe('Rule 4: EP boundary crossing', () => {
  it('contested when crossing 0.5 boundary', () => {
    const result = compare(0.4, 0.1, 0.45, 0.4, 0.1, 0.55);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('existence_boundary_crossing');
  });

  it('contested when crossing 0.70 boundary', () => {
    // EP boundaries: [0.5, 0.70, 0.93]
    const result = compare(0.4, 0.1, 0.65, 0.4, 0.1, 0.75);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('existence_boundary_crossing');
  });

  it('contested when crossing 0.93 boundary', () => {
    const result = compare(0.4, 0.1, 0.90, 0.4, 0.1, 0.95);
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('existence_boundary_crossing');
  });

  it('NOT contested when both EP values are on the same side of all boundaries', () => {
    // Both between 0.70 and 0.93
    const result = compare(0.4, 0.1, 0.72, 0.4, 0.1, 0.88);
    expect(result.contested_reasons).not.toContain('existence_boundary_crossing');
  });

  it('EP boundary is 0.70, not 0.75 (v1.4.1 revert)', () => {
    // 0.68 < 0.70, 0.72 >= 0.70 → crossing; would not cross if boundary were 0.75
    const result = compare(0.4, 0.1, 0.68, 0.4, 0.1, 0.72);
    expect(result.contested_reasons).toContain('existence_boundary_crossing');
  });
});

// ── Rule 5: Raw magnitude catch-all ──────────────────────────────────────────

describe('Rule 5: raw magnitude catch-all', () => {
  it('contested by raw_magnitude when |Δmean| > 0.20 and no other rule fires', () => {
    // Both in moderate core, same sign, same ep region — only raw delta applies
    const result = compare(0.30, 0.14, 0.72, 0.52, 0.15, 0.74);
    // No sign flip, same band (moderate), same std band (moderate), same EP side
    // Δmean = |0.30 - 0.52| = 0.22 > 0.20
    expect(result.status).toBe('contested');
    expect(result.contested_reasons).toContain('raw_magnitude');
  });

  it('NOT contested by raw_magnitude when |Δmean| <= 0.20', () => {
    const result = compare(0.35, 0.14, 0.72, 0.45, 0.15, 0.74);
    // Δmean = 0.10, same band (moderate), no boundary crossing
    expect(result.contested_reasons).not.toContain('raw_magnitude');
    expect(result.status).toBe('agreed');
  });

  it('raw_magnitude is NOT added when another rule already fired', () => {
    // sign flip fires first; raw_magnitude should NOT be added as a duplicate
    const result = compare(0.4, 0.1, 0.8, -0.4, 0.1, 0.8);
    // |Δmean| = 0.8 > 0.20, but sign_flip already fired
    expect(result.contested_reasons).toContain('sign_flip');
    expect(result.contested_reasons).not.toContain('raw_magnitude');
  });
});

// ── Max divergence score ──────────────────────────────────────────────────────

describe('max_divergence', () => {
  it('is 1.0 for sign flip', () => {
    const result = compare(0.5, 0.1, 0.8, -0.5, 0.1, 0.8);
    expect(result.max_divergence).toBeCloseTo(1.0);
  });

  it('is 0 for fully agreed edges', () => {
    // Identical parameters → all scores are 0
    const result = compare(0.4, 0.14, 0.72, 0.4, 0.14, 0.72);
    expect(result.max_divergence).toBe(0);
  });

  it('band score: weak vs strong = 2/3 ≈ 0.667', () => {
    // weak (0.15) vs strong (0.70): band distance = 2 (steps = 3)
    const result = compare(0.15, 0.1, 0.72, 0.70, 0.1, 0.72);
    expect(result.max_divergence).toBeGreaterThanOrEqual(2 / 3 - 0.01);
  });

  it('ep score: two boundaries crossed = 2/3', () => {
    // 0.45 < 0.5 and 0.85 crosses 0.5 and 0.70 but not 0.93 → 2 boundaries
    const result = compare(0.4, 0.14, 0.45, 0.4, 0.14, 0.85);
    // ep_score = 2/3 ≈ 0.667; raw_score = 0; band score = 0
    expect(result.max_divergence).toBeCloseTo(2 / 3, 2);
  });

  it('raw score: |Δmean|=0.25, divisor=0.5 → raw_score=0.5', () => {
    // Both in same moderate band, no EP crossing, same sign
    const result = compare(0.30, 0.14, 0.72, 0.55, 0.15, 0.74);
    // |Δ| = 0.25, raw_score = min(1, 0.25/0.5) = 0.5
    // 0.30 is moderate, 0.55 is in buffer 0.55–0.65 → band=null → no band score
    expect(result.max_divergence).toBeCloseTo(0.5, 2);
  });
});

// ── ValidationMetadata fields ─────────────────────────────────────────────────

describe('ValidationMetadata field correctness', () => {
  it('initial user interaction fields are set to defaults', () => {
    const result = compare(0.4, 0.1, 0.8, 0.4, 0.1, 0.8);
    expect(result.was_shown).toBe(false);
    expect(result.user_action).toBe('pending');
    expect(result.resolved_value).toBeNull();
    expect(result.resolved_by).toBe('default');
  });

  it('evoi fields are null', () => {
    const result = compare(0.4, 0.1, 0.8, 0.4, 0.1, 0.8);
    expect(result.evoi_rank).toBeNull();
    expect(result.evoi_impact).toBeNull();
  });

  it('pass2_missing is false on normal comparison', () => {
    const result = compare(0.4, 0.1, 0.8, 0.4, 0.1, 0.8);
    expect(result.pass2_missing).toBe(false);
  });

  it('distance_to_goal is set from parameter', () => {
    const result = compare(0.4, 0.1, 0.8, 0.4, 0.1, 0.8, 3);
    expect(result.distance_to_goal).toBe(3);
  });

  it('pass1 values are captured correctly', () => {
    const result = compare(0.42, 0.11, 0.77, 0.40, 0.10, 0.75);
    expect(result.pass1.strength_mean).toBeCloseTo(0.42);
    expect(result.pass1.strength_std).toBeCloseTo(0.11);
    expect(result.pass1.exists_probability).toBeCloseTo(0.77);
  });
});

// ── buildMissingPass2Metadata ─────────────────────────────────────────────────

describe('buildMissingPass2Metadata', () => {
  it('status is always agreed', () => {
    const p1 = makeP1(0.4, 0.1, 0.8);
    const result = buildMissingPass2Metadata(p1, 2);
    expect(result.status).toBe('agreed');
  });

  it('pass2_missing is true', () => {
    const p1 = makeP1(0.4, 0.1, 0.8);
    const result = buildMissingPass2Metadata(p1, 2);
    expect(result.pass2_missing).toBe(true);
  });

  it('contested_reasons is empty', () => {
    const p1 = makeP1(0.4, 0.1, 0.8);
    const result = buildMissingPass2Metadata(p1, 2);
    expect(result.contested_reasons).toHaveLength(0);
  });

  it('distance_to_goal is set from parameter', () => {
    const p1 = makeP1(0.4, 0.1, 0.8);
    const result = buildMissingPass2Metadata(p1, 5);
    expect(result.distance_to_goal).toBe(5);
  });

  it('pass1 values are captured from edge', () => {
    const p1 = makeP1(0.35, 0.12, 0.72);
    const result = buildMissingPass2Metadata(p1, 1);
    expect(result.pass1.strength_mean).toBeCloseTo(0.35);
    expect(result.pass1.strength_std).toBeCloseTo(0.12);
    expect(result.pass1.exists_probability).toBeCloseTo(0.72);
  });
});
