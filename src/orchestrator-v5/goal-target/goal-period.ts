/**
 * ⭐ F1 §1 G1 — A GOAL'S FIGURES ARE HELD IN ITS OWN PERIOD, AND A FIGURE STATED PER ANOTHER PERIOD IS CONVERTED
 * EXPLICITLY, IN ONE PLACE (MG F1 T5 `set_goal`; spec `output/mg-0ebb952a/SEMANTIC-MODEL-SPEC.md` §1 G1, §0 P5, §7).
 *
 * Paul (1 Oct): his "£100k a quarter" was dropped "because the units differ". G1: the target and the current level are
 * held in the goal's own unit AND period; a figure stated per another period is converted EXPLICITLY — month ↔ quarter
 * ×3, month ↔ year ×12, quarter ↔ year ×4 — and the original is kept, verbatim, in `goal_stated_as`. Never dropped.
 *
 * ⛔ EVERY OTHER PAIR IS REFUSED, NEVER GUESSED. A month is not a whole number of weeks or days (4.33…, 28–31), and
 * `none` (a one-off figure) has no rate to convert, so any factor there would be Olumi's guess written as the user's
 * target. Those pairs come back `not_convertible`; the caller writes nothing and asks for the figure per the goal's
 * own period (`askForGoalPeriodFigure`).
 *
 * ⭐ P5 — ONE MODULE, BOTH SURFACES. The Agent's `propose_goal_target` converts with `convertGoalFigure`, and the
 * `goal_target_edit` writer (the ONE op behind the Canvas control AND the Agent's approval) re-checks every event with
 * `statedFigureHolds` before anything is written — so the UI and the Agent can never disagree about what "£100k a
 * quarter" is per month.
 */
import { GoalPeriod, type GoalPeriodType, type GoalStatedAs } from '@talchain/schemas';
import { PERIOD_NAME } from '../agent-lane/admit-constraint.js';

/** Periods per year, for exactly the three periods G1 converts between. A day and a week are deliberately absent. */
const PER_YEAR: Readonly<Record<'month' | 'quarter' | 'year', number>> = { month: 12, quarter: 4, year: 1 };
const perYear = (p: GoalPeriodType): number | undefined =>
  Object.prototype.hasOwnProperty.call(PER_YEAR, p) ? PER_YEAR[p as keyof typeof PER_YEAR] : undefined;

export type GoalFigureConversion =
  | { readonly kind: 'same_period'; readonly value: number }
  /** `factor` is ×3, ×4 or ×12 (`op: 'multiply'`, a shorter period into a longer one) or its inverse (`'divide'`). */
  | { readonly kind: 'converted'; readonly value: number; readonly factor: 3 | 4 | 12; readonly op: 'multiply' | 'divide' }
  | { readonly kind: 'not_convertible'; readonly from: GoalPeriodType; readonly to: GoalPeriodType };

/**
 * `value` stated per `from`, said per `to`. ONE rounding step, by an INTEGER factor (`100000 / 3`, never `100000 * 4 / 12`),
 * so every caller that converts the same figure gets the same bytes.
 */
export function convertGoalFigure(value: number, from: GoalPeriodType, to: GoalPeriodType): GoalFigureConversion {
  if (from === to) return { kind: 'same_period', value };
  const a = perYear(from);
  const b = perYear(to);
  if (a === undefined || b === undefined) return { kind: 'not_convertible', from, to };
  return a > b
    ? { kind: 'converted', value: value * (a / b), factor: (a / b) as 3 | 4 | 12, op: 'multiply' }
    : { kind: 'converted', value: value / (b / a), factor: (b / a) as 3 | 4 | 12, op: 'divide' };
}

/**
 * The writer's tolerance (MG brief, T5): a client may compute the same conversion in another order (`100000 * 4 / 12`),
 * so the figures are one figure when they agree to 1e-9 RELATIVE. Zero equals only zero.
 */
