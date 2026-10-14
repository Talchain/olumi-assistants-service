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

/**
 * Whether the goal carries a target: any of the fields the goal-target writer sets (a legacy goal's normalised threshold too,
 * which the Run sends as its threshold), or (RT-10 B′ R3) the goal's own limit row, read by the ONE target reader — "at most
 * 400" is a target, so it is never asked for again. Moved verbatim from `decision-input-ask.ts`, which re-exports it: the
 * target ask and this gap decide with ONE predicate (C1 r1 Codex: a legacy normalised threshold read as "no target").
 */
export function goalHasStatedTarget(goal: Rec, graph?: unknown): boolean {
  const g = rec(graph);
  return finiteNum(goal.goal_threshold_raw) || finiteNum(goal.success_threshold) || finiteNum(goal.goal_threshold)
    || (g !== undefined && statedGoalTargetOf(g, goal) !== null);
}

/**
 * A goal Olumi inferred is a PROVISIONAL objective: its one question is the objective reader's ("What should this model
 * help you explore?", `decision-input-ask.ts`), never a target (AIE Q4; C1 r1 Codex). ONE predicate for both readers.
 */
export const isProvisionalObjective = (goal: Rec): boolean => goal.provenance === 'ai_inferred';

/** The goal the graph names (its named goal id when that is a goal node), else the ONE goal node; undefined otherwise. */
function namedGoalOf(raw: Rec): Rec | undefined {
  const goals = (Array.isArray(raw.nodes) ? raw.nodes.map(rec) : []).filter((n): n is Rec => n?.kind === 'goal');
  const named = raw.goal_node_id;
  if (typeof named === 'string') return goals.find((n) => n.id === named);
  return goals.length === 1 ? goals[0] : undefined;
}

/**
 * The named goal holds no target ({@link goalHasStatedTarget}), or null. A chance goal takes no target quantity (the goal-kind
 * registry, #2742 S1): its one question is S1's deadline ask. A provisional objective's is the objective ask. Never this one.
 */
export function goalTargetGapOf(graph: unknown): GoalTargetGap | null {
  const raw = rec(graph);
  const goal = raw === undefined ? undefined : namedGoalOf(raw);
  const label = typeof goal?.label === 'string' && goal.label !== '' ? goal.label : null;
  if (raw === undefined || goal === undefined || typeof goal.id !== 'string' || label === null
    || goalKindOf(goal) === 'chance_of_event' || isProvisionalObjective(goal) || goalHasStatedTarget(goal, raw)) return null;
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
