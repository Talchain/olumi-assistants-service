// model-program/simulate/result.ts (S2 owns it)
import type { Withheld } from '../executable.js';
import type { PairedDifference } from './paired.js';

export type Chance = { chance: number; precision_95: [number, number] };                         // Wilson interval = SIMULATION precision, never the chance's meaning band
// ── Changed from the interface block (DL ruling 3, 23 Oct): a nonfinite draw (NaN or ±Infinity) in what a condition reads is
// outside the model's domain, never a failed outcome. That chance (and what contains it) carries no number: it is WITHHELD,
// typed, with how many draws and which quantities. `no_goals`: a limits-only run has no joint of its goals.
export type WithheldChance = { withheld: { reason: 'invalid_domain' | 'no_goals'; count: number; quantities: string[] } };
/** In EVERY draw that names it: below its floor, above its ceiling, a divisor that was 0, not a finite number (an overflow, an
 *  undefined result), or unreadable only because a value it rests on left its domain (`follows`). Across draws that differ:
 *  `outside`, below in some and above in others; `mixed`, outside what it can be in some and not worked out in others (a
 *  direction is said only where every draw went that way: buddy on #3836). */
export type OutsideCause = 'below' | 'above' | 'divided_by_zero' | 'not_finite' | 'follows' | 'outside' | 'mixed';
export type ChanceOrWithheld = Chance | WithheldChance;
export const isWithheld = (c: ChanceOrWithheld): c is WithheldChance => 'withheld' in c;
export type OptionResult = {
  option_id: string;
  per_goal: (ChanceOrWithheld & { goal_id: string })[];
  joint: ChanceOrWithheld;                          // all goals on the SAME draws
  within_limits: ChanceOrWithheld;                  // all limits hold
  joint_within_limits: ChanceOrWithheld;
  outcomes: ({ goal_id: string } & ({ p10: number; p50: number; p90: number } | WithheldChance))[];  // the goal quantity's aggregated value; never a dropped draw
  drivers: { quantity: string; joint_if_low: number; joint_if_high: number }[];  // tercile-conditional on joint_within_limits; presentation follows the #87 rules later, not here
  // ── Additive (gold-model ruling 3): each limit's own chance, and its quantity's aggregated value (e.g. the cost) over the draws.
  per_limit: (ChanceOrWithheld & { limit_id: string })[];
  limit_outcomes: ({ limit_id: string } & ({ p10: number; p50: number; p90: number } | WithheldChance))[];
  // ── Additive (DL 27 Oct: say what actually happened): each quantity a withheld chance of this option names, and what
  // happened to it, so its words never call a value that fell below its floor one that "could not be worked out".
  outside: Record<string, OutsideCause>;
};
/** One chance the simulator withheld, listed once at the top of the result. */
export type WithheldChanceEntry = { option_id: string; scope: 'goal' | 'limit' | 'joint' | 'within_limits' | 'joint_within_limits'; id?: string }
  & WithheldChance['withheld'];
export type SimResult = {
  draws: number;
  seed: number;
  options: OptionResult[];
  /** The compiler's `withheld[]` (executable.ts r3), echoed unchanged: what of the person's model is NOT in this run. */
  withheld: Withheld[];
  /** Every chance the simulator itself withheld (a nonfinite draw; a limits-only run's joint), across the options. */
  withheld_chances: WithheldChanceEntry[];
  // ── Additive (S2): only when `record` asks for draw indices. Every quantity's value at times 0..periods (boundaries for a
  // state, intervals for a flow), per option, and which risks fired: the evidence that options share their draws and that a
  // risk acts only where it fires.
  recorded?: RecordedDraw[];
  // ── Additive (SC0): only when `perDraw` asks. Every draw's own results, in memory only (typed arrays; never stored).
  per_draw?: PerDraw;
  /** SC2: every pair of options compared on the same draws, a − b, in model order (paired.ts). */
  paired: { a: string; b: string; joint_within_limits: PairedDifference }[];
};
/**
 * SC0: every draw's own results on the Run's shared draws, for the methods that read them (a paired comparison, value of
 * information, an uncertainty share, what failure looks like, a tipping point). Index d of every array is the same draw.
 */
export type PerDraw = {
  /** Each ranged input's value in every draw, by quantity id: the same for every option (common random numbers). */
  inputs: Record<string, Float64Array>;
  options: PerDrawOption[];
};
export type PerDrawOption = {
  option_id: string;
  /** Per goal and per limit, in model order. */
  goals: PerDrawCondition[];
  limits: PerDrawCondition[];
  /** The headline, every goal together within every limit (`joint_within_limits`): 1 met, 0 not, −1 outside the domain. */
  joint_within_limits: Int8Array;
  /** Per risk, in model order: 1 fired, 0 did not, −1 never read (its time lies beyond the horizon), −2 its chance outside 0..1. */
  risks: { risk_id: string; fired: Int8Array }[];
};
/** `value`: the aggregated value (a `per` ratio included), NaN outside the domain; `against`: its target or bound where the
 *  window ends; `met`: 1, 0, or −1 outside the domain. The margin is value − against. */
export type PerDrawCondition = { id: string; value: Float64Array; against: Float64Array; met: Int8Array };
export type RecordedDraw = {
  option_id: string;
  draw: number;
  values: Record<string, number[]>;
  /** null: the risk's effect time lies beyond the horizon, so its occurrence was never read. */
  risks_fired: Record<string, boolean | null>;
};
