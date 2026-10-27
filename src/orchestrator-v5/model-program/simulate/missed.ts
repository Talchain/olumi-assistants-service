/**
 * WHAT A MISS LOOKS LIKE IN THE MODEL (SC7: the computed half of "If it failed", Paul D11 A). For one option, from the Run's
 * own draws, with no extra run and no AI: of the draws where the option misses (every goal together, within every limit),
 *   - in how many each goal and each limit fails;
 *   - where a goal falls short, its value there: the middle, and the bad end (the 10th percentile for an at-least goal, the
 *     90th for an at-most one);
 *   - each uncertain figure whose bad third (its lowest or highest third of the draws, whichever holds more of the misses)
 *     holds clearly more of the misses than of the draws where the option does not miss;
 *   - each risk that fires clearly more often in the misses than in the draws where it does not miss.
 * Against the draws that do not miss, never against all draws: where most draws miss, a third can hold at most a third of
 * the draws, so its share of the misses barely rises above a third however much it matters (a low price behind 81% misses
 * held 41% of them); against the draws that meet the aims it held 2%. "Clearly": the difference is at least MIN_LIFT, and
 * its one-sided lower bound is above 0 (Newcombe's hybrid score interval for two independent proportions, 1998, method 10,
 * with phi 0) at a family-wise 5% for the option (Bonferroni over every third and risk tested: a figure's worse third is
 * picked from two, so both count). So the chance of naming any figure or risk that has nothing to do with a miss stays at
 * most 1 in 20 per option, however many the model holds. Nothing is said below MISS_FLOOR misses.
 *
 * An ASSOCIATION in this model's misses, never a cause: a figure that moves with another (a stock and its inflow) shares its
 * misses. A finding for the team to test, as the pre-mortem's prospective hindsight asks (Klein 2007), never advice.
 */
import { PhiInv } from './range-law.js';

/** Fewer misses than this describe too little to say what a miss looks like. */
export const MISS_FLOOR = 50;
/** A share in the misses this far above its share where the option does not miss (10 points), and clear of it (FAMILY_ALPHA), is said. */
export const MIN_LIFT = 0.1;
/** The chance, per option, of naming any figure or risk with nothing to do with a miss. */
export const FAMILY_ALPHA = 0.05;
/** A goal's value where it falls short is said only from at least this many draws. */
export const OUTCOME_FLOOR = 10;

export type WhenMissed =
  | { readonly kind: 'summary'; readonly misses: number; readonly draws: number;
      /** Every goal and limit, in model order: in how many of the misses it fails. */
      readonly aims: readonly { readonly id: string; readonly role: 'goal' | 'limit'; readonly failed: number }[];
      /** Per goal falling short in at least OUTCOME_FLOOR draws: its value there (aggregated, `per` ratios excluded). */
      readonly outcomes: readonly { readonly goal_id: string; readonly failed: number; readonly middle: number; readonly bad_end: number }[];
      /** The figures whose bad third holds clearly more of the misses than of the draws that do not miss, largest gap first. */
      readonly figures: readonly { readonly quantity: string; readonly third: 'low' | 'high'; readonly in_misses: number; readonly share: number;
        readonly in_met: number; readonly met_share: number }[];
      /** The risks that fire clearly more often in the misses than where the option does not miss (where read), largest gap first. */
      readonly risks: readonly { readonly risk_id: string; readonly in_misses: number; readonly read_in_misses: number; readonly share: number;
        readonly in_met: number; readonly read_in_met: number; readonly met_share: number }[];
      /** How many figures and risks were looked at: none standing out among several is itself a finding. */
      readonly looked_at: number }
  | { readonly kind: 'none'; readonly reason: 'no_misses' | 'too_few_misses' | 'invalid_domain'; readonly misses: number; readonly draws: number };

/** The Wilson score interval for k of n at standard Normal quantile z. */
export function wilson(k: number, n: number, z: number): [number, number] {
  const p = k / n, z2 = z * z, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom, half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
/** Clearly more often in the misses (k1 of n1) than where it does not miss (k2 of n2): by MIN_LIFT, and Newcombe's lower bound at z above 0. */
export function standsOut(k1: number, n1: number, k2: number, n2: number, z: number): boolean {
  if (n1 === 0 || n2 === 0) return false;
  const p1 = k1 / n1, p2 = k2 / n2, [l1] = wilson(k1, n1, z), [, u2] = wilson(k2, n2, z);
  return p1 - p2 >= MIN_LIFT && p1 - p2 - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2) > 0;
}

