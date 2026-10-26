/**
 * A range is not a law. This is the ONE reading the simulator (and S1's compiler, which imports it) applies to a `range`.
 * It is Olumi's provisional reading, never the person's calibration; the ends stay as stated, and `basis` says whose.
 *
 * W10, INTERIM (the DL on Paul's instruction, 26 Oct: "make good assumptions and ensure they're reasonably optimal"), until
 * Neil and Jinghui review the method. Three readings, by what the ends mean (canonical.ts RANGE_KIND):
 *
 *  1. A PLAUSIBLE range (range_kind 'plausible'; a range with no kind is read as one, compile.ts rangeDistOf) is read so that EXACTLY 1 draw in 10 falls below its low end and 1 in 10 above its high end: the figure falls
 *     inside it 8 times out of 10. Stated ranges are usually too narrow, so its ends are never read as near-certain (before
 *     W10 the √12 law below made a plausible range about a 92% interval), and a most likely value off the middle no longer
 *     puts the spread on the wrong side (low 0, most likely 2, high 10: the √12 Normal had 24% below 0 and 0.3% above 10).
 *     EQUAL-MASS HALVES around the median m (the most likely value, else the middle): with probability 1/2 the draw is
 *     m − |Z|·σL, else m + |Z|·σH (Z standard Normal), with σL = (m − low)/Φ⁻¹(0.9) and σH = (high − m)/Φ⁻¹(0.9), so
 *     P(X < low) = ½·P(|Z| > Φ⁻¹(0.9)) = ½ × 0.2 = 0.1 exactly, P(X > high) = 0.1 exactly, and P(X < m) = ½. With m the
 *     middle (or no most likely value) the halves are equal: the Normal on the middle, σ = (high − low)/(2 × Φ⁻¹(0.9)).
 *     (The continuous split Normal with these σL and σH, whose halves meet at a common density, does NOT land the ends: its
 *     lower half has weight σL/(σL + σH), so for 10/20/100 it puts 2.2% below 10 and 17.8% above 100. It is not used.)
 *  2. AN END THAT SITS ON A HARD EDGE (the range's domain floor or ceiling: a chance's 0 or 1, an elapsed time's 0, a declared
 *     floor or ceiling, a stated sign restriction; a count "0 to 10" with a floor of 0) is that edge, never a 10th percentile:
 *     its half keeps all its 1/2 between the edge and m, a half-Normal with σ = (m − edge)/Φ⁻¹(0.9) truncated at the edge
 *     (|Z| ≤ Φ⁻¹(0.9)). With no most likely value, m is the middle. The other end keeps rule 1.
 *     ONE MECHANISM gives rules 1 and 2: each half's σ is set by its own end, and each half is drawn within the domain as
 *     before W10 (by inverse CDF: never a draw outside, never one clamped onto an edge), keeping its 1/2, so m stays the
 *     median. With the end on the edge that is rule 2 exactly; strictly inside, rule 1 exactly, except where the domain cuts
 *     into a half's own tail (low 1, most likely 2, floor 0: 9.58% below 1, not 10%). An end PAST an edge (a rough 0.1 to
 *     0.6 with a floor of 0.2) is never below the edge, and the domain then cuts into that half's core (the part between m
 *     and its end), so its share is ½ × its own draws inside the domain ÷ 0.8: continuous as the end reaches the edge (where
 *     it is ½, rule 2) and as the edge reaches m (where it is 0). Only then is m not the median.
 *  3. HARD BOUNDS (range_kind 'bounds', whoever declared it: "between 10 and 30"; M1, S1 strip, Paul 26 Oct, honours an
 *     Olumi range declared 'bounds' too) are drawn EXACTLY as before W10:
 *     CEE's existing conversion, `rangeSpread` in `src/orchestrator-v5/path-b/living-model/mapper.ts:104-110` (#3678, #3688),
 *     a Normal with uniform-matched moments, sd = (high − low)/√12 (mapper.ts:106), centred on the most likely value or, with
 *     none, on the middle (mapper.ts:861), CONDITIONED on [low, high] and any domain (PL ruling, AMEND, 23 Oct).
 *
 * Never a point fallback for an uncertain range: low = high is not uncertain, so exactly that figure; a most likely value at
 * or outside an end, or low > high, is malformed and throws (S1 refuses it at compile). The reading reports the CONDITIONED
 * moments (the mean and the post-truncation sd), which are what the draws have.
 *
 * HOW A DRAW IS MADE (seeds stay reproducible: W10 changes the law, never a stream). Each ranged figure keeps its one stream
 * keyed by (seed, `q:<id>`), one value per draw, so draw i depends only on (seed, id, i), exactly as before:
 *  - drawn with no edge on either side (lower = −∞, upper = ∞): prng.ts `standardNormals` (Box–Muller, two uniforms per draw)
 *    gives one z per draw; its SIGN picks the half (P(z < 0) = ½) and |z| is the half-Normal draw:
 *    x = m + σL·z when z < 0, else m + σH·z (`fromStandardNormal`). With σL = σH it is the Normal draw m + σ·z, as before;
 *  - drawn within a finite edge on either side: prng.ts `uniforms` gives one u in (0, 1) per draw, read by inverse CDF
 *    (`fromUniform`): u < w (the lower half's share, ½ when both halves have room) draws the lower half at u/w, else the upper
 *    half at (u − w)/(1 − w), each half its Normal piece conditioned on its part of [lower, upper], so x rises with u;
 *  - a person's hard bounds: that one uniform through the conditioned Normal, as before W10 (simulate.ts).
 */
