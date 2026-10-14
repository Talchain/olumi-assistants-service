/** Shared card rounding without graph-reader dependencies. */
export type GoalChanceDisplayRounding = 'whole' | 'nearest_5';

/** The displayed percentage of a chance at a step. `whole` is exactly `displayedGoalPct`'s rule. */
export function displayedPctAt(p: number, rounding: GoalChanceDisplayRounding): number {
  const c = Math.max(0, Math.min(1, p));
  if (rounding === 'whole') return Math.round(c * 100);
  const five = Math.round(c * 20) * 5;
  // Never 0 or 100 for a chance strictly between them: a coarse step must not manufacture a certainty.
  if (c > 0 && five === 0) return 5;
  if (c < 1 && five === 100) return 95;
  return five;
}

/** The card's classes at its licensed rounding step; whole 0.5–1% displays as "about 1%". */
export function goalChanceDisplayClass(p: number, rounding: GoalChanceDisplayRounding = 'whole'): 'less_than_1' | 'interior' | 'more_than_99' {
  const shown = displayedPctAt(p, rounding);
  return shown === 0 ? 'less_than_1' : shown === 100 ? 'more_than_99' : 'interior';
}
