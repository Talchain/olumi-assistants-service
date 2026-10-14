/**
 * ⭐ D3 STEP 1 — A GOAL CEILING IS SCORED AS ONE PAIR: THE THRESHOLD AND `minimise` (Science #87 6005138341 + cap ruling;
 * DL 0df0e1). ISL's existing minimise branch scores `baseline + effect < threshold` per draw, so "at most 400" needs the
 * threshold on the goal node AND the minimise the run sends, together. Before this, the card's ceiling held only its row
 * and `goal_direction: '<='`: the run sent `minimise` with no threshold, and no option had a chance of meeting the goal.
 *
 * Science's rules, each one line below:
 *  · ONE pair writer, called by whichever write completes the pair — the target card (`add_constraint`) when today's level
 *    came first, the today's-level card (`goal-current-level.ts`) when the ceiling came first (rt10b's real order).
 *  · The threshold is the ceiling ROW's own value, found by the row's identity (the goal's own `<=` row), never re-derived.
 *  · The cap is the goal's own LEVEL frame (the today's-level card's `observed_state.cap`), or 100 for a % goal (the unit's
 *    own frame). Never target headroom: a ceiling below today's level would put today off its own scale. Never widened to
 *    fit the ceiling: X/cap ≥ 1 is stamped as it is and the P2 off-scale withhold says so.
 *  · No frame (no level, not %): UNPAIRED — the row and the held direction only, exactly as before; the target is then
 *    untestable (P1) and says so. And no orphan: a held ceiling owns the goal's threshold channel, so whatever figure the
 *    channel held before (a floor the ceiling replaced, an earlier ceiling) goes when the pair cannot be written.
 *
 * The brief path (`admit-model.ts` + `stated-by-user.ts`) pairs its own ceilings at construction on its own cap rule; it
 * is not changed here (MC P0's files; D3 step 1b after P0 merges).
 */
import { readHeldGoalComparator } from './goal-direction.js';
import { resolveGoalThresholdCapWithProvenance } from '../../utils/goal-threshold-cap.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The goal threshold channel: every field the pair writes, and every field a cleared channel loses. */
const CHANNEL = ['goal_threshold_raw', 'goal_threshold', 'goal_threshold_cap', 'goal_threshold_cap_provenance', 'success_threshold', 'threshold_source'] as const;

export interface GoalCeilingRow {
  readonly constraint_id: string | undefined;
  readonly value: number;
  /** What the user said: `'<'` ("below") or `'<='` ("at most"). The row's operator is `'<='` either way. */
  readonly stated: '<' | '<=';
  readonly unit: string | undefined;
}

/**
 * The goal's own ceiling row: on the goal, not a deadline, operator `'<='`, a finite value, on the level frame (or none).
 * Exactly ONE such row, or none: two would make the pair a guess.
 */
export function goalCeilingRow(graph: unknown, goalId: string): GoalCeilingRow | undefined {
  const rows = isRec(graph) && Array.isArray(graph.goal_constraints) ? graph.goal_constraints.filter(isRec) : [];
  const own = rows.filter((r) => r.node_id === goalId && r.deadline_metadata === undefined && r.operator === '<=' && finite(r.value)
    && (r.value_frame === undefined || r.value_frame === 'level'));
  if (own.length !== 1) return undefined;
  const row = own[0]!;
  return {
    constraint_id: typeof row.constraint_id === 'string' ? row.constraint_id : undefined,
    value: row.value as number,
    stated: row.operator_as_stated === '<' ? '<' : '<=',
    unit: typeof row.unit === 'string' && row.unit.trim() !== '' ? row.unit : undefined,
  };
}

/**
 * The frame a ceiling is scored on: the goal's own level frame, else the % unit's own 100 (the one cap rule's metric-scale
 * branch, never its headroom), else none.
 */
export function ceilingFrameCap(goal: Rec, unit: string | undefined, ceiling: number): { readonly cap: number; readonly provenance: 'level_frame' | 'metric_scale' } | null {
  const os = isRec(goal.observed_state) ? goal.observed_state : undefined;
  if (os !== undefined && finite(os.raw_value) && finite(os.cap) && os.cap > 0) return { cap: os.cap, provenance: 'level_frame' };
  const scale = resolveGoalThresholdCapWithProvenance(undefined, ceiling, unit, undefined);
  return scale?.provenance === 'metric_scale' ? { cap: scale.cap, provenance: 'metric_scale' } : null;
}

export type CeilingPairOutcome = 'paired' | 'unpaired' | 'not_a_ceiling';

/**
 * Writes (or clears) the pair on the goal node of `graph`, IN PLACE — callers pass the clone they are about to write. A
 * level-frame goal holding a ceiling (`'<='`/`'<'`) beside ONE own ceiling row is paired on its frame; with no frame, or no
 * one row to pair, its channel is cleared. Any other goal is untouched (`'not_a_ceiling'`): a floor keeps its own writer.
 */
export function pairGoalCeiling(graph: unknown, goalId: string): CeilingPairOutcome {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId);
  if (goal === undefined || goal.kind !== 'goal' || !onTheLevelFrame(goal)) return 'not_a_ceiling';
  const held = readHeldGoalComparator(graph, goalId);
  if (held !== '<=' && held !== '<') return 'not_a_ceiling';
  const row = goalCeilingRow(graph, goalId);
  // ⛔ A held ceiling with no ONE row to pair (none, two, or one stated otherwise) is never left beside an earlier figure
  // (Codex buddy r1 F1 on #2618: two `<=` rows left a floor's 300 minimised against): the channel is cleared, unpaired.
  if (row === undefined || row.stated !== held) {
    for (const k of CHANNEL) delete goal[k];
    return 'unpaired';
  }
  const unit = row.unit ?? (typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit : undefined);
  const frame = ceilingFrameCap(goal, unit, row.value);
  if (frame === null) {
    for (const k of CHANNEL) delete goal[k];
    return 'unpaired';
  }
  goal.goal_threshold_raw = row.value;
  goal.goal_threshold_cap = frame.cap;
  goal.goal_threshold_cap_provenance = frame.provenance;
  goal.goal_threshold = row.value / frame.cap;
  goal.success_threshold = row.value;
  goal.threshold_source = 'user';
  goal.goal_threshold_frame = 'level';
  if (unit !== undefined) goal.goal_threshold_unit = unit;
  goal.goal_direction = row.stated;
  return 'paired';
}

/**
 * ⛔ Only a goal on the LEVEL frame (or none stated) is paired (Codex buddy r1 F2 on #2618): a target stated as a CHANGE
 * ("reduce by 20%", `change_rel`) stays exactly as stated, even beside a separate level row on the goal.
 */
function onTheLevelFrame(goal: Rec): boolean {
  return goal.goal_threshold_frame === undefined || goal.goal_threshold_frame === 'level';
}

/** True when the goal holds a ceiling paired by this module: what the level card renormalises on a new level. */
export function holdsPairableCeiling(graph: unknown, goalId: string): boolean {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const goal = nodes.find((n) => n.id === goalId);
  if (goal === undefined || goal.kind !== 'goal' || !onTheLevelFrame(goal)) return false;
  const held = readHeldGoalComparator(graph, goalId);
  if (held !== '<=' && held !== '<') return false;
  const row = goalCeilingRow(graph, goalId);
  return row !== undefined && row.stated === held;
}
