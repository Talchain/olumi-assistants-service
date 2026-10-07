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

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export type GoalKind = 'chance_of_event' | 'change' | 'level';

/** A unit naming a chance: likelihood, chance, probability, odds, "likely". Whole words; no nested repeats. */
export const CHANCE_WORD = /(?:^|[^\p{L}])(?:likelihoods?|likeliness|chances?|probabilit(?:y|ies)|odds|likely)(?=$|[^\p{L}])/iu;

/** True when a goal unit names the chance of an event (Science ruling §2). Units over 200 characters are not read. */
export function unitNamesAChance(unit: unknown): boolean {
  return typeof unit === 'string' && unit.length <= 200 && CHANCE_WORD.test(unit);
}

/** The unit the goal is measured in: its target's unit, else its level's. */
export function goalUnitOf(goal: Rec): string | undefined {
  const own = goal.goal_threshold_unit;
  if (typeof own === 'string' && own.trim() !== '') return own;
  const os = isRec(goal.observed_state) ? goal.observed_state.unit : undefined;
  return typeof os === 'string' && os.trim() !== '' ? os : undefined;
}

/** The kind of a goal node (see the header). */
export function goalKindOf(goal: unknown): GoalKind {
  if (!isRec(goal)) return 'level';
  if (unitNamesAChance(goalUnitOf(goal))) return 'chance_of_event';
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