/** The p-th quantile of sorted values (the simulator's own interpolation, `quantiles`). */
export function quantileOf(sorted: Float64Array, p: number): number {
  const h = (sorted.length - 1) * p, lo = Math.floor(h);
  return lo + 1 < sorted.length && h > lo ? sorted[lo]! + (h - lo) * (sorted[lo + 1]! - sorted[lo]!) : sorted[lo]!;
}

/** One option's draws, as runOption holds them: every array indexed by draw. */
export interface MissInput {
  readonly draws: number;
  /** Draws outside the domain for any goal or limit: then nothing is summarised (as for the drivers and quantiles). */
  readonly bad: number;
  /** Every goal together within every limit, met (1) or not (0), per draw. */
  readonly both: Uint8Array;
  readonly goals: readonly { readonly id: string; readonly met: Uint8Array; readonly value: Float64Array; readonly atLeast: boolean; readonly ratio: boolean }[];
  readonly limits: readonly { readonly id: string; readonly met: Uint8Array }[];
  /** Each uncertain figure the option's aims rest on (no option's switch), with the draws in its lowest and highest third. */
  readonly figures: readonly { readonly quantity: string; readonly low: Int32Array; readonly high: Int32Array }[];
  /** Each risk on what the option's aims rest on: in how many draws its occurrence was read and it fired, overall and in the misses. */
  readonly risks: readonly { readonly risk_id: string; readonly read: number; readonly fired: number; readonly readInMisses: number; readonly firedInMisses: number }[];
}

export function summariseMisses(x: MissInput): WhenMissed {
  const { draws } = x;
  let met = 0;
  for (let d = 0; d < draws; d++) met += x.both[d]!;
  const misses = draws - met;
  if (x.bad > 0) return { kind: 'none', reason: 'invalid_domain', misses, draws };
  if (misses === 0) return { kind: 'none', reason: 'no_misses', misses, draws };
  if (misses < MISS_FLOOR) return { kind: 'none', reason: 'too_few_misses', misses, draws };
  const failed = (m: Uint8Array): number => { let k = 0; for (let d = 0; d < draws; d++) k += 1 - m[d]!; return k; };
  // A goal or a limit that fails makes the draw a miss, so its failures are all among the misses.
  const aims = [...x.goals.map((g) => ({ id: g.id, role: 'goal' as const, failed: failed(g.met) })),
    ...x.limits.map((l) => ({ id: l.id, role: 'limit' as const, failed: failed(l.met) }))];
  const outcomes = x.goals.flatMap((g, i) => {
    const k = aims[i]!.failed;
    if (g.ratio || k < OUTCOME_FLOOR) return [];
    const short = new Float64Array(k);
    for (let d = 0, j = 0; d < draws; d++) if (g.met[d] === 0) short[j++] = g.value[d]!;
    short.sort();
    return [{ goal_id: g.id, failed: k, middle: quantileOf(short, 0.5), bad_end: quantileOf(short, g.atLeast ? 0.1 : 0.9) }];
  });
  const missIn = (idx: Int32Array): number => { let k = 0; for (const d of idx) k += 1 - x.both[d]!; return k; };
  const read = x.risks.filter((r) => r.read > 0), tests = 2 * x.figures.length + read.length;
  const z = PhiInv(1 - FAMILY_ALPHA / Math.max(1, tests));
  const lift = (a: { share: number; met_share: number }) => a.share - a.met_share;
  const figures = x.figures.flatMap((f) => {
    const low = missIn(f.low), high = missIn(f.high), third: 'low' | 'high' = high > low ? 'high' : 'low';
    const in_misses = Math.max(low, high), in_met = (third === 'low' ? f.low : f.high).length - in_misses;
    return standsOut(in_misses, misses, in_met, met, z) ? [{ quantity: f.quantity, third, in_misses, share: in_misses / misses, in_met, met_share: in_met / met }] : [];
  }).sort((a, b) => lift(b) - lift(a));
  const risks = read.flatMap((r) => {
    const in_met = r.fired - r.firedInMisses, read_in_met = r.read - r.readInMisses;
    return standsOut(r.firedInMisses, r.readInMisses, in_met, read_in_met, z) ? [{ risk_id: r.risk_id, in_misses: r.firedInMisses, read_in_misses: r.readInMisses,
      share: r.firedInMisses / r.readInMisses, in_met, read_in_met, met_share: in_met / read_in_met }] : [];
  }).sort((a, b) => lift(b) - lift(a));
  return { kind: 'summary', misses, draws, aims, outcomes, figures, risks, looked_at: x.figures.length + read.length };
}
