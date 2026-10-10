import { GoalHorizonSchema, GoalThresholdFrame } from '@talchain/schemas';
import type { NodeV3T } from '../../schemas/cee-v3.js';
import type { GoalConstraintT } from '../../schemas/assist.js';
import { statedOperatorOf } from '../agent-lane/limit-operator-words.js';
import { goalTargetRow, statedGoalTargetOf } from './stated-goal-target.js';

/** Well-shaped stored bytes; no verification or permission is implied. */
export type UnverifiedHorizonBasis = Readonly<{ basis: string; source: string; bound_months: number; metric: string }>;

/** A projection of held facts, bound to one goal identity. No inferred defaults. */
export type GoalRecord = Readonly<{
  goal_id: NodeV3T['id'];
  label: NodeV3T['label'];
  target: Readonly<{
    raw?: NodeV3T['goal_threshold_raw'];
    cap?: NodeV3T['goal_threshold_cap'];
    unit?: NodeV3T['goal_threshold_unit'];
    frame?: NodeV3T['goal_threshold_frame'];
    comparator?: NodeV3T['goal_direction'];
    comparator_source?: 'goal_direction' | 'row_operator_as_stated' | 'row_operator';
    source?: NodeV3T['threshold_source'];
  }> | null;
  horizon: Readonly<{
    months?: NodeV3T['goal_horizon_months'];
    deadline?: Extract<NonNullable<NodeV3T['goal_horizon']>, { deadline: string }>['deadline'];
    as_stated?: NodeV3T['goal_deadline_as_stated'];
  }> | null;
  /** UNVERIFIED: unverified stored bytes; callers MUST use horizonSteadyAttested(graph) for any permission */
  horizon_basis?: UnverifiedHorizonBasis;
  provenance?: NodeV3T['provenance'] | GoalConstraintT['provenance'];
}>;

/**
 * Ordered sources per fact. "target row" means goalTargetRow: this goal's
 * non-deadline row, matching raw when raw exists, otherwise first own row.
 * Conflicts (also pinned in tests): statedGoalTargetOf uses row comparator/unit
 * when raw is absent, even beside node fields. Prefer the node-held comparator
 * (readHeldGoalComparator and target-testability's level arm) and node unit
 * (goalUnitOf); use observed unit before row unit. Blank units are absent per
 * goalUnitOf, unlike statedGoalTargetOf. goalDeadlineOf reads deadline only;
 * months/as_stated are additional held facts, not inferred calendar dates.
 * horizon_basis is returned beside horizon, never merged: months/deadline
 * come only from goal_horizon then goal_horizon_months; bound_months never
 * overrides either.
 * No labels, sole-goal selection, goal_node_id or normalised target fallbacks.
 */
export const GOAL_RECORD_PRECEDENCE = {
  goal_id: ['nodes[kind=goal,id=goalId].id'],
  label: ['selected goal.label'],
  raw: ['goal_threshold_raw', 'own target row.value'],
  cap: ['goal_threshold_cap (finite and positive)'],
  unit: ['goal_threshold_unit (nonblank)', 'observed_state.unit (nonblank)', 'own target row.unit (nonblank)'],
  frame: ['goal_threshold_frame (when raw exists)', 'own target row.value_frame (only when raw absent)'],
  comparator: ['goal_direction', 'own target row.operator_as_stated (compatible strict twin)', 'own target row.operator'],
  comparator_source: ['same step as comparator: node field → row_operator_as_stated → row_operator; present exactly when comparator is set'],
  source: ['threshold_source'],
  horizon: ['goal_horizon', 'goal_horizon_months'],
  as_stated: ['goal_deadline_as_stated'],
  horizon_basis: ['horizon_basis (exact key, well-formed only): not merged; horizon = goal_horizon → goal_horizon_months'],
  provenance: ['selected goal.provenance', 'own target row.provenance'],
} as const;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const comparator = (v: unknown): v is NonNullable<NonNullable<GoalRecord['target']>['comparator']> =>
  v === '>=' || v === '<=' || v === '>' || v === '<';
const nodeProvenance = (v: unknown): v is NonNullable<NodeV3T['provenance']> =>
  v === 'from_brief' || v === 'ai_inferred' || v === 'user_set';
const rowProvenance = (v: unknown): v is NonNullable<GoalConstraintT['provenance']> =>
  v === 'explicit' || v === 'inferred' || v === 'proxy';

