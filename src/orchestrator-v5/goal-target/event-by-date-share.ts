/** S2a: the stated quantity is uniform; derived share is never silently uniform.
 * Fractions throughout. Independent team time/pace and lead time; no sampling.
 */
import { goalChanceDisplayClass } from './goal-chance-display.js';
export interface Moments { readonly mean: number; readonly sd: number }
export interface TeamShare {
  readonly quantity: 'months_to_finish' | 'share_per_month';
  readonly D: number;
  readonly low: number;
  readonly high: number;
}
export interface ExtraShare {
  readonly monthlyShare: number;
  readonly D: number;
  readonly leadLow: number;
  readonly leadHigh: number;
}
export interface ShareParts { readonly team: TeamShare; readonly extra?: ExtraShare }
const clamp = (x: number): number => Math.max(0, Math.min(1, x));
function bounds(a: number, b: number): void {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) throw new RangeError('Invalid stated range');
}
function duration(D: number): void {
  if (!Number.isFinite(D) || D < 0) throw new RangeError('Invalid deadline duration');
}

export function teamShareMoments(D: number, a: number, b: number): Moments {
  bounds(a, b); duration(D);
  if (a <= 0) throw new RangeError('Time to finish must be positive');
  if (a === b) return { mean: D / a, sd: 0 };
  const mean = D * Math.log1p((b - a) / a) / (b - a);
  return { mean, sd: Math.sqrt(Math.max(0, D * D / (a * b) - mean * mean)) };
}

/** E[min(1,D/T0)] for the card only. Forecast parts retain uncapped moments. */
export function cappedTeamShareMean(D: number, a: number, b: number): number {
  bounds(a, b); duration(D);
  if (a <= 0) throw new RangeError('Time to finish must be positive');
  if (a === b) return Math.min(1, D / a);
  if (D >= b) return 1;
  if (D <= a) return D * Math.log1p((b - a) / a) / (b - a);
  return ((D - a) + D * Math.log(b / D)) / (b - a);
}

export function paceShareMoments(D: number, p1: number, p2: number): Moments {
  bounds(p1, p2); duration(D);
  if (p1 < 0) throw new RangeError('Pace must be non-negative');
  return { mean: D * (p1 + p2) / 2, sd: D * (p2 - p1) / Math.sqrt(12) };
}

export function extraShareMoments(m: number, D: number, a: number, b: number): Moments {
  bounds(a, b); duration(D);
  if (!Number.isFinite(m) || m < 0 || a < 0) throw new RangeError('Invalid added capacity');
  if (a === b) return { mean: m * Math.max(0, D - a), sd: 0 };
  const hi = Math.max(0, D - a), lo = Math.max(0, D - b);
  const mean = m * (hi * hi - lo * lo) / (2 * (b - a));
  const second = m * m * (hi ** 3 - lo ** 3) / (3 * (b - a));
  return { mean, sd: Math.sqrt(Math.max(0, second - mean * mean)) };
}

export function momentsOfTeam(t: TeamShare): Moments {
  return t.quantity === 'months_to_finish' ? teamShareMoments(t.D, t.low, t.high)
    : paceShareMoments(t.D, t.low, t.high);
}

function teamTail(t: TeamShare, threshold: number): number {
  if (t.low === t.high) return (t.quantity === 'months_to_finish' ? t.D / t.low : t.D * t.low) >= threshold ? 1 : 0;
  if (threshold <= 0) return 1;
  if (t.quantity === 'months_to_finish') return clamp((t.D / threshold - t.low) / (t.high - t.low));
  return t.D === 0 ? 0 : clamp((t.high - threshold / t.D) / (t.high - t.low));
}

/** Midpoint integration of the exact conditional tail over uniform lead time.
 * The integrand is monotone and in [0,1], so the absolute error is <= 1/N
 * for EVERY admissible range, including a lead time straddling D and atoms.
 * N=16384 bounds error by 0.006104 percentage points (<0.05).
 */
export const EXACT_INTEGRATION_STEPS = 16384;
export function exactChance(parts: ShareParts, threshold: number): number {
  momentsOfTeam(parts.team);
  if (!Number.isFinite(threshold)) throw new RangeError('Invalid threshold');
  const x = parts.extra;
  if (x === undefined) return teamTail(parts.team, threshold);
  extraShareMoments(x.monthlyShare, x.D, x.leadLow, x.leadHigh);
  if (x.leadLow === x.leadHigh || x.monthlyShare === 0) {
    return teamTail(parts.team, threshold - x.monthlyShare * Math.max(0, x.D - x.leadLow));
  }
  let sum = 0;
  for (let i = 0; i < EXACT_INTEGRATION_STEPS; i++) {
    const lead = x.leadLow + (i + 0.5) * (x.leadHigh - x.leadLow) / EXACT_INTEGRATION_STEPS;
    sum += teamTail(parts.team, threshold - x.monthlyShare * Math.max(0, x.D - lead));
  }
  return sum / EXACT_INTEGRATION_STEPS;
}

/** Normal upper tail (A&S 7.1.26 erf approximation, absolute error <1.5e-7). */
function normalTail(z: number): number {
  const a = Math.abs(z) / Math.sqrt(2), t = 1 / (1 + 0.3275911 * a);
  const erfc = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
}
export function normalChance(parts: ShareParts, threshold: number): number {
  if (!Number.isFinite(threshold)) throw new RangeError('Invalid threshold');
  const team = momentsOfTeam(parts.team);
  const extra = parts.extra === undefined ? { mean: 0, sd: 0 } : extraShareMoments(
    parts.extra.monthlyShare, parts.extra.D, parts.extra.leadLow, parts.extra.leadHigh);
  // ISL draws both the team part and its held +1 coefficient independently.
  // Var(C*T) = Var(T) + Var(C) * E[T²], for E[C]=1 and held sd(C)=0.01.
  const heldCoefficientVariance = 0.01 ** 2 * (team.mean ** 2 + team.sd ** 2);
  const mean = team.mean + extra.mean, sd = Math.sqrt(team.sd ** 2 + extra.sd ** 2 + heldCoefficientVariance);
  return sd === 0 ? (mean >= threshold ? 1 : 0) : normalTail((threshold - mean) / sd);
}

export type ShareGate = { readonly form: 'point'; readonly error_points: number }
  | { readonly form: 'range'; readonly low: number; readonly high: number; readonly error_points: number };
export const SHARE_GATE_MAX_ERROR_POINTS = 2;
export function gate(parts: ShareParts, threshold: number): ShareGate {
  const normal = normalChance(parts, threshold), exact = exactChance(parts, threshold);
  const error = Math.abs(normal - exact) * 100;
  if (error <= SHARE_GATE_MAX_ERROR_POINTS && goalChanceDisplayClass(normal) === goalChanceDisplayClass(exact)) {
    return { form: 'point', error_points: error };
  }
  const t = parts.team;
  const at = (v: number): number => exactChance({ ...parts, team: { ...t, low: v, high: v } }, threshold);
  return { form: 'range', low: at(t.quantity === 'months_to_finish' ? t.high : t.low),
    high: at(t.quantity === 'months_to_finish' ? t.low : t.high), error_points: error };
}
