import { describe, it, expect } from 'vitest';
import { runEnforcementLints } from '../../../src/cee/validation-pipeline/enforcement-lints.js';
import type { Pass2EdgeEstimate } from '../../../src/cee/validation-pipeline/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEstimate(
  from: string,
  to: string,
  mean: number,
  std: number,
  ep: number,
  basis: Pass2EdgeEstimate['basis'] = 'domain_prior',
  needsUserInput = false,
  reasoning = 'some reasoning text',
): Pass2EdgeEstimate {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: ep,
    reasoning,
    basis,
    needs_user_input: needsUserInput,
  };
}

// ── Budget rescale ────────────────────────────────────────────────────────────

describe('LINT_BUDGET_RESCALE', () => {
  it('does not rescale when Σ|mean| <= 1.0 for a target node', () => {
    const edges = [
      makeEstimate('fac_a', 'out_y', 0.4, 0.1, 0.8),
      makeEstimate('fac_b', 'out_y', 0.5, 0.1, 0.8),
    ];
    const { edges: result, lintLog } = runEnforcementLints(edges);
    expect(result[0].strength.mean).toBeCloseTo(0.4);
    expect(result[1].strength.mean).toBeCloseTo(0.5);
    expect(lintLog.filter((l) => l.code === 'LINT_BUDGET_RESCALE')).toHaveLength(0);
  });

  it('rescales all means proportionally when Σ|mean| > 1.0', () => {
    // 0.6 + 0.7 = 1.3 → scale = 1/1.3 ≈ 0.769
    const edges = [
      makeEstimate('fac_a', 'out_y', 0.6, 0.1, 0.8),
      makeEstimate('fac_b', 'out_y', 0.7, 0.1, 0.8),
    ];
    const { edges: result, lintLog } = runEnforcementLints(edges);
    const scale = 1 / 1.3;
    expect(result[0].strength.mean).toBeCloseTo(0.6 * scale);
    expect(result[1].strength.mean).toBeCloseTo(0.7 * scale);
    const rescaleLints = lintLog.filter((l) => l.code === 'LINT_BUDGET_RESCALE');
    expect(rescaleLints).toHaveLength(2);
  });

  it('rescales per-target independently (two different targets)', () => {
    // out_y: 0.6 + 0.7 = 1.3 → rescale
    // goal_z: 0.3 → no rescale
    const edges = [
      makeEstimate('fac_a', 'out_y', 0.6, 0.1, 0.8),
      makeEstimate('fac_b', 'out_y', 0.7, 0.1, 0.8),
      makeEstimate('fac_c', 'goal_z', 0.3, 0.1, 0.8),
    ];
    const { edges: result, lintLog } = runEnforcementLints(edges);
    const scale = 1 / 1.3;
    expect(result[0].strength.mean).toBeCloseTo(0.6 * scale);
    expect(result[1].strength.mean).toBeCloseTo(0.7 * scale);
    expect(result[2].strength.mean).toBeCloseTo(0.3); // unchanged
    const rescaleLints = lintLog.filter((l) => l.code === 'LINT_BUDGET_RESCALE');
    expect(rescaleLints).toHaveLength(2); // only out_y edges
  });

  it('handles negative means (uses |mean| for sum check, rescales signed values)', () => {
    // -0.7 + 0.7 = |Σ|= 1.4 → rescale
    const edges = [
      makeEstimate('fac_a', 'out_y', -0.7, 0.1, 0.8),
      makeEstimate('fac_b', 'out_y', 0.7, 0.1, 0.8),
    ];
    const { edges: result, lintLog } = runEnforcementLints(edges);
    const scale = 1 / 1.4;
    expect(result[0].strength.mean).toBeCloseTo(-0.7 * scale);
    expect(result[1].strength.mean).toBeCloseTo(0.7 * scale);
    expect(lintLog.filter((l) => l.code === 'LINT_BUDGET_RESCALE')).toHaveLength(2);
  });

  it('does not mutate original input array', () => {
    const edges = [
      makeEstimate('fac_a', 'out_y', 0.6, 0.1, 0.8),
      makeEstimate('fac_b', 'out_y', 0.7, 0.1, 0.8),
    ];
    const originalMeans = edges.map((e) => e.strength.mean);
    runEnforcementLints(edges);
    expect(edges[0].strength.mean).toBe(originalMeans[0]);
    expect(edges[1].strength.mean).toBe(originalMeans[1]);
  });
});

// ── Std clamp ─────────────────────────────────────────────────────────────────