/**
 * Pure, total reader of exactly goalId. Never mutates the input or consults a
 * model, clock or store. Partial targets retain unit/comparator/source even
 * without a figure; null means none of these facts is held. Malformed facts
 * are omitted; a missing/malformed label projects to the empty string.
 * Hostile getters/proxies also fail closed without throwing.
 * horizon_basis is returned beside horizon, never merged. Its bound_months
 * never overrides horizon.months or horizon.deadline; these come only from
 * goal_horizon then goal_horizon_months. horizon_basis has no writer here: slice 2b adds the one door.
 */
export function readGoalRecord(graph: unknown, goalId: string): GoalRecord | null {
  try {
    if (!isRec(graph) || !Array.isArray(graph.nodes) || typeof goalId !== 'string') return null;
    const goal = graph.nodes.find((n): n is Rec => isRec(n) && n.kind === 'goal' && n.id === goalId);
    if (goal === undefined) return null;
    const stated = statedGoalTargetOf(graph, goal);
    const row = goalTargetRow(graph, goal);
    const os = isRec(goal.observed_state) ? goal.observed_state : undefined;
    const unit = text(goal.goal_threshold_unit) ? goal.goal_threshold_unit
      : text(os?.unit) ? os.unit : text(row?.unit) ? row.unit : undefined;
    const nodeHeld = goal.goal_direction;
    const held = comparator(nodeHeld) ? nodeHeld : row === undefined ? undefined : statedOperatorOf(row);
    // The step that supplied the comparator, never its value: the row's own operator, or its stated strict twin.
    const comparatorSource: NonNullable<NonNullable<GoalRecord['target']>['comparator_source']> = comparator(nodeHeld) ? 'goal_direction'
      : held !== undefined && held !== row?.operator ? 'row_operator_as_stated' : 'row_operator';
    const frame = GoalThresholdFrame.safeParse(stated?.frame).data;
    const target = {
      ...(stated !== null ? { raw: stated.value } : {}),
      ...(finite(goal.goal_threshold_cap) && goal.goal_threshold_cap > 0 ? { cap: goal.goal_threshold_cap } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(frame !== undefined ? { frame } : {}),
      ...(held !== undefined ? { comparator: held, comparator_source: comparatorSource } : {}),
      ...(typeof goal.threshold_source === 'string' && goal.threshold_source.length <= 64 ? { source: goal.threshold_source } : {}),
    };
    const approvedHorizon = GoalHorizonSchema.safeParse(goal.goal_horizon).data;
    const months = finite(goal.goal_horizon_months) && Number.isInteger(goal.goal_horizon_months)
      && goal.goal_horizon_months > 0 ? goal.goal_horizon_months : undefined;
    // A schema months arm needs a separately held H; then its approved count keeps precedence.
    // A deadline arm can coexist with that H, but a months-only schema arm supplies no deadline.
    const heldMonths = months !== undefined && approvedHorizon !== undefined && 'months' in approvedHorizon ? approvedHorizon.months : months;
    const horizon = {
      ...(approvedHorizon !== undefined && 'deadline' in approvedHorizon ? { deadline: approvedHorizon.deadline } : {}),
      ...(heldMonths !== undefined ? { months: heldMonths } : {}),
      ...(text(goal.goal_deadline_as_stated) && goal.goal_deadline_as_stated.length <= 60 ? { as_stated: goal.goal_deadline_as_stated } : {}),
    };
    const basis = Object.hasOwn(goal, 'horizon_basis') && isRec(goal.horizon_basis) ? goal.horizon_basis : undefined;
    const horizonBasis = basis !== undefined && text(basis.basis) && text(basis.source)
      && finite(basis.bound_months) && basis.bound_months > 0 && text(basis.metric)
      ? { basis: basis.basis, source: basis.source, bound_months: basis.bound_months, metric: basis.metric } : undefined;
    const provenance = nodeProvenance(goal.provenance) ? goal.provenance
      : rowProvenance(row?.provenance) ? row.provenance : undefined;
    return {
      goal_id: goalId,
      label: typeof goal.label === 'string' ? goal.label : '',
      target: Object.keys(target).length > 0 ? target : null,
      // Preserve a valid schema arm as a projection even when it supplies no held count or calendar date.
      horizon: approvedHorizon !== undefined || Object.keys(horizon).length > 0 ? horizon : null,
      ...(horizonBasis !== undefined ? { horizon_basis: horizonBasis } : {}),
      ...(provenance !== undefined ? { provenance } : {}),
    };
  } catch {
    return null;
  }
}
