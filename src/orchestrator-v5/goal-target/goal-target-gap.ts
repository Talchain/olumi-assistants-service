/**
 * ⭐ THE ONE "NO TARGET" GAP (C1, Paul's funding test 14 Oct). Moved verbatim from `modelGapOf` (`widen-turn.ts`), which
 * calls it: no target means no option can have a chance of meeting it (D-01). Read in these words by the standing gap
 * (`modelGapOf`, the action bar's "Set target") and the Run cells (`canonical-analysis-view.ts`), which rank it first.
 * Light by design: it imports only the goal readers the cells already load (a `widen-turn.ts` import reordered mocks).
 */
import { statedGoalTargetOf } from './stated-goal-target.js';
import { goalKindOf } from './goal-kind.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const quote = (label: string): string => `‘${label}’`;

export interface GoalTargetGap {
  readonly kind: 'goal_target_missing';
  readonly goal_id: string;
  readonly deadline_known: boolean;
  readonly question: string;
}

/** The goal the graph names (its named goal id when that is a goal node), else the ONE goal node; undefined otherwise. */
function namedGoalOf(raw: Rec): Rec | undefined {
  const goals = (Array.isArray(raw.nodes) ? raw.nodes.map(rec) : []).filter((n): n is Rec => n?.kind === 'goal');
  const named = raw.goal_node_id;
  if (typeof named === 'string') return goals.find((n) => n.id === named);
  return goals.length === 1 ? goals[0] : undefined;
}

/**
 * The named goal holds no stated target (the one stated-target reader), or null. A chance goal takes no target quantity
 * (the goal-kind registry, #2742 S1): its one question is S1's deadline ask, never this one.
 */
export function goalTargetGapOf(graph: unknown): GoalTargetGap | null {
  const raw = rec(graph);
  const goal = raw === undefined ? undefined : namedGoalOf(raw);
  const label = typeof goal?.label === 'string' && goal.label !== '' ? goal.label : null;
  if (raw === undefined || goal === undefined || typeof goal.id !== 'string' || label === null
    || goalKindOf(goal) === 'chance_of_event' || statedGoalTargetOf(raw, goal) !== null) return null;
  const rows = Array.isArray(raw.goal_constraints) ? raw.goal_constraints.map(rec) : [];
  const horizon = rec(goal.goal_horizon);
  const deadlineKnown = rows.some((r) => r?.node_id === goal.id && rec(r?.deadline_metadata) !== undefined)
    || typeof horizon?.deadline === 'string' || finiteNum(horizon?.months);
  return {
    kind: 'goal_target_missing', goal_id: goal.id, deadline_known: deadlineKnown,
    question: deadlineKnown
      ? `One gap: ${quote(label)} has no target yet. What would count as meeting it?`
      : `One gap: ${quote(label)} has no target or deadline yet. What would count as meeting it, and by when?`,
  };
}
