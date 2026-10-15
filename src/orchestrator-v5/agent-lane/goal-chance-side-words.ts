/**
 * ⭐ S9: ONE side of a recorded goal-chance pair (`RunDeltaGoalChanceSide`: that Run's own display licence) in the screen's
 * words: "about 45%", "between about 30% and 36%", with the edge words "less than 1%" / "more than 99%" (`sayDisplayedPct`;
 * DGAI `goalChanceRangeLine`). A leaf module (no imports), read by the rerun plan and by the wire leader gate alike.
 */
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const sayPct = (p: number): string => (p === 0 ? 'less than 1%' : p === 100 ? 'more than 99%' : `about ${p}%`);
const wholePct = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;

/** A side as the screen says it; `undefined` for a withheld or unrecorded side. */
export function sayGoalChanceSide(side: unknown): string | undefined {
  const s = rec(side);
  if (s?.kind === 'point' && wholePct(s.pct)) return sayPct(s.pct);
  if (s?.kind === 'range' && wholePct(s.low_pct) && wholePct(s.high_pct) && s.low_pct <= s.high_pct) {
    return `between ${sayPct(s.low_pct)} and ${sayPct(s.high_pct).replace(/^about /, '')}`;
  }
  return undefined;
}
