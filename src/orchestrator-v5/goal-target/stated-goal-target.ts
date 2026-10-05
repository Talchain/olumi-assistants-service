/**
 * ⭐ THE ONE TARGET READER (RT-10 B′ R3, Science #87 5999608477; DL e8).
 *
 * The goal's stated target is its own raw threshold, else the goal's OWN non-deadline limit row, WITH that row's
 * operator. Served (red team #87 5999041843): the user set "at most 400" through the goal panel, which writes ONLY the
 * `<=` goal_constraints row (add-constraint never stamps `goal_threshold_raw` for `<=`: that channel is ISL's ≥
 * probability, so stamping it would compute P(goal ≥ 400)). Target-testability already read the row, but the receipt,
 * the context-pack record and the chat's one question read only the node's fields, so the Model row said "Not set" and
 * the chat asked "What is the most that … can be?" for the target the user had just given.
 *
 * Leaf module (no imports) so every reader — target-testability, the receipt guard, the decision-input ask — reads the
 * same answer without an import cycle.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface StatedGoalTarget {
  readonly value: number;
  readonly unit?: string;
  /** `level` / `change_rel` / … as the carrier holds it. */
  readonly frame?: string;
  /** The held comparator: the node's `goal_direction` for a raw threshold, the row's `operator` for a limit row. */
  readonly held?: string;
}

/**
 * The goal's own limit row: the target when the node carries no raw threshold. A DEADLINE on the goal ("within 18
 * months") is a time limit, not the target: skipped, detected by `deadline_metadata` PRESENCE (`compound-goals.ts`).
 */
export function goalOwnLimitRow(graph: Rec, goal: Rec): Rec | undefined {
  const rows = Array.isArray(graph.goal_constraints) ? graph.goal_constraints.filter(isRec) : [];
  return rows.find((c) => c.node_id === goal.id && finite(c.value) && !isRec(c.deadline_metadata));
}

/** The goal's stated target, or null when the goal states none. */
export function statedGoalTargetOf(graph: Rec, goal: Rec): StatedGoalTarget | null {
  if (finite(goal.goal_threshold_raw)) {
    return {
      value: goal.goal_threshold_raw,
      ...(typeof goal.goal_threshold_unit === 'string' ? { unit: goal.goal_threshold_unit } : {}),
      ...(typeof goal.goal_threshold_frame === 'string' ? { frame: goal.goal_threshold_frame } : {}),
      ...(typeof goal.goal_direction === 'string' ? { held: goal.goal_direction } : {}),
    };
  }
  const row = goalOwnLimitRow(graph, goal);
  if (row === undefined) return null;
  return {
    value: row.value as number,
    ...(typeof row.unit === 'string' ? { unit: row.unit } : {}),
    ...(typeof row.value_frame === 'string' ? { frame: row.value_frame } : {}),
    ...(typeof row.operator === 'string' ? { held: row.operator } : {}),
  };
}
