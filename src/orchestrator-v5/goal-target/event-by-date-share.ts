/** S2a: the stated quantity is uniform; derived share is never silently uniform.
 * Fractions throughout. Independent team time/pace and lead time; no sampling.
 */
import { goalChanceDisplayClass, type GoalChanceDisplayRounding } from './goal-chance-display.js';

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
/** `extra` is the option's first added part; `furtherExtras` its later starts (E5: "two developers" is two parts, each
 * with its own lead range and pace). Parts are independent, so their means and variances add. */
export interface ShareParts {
  readonly team: TeamShare; readonly extra?: ExtraShare; readonly furtherExtras?: readonly ExtraShare[];
  /**
   * L3/L4 (DL ruling (A)): the option scales the team's own share by this capacity ratio (≥ 1), from the brief's capacity
   * chain, with no lead. One mechanism per option: never beside `extra`. Exact law: P(r·share ≥ t) = the team tail at t/r.
   */
  readonly ratio?: number;
}
export function extrasOf(parts: ShareParts): readonly ExtraShare[] {
  return parts.extra === undefined ? [] : [parts.extra, ...(parts.furtherExtras ?? [])];
}
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

/**
 * ⭐ E-TAIL (b) (DL option 1; AIE 6130197656 §2 ACK, 12 Oct): A HIRE'S LINK CARRIES AT MOST THE WHOLE DELIVERABLE, ON OLUMI'S
 * OWN PACE ONLY. Run 4's drafter put "Hire two developers" at 35 % of the launch a month: 35 % × 3 months is 1.05, a link the
 * writer's own base check refuses (|β| ≤ 1), so the user's deadline could never be saved. For a finite positive raw mean
 * above 1 and a raw spread ≥ 0: f = 1 / raw mean, the entered mean is 1 and the entered spread f × raw spread (the
 * coefficient of variation kept). Below the limit both are unchanged. NEVER applied to a pace a person supplied or accepted
 * (`hirePaceIsOlumisOwn`): that link stays raw, and the date is refused as before. The ONE sizing of a hire's link: its writer
 * (`withEventShareDate`) and its reader (`shareByDateGoalOf`) call this with the same answer. `extraShareMoments` stays the
 * uncapped law the reference calculations use. The raw moments are returned so the carrier can keep them.
 */
export function extraShareLinkMoments(m: number, D: number, a: number, b: number, olumisOwnPace: boolean): Moments & { readonly raw?: Moments } {
  const raw = extraShareMoments(m, D, a, b);
  if (!olumisOwnPace || !(Number.isFinite(raw.mean) && raw.mean > 1 && Number.isFinite(raw.sd) && raw.sd >= 0)) return raw;
  const f = 1 / raw.mean;
  return { mean: 1, sd: f * raw.sd, raw };
}

/**
 * The hire's pace is Olumi's own: the drafted carrier construction writes from Olumi's added-capacity pace (no figure set
 * and no statement from a person's card). The pace's authorship rides on the carrier, not on the switch's own 0 (which the
 * provenance authority reads as structural): a pace a person stated, or accepted on the hiring-times card (every figure is
 * stored with its role and the person's review, beside their statement), is never Olumi's own.
 */
export function hirePaceIsOlumisOwn(node: unknown): boolean {
  const c = (node as { observed_state?: { extra_share_by_date?: unknown } } | null | undefined)?.observed_state?.extra_share_by_date;
  if (c === undefined || c === null || typeof c !== 'object' || Array.isArray(c)) return false;
  const carrier = c as Record<string, unknown>;
  return carrier.figures === undefined && carrier.statement === undefined;
}

/**
 * AIE 6175233964 / 6174736249: a FIXED capacity ratio r, fully effective L months into an H-month window, scales the team's
 * share by k = 1 + (r−1)·max(0, H−L)/H, under the same constant-pace and work-scope assumptions. An uncertain lead (a range),
 * a ramp or a random ratio has no single k (its joint law is not supported): null, so the option fails closed with its reason.
 * k < 1 (an option that slows the team) cannot be represented by an added independent part: null too.
 */
export function capacityRatioScale(r: number, H: number, leadLow: unknown, leadHigh: unknown): number | null {
  if (!Number.isFinite(r) || r < 1 || !Number.isFinite(H) || H <= 0) return null;
  if (typeof leadLow !== 'number' || !Number.isFinite(leadLow) || leadLow < 0 || leadHigh !== leadLow) return null;
  return 1 + (r - 1) * Math.max(0, H - leadLow) / H;
}
/** The team's BASELINE CONTRIBUTION C·T (C = the team link's held coefficient): Var = μc²·sd² + σc²·(m² + sd²). */
export function baselineContributionMoments(team: Moments, coefficient: { readonly mean: number; readonly std: number }): Moments {
  return { mean: coefficient.mean * team.mean,
    sd: Math.sqrt(coefficient.mean ** 2 * team.sd ** 2 + coefficient.std ** 2 * (team.mean ** 2 + team.sd ** 2)) };
}
/**
 * The auxiliary ratio link X ~ N((k−1)·μB, (k²−1)·σB²), drawn independently beside the baseline contribution B. Under the
 * model's Normal approximation B + X matches k·B in its univariate distribution, for a fixed k. It is NOT the same shared
 * draw: anything paired or joint (win share, drivers, sensitivities) does not carry over (AIE 6175233964).
 */