describe('LINT_STD_CLAMPED', () => {
  it('clamps std when std > |mean| (positive mean)', () => {
    // std = 0.5 > |mean| = 0.3 → std = 0.3 * 0.8 = 0.24
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.3, 0.5, 0.8),
    ]);
    expect(edges[0].strength.std).toBeCloseTo(0.24);
    expect(lintLog.some((l) => l.code === 'LINT_STD_CLAMPED')).toBe(true);
  });

  it('clamps std when std > |mean| (negative mean)', () => {
    // mean = -0.3, |mean| = 0.3 → std = 0.3 * 0.8 = 0.24
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', -0.3, 0.5, 0.8),
    ]);
    expect(edges[0].strength.std).toBeCloseTo(0.24);
    expect(lintLog.some((l) => l.code === 'LINT_STD_CLAMPED')).toBe(true);
  });

  it('does not clamp when std <= |mean|', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.5, 0.3, 0.8),
    ]);
    expect(edges[0].strength.std).toBeCloseTo(0.3);
    expect(lintLog.some((l) => l.code === 'LINT_STD_CLAMPED')).toBe(false);
  });

  it('skips std clamp when mean = 0 (avoids division by zero)', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.0, 0.5, 0.8),
    ]);
    expect(edges[0].strength.std).toBeCloseTo(0.5); // unchanged
    expect(lintLog.some((l) => l.code === 'LINT_STD_CLAMPED')).toBe(false);
  });
});

// ── EP cap (domain_prior) ─────────────────────────────────────────────────────

describe('LINT_EP_CAPPED_DOMAIN_PRIOR', () => {
  it('clamps ep > 0.95 for domain_prior basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.98, 'domain_prior'),
    ]);
    expect(edges[0].exists_probability).toBeCloseTo(0.95);
    expect(lintLog.some((l) => l.code === 'LINT_EP_CAPPED_DOMAIN_PRIOR')).toBe(true);
  });

  it('does not clamp ep <= 0.95 for domain_prior', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.95, 'domain_prior'),
    ]);
    expect(edges[0].exists_probability).toBeCloseTo(0.95);
    expect(lintLog.some((l) => l.code === 'LINT_EP_CAPPED_DOMAIN_PRIOR')).toBe(false);
  });

  it('does NOT clamp ep > 0.95 for brief_explicit basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.98, 'brief_explicit'),
    ]);
    expect(edges[0].exists_probability).toBeCloseTo(0.98);
    expect(lintLog.some((l) => l.code === 'LINT_EP_CAPPED_DOMAIN_PRIOR')).toBe(false);
  });

  it('does NOT clamp ep > 0.95 for structural_inference basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.97, 'structural_inference'),
    ]);
    expect(edges[0].exists_probability).toBeCloseTo(0.97);
    expect(lintLog.some((l) => l.code === 'LINT_EP_CAPPED_DOMAIN_PRIOR')).toBe(false);
  });
});

// ── EP cap (weak_guess) ───────────────────────────────────────────────────────

describe('LINT_EP_CAPPED_WEAK_GUESS', () => {
  it('clamps ep > 0.75 for weak_guess basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.2, 0.85, 'weak_guess', true),
    ]);
    expect(edges[0].exists_probability).toBeCloseTo(0.75);
    expect(lintLog.some((l) => l.code === 'LINT_EP_CAPPED_WEAK_GUESS')).toBe(true);
  });

  it('does not apply weak_guess EP cap for domain_prior basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.2, 0.85, 'domain_prior'),
    ]);
    // domain_prior cap is 0.95 so 0.85 is fine — no weak_guess cap
    expect(edges[0].exists_probability).toBeCloseTo(0.85);
    expect(lintLog.some((l) => l.code === 'LINT_EP_CAPPED_WEAK_GUESS')).toBe(false);
  });
});

// ── Std floor (weak_guess) ────────────────────────────────────────────────────

describe('LINT_STD_FLOORED_WEAK_GUESS', () => {
  it('floors std < 0.15 for weak_guess basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.08, 0.7, 'weak_guess', true),
    ]);
    expect(edges[0].strength.std).toBeCloseTo(0.15);
    expect(lintLog.some((l) => l.code === 'LINT_STD_FLOORED_WEAK_GUESS')).toBe(true);
  });

  it('does not floor std >= 0.15 for weak_guess', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.15, 0.7, 'weak_guess', true),
    ]);
    expect(edges[0].strength.std).toBeCloseTo(0.15); // unchanged
    expect(lintLog.some((l) => l.code === 'LINT_STD_FLOORED_WEAK_GUESS')).toBe(false);
  });

  it('does not floor std for non-weak_guess basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.08, 0.8, 'domain_prior'),
    ]);
    expect(edges[0].strength.std).toBeCloseTo(0.08); // unchanged
    expect(lintLog.some((l) => l.code === 'LINT_STD_FLOORED_WEAK_GUESS')).toBe(false);
  });
});

