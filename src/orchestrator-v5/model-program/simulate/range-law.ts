/**
 * A range is not a law. This is the ONE reading the simulator (and S1's compiler, which imports it) applies to a `range`.
 * The law is CEE's existing conversion, reused: `rangeSpread` in `src/orchestrator-v5/path-b/living-model/mapper.ts:104-110`
 * (#3678, #3688; the DL's "existing AIE conversion"): a Normal with uniform-matched moments, sd = (high − low)/√12
 * (mapper.ts:106), centred on the stated most likely value or, with none, on the middle (mapper.ts:861).
 *
 * WHERE it is drawn (PL ruling, AMEND, 23 Oct), never a point fallback for an uncertain range:
 *   - range_kind 'bounds' (the person's hard bounds: "between 10 and 30"): that Normal CONDITIONED on [low, high] (drawn by
 *     inverse CDF, so no draw is ever outside and none is clamped onto an end);
 *   - range_kind 'plausible', and every Olumi range: unbounded, except where a mathematical DOMAIN applies (a chance in
 *     [0, 1], a non-negative count) or the person stated a hard sign restriction: then conditioned on that domain;
 *   - low = high: not uncertain, so exactly that figure;
 *   - a most likely value at or outside an end, or low > high, is malformed and throws (S1 refuses it at compile).
 * It reports the CONDITIONED moments (the mean and the post-truncation sd), which are what the draws have.
 * The law is Olumi's provisional assumption, never the person's calibration; the ends stay as stated, `basis` says whose.
 */
import type { Dist, Domain } from '../executable.js';

/** A range as executable.ts r4 carries it: with its range_kind (from the person's words) and its domain. */
export type RangeDist = Extract<Dist, { kind: 'range' }>;
export type RangeKind = RangeDist['range_kind'];
export type { Domain };

export type RangeReading =
  | {
      readonly kind: 'normal';
      /** The unconditioned law: rangeSpread's centre and sd. */
      readonly centre: number;
      readonly sd: number;
      /** Where it is conditioned (±Infinity when it is not). */
      readonly lower: number;
      readonly upper: number;
      /** The conditioned moments: what the draws have. Equal to centre and sd when unbounded. */
      readonly mean: number;
      readonly sd_conditioned: number;
    }
  | { readonly kind: 'point'; readonly value: number };

export function rangeLaw(d: RangeDist, opts: { readonly domain?: Domain } = {}): RangeReading {
  const { low, high, mode } = d;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) throw new Error(`range ${low} to ${high} is not low ≤ high with finite ends`);
  if (low === high) {
    if (mode !== undefined && mode !== low) throw new Error(`range ${low} to ${high}: most likely value ${mode} is not that figure`);
    return { kind: 'point', value: low };
  }
  if (mode !== undefined && !(Number.isFinite(mode) && low < mode && mode < high)) {
    throw new Error(`range ${low} to ${high}: most likely value ${mode} is not strictly inside it`);
  }
  const sd = (high - low) / Math.sqrt(12);
  const centre = mode ?? (low + high) / 2;
  const bounded = d.range_kind === 'bounds' && d.basis === 'person_range';
  const domains = [d.domain, opts.domain].filter((x): x is Domain => x !== undefined);
  const lower = Math.max(bounded ? low : -Infinity, ...domains.map((x) => x.min ?? -Infinity));
  const upper = Math.min(bounded ? high : Infinity, ...domains.map((x) => x.max ?? Infinity));
  if (!(lower < upper)) throw new Error(`range ${low} to ${high} has no room inside ${lower} to ${upper}`);
  const m = truncatedMoments((lower - centre) / sd, (upper - centre) / sd);
  if (m === null) throw new Error(`range ${low} to ${high} has no probability inside ${lower} to ${upper}`);
  return { kind: 'normal', centre, sd, lower, upper, mean: centre + sd * m.mean, sd_conditioned: sd * m.sd };
}

// ── The standard Normal, to the precision the draws need ──────────────────────────────────────────────────────────────
const SQRT2PI = Math.sqrt(2 * Math.PI);
export const phi = (x: number): number => (Number.isFinite(x) ? Math.exp(-0.5 * x * x) / SQRT2PI : 0);

/** erfc, Numerical Recipes `erfcc` (fractional error below 1.2e-7 everywhere, including the tails). */
function erfc(x: number): number {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
/** Φ(x). */
export const Phi = (x: number): number => (x === Infinity ? 1 : x === -Infinity ? 0 : 0.5 * erfc(-x / Math.SQRT2));

/** Φ⁻¹(p) for 0 < p < 1: Acklam's rational approximation, then one Halley step on Φ. */
export function PhiInv(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5, r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
      / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const e = Phi(x) - p, u = e * SQRT2PI * Math.exp(0.5 * x * x);
  return x - u / (1 + 0.5 * x * u);
}

/** The mass of [α, β], computed on the side where it does not cancel. */
function mass(alpha: number, beta: number): number {
  return alpha > 0 ? Phi(-alpha) - Phi(-beta) : Phi(beta) - Phi(alpha);
}

/** Mean and sd of a standard Normal conditioned on [α, β] (either may be infinite), or null when it has no mass there. */
export function truncatedMoments(alpha: number, beta: number): { mean: number; sd: number } | null {
  const z = mass(alpha, beta);
  if (!(z > 0)) return null;
  const pa = phi(alpha), pb = phi(beta);
  const mean = (pa - pb) / z;
  const aTerm = Number.isFinite(alpha) ? alpha * pa : 0, bTerm = Number.isFinite(beta) ? beta * pb : 0;
  const variance = 1 + (aTerm - bTerm) / z - mean * mean;
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

/**
 * A draw of the standard Normal conditioned on [α, β] from one uniform u in (0, 1), by inverse CDF (never rejection, never a
 * clamp onto an end). An interval in the upper tail is drawn as the mirror of its lower-tail image, where Φ keeps its
 * precision. The final min/max is a floating-point guard only (Φ⁻¹'s last-bit error), never a pile-up at an end.
 */
export function truncatedStandardNormal(u: number, alpha: number, beta: number): number {
  if (alpha > 0) return -truncatedStandardNormal(1 - u, -beta, -alpha);
  const pa = Phi(alpha), pb = Phi(beta);
  const x = PhiInv(pa + u * (pb - pa));
  return Math.min(beta, Math.max(alpha, x));
}