export function ratioLinkMoments(k: number, baseline: Moments): Moments {
  return { mean: (k - 1) * baseline.mean, sd: Math.sqrt(k * k - 1) * baseline.sd };
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
 * Several parts nest one midpoint rule per lead range. The tail stays monotone in every lead, so each level adds at most
 * 1/N: two ranges at N=4096 bound the error by 0.0488 percentage points (<0.05). A point lead is a shift, not a level.
 */
export const EXACT_INTEGRATION_STEPS = 16384;
export const MULTI_PART_STEPS = 4096;
export const MAX_RANGED_PARTS = 2;
const isRanged = (x: ExtraShare): boolean => x.leadLow !== x.leadHigh && x.monthlyShare !== 0;
export function rangedPartCount(extras: readonly ExtraShare[]): number {
  return extras.filter(isRanged).length;
}
export function exactChance(parts: ShareParts, threshold: number): number {
  momentsOfTeam(parts.team);
  if (!Number.isFinite(threshold)) throw new RangeError('Invalid threshold');
  if (parts.ratio !== undefined) {
    if (!Number.isFinite(parts.ratio) || parts.ratio < 1 || extrasOf(parts).length > 0) throw new RangeError('Invalid capacity ratio');
    return teamTail(parts.team, threshold / parts.ratio);
  }
  const extras = extrasOf(parts);
  for (const x of extras) extraShareMoments(x.monthlyShare, x.D, x.leadLow, x.leadHigh);
  const ranged = extras.filter(isRanged);
  if (ranged.length > MAX_RANGED_PARTS) throw new RangeError('Too many lead-time ranges for the exact check');
  let shifted = threshold;
  for (const x of extras) if (!isRanged(x)) shifted -= x.monthlyShare * Math.max(0, x.D - x.leadLow);
  if (ranged.length === 0) return teamTail(parts.team, shifted);
  const steps = ranged.length === 1 ? EXACT_INTEGRATION_STEPS : MULTI_PART_STEPS;
  const shifts = ranged.map(x => Float64Array.from({ length: steps }, (_, i) =>
    x.monthlyShare * Math.max(0, x.D - (x.leadLow + (i + 0.5) * (x.leadHigh - x.leadLow) / steps))));
  const [first, second] = shifts as [Float64Array, Float64Array | undefined];
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    if (second === undefined) { sum += teamTail(parts.team, shifted - first[i]!); continue; }
    const t = shifted - first[i]!;
    let inner = 0;
    for (let j = 0; j < steps; j++) inner += teamTail(parts.team, t - second[j]!);
    sum += inner / steps;
  }
  return sum / steps;
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
  let extraMean = 0, extraVariance = 0;
  for (const x of extrasOf(parts)) {
    const m = extraShareMoments(x.monthlyShare, x.D, x.leadLow, x.leadHigh);
    extraMean += m.mean; extraVariance += m.sd ** 2;
  }
  // ISL draws both the team part and its held +1 coefficient independently.
  // Var(C*T) = Var(T) + Var(C) * E[T²], for E[C]=1 and held sd(C)=0.01.
  const heldCoefficientVariance = 0.01 ** 2 * (team.mean ** 2 + team.sd ** 2);
  if (parts.ratio !== undefined) {
    if (!Number.isFinite(parts.ratio) || parts.ratio < 1 || extrasOf(parts).length > 0) throw new RangeError('Invalid capacity ratio');
    // `parts.ratio` is the window's scale k (`capacityRatioScale`). The ratio link (`ratioLinkMoments`) beside the baseline
    // contribution B = C·T gives mean k·μB and sd k·σB: the Normal approximation of k × B, for a fixed k.
    const k = parts.ratio, B = { mean: team.mean, sd: Math.sqrt(team.sd ** 2 + heldCoefficientVariance) };
    const ratioMean = k * B.mean, ratioSd = k * B.sd;
    return ratioSd === 0 ? (ratioMean >= threshold ? 1 : 0) : normalTail((threshold - ratioMean) / ratioSd);
  }
  const mean = team.mean + extraMean, sd = Math.sqrt(team.sd ** 2 + extraVariance + heldCoefficientVariance);
  return sd === 0 ? (mean >= threshold ? 1 : 0) : normalTail((threshold - mean) / sd);
}

export type ShareGate = { readonly form: 'point'; readonly error_points: number; readonly exact_extreme?: 0 | 1 }
  | { readonly form: 'range'; readonly low: number; readonly high: number; readonly error_points: number };
export const SHARE_GATE_MAX_ERROR_POINTS = 2;
export function gate(parts: ShareParts, threshold: number, displayedPoint = normalChance(parts, threshold),
  rounding: GoalChanceDisplayRounding = 'whole'): ShareGate {
  const normal = normalChance(parts, threshold), exact = exactChance(parts, threshold);
  const error = Math.abs(normal - exact) * 100;
  const exactClass = goalChanceDisplayClass(exact);
  // Science §(d)4: compare the point the licence WOULD display, then restore a known exact extreme.
  if (error <= SHARE_GATE_MAX_ERROR_POINTS) {
    if (goalChanceDisplayClass(displayedPoint, rounding) === exactClass) return { form: 'point', error_points: error };
    if (exactClass !== 'interior') return { form: 'point', error_points: error, exact_extreme: exactClass === 'less_than_1' ? 0 : 1 };
  }
  const t = parts.team;
  const at = (v: number): number => exactChance({ ...parts, team: { ...t, low: v, high: v } }, threshold);
  return { form: 'range', low: at(t.quantity === 'months_to_finish' ? t.high : t.low),
    high: at(t.quantity === 'months_to_finish' ? t.low : t.high), error_points: error };
}
