/**
 * The screen's words for a comparator and a displayed percentage, and the display rounding a chance's precision earns.
 * The program's presenter needs only these, so they live apart from the legacy goal-target modules they came from
 * (`goal-target-basis.ts`, `goal-chance-driver.ts`, `goal-targets-joint.ts`), which re-export them (ALPHA-CODE-INVENTORY §1 F0).
 */
import type { GoalChanceDisplayRounding } from '../../goal-target/goal-chance-display.js';

const COMPARATOR_WORDS: Readonly<Record<string, string>> = { '>=': 'at least', '>': 'above', '<=': 'at most', '<': 'below' };
export const comparatorWords = (op: unknown): string | undefined => typeof op === 'string' ? COMPARATOR_WORDS[op] : undefined;

const TOL = 1e-9;
/** Ruling 5: the widest Wilson half-width, in percentage points, that is still shown as a whole percentage. */
export const WHOLE_PCT_MAX_HALF_WIDTH_POINTS = 2.5;

/** Ruling 5 on a half-width in percentage points. */
export function displayRoundingFor(halfWidthPoints: number): GoalChanceDisplayRounding {
  return halfWidthPoints <= WHOLE_PCT_MAX_HALF_WIDTH_POINTS + TOL ? 'whole' : 'nearest_5';
}

/** "about 37%", "less than 1%", "more than 99%" — the screen's one edge-word rule for a displayed whole percentage. */
export function sayDisplayedPct(pct: number): string {
  return pct === 0 ? 'less than 1%' : pct === 100 ? 'more than 99%' : `about ${pct}%`;
}
