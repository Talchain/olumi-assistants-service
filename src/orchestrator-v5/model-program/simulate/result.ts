// model-program/simulate/result.ts (S2 owns it)
export type Chance = { chance: number; precision_95: [number, number] };                         // Wilson interval = SIMULATION precision, never the chance's meaning band
// ── Changed from the interface block (DL ruling 3, 23 Oct): a nonfinite draw (NaN or ±Infinity) in what a condition reads is
// outside the model's domain, never a failed outcome. That chance (and what contains it) carries no number: it is WITHHELD,
// typed, with how many draws and which quantities. Replaces the earlier `nan_draws` count.
export type Withheld = { withheld: { reason: 'invalid_domain'; count: number; quantities: string[] } };
export type ChanceOrWithheld = Chance | Withheld;
export const isWithheld = (c: ChanceOrWithheld): c is Withheld => 'withheld' in c;
export type OptionResult = {
  option_id: string;
  per_goal: (ChanceOrWithheld & { goal_id: string })[];
  joint: ChanceOrWithheld;                          // all goals on the SAME draws
  within_limits: ChanceOrWithheld;                  // all limits hold
  joint_within_limits: ChanceOrWithheld;
  outcomes: ({ goal_id: string } & ({ p10: number; p50: number; p90: number } | Withheld))[];  // the goal quantity's aggregated value; never a dropped draw
  drivers: { quantity: string; joint_if_low: number; joint_if_high: number }[];  // tercile-conditional on joint_within_limits; presentation follows the #87 rules later, not here
};
export type SimResult = {
  draws: number;
  seed: number;
  options: OptionResult[];
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
