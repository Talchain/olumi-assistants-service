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
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.383577518672690e2, -3.066479806614716e1, 2.506628277459239,
];
const INVERSE_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1, 1,
];
const INVERSE_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
];
const INVERSE_D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416, 1,
];

// Cephes erf/erfc coefficients; the denominator's leading one is explicit.
// https://github.com/scipy/xsf/blob/main/include/xsf/cephes/ndtr.h
const ERF_T = [
  9.60497373987051638749, 9.00260197203842689217e1, 2.23200534594684319226e3,
  7.00332514112805075473e3, 5.55923013010394962768e4,
];
const ERF_U = [
  1, 3.35617141647503099647e1, 5.21357949780152679795e2,
  4.59432382970980127987e3, 2.26290000613890934246e4, 4.92673942608635921086e4,
];
const ERFC_P = [
  2.46196981473530512524e-10, 5.64189564831068821977e-1, 7.46321056442269912687,
  4.86371970985681366614e1, 1.96520832956077098242e2, 5.26445194995477358631e2,
  9.34528527171957607540e2, 1.02755188689515710272e3, 5.57535335369399327526e2,
];
const ERFC_Q = [
  1, 1.32281951154744992508e1, 8.67072140885989742329e1, 3.54937778887819891062e2,
  9.75708501743205489753e2, 1.82390916687909736289e3, 2.24633760818710981792e3,
  1.65666309194161350182e3, 5.57535340817727675546e2,
];
const ERFC_R = [
  5.64189583547755073984e-1, 1.27536670759978104416, 5.01905042251180477414,
  6.16021097993053585195, 7.40974269950448939160, 2.97886665372100240670,
];
const ERFC_S = [
  1, 2.26052863220117276590, 9.39603524938001434673, 1.20489539808096656605e1,
  1.70814450747565897222e1, 9.60896809063285878198, 3.36907645100081516050,
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
