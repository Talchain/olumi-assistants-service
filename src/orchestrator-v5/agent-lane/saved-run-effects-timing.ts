/** Run presses read timing from the saved model, never from button parameters or new AI inference. */
import { goalTargetBasisOf } from '../goal-target/goal-target-basis.js';
import { capacityPartsOf, heldFigureOf } from '../goal-target/hiring-times.js';
import { goalDeadlineFromRecord, isShareCalendarDate } from '../goal-target/goal-kind.js';
import { timeBetween } from '../goal-target/deadline-date.js';
import type { EffectsTiming } from '../goal-target/period-end-assumption.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A start before a deadline is NOT proof that its effects are fully in place. Only the validated
 * saved effect basis can establish that. A held hiring range extending to/after its own deadline
 * establishes later/partial arrival; other explicit but unclassifiable timing stays unknown.
 * The engine still reads the complete carriers (bounds, pace, statements and provenance) unchanged.
 */
export function savedRunEffectsTiming(graph: unknown): EffectsTiming | null {
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  const goals = graph.nodes.filter((n): n is Rec => rec(n) && n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goal = goals[0]!;
  const basis = goalTargetBasisOf(goal);
  if ((goal.goal_target_basis !== undefined && basis === undefined) || basis?.open_question !== undefined) return null;
  const parts = graph.nodes.filter((n): n is Rec => rec(n) && n.kind === 'option' && typeof n.id === 'string')
    .flatMap(o => capacityPartsOf(graph, o.id as string, String(goal.id)));
  let later = false;
  for (const part of parts) {
    const carrier = part.observed_state.extra_share_by_date;
    const low = heldFigureOf(part, 'lead_low'), high = heldFigureOf(part, 'lead_high');
    // Missing, unverified or unapproved estimates cannot become a timing assertion.
    if (!low || !high || [low, high].some(f => f.whose === 'unknown' || f.whose === 'olumi_estimate' || f.role === 'unknown')
      || !Number.isFinite(low.value) || !Number.isFinite(high.value) || low.value < 0 || high.value < low.value
      || !isShareCalendarDate(carrier.reference_date) || !isShareCalendarDate(carrier.deadline)
      || goalDeadlineFromRecord(graph, goal.id) !== carrier.deadline) return null;
    const duration = timeBetween(carrier.reference_date, carrier.deadline, 'months');
    if (!(duration > 0)) return null;
    if (high.value >= duration) later = true;
  }
  if (later) return basis?.effects_at_period_end === true ? null : 'later_or_partial';
  if (basis?.effects_at_period_end === true) return 'in_place_by_period';
  return parts.length > 0 ? null : 'not_stated';
}
