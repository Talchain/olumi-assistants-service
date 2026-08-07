/**
 * T2 — THE ARITHMETIC, pinned by KNOWN ANSWERS.
 *
 * ROADMAP 2.688 slice 1. Every expectation here is derived from the
 * MATHEMATICS (the producer's semantics — CLAUDE.md trap 13c), computed
 * independently of the implementation under test before it was written, and
 * cross-checked against closed forms that need no numerical routine at all:
 *
 *   - `I_x(1, 1) = x` exactly (Beta(1,1) is Uniform), so the CDF and both
 *     quantiles have closed forms this suite asserts directly. That is the
 *     one fixture that cannot be wrong.
 *   - Beta(a, a) is symmetric about 1/2, so `q25 + q75 === 1` and the median
 *     is exactly 1/2 — a structural property, not a copied constant.
 *   - The posterior MEAN is `alpha / (alpha + beta)` in closed form, so
 *     every mean below is checked against arithmetic, not against a table.
 *
 * ⭐ THE PRIOR IS PINNED BY A DISCRIMINATING MUTANT PAIR (trap 19). `M1`
 * (1,1 -> 0,0, raw MLE) must RED here on the K=0 edge; `M2` (1,1 -> 0.5,0.5,
 * Jeffreys) must ALSO RED here, on the means, while the grammar and refusal
 * suites stay GREEN. M1 alone would only prove "some prior is applied" — M2
 * is what proves this suite pins the NAMED prior.
 */
import { describe, it, expect } from 'vitest';

import {
  PRIOR_ALPHA,
  PRIOR_BETA,
  RATIFIED_COVERAGE,
  betaQuantile,
  deriveReferenceClassPosterior,
  formatPosteriorPercent,
  regularizedIncompleteBeta,
} from '../beta-posterior.js';

