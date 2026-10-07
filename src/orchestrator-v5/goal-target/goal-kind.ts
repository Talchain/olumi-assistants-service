/**
 * ⭐ S-E GOALS — THE ONE GOAL-KIND REGISTRY (lane GOALS, DL 0fd71f, 7 Oct; Science ruling
 * `inflight/science-deadline-ruling-20261007.md` §2, P0).
 *
 * Every producer and consumer of a goal asks THIS module what kind of goal it holds, and so what may be asked, written
 * and said about it. Kinds:
 *  · `chance_of_event` — the goal's unit names the CHANCE of an event ("% likelihood of on-time launch"). INVALID as a
 *    quantity: Olumi computes that chance, so it is never propagated, never asked for ("today's level" of it, D-06), and
 *    never given a target. Every goal figure is withheld with ONE sentence, and the one question is the deadline.
 *  · `change`          — a target stated as a change from today (`goal_threshold_frame` `change_abs` / `change_rel`).
 *  · `level`           — everything else: a level to reach or stay within, with or without a deadline (a deadline on a
 *    quantity, "£150k MRR by March", is a horizon on a level, never an event: Science ruling §1 scope).
 * (Slice 2 adds `event_share_by_date`: "Share of <deliverable> done by <date>", ≥ 100%.)
 *
 * The chance predicate reads the goal's UNIT only (the ruling's wording: "a goal unit naming a chance of an event"),
 * whole words, bounded: must-fire "% likelihood of on-time launch", "chance of hitting the date", "probability of launch
 * on time", "% likely"; must-not-fire "% of launch done", "% of customers", "churn %".
 */

import { readRateAsQuantity } from './rate-as-quantity.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export type GoalKind = 'chance_of_event' | 'change' | 'level';

/**
 * A unit naming a chance: its MEASURE — the head noun, which in English is the LAST word before the first "of", "per",
 * "for", "on", "in", "by" or "to" (a compound is head-final: "launch likelihood"; an of-phrase is head-first: "number of
 * chances") — is likelihood, likeliness, chance(s), probability, odds or "likely". Codex buddy r1 on #2742: "number of
 * chances created per match" is a COUNT (its measure is "number"), never a chance. Brackets and "%" are not words.
 */
export const UNIT_HEAD_CUT = /[ \t]{1,4}(?:of|per|for|on|in|by|to)(?:[ \t]{1,4}|$)/i;
/** A bracketed scale note, bounded: "(0-1)", "(%)", "[0–100%]". */
export const SCALE_NOTE = /\([^()]{0,40}\)|\[[^[\]]{0,40}\]/g;
export const CHANCE_WORD = /^(?:likelihoods?|likeliness|chances?|probabilit(?:y|ies)|odds|likely)$/i;

/** True when a goal unit names the chance of an event (Science ruling §2). Units over 200 characters are not read. */
export function unitNamesAChance(unit: unknown): boolean {
  if (typeof unit !== 'string' || unit.length > 200) return false;
  const cut = UNIT_HEAD_CUT.exec(unit);
  // Codex buddy r2 on #2742: a scale annotation in brackets ("probability (0-1)", "likelihood (0–100%)") is never the measure.
  const measure = (cut === null ? unit : unit.slice(0, cut.index)).replace(SCALE_NOTE, ' ')
    .replace(/[()[\]%,.;:]/g, ' ').trim();
  const words = measure.split(/[ \t]+/).filter((w) => w !== '');
  return words.length > 0 && CHANCE_WORD.test(words[words.length - 1]!);
}

/** The unit the goal is measured in: its target's unit, else its level's. */
export function goalUnitOf(goal: Rec): string | undefined {
  const own = goal.goal_threshold_unit;
  if (typeof own === 'string' && own.trim() !== '') return own;
  const os = isRec(goal.observed_state) ? goal.observed_state.unit : undefined;
  return typeof os === 'string' && os.trim() !== '' ? os : undefined;
}

/**
 * The kind of a goal node (see the header). EVERY unit the goal carries is read — its target's and its level's — so a
 * chance in one is never masked by a plain "%" in the other (Codex buddy r1 on #2742).
 */
export function goalKindOf(goal: unknown): GoalKind {
  if (!isRec(goal)) return 'level';
  const os = isRec(goal.observed_state) ? goal.observed_state.unit : undefined;
  const chanceUnits = [goal.goal_threshold_unit, os].filter(unitNamesAChance) as string[];
  // P17, Science ruling (b): a population RATE written as a probability ("churn probability", "conversion probability per
  // visitor") is a quantity. Its unit, then its label, are read by the ruling's four rules; a one-off event stays a chance.
  if (chanceUnits.length > 0
    && readRateAsQuantity([...chanceUnits, typeof goal.label === 'string' ? goal.label : ''].join(' | ')).kind === 'chance') {
    return 'chance_of_event';
  }
  const frame = goal.goal_threshold_frame;
  return frame === 'change_abs' || frame === 'change_rel' ? 'change' : 'level';
}

/** The one goal node of a graph, when there is exactly one. */
export function soleGoalOf(graph: unknown): Rec | undefined {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goals = nodes.filter((n) => n.kind === 'goal');
  return goals.length === 1 ? goals[0] : undefined;
}

/** The deadline the goal holds (`goal_horizon.deadline`, YYYY-MM-DD), if any. */
export function goalDeadlineOf(goal: unknown): string | undefined {
  const h = isRec(goal) && isRec(goal.goal_horizon) ? goal.goal_horizon : undefined;
  const d = h?.deadline;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

/**
 * The ONE sentence for a goal measured as a chance (Science ruling §2, verbatim), and, when the goal already holds its
 * date, what is still missing. Never a question: the one question is the host's (`chanceGoalDeadlineAsk`), said once.
 */
export function chanceGoalSentence(deadlineSaid: string | undefined): string {
  const lead = 'Olumi works out the chance of meeting your deadline; it needs the date and what must be done by then.';
  return deadlineSaid === undefined
    ? lead
    : `${lead} The deadline is ${deadlineSaid}; the model does not yet say what must be done by then, so no option has a chance yet.`;
}

/** The ending every host deadline ask carries, so every selector and replay reader recognises it (`isDecisionInputAsk`). */
export const DEADLINE_ASK_ENDING = "I'll propose it as your deadline.";

/** The one question for a chance goal with no date (ruling §4: the date first). */
export function chanceGoalDeadlineAsk(goalLabel: string): string {
  return `What is the deadline for "${goalLabel}"? A date or a time from now is fine, for example "6 months"; ${DEADLINE_ASK_ENDING}`;
}
