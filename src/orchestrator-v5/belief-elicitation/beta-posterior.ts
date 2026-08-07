/**
 * ⭐ THE ARITHMETIC — a conjugate Beta posterior over an elicited class rate.
 *
 * ROADMAP 2.688 slice 1. Design:
 * `parallel-briefs/BASE-RATE-ELICITED-DESIGN-2026-08-08.md` §3.
 *
 * WHY THIS EXISTS. A user who says "3 out of 7 similar projects succeeded"
 * has given two numbers, and the only honest thing to say back is a rate
 * WITH the uncertainty those two numbers imply. The raw ratio 3/7 = 0.43 is
 * a point, and a point is a claim of certainty the sample cannot support —
 * exactly the collapse `src/cee/belief-elicitation/index.ts`'s
 * `parseFraction` performs today (it returns 0.43 with confidence 'high' and
 * the 7 is gone). K and N are the only inputs from which uncertainty can be
 * DERIVED rather than INVENTED; that is why this module takes counts and
 * never a rate.
 *
 * PURE. Deterministic, closed-form, zero RNG, zero new runtime dependency.
 * The incomplete-beta routine below is self-contained and pinned by
 * known-answer fixtures in `__tests__/beta-posterior.test.ts`.
 */

/**
 * ⭐⭐ D1 — THE PRIOR. ONE ratified constant pair, ONE definition site.
 *
 * `Beta(1, 1)` — LAPLACE, the uniform prior / rule of succession. The
 * posterior is `Beta(K + PRIOR_ALPHA, N - K + PRIOR_BETA)`.
 *
 * NAMED, CITED AND SWAPPABLE ON PURPOSE (design §3.2). The alternative
 * candidates were Jeffreys `Beta(1/2, 1/2)` and the raw MLE `K/N` (no
 * prior). The difference between Laplace and Jeffreys is second-order at
 * every realistic N; what is FIRST-order is that the choice be made
 * explicitly rather than by omission, held in one place, and guarded. The
 * three reasons Laplace won, in order of weight:
 *
 *   1. EDGE HONESTY. K = 0 must not disclose "0%" — *never say never* is the
 *      product's own trust doctrine, and the raw MLE discloses exactly that.
 *      Laplace's 1/(N+2) states the "it has never happened in 7 tries" case
 *      less aggressively than Jeffreys' 0.5/(N+1) (0.111 vs 0.0625 at N=7),
 *      which is the conservative direction for a coaching product whose
 *      users bring small, optimistically-remembered samples.
 *   2. EXPLAINABILITY. Laplace is the rule of succession: "your 3-of-7 plus
 *      one imaginary success and one imaginary failure" — one sentence a
 *      user can audit. Jeffreys' halves cannot be explained without
 *      invariance theory, and this product's differentiator is showing its
 *      reasoning.
 *   3. COMPOSITION. `Beta(1, 1)` is the range->distribution spec's own
 *      zero-information fixture (`RANGE-TO-DISTRIBUTION-SPEC-2026-08-08.md`
 *      E9/T4a: the (0.25, 0.75) range fits exactly Beta(1,1)). The two
 *      features' zero-information points coincide, which keeps any future
 *      joint treatment coherent.
 *
 * ⚠ STATUS: ratified default PENDING the 2.688-D1 sign-off (design §8.2 —
 * a register candidate, explicitly NOT a build blocker). If D1 rules for
 * Jeffreys, exactly these two literals change and every disclosure follows.
 *
 * The pair is mutant-guarded by a DISCRIMINATING PAIR (CLAUDE.md trap 19):
 *   - M1 `1,1 -> 0,0` (raw MLE)   => the K=0 known-answer REDs (0% disclosed)
 *   - M2 `1,1 -> 0.5,0.5` (Jeffreys) => the mean known-answers RED while the
 *        grammar/refusal suites stay GREEN
 * M1 alone would only prove "some prior is applied"; M2 is what proves the
 * suite pins the NAMED prior.
 */
export const PRIOR_ALPHA = 1;
export const PRIOR_BETA = 1;

/**
 * The credible-interval coverage every disclosure quotes: the MIDDLE HALF,
 * q25-q75.
 *
 * DERIVED, NOT NEW. `RANGE-TO-DISTRIBUTION-SPEC-2026-08-08.md` §2.5 ratifies
 * 0.5 as the coverage of a system-stated interval (live in ISL at
 * `dd11b34b`). Quoting the posterior's q25-q75 makes the two features speak
 * ONE uncertainty dialect: a base-rate disclosure IS a system-stated ~50%
 * credible interval, which is exactly the object the estate has just
 * ratified semantics for.
 *
 * ⚠ This is a CROSS-SERVICE MIRROR of a Python constant (CLAUDE.md trap 12:
 * CEE cannot import ISL's ratified value at runtime). It fails SAFE — a
 * drift here changes the width CEE quotes and nothing else; no compute
 * consumes it in v1. Stated rather than assumed.
 */
export const RATIFIED_COVERAGE = 0.5;

/** The honest constant stamped on every object and posterior this module produces. */
export const REFERENCE_CLASS_METHOD_VERSION = 'base-rate-elicited-v1';