import type { Dist, Domain } from '../executable.js';

/** A range as executable.ts r4 carries it: with its range_kind (from the person's words) and its domain. */
export type RangeDist = Extract<Dist, { kind: 'range' }>;
export type RangeKind = RangeDist['range_kind'];
export type { Domain };

export type RangeReading =
  | {
      /** A spread (the name is on the wire: a card's `law.reading`). */
      readonly kind: 'normal';
      /** How its ends are read: 'p10_p90', a plausible range (rules 1 and 2); 'hard_bounds', a person's bounds (rule 3). */
      readonly ends: 'p10_p90' | 'hard_bounds';
      /** p10_p90: the median m (the most likely value, else the middle). hard_bounds: rangeSpread's centre. */
      readonly centre: number;
      /** p10_p90: each half's spread, σL below the centre and σH above it, before conditioning. hard_bounds: both are `sd`. */
      readonly sd_below: number;
      readonly sd_above: number;
      /** Whether its low / high end is at or past a hard edge (rule 2; a person's bound is one): never below `lower` / above `upper`. */
      readonly edge_below: boolean;
      readonly edge_above: boolean;
      /** p10_p90: the share of draws below the centre, ½ (the centre is the median) unless an end lies past a hard edge. */
      readonly share_below: number;
      /** The unconditioned law's standard deviation: √(½(σL² + σH²) − (σH − σL)²/2π); σ for a Normal. */
      readonly sd: number;
      /** Where it is conditioned (±Infinity when it is not). */
      readonly lower: number;
      readonly upper: number;
      /** The conditioned moments: what the draws have. Equal to the unconditioned mean and sd when unbounded. */
      readonly mean: number;
      readonly sd_conditioned: number;
    }
  | { readonly kind: 'point'; readonly value: number };
export type SpreadReading = Extract<RangeReading, { kind: 'normal' }>;

/** Φ⁻¹(0.9) ("1.2816"): a half-Normal is beyond Z90·σ exactly 1 time in 5, so half of a half-mass, 1 in 10. */
export const Z90 = 1.2815515655446004;
const SQRT2PI_INV = 1 / Math.sqrt(2 * Math.PI);

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
  const bounded = d.range_kind === 'bounds';
  const domains = [d.domain, opts.domain].filter((x): x is Domain => x !== undefined);
  const lower = Math.max(bounded ? low : -Infinity, ...domains.map((x) => x.min ?? -Infinity));
  const upper = Math.min(bounded ? high : Infinity, ...domains.map((x) => x.max ?? Infinity));
  if (!(lower < upper)) throw new Error(`range ${low} to ${high} has no room inside ${lower} to ${upper}`);
  if (bounded) {
    // Rule 3: rangeSpread's Normal conditioned on the person's bounds, exactly as before W10.
    const sd = (high - low) / Math.sqrt(12);
    const centre = mode ?? (low + high) / 2;
    const a = (lower - centre) / sd, b = (upper - centre) / sd, m = truncatedMoments(a, b);
    if (m === null) throw new Error(`range ${low} to ${high} has no probability inside ${lower} to ${upper}`);
    const share_below = a < Math.min(0, b) ? mass(a, Math.min(0, b)) / mass(a, b) : 0;
    return { kind: 'normal', ends: 'hard_bounds', centre, sd_below: sd, sd_above: sd, edge_below: true, edge_above: true, share_below, sd, lower, upper,
      mean: centre + sd * m.mean, sd_conditioned: sd * m.sd };
  }
  // Rules 1 and 2. Each half's spread is set by its own end; each half is drawn within [lower, upper] and keeps its ½, so an
  // end ON an edge (low = lower) gives exactly rule 2's half-Normal truncated at the edge (|Z| ≤ Φ⁻¹(0.9)).
  const edge_below = low <= lower, edge_above = high >= upper;
  const centre = mode ?? (low + high) / 2;
  const sd_below = (centre - low) / Z90, sd_above = (high - centre) / Z90;
  const sd = sd_below === sd_above ? sd_below : Math.sqrt(0.5 * (sd_below ** 2 + sd_above ** 2) - (sd_above - sd_below) ** 2 * SQRT2PI_INV ** 2);
  // Each half's share: ½, unless the domain cuts into its core (the part between m and its end, 8 in 10 of the half's own
  // draws: an end PAST an edge, or m outside the domain); then ½ × its own draws inside the domain ÷ 0.8, so the share falls
  // continuously to 0 as the edge reaches m (a rough 10 to 30 % with a floor of 20 % is its upper half alone).
  const cut = (aZ: number, bZ: number): number => (aZ < bZ ? Math.min(1, (2 * mass(aZ, bZ)) / 0.8) : 0);
  const fBelow = lower <= low && centre <= upper ? 1 : cut((lower - centre) / sd_below, Math.min(0, (upper - centre) / sd_below));
  const fAbove = lower <= centre && high <= upper ? 1 : cut(Math.max(0, (lower - centre) / sd_above), (upper - centre) / sd_above);
  if (!(fBelow + fAbove > 0)) throw new Error(`range ${low} to ${high} has no probability inside ${lower} to ${upper}`);
  const share_below = fBelow === fAbove ? 0.5 : fBelow / (fBelow + fAbove);
  const reading: SpreadReading = { kind: 'normal', ends: 'p10_p90', centre, sd_below, sd_above, edge_below, edge_above, share_below, sd, lower, upper,
    mean: NaN, sd_conditioned: NaN };
  const m = spreadMoments(reading);
  if (m === null) throw new Error(`range ${low} to ${high} has no probability inside ${lower} to ${upper}`);
  return { ...reading, mean: m.mean, sd_conditioned: m.sd };
}