export const GOAL_FIGURE_RELATIVE_TOLERANCE = 1e-9;
export function sameGoalFigure(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= GOAL_FIGURE_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

export type StatedFigureCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'goal_period_not_convertible'; readonly from: GoalPeriodType; readonly to: GoalPeriodType }
  | { readonly ok: false; readonly reason: 'goal_period_conversion_mismatch'; readonly expected: number };

/**
 * ⭐ THE WRITER'S G1 GATE (`goal_target_edit`, T5). The rule, kept deliberately simple (MG brief):
 *   · the goal's period is the event's `goal_period`, else the one the goal ALREADY holds (G1 binds the target to the
 *     goal's own period either way; a client that omits it does not opt out). No period known → nothing to check.
 *   · the figure `raw_value` was taken from is the LAST `stated_as` entry (the client lists it last; earlier entries are
 *     the record of what was said before, and are never converted here).
 *   · when that entry's period differs from the goal's: a `not_convertible` pair (day, week, none) is REFUSED, and a
 *     convertible one must equal `raw_value` within `GOAL_FIGURE_RELATIVE_TOLERANCE`, or it is REFUSED.
 *   · the same period, or no `stated_as`: nothing to check (the period is then the target's own).
 * Refused means NOTHING is written (the caller's no-write refusal), never a silently re-derived target.
 */
export function statedFigureHolds(input: {
  readonly raw_value: number;
  readonly goal_period: GoalPeriodType | undefined;
  readonly stated_as: readonly GoalStatedAs[] | undefined;
}): StatedFigureCheck {
  const { raw_value, goal_period, stated_as } = input;
  const last = stated_as !== undefined && stated_as.length > 0 ? stated_as[stated_as.length - 1]! : undefined;
  if (goal_period === undefined || last === undefined || last.period === goal_period) return { ok: true };
  const c = convertGoalFigure(last.value, last.period, goal_period);
  if (c.kind === 'not_convertible') return { ok: false, reason: 'goal_period_not_convertible', from: c.from, to: c.to };
  return sameGoalFigure(raw_value, c.value) ? { ok: true } : { ok: false, reason: 'goal_period_conversion_mismatch', expected: c.value };
}

/** A period as the user says it after a figure ("£100k a quarter"). `none` says nothing. */
export const GOAL_PERIOD_WORDS: Readonly<Record<GoalPeriodType, string>> = {
  none: '', day: 'a day', week: 'a week', month: 'a month', quarter: 'a quarter', year: 'a year',
};

/**
 * The honest ask when a figure's period cannot be converted (week, day or none against the goal's period). The sentence
 * names both periods and says nothing was changed; it never offers a factor.
 */
export function askForGoalPeriodFigure(from: GoalPeriodType, to: GoalPeriodType): string {
  const said = from === 'none' ? 'a figure with no period' : `a figure per ${from}`;
  const wanted = to === 'none' ? 'as one overall figure' : `per ${to}`;
  return `Olumi does not convert ${said} into one ${wanted}: that would need a conversion the user never gave, so it would be a guess. `
    + `Nothing was changed. Ask the user for the figure ${wanted}.`;
}

/**
 * The periods a span of the user's words NAMES ("£100k a quarter" → quarter; "monthly" → month; "p.a." → year), read
 * with the limit grammar's own period words (`PERIOD_NAME`, `admit-constraint.ts`), never a second list. Singular words
 * only: "in 6 months" is a horizon, not a rate. Used to ATTEST a period the Agent claims the user stated — a guard that
 * only refuses, never a source of meaning (P1).
 */
