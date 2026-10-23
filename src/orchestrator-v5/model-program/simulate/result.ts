// model-program/simulate/result.ts (S2 owns it)
export type Chance = { chance: number; precision_95: [number, number] };                         // Wilson interval = SIMULATION precision, never the chance's meaning band
export type OptionResult = {
  option_id: string;
  per_goal: (Chance & { goal_id: string })[];
  joint: Chance;                                    // all goals on the SAME draws
  within_limits: Chance;                            // all limits hold
  joint_within_limits: Chance;
  outcomes: { goal_id: string; p10: number; p50: number; p90: number }[];  // the goal quantity's aggregated value
  drivers: { quantity: string; joint_if_low: number; joint_if_high: number }[];  // tercile-conditional on joint_within_limits; presentation follows the #87 rules later, not here
  // ── Additive to the interface block (S2): "ratio by zero: that draw is NaN … Report the count."
  /** Draws in which any goal's or limit's aggregated value, target or bound was NaN; each counts as not met / not within. */
  nan_draws: number;
};
export type SimResult = {
  draws: number;
  seed: number;
  options: OptionResult[];
  // ── Additive (S2): only when `record` asks for draw indices. The per-period values of every quantity in those draws, per
  // option, and which risks fired: the evidence that options share their draws and that a risk acts only where it fires.
  recorded?: RecordedDraw[];
};
export type RecordedDraw = {
  option_id: string;
  draw: number;
  values: Record<string, number[]>;
  /** null: the risk's effect period lies beyond the horizon, so its occurrence was never read. */
  risks_fired: Record<string, boolean | null>;
};