/**
 * The two halves of a p10_p90 reading as they are drawn: each half's interval in its own standard units (the lower half
 * Z in [a, b] with b ≤ 0, x = m + σL·Z; the upper half Z in [a, b] with a ≥ 0, x = m + σH·Z) and the lower half's share of
 * the draws, `share_below` (½, or less where an end lies past an edge: a rough 100 to 120 % against a ceiling of 100 % is
 * its lower half's tail below 100 % alone).
 */
function halves(r: SpreadReading): { readonly w: number; readonly lo: readonly [number, number]; readonly hi: readonly [number, number] } {
  const lo: [number, number] = [(r.lower - r.centre) / r.sd_below, Math.min(0, (r.upper - r.centre) / r.sd_below)];
  const hi: [number, number] = [Math.max(0, (r.lower - r.centre) / r.sd_above), (r.upper - r.centre) / r.sd_above];
  const roomLo = lo[0] < lo[1] && mass(lo[0], lo[1]) > 0, roomHi = hi[0] < hi[1] && mass(hi[0], hi[1]) > 0;
  const w = roomLo && roomHi ? r.share_below : roomLo ? 1 : roomHi ? 0 : NaN;
  return { w, lo, hi };
}

/** The conditioned mean and sd of a p10_p90 reading (the mixture of its two conditioned halves), or null with no room. */
function spreadMoments(r: SpreadReading): { mean: number; sd: number } | null {
  if (r.lower === -Infinity && r.upper === Infinity) {
    // Unconditioned: E[X] = m + ½(σH − σL)·E|Z|, E|Z| = √(2/π); the sd is the law's own.
    return { mean: r.centre + (r.sd_above - r.sd_below) * SQRT2PI_INV, sd: r.sd };
  }
  const h = halves(r);
  if (Number.isNaN(h.w)) return null;
  const parts = [
    ...(h.w > 0 ? [{ w: h.w, s: r.sd_below, t: truncatedMoments(h.lo[0], h.lo[1]) }] : []),
    ...(h.w < 1 ? [{ w: 1 - h.w, s: r.sd_above, t: truncatedMoments(h.hi[0], h.hi[1]) }] : []),
  ];
  if (parts.some((p) => p.t === null)) return null;
  const each = parts.map((p) => ({ w: p.w, mean: r.centre + p.s * p.t!.mean, variance: (p.s * p.t!.sd) ** 2 }));
  const mean = each.reduce((a, p) => a + p.w * p.mean, 0);
  const variance = each.reduce((a, p) => a + p.w * (p.variance + (p.mean - mean) ** 2), 0);
  return { mean, sd: Math.sqrt(Math.max(0, variance)) };
}

/** A p10_p90 draw with no edge on either side, from the stream's standard Normal z: its sign picks the half, |z| draws it. */
export function fromStandardNormal(r: SpreadReading, z: number): number {
  return r.centre + (z < 0 ? r.sd_below : r.sd_above) * z;
}

/**
 * A p10_p90 draw within a finite edge, from the stream's uniform u in (0, 1), by inverse CDF: u < w draws the lower half at
 * u/w, else the upper half at (u − w)/(1 − w), each its Normal piece conditioned on its part of [lower, upper]
 * (`truncatedStandardNormal`). The upper half is drawn as the mirror of its lower-tail image, where Φ keeps its precision.
 * Monotone in u: never rejection, never a clamp onto an edge.
 */
export function fromUniform(r: SpreadReading): (u: number) => number {
  const { w, lo, hi } = halves(r);
  if (Number.isNaN(w)) throw new Error(`a spread with no room inside ${r.lower} to ${r.upper}`);
  return (u: number): number => (u < w
    ? r.centre + r.sd_below * truncatedStandardNormal(u / w, lo[0], lo[1])
    : r.centre - r.sd_above * truncatedStandardNormal(1 - (u - w) / (1 - w), -hi[1], -hi[0]));
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
