/** The outer Agent answer owns one carry step, including Run/Explain fast paths. */
import { computeSurvivingPriorPendings } from '../commit.js';
import { isPendingActionExpired } from '../session/pending-action.js';
import { isChangeOwnPercent } from './admit-model.js';
import type { latestCurrentLevelAsk } from './current-level-answer.js';

type Ask = NonNullable<ReturnType<typeof latestCurrentLevelAsk>>;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** An earlier question licenses only the same unfilled metric in final canonical readback. */
function stillAsksForSameGoal(ask: Ask, graph: unknown): boolean {
  const nodes = record(graph)?.nodes;
  if (!Array.isArray(nodes)) return false;
  const goal = nodes.map(record).find(n => n?.id === ask.action.goal_id && n.kind === 'goal' && n.label === ask.action.goal_label);
  if (goal === undefined || typeof record(goal.observed_state)?.raw_value === 'number') return false;
  const held = record(goal.observed_state)?.unit ?? goal.goal_threshold_unit;
  const unit = isChangeOwnPercent({ frame: goal.goal_threshold_frame, unit: held, metric: goal.label, value: goal.goal_threshold_raw }) ? undefined : held;
  return unit === ask.action.goal_unit;
}

export function currentLevelAskForAnswerRow(input: {
  prior: Ask | null; next: Ask | null; answered: boolean;
  graph: unknown; graphHash: string | undefined; nowMs: number; typedByUser: boolean;
}): Ask | null {
  // A fresh producer ask or typed clarification already owns its arming/decrement.
  if (input.next !== null) return !isPendingActionExpired(input.next, input.nowMs) && stillAsksForSameGoal(input.next, input.graph)
    ? input.next : null;
  if (input.prior === null || isPendingActionExpired(input.prior, input.nowMs)) return null;
  // Keep the shared survivor checks, but offset their one decrement on non-typed turns.
  // Check the original budget first so an exhausted ask can never be revived.
  const prior = input.typedByUser ? input.prior
    : { ...input.prior, expires_at_turn_count: input.prior.expires_at_turn_count + 1 };
  const survivors = computeSurvivingPriorPendings(
    [prior], [], input.answered ? [input.prior.chip_id] : [], input.graphHash, input.nowMs,
  );
  const survivor = survivors[0];
  return survivor?.action.kind === 'elicit_goal_current_level' && stillAsksForSameGoal(survivor as Ask, input.graph)
    ? survivor as Ask : null;
}