describe('regularizedIncompleteBeta — the Beta CDF', () => {
  it('CLOSED FORM: I_x(1,1) = x exactly (Beta(1,1) is Uniform) — the fixture that cannot be wrong', () => {
    for (const x of [0.05, 0.25, 0.5, 0.75, 0.99]) {
      expect(regularizedIncompleteBeta(x, 1, 1)).toBeCloseTo(x, 10);
    }
  });

  it('CLOSED FORM: I_{1/2}(a,a) = 1/2 for a symmetric Beta', () => {
    for (const a of [0.5, 1, 2, 4, 8]) {
      expect(regularizedIncompleteBeta(0.5, a, a)).toBeCloseTo(0.5, 10);
    }
  });

  it('is a proper CDF: 0 at the left edge, 1 at the right, monotone between', () => {
    expect(regularizedIncompleteBeta(0, 4, 5)).toBe(0);
    expect(regularizedIncompleteBeta(1, 4, 5)).toBe(1);
    let previous = 0;
    for (let x = 0.02; x < 1; x += 0.02) {
      const current = regularizedIncompleteBeta(x, 4, 5);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('refuses non-positive shape parameters rather than returning a number', () => {
    expect(() => regularizedIncompleteBeta(0.5, 0, 1)).toThrow(/positive/);
    expect(() => regularizedIncompleteBeta(0.5, 1, -1)).toThrow(/positive/);
  });
});

describe('betaQuantile — inverse of the CDF', () => {
  it('CLOSED FORM: Beta(1,1) quantiles are the probabilities themselves', () => {
    expect(betaQuantile(0.25, 1, 1)).toBeCloseTo(0.25, 8);
    expect(betaQuantile(0.5, 1, 1)).toBeCloseTo(0.5, 8);
    expect(betaQuantile(0.75, 1, 1)).toBeCloseTo(0.75, 8);
  });

  it('STRUCTURAL: a symmetric Beta(a,a) has q25 + q75 = 1 and median 1/2', () => {
    for (const a of [1, 2, 5]) {
      expect(betaQuantile(0.25, a, a) + betaQuantile(0.75, a, a)).toBeCloseTo(1, 8);
      expect(betaQuantile(0.5, a, a)).toBeCloseTo(0.5, 8);
    }
  });

  it('ROUND-TRIPS against the CDF: CDF(quantile(p)) = p', () => {
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(regularizedIncompleteBeta(betaQuantile(p, 4, 5), 4, 5)).toBeCloseTo(p, 8);
    }
  });
});

describe('D1 — the ratified prior', () => {
  it('is Laplace, Beta(1,1), held as ONE constant pair', () => {
    expect(PRIOR_ALPHA).toBe(1);
    expect(PRIOR_BETA).toBe(1);
  });

  it('quotes the ratified 50% coverage — the same dialect as the range->distribution fitter', () => {
    expect(RATIFIED_COVERAGE).toBe(0.5);
  });
});

describe('T2 — deriveReferenceClassPosterior known answers', () => {
  it('(K=3, N=7) -> Beta(4,5): mean 0.4444, q25 0.3291, q75 0.5555', () => {
    const posterior = deriveReferenceClassPosterior({ observed_k: 3, observed_n: 7 });
    expect(posterior.family).toBe('beta');
    expect(posterior.alpha).toBe(4);
    expect(posterior.beta).toBe(5);
    // Closed form: alpha / (alpha + beta) = 4/9.
    expect(posterior.mean).toBeCloseTo(4 / 9, 10);
    expect(posterior.mean).toBeCloseTo(0.4444, 4);
    expect(posterior.q25).toBeCloseTo(0.3291, 4);
    expect(posterior.q75).toBeCloseTo(0.5555, 4);
    expect(posterior.coverage).toBe(0.5);
    expect(posterior.method_version).toBe('base-rate-elicited-v1');
  });

  it('⭐ EDGE K=0 (N=7) -> Beta(1,8): the estimate is 11%, NEVER 0% — never say never', () => {
    const posterior = deriveReferenceClassPosterior({ observed_k: 0, observed_n: 7 });
    expect(posterior.alpha).toBe(1);
    expect(posterior.beta).toBe(8);
    expect(posterior.mean).toBeCloseTo(1 / 9, 10);
    expect(posterior.mean).toBeCloseTo(0.1111, 4);
    expect(posterior.q25).toBeCloseTo(0.0353, 4);
    expect(posterior.q75).toBeCloseTo(0.1591, 4);
    // THE PROPERTY THE PRIOR EXISTS FOR. `M1` (raw MLE) makes this exactly 0.
    expect(posterior.mean).toBeGreaterThan(0);
    expect(formatPosteriorPercent(posterior.mean)).not.toBe('0%');
  });

  it('⭐ EDGE K=N=5 -> Beta(6,1): the estimate is interior and strictly below 100%', () => {
    const posterior = deriveReferenceClassPosterior({ observed_k: 5, observed_n: 5 });
    expect(posterior.alpha).toBe(6);
    expect(posterior.beta).toBe(1);
    expect(posterior.mean).toBeCloseTo(6 / 7, 10);
    expect(posterior.mean).toBeLessThan(1);
    expect(formatPosteriorPercent(posterior.mean)).not.toBe('100%');
  });

  it('TINY N (K=1, N=2) -> Beta(2,2): mean 0.5, q25 0.3264, q75 0.6736 — no minimum-N refusal', () => {
    const posterior = deriveReferenceClassPosterior({ observed_k: 1, observed_n: 2 });
    expect(posterior.alpha).toBe(2);
    expect(posterior.beta).toBe(2);
    expect(posterior.mean).toBeCloseTo(0.5, 10);
    expect(posterior.q25).toBeCloseTo(0.3264, 4);
    expect(posterior.q75).toBeCloseTo(0.6736, 4);
  });

  it('I2 — the band NARROWS as N grows on the same rate: uncertainty is derived from the counts', () => {
    const small = deriveReferenceClassPosterior({ observed_k: 3, observed_n: 7 });
    const large = deriveReferenceClassPosterior({ observed_k: 300, observed_n: 700 });
    expect(large.q75 - large.q25).toBeLessThan(small.q75 - small.q25);
    // And both still bracket the same rate — nothing is shrunk toward a
    // population figure the user never named.
    expect(small.q25).toBeLessThan(3 / 7);
    expect(small.q75).toBeGreaterThan(3 / 7);
    expect(large.q25).toBeLessThan(3 / 7);
    expect(large.q75).toBeGreaterThan(3 / 7);
  });

  it('I2 — parameters are a function of (K, N, PRIOR) and NOTHING else', () => {
    const a = deriveReferenceClassPosterior({ observed_k: 3, observed_n: 7 });
    const b = deriveReferenceClassPosterior({ observed_k: 3, observed_n: 7 });
    expect(a).toEqual(b);
    expect(a.alpha).toBe(3 + PRIOR_ALPHA);
    expect(a.beta).toBe(7 - 3 + PRIOR_BETA);
  });

  it('refuses the inputs the grammar should already have refused', () => {
    expect(() => deriveReferenceClassPosterior({ observed_k: 5, observed_n: 3 })).toThrow(
      /0 <= K <= N/,
    );
    expect(() => deriveReferenceClassPosterior({ observed_k: 0, observed_n: 0 })).toThrow(
      /at least 1/,
    );
    expect(() => deriveReferenceClassPosterior({ observed_k: 1.5, observed_n: 7 })).toThrow(
      /integers/,
    );
    expect(() => deriveReferenceClassPosterior({ observed_k: -1, observed_n: 7 })).toThrow(
      /0 <= K <= N/,
    );
  });
});

describe('formatPosteriorPercent', () => {
  it('renders WHOLE percentage points, and never a leading raw decimal', () => {
    expect(formatPosteriorPercent(0.4444)).toBe('44%');
    expect(formatPosteriorPercent(0.3291)).toBe('33%');
    expect(formatPosteriorPercent(0.5555)).toBe('56%');
    expect(formatPosteriorPercent(0.1111)).toBe('11%');
    // The Phase-3 prose guard's rule: a leading `0.\d` / `.\d` in block prose.
    for (const v of [0.4444, 0.0353, 0.9999]) {
      expect(formatPosteriorPercent(v)).not.toMatch(/(?:^|[\s(=,])(?:0\.\d|\.\d)/);
    }
  });
});