const PERIOD_WORD_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${Object.keys(PERIOD_NAME).sort((a, b) => b.length - a.length).join('|')}|p\\.a\\.?)(?![\\p{L}\\p{N}])`,
  'giu',
);
export function periodsNamedIn(text: string | null | undefined): ReadonlySet<GoalPeriodType> {
  const out = new Set<GoalPeriodType>();
  if (typeof text !== 'string') return out;
  for (const m of text.matchAll(PERIOD_WORD_RE)) {
    const w = m[0].toLowerCase();
    const p = /^p\.a\.?$/.test(w) ? 'year' : PERIOD_NAME[w];
    if (p === 'day' || p === 'week' || p === 'month' || p === 'quarter' || p === 'year') out.add(p);
  }
  return out;
}

/**
 * ⛔ A TARGET WRITE NEVER DROPS THE PERIOD THE GOAL'S OWN UNIT CARRIES (R3 F5 I1.1, #85 5932127058, CEE `30d417d0`): the
 * brief stored `goal_threshold_unit` "£ per quarter"; the approved "double that" card sent "£", and the writer replaced
 * the unit, so the goal lost its period. When the card's unit is the goal's held unit WITHOUT its period, the held unit
 * is written. Structural: it splits the STORED unit on its own " per " / "/" joint, never the user's words. Any other
 * pair (a card that names its own period, a different base unit, no held unit) writes the card's unit, as before.
 */
const UNIT_PERIOD_JOINT = /\s+per\s+|\s*\/\s*/i;
export function unitKeepingHeldPeriod(cardUnit: string, heldUnit: unknown): string {
  if (typeof heldUnit !== 'string' || UNIT_PERIOD_JOINT.test(cardUnit)) return cardUnit;
  const parts = heldUnit.split(UNIT_PERIOD_JOINT);
  if (parts.length !== 2 || parts[1]!.trim() === '') return cardUnit;
  return parts[0]!.trim().toLowerCase() === cardUnit.trim().toLowerCase() ? heldUnit : cardUnit;
}
/** Whether a unit already names its period ("£ per quarter", "£/month"), so no period word is appended to it. */
export function unitNamesItsPeriod(unit: string): boolean {
  return UNIT_PERIOD_JOINT.test(unit);
}

/**
 * ⭐ ONE PERIOD CARRIER (CODEX #2454 5932596768: `{unit: '£ per quarter', goal_period: 'month'}` was accepted — two
 * carriers saying two periods for one figure). A goal stored before 0.69.0 names its period only in its unit string
 * ("£ per quarter", R3 I1.1); from 0.69.0 the typed `goal_period` names it. They are ONE concept:
 *   · `periodNamedByUnit` — the single period a stored unit names after its own joint, else undefined (structural);
 *   · `goalPeriodOf` — the goal's period: the typed `goal_period`, else the one its unit names. The Agent's card, the
 *     G1 conversion and the writer's gate all read the goal's period through this, so a legacy "per quarter" converts a
 *     "£70k a month" exactly as a typed `quarter` does;
 *   · `periodsCollide` — a unit naming one period beside a typed `goal_period` naming another: refused by the writer
 *     for every client, and never produced by the Agent.
 */
export function periodNamedByUnit(unit: unknown): GoalPeriodType | undefined {
  if (typeof unit !== 'string') return undefined;
  const parts = unit.split(UNIT_PERIOD_JOINT);
  if (parts.length !== 2) return undefined;
  const named = periodsNamedIn(parts[1]);
  return named.size === 1 ? [...named][0] : undefined;
}
export function goalPeriodOf(goal: { readonly goal_period?: unknown; readonly goal_threshold_unit?: unknown } | undefined): GoalPeriodType | undefined {
  const typed = GoalPeriod.safeParse(goal?.goal_period);
  return typed.success ? typed.data : periodNamedByUnit(goal?.goal_threshold_unit);
}
export function periodsCollide(unit: unknown, goalPeriod: GoalPeriodType | undefined): boolean {
  const named = periodNamedByUnit(unit);
  return goalPeriod !== undefined && named !== undefined && named !== goalPeriod;
}
/** The unit without its period phrase ("£ per quarter" → "£"); a unit with no single joint is returned as it is. */
export function unitWithoutPeriod(unit: string): string {
  const parts = unit.split(UNIT_PERIOD_JOINT);
  return parts.length === 2 && periodNamedByUnit(unit) !== undefined ? parts[0]!.trim() : unit;
}