// ── NUI enforcement ───────────────────────────────────────────────────────────

describe('LINT_NUI_ENFORCED', () => {
  it('sets needs_user_input = true when basis=weak_guess and it was false', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.3, 0.2, 0.7, 'weak_guess', false),
    ]);
    expect(edges[0].needs_user_input).toBe(true);
    expect(lintLog.some((l) => l.code === 'LINT_NUI_ENFORCED')).toBe(true);
  });

  it('does not change needs_user_input when already true for weak_guess', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.3, 0.2, 0.7, 'weak_guess', true),
    ]);
    expect(edges[0].needs_user_input).toBe(true);
    expect(lintLog.some((l) => l.code === 'LINT_NUI_ENFORCED')).toBe(false);
  });

  it('does not enforce NUI for non-weak_guess basis', () => {
    const { edges, lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.5, 0.1, 0.8, 'domain_prior', false),
    ]);
    expect(edges[0].needs_user_input).toBe(false);
    expect(lintLog.some((l) => l.code === 'LINT_NUI_ENFORCED')).toBe(false);
  });
});

// ── Detection lints ───────────────────────────────────────────────────────────

describe('detection lints (WARN only)', () => {
  it('WARN_IDENTICAL_VALUES when all means are the same across multiple edges', () => {
    const { lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.8),
      makeEstimate('c', 'd', 0.4, 0.15, 0.75),
      makeEstimate('e', 'f', 0.4, 0.12, 0.85),
    ]);
    const warns = lintLog.filter((l) => l.code === 'WARN_IDENTICAL_VALUES');
    expect(warns).toHaveLength(3);
  });

  it('no WARN_IDENTICAL_VALUES when means differ', () => {
    const { lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.8),
      makeEstimate('c', 'd', 0.6, 0.1, 0.8),
    ]);
    expect(lintLog.some((l) => l.code === 'WARN_IDENTICAL_VALUES')).toBe(false);
  });

  it('WARN_CLUSTERED_EP when all EP values are within 0.05 of each other', () => {
    const { lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.80),
      makeEstimate('c', 'd', 0.6, 0.1, 0.82),
      makeEstimate('e', 'f', 0.5, 0.1, 0.83),
    ]);
    const warns = lintLog.filter((l) => l.code === 'WARN_CLUSTERED_EP');
    expect(warns).toHaveLength(3);
  });

  it('no WARN_CLUSTERED_EP when EP values are spread out', () => {
    const { lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.60),
      makeEstimate('c', 'd', 0.6, 0.1, 0.80),
    ]);
    expect(lintLog.some((l) => l.code === 'WARN_CLUSTERED_EP')).toBe(false);
  });

  it('WARN_EMPTY_REASONING for edges with empty reasoning string', () => {
    const { lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.8, 'domain_prior', false, ''),
    ]);
    expect(lintLog.some((l) => l.code === 'WARN_EMPTY_REASONING')).toBe(true);
  });

  it('no WARN_EMPTY_REASONING when reasoning is non-empty', () => {
    const { lintLog } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.8, 'domain_prior', false, 'explains the effect'),
    ]);
    expect(lintLog.some((l) => l.code === 'WARN_EMPTY_REASONING')).toBe(false);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty estimates list', () => {
    const { edges, lintLog } = runEnforcementLints([]);
    expect(edges).toHaveLength(0);
    expect(lintLog).toHaveLength(0);
  });

  it('sets lint_corrected=true on corrected edges, false on clean edges', () => {
    const { edges } = runEnforcementLints([
      makeEstimate('a', 'b', 0.4, 0.1, 0.8),   // clean
      makeEstimate('c', 'd', 0.4, 0.8, 0.8),    // std clamped (0.8 > 0.4)
    ]);
    expect(edges[0].lint_corrected).toBe(false);
    expect(edges[1].lint_corrected).toBe(true);
  });

  it('lintLog edge_key format is from->to', () => {
    const { lintLog } = runEnforcementLints([
      makeEstimate('fac_x', 'out_y', 0.3, 0.5, 0.98),
    ]);
    const entry = lintLog.find((l) => l.code === 'LINT_STD_CLAMPED');
    expect(entry?.edge_key).toBe('fac_x->out_y');
  });
});
