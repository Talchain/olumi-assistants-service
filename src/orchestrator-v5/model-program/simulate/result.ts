// model-program/simulate/result.ts (S2 owns it)
import type { Withheld } from '../executable.js';

export type Chance = { chance: number; precision_95: [number, number] };                         // Wilson interval = SIMULATION precision, never the chance's meaning band
// ── Changed from the interface block (DL ruling 3, 23 Oct): a nonfinite draw (NaN or ±Infinity) in what a condition reads is
// outside the model's domain, never a failed outcome. That chance (and what contains it) carries no number: it is WITHHELD,
// typed, with how many draws and which quantities. `no_goals`: a limits-only run has no joint of its goals.
export type WithheldChance = { withheld: { reason: 'invalid_domain' | 'no_goals'; count: number; quantities: string[] } };
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
};
export type RecordedDraw = {
  option_id: string;
  draw: number;
  values: Record<string, number[]>;
  /** null: the risk's effect time lies beyond the horizon, so its occurrence was never read. */
  risks_fired: Record<string, boolean | null>;
};
