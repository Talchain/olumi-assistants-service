/**
 * The ONE copy: P20 factor ranges and Canvas typed ranges import it.
 * Coverage follows the QUESTION that produced the range: the middle half, or
 * the range the person would be surprised to see the value fall outside.
 * Science 393023 (7 Oct): held-user-links.ts RANGE_90_WIDTH_Z (a rounded 90% constant) is
 * NOT migrated here; changing d5's served hold is out of package.
 */

/** Unprompted middle half, or the explicitly elicited surprise range. */
export type StatedRangeCoverage = 0.5 | 0.9;

export type StatedRangeRefusal =
  | 'RANGE_OPEN_ENDED'
  | 'RANGE_NON_FINITE'
  | 'RANGE_INVALID_ORDER'
  | 'RANGE_ZERO_WIDTH'
  | 'RANGE_OUT_OF_DOMAIN';

// Acklam coefficients (descending powers), published in QuantLib:
// https://github.com/lballabio/QuantLib/blob/master/ql/math/distributions/normaldistribution.cpp
const INVERSE_A = [
  -39.69683028665376, 220.9460984245205, -275.9285104469687,
  138.357751867269, -30.66479806614716, 2.506628277459239,
];
const INVERSE_B = [
  -54.47609879822406, 161.5858368580409, -155.6989798598866,
  66.80131188771972, -13.28068155288572, 1,
];
const INVERSE_C = [
  -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
];
const INVERSE_D = [
  0.007784695709041462, 0.3224671290700398, 2.445134137142996,
  3.754408661907416, 1,
];

// Cephes erf/erfc coefficients; the denominator's leading one is explicit.
// https://github.com/scipy/xsf/blob/main/include/xsf/cephes/ndtr.h
const ERF_T = [
  9.604973739870516, 90.02601972038427, 2232.005345946843,
  7003.325141128051, 55592.30130103949,
];
const ERF_U = [
  1, 33.56171416475031, 521.3579497801527,
  4594.323829709801, 22629.000061389095, 49267.39426086359,
];
const ERFC_P = [
  2.461969814735305e-10, 0.5641895648310689, 7.463210564422699,
  48.63719709856814, 196.5208329560771, 526.4451949954773,
  934.5285271719576, 1027.5518868951572, 557.5353353693994,
];
const ERFC_Q = [
  1, 13.228195115474499, 86.70721408859897, 354.9377788878199,
  975.7085017432055, 1823.9091668790973, 2246.3376081871097,
  1656.6630919416134, 557.5353408177277,
];
const ERFC_R = [
  0.5641895835477551, 1.275366707599781, 5.019050422511805,
  6.160210979930536, 7.4097426995044895, 2.9788666537210022,
];
const ERFC_S = [
  1, 2.2605286322011726, 9.396035249380015, 12.048953980809666,
  17.08144507475659, 9.608968090632859, 3.369076451000815,
];

function polynomial(x: number, coefficients: readonly number[]): number {
  let value = 0;
  for (const coefficient of coefficients) value = value * x + coefficient;
  return value;
}

function erfc(x: number): number {
  const magnitude = Math.abs(x);
  if (magnitude < 1) {
    const squared = x * x;
    return 1 - x * polynomial(squared, ERF_T) / polynomial(squared, ERF_U);
  }
  const exponential = Math.exp(-magnitude * magnitude);
  // Avoid Infinity / Infinity after the tail has already underflowed.
  if (exponential === 0) return x < 0 ? 2 : 0;
  const numerator = polynomial(magnitude, magnitude < 8 ? ERFC_P : ERFC_R);
  const denominator = polynomial(magnitude, magnitude < 8 ? ERFC_Q : ERFC_S);
  const tail = exponential * numerator / denominator;
  return x < 0 ? 2 - tail : tail;
}

function standardNormalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

export function inverseStandardNormal(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('Probability must be in (0, 1)');
  if (p === 0.5) return 0;

  // Refine the lower tail in both directions; subtraction near one loses precision.
  const tail = Math.min(p, 1 - p);
  let x: number;
  if (tail < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(tail));
    x = polynomial(q, INVERSE_C) / polynomial(q, INVERSE_D);
  } else {
    const q = tail - 0.5;
    const squared = q * q;
    x = q * polynomial(squared, INVERSE_A) / polynomial(squared, INVERSE_B);
  }

  const density = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const correction = (standardNormalCdf(x) - tail) / density;
  // Halley refinement; retain the estimate if an extreme subnormal cannot refine.
  if (Number.isFinite(correction)) x -= correction / (1 + x * correction / 2);
  return p < 0.5 ? x : -x;
}

export function statedRangeSpread(
  low: number | null | undefined,
  high: number | null | undefined,
  coverage: StatedRangeCoverage,
  domain: 'unbounded' | 'unit_interval' = 'unbounded',
): { ok: true; mean: number; std: number; coverage: StatedRangeCoverage }
  | { ok: false; refusal: StatedRangeRefusal } {
  // ISL's refusal order is observable when more than one condition fails.
  if (low === null || low === undefined || high === null || high === undefined) {
    return { ok: false, refusal: 'RANGE_OPEN_ENDED' };
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { ok: false, refusal: 'RANGE_NON_FINITE' };
  if (low > high) return { ok: false, refusal: 'RANGE_INVALID_ORDER' };
  if (low === high) return { ok: false, refusal: 'RANGE_ZERO_WIDTH' };
  if (domain === 'unit_interval' && (low < 0 || high > 1)) {
    return { ok: false, refusal: 'RANGE_OUT_OF_DOMAIN' };
  }

  const z = inverseStandardNormal((1 + coverage) / 2);
  const mean = (low + high) / 2;
  const std = (high - low) / (2 * z);
  if (!Number.isFinite(mean) || !Number.isFinite(std) || std <= 0) {
    return { ok: false, refusal: 'RANGE_NON_FINITE' };
  }
  return { ok: true, mean, std, coverage };
}

export function unitIntervalNormalFitApplies(mean: number, std: number): boolean {
  if (!Number.isFinite(mean) || !Number.isFinite(std) || std <= 0) return false;
  // Symmetry evaluates the right tail directly instead of subtracting its CDF from one.
  const outsideMass = standardNormalCdf(-mean / std) + standardNormalCdf((mean - 1) / std);
  return outsideMass <= 0.025;
}