/**
 * The posterior, in the range->distribution spec's `FittedDistribution`
 * shape (design §3.5) — same family, same derived-fields pattern, same
 * honest-constant provenance. Nothing converts and nothing is
 * moment-matched: when the blend ruling lands, a base-rate posterior and a
 * fitted user range arrive at it as the SAME kind of typed object.
 */
export interface ReferenceClassPosterior {
  readonly family: 'beta';
  readonly alpha: number;
  readonly beta: number;
  readonly mean: number;
  readonly q25: number;
  readonly q75: number;
  readonly coverage: number;
  readonly method_version: typeof REFERENCE_CLASS_METHOD_VERSION;
}

// ============================================================================
// Incomplete beta — self-contained, ~zero dependency, known-answer pinned
// ============================================================================

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const;

/** log Gamma(z), Lanczos approximation with the reflection formula for z < 1/2. */
function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zz = z - 1;
  let x: number = LANCZOS_COEFFICIENTS[0]!;
  for (let i = 1; i < LANCZOS_G + 2; i += 1) {
    x += LANCZOS_COEFFICIENTS[i]! / (zz + i);
  }
  const t = zz + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * The continued fraction for the incomplete beta (modified Lentz). Converges
 * fast for `x < (a+1)/(a+b+2)`; the caller reflects otherwise.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const FPMIN = 1e-300;
  const EPS = 3e-16;
  const MAX_ITERATIONS = 300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/**
 * The regularised incomplete beta `I_x(a, b)` — i.e. the Beta(a, b) CDF.
 * Pinned by known answers (`I_x(a,b)` for Beta(1,1) is the identity; Beta(2,2)
 * is symmetric about 1/2) in the spec.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error('regularizedIncompleteBeta: non-finite argument');
  }
  if (a <= 0 || b <= 0) {
    throw new Error('regularizedIncompleteBeta: shape parameters must be positive');
  }
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logBeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(logBeta + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * The Beta(a, b) quantile at probability `p`, by bisection on the CDF.
 *
 * Bisection rather than Newton deliberately: it needs no derivative, cannot
 * diverge, and terminates in a FIXED iteration count — so the disclosure a
 * user sees is bit-for-bit reproducible across runs and machines, which a
 * convergence-tolerance loop is not.
 */
export function betaQuantile(p: number, a: number, b: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error('betaQuantile: p must be in [0, 1]');
  }
  if (a <= 0 || b <= 0) {
    throw new Error('betaQuantile: shape parameters must be positive');
  }
  if (p === 0) return 0;
  if (p === 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ============================================================================
// The posterior
// ============================================================================

/**
 * `Beta(K + PRIOR_ALPHA, N - K + PRIOR_BETA)` for a confirmed count pair.
 *
 * I2 — NO EXTRAPOLATION BEYOND STATED N: the parameters are a function of
 * `(K, N, PRIOR_ALPHA, PRIOR_BETA)` and NOTHING else. No smoothing toward a
 * population figure, no shrinkage toward any house prior other than the
 * named D1 constant, and no comparability discount (design §3.3 — an
 * effective sample size `N' = w*N` would need a constant nobody has ruled;
 * a silent `w` is an invented number wearing a method card).
 *
 * Throws on any input the grammar should already have refused — a defensive
 * second gate, not the primary one.
 */
export function deriveReferenceClassPosterior(counts: {
  readonly observed_k: number;
  readonly observed_n: number;
}): ReferenceClassPosterior {
  const { observed_k: k, observed_n: n } = counts;
  if (!Number.isInteger(k) || !Number.isInteger(n)) {
    throw new Error('deriveReferenceClassPosterior: K and N must be integers');
  }
  if (n < 1) {
    throw new Error('deriveReferenceClassPosterior: N must be at least 1');
  }
  if (k < 0 || k > n) {
    throw new Error('deriveReferenceClassPosterior: K must satisfy 0 <= K <= N');
  }
  const alpha = k + PRIOR_ALPHA;
  const beta = n - k + PRIOR_BETA;
  return {
    family: 'beta',
    alpha,
    beta,
    mean: alpha / (alpha + beta),
    q25: betaQuantile((1 - RATIFIED_COVERAGE) / 2, alpha, beta),
    q75: betaQuantile(1 - (1 - RATIFIED_COVERAGE) / 2, alpha, beta),
    coverage: RATIFIED_COVERAGE,
    method_version: REFERENCE_CLASS_METHOD_VERSION,
  };
}

/**
 * `0.4444` -> `"44%"`. Whole percentage points only.
 *
 * The rounded percentage is DISPLAY. The raw `(K, N)` remain the stored
 * truth (design §3.4, mirroring the range spec's raw-`(a, b)` rule): the
 * posterior is recomputed from the counts at every read and never stored
 * beside them, because storing a derived value next to its inputs is a
 * hand-maintained mirror (CLAUDE.md trap 12).
 *
 * Whole points also keep the disclosure clear of the Phase-3 prose guard's
 * `RAW_DECIMAL_RE` (`/(?:^|[\s(=,])(?:0\.\d|\.\d)/`), which bans
 * leading-decimal probabilities from user-facing block prose.
 */
export function formatPosteriorPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
